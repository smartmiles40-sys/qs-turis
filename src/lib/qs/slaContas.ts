// src/lib/qs/slaContas.ts — contas puras do SLA (sem rede; testável no node).
// -----------------------------------------------------------------------------
// SLA do 1º atendimento (Bruno, 17/11): RPC qs_sla_painel (0400). A Fila de
// hoje e o Desempenho leem a MESMA resposta — o número é igual nas duas telas.
//   1º toque = tarefa concluída, ligação do webfone ou WhatsApp enviado pelo SDR
//   (o que vier primeiro), medido em minutos ÚTEIS (work_hours).
// -----------------------------------------------------------------------------

export interface BlocoSla {
  recebidos: number; atendidos: number; na_meta: number; fora_meta: number;
  aguardando: number; mediana_min: number | null;
}
export interface LinhaSla { sdr_id: string; nome: string; hoje: BlocoSla; semana: BlocoSla; mes: BlocoSla }
export interface LeadAguardando {
  lead_id: string; nome: string | null; sdr_id: string; sdr_nome: string;
  chegou_em: string; minutos: number;
}
export interface PainelSla {
  meta_min: number; gestor: boolean; gerado_em: string;
  time: { hoje: BlocoSla; semana: BlocoSla; mes: BlocoSla };
  sdrs: LinhaSla[];
  aguardando: LeadAguardando[];
}
export type PeriodoSla = "hoje" | "semana" | "mes";

const B0: BlocoSla = { recebidos: 0, atendidos: 0, na_meta: 0, fora_meta: 0, aguardando: 0, mediana_min: null };
const bloco = (b?: Partial<BlocoSla> | null): BlocoSla => ({
  recebidos: Number(b?.recebidos ?? 0), atendidos: Number(b?.atendidos ?? 0),
  na_meta: Number(b?.na_meta ?? 0), fora_meta: Number(b?.fora_meta ?? 0),
  aguardando: Number(b?.aguardando ?? 0),
  mediana_min: b?.mediana_min === null || b?.mediana_min === undefined ? null : Number(b.mediana_min),
});

export function normalizarPainelSla(d: unknown): PainelSla {
  const r = (d ?? {}) as Partial<PainelSla> & { time?: Partial<Record<PeriodoSla, Partial<BlocoSla>>> };
  return {
    meta_min: Number(r.meta_min ?? 30),
    gestor: !!r.gestor,
    gerado_em: r.gerado_em ?? new Date().toISOString(),
    time: { hoje: bloco(r.time?.hoje), semana: bloco(r.time?.semana), mes: bloco(r.time?.mes) },
    sdrs: (r.sdrs ?? []).map((s) => ({ sdr_id: s.sdr_id, nome: s.nome, hoje: bloco(s.hoje), semana: bloco(s.semana), mes: bloco(s.mes) })),
    aguardando: (r.aguardando ?? []).map((a) => ({ ...a, minutos: Number(a.minutos ?? 0) })),
  };
}

/** % dentro da meta entre os que JÁ contam (atendidos + quem estourou esperando). */
export function pctNaMeta(b: BlocoSla): number | null {
  const base = b.na_meta + b.fora_meta;
  return base > 0 ? b.na_meta / base : null;
}

export type TomSla = "ok" | "warn" | "danger" | "neutro";
/** Cor do SLA: mediana dentro da meta e ≥ 70% no prazo = ok; estourou = danger. */
export function tomSla(b: BlocoSla, meta: number): TomSla {
  const p = pctNaMeta(b);
  if (p === null && b.mediana_min === null) return "neutro";
  if ((b.mediana_min !== null && b.mediana_min > meta) || (p !== null && p < 0.5)) return "danger";
  if (p !== null && p < 0.7) return "warn";
  return "ok";
}

/** Tom de um lead esperando: verde até 2/3 da meta, amarelo até a meta, vermelho depois. */
export function tomEspera(minutos: number, meta: number): TomSla {
  if (minutos > meta) return "danger";
  if (minutos >= (meta * 2) / 3) return "warn";
  return "ok";
}

export function minutosTxt(min: number | null): string {
  if (min === null || min === undefined) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  // Horas ÚTEIS: não vira "dias" (24h úteis ≠ 1 dia de calendário).
  const h = Math.floor(min / 60);
  if (h >= 10) return `${h}h`;
  const r = Math.round(min % 60);
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

export const pctSla = (p: number | null) => (p === null ? "—" : `${Math.round(p * 100)}%`);

export { B0 as BLOCO_SLA_VAZIO };
