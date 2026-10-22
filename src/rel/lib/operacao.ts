// src/rel/lib/operacao.ts
// -----------------------------------------------------------------------------
// OPERAR A VIAGEM (0184, 22/10/2026). O time conversava no WhatsApp mas não
// operava a viagem no sistema: nenhuma viagem tinha dono, nenhuma etapa da
// Esteira foi concluída, ninguém anotava preferências. Aqui ficam as peças:
//
//   DONO        — "Assumir" / "Atribuir a…" (uma por vez: qualquer um do time;
//                 várias de uma vez: a gestão). Tudo vira histórico.
//   FILAS       — Classificar em lote (o serviço vendido) e arquivar em lote a
//                 fila "Sem data", com motivo e DESFAZER (só a gestão).
//   PREFERÊNCIAS — gostos, alergias, restrições, ocasião especial… da viagem.
//
// As mudanças em lote passam por funções do banco (rel_atribuir_viagens,
// rel_classificar_viagens, rel_arquivar_viagens, rel_desarquivar_viagens) que
// conferem quem está pedindo e gravam o histórico em rel_viagem_eventos.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { Servico, Viagem } from "./viagens";

function erroLegivel(e: { message?: string } | null): Error {
  const m = e?.message || "Falhou.";
  if (/row-level|permission denied/i.test(m)) return new Error("Sem permissão para isso.");
  return new Error(m);
}

// ── Dono ────────────────────────────────────────────────────────────────────

/** Muda o responsável de uma ou várias viagens (null = tirar o dono). Devolve quantas mudaram. */
export async function atribuirViagens(ids: string[], responsavelId: string | null): Promise<number> {
  if (!ids.length) return 0;
  const { data, error } = await supabase.rpc("rel_atribuir_viagens", { p_ids: ids, p_responsavel: responsavelId });
  if (error) throw erroLegivel(error);
  return Number(data ?? 0);
}

// ── Filas em lote ───────────────────────────────────────────────────────────

/** Fila Classificar: o mesmo serviço pra várias vendas de uma vez. */
export async function classificarEmLote(ids: string[], servico: Servico | null): Promise<number> {
  if (!ids.length) return 0;
  const { data, error } = await supabase.rpc("rel_classificar_viagens", { p_ids: ids, p_servico: servico });
  if (error) throw erroLegivel(error);
  return Number(data ?? 0);
}

/** Fila Sem data: arquiva várias com um motivo. Devolve o número do lote (pra desfazer). */
export async function arquivarViagens(ids: string[], motivo: string): Promise<string | null> {
  if (!ids.length) return null;
  const { data, error } = await supabase.rpc("rel_arquivar_viagens", { p_ids: ids, p_motivo: motivo });
  if (error) throw erroLegivel(error);
  return (data as string | null) ?? null;
}

/** Desfaz um lote inteiro ou desarquiva viagens soltas. */
export async function desarquivarViagens(p: { lote?: string | null; ids?: string[] }): Promise<number> {
  const { data, error } = await supabase.rpc("rel_desarquivar_viagens", { p_lote: p.lote ?? null, p_ids: p.ids?.length ? p.ids : null });
  if (error) throw erroLegivel(error);
  return Number(data ?? 0);
}

/** "Venda há mais de 12 meses ou sem data de venda" — a sugestão pra arquivar na fila Sem data. */
export function sugeridaParaArquivar(v: Pick<Viagem, "data_venda">, hoje = new Date()): boolean {
  if (!v.data_venda) return true;
  const limite = new Date(hoje);
  limite.setFullYear(limite.getFullYear() - 1);
  return v.data_venda < limite.toISOString().slice(0, 10);
}

export interface Arquivada { id: string; arquivado_em: string | null; arquivado_motivo: string | null; arquivado_lote: string | null; arquivado_por: string | null }

/** Os dados do arquivamento (a view rel_viagens_v não tem essas colunas). */
export async function arquivamentosDe(ids: string[]): Promise<Map<string, Arquivada>> {
  const m = new Map<string, Arquivada>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("rel_viagens").select("id, arquivado_em, arquivado_motivo, arquivado_lote, arquivado_por").in("id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const r of (data ?? []) as Arquivada[]) m.set(r.id, r);
  }
  return m;
}

// ── Histórico ───────────────────────────────────────────────────────────────

export interface EventoViagem { id: number; viagem_id: string; tipo: "dono" | "servico" | "arquivada" | "desarquivada"; de: string | null; para: string | null; motivo: string | null; lote: string | null; por: string | null; em: string }

export async function eventosDaViagem(viagemId: string): Promise<EventoViagem[]> {
  const { data, error } = await supabase.from("rel_viagem_eventos").select("*").eq("viagem_id", viagemId).order("em", { ascending: false }).limit(30);
  if (error) throw error;
  return (data ?? []) as EventoViagem[];
}

// ── Preferências ────────────────────────────────────────────────────────────

export interface Preferencias {
  gostos?: string;
  alergias?: string;
  restricoes?: string;
  ocasiao?: string;
  ocasiao_data?: string;
  outros?: string;
  /** "conversei e não tem nada pra anotar" — tira o alerta */
  nada_a_registrar?: boolean;
  por?: string | null;
  em?: string | null;
}

export const CAMPOS_PREF: { id: keyof Pick<Preferencias, "gostos" | "alergias" | "restricoes" | "ocasiao" | "outros">; rotulo: string; dica: string }[] = [
  { id: "alergias", rotulo: "Alergias e saúde", dica: "Ex.: alergia a camarão; usa CPAP; diabético" },
  { id: "restricoes", rotulo: "Restrições (alimentação, mobilidade)", dica: "Ex.: vegetariana; precisa de cadeira de rodas no aeroporto" },
  { id: "ocasiao", rotulo: "Ocasião especial", dica: "Ex.: lua de mel; aniversário de casamento; 60 anos" },
  { id: "gostos", rotulo: "Gostos e preferências", dica: "Ex.: ama vinho; prefere janela; cama de casal; quarto alto" },
  { id: "outros", rotulo: "Outros cuidados", dica: "Ex.: primeira viagem internacional; medo de avião" },
];

/** Mesma regra do rel_preferencias_vazias() do banco (alerta "faltam preferências"). */
export function preferenciasVazias(p: Preferencias | null | undefined, necessidades?: string | null): boolean {
  if (p?.nada_a_registrar) return false;
  if ((necessidades ?? "").trim()) return false;
  return !CAMPOS_PREF.some((c) => (p?.[c.id] ?? "").trim());
}

/** As preferências de várias viagens (pra marcar "faltam preferências" nas listas). */
export async function preferenciasDe(ids: string[]): Promise<Map<string, { preferencias: Preferencias; necessidades: string | null }>> {
  const m = new Map<string, { preferencias: Preferencias; necessidades: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("rel_viagens").select("id, preferencias, necessidades").in("id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const r of (data ?? []) as { id: string; preferencias: Preferencias | null; necessidades: string | null }[]) m.set(r.id, { preferencias: r.preferencias ?? {}, necessidades: r.necessidades });
  }
  return m;
}

export async function salvarPreferencias(viagemId: string, p: Preferencias, userId: string) {
  const limpo: Preferencias = { nada_a_registrar: !!p.nada_a_registrar, por: userId || null, em: new Date().toISOString() };
  for (const c of CAMPOS_PREF) { const t = (p[c.id] ?? "").trim(); if (t) limpo[c.id] = t; }
  if (p.ocasiao_data) limpo.ocasiao_data = p.ocasiao_data;
  const { error } = await supabase.from("rel_viagens").update({ preferencias: limpo }).eq("id", viagemId);
  if (error) throw erroLegivel(error);
}

/** Até quantos dias antes do embarque cobramos as preferências (igual ao alerta do banco). */
export const PREF_DIAS_ANTES = 30;
