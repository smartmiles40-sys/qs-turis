// src/lib/qs/desempenho.ts
// -----------------------------------------------------------------------------
// Desempenho SDR (spec 06/11, Fases 3–4): tipos do RPC qs_desempenho (0322) e
// as contas puras das telas. As páginas 1 e 2 leem a MESMA resposta — é isso
// que garante "o mesmo número em todas as telas".
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { intervaloFunil } from "./funil";
import { normalizarBloco, type BlocoDesempenho, type Desempenho } from "./desempenhoContas";
export * from "./desempenhoContas";

export async function fetchDesempenho(de: string, ate: string): Promise<Desempenho> {
  const { data, error } = await supabase.rpc("qs_desempenho" as never, { p_de: de, p_ate: ate } as never);
  if (error) throw error;
  const d = (data ?? {}) as Partial<Desempenho> & { time?: Partial<BlocoDesempenho>; sdrs?: (Partial<BlocoDesempenho> & { sdr_id: string; nome: string })[] };
  return {
    de, ate,
    gestor: !!d.gestor,
    meta_sla_min: Number(d.meta_sla_min ?? 30),
    gerado_em: d.gerado_em ?? new Date().toISOString(),
    time: normalizarBloco(d.time),
    sdrs: (d.sdrs ?? []).map((s) => ({ ...normalizarBloco(s), sdr_id: s.sdr_id, nome: s.nome })),
    velocidade: d.velocidade ?? [],
    cotacoes_perda: d.cotacoes_perda ?? [],
    cotacoes_closers: d.cotacoes_closers ?? [],
    closers_pendentes: d.closers_pendentes ?? [],
  };
}

// ── Período ──────────────────────────────────────────────────────────────────

export type PeriodoDesempenho = "hoje" | "semana" | "mes" | "mes_passado";
export const PERIODOS_DESEMPENHO: { id: PeriodoDesempenho; rotulo: string }[] = [
  { id: "hoje", rotulo: "Hoje" },
  { id: "semana", rotulo: "Semana" },
  { id: "mes", rotulo: "Mês atual" },
  { id: "mes_passado", rotulo: "Mês passado" },
];
export function intervaloDesempenho(p: PeriodoDesempenho): { de: string; ate: string } {
  if (p === "hoje") {
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    return { de: hoje, ate: hoje };
  }
  return intervaloFunil(p);
}
export const rotuloPeriodo = (p: PeriodoDesempenho) =>
  ({ hoje: "de hoje", semana: "da semana", mes: "do mês", mes_passado: "do mês passado" })[p];

// ── Página 3 · Operação (0323) ───────────────────────────────────────────────

export interface Ligacoes { ligacoes: number; atendidas: number; leads_ligados: number; media_atendida_seg: number | null; total_conversa_seg: number }
export interface Conversa { leads_coorte: number; com_conversa: number; tentativas_ate_conversa: number | null; horas_ate_conversa: number | null }
export interface Operacao {
  time: { ligacoes: Ligacoes; conversa: Conversa };
  sdrs: { sdr_id: string; nome: string; ligacoes: Ligacoes; conversa: Conversa }[];
  entrada_dia: { dia: string; dow: number; leads: number; novos: number }[];
  heatmap: { dow: number; hora: number; ligacoes: number; atendidas: number }[];
}
const LIG0: Ligacoes = { ligacoes: 0, atendidas: 0, leads_ligados: 0, media_atendida_seg: null, total_conversa_seg: 0 };
const CON0: Conversa = { leads_coorte: 0, com_conversa: 0, tentativas_ate_conversa: null, horas_ate_conversa: null };

export async function fetchOperacao(de: string, ate: string, sdrId: string | null): Promise<Operacao> {
  const { data, error } = await supabase.rpc("qs_desempenho_operacao" as never, { p_de: de, p_ate: ate, p_sdr: sdrId } as never);
  if (error) throw error;
  const d = (data ?? {}) as Partial<Operacao> & { time?: { ligacoes?: Partial<Ligacoes>; conversa?: Partial<Conversa> } };
  return {
    time: { ligacoes: { ...LIG0, ...(d.time?.ligacoes ?? {}) }, conversa: { ...CON0, ...(d.time?.conversa ?? {}) } },
    sdrs: (d.sdrs ?? []).map((s) => ({ ...s, ligacoes: { ...LIG0, ...(s.ligacoes ?? {}) }, conversa: { ...CON0, ...(s.conversa ?? {}) } })),
    entrada_dia: d.entrada_dia ?? [],
    heatmap: d.heatmap ?? [],
  };
}

export interface GravacaoRecente {
  id: string; lead_id: string | null; sdr_id: string; telefone: string | null; inicio: string; duracao_seg: number;
  storage_path: string; lead?: { full_name: string | null } | null; sdr?: { name: string | null } | null;
}
/** Ligações gravadas do período (RLS: SDR só as próprias). */
export async function fetchGravacoesRecentes(de: string, ate: string, sdrId: string | null): Promise<GravacaoRecente[]> {
  let q = supabase
    .from("qs_ligacao_gravacoes")
    .select("id,lead_id,sdr_id,telefone,inicio,duracao_seg,storage_path,lead:qs_leads(full_name),sdr:qs_users!qs_ligacao_gravacoes_sdr_id_fkey(name)")
    .gte("inicio", `${de}T00:00:00-03:00`)
    .lt("inicio", `${ate}T23:59:59-03:00`)
    .order("inicio", { ascending: false })
    .limit(25);
  if (sdrId) q = q.eq("sdr_id", sdrId);
  const { data, error } = await q;
  if (error) { console.warn("[desempenho] gravações:", error); return []; }
  return (data ?? []) as unknown as GravacaoRecente[];
}
