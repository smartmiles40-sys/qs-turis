// src/rel/lib/faxina.ts
// -----------------------------------------------------------------------------
// FAXINA DAS VIAGENS (0208, 27/10/2026). Bruno: "ajustar todas as viagens antes
// de subir qualquer coisa". As filas de arrumação ganharam ajuda do banco:
//
//   Classificar → sugestão do que foi vendido (com a regra) + "usar sugestões"
//   Sem data    → datas pelos voos, em lote, pra quem já tem voo cadastrado
//   Sem dono    → distribuir entre o time, equilibrando a carga
//   Repetidas   → procurar pares novos (mesma pessoa, ida a ≤3 dias) e marcar
//                 pra a tela "Conferir repetidas" (0134a)
//   Componentes → seguro/hotel/passeio vendido à parte vira item da viagem
//
// Tudo chama funções do banco que conferem a permissão e gravam o histórico.
// Antes da 0208 aplicada, cada chamada responde "falta aplicar a 0208" — as
// telas continuam funcionando com o que já existia (0184).
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { Servico } from "./viagens";

export const FALTA_0208 = "Falta aplicar a atualização do banco (migration 0208). Avise o Bruno.";

/** true quando o erro é "a função/view ainda não existe" (migration não aplicada). */
export function faltaMigration(e: { message?: string; code?: string } | null | undefined): boolean {
  const m = e?.message ?? "";
  return e?.code === "42P01" || e?.code === "42883" || e?.code === "PGRST202" || e?.code === "PGRST205" || /could not find|schema cache|does not exist/i.test(m);
}

function erroLegivel(e: { message?: string; code?: string } | null): Error {
  if (faltaMigration(e)) return new Error(FALTA_0208);
  const m = e?.message || "Falhou.";
  if (/row-level|permission denied/i.test(m)) return new Error("Sem permissão para isso.");
  return new Error(m);
}

// ── Resumo (os números de cada fila) ────────────────────────────────────────

export interface ResumoFaxina {
  ativas: number;
  sem_dono: number;
  classificar: number;
  classificar_futuras: number;
  classificar_com_sugestao: number;
  sem_data: number;
  sem_data_com_voo: number;
  sem_cliente: number;
  repetidas_marcadas: number;
  repetidas_candidatas: number;
  componentes_soltos: number;
}

/** null = a 0208 ainda não foi aplicada (a tela usa as contagens antigas). */
export async function resumoFaxina(): Promise<ResumoFaxina | null> {
  const { data, error } = await supabase.from("rel_faxina_resumo").select("*").maybeSingle();
  if (error) { if (faltaMigration(error)) return null; throw error; }
  return data as ResumoFaxina | null;
}

// ── Classificar: sugestões ──────────────────────────────────────────────────

export interface Sugestao { servico: Servico; regra: string; confianca: "alta" | "media" }

export async function sugestoesDeServico(ids: string[]): Promise<Map<string, Sugestao>> {
  const m = new Map<string, Sugestao>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("rel_faxina_classificar_v").select("id, sugestao, regra, confianca")
      .in("id", ids.slice(i, i + 200)).not("sugestao", "is", null);
    if (error) { if (faltaMigration(error)) return m; throw error; }
    for (const r of (data ?? []) as { id: string; sugestao: Servico; regra: string; confianca: "alta" | "media" }[]) {
      m.set(r.id, { servico: r.sugestao, regra: r.regra, confianca: r.confianca });
    }
  }
  return m;
}

/** Aplica a sugestão nas marcadas (null = toda a fila, só gestão). Devolve quantas mudaram. */
export async function classificarPelasSugestoes(ids: string[] | null, confianca: "alta" | "media"): Promise<number> {
  const { data, error } = await supabase.rpc("rel_classificar_pelas_sugestoes", { p_ids: ids, p_confianca: confianca });
  if (error) throw erroLegivel(error);
  return Number(data ?? 0);
}

// ── Sem data: datas pelos voos ──────────────────────────────────────────────

export async function datasPelosVoosEmLote(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const { data, error } = await supabase.rpc("rel_datas_pelos_voos_lote", { p_ids: ids });
  if (error) throw erroLegivel(error);
  return Number(data ?? 0);
}

// ── Sem dono: distribuir ────────────────────────────────────────────────────

export async function distribuirDonos(ids: string[], pessoas: string[]): Promise<number> {
  if (!ids.length || !pessoas.length) return 0;
  const { data, error } = await supabase.rpc("rel_distribuir_donos", { p_ids: ids, p_pessoas: pessoas });
  if (error) throw erroLegivel(error);
  return Number(data ?? 0);
}

// ── Repetidas ───────────────────────────────────────────────────────────────

export interface ParRepetido {
  viagem_a: string; viagem_b: string; cliente_nome: string | null;
  titulo_a: string; titulo_b: string; ida_a: string; ida_b: string;
  deal_a: string | null; deal_b: string | null; marcar: string; futura: boolean; ja_marcada: boolean;
}

export async function paresRepetidos(): Promise<ParRepetido[]> {
  const { data, error } = await supabase.from("rel_faxina_repetidas_v").select("*").eq("ja_marcada", false)
    .order("futura", { ascending: false }).order("ida_a").limit(300);
  if (error) throw erroLegivel(error);
  return (data ?? []) as ParRepetido[];
}

export async function marcarRepetidas(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const { data, error } = await supabase.rpc("rel_marcar_repetidas", { p_ids: ids });
  if (error) throw erroLegivel(error);
  return Number(data ?? 0);
}

// ── Vendas soltas que são componente de outra viagem ────────────────────────

export interface ComponenteSolto {
  avulsa_id: string; principal_id: string; cliente_nome: string | null;
  avulsa_titulo: string; avulsa_servico: string; avulsa_ida: string; avulsa_deal: string | null;
  principal_titulo: string; principal_servico: string | null; principal_ida: string; principal_deal: string | null;
  futura: boolean;
}

export async function componentesSoltos(): Promise<ComponenteSolto[]> {
  const { data, error } = await supabase.from("rel_faxina_componentes_v").select("*")
    .order("futura", { ascending: false }).order("principal_ida").limit(300);
  if (error) throw erroLegivel(error);
  return (data ?? []) as ComponenteSolto[];
}

/** A venda solta vira item da principal e é arquivada (desfazer: Arquivadas → Desarquivar). */
export async function anexarComoComponente(principalId: string, avulsaId: string): Promise<string> {
  const { data, error } = await supabase.rpc("rel_anexar_como_componente", { p_principal: principalId, p_avulsa: avulsaId });
  if (error) throw erroLegivel(error);
  return String(data);
}
