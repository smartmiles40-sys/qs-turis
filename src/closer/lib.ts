// src/closer/lib.ts
// -----------------------------------------------------------------------------
// Dados da ÁREA DO CLOSER (0174–0176, 22/10/2026): o pipeline (um cartão por
// cliente que o closer atendeu) e a ficha de fechamento (venda consolidada).
// 0205: o cartão nasce na reunião agendada; os antigos (231) foram pro arquivo.
//
// Escrita SEMPRE por RPC (o banco confere se é o closer dono ou gestor/admin).
// O espelho no Bitrix é do servidor (api/closer.js?acao=espelhar).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { SdrUser } from "@/components/sdr/types";

// ── Quem abre a área ────────────────────────────────────────────────────────
/** O closer cai direto aqui; admin e gestor do Comercial abrem pelo menu (#closer). */
export function podeAbrirAreaCloser(u: Pick<SdrUser, "role" | "setores"> | null | undefined): boolean {
  if (!u) return false;
  if (u.role === "closer" || u.role === "admin") return true;
  return u.role === "gestor" && (!u.setores?.length || u.setores.includes("comercial"));
}
export const ehHashDoCloser = () => /^#\/?closer(\/|$)/.test(window.location.hash);
export function abrirAreaCloser() { window.location.hash = "#closer"; }

// ── Etapas ─────────────────────────────────────────────────────────────────
// 0205 (26/10): as colunas do Comercial. O QS manda e o Bitrix segue (cron).
// A reunião move sozinha as 3 primeiras + Em cotação; o resto é o closer.
export type Etapa =
  | "aguardando_reuniao" | "reagendamento" | "em_cotacao" | "em_negociacao" | "no_show"
  | "oportunidade_futura" | "aguardando_emissao" | "venda_cancelada" | "perdido" | "venda_realizada";

export const ETAPAS: { id: Etapa; rotulo: string; cor: string }[] = [
  { id: "aguardando_reuniao", rotulo: "Aguardando reunião", cor: "#64748B" },
  { id: "reagendamento", rotulo: "Reagendamento", cor: "#B45309" },
  { id: "em_cotacao", rotulo: "Em cotação", cor: "#2563EB" },
  { id: "em_negociacao", rotulo: "Em negociação", cor: "#7C3AED" },
  { id: "no_show", rotulo: "No-show", cor: "#DC2626" },
  { id: "oportunidade_futura", rotulo: "Oportunidade futura", cor: "#0E7490" },
  { id: "aguardando_emissao", rotulo: "Aguardando emissão", cor: "#A16207" },
  { id: "venda_cancelada", rotulo: "Venda cancelada", cor: "#9F1239" },
  { id: "perdido", rotulo: "Perdido", cor: "#B91C1C" },
  { id: "venda_realizada", rotulo: "Venda realizada", cor: "#15803D" },
];
/** Etapas que encerram o cartão (saem do quadro de abertos). */
export const ETAPAS_FINAIS: Etapa[] = ["venda_realizada", "venda_cancelada", "perdido"];
/** Pedem motivo ao mover. */
export const ETAPAS_COM_MOTIVO: Etapa[] = ["perdido", "venda_cancelada"];
export const NOME_ETAPA = Object.fromEntries(ETAPAS.map((e) => [e.id, e.rotulo])) as Record<Etapa, string>;

export interface Negocio {
  id: string;
  lead_id: string;
  closer_id: string | null;
  meeting_id: string | null;
  etapa: Etapa;
  etapa_em: string;
  valor_previsto: number | null;
  proxima_acao: string | null;
  proxima_acao_em: string | null;
  motivo_perda: string | null;
  status_contrato: "enviado" | "visualizado" | "assinado" | "recusado" | "cancelado" | null;
  contrato_enviado_em: string | null;
  contrato_assinado_em: string | null;
  status_pagamento: "enviado" | "parcial" | "pago" | "cancelado" | null;
  pagamento_enviado_em: string | null;
  pago_em: string | null;
  // 0181: pagamento manual / pelo Financeiro
  pagamento_link: string | null;
  pagamento_link_em: string | null;
  pagamento_link_origem: "closer" | "financeiro" | null;
  pagamento_obs: string | null;
  pagamento_solicitacao_id: string | null;
  proposta_id: string | null;
  ficha: Ficha | null;
  viagem_id: string | null;
  consolidada_em: string | null;
  bitrix_status: "pendente" | "ok" | "erro" | "sem_card" | null;
  bitrix_erro: string | null;
  bitrix_enviado_em: string | null;
  bitrix_etapa: Etapa | null;
  arquivado_em: string | null;
  arquivado_motivo: string | null;
  // 0207: pré-venda ("Marcar como venda" — sobe pro Dashboard antes da ficha).
  // Opcionais: o banco sem a 0207 não tem as colunas.
  pre_venda_em?: string | null;
  pre_venda_por?: string | null;
  pre_venda_valor?: number | null;
  pre_venda_tipo?: string | null;
  pre_venda_tipo_bitrix?: string | null;
  criado_em: string;
  atualizado_em: string;
  lead: { id: string; full_name: string | null; first_name: string | null; last_name: string | null; phone: string | null; email: string | null; bitrix_id: string | null } | null;
  closer: { name: string } | null;
}

export function nomeDoLead(l: Negocio["lead"]): string {
  if (!l) return "Cliente";
  return (l.full_name || [l.first_name, l.last_name].filter(Boolean).join(" ") || "Cliente").trim();
}

export async function listarNegocios(f: { desde?: string | null; closerId?: string | null }): Promise<Negocio[]> {
  let q = supabase
    .from("qs_closer_negocios")
    .select("*, lead:qs_leads(id, full_name, first_name, last_name, phone, email, bitrix_id), closer:qs_users!qs_closer_negocios_closer_id_fkey(name)")
    .order("etapa_em", { ascending: false })
    .limit(1000);
  if (f.desde) q = q.gte("criado_em", f.desde);
  if (f.closerId) q = q.eq("closer_id", f.closerId);
  const { data, error } = await q.is("arquivado_em", null);
  if (!error) { bancoSemPipelineV2 = false; return (data ?? []) as unknown as Negocio[]; }
  if (!error.message.includes("arquivado_em")) throw new Error(error.message);
  // Banco ainda sem a 0205 (só no localhost, antes do deploy): lista do jeito
  // antigo e mostra cada etapa velha na coluna nova equivalente, só pra ver.
  bancoSemPipelineV2 = true;
  const velho = await q;
  if (velho.error) throw new Error(velho.error.message);
  return ((velho.data ?? []) as unknown as Negocio[]).map((n) => ({ ...n, etapa: ETAPA_ANTIGA[n.etapa as string] ?? n.etapa }));
}

/** true quando o banco ainda não tem a 0205 (colunas novas do pipeline). */
export let bancoSemPipelineV2 = false;
const ETAPA_ANTIGA: Record<string, Etapa> = {
  reuniao_feita: "em_cotacao", proposta_enviada: "em_negociacao", negociando: "em_negociacao",
  contrato_enviado: "em_negociacao", contrato_assinado: "em_negociacao", pagamento_enviado: "em_negociacao",
  pago: "em_negociacao", consolidada: "aguardando_emissao", perdido: "perdido",
};

export async function carregarNegocio(id: string): Promise<Negocio | null> {
  const { data, error } = await supabase
    .from("qs_closer_negocios")
    .select("*, lead:qs_leads(id, full_name, first_name, last_name, phone, email, bitrix_id), closer:qs_users!qs_closer_negocios_closer_id_fkey(name)")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as Negocio | null;
}

/** Traduz o código de erro do banco pra uma frase. */
export function erroAmigavel(e: unknown): string {
  const m = String((e as { message?: string })?.message ?? e ?? "");
  const mapa: Record<string, string> = {
    "sem-permissao": "Você não pode mexer neste cartão (só o closer dono ou a gestão).",
    "motivo-obrigatorio": "Escreva o motivo.",
    "use-a-ficha-de-fechamento": "Pra ir pra Aguardando emissão, preencha a ficha de fechamento (é ela que consolida a venda).",
    "consolide-antes": "Antes, consolide a venda pela ficha de fechamento.",
    "ja-tem-cartao-aberto": "Este cliente já tem um cartão aberto no quadro.",
    "venda-ja-consolidada": "Esta venda já foi consolidada.",
    "negocio-perdido": "Este cartão está como perdido. Mova de volta antes de consolidar.",
    "valor-total-obrigatorio": "Informe o valor total da venda.",
    "volta-antes-da-ida": "A volta está antes da ida.",
    "responsavel-invalido": "O responsável escolhido não é do Relacionamento.",
    "entrada-sem-vencimento": "A entrada precisa de vencimento.",
    "parcela-sem-valor": "Toda parcela precisa de valor.",
    "parcela-sem-vencimento": "Toda parcela precisa de vencimento.",
    "plano-vazio": "Monte o plano de pagamento (entrada e/ou parcelas).",
    "plano-ja-tem-pagamento": "O Financeiro já deu baixa em parcela desta venda — fale com o Financeiro pra mudar o plano.",
    "servico-invalido": "Escolha o tipo de serviço.",
    // 0180 contrato / 0181 pagamento
    "link-invalido": "Cole um link completo (começando com https://).",
    "contrato-ja-assinado": "Este contrato já foi assinado.",
    "sem-contrato": "Não tem contrato enviado pra cancelar.",
    "contrato-sendo-gerado": "O QS está gerando um contrato automático pra este cliente agora. Espere um minuto e tente de novo.",
    "negocio-nao-encontrado": "Cartão não encontrado (atualize a tela).",
    "acao-invalida": "Ação inválida.",
    "valor-invalido": "Informe um valor maior que zero.",
    "data-no-futuro": "A data do pagamento não pode ser no futuro.",
    "parcela-nao-e-desta-venda": "Essa parcela não é desta venda.",
    "parcela-ja-baixada": "Essa parcela já está paga (ou cancelada) no Financeiro.",
    "modalidade-invalida": "Escolha o tipo de link.",
    "parcelas-invalidas": "Parcelas: de 1 a 48.",
    "pedido-ja-aberto": "Já tem um pedido de link aberto no Financeiro pra este cliente — acompanhe em Solicitações.",
    "Você não é desse setor": "Só quem é do Comercial pede ao Financeiro por aqui.",
    // 0207 venda por itens / pré-venda
    "tipo-invalido": "Escolha o tipo de cada item.",
    "item-sem-nome": "Dê um nome a cada item (ex.: \"Voo São Paulo → Tóquio\").",
    "item-ja-emitido": "Um item que você tirou já foi emitido pelo Relacionamento — ele não pode sair por aqui. Fale com o Relacionamento.",
    "itens-invalidos": "A lista de itens veio vazia ou quebrada. Tente de novo.",
    "tipo-obrigatorio": "Diga o que foi vendido (aéreo, pacote, expedição…).",
    "cartao-no-arquivo": "O cartão está no arquivo. Traga o cliente pro quadro antes.",
    "closer_pre_venda": "A pré-venda ainda não está ligada no banco (falta aplicar a 0207).",
    "closer_venda_itens_salvar": "O registro de venda ainda não está ligado no banco (falta aplicar a 0207).",
  };
  for (const [k, v] of Object.entries(mapa)) if (m.includes(k)) return v;
  const nb = m.match(/plano-nao-bate:([\d.]+)/);
  if (nb) return `A soma do plano (${brl(Number(nb[1]))}) não bate com o valor total.`;
  return m || "Não deu certo. Tente de novo.";
}

export async function moverNegocio(id: string, etapa: Etapa, motivo?: string) {
  const { error } = await supabase.rpc("closer_negocio_mover", { p_id: id, p_etapa: etapa, p_motivo: motivo ?? null });
  if (error) throw new Error(erroAmigavel(error));
}
export async function salvarNegocio(id: string, dados: { valor_previsto?: number | null; proxima_acao?: string; proxima_acao_em?: string | null }) {
  const { error } = await supabase.rpc("closer_negocio_salvar", { p_id: id, p_dados: dados });
  if (error) throw new Error(erroAmigavel(error));
}
export async function notaNoNegocio(id: string, texto: string) {
  const { error } = await supabase.rpc("closer_negocio_nota", { p_id: id, p_texto: texto });
  if (error) throw new Error(erroAmigavel(error));
}
export async function abrirNegocio(leadId: string): Promise<string> {
  const { data, error } = await supabase.rpc("closer_negocio_abrir", { p_lead: leadId });
  if (error) throw new Error(erroAmigavel(error));
  return data as string;
}

export interface EventoNegocio { id: string; tipo: string; de_etapa: string | null; para_etapa: string | null; texto: string | null; criado_em: string; autor: { name: string } | null }
export async function eventosDoNegocio(id: string): Promise<EventoNegocio[]> {
  const { data } = await supabase.from("qs_closer_negocio_eventos")
    .select("id, tipo, de_etapa, para_etapa, texto, criado_em, autor:qs_users(name)")
    .eq("negocio_id", id).order("criado_em", { ascending: false }).limit(50);
  return (data ?? []) as unknown as EventoNegocio[];
}

// ── Ficha de fechamento ────────────────────────────────────────────────────
export type Servico = "pacote" | "aereo" | "hospedagem" | "expedicao" | "passeio" | "cruzeiro" | "seguro" | "concierge" | "outro";
export const SERVICOS: Record<Servico, string> = {
  pacote: "Pacote", aereo: "Aéreo", hospedagem: "Hospedagem", expedicao: "Expedição", passeio: "Passeio",
  cruzeiro: "Cruzeiro", seguro: "Seguro", concierge: "Concierge", outro: "Outro",
};
export type FormaPagamento = "pix" | "boleto" | "cartao" | "link" | "transferencia" | "dinheiro" | "outro";
export const FORMAS_PAGAMENTO: Record<FormaPagamento, string> = {
  pix: "Pix", boleto: "Boleto", cartao: "Cartão", link: "Link de pagamento", transferencia: "Transferência", dinheiro: "Dinheiro", outro: "Outra",
};

export interface ParcelaFicha { valor: number; vencimento: string; forma: FormaPagamento; recorrente?: boolean; observacao?: string }
export interface Ficha {
  servico: Servico;
  destino: string;
  data_ida: string;
  data_volta: string;
  qtd_passageiros: number | null;
  passageiros: { nome: string }[];
  valor_total: number;
  proposta_id?: string | null;
  opcao_id?: string | null;
  itens: { tipo: string; nome: string; descricao?: string; valor_total: number }[];
  plano: { entrada: ParcelaFicha | null; parcelas: ParcelaFicha[]; observacao_financeiro: string };
  preferencias: { gostos: string; alergias: string; restricoes: string; ocasiao: string; outras: string };
  rel_responsavel_id: string | null;
  /** 0207: "Tipo de venda" do Bitrix (id, string) — só preenche o card se estiver vazio. */
  tipo_bitrix?: string | null;
  /** 0207: a ficha veio dos itens registrados (qs_venda_itens), não da proposta. */
  de_itens_da_venda?: boolean;
}

/** Pré-venda aberta: marcada e ainda sem ficha de fechamento. */
export const emPreVenda = (n: Pick<Negocio, "consolidada_em" | "etapa"> & { pre_venda_em?: string | null }) =>
  !!n.pre_venda_em && !n.consolidada_em && n.etapa !== "perdido" && n.etapa !== "venda_cancelada";

/** Em que pé está a venda, pro selo do cartão (27/10: um caminho só). */
export function seloDaVenda(n: Pick<Negocio, "consolidada_em" | "etapa"> & { pre_venda_em?: string | null }): { t: string; tom: "aviso" | "rel" } | null {
  if (n.etapa === "perdido" || n.etapa === "venda_cancelada") return null;
  if (n.consolidada_em) return { t: "Fechada", tom: "rel" };
  if (emPreVenda(n)) return { t: "Venda registrada (falta fechar)", tom: "aviso" };
  return null;
}

export async function consolidar(negocioId: string, ficha: Ficha): Promise<{ viagem_id: string; plano_id: string }> {
  const { data, error } = await supabase.rpc("closer_consolidar", { p_negocio: negocioId, p_ficha: ficha });
  if (error) throw new Error(erroAmigavel(error));
  return data as { viagem_id: string; plano_id: string };
}

async function chamarApi<T>(acao: string, corpo: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch(`/api/closer?acao=${acao}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ acao, ...corpo }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (HTTP ${r.status}).`);
  return j as T;
}

/** Traz pro quadro um cliente que já existe no Bitrix, pelo ID do negócio. */
export function trazerDoBitrix(dealId: string, closerId?: string | null) {
  return chamarApi<{ ok: boolean; negocioId: string; etapa: Etapa; cliente?: string; com?: string | null; comOutro?: boolean }>("importar", { dealId, closerId: closerId ?? null });
}

/**
 * Passa o cartão (e o lead, se estava com o closer antigo) pra outro closer (0334).
 * Gestor comercial/admin passa qualquer um; o closer passa o próprio pra um colega.
 */
export async function trocarCloser(negocioId: string, closerId: string, motivo: string | null) {
  const { error } = await supabase.rpc("closer_negocio_trocar_closer", { p_negocio: negocioId, p_closer: closerId, p_motivo: motivo });
  if (error) {
    const m = error.message;
    throw new Error(/sem-permissao/.test(m) ? "Só o gestor comercial ou o próprio closer do cartão podem trocar o responsável."
      : /closer-invalido/.test(m) ? "Escolha um closer ativo."
      : /closer_negocio_trocar_closer/.test(m) ? "Falta aplicar a 0334 no banco." : m);
  }
}

/** Quem pode receber cartão: closers ativos (e gestores/admin, pra devolver ao time). */
export async function listarClosersAtivos(): Promise<{ id: string; name: string; role: string }[]> {
  const { data, error } = await supabase.from("qs_users").select("id, name, role").eq("is_active", true).in("role", ["closer"]).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; name: string; role: string }[];
}

/** Pré-venda (0207): leva o negócio pra coluna de venda no Bitrix (ou de volta, se desfeita). */
export function preVendaNoBitrix(negocioId: string) {
  return chamarApi<{ ok: boolean; status?: string; mensagem?: string }>("pre-venda", { negocioId });
}

/** Leva a etapa do cartão (e o valor) pro Bitrix agora. O cron faz o mesmo a cada 10 min. */
export function espelharNoBitrix(negocioId: string) {
  return chamarApi<{ ok: boolean; status?: string; mensagem?: string }>("espelhar", { negocioId });
}

// ── O que está ligado no servidor (27/10) ──────────────────────────────────
// A tela esconde o que depende de variável que não está na Vercel (contrato
// pelo ZapSign/Google, Bitrix). Uma chamada por sessão, dividida entre as telas.
export interface ConfigDaArea { contrato: boolean; bitrix: boolean }
let configCache: Promise<ConfigDaArea> | null = null;
export function configDaArea(): Promise<ConfigDaArea> {
  if (!configCache) {
    configCache = chamarApi<ConfigDaArea>("config", {}).catch(() => {
      configCache = null; // tenta de novo na próxima tela
      return { contrato: false, bitrix: true };
    });
  }
  return configCache;
}
/** Hook: null enquanto carrega. */
export function useConfigDaArea(): ConfigDaArea | null {
  const [c, setC] = useState<ConfigDaArea | null>(null);
  useEffect(() => { let vivo = true; void configDaArea().then((x) => { if (vivo) setC(x); }); return () => { vivo = false; }; }, []);
  return c;
}

export async function responsaveisDoRel(): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.rpc("closer_responsaveis_rel");
  return (data ?? []) as { id: string; name: string }[];
}

// ── Utilidades ─────────────────────────────────────────────────────────────
export const brl = (v: number | null | undefined) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dataBr = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
export const dataHoraBr = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
export const hojeISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
/** Soma N meses a uma data YYYY-MM-DD (dia 31 vira o último dia do mês). */
export function somarMeses(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}
