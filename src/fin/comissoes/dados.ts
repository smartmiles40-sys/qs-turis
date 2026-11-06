// src/fin/comissoes/dados.ts
// -----------------------------------------------------------------------------
// Leitura e escrita das comissões (0327). A conta é em ./calculo (pura).
// Quem lê o quê é o banco que decide (RLS): o vendedor só recebe os cards, os
// ajustes, as exceções de regra e os fechamentos DELE; o financeiro recebe tudo.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { linhasDoMes, type Ajuste, type Linha, type Papel, type Regra, type VendaCard } from "./calculo";

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
}

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

export async function carregarMes(mes: string): Promise<DadosDoMes> {
  const [ini, fim] = limitesDoMes(mes);
  const [v, r, a, f, s] = await Promise.all([
    supabase.from("fin_com_vendas").select("*")
      .or(`and(data_venda.gte.${ini},data_venda.lt.${fim}),and(data_reuniao_realizada.gte.${ini},data_reuniao_realizada.lt.${fim})`)
      .limit(5000),
    supabase.from("fin_com_regras").select("*").order("vigente_desde", { ascending: false }),
    supabase.from("fin_com_ajustes").select("*").eq("mes", mes).order("criado_em"),
    supabase.from("fin_com_fechamentos").select("*").eq("mes", mes).order("fechado_em"),
    supabase.from("fin_com_sync").select("rodou_em,cards,erro").eq("id", 1).maybeSingle(),
  ]);
  const erro = v.error || r.error || a.error || f.error;
  if (erro) throw new Error(erro.message);
  const vendas: VendaCard[] = (v.data ?? []).map((x) => ({ ...x, total: num(x.total) })) as VendaCard[];
  const regras: Regra[] = (r.data ?? []).map((x) => ({
    ...x, valor_rr: num(x.valor_rr), valor_expedicao: num(x.valor_expedicao), pct_aereo: num(x.pct_aereo), pct_pacote: num(x.pct_pacote),
  })) as Regra[];
  const ajustes: Ajuste[] = (a.data ?? []).map((x) => ({ ...x, valor: num(x.valor) })) as Ajuste[];
  const todos = (f.data ?? []).map((x) => ({ ...x, total: Number(x.total) })) as Fechamento[];
  return {
    linhas: linhasDoMes(vendas, regras, ajustes, mes),
    regras, ajustes,
    fechamentos: todos.filter((x) => x.status !== "reaberto"),
    historico: todos.filter((x) => x.status === "reaberto"),
    sync: (s.data as EstadoSync | null) ?? null,
  };
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
  const corpo = { papel: r.papel, pessoa_id: r.pessoa_id, vigente_desde: r.vigente_desde, valor_rr: r.valor_rr, valor_expedicao: r.valor_expedicao, pct_aereo: r.pct_aereo, pct_pacote: r.pct_pacote, obs: r.obs ?? null };
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
