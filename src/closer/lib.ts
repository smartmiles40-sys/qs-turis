// src/closer/lib.ts
// -----------------------------------------------------------------------------
// Dados da ÁREA DO CLOSER (0174–0176, 22/10/2026): o pipeline (um cartão por
// cliente que o closer atendeu) e a ficha de fechamento (venda consolidada).
//
// Escrita SEMPRE por RPC (o banco confere se é o closer dono ou gestor/admin).
// O espelho no Bitrix é do servidor (api/closer.js?acao=espelhar).
// -----------------------------------------------------------------------------
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
export type Etapa =
  | "reuniao_feita" | "proposta_enviada" | "negociando" | "contrato_enviado"
  | "contrato_assinado" | "pagamento_enviado" | "pago" | "consolidada" | "perdido";

export const ETAPAS: { id: Etapa; rotulo: string; cor: string }[] = [
  { id: "reuniao_feita", rotulo: "Reunião feita", cor: "#64748B" },
  { id: "proposta_enviada", rotulo: "Proposta enviada", cor: "#2563EB" },
  { id: "negociando", rotulo: "Negociando", cor: "#7C3AED" },
  { id: "contrato_enviado", rotulo: "Contrato enviado", cor: "#B45309" },
  { id: "contrato_assinado", rotulo: "Contrato assinado", cor: "#A16207" },
  { id: "pagamento_enviado", rotulo: "Pagamento enviado", cor: "#0E7490" },
  { id: "pago", rotulo: "Pago", cor: "#047857" },
  { id: "consolidada", rotulo: "Venda consolidada", cor: "#15803D" },
  { id: "perdido", rotulo: "Perdido", cor: "#B91C1C" },
];
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
  status_contrato: string | null;
  status_pagamento: string | null;
  proposta_id: string | null;
  ficha: Ficha | null;
  viagem_id: string | null;
  consolidada_em: string | null;
  bitrix_status: "pendente" | "ok" | "erro" | "sem_card" | null;
  bitrix_erro: string | null;
  bitrix_enviado_em: string | null;
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
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Negocio[];
}

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
    "motivo-obrigatorio": "Escreva o motivo da perda.",
    "use-a-ficha-de-fechamento": "Venda consolidada só pela ficha de fechamento.",
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
}

export async function consolidar(negocioId: string, ficha: Ficha): Promise<{ viagem_id: string; plano_id: string }> {
  const { data, error } = await supabase.rpc("closer_consolidar", { p_negocio: negocioId, p_ficha: ficha });
  if (error) throw new Error(erroAmigavel(error));
  return data as { viagem_id: string; plano_id: string };
}

/** Manda a venda consolidada pro Bitrix (valor + etapa de venda realizada). */
export async function espelharNoBitrix(negocioId: string): Promise<{ ok: boolean; status?: string; mensagem?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/closer?acao=espelhar", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "espelhar", negocioId }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (HTTP ${r.status}).`);
  return j as { ok: boolean; status?: string; mensagem?: string };
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
