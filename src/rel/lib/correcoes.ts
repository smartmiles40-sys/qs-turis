// src/rel/lib/correcoes.ts
// -----------------------------------------------------------------------------
// CORREÇÃO MANUAL DA VIAGEM PELA TELA (0227, Bruno 30/10/2026: "quando há
// inconsistência eu tenho que alterar por código, e isso não é a forma correta").
// Toda correção passa por uma função do banco que grava quem, quando, o valor
// anterior e o motivo (rel_viagem_correcoes) — e dá pra desfazer. O automático
// (Bitrix, Expedições, IA) respeita o que foi corrigido à mão.
// Sem a 0227 no banco, `correcaoDisponivel` responde false e a tela só avisa.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { FaseReal, SituacaoManualTrecho } from "./statusViagem";

export type AcaoCorrecao = "trecho_editado" | "trecho_situacao" | "trecho_checkin" | "datas" | "status_manual" | "alerta_ignorado";

export const ROTULO_ACAO: Record<AcaoCorrecao, string> = {
  trecho_editado: "Trecho corrigido",
  trecho_situacao: "Situação do trecho",
  trecho_checkin: "Check-in",
  datas: "Datas da viagem",
  status_manual: "Status da viagem",
  alerta_ignorado: "Alerta",
};

export interface Correcao {
  id: string;
  trecho_id: string | null;
  acao: AcaoCorrecao;
  antes: Record<string, unknown>;
  depois: Record<string, unknown>;
  motivo: string | null;
  feito_por: string | null;
  feito_por_nome: string | null;
  feito_em: string;
  desfeita_em: string | null;
  desfeita_por_nome: string | null;
}

/** Campos do trecho que a correção mexe (os mesmos da rel_corrigir_trecho). */
export interface CamposTrecho {
  tipo?: string;
  partida_em?: string;
  chegada_em?: string | null;
  partida_fuso?: string | null;
  chegada_fuso?: string | null;
  origem?: string | null;
  destino?: string | null;
  origem_codigo?: string | null;
  destino_codigo?: string | null;
  companhia?: string | null;
  numero?: string | null;
  localizador?: string | null;
}

const semFuncao = (m: string) => /could not find the function|function .* does not exist|PGRST202/i.test(m);
function erro(e: { message: string } | null): never | void {
  if (!e) return;
  if (semFuncao(e.message)) throw new Error("A correção manual ainda não está no banco (falta aplicar a migration 0227).");
  throw new Error(e.message);
}

/** A 0227 está no banco? (a view traz fase_auto). Sem ela, a tela só mostra. */
export function correcaoDisponivel(v: object | null | undefined): boolean {
  return !!v && "fase_auto" in v;
}

export async function corrigirTrecho(trechoId: string, campos: CamposTrecho, motivo: string) {
  const { error } = await supabase.rpc("rel_corrigir_trecho", { p_trecho: trechoId, p_campos: campos, p_motivo: motivo });
  erro(error);
}

export async function situacaoDoTrecho(trechoId: string, situacao: SituacaoManualTrecho | null, motivo: string) {
  const { error } = await supabase.rpc("rel_trecho_situacao", { p_trecho: trechoId, p_situacao: situacao, p_motivo: motivo });
  erro(error);
}

export async function checkinDoTrecho(trechoId: string, feito: boolean) {
  const { error } = await supabase.rpc("rel_trecho_checkin", { p_trecho: trechoId, p_feito: feito });
  erro(error);
}

export async function corrigirDatas(viagemId: string, embarque: string | null, retorno: string | null, motivo: string) {
  const { error } = await supabase.rpc("rel_viagem_corrigir_datas", { p_viagem: viagemId, p_embarque: embarque, p_retorno: retorno, p_motivo: motivo });
  erro(error);
}

export async function statusManual(viagemId: string, fase: Exclude<FaseReal, "cancelada" | "sem_data"> | null, motivo: string, ate: string | null = null) {
  const { error } = await supabase.rpc("rel_viagem_status_manual", { p_viagem: viagemId, p_fase: fase, p_motivo: motivo, p_ate: ate });
  erro(error);
}

export async function ignorarAlerta(viagemId: string, chave: string, motivo: string, ignorar = true) {
  const { error } = await supabase.rpc("rel_viagem_ignorar_alerta", { p_viagem: viagemId, p_chave: chave, p_motivo: motivo, p_ignorar: ignorar });
  erro(error);
}

export async function desfazerCorrecao(id: string) {
  const { error } = await supabase.rpc("rel_desfazer_correcao", { p_correcao: id });
  erro(error);
}

export async function correcoesDaViagem(viagemId: string): Promise<Correcao[]> {
  const { data, error } = await supabase.rpc("rel_correcoes_da_viagem", { p_viagem: viagemId });
  if (error) { if (semFuncao(error.message)) return []; throw new Error(error.message); }
  return (data ?? []) as Correcao[];
}

const CAMPO_LEGIVEL: Record<string, string> = {
  tipo: "tipo", partida_em: "partida", chegada_em: "chegada", origem: "origem", destino: "destino", origem_codigo: "cód. origem",
  destino_codigo: "cód. destino", numero: "nº do voo", companhia: "companhia", localizador: "localizador", partida_fuso: "fuso da partida",
  chegada_fuso: "fuso da chegada", status_manual: "situação", checkin_feito_em: "check-in", data_embarque: "ida", data_retorno: "volta",
  fase_manual: "status", fase_manual_ate: "status até", alertas_ignorados: "alertas ignorados",
};
const IGNORAR = new Set(["corrigido_em", "corrigido_por", "status_manual_por", "status_manual_em", "status_manual_motivo", "checkin_feito_por",
  "fase_manual_por", "fase_manual_em", "fase_manual_motivo", "datas_travadas"]);

function valorLegivel(k: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (k === "alertas_ignorados") return `${Object.keys(v as object).length} ignorado(s)`;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  return String(v);
}

/** "partida: 21/03/26 00:00 → 05/06/27 00:00 · situação: — → cancelado" */
export function oQueMudou(c: Pick<Correcao, "antes" | "depois">): string {
  const ks = Object.keys(c.depois).filter((k) => !IGNORAR.has(k) && JSON.stringify(c.antes[k] ?? null) !== JSON.stringify(c.depois[k] ?? null));
  return ks.map((k) => `${CAMPO_LEGIVEL[k] ?? k}: ${valorLegivel(k, c.antes[k])} → ${valorLegivel(k, c.depois[k])}`).join(" · ") || "sem mudança";
}
