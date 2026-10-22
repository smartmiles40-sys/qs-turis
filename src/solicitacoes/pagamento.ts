// src/solicitacoes/pagamento.ts
// -----------------------------------------------------------------------------
// PEDIDOS DE PAGAMENTO AO FINANCEIRO (0201, Bruno 22/10/2026): "o financeiro
// consiga ter uma visualização fácil e também que quem está solicitando consiga
// fazer isso atrelado a algum cliente ou especifique para o que está subindo a
// solicitação, já amarrando tudo".
//
// São tipos da Central de Solicitações (formulario = 'pagamento'), igual à
// cotação (cotacao.ts):
//
//   fin_fornecedor      → Pix para fornecedor
//   fin_link_pagamento  → Link de pagamento para o cliente (o mesmo do closer, 0181)
//   fin_cartao          → Pagamento no cartão da empresa (assento, emissão, taxa…)
//   fin_provisao        → Provisionar pagamento (conta futura → parcelas "a pagar")
//
// Amarração obrigatória (a tela E o banco conferem — fin_pag_falta):
//   cliente/venda (ou lead) · expedição · ou "para que é" (categoria + texto).
//
// O Financeiro resolve com fin_pag_acao (colar link · marcar pago com
// comprovante · provisionar) — isso CONCLUI a solicitação pela Central, então
// quem pediu recebe o aviso de sempre (0196).
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { Solicitacao } from "./lib";

export type TipoPag = "pix" | "link" | "cartao" | "provisao";
export type Moeda = "BRL" | "USD" | "EUR" | "GBP" | "CLP" | "ARS" | "JPY";
export type Vinculo = "cliente" | "expedicao" | "finalidade";
export type Frequencia = "mensal" | "quinzenal" | "semanal";

/** Qual formulário cada tipo da Central usa (igual a fin_pag_tipo_do no banco). */
export const TIPO_PAG_DO: Record<string, TipoPag> = {
  fin_fornecedor: "pix", fin_link_pagamento: "link", fin_cartao: "cartao", fin_provisao: "provisao",
};
export const TIPOS_PAGAMENTO = Object.keys(TIPO_PAG_DO);
export const NOME_TIPO_PAG: Record<TipoPag, string> = {
  pix: "Pix para fornecedor", link: "Link de pagamento", cartao: "Cartão da empresa", provisao: "Provisão",
};
export const MOEDAS: [Moeda, string][] = [
  ["BRL", "Real (R$)"], ["USD", "Dólar (US$)"], ["EUR", "Euro (€)"], ["GBP", "Libra (£)"], ["CLP", "Peso chileno"], ["ARS", "Peso argentino"], ["JPY", "Iene"],
];
export const FINALIDADES: [string, string][] = [
  ["fornecedor_expedicao", "Fornecedor de expedição"], ["operacional", "Operacional interno"], ["marketing", "Marketing"], ["outro", "Outro"],
];
export const NOME_FINALIDADE = Object.fromEntries(FINALIDADES) as Record<string, string>;
export const O_QUE_CARTAO = ["Assento", "Emissão", "Taxa", "Bagagem", "Hospedagem", "Outro"];
export const FREQUENCIAS: [Frequencia, string][] = [["mensal", "Todo mês"], ["quinzenal", "A cada 15 dias"], ["semanal", "Toda semana"]];

/** O formulário (na tela os números ficam em texto; no banco vão como número). */
export interface FormPagamento {
  v: 1;
  tipo: TipoPag;
  valor: string;
  moeda: Moeda;
  // Pix
  favorecido: string;
  documento: string;
  chave_pix: string;
  data_limite: string; // Pix e cartão
  // Link
  parcelas_max: string;
  vencimento: string; // link (opcional) e provisão (1º vencimento)
  descricao_cliente: string;
  // Cartão
  o_que: string;
  o_que_texto: string;
  fornecedor: string; // cartão e provisão
  // Provisão
  parcelas: string;
  frequencia: Frequencia;
  para_que: string; // Pix e provisão
  // Amarração
  vinculo: Vinculo;
  expedicao_id: string;
  expedicao_nome: string;
  finalidade: string;
  finalidade_texto: string;
  obs: string;
}

export function pagamentoVazio(tipo: TipoPag): FormPagamento {
  return {
    v: 1, tipo, valor: "", moeda: "BRL",
    favorecido: "", documento: "", chave_pix: "", data_limite: "",
    parcelas_max: "1", vencimento: "", descricao_cliente: "",
    o_que: "", o_que_texto: "", fornecedor: "",
    parcelas: "1", frequencia: "mensal", para_que: "",
    vinculo: "cliente", expedicao_id: "", expedicao_nome: "", finalidade: "", finalidade_texto: "", obs: "",
  };
}

/** Lê o jsonb do banco sem quebrar se faltar campo (e com os números em texto). */
export function lerPagamento(x: unknown): FormPagamento | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const tipo = o.tipo as TipoPag;
  if (!NOME_TIPO_PAG[tipo]) return null;
  const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const base = pagamentoVazio(tipo);
  const f = { ...base } as unknown as Record<string, unknown>;
  for (const k of Object.keys(base)) if (k in o && o[k] !== null && o[k] !== undefined) f[k] = typeof (base as unknown as Record<string, unknown>)[k] === "string" ? txt(o[k]) : o[k];
  return f as unknown as FormPagamento;
}

const numero = (s: string) => {
  const t = s.trim().replace(/\s/g, "");
  // aceita "1.234,56", "1234,56" e "1234.56"
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(n) ? n : NaN;
};
export const valorDe = (f: Pick<FormPagamento, "valor">) => numero(f.valor);

/** O que vai pro banco (só os campos do tipo + amarração). */
export function paraBanco(f: FormPagamento): Record<string, unknown> {
  const o: Record<string, unknown> = { v: 1, tipo: f.tipo, valor: Math.round(valorDe(f) * 100) / 100, moeda: f.tipo === "pix" ? "BRL" : f.moeda };
  const t = (s: string) => s.trim();
  if (f.tipo === "pix") Object.assign(o, { favorecido: t(f.favorecido), documento: f.documento.replace(/\D/g, ""), chave_pix: t(f.chave_pix), data_limite: f.data_limite, para_que: t(f.para_que) });
  if (f.tipo === "link") Object.assign(o, { parcelas_max: Number(f.parcelas_max) || 1, vencimento: f.vencimento || null, descricao_cliente: t(f.descricao_cliente) });
  if (f.tipo === "cartao") Object.assign(o, { o_que: t(f.o_que), o_que_texto: t(f.o_que_texto), fornecedor: t(f.fornecedor), data_limite: f.data_limite });
  if (f.tipo === "provisao") {
    const n = Number(f.parcelas) || 1;
    Object.assign(o, { fornecedor: t(f.fornecedor), vencimento: f.vencimento, parcelas: n, frequencia: n > 1 ? f.frequencia : null, para_que: t(f.para_que) });
  }
  o.vinculo = f.vinculo;
  if (f.vinculo === "expedicao") Object.assign(o, { expedicao_id: f.expedicao_id, expedicao_nome: f.expedicao_nome });
  if (f.vinculo === "finalidade") Object.assign(o, { finalidade: f.finalidade, finalidade_texto: t(f.finalidade_texto) });
  if (t(f.obs)) o.obs = t(f.obs);
  return o;
}

/** Primeiro problema (ou null se dá pra enviar). `temCliente` = escolheu cliente/venda ou veio de um lead. */
export function faltaNoPagamento(f: FormPagamento, temCliente: boolean): string | null {
  const v = valorDe(f);
  if (!f.valor.trim() || !(v > 0)) return "Diga o valor (maior que zero).";
  if (f.tipo === "pix") {
    if (!f.favorecido.trim()) return "Escreva o nome de quem recebe (favorecido).";
    const d = f.documento.replace(/\D/g, "");
    if (d.length !== 11 && d.length !== 14) return "CPF (11 números) ou CNPJ (14 números) de quem recebe.";
    if (!f.chave_pix.trim()) return "Escreva a chave Pix.";
    if (!f.data_limite) return "Escolha até quando precisa ser pago.";
    if (!f.para_que.trim()) return "Diga para que é o pagamento.";
  }
  if (f.tipo === "link") {
    const n = Number(f.parcelas_max);
    if (!Number.isInteger(n) || n < 1 || n > 48) return "Parcelas: de 1 a 48.";
    if (!f.descricao_cliente.trim()) return "Escreva a descrição que aparece pro cliente.";
  }
  if (f.tipo === "cartao") {
    if (!f.o_que) return "Diga o que vai ser comprado.";
    if (f.o_que === "Outro" && !f.o_que_texto.trim()) return "Explique o que vai ser comprado.";
    if (!f.fornecedor.trim()) return "Diga onde comprar (fornecedor ou site).";
    if (!f.data_limite) return "Escolha até quando precisa ser pago.";
  }
  if (f.tipo === "provisao") {
    if (!f.fornecedor.trim()) return "Diga o fornecedor (quem vai receber).";
    if (!f.vencimento) return "Escolha o (1º) vencimento.";
    const n = Number(f.parcelas);
    if (!Number.isInteger(n) || n < 1 || n > 60) return "Parcelas: de 1 a 60.";
    if (!f.para_que.trim()) return "Diga para que é o pagamento.";
  }
  if (f.vinculo === "cliente" && !temCliente) return "Escolha o cliente (ou amarre a uma expedição, ou diga para que é).";
  if (f.vinculo === "expedicao" && !f.expedicao_id) return "Escolha a expedição.";
  if (f.vinculo === "finalidade") {
    if (!f.finalidade) return "Escolha para que é (categoria).";
    if (!f.finalidade_texto.trim()) return "Explique em uma frase para que é.";
  }
  return null;
}

// ── Textos ──────────────────────────────────────────────────────────────────

export function dinheiro(v: number | string | null | undefined, moeda: string | null | undefined = "BRL"): string {
  const n = typeof v === "string" ? numero(v) : Number(v ?? 0);
  try { return (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: moeda || "BRL" }); }
  catch { return `${moeda} ${(Number.isFinite(n) ? n : 0).toFixed(2)}`; }
}
export const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const dm = (iso: string) => (iso ? iso.slice(0, 10).split("-").reverse().slice(0, 2).join("/") : "");

/** A data que importa pro Financeiro: até quando pagar / vencimento. */
export function venceEm(f: Pick<FormPagamento, "tipo" | "data_limite" | "vencimento"> | null): string | null {
  if (!f) return null;
  if (f.tipo === "pix" || f.tipo === "cartao") return f.data_limite || null;
  return f.vencimento || null;
}

export function oQueCartao(f: FormPagamento) {
  return [f.o_que === "Outro" ? "" : f.o_que, f.o_que_texto.trim()].filter(Boolean).join(" — ") || f.o_que;
}

export function tituloDoPagamento(f: FormPagamento): string {
  const val = dinheiro(f.valor, f.tipo === "pix" ? "BRL" : f.moeda);
  let t = "";
  if (f.tipo === "pix") t = `Pix ${val} → ${f.favorecido.trim()} · até ${dm(f.data_limite)}`;
  if (f.tipo === "link") t = `Link de pagamento ${val}${Number(f.parcelas_max) > 1 ? ` em até ${f.parcelas_max}x` : ""} · ${f.descricao_cliente.trim()}`;
  if (f.tipo === "cartao") t = `Cartão ${val} · ${oQueCartao(f)} · ${f.fornecedor.trim()}`;
  if (f.tipo === "provisao") t = `Provisão ${Number(f.parcelas) > 1 ? `${f.parcelas}x ` : ""}${val} · ${f.fornecedor.trim()} · 1º venc. ${dm(f.vencimento)}`;
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

/** "Para que é" de um pedido sem cliente. */
export function textoFinalidade(f: Pick<FormPagamento, "finalidade" | "finalidade_texto">): string {
  return [NOME_FINALIDADE[f.finalidade] ?? "", f.finalidade_texto.trim()].filter(Boolean).join(": ");
}

/** As linhas "Rótulo: valor" (a tela e a descrição usam as mesmas). */
export function secoesDoPagamento(f: FormPagamento): { titulo: string; linhas: [string, string][] }[] {
  const moeda = f.tipo === "pix" ? "BRL" : f.moeda;
  const s: { titulo: string; linhas: [string, string][] }[] = [];
  if (f.tipo === "pix") s.push({ titulo: "Pix para fornecedor", linhas: [
    ["Valor", dinheiro(f.valor, "BRL")], ["Favorecido", f.favorecido.trim()], ["CPF/CNPJ", formatarDoc(f.documento)],
    ["Chave Pix", f.chave_pix.trim()], ["Pagar até", dataBr(f.data_limite)], ["Para que é", f.para_que.trim()],
  ] });
  if (f.tipo === "link") s.push({ titulo: "Link de pagamento para o cliente", linhas: [
    ["Valor", dinheiro(f.valor, moeda)], ["Parcelas (máx.)", Number(f.parcelas_max) > 1 ? `até ${f.parcelas_max}x` : "à vista"],
    ["Vencimento", dataBr(f.vencimento)], ["Descrição pro cliente", f.descricao_cliente.trim()],
  ] });
  if (f.tipo === "cartao") s.push({ titulo: "Pagamento no cartão da empresa", linhas: [
    ["O que comprar", oQueCartao(f)], ["Fornecedor / site", f.fornecedor.trim()], ["Valor", dinheiro(f.valor, moeda)], ["Pagar até", dataBr(f.data_limite)],
  ] });
  if (f.tipo === "provisao") {
    const n = Number(f.parcelas) || 1;
    s.push({ titulo: "Provisão (conta futura)", linhas: [
      ["Fornecedor", f.fornecedor.trim()], ["Valor", n > 1 ? `${n} parcelas de ${dinheiro(f.valor, moeda)} (total ${dinheiro(valorDe(f) * n, moeda)})` : dinheiro(f.valor, moeda)],
      [n > 1 ? "1º vencimento" : "Vencimento", dataBr(f.vencimento)],
      ["Frequência", n > 1 ? FREQUENCIAS.find((x) => x[0] === f.frequencia)?.[1] ?? f.frequencia : ""], ["Para que é", f.para_que.trim()],
    ] });
  }
  const amarra: [string, string][] = f.vinculo === "expedicao" ? [["Expedição", f.expedicao_nome]] : f.vinculo === "finalidade" ? [["Para que é", textoFinalidade(f)]] : [];
  if (amarra.length) s.push({ titulo: "Amarrado a", linhas: amarra });
  if (f.obs.trim()) s.push({ titulo: "Observações", linhas: [["", f.obs.trim()]] });
  return s.map((x) => ({ ...x, linhas: x.linhas.filter(([, v]) => !!v) })).filter((x) => x.linhas.length);
}

export function descricaoDoPagamento(f: FormPagamento): string {
  return secoesDoPagamento(f).map((s) => [`— ${s.titulo} —`, ...s.linhas.map(([r, v]) => (r ? `${r}: ${v}` : v))].join("\n")).join("\n\n");
}

export function formatarDoc(d: string): string {
  const n = d.replace(/\D/g, "");
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d;
}

// ── O lado do Financeiro (0201) ─────────────────────────────────────────────

export interface Pagamento extends Solicitacao {
  expedicao_id: string | null;
  pag_link: string | null;
  pag_pago_em: string | null;
  pag_pago_valor: number | null;
  pag_pago_moeda: string | null;
  pag_obs: string | null;
  pag_feito_em: string | null;
  pag_feito_por_nome: string | null;
  pag_anexos: number;
  pag_parcelas_abertas: number;
  pag_parcelas_pagas: number;
}

export interface ParcelaPag {
  id: string; solicitacao_id: string; numero: number; valor: number; moeda: string; vencimento: string;
  status: "a_pagar" | "pago" | "cancelado"; situacao: "a_pagar" | "atrasado" | "pago" | "cancelado";
  pago_em: string | null; pago_valor: number | null; obs: string | null; total_parcelas: number;
  sol_numero: number; titulo: string; sobre_nome: string | null; de_setor: string; cliente_id: string | null; viagem_id: string | null;
  expedicao_id: string | null; criado_por: string | null; criado_por_nome: string | null; formulario: unknown;
}

export interface AnexoPag { id: string; solicitacao_id: string; parcela_id: string | null; tipo: "documento" | "comprovante"; path: string; nome: string; criado_em: string }

/** O rótulo do status na linguagem do pagamento. */
export function rotuloPagamento(s: Pick<Pagamento, "status" | "aguardando_quem" | "tipo_id">): string {
  const k = TIPO_PAG_DO[s.tipo_id ?? ""];
  if (s.status === "nova") return "Novo — ninguém pegou";
  if (s.status === "aguardando") return s.aguardando_quem === "solicitante" ? "Aguardando ajuste de quem pediu" : "Aguardando";
  if (s.status === "em_andamento") return "Em andamento";
  if (s.status === "concluida") return k === "link" ? "Link enviado" : k === "provisao" ? "Provisionado" : "Pago";
  return ({ recusada: "Recusado", cancelada: "Cancelado" } as Record<string, string>)[s.status] ?? s.status;
}

/** Pedidos de pagamento do Financeiro: os abertos + os fechados dos últimos `dias`. */
export async function listarPagamentos(dias = 60): Promise<Pagamento[]> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const { data, error } = await supabase.from("fin_pagamentos_v").select("*").eq("para_setor", "financeiro")
    .or(`aberta.eq.true,concluido_em.gte."${desde}"`).order("criado_em", { ascending: true }).limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Pagamento[];
}

/** Parcelas das provisões: todas as a pagar + as pagas dos últimos `dias`. */
export async function listarParcelas(dias = 60): Promise<ParcelaPag[]> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from("fin_pag_parcelas_v").select("*")
    .or(`status.eq.a_pagar,pago_em.gte.${desde}`).order("vencimento").limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as ParcelaPag[];
}

/** O que o Financeiro já fez num pedido (pra mostrar a quem pediu). */
export async function carregarPagamento(solId: string) {
  const [p, x, a] = await Promise.all([
    supabase.from("fin_pagamentos").select("*").eq("solicitacao_id", solId).maybeSingle(),
    supabase.from("fin_pag_parcelas").select("*").eq("solicitacao_id", solId).order("numero"),
    supabase.from("fin_pag_anexos").select("*").eq("solicitacao_id", solId).order("criado_em"),
  ]);
  const e = p.error ?? x.error ?? a.error;
  if (e) throw new Error(e.message);
  return {
    feito: p.data as { link: string | null; pago_em: string | null; pago_valor: number | null; pago_moeda: string | null; obs: string | null; feito_em: string } | null,
    parcelas: (x.data ?? []) as Omit<ParcelaPag, "situacao" | "total_parcelas" | "sol_numero" | "titulo" | "sobre_nome" | "de_setor" | "cliente_id" | "viagem_id" | "expedicao_id" | "criado_por" | "criado_por_nome" | "formulario">[],
    anexos: (a.data ?? []) as AnexoPag[],
  };
}

export async function acaoPagamento(id: string, acao: "link" | "pago" | "provisionar", p: { link?: string; data?: string; valor?: number | null; obs?: string } = {}) {
  const { error } = await supabase.rpc("fin_pag_acao", {
    p_id: id, p_acao: acao, p_link: p.link ?? null, p_data: p.data || null, p_valor: p.valor ?? null, p_obs: p.obs || null,
  });
  if (error) throw new Error(error.message);
}

export async function acaoParcela(id: string, acao: "pago" | "desfazer" | "cancelar", p: { data?: string; valor?: number | null; obs?: string } = {}) {
  const { error } = await supabase.rpc("fin_pag_parcela", { p_id: id, p_acao: acao, p_data: p.data || null, p_valor: p.valor ?? null, p_obs: p.obs || null });
  if (error) throw new Error(error.message);
}

const BUCKET = "fin-pagamentos";
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" };
export const ACEITA_ARQUIVO = "application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif";

/** Sobe um arquivo pra pasta da solicitação e registra (boleto/nota/print ou comprovante). */
export async function anexarArquivo(solId: string, tipo: "documento" | "comprovante", arquivo: File, parcelaId?: string | null) {
  if (arquivo.size > 15 * 1024 * 1024) throw new Error(`"${arquivo.name}" passa de 15 MB.`);
  if (!EXT[arquivo.type]) throw new Error(`"${arquivo.name}": mande PDF ou foto (JPG, PNG, WEBP, HEIC).`);
  const path = `${solId}/${Date.now()}-${tipo}-${Math.random().toString(36).slice(2, 8)}.${EXT[arquivo.type]}`;
  const up = await supabase.storage.from(BUCKET).upload(path, arquivo, { contentType: arquivo.type, upsert: false });
  if (up.error) throw new Error(`"${arquivo.name}" não subiu: ${up.error.message}`);
  const { error } = await supabase.rpc("fin_pag_anexar", { p_sol: solId, p_tipo: tipo, p_path: path, p_nome: arquivo.name, p_parcela: parcelaId ?? null });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]); // não deixa arquivo órfão
    throw new Error(error.message);
  }
}

/** Link de 5 minutos pra abrir o arquivo (o bucket é privado). */
export async function abrirArquivo(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error("Não consegui abrir o arquivo.");
  return data.signedUrl;
}

export interface ExpedicaoAchada { id: string; nome: string; codigo: string | null; destino: string | null; data_embarque: string | null }
export async function buscarExpedicoes(termo: string): Promise<ExpedicaoAchada[]> {
  const { data, error } = await supabase.rpc("fin_pag_expedicoes", { p_termo: termo || null });
  if (error) throw new Error(error.message);
  return (data ?? []) as ExpedicaoAchada[];
}
export function textoExpedicao(e: ExpedicaoAchada): string {
  return `${e.nome}${e.data_embarque ? ` · embarca ${dataBr(e.data_embarque)}` : ""}`;
}
