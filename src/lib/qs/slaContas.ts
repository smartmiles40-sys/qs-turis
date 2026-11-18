// src/lib/qs/slaContas.ts — contas puras do SLA (sem rede; testável no node).
// -----------------------------------------------------------------------------
// SLA do 1º atendimento (Bruno, 17/11): RPC qs_sla_painel (0400). A Fila de
// hoje e o Desempenho leem a MESMA resposta — o número é igual nas duas telas.
//   1º toque = tarefa concluída, ligação do webfone ou WhatsApp enviado pelo SDR
//   (o que vier primeiro), medido em minutos ÚTEIS (work_hours).
//   0405 (18/11): ligação marcada pelo cliente conta a partir da HORA MARCADA;
//   enquanto ela não chega o lead fica em "marcadas", não em "aguardando".
// -----------------------------------------------------------------------------

export interface BlocoSla {
  recebidos: number; atendidos: number; na_meta: number; fora_meta: number;
  aguardando: number; mediana_min: number | null;
  /** 0405: ligações marcadas pelo cliente cuja hora ainda não chegou (fora do "aguardando"). */
  marcadas: number;
}
export interface LinhaSla { sdr_id: string; nome: string; hoje: BlocoSla; semana: BlocoSla; mes: BlocoSla; faixa: BlocoSla }
export interface LeadAguardando {
  lead_id: string; nome: string | null; sdr_id: string; sdr_nome: string;
  chegou_em: string; minutos: number;
  /** 0405: hora que o cliente marcou (a espera conta a partir dela). */
  marcada_para?: string | null;
  /** 0405: lead sem nenhuma tarefa aberta — não aparece na Fila do SDR. */
  sem_tarefa?: boolean;
}
/** 0405: ligação marcada pelo cliente com hora ainda no futuro. */
export interface LeadMarcado {
  lead_id: string; nome: string | null; sdr_id: string; sdr_nome: string;
  chegou_em: string; marcada_para: string;
}
export type CanalToque = "ligacao" | "whatsapp" | "tarefa";
export interface LeadAtendido {
  lead_id: string; nome: string | null; sdr_id: string; sdr_nome: string;
  chegou_em: string; atendido_em: string; canal: CanalToque; minutos: number;
  marcada_para?: string | null;
}
export const ROTULO_CANAL: Record<CanalToque, string> = { ligacao: "Ligação", whatsapp: "WhatsApp", tarefa: "Tarefa concluída" };

export interface PainelSla {
  meta_min: number; gestor: boolean; gerado_em: string;
  time: { hoje: BlocoSla; semana: BlocoSla; mes: BlocoSla; faixa: BlocoSla };
  /** Intervalo do bloco "faixa" (0401). faixa_ok=false = banco ainda sem a 0401. */
  faixa_de: string | null; faixa_ate: string | null; faixa_ok: boolean;
  sdrs: LinhaSla[];
  aguardando: LeadAguardando[];
  /** 0405: ligações marcadas que ainda não chegaram na hora (mais próxima primeiro). */
  marcadas: LeadMarcado[];
  /** Cada cliente atendido no mês (mais recente primeiro). */
  atendidos: LeadAtendido[];
}
export type PeriodoSla = "hoje" | "semana" | "mes";

const B0: BlocoSla = { recebidos: 0, atendidos: 0, na_meta: 0, fora_meta: 0, aguardando: 0, mediana_min: null, marcadas: 0 };
const bloco = (b?: Partial<BlocoSla> | null): BlocoSla => ({
  recebidos: Number(b?.recebidos ?? 0), atendidos: Number(b?.atendidos ?? 0),
  na_meta: Number(b?.na_meta ?? 0), fora_meta: Number(b?.fora_meta ?? 0),
  aguardando: Number(b?.aguardando ?? 0), marcadas: Number(b?.marcadas ?? 0),
  mediana_min: b?.mediana_min === null || b?.mediana_min === undefined ? null : Number(b.mediana_min),
});

export function normalizarPainelSla(d: unknown): PainelSla {
  const r = (d ?? {}) as Omit<Partial<PainelSla>, "time" | "sdrs"> & {
    time?: Partial<Record<PeriodoSla | "faixa", Partial<BlocoSla>>>;
    sdrs?: (Partial<Record<PeriodoSla | "faixa", Partial<BlocoSla>>> & { sdr_id: string; nome: string })[];
  };
  const ok = !!r.time?.faixa;
  return {
    meta_min: Number(r.meta_min ?? 30),
    gestor: !!r.gestor,
    gerado_em: r.gerado_em ?? new Date().toISOString(),
    time: { hoje: bloco(r.time?.hoje), semana: bloco(r.time?.semana), mes: bloco(r.time?.mes), faixa: bloco(r.time?.faixa ?? r.time?.mes) },
    faixa_de: r.faixa_de ?? null, faixa_ate: r.faixa_ate ?? null, faixa_ok: ok,
    sdrs: (r.sdrs ?? []).map((s) => ({ sdr_id: s.sdr_id, nome: s.nome, hoje: bloco(s.hoje), semana: bloco(s.semana), mes: bloco(s.mes), faixa: bloco(s.faixa ?? s.mes) })),
    aguardando: (r.aguardando ?? []).map((a) => ({ ...a, minutos: Number(a.minutos ?? 0), sem_tarefa: !!a.sem_tarefa })),
    marcadas: r.marcadas ?? [],
    atendidos: (r.atendidos ?? []).map((a) => ({ ...a, minutos: Number(a.minutos ?? 0) })),
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

/** Farol do atendimento (sugestão do Everton, 18/11): o mesmo tom em palavra. */
export const ROTULO_FAROL: Record<TomSla, string> = { ok: "Bom", warn: "Médio", danger: "Ruim", neutro: "Sem dados" };
export const farolSla = (b: BlocoSla, meta: number): string => ROTULO_FAROL[tomSla(b, meta)];

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

/** Início (ISO) de cada período no fuso de SP — o mesmo corte do banco (semana começa na segunda). */
export function inicioPeriodoSla(p: PeriodoSla, agora: Date = new Date()): number {
  const hoje = agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [y, m, d] = hoje.split("-").map(Number);
  let dia = hoje;
  if (p === "semana") {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
    dia = new Date(Date.UTC(y, m - 1, d - (dow - 1))).toISOString().slice(0, 10);
  } else if (p === "mes") dia = hoje.slice(0, 8) + "01";
  return new Date(dia + "T00:00:00-03:00").getTime();
}

/** Atendidos que chegaram entre de e ate (datas SP, inclusivas). */
export function atendidosDaFaixa(lista: LeadAtendido[], de: string, ate: string, sdrId: string | null): LeadAtendido[] {
  const ini = new Date(de + "T00:00:00-03:00").getTime();
  const fim = new Date(ate + "T00:00:00-03:00").getTime() + 86_400_000;
  return lista.filter((a) => { const t = new Date(a.chegou_em).getTime(); return t >= ini && t < fim && (!sdrId || a.sdr_id === sdrId); });
}

export function atendidosDoPeriodo(lista: LeadAtendido[], p: PeriodoSla, sdrId: string | null, agora: Date = new Date()): LeadAtendido[] {
  const ini = inicioPeriodoSla(p, agora);
  return lista.filter((a) => new Date(a.chegou_em).getTime() >= ini && (!sdrId || a.sdr_id === sdrId));
}
