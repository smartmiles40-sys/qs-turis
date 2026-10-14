// src/fin/lib/atendimentos.ts
// -----------------------------------------------------------------------------
// ATENDIMENTOS DO FINANCEIRO (0127, 14/10/2026).
//
// Comercial, Relacionamento e Operações "mandam o cliente pro Financeiro" com
// um motivo; o Financeiro conversa com ele pelo número do Relacionamento e dá
// o STATUS (novo → em atendimento → aguardando cliente → resolvido). Quem
// mandou acompanha. Tudo que muda passa por RPC — a tabela é só leitura.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

export type StatusFin = "novo" | "em_atendimento" | "aguardando_cliente" | "resolvido" | "cancelado";
export type MotivoFin = "duvida" | "cobranca" | "segunda_via" | "parcelamento" | "reembolso" | "nota_fiscal" | "cancelamento" | "outro";
export type OrigemFin = "comercial" | "relacionamento" | "operacional" | "financeiro";
export type PrioridadeFin = "baixa" | "normal" | "alta" | "urgente";

export const STATUS_FIN: Record<StatusFin, string> = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  aguardando_cliente: "Aguardando cliente",
  resolvido: "Resolvido",
  cancelado: "Cancelado",
};
/** Tom da etiqueta de cada status (componente Etiqueta do ../ui). */
export const TOM_STATUS: Record<StatusFin, "neutro" | "rel" | "aviso" | "erro"> = {
  novo: "aviso",
  em_atendimento: "rel",
  aguardando_cliente: "neutro",
  resolvido: "neutro",
  cancelado: "neutro",
};
export const MOTIVO_FIN: Record<MotivoFin, string> = {
  duvida: "Dúvida financeira",
  cobranca: "Cobrança / pagamento em aberto",
  segunda_via: "2ª via de boleto / link de pagamento",
  parcelamento: "Parcelamento / negociação",
  reembolso: "Reembolso / estorno",
  nota_fiscal: "Nota fiscal / recibo",
  cancelamento: "Cancelamento (multa, valores)",
  outro: "Outro",
};
export const ORIGEM_FIN: Record<OrigemFin, string> = {
  comercial: "Comercial",
  relacionamento: "Relacionamento",
  operacional: "Operações",
  financeiro: "Financeiro",
};
export const PRIORIDADE_FIN: Record<PrioridadeFin, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta", urgente: "Urgente" };

/** Status que contam como "aberto" (ainda com o Financeiro). */
export const ABERTOS: StatusFin[] = ["novo", "em_atendimento", "aguardando_cliente"];

export interface AtendimentoFin {
  id: string;
  numero: number;
  cliente_id: string | null;
  lead_id: string | null;
  conversa_id: string | null;
  nome: string;
  telefone: string | null;
  motivo: MotivoFin;
  descricao: string;
  origem: OrigemFin;
  enviado_por: string | null;
  responsavel_id: string | null;
  status: StatusFin;
  prioridade: PrioridadeFin;
  resolucao: string | null;
  criado_em: string;
  atualizado_em: string;
  resolvido_em: string | null;
  // Nomes (preenchidos aqui, não vêm da tabela).
  enviado_por_nome?: string | null;
  responsavel_nome?: string | null;
}

export interface EventoFin {
  id: number;
  atendimento_id: string;
  tipo: "criado" | "status" | "responsavel" | "nota" | "conversa" | "devolvido";
  de: string | null;
  para: string | null;
  texto: string | null;
  autor_nome: string | null;
  criado_em: string;
}

async function comNomes(lista: AtendimentoFin[]): Promise<AtendimentoFin[]> {
  const ids = [...new Set(lista.flatMap((a) => [a.enviado_por, a.responsavel_id]).filter(Boolean))] as string[];
  if (!ids.length) return lista;
  const { data } = await supabase.from("qs_users").select("id, name").in("id", ids);
  const nome = new Map(((data ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name]));
  return lista.map((a) => ({ ...a, enviado_por_nome: a.enviado_por ? nome.get(a.enviado_por) ?? null : null, responsavel_nome: a.responsavel_id ? nome.get(a.responsavel_id) ?? null : null }));
}

/** A fila do Financeiro. `abertos` = só o que ainda está com o Financeiro. */
export async function listarAtendimentos(op: { abertos?: boolean; busca?: string; limite?: number } = {}): Promise<AtendimentoFin[]> {
  let q = supabase.from("fin_atendimentos").select("*").order("criado_em", { ascending: false }).limit(op.limite ?? 500);
  if (op.abertos) q = q.in("status", ABERTOS);
  const t = (op.busca || "").replace(/[,()*%\\:"']/g, " ").trim();
  if (t) {
    const d = t.replace(/\D/g, "");
    q = /^#?\d+$/.test(t) && d.length < 6 ? q.eq("numero", Number(d)) : d.length >= 4 && d.length === t.replace(/[\s.\-()+]/g, "").length
      ? q.ilike("telefone", `*${d}*`) : q.or(`nome.ilike.*${t}*,descricao.ilike.*${t}*`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return comNomes((data ?? []) as AtendimentoFin[]);
}

export async function carregarAtendimento(id: string): Promise<{ at: AtendimentoFin | null; eventos: EventoFin[] }> {
  const [a, e] = await Promise.all([
    supabase.from("fin_atendimentos").select("*").eq("id", id).maybeSingle(),
    supabase.from("fin_atendimento_eventos").select("*").eq("atendimento_id", id).order("criado_em", { ascending: true }),
  ]);
  if (a.error) throw new Error(a.error.message);
  const at = a.data ? (await comNomes([a.data as AtendimentoFin]))[0] : null;
  return { at, eventos: (e.data ?? []) as EventoFin[] };
}

/** Os atendimentos de um cliente / lead / conversa (pra mostrar o status a quem mandou). */
export async function atendimentosDe(alvo: { clienteId?: string | null; leadId?: string | null; conversaId?: string | null }): Promise<AtendimentoFin[]> {
  const ors: string[] = [];
  if (alvo.clienteId) ors.push(`cliente_id.eq.${alvo.clienteId}`);
  if (alvo.leadId) ors.push(`lead_id.eq.${alvo.leadId}`);
  if (alvo.conversaId) ors.push(`conversa_id.eq.${alvo.conversaId}`);
  if (!ors.length) return [];
  const { data, error } = await supabase.from("fin_atendimentos").select("*").or(ors.join(",")).order("criado_em", { ascending: false }).limit(20);
  if (error) return [];
  return comNomes((data ?? []) as AtendimentoFin[]);
}

/** Enviar ao Financeiro (qualquer área). Se vier a conversa, ela passa pro Financeiro. */
export async function enviarAoFinanceiro(p: {
  origem: OrigemFin; motivo: MotivoFin; descricao: string; prioridade?: PrioridadeFin;
  clienteId?: string | null; leadId?: string | null; conversaId?: string | null; nome?: string | null; telefone?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("fin_enviar", {
    p_origem: p.origem, p_motivo: p.motivo, p_descricao: p.descricao,
    p_cliente: p.clienteId ?? null, p_lead: p.leadId ?? null, p_conversa: p.conversaId ?? null,
    p_nome: p.nome ?? null, p_telefone: p.telefone ?? null, p_prioridade: p.prioridade ?? "normal",
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function mudarAtendimento(id: string, m: { status?: StatusFin; nota?: string; assumir?: boolean; resolucao?: string }) {
  const { error } = await supabase.rpc("fin_mudar", {
    p_id: id, p_status: m.status ?? null, p_nota: m.nota ?? null, p_assumir: !!m.assumir, p_resolucao: m.resolucao ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function ligarConversa(atendimentoId: string, conversaId: string) {
  const { error } = await supabase.rpc("fin_ligar_conversa", { p_id: atendimentoId, p_conversa: conversaId });
  if (error) throw new Error(error.message);
}

export async function devolverConversa(conversaId: string, nota?: string) {
  const { error } = await supabase.rpc("fin_devolver_conversa", { p_conversa: conversaId, p_nota: nota ?? null });
  if (error) throw new Error(error.message);
}

/** "há 5 min", "há 3 h", "há 2 dias". */
export function haQuanto(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} dia${d > 1 ? "s" : ""}`;
}
