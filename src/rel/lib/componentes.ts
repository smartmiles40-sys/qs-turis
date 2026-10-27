// src/rel/lib/componentes.ts
// -----------------------------------------------------------------------------
// A VIAGEM COMO SOMA DE COMPONENTES (0208 + contrato docs/CONTRATO-VENDA-ITENS.md).
//
//   Venda (closer) → itens por tipo (qs_venda_itens, 0207) → Viagem (Rel) → app
//
// Cada componente é um item da venda (aéreo, hotel, seguro, passeio…), um trecho
// que o Rel/IA já cadastrou (rel_viagem_trechos) ou a expedição ligada. Os
// RÓTULOS dos campos vêm do catálogo único `TIPOS` (src/propostas/lib.ts) — nada
// de catálogo paralelo aqui.
//
// O Rel só muda o que o contrato deixa: status (vendido/emitido/cancelado), dados
// (localizador, voucher…) e a viagem; e lança item avulso. Tudo por RPC (0208).
//
// Antes da 0207/0208: a view não existe → lê os trechos e a expedição direto e a
// tela avisa que os itens da venda chegam com a atualização do banco.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { ORDEM_TIPOS, TIPOS, type TipoInfo, type TipoItem } from "@/propostas/lib";
import { FALTA_0208, faltaMigration } from "./faxina";
import type { Passageiro, Viagem } from "./viagens";
import { hojeSP } from "./viagens";

export type FonteComponente = "venda" | "trecho" | "expedicao";
export type StatusItem = "vendido" | "emitido" | "cancelado";

export interface Componente {
  fonte: FonteComponente;
  id: string;
  viagem_id: string;
  tipo: string;
  nome: string;
  data_inicio: string | null;
  data_fim: string | null;
  status: StatusItem | null;
  dados: Record<string, unknown>;
  passageiros: unknown[];
  fornecedor: string | null;
  valor: number | null;
  negocio_id: string | null;
  ordem: number;
  atualizado_em: string | null;
}

export const STATUS_ITEM: Record<StatusItem, string> = { vendido: "A emitir", emitido: "Emitido", cancelado: "Cancelado" };

// Até a frente Venda acrescentar `expedicao` e `concierge` no TIPOS (contrato),
// só o NOME desses dois fica aqui — sem campos: os campos são do catálogo.
const NOME_PROVISORIO: Record<string, [string, string]> = {
  expedicao: ["Expedição", "🧭"],
  concierge: ["Concierge", "🛎️"],
};

/** O tipo no catálogo; tipo que o catálogo ainda não tem vira um cartão genérico. */
export function infoDoTipo(tipo: string): TipoInfo {
  const t = (TIPOS as Record<string, TipoInfo | undefined>)[tipo];
  if (t) return t;
  const [rotulo, emoji] = NOME_PROVISORIO[tipo] ?? [tipo ? tipo[0].toUpperCase() + tipo.slice(1) : "Outro", "📌"];
  return { rotulo, emoji, datas: ["Início", "Fim"], campos: [], exemploNome: "" };
}

/** Ordem dos cartões: expedição, depois a ordem do catálogo, depois o que sobrar. */
export function ordemDosTipos(presentes: string[]): string[] {
  const base = ["expedicao", ...ORDEM_TIPOS.filter((t) => (t as string) !== "expedicao")] as string[];
  const extra = presentes.filter((t) => !base.includes(t));
  return [...base.filter((t) => presentes.includes(t)), ...extra];
}

/** Tipos que o Rel pode lançar à mão (o catálogo inteiro). */
export const TIPOS_LANCAVEIS: TipoItem[] = ORDEM_TIPOS;

// ── Carregar ────────────────────────────────────────────────────────────────

export interface ComponentesDaViagem {
  itens: Componente[];
  /** false = a 0207/0208 ainda não está no banco: só trechos e expedição. */
  comItensDaVenda: boolean;
}

type Linha = Record<string, unknown>;
const txt = (x: unknown) => (x == null || x === "" ? null : String(x));
const diaSP = (iso: unknown) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(String(iso))) : null);
const tipoDoTrecho = (t: string) => (t === "voo_internacional" || t === "voo_interno" ? "aereo" : ["hospedagem", "trem", "transfer", "passeio"].includes(t) ? t : "outro");

function trechoParaComponente(t: Linha): Componente {
  const de = txt(t.origem_codigo) ?? txt(t.origem);
  const para = txt(t.destino_codigo) ?? txt(t.destino);
  const dados: Record<string, unknown> = { trecho_tipo: t.tipo };
  for (const k of ["origem", "destino", "origem_codigo", "destino_codigo", "partida_em", "chegada_em", "partida_fuso", "chegada_fuso", "companhia", "numero",
    "localizador", "classe", "bagagem", "assento", "numero_bilhete", "ponto_encontro", "contato", "endereco", "observacoes", "documento_id", "checkin_feito_em", "fonte"]) {
    if (t[k] != null && t[k] !== "") dados[k] = t[k];
  }
  return {
    fonte: "trecho", id: String(t.id), viagem_id: String(t.viagem_id), tipo: tipoDoTrecho(String(t.tipo)),
    nome: txt(t.descricao)?.trim() || [de, para].filter(Boolean).join(" → ") || String(t.tipo),
    data_inicio: diaSP(t.partida_em), data_fim: diaSP(t.chegada_em), status: null, dados,
    passageiros: Array.isArray(t.passageiros) ? t.passageiros : [], fornecedor: null, valor: null, negocio_id: null, ordem: 0,
    atualizado_em: txt(t.criado_em),
  };
}

/** Sem a 0208: trechos + expedição direto; e os itens da venda, se a 0207 já existir. */
async function carregarSemView(viagemId: string): Promise<ComponentesDaViagem> {
  const [tr, vi, it] = await Promise.all([
    supabase.from("rel_viagem_trechos").select("*").eq("viagem_id", viagemId),
    supabase.from("rel_viagens").select("expedicoes_id").eq("id", viagemId).maybeSingle(),
    supabase.from("qs_venda_itens").select("id, viagem_id, tipo, nome, data_inicio, data_fim, status, dados, passageiros, fornecedor, valor, negocio_id, ordem, atualizado_em").eq("viagem_id", viagemId),
  ]);
  if (tr.error) throw tr.error;
  const itens: Componente[] = ((tr.data ?? []) as Linha[]).map(trechoParaComponente);
  const expId = (vi.data as { expedicoes_id: string | null } | null)?.expedicoes_id;
  if (expId) {
    const { data: e } = await supabase.from("expedicoes").select("id, nome, codigo, tipo, status, data_embarque, data_retorno, updated_at").eq("id", expId).maybeSingle();
    if (e) {
      const x = e as Linha;
      itens.push({
        fonte: "expedicao", id: String(x.id), viagem_id: viagemId, tipo: "expedicao", nome: String(x.nome ?? "Expedição"),
        data_inicio: txt(x.data_embarque), data_fim: txt(x.data_retorno), status: null,
        dados: { expedicoes_id: x.id, codigo: x.codigo, tipo: x.tipo, status: x.status }, passageiros: [], fornecedor: null, valor: null,
        negocio_id: null, ordem: -1, atualizado_em: txt(x.updated_at),
      });
    }
  }
  const comItens = !it.error;
  if (comItens) for (const r of (it.data ?? []) as Linha[]) itens.push({ ...(r as unknown as Componente), fonte: "venda", dados: (r.dados as Record<string, unknown>) ?? {}, passageiros: (r.passageiros as unknown[]) ?? [] });
  return { itens, comItensDaVenda: comItens };
}

export async function carregarComponentes(viagemId: string): Promise<ComponentesDaViagem> {
  const { data, error } = await supabase.from("rel_viagem_componentes").select("*").eq("viagem_id", viagemId);
  if (error) {
    if (faltaMigration(error)) return carregarSemView(viagemId);
    throw error;
  }
  const itens = ((data ?? []) as Componente[]).map((c) => ({ ...c, dados: c.dados ?? {}, passageiros: c.passageiros ?? [] }));
  return { itens, comItensDaVenda: true };
}

// ── O Rel mexe nos itens (RPC da 0208) ─────────────────────────────────────

function erroItem(e: { message?: string; code?: string }): Error {
  if (faltaMigration(e)) return new Error(FALTA_0208);
  if (/row-level|permission/i.test(e.message ?? "")) return new Error("Sem permissão para isso.");
  return new Error(e.message || "Não salvou.");
}

/** Muda status e/ou completa os dados (chave com null apaga). */
export async function salvarItem(id: string, mud: { status?: StatusItem; dados?: Record<string, unknown> }) {
  const { error } = await supabase.rpc("rel_item_atualizar", { p_id: id, p_status: mud.status ?? null, p_dados: mud.dados ?? null, p_viagem_id: null });
  if (error) throw erroItem(error);
}

export async function lancarItemAvulso(viagemId: string, item: {
  tipo: string; nome: string; data_inicio: string | null; data_fim: string | null; dados: Record<string, unknown>; fornecedor: string | null; status: StatusItem;
}): Promise<string> {
  const { data, error } = await supabase.rpc("rel_item_avulso", {
    p_viagem: viagemId, p_tipo: item.tipo, p_nome: item.nome, p_inicio: item.data_inicio, p_fim: item.data_fim,
    p_dados: item.dados, p_fornecedor: item.fornecedor, p_status: item.status,
  });
  if (error) throw erroItem(error);
  return String(data);
}

// ── Pagamento e documentos ──────────────────────────────────────────────────

export interface ResumoPagamento { planos: number; total: number; pago: number; em_aberto: number; atrasado: number; parcelas_atrasadas: number; proximo_vencimento: string | null }

/** null = não deu pra saber (sem a 0208 ou sem acesso). */
export async function pagamentoDaViagem(viagemId: string): Promise<ResumoPagamento | null> {
  const { data, error } = await supabase.rpc("rel_viagem_pagamento", { p_viagem: viagemId });
  if (error) return null;
  const r = (Array.isArray(data) ? data[0] : data) as ResumoPagamento | undefined;
  if (!r) return null;
  return { ...r, total: Number(r.total), pago: Number(r.pago), em_aberto: Number(r.em_aberto), atrasado: Number(r.atrasado) };
}

export interface DocResumo { tipo: string; status: string; cliente_id: string }
export async function documentosDaViagem(viagemId: string): Promise<DocResumo[]> {
  const { data, error } = await supabase.from("rel_documentos").select("tipo, status, cliente_id").eq("viagem_id", viagemId).limit(500);
  if (error) return [];
  return (data ?? []) as DocResumo[];
}

// ── O que falta ─────────────────────────────────────────────────────────────

export type TomFalta = "danger" | "warn" | "info";
export interface Falta { chave: string; tom: TomFalta; texto: string; grupo: "venda" | "documento" | "pagamento" | "emissao" | "operacao" }

/** Precisa de emissão/confirmação do fornecedor (o resto não tem o que emitir). */
const EMITE = new Set(["aereo", "hospedagem", "transfer", "trem", "passeio", "seguro", "carro", "cruzeiro", "pacote", "visto"]);

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Tudo o que falta pra viagem estar redonda — a mais grave primeiro. Função pura. */
export function oQueFalta(v: Viagem, comps: Componente[], pass: Passageiro[], pag: ResumoPagamento | null, docs: DocResumo[], hoje = hojeSP()): Falta[] {
  const f: Falta[] = [];
  const futura = v.fase === "antes" || v.fase === "em_viagem" || v.fase === "sem_data";
  if (v.status !== "ativa" || !futura) return f;
  const opera = v.acompanhamento === "completo" || v.acompanhamento === "leve";

  // venda
  if (v.acompanhamento === "classificar") f.push({ chave: "servico", tom: "warn", grupo: "venda", texto: "Falta dizer o que foi vendido (serviço)" });
  if (!v.data_embarque) f.push({ chave: "data", tom: "warn", grupo: "venda", texto: "Sem data de embarque" });
  if (!v.cliente_id) f.push({ chave: "cliente", tom: "danger", grupo: "venda", texto: "Sem cliente ligado (ficha)" });
  if (/CONFERIR: possível viagem repetida/i.test(v.observacoes ?? "")) f.push({ chave: "repetida", tom: "warn", grupo: "venda", texto: "Pode ser venda repetida — conferir" });
  if (opera && !v.responsavel_id) f.push({ chave: "dono", tom: (v.dias_para_embarque ?? 999) <= 30 ? "danger" : "warn", grupo: "operacao", texto: "Ninguém do Rel cuida desta viagem" });

  // emissão
  const vivos = comps.filter((c) => c.status !== "cancelado");
  const aEmitir = vivos.filter((c) => c.fonte === "venda" && c.status === "vendido" && EMITE.has(c.tipo));
  if (aEmitir.length) {
    const perto = (v.dias_para_embarque ?? 999) <= 15;
    f.push({ chave: "emitir", tom: perto ? "danger" : "warn", grupo: "emissao", texto: `${aEmitir.length} ${aEmitir.length === 1 ? "item a emitir" : "itens a emitir"}: ${aEmitir.slice(0, 3).map((c) => c.nome).join(", ")}${aEmitir.length > 3 ? "…" : ""}` });
  }
  const voos = vivos.filter((c) => c.tipo === "aereo" && c.fonte === "trecho");
  const semLoc = voos.filter((c) => !c.dados.localizador && (c.data_inicio ?? "9999") >= hoje);
  if (semLoc.length) f.push({ chave: "localizador", tom: "warn", grupo: "emissao", texto: `${semLoc.length} voo${semLoc.length > 1 ? "s" : ""} sem localizador` });
  const temAereoVendido = vivos.some((c) => c.tipo === "aereo") || v.servico === "aereo" || v.servico === "pacote";
  if (temAereoVendido && !voos.length && v.servico !== "expedicao") f.push({ chave: "sem_voo", tom: "info", grupo: "emissao", texto: "Nenhum voo cadastrado no roteiro" });

  // documentos
  const volta = v.data_retorno || v.data_embarque;
  const seisMeses = volta ? (() => { const d = new Date(volta + "T12:00:00"); d.setMonth(d.getMonth() + 6); return d.toISOString().slice(0, 10); })() : null;
  for (const p of pass) {
    const c = p.cliente;
    if (!c) continue;
    if (!c.passaporte) f.push({ chave: `pp-${c.id}`, tom: "warn", grupo: "documento", texto: `${c.nome.split(" ")[0]}: sem passaporte na ficha` });
    else if (c.passaporte_validade && seisMeses && c.passaporte_validade < seisMeses) f.push({ chave: `pp6-${c.id}`, tom: "danger", grupo: "documento", texto: `${c.nome.split(" ")[0]}: passaporte vence antes de 6 meses da volta` });
  }
  if (v.qtd_passageiros && pass.length < v.qtd_passageiros) f.push({ chave: "pax", tom: "warn", grupo: "documento", texto: `${v.qtd_passageiros - pass.length} passageiro${v.qtd_passageiros - pass.length > 1 ? "s" : ""} sem ficha (vendidos ${v.qtd_passageiros})` });
  const recusados = docs.filter((d) => d.status === "recusado").length;
  if (recusados) f.push({ chave: "docs_recusados", tom: "warn", grupo: "documento", texto: `${recusados} documento${recusados > 1 ? "s" : ""} recusado${recusados > 1 ? "s" : ""}` });
  const aConferir = docs.filter((d) => d.status === "recebido").length;
  if (aConferir) f.push({ chave: "docs_conferir", tom: "info", grupo: "documento", texto: `${aConferir} documento${aConferir > 1 ? "s" : ""} pra conferir` });
  const temSeguro = vivos.some((c) => c.tipo === "seguro") || docs.some((d) => d.tipo === "seguro");
  if (opera && !temSeguro && v.servico !== "seguro") f.push({ chave: "seguro", tom: "info", grupo: "documento", texto: "Sem seguro viagem registrado" });

  // pagamento
  if (pag) {
    if (pag.atrasado > 0) f.push({ chave: "pag_atraso", tom: "danger", grupo: "pagamento", texto: `${brl(pag.atrasado)} em atraso (${pag.parcelas_atrasadas} parcela${pag.parcelas_atrasadas > 1 ? "s" : ""})` });
    else if (pag.em_aberto > 0) f.push({ chave: "pag_aberto", tom: "info", grupo: "pagamento", texto: `Falta receber ${brl(pag.em_aberto)}${pag.proximo_vencimento ? ` · próxima em ${pag.proximo_vencimento.split("-").reverse().join("/")}` : ""}` });
  }

  const peso: Record<TomFalta, number> = { danger: 0, warn: 1, info: 2 };
  return f.sort((a, b) => peso[a.tom] - peso[b.tom]);
}

/** As próximas datas da viagem (componentes, embarque, volta, vencimento). */
export function proximasDatas(v: Viagem, comps: Componente[], pag: ResumoPagamento | null, hoje = hojeSP()): { data: string; texto: string }[] {
  const l: { data: string; texto: string }[] = [];
  if (v.data_embarque && v.data_embarque >= hoje) l.push({ data: v.data_embarque, texto: "Embarque" });
  if (v.data_retorno && v.data_retorno >= hoje) l.push({ data: v.data_retorno, texto: "Volta" });
  for (const c of comps) {
    if (c.status === "cancelado" || !c.data_inicio || c.data_inicio < hoje || c.tipo === "expedicao") continue;
    l.push({ data: c.data_inicio, texto: `${infoDoTipo(c.tipo).emoji} ${c.nome}` });
  }
  if (pag?.proximo_vencimento) l.push({ data: pag.proximo_vencimento, texto: "💳 Vencimento de parcela" });
  return l.sort((a, b) => a.data.localeCompare(b.data)).slice(0, 5);
}
