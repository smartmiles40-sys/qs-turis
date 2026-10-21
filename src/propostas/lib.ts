// src/propostas/lib.ts
// -----------------------------------------------------------------------------
// PROPOSTAS (0156, Bruno 21/10/2026): Operações monta a proposta no QS e manda
// um LINK (+ PDF) com a marca da agência; o cliente escolhe uma opção.
//
//   proposta → opções (o cliente escolhe UMA) → itens (aéreo, hospedagem…)
//
// Os campos de cada tipo de serviço vêm do estudo do CRM AgentePro (21/10) +
// trem e visto, que a agência vende muito (Japão, China, Europa). Custo, lucro
// e fornecedor são INTERNOS — o link do cliente nunca recebe (api/proposta.js).
// Sem validade (Bruno): o cliente vê "valores sujeitos a confirmação".
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Setor } from "@/components/sdr/types";

export type StatusProposta = "rascunho" | "pronta" | "enviada" | "aprovada" | "recusada" | "cancelada";
export type TipoItem = "aereo" | "hospedagem" | "transfer" | "trem" | "passeio" | "seguro" | "carro" | "cruzeiro" | "visto" | "pacote" | "outro";

export const STATUS_PROPOSTA: Record<StatusProposta, string> = {
  rascunho: "Rascunho", pronta: "Pronta pra enviar", enviada: "Enviada", aprovada: "Aprovada", recusada: "Recusada", cancelada: "Cancelada",
};
export const TOM_PROPOSTA: Record<StatusProposta, "neutro" | "rel" | "aviso" | "erro"> = {
  rascunho: "neutro", pronta: "rel", enviada: "aviso", aprovada: "rel", recusada: "erro", cancelada: "neutro",
};

// ── Campos de cada tipo ─────────────────────────────────────────────────────
export interface CampoTipo {
  chave: string;
  rotulo: string;
  tipo: "texto" | "hora" | "numero" | "select" | "area" | "data";
  opcoes?: string[];
  dica?: string;
  /** Ocupa a linha toda no formulário. */
  largo?: boolean;
}
export interface TipoInfo {
  rotulo: string;
  emoji: string;
  /** Rótulos das datas do item (null = o tipo não usa aquela data). */
  datas: [string | null, string | null];
  campos: CampoTipo[];
  /** Placeholder do nome do item. */
  exemploNome: string;
}

export const REGIMES = ["Sem refeição", "Café da manhã", "Meia pensão", "Pensão completa", "All inclusive"];
export const CLASSES_VOO = ["Econômica", "Premium Economy", "Executiva", "Primeira"];

export const TIPOS: Record<TipoItem, TipoInfo> = {
  aereo: {
    rotulo: "Aéreo", emoji: "✈️", datas: [null, null], exemploNome: "Voo São Paulo → Tóquio",
    campos: [
      { chave: "bagagem_mao", rotulo: "Bagagem de mão", tipo: "texto", dica: "Ex.: 1 de 10 kg" },
      { chave: "bagagem_despachada", rotulo: "Bagagem despachada", tipo: "texto", dica: "Ex.: 2 de 23 kg" },
      { chave: "localizador", rotulo: "Localizador (interno)", tipo: "texto" },
    ],
  },
  hospedagem: {
    rotulo: "Hospedagem", emoji: "🏨", datas: ["Check-in", "Check-out"], exemploNome: "Hotel Gracery Shinjuku",
    campos: [
      { chave: "cidade", rotulo: "Cidade", tipo: "texto" },
      { chave: "estrelas", rotulo: "Estrelas", tipo: "select", opcoes: ["", "1", "2", "3", "4", "5"] },
      { chave: "quarto", rotulo: "Tipo de quarto", tipo: "texto", dica: "Ex.: Duplo standard" },
      { chave: "quartos", rotulo: "Nº de quartos", tipo: "numero" },
      { chave: "regime", rotulo: "Regime", tipo: "select", opcoes: ["", ...REGIMES] },
      { chave: "checkin_hora", rotulo: "Hora do check-in", tipo: "hora" },
      { chave: "checkout_hora", rotulo: "Hora do check-out", tipo: "hora" },
      { chave: "endereco", rotulo: "Endereço", tipo: "texto", largo: true },
    ],
  },
  transfer: {
    rotulo: "Transfer", emoji: "🚐", datas: ["Data", null], exemploNome: "Transfer aeroporto → hotel",
    campos: [
      { chave: "modalidade", rotulo: "Modalidade", tipo: "select", opcoes: ["", "Privativo", "Compartilhado"] },
      { chave: "hora", rotulo: "Horário", tipo: "hora" },
      { chave: "de", rotulo: "De", tipo: "texto" },
      { chave: "para", rotulo: "Para", tipo: "texto" },
    ],
  },
  trem: {
    rotulo: "Trem / ônibus", emoji: "🚄", datas: ["Data", null], exemploNome: "Shinkansen Tóquio → Kyoto",
    campos: [
      { chave: "operadora", rotulo: "Operadora", tipo: "texto" },
      { chave: "numero", rotulo: "Trem / linha", tipo: "texto" },
      { chave: "de", rotulo: "De", tipo: "texto" },
      { chave: "para", rotulo: "Para", tipo: "texto" },
      { chave: "saida", rotulo: "Saída", tipo: "hora" },
      { chave: "chegada", rotulo: "Chegada", tipo: "hora" },
      { chave: "classe", rotulo: "Classe", tipo: "texto" },
      { chave: "assento", rotulo: "Assento", tipo: "texto" },
    ],
  },
  passeio: {
    rotulo: "Passeio / ingresso", emoji: "🎟️", datas: ["Data", "Até (se for passe)"], exemploNome: "Tour Monte Fuji",
    campos: [
      { chave: "local", rotulo: "Local / ponto de encontro", tipo: "texto" },
      { chave: "hora", rotulo: "Horário", tipo: "hora" },
      { chave: "duracao", rotulo: "Duração", tipo: "texto", dica: "Ex.: 8 horas" },
      { chave: "modalidade", rotulo: "Modalidade", tipo: "select", opcoes: ["", "Privativo", "Em grupo", "Ingresso"] },
    ],
  },
  seguro: {
    rotulo: "Seguro viagem", emoji: "🛡️", datas: ["Início da cobertura", "Fim da cobertura"], exemploNome: "Seguro viagem",
    campos: [
      { chave: "seguradora", rotulo: "Seguradora", tipo: "texto" },
      { chave: "plano", rotulo: "Plano", tipo: "texto" },
      { chave: "cobertura", rotulo: "Cobertura médica", tipo: "texto", dica: "Ex.: USD 60 mil" },
    ],
  },
  carro: {
    rotulo: "Aluguel de carro", emoji: "🚗", datas: ["Retirada", "Devolução"], exemploNome: "Aluguel de carro",
    campos: [
      { chave: "locadora", rotulo: "Locadora", tipo: "texto" },
      { chave: "categoria", rotulo: "Categoria", tipo: "texto", dica: "Ex.: SUV automático" },
      { chave: "retirada_local", rotulo: "Local de retirada", tipo: "texto" },
      { chave: "retirada_hora", rotulo: "Hora da retirada", tipo: "hora" },
      { chave: "devolucao_local", rotulo: "Local de devolução", tipo: "texto" },
      { chave: "devolucao_hora", rotulo: "Hora da devolução", tipo: "hora" },
    ],
  },
  cruzeiro: {
    rotulo: "Cruzeiro", emoji: "🛳️", datas: ["Embarque", "Desembarque"], exemploNome: "Cruzeiro pelo Mediterrâneo",
    campos: [
      { chave: "companhia", rotulo: "Companhia", tipo: "texto" },
      { chave: "navio", rotulo: "Navio", tipo: "texto" },
      { chave: "cabine", rotulo: "Cabine", tipo: "texto" },
      { chave: "regime", rotulo: "Regime", tipo: "texto" },
      { chave: "porto_embarque", rotulo: "Porto de embarque", tipo: "texto" },
      { chave: "porto_desembarque", rotulo: "Porto de desembarque", tipo: "texto" },
    ],
  },
  visto: {
    rotulo: "Visto", emoji: "🛂", datas: [null, null], exemploNome: "Visto de turismo",
    campos: [
      { chave: "pais", rotulo: "País", tipo: "texto" },
      { chave: "tipo_visto", rotulo: "Tipo de visto", tipo: "texto" },
      { chave: "prazo", rotulo: "Prazo de emissão", tipo: "texto", dica: "Ex.: 15 dias úteis" },
    ],
  },
  pacote: {
    rotulo: "Pacote / circuito", emoji: "🧳", datas: ["Início", "Fim"], exemploNome: "Circuito Japão Clássico",
    campos: [
      { chave: "operadora", rotulo: "Operadora", tipo: "texto" },
      { chave: "inclui", rotulo: "O que inclui", tipo: "area", largo: true },
    ],
  },
  outro: { rotulo: "Outro", emoji: "📌", datas: ["Data", null], exemploNome: "Serviço", campos: [] },
};
export const ORDEM_TIPOS: TipoItem[] = ["aereo", "hospedagem", "transfer", "trem", "passeio", "seguro", "carro", "cruzeiro", "visto", "pacote", "outro"];

/** Um trecho de voo (ida, volta e conexões são trechos em sequência). */
export interface Trecho {
  sentido: "ida" | "volta" | "interno";
  origem: string;
  destino: string;
  data: string;
  saida: string;
  chegada: string;
  chegada_data: string;
  cia: string;
  voo: string;
  classe: string;
}
export const trechoVazio = (sentido: Trecho["sentido"] = "ida", data = ""): Trecho =>
  ({ sentido, origem: "", destino: "", data, saida: "", chegada: "", chegada_data: "", cia: "", voo: "", classe: "Econômica" });

// ── Pagamento (formas ALTERNATIVAS: o cliente escolhe uma) ──────────────────
export type FormaPag = "pix" | "cartao" | "boleto" | "transferencia" | "outro";
export type CondicaoPag = "avista" | "parcelado" | "entrada";
export interface Pagamento {
  forma: FormaPag;
  condicao: CondicaoPag;
  parcelas: number;
  entrada: number;
  com_juros: boolean;
  obs: string;
}
export const FORMAS: Record<FormaPag, string> = { pix: "Pix", cartao: "Cartão de crédito", boleto: "Boleto", transferencia: "Transferência", outro: "Outra forma" };
export const CONDICOES: Record<CondicaoPag, string> = { avista: "À vista", parcelado: "Parcelado", entrada: "Entrada + parcelas" };
export const pagamentoVazio = (): Pagamento => ({ forma: "pix", condicao: "avista", parcelas: 1, entrada: 0, com_juros: false, obs: "" });

// ── O que o editor manipula ─────────────────────────────────────────────────
export interface ItemProposta {
  id?: string;
  /** Chave só da tela (itens novos ainda sem id). */
  k: string;
  tipo: TipoItem;
  nome: string;
  descricao: string;
  data_inicio: string;
  data_fim: string;
  quantidade: number;
  valor_total: number;
  custo: number | null;
  lucro: number | null;
  fornecedor: string;
  incluso: boolean;
  detalhes: Record<string, unknown>;
}
export interface OpcaoProposta {
  id?: string;
  k: string;
  titulo: string;
  descricao: string;
  recomendada: boolean;
  desconto: number;
  pagamentos: Pagamento[];
  itens: ItemProposta[];
}
export interface Proposta {
  id?: string;
  numero?: number;
  token?: string;
  setor: Setor;
  status: StatusProposta;
  titulo: string;
  destino: string;
  data_ida: string;
  data_volta: string;
  adultos: number;
  criancas: number;
  bebes: number;
  apresentacao: string;
  observacoes: string;
  esconder_precos: boolean;
  capa_url: string;
  solicitacao_id: string | null;
  cliente_id: string | null;
  viagem_id: string | null;
  lead_id: string | null;
  cliente_nome: string;
  criado_por?: string | null;
  criado_por_nome?: string | null;
  criado_em?: string;
  atualizado_em?: string;
  enviada_em?: string | null;
  vista_em?: string | null;
  vista_ultima_em?: string | null;
  visualizacoes?: number;
  aprovada_opcao_id?: string | null;
  aprovada_em?: string | null;
  aprovada_nome?: string | null;
  aprovacao_vista_em?: string | null;
  // 0157: pedido de outro time passa por quem pediu (pronta → abriu → enviou)
  pronta_em?: string | null;
  aberta_por?: string | null;
  aberta_em?: string | null;
  enviada_por?: string | null;
  enviada_por_nome?: string | null;
  /** A solicitação de onde veio (quem pediu e de que time). */
  sol?: { numero: number; de_setor: Setor; para_setor: Setor; criado_por: string | null; criado_por_nome: string | null } | null;
  opcoes: OpcaoProposta[];
}

let seq = 0;
export const novaChave = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;

export function itemVazio(tipo: TipoItem, p?: Pick<Proposta, "data_ida" | "data_volta" | "adultos" | "criancas">): ItemProposta {
  const [r1, r2] = TIPOS[tipo].datas;
  const detalhes: Record<string, unknown> = {};
  if (tipo === "aereo") detalhes.trechos = [trechoVazio("ida", p?.data_ida || ""), ...(p?.data_volta ? [trechoVazio("volta", p.data_volta)] : [])];
  return {
    k: novaChave(), tipo, nome: "", descricao: "",
    data_inicio: r1 ? p?.data_ida || "" : "", data_fim: r2 && tipo !== "passeio" ? p?.data_volta || "" : "",
    quantidade: 1, valor_total: 0, custo: null, lucro: null, fornecedor: "", incluso: false, detalhes,
  };
}
export const opcaoVazia = (titulo = ""): OpcaoProposta =>
  ({ k: novaChave(), titulo, descricao: "", recomendada: false, desconto: 0, pagamentos: [pagamentoVazio()], itens: [] });

export function propostaVazia(setor: Setor): Proposta {
  return {
    setor, status: "rascunho", titulo: "", destino: "", data_ida: "", data_volta: "", adultos: 2, criancas: 0, bebes: 0,
    apresentacao: "", observacoes: "", esconder_precos: false, capa_url: "",
    solicitacao_id: null, cliente_id: null, viagem_id: null, lead_id: null, cliente_nome: "",
    opcoes: [opcaoVazia()],
  };
}

/** "Duplicar esta opção": cópia independente (itens novos, sem id). */
export function duplicarOpcao(o: OpcaoProposta, titulo: string): OpcaoProposta {
  return {
    ...structuredClone(o), id: undefined, k: novaChave(), titulo, recomendada: false,
    itens: o.itens.map((i) => ({ ...structuredClone(i), id: undefined, k: novaChave() })),
  };
}

// ── Contas ──────────────────────────────────────────────────────────────────
export interface Totais { subtotal: number; desconto: number; total: number; custo: number; lucro: number; temCusto: boolean }
type ItemConta = { valor_total: number; custo?: number | null; lucro?: number | null };
/** Serve pro editor (com custo) e pro que o cliente vê (sem custo). */
export function totaisDaOpcao(o: { itens: ItemConta[]; desconto: number }): Totais {
  let subtotal = 0, custo = 0, lucro = 0, temCusto = false;
  for (const i of o.itens) {
    const v = Number(i.valor_total) || 0;
    subtotal += v;
    if (i.custo != null) { custo += Number(i.custo) || 0; temCusto = true; }
    lucro += i.lucro != null ? Number(i.lucro) || 0 : i.custo != null ? v - (Number(i.custo) || 0) : 0;
  }
  const desconto = Math.min(Number(o.desconto) || 0, subtotal);
  return { subtotal, desconto, total: subtotal - desconto, custo, lucro: lucro - desconto, temCusto };
}

export const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "12x de R$ 1.000,00 sem juros" — o que o cliente lê. */
export function textoPagamento(p: Pagamento, total: number): string {
  const forma = FORMAS[p.forma] ?? "Pagamento";
  if (p.condicao === "avista") return `${forma} à vista · ${brl(total)}`;
  const juros = p.com_juros ? "com juros" : "sem juros";
  const n = Math.max(1, Math.floor(Number(p.parcelas) || 1));
  if (p.condicao === "entrada") {
    const ent = Math.min(Number(p.entrada) || 0, total);
    return `${forma}: entrada de ${brl(ent)} + ${n}x de ${brl((total - ent) / n)} ${juros}`;
  }
  return `${forma} em ${n}x de ${brl(total / n)} ${juros}`;
}

export function dataBr(iso: string | null | undefined, comAno = true): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return comAno ? `${d}/${m}/${a}` : `${d}/${m}`;
}
export function noites(ini: string, fim: string): number {
  if (!ini || !fim) return 0;
  return Math.max(0, Math.round((Date.parse(fim) - Date.parse(ini)) / 86400000));
}
export function textoPassageiros(p: Pick<Proposta, "adultos" | "criancas" | "bebes">): string {
  const partes = [];
  if (p.adultos) partes.push(`${p.adultos} adulto${p.adultos === 1 ? "" : "s"}`);
  if (p.criancas) partes.push(`${p.criancas} criança${p.criancas === 1 ? "" : "s"}`);
  if (p.bebes) partes.push(`${p.bebes} bebê${p.bebes === 1 ? "" : "s"}`);
  return partes.join(", ");
}
/** Título que o cliente vê: o digitado → destino → "Sua proposta de viagem". */
export const tituloDaProposta = (p: Pick<Proposta, "titulo" | "destino">) => p.titulo.trim() || (p.destino.trim() ? `Viagem para ${p.destino.trim()}` : "Sua proposta de viagem");
export const linkDaProposta = (token: string) => `${window.location.origin}/proposta/${token}`;

// ── Banco ───────────────────────────────────────────────────────────────────
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

export interface PropostaResumo {
  id: string; numero: number; status: StatusProposta; titulo: string; destino: string | null; cliente_nome: string | null;
  data_ida: string | null; atualizado_em: string; criado_por: string | null; criado_por_nome: string | null;
  vista_em: string | null; visualizacoes: number; aprovada_em: string | null; aprovacao_vista_em: string | null; solicitacao_id: string | null;
  setor: Setor; enviada_por: string | null; pronta_em: string | null; aberta_em: string | null;
  sol_numero: number | null; sol_de_setor: Setor | null; de_outro_time: boolean;
}

/** `setor`: as do time + as que o time PEDIU pra outro montar (0157). */
export async function listarPropostas(f: { status?: StatusProposta | "abertas"; busca?: string; solicitacaoId?: string; clienteId?: string; setor?: Setor } = {}): Promise<PropostaResumo[]> {
  let q = supabase.from("qs_propostas_v").select("*")
    .order("atualizado_em", { ascending: false }).limit(300);
  if (f.setor) q = q.or(`setor.eq.${f.setor},sol_de_setor.eq.${f.setor}`);
  if (f.status === "abertas") q = q.in("status", ["rascunho", "pronta", "enviada"]);
  else if (f.status) q = q.eq("status", f.status);
  if (f.solicitacaoId) q = q.eq("solicitacao_id", f.solicitacaoId);
  if (f.clienteId) q = q.eq("cliente_id", f.clienteId);
  const t = f.busca?.trim().replace(/[%,()*]/g, " ");
  if (t) q = /^\d+$/.test(t) ? q.eq("numero", Number(t)) : q.or(`titulo.ilike.*${t}*,destino.ilike.*${t}*,cliente_nome.ilike.*${t}*`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const lista = (data ?? []) as Omit<PropostaResumo, "criado_por_nome">[];
  const nomes = await nomesDe(lista.map((x) => x.criado_por));
  return lista.map((x) => ({ ...x, criado_por_nome: x.criado_por ? nomes.get(x.criado_por) ?? null : null }));
}

async function nomesDe(ids: (string | null)[]): Promise<Map<string, string>> {
  const u = [...new Set(ids.filter(Boolean))] as string[];
  if (!u.length) return new Map();
  const { data } = await supabase.from("qs_users").select("id, name").in("id", u);
  return new Map(((data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
}

export async function carregarProposta(id: string): Promise<Proposta> {
  const [{ data: p, error }, { data: ops }, { data: its }] = await Promise.all([
    supabase.from("qs_propostas").select("*").eq("id", id).single(),
    supabase.from("qs_proposta_opcoes").select("*").eq("proposta_id", id).order("ordem"),
    supabase.from("qs_proposta_itens").select("*").eq("proposta_id", id).order("ordem"),
  ]);
  if (error || !p) throw new Error(error?.message || "Proposta não encontrada.");
  const { data: sol } = p.solicitacao_id
    ? await supabase.from("qs_solicitacoes").select("numero, de_setor, para_setor, criado_por").eq("id", p.solicitacao_id).maybeSingle()
    : { data: null };
  const nomes = await nomesDe([p.criado_por, p.enviada_por, sol?.criado_por ?? null]);
  const itens = (its ?? []) as Record<string, unknown>[];
  return {
    ...(p as Proposta),
    titulo: p.titulo ?? "", destino: p.destino ?? "", data_ida: p.data_ida ?? "", data_volta: p.data_volta ?? "",
    apresentacao: p.apresentacao ?? "", observacoes: p.observacoes ?? "", capa_url: p.capa_url ?? "", cliente_nome: p.cliente_nome ?? "",
    criado_por_nome: p.criado_por ? nomes.get(p.criado_por) ?? null : null,
    enviada_por_nome: p.enviada_por ? nomes.get(p.enviada_por) ?? null : null,
    sol: sol ? { ...(sol as Omit<NonNullable<Proposta["sol"]>, "criado_por_nome">), criado_por_nome: sol.criado_por ? nomes.get(sol.criado_por) ?? null : null } : null,
    opcoes: ((ops ?? []) as Record<string, unknown>[]).map((o) => ({
      id: o.id as string, k: o.id as string, titulo: (o.titulo as string) ?? "", descricao: (o.descricao as string) ?? "",
      recomendada: Boolean(o.recomendada), desconto: Number(o.desconto) || 0,
      pagamentos: Array.isArray(o.pagamentos) ? (o.pagamentos as Pagamento[]) : [],
      itens: itens.filter((i) => i.opcao_id === o.id).map((i) => ({
        id: i.id as string, k: i.id as string, tipo: i.tipo as TipoItem, nome: (i.nome as string) ?? "", descricao: (i.descricao as string) ?? "",
        data_inicio: (i.data_inicio as string) ?? "", data_fim: (i.data_fim as string) ?? "", quantidade: Number(i.quantidade) || 1,
        valor_total: Number(i.valor_total) || 0, custo: num(i.custo), lucro: num(i.lucro), fornecedor: (i.fornecedor as string) ?? "",
        incluso: Boolean(i.incluso), detalhes: (i.detalhes as Record<string, unknown>) ?? {},
      })),
    })),
  };
}

const ERROS: Record<string, string> = {
  "sem-acesso": "Você não tem acesso às propostas.",
  "proposta-sem-opcao": "A proposta precisa de pelo menos uma opção.",
  "proposta-cancelada": "Essa proposta foi cancelada — duplique pra fazer uma nova.",
  "proposta-nao-encontrada": "Proposta não encontrada.",
  "opcao-invalida": "Escolha uma opção da proposta.",
  "so-quem-monta": "Só o time que monta a proposta pode mudar isso.",
  "quem-envia-e-quem-pediu": "Quem envia ao cliente é quem pediu a cotação.",
  "ainda-nao-pronta": "A proposta ainda não foi liberada por quem está montando.",
  "abra-antes": "A proposta mudou depois que você abriu — confira a versão nova antes de enviar.",
  "diga-o-ajuste": "Escreva o que precisa mudar.",
  "acao-invalida": "Não dá pra fazer isso com a proposta nesse andamento.",
};
const traduzir = (m: string) => ERROS[Object.keys(ERROS).find((k) => m.includes(k)) ?? ""] ?? m;

export async function salvarProposta(p: Proposta): Promise<string> {
  const corpo = {
    id: p.id ?? null, setor: p.setor, titulo: p.titulo, destino: p.destino, data_ida: p.data_ida, data_volta: p.data_volta,
    adultos: p.adultos, criancas: p.criancas, bebes: p.bebes, apresentacao: p.apresentacao, observacoes: p.observacoes,
    esconder_precos: p.esconder_precos, capa_url: p.capa_url, solicitacao_id: p.solicitacao_id, cliente_id: p.cliente_id,
    viagem_id: p.viagem_id, lead_id: p.lead_id, cliente_nome: p.cliente_nome,
    opcoes: p.opcoes.map((o) => ({
      id: o.id ?? null, titulo: o.titulo, descricao: o.descricao, recomendada: o.recomendada, desconto: o.desconto, pagamentos: o.pagamentos,
      itens: o.itens.map((i) => ({
        id: i.id ?? null, tipo: i.tipo, nome: i.nome, descricao: i.descricao, data_inicio: i.data_inicio, data_fim: i.data_fim,
        quantidade: i.quantidade, valor_total: i.valor_total, custo: i.custo, lucro: i.lucro, fornecedor: i.fornecedor,
        incluso: i.incluso, detalhes: i.detalhes,
      })),
    })),
  };
  const { data, error } = await supabase.rpc("qs_proposta_salvar", { p: corpo });
  if (error) throw new Error(traduzir(error.message));
  return data as string;
}

export type AcaoProposta = "pronta" | "aberta" | "ajuste" | "enviada" | "recusada" | "cancelada" | "rascunho" | "aprovada" | "visto";
export async function mudarStatus(id: string, acao: AcaoProposta, opcaoId?: string | null, texto?: string) {
  const { error } = await supabase.rpc("qs_proposta_status", { p_id: id, p_acao: acao, p_opcao: opcaoId ?? null, p_texto: texto ?? null });
  if (error) throw new Error(traduzir(error.message));
}

export async function duplicarProposta(id: string): Promise<string> {
  const { data, error } = await supabase.rpc("qs_proposta_duplicar", { p_id: id });
  if (error) throw new Error(traduzir(error.message));
  return data as string;
}

/** Bolinha do menu: aprovações pelo link que eu (montei ou enviei) não vi + propostas
 *  prontas que outro time montou a pedido do meu e esperam alguém abrir e enviar. */
export async function contarAprovacoesNovas(userId: string, setor?: Setor): Promise<number> {
  const [{ count: aprov }, prontas] = await Promise.all([
    supabase.from("qs_propostas").select("id", { count: "exact", head: true })
      .or(`criado_por.eq.${userId},enviada_por.eq.${userId}`).not("aprovada_em", "is", null).is("aprovacao_vista_em", null),
    setor
      ? supabase.from("qs_propostas_v").select("id", { count: "exact", head: true }).eq("status", "pronta").eq("sol_de_setor", setor).eq("de_outro_time", true)
      : Promise.resolve({ count: 0 }),
  ]);
  return (aprov ?? 0) + (prontas.count ?? 0);
}

/** Mensagem pronta pro WhatsApp do cliente. */
export function mensagemDaProposta(p: Pick<Proposta, "cliente_nome" | "destino" | "opcoes">, link: string): string {
  const nome = p.cliente_nome.trim().split(/s+/)[0] || "";
  const varias = p.opcoes.length > 1;
  return `Olá${nome ? `, ${nome}` : ""}! Preparamos sua proposta de viagem${p.destino ? ` para ${p.destino}` : ""}${varias ? ` com ${p.opcoes.length} opções` : ""}. É só abrir o link pra ver todos os detalhes${varias ? " e escolher a sua preferida" : ""}:

${link}

Qualquer dúvida, estou por aqui!`;
}

// ── O que o cliente vê (mesma forma que api/proposta.js devolve) ────────────
export interface PropostaVM {
  numero: number;
  status: StatusProposta;
  titulo: string;
  destino: string;
  data_ida: string;
  data_volta: string;
  adultos: number;
  criancas: number;
  bebes: number;
  apresentacao: string;
  observacoes: string;
  esconder_precos: boolean;
  capa_url: string;
  cliente_nome: string;
  consultor: { nome: string; whatsapp: string | null } | null;
  aprovada_opcao_id: string | null;
  aprovada_em: string | null;
  opcoes: {
    id: string; titulo: string; descricao: string; recomendada: boolean; desconto: number; pagamentos: Pagamento[];
    itens: { tipo: TipoItem; nome: string; descricao: string; data_inicio: string; data_fim: string; quantidade: number; valor_total: number; incluso: boolean; detalhes: Record<string, unknown> }[];
  }[];
}

/** Prévia dentro do QS: tira o que é interno, igual ao servidor. */
export function paraVM(p: Proposta): PropostaVM {
  return {
    numero: p.numero ?? 0, status: p.status, titulo: p.titulo, destino: p.destino, data_ida: p.data_ida, data_volta: p.data_volta,
    adultos: p.adultos, criancas: p.criancas, bebes: p.bebes, apresentacao: p.apresentacao, observacoes: p.observacoes,
    esconder_precos: p.esconder_precos, capa_url: p.capa_url, cliente_nome: p.cliente_nome,
    consultor: (p.enviada_por_nome || p.criado_por_nome) ? { nome: (p.enviada_por_nome || p.criado_por_nome)!, whatsapp: null } : null,
    aprovada_opcao_id: p.aprovada_opcao_id ?? null, aprovada_em: p.aprovada_em ?? null,
    opcoes: p.opcoes.map((o) => ({
      id: o.id ?? o.k, titulo: o.titulo, descricao: o.descricao, recomendada: o.recomendada, desconto: o.desconto, pagamentos: o.pagamentos,
      itens: o.itens.map((i) => ({
        tipo: i.tipo, nome: i.nome, descricao: i.descricao, data_inicio: i.data_inicio, data_fim: i.data_fim, quantidade: i.quantidade,
        valor_total: i.valor_total, incluso: i.incluso, detalhes: semInternos(i.detalhes),
      })),
    })),
  };
}
/** Campos de detalhe que são só do time (localizador). */
export function semInternos(d: Record<string, unknown>): Record<string, unknown> {
  const c = { ...d };
  delete c.localizador;
  return c;
}

/** Bolinha do menu Propostas (ver contarAprovacoesNovas); reconta a cada 60s. */
export function useAprovacoesNovas(userId: string | undefined, setor?: Setor): [number, () => void] {
  const [n, setN] = useState(0);
  const contar = useCallback(() => { if (userId) contarAprovacoesNovas(userId, setor).then(setN).catch(() => undefined); }, [userId, setor]);
  useEffect(() => {
    contar();
    const t = setInterval(() => { if (!document.hidden) contar(); }, 60_000);
    return () => clearInterval(t);
  }, [contar]);
  return [n, contar];
}
