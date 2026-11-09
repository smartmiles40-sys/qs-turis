// src/fin/comissoes/dados.ts
// -----------------------------------------------------------------------------
// Leitura e escrita das comissões (0327). A conta é em ./calculo (pura).
// Quem lê o quê é o banco que decide (RLS): o vendedor só recebe os cards, os
// ajustes, as exceções de regra e os fechamentos DELE; o financeiro recebe tudo.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { linhasDoMes, type Ajuste, type Cotacao, type Linha, type Papel, type Regra, type VendaCard } from "./calculo";

export interface Fechamento {
  id: string;
  pessoa_id: string;
  papel: Papel;
  mes: string;
  status: "fechado" | "pago" | "reaberto";
  total: number;
  cards: number;
  itens: Linha[];
  fechado_em: string;
  fechado_por: string | null;
  pago_em: string | null;
  reaberto_em: string | null;
  motivo_reabertura: string | null;
}

export interface Apelido { nome_norm: string; nome_bitrix: string; pessoa_id: string }
export interface EstadoSync { rodou_em: string | null; cards: number | null; erro: string | null }

export interface DadosDoMes {
  linhas: Linha[];
  regras: Regra[];
  ajustes: Ajuste[];
  fechamentos: Fechamento[];     // vivos (fechado/pago) do mês
  historico: Fechamento[];       // reabertos do mês
  sync: EstadoSync | null;
  lucros: Record<string, LucroDigitado>;
}

export interface LucroDigitado { bitrix_id: string; lucro: number; obs: string | null; atualizado_por: string | null; atualizado_em: string }

/** "2026-10" → ["2026-10-01", "2026-11-01"]. */
export function limitesDoMes(mes: string): [string, string] {
  const [a, m] = mes.split("-").map(Number);
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  return [`${mes}-01`, `${prox}-01`];
}

export function mesAtual(agora = new Date()): string {
  const br = new Date(agora.getTime() - 3 * 3600_000);
  return br.toISOString().slice(0, 7);
}

export function mesAnterior(mes: string, passos = 1): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 - passos, 1));
  return d.toISOString().slice(0, 7);
}

export function rotuloMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  const nome = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", timeZone: "UTC" });
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)}/${a}`;
}

const num = (v: unknown) => (v == null ? null : Number(v));

const NUMS_REGRA = ["valor_exp_geral", "valor_exp_peru", "valor_exp_amazonia", "valor_pacote", "valor_outros", "pct_lucro", "valor_cotacao"] as const;

export async function carregarMes(mes: string): Promise<DadosDoMes> {
  const [ini, fim] = limitesDoMes(mes);
  const [v, r, a, f, s, c] = await Promise.all([
    supabase.from("fin_com_vendas").select("*")
      .or([
        `and(data_venda.gte.${ini},data_venda.lt.${fim})`,
        `and(data_reuniao_realizada.gte.${ini},data_reuniao_realizada.lt.${fim})`,
        `and(data_quando_agendou.gte.${ini},data_quando_agendou.lt.${fim})`,
      ].join(","))
      .limit(5000),
    supabase.from("fin_com_regras").select("*").order("vigente_desde", { ascending: false }),
    supabase.from("fin_com_ajustes").select("*").eq("mes", mes).order("criado_em"),
    supabase.from("fin_com_fechamentos").select("*").eq("mes", mes).order("fechado_em"),
    supabase.from("fin_com_sync").select("rodou_em,cards,erro").eq("id", 1).maybeSingle(),
    supabase.rpc("fin_com_cotacoes", { p_ini: ini, p_fim: fim }),
  ]);
  const erro = v.error || r.error || a.error || f.error;
  if (erro) throw new Error(erro.message);
  const vendas: VendaCard[] = (v.data ?? []).map((x) => ({ ...x, total: num(x.total), custo: num(x.custo) })) as VendaCard[];
  const regras: Regra[] = (r.data ?? []).map((x) => {
    const regra = { ...x } as Record<string, unknown>;
    for (const k of NUMS_REGRA) regra[k] = num(x[k]);
    return regra as unknown as Regra;
  });
  const ajustes: Ajuste[] = (a.data ?? []).map((x) => ({ ...x, valor: num(x.valor) })) as Ajuste[];
  const todos = (f.data ?? []).map((x) => ({ ...x, total: Number(x.total) })) as Fechamento[];
  // Lucros digitados dos cards do mês (em lotes, a URL não aguenta 1000 ids).
  const lucros: Record<string, LucroDigitado> = {};
  const ids = vendas.map((x) => x.bitrix_id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("fin_com_lucros").select("*").in("bitrix_id", ids.slice(i, i + 200));
    if (error) break;   // banco sem a 0328: segue sem lucro
    for (const l of data ?? []) lucros[l.bitrix_id] = { ...l, lucro: Number(l.lucro) } as LucroDigitado;
  }
  const cotacoes = (c.error ? [] : (c.data ?? [])) as Cotacao[];
  const lucroPorCard = Object.fromEntries(Object.values(lucros).map((l) => [l.bitrix_id, l.lucro]));
  return {
    linhas: linhasDoMes(vendas, regras, ajustes, mes, { lucros: lucroPorCard, cotacoes }),
    regras, ajustes,
    fechamentos: todos.filter((x) => x.status !== "reaberto"),
    historico: todos.filter((x) => x.status === "reaberto"),
    sync: (s.data as EstadoSync | null) ?? null,
    lucros,
  };
}

/** Lucro do card digitado pelo Financeiro (base do % de pacote/aéreo/demais). `null` apaga. */
export async function salvarLucro(bitrixId: string, lucro: number | null, obs: string | null) {
  const q = lucro == null
    ? supabase.from("fin_com_lucros").delete().eq("bitrix_id", bitrixId)
    : supabase.from("fin_com_lucros").upsert({ bitrix_id: bitrixId, lucro, obs }, { onConflict: "bitrix_id" });
  const { error } = await q;
  if (error) throw new Error(error.message);
}

/** Histórico de ajustes de um card (o financeiro vê quem mudou e por quê). */
export async function historicoDoCard(bitrixId: string, pessoaId: string, papel: Papel): Promise<Ajuste[]> {
  const { data, error } = await supabase.from("fin_com_ajustes").select("*")
    .eq("bitrix_id", bitrixId).eq("pessoa_id", pessoaId).eq("papel", papel).order("criado_em", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Ajuste[];
}

export async function ajustarCard(a: { bitrix_id: string; pessoa_id: string; papel: Papel; mes: string; tipo: Ajuste["tipo"]; valor: number | null; motivo: string }) {
  const { error } = await supabase.from("fin_com_ajustes").insert(a);
  if (error) throw new Error(error.message);
}

export async function fecharMes(pessoaId: string, papel: Papel, mes: string, itens: Linha[]) {
  const total = Math.round(itens.reduce((s, l) => s + l.comissao, 0) * 100) / 100;
  const { error } = await supabase.from("fin_com_fechamentos").insert({ pessoa_id: pessoaId, papel, mes, total, cards: itens.length, itens });
  if (error) throw new Error(error.code === "23505" ? "Este mês já estava fechado." : error.message);
}

export async function marcarPago(id: string, pagoEm: string) {
  const { error } = await supabase.from("fin_com_fechamentos").update({ status: "pago", pago_em: pagoEm }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function desfazerPago(id: string) {
  const { error } = await supabase.from("fin_com_fechamentos").update({ status: "fechado" }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function reabrir(id: string, motivo: string) {
  const { error } = await supabase.from("fin_com_fechamentos").update({ status: "reaberto", motivo_reabertura: motivo }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function salvarRegra(r: Omit<Regra, "id"> & { id?: string; obs?: string | null }) {
  const corpo = {
    papel: r.papel, pessoa_id: r.pessoa_id, vigente_desde: r.vigente_desde, obs: r.obs ?? null,
    valor_exp_geral: r.valor_exp_geral ?? null, valor_exp_peru: r.valor_exp_peru ?? null, valor_exp_amazonia: r.valor_exp_amazonia ?? null,
    valor_pacote: r.valor_pacote ?? null, valor_outros: r.valor_outros ?? null, pct_lucro: r.pct_lucro ?? null, valor_cotacao: r.valor_cotacao ?? null,
    faixas_rr: r.faixas_rr?.length ? r.faixas_rr : null, bonus_dia: r.bonus_dia?.length ? r.bonus_dia : null,
  };
  const q = r.id ? supabase.from("fin_com_regras").update(corpo).eq("id", r.id) : supabase.from("fin_com_regras").insert(corpo);
  const { error } = await q;
  if (error) throw new Error(error.code === "23505" ? "Já existe uma regra com essa vigência para esse papel/pessoa. Edite a existente." : error.message);
}

export async function apagarRegra(id: string) {
  const { error } = await supabase.from("fin_com_regras").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listarApelidos(): Promise<Apelido[]> {
  const { data, error } = await supabase.from("fin_com_apelidos").select("nome_norm,nome_bitrix,pessoa_id").order("nome_bitrix");
  if (error) throw new Error(error.message);
  return (data ?? []) as Apelido[];
}

/** Mesma normalização da fin_com_norm (0327): sem sufixo de cargo, sem acento, minúsculo. */
export function normalizarNome(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s*-\s*(sdr|closer|especialista|coordenador|coordenadora)\s*$/i, "")
    .trim().toLowerCase().replace(/\s+/g, " ");
}

export async function salvarApelido(nomeBitrix: string, pessoaId: string) {
  const { error } = await supabase.from("fin_com_apelidos")
    .upsert({ nome_norm: normalizarNome(nomeBitrix), nome_bitrix: nomeBitrix.trim(), pessoa_id: pessoaId }, { onConflict: "nome_norm" });
  if (error) throw new Error(error.message);
}

export async function apagarApelido(nomeNorm: string) {
  const { error } = await supabase.from("fin_com_apelidos").delete().eq("nome_norm", nomeNorm);
  if (error) throw new Error(error.message);
}

/** Botão "Atualizar agora": roda a cópia do Dashboard na hora (api/fin-comissoes). */
export async function atualizarAgora(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch("/api/fin-comissoes", { method: "POST", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `Falhou (${r.status})`);
  return `${j.cards} cards atualizados.`;
}

/** Baixa o CSV (com BOM, pro Excel abrir com acento). */
export function baixarCsv(nome: string, conteudo: string) {
  const blob = new Blob(["﻿" + conteudo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const linkBitrix = (id: string) => `https://agenciasetuforeuvou.bitrix24.com.br/crm/deal/details/${id}/`;
