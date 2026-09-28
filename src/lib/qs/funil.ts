// src/lib/qs/funil.ts
// -----------------------------------------------------------------------------
// O FUNIL POR SDR — o lado do navegador (a conta mora na 0095, qs_funil_sdr).
//
// Aqui só se TRADUZ: taxas de cada etapa, comparação com o time e o
// diagnóstico em uma frase ("vaza em…"). Nenhum número é recalculado a partir
// de listas — a Visão Geral antiga fazia isso em 3 lugares e cada um dava um
// resultado.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";

export interface Par { n: number; marcou: number }

export interface LinhaFunil {
  sdr_id?: string;
  nome?: string;
  recebidos: number;
  novos: number;
  retornos: number;
  trabalhou: number;
  falou: number;
  marcou: number;
  aconteceu: number;
  noshow: number;
  cancelou: number;
  futura: number;
  tent_media: number | null;
  em_fup: number;
  perdidos: number;
  medidos_1o: number;
  ate5min: number;
  mediana_1o_min: number | null;
  temperatura: Record<"quente" | "morno" | "frio" | "sem", Par>;
  fontes: Record<"trafego" | "live" | "organico" | "outros", Par>;
  atrasadas?: number;
  fila_hoje?: number;
}

export interface Funil {
  de: string;
  ate: string;
  gestor: boolean;
  time: LinhaFunil | null;
  sdrs: LinhaFunil[];
  velocidade: { faixa: string; ordem: number; leads: number; marcou: number }[];
  closers: { nome: string; desfechos_atrasados: number }[];
  eu: { atrasadas: number; fila_hoje: number };
}

export async function fetchFunil(de: string, ate: string): Promise<Funil> {
  const { data, error } = await supabase.rpc("qs_funil_sdr", { p_de: de, p_ate: ate });
  if (error) throw error;
  const d = (data ?? {}) as Partial<Funil>;
  return {
    de, ate,
    gestor: !!d.gestor,
    time: (d.time as LinhaFunil) ?? null,
    sdrs: (d.sdrs ?? []) as LinhaFunil[],
    velocidade: d.velocidade ?? [],
    closers: d.closers ?? [],
    eu: d.eu ?? { atrasadas: 0, fila_hoje: 0 },
  };
}

// ── Etapas ───────────────────────────────────────────────────────────────────

export type EtapaId = "trabalhou" | "falou" | "marcou" | "aconteceu";

export interface Etapa {
  id: EtapaId | "recebeu";
  rotulo: string;
  ajuda: string;
  n: number;
  /** Taxa da etapa sobre a anterior (0–100). Nula na primeira. */
  taxa: number | null;
  taxaTime: number | null;
}

const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);

/** "Aconteceu" só conta reunião que já teve data — a futura ainda não perdeu. */
function baseAconteceu(l: LinhaFunil) {
  return Math.max(0, l.marcou - l.futura);
}

export function taxas(l: LinhaFunil): Record<EtapaId, number | null> {
  return {
    trabalhou: pct(l.trabalhou, l.recebidos),
    falou: pct(l.falou, l.trabalhou),
    marcou: pct(l.marcou, l.falou),
    aconteceu: pct(l.aconteceu, baseAconteceu(l)),
  };
}

export function etapas(l: LinhaFunil, time: LinhaFunil | null): Etapa[] {
  const eu = taxas(l);
  const t = time ? taxas(time) : null;
  return [
    { id: "recebeu", rotulo: "Recebeu", ajuda: "leads que chegaram pra você", n: l.recebidos, taxa: null, taxaTime: null },
    { id: "trabalhou", rotulo: "Trabalhou", ajuda: "teve ao menos 1 atividade", n: l.trabalhou, taxa: eu.trabalhou, taxaTime: t?.trabalhou ?? null },
    { id: "falou", rotulo: "Falou com o lead", ajuda: "dos trabalhados", n: l.falou, taxa: eu.falou, taxaTime: t?.falou ?? null },
    { id: "marcou", rotulo: "Marcou reunião", ajuda: "das conversas", n: l.marcou, taxa: eu.marcou, taxaTime: t?.marcou ?? null },
    { id: "aconteceu", rotulo: "Reunião aconteceu", ajuda: "das que já tiveram data", n: l.aconteceu, taxa: eu.aconteceu, taxaTime: t?.aconteceu ?? null },
  ];
}

// ── Diagnóstico ──────────────────────────────────────────────────────────────

export interface Diagnostico {
  /** Etapa em que a pessoa fica MAIS abaixo do time (null = nenhuma relevante). */
  pior: EtapaId | null;
  vaza: string;
  frase: string;
  /** Etapa em que fica mais ACIMA do time. */
  forte: EtapaId | null;
  forteFrase: string | null;
}

const NOME_ETAPA: Record<EtapaId, string> = {
  trabalhou: "começar o lead",
  falou: "chegar no lead",
  marcou: "conversa → reunião",
  aconteceu: "reunião → acontecer",
};

export const fmtPct = (x: number | null, casas = 0) =>
  x === null ? "—" : `${x.toFixed(casas).replace(".", ",")}%`;

/**
 * Compara cada etapa com o time em termos RELATIVOS (40% contra 46% é 13%
 * abaixo). Só aponta vazamento a partir de 5% abaixo — ruído de amostra
 * pequena não pode virar bronca.
 */
/** `voce`: texto em segunda pessoa, pra tela do próprio SDR. */
export function diagnostico(l: LinhaFunil, time: LinhaFunil | null, voce = false): Diagnostico {
  const V = (ele: string, tu: string) => (voce ? tu : ele);
  if (!time) return { pior: null, vaza: "", frase: "", forte: null, forteFrase: null };
  const eu = taxas(l);
  const t = taxas(time);
  const ids: EtapaId[] = ["trabalhou", "falou", "marcou", "aconteceu"];
  const gaps = ids
    .filter((id) => eu[id] !== null && t[id] !== null && t[id]! > 0)
    .map((id) => ({ id, gap: (eu[id]! - t[id]!) / t[id]! }));

  const piorG = gaps.reduce<{ id: EtapaId; gap: number } | null>((a, g) => (!a || g.gap < a.gap ? g : a), null);
  const forteG = gaps.reduce<{ id: EtapaId; gap: number } | null>((a, g) => (!a || g.gap > a.gap ? g : a), null);

  const pior: EtapaId | null = piorG && piorG.gap <= -0.05 ? piorG.id : null;
  const forte: EtapaId | null = forteG && forteG.gap >= 0.05 && forteG.id !== pior ? forteG.id : null;

  let frase = "Nenhuma etapa abaixo da média do time neste período.";
  if (pior === "trabalhou") {
    frase = `${l.recebidos - l.trabalhou} leads ficaram sem nenhuma atividade (${fmtPct(eu.trabalhou)} trabalhados; time ${fmtPct(t.trabalhou)}).`;
  } else if (pior === "falou") {
    const extra = Math.round(l.trabalhou * ((t.falou! - eu.falou!) / 100));
    frase = `${V("Fala", "Você fala")} com ${fmtPct(eu.falou)} dos leads trabalhados (time ${fmtPct(t.falou)}). Na média do time seriam ~${extra} conversas a mais.`;
  } else if (pior === "marcou") {
    const extra = Math.round(l.falou * ((t.marcou! - eu.marcou!) / 100));
    frase = `${fmtPct(eu.marcou)} das ${V("", "suas ")}conversas viram reunião (time ${fmtPct(t.marcou)}). Na média do time seriam ~${extra} reuniões a mais.`;
  } else if (pior === "aconteceu") {
    frase = `Só ${fmtPct(eu.aconteceu)} das ${V("", "suas ")}reuniões aconteceram (time ${fmtPct(t.aconteceu)}): ${l.cancelou} canceladas e ${l.noshow} no-show de ${l.marcou} marcadas.`;
  }

  let forteFrase: string | null = null;
  if (forte === "trabalhou") forteFrase = `${V("Começa", "Você começa")} ${fmtPct(eu.trabalhou)} dos leads (time ${fmtPct(t.trabalhou)}).`;
  if (forte === "falou") forteFrase = `${V("Fala", "Você fala")} com ${fmtPct(eu.falou)} dos leads trabalhados (time ${fmtPct(t.falou)}).`;
  if (forte === "marcou") forteFrase = `${fmtPct(eu.marcou)} das ${V("", "suas ")}conversas viram reunião (time ${fmtPct(t.marcou)}).`;
  if (forte === "aconteceu") forteFrase = `${fmtPct(eu.aconteceu)} das ${V("", "suas ")}reuniões acontecem (time ${fmtPct(t.aconteceu)}).`;

  return { pior, vaza: pior ? NOME_ETAPA[pior] : "", frase, forte, forteFrase };
}

// ── Períodos (fuso de São Paulo) ─────────────────────────────────────────────

function diaSP(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
function somaDias(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export type PeriodoFunil = "semana" | "mes" | "30d" | "mes_passado";

export const PERIODOS_FUNIL: { id: PeriodoFunil; rotulo: string }[] = [
  { id: "semana", rotulo: "Semana" },
  { id: "mes", rotulo: "Mês" },
  { id: "30d", rotulo: "30 dias" },
  { id: "mes_passado", rotulo: "Mês passado" },
];

export function intervaloFunil(p: PeriodoFunil): { de: string; ate: string } {
  const hoje = diaSP();
  const [y, m, d] = hoje.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
  switch (p) {
    case "semana": return { de: somaDias(hoje, -(dow - 1)), ate: hoje };
    case "mes": return { de: hoje.slice(0, 8) + "01", ate: hoje };
    case "30d": return { de: somaDias(hoje, -29), ate: hoje };
    case "mes_passado": {
      const ini = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
      const fim = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
      return { de: ini, ate: fim };
    }
  }
}

export function tempoHumano(min: number | null): string {
  if (min === null || min === undefined) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const r = Math.round(min % 60);
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}
