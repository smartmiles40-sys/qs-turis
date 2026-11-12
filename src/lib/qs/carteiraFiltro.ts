// src/lib/qs/carteiraFiltro.ts
// -----------------------------------------------------------------------------
// Filtros da CARTEIRA (12/11/2026): Lead Score, tempo sem contato e cadência —
// os mesmos critérios do Gerenciamento de Leads, pra o SDR escolher QUAIS leads
// iniciar/retrabalhar em vez de sortear às cegas da carteira inteira.
//
// Módulo puro (sem supabase) pra ser testado em tests/carteira/carteiraFiltro.
// -----------------------------------------------------------------------------
import { normalizeTemperature, type LeadTemperature } from "../leadScore.ts";

/** Valor especial do filtro de cadência: lead sem cadência vinculada. */
export const SEM_CADENCIA = "__sem__";
/** Valor especial do filtro de Lead Score: lead sem score do Bitrix. */
export const SEM_SCORE = "__sem__";

/**
 * Tempo sem contato. "N" = sem atividade concluída há N+ dias (quem NUNCA teve
 * contato também entra: está sem contato há mais tempo que qualquer N).
 * "nunca" = nenhuma atividade concluída registrada.
 */
export type SemContatoFiltro = "" | "7" | "15" | "30" | "60" | "90" | "nunca";

export const SEM_CONTATO_OPCOES: { valor: SemContatoFiltro; rotulo: string }[] = [
  { valor: "7", rotulo: "Sem contato há 7+ dias" },
  { valor: "15", rotulo: "Sem contato há 15+ dias" },
  { valor: "30", rotulo: "Sem contato há 30+ dias" },
  { valor: "60", rotulo: "Sem contato há 60+ dias" },
  { valor: "90", rotulo: "Sem contato há 90+ dias" },
  { valor: "nunca", rotulo: "Nunca contatado" },
];

export interface FiltrosCarteira {
  /** "" = qualquer; SEM_SCORE = sem score. */
  temp: LeadTemperature | typeof SEM_SCORE | "";
  semContato: SemContatoFiltro;
  /** "" = qualquer; SEM_CADENCIA = sem cadência; senão o id da cadência. */
  cadenceId: string;
}

export const FILTROS_CARTEIRA_VAZIOS: FiltrosCarteira = { temp: "", semContato: "", cadenceId: "" };

/** O pedaço do item da carteira que os filtros leem. */
export interface FiltravelCarteira {
  leadScore: string | null;
  /** ISO da última atividade concluída, ou null se nunca houve. */
  ultimoContato: string | null;
  cadenceId: string | null;
}

const DIA = 864e5;

/** Dias inteiros desde `iso`, ou null se não houve contato. */
export function diasSemContato(iso: string | null, agora = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((agora - t) / DIA));
}

export function casaFiltrosCarteira(i: FiltravelCarteira, f: FiltrosCarteira, agora = Date.now()): boolean {
  if (f.temp) {
    const t = normalizeTemperature(i.leadScore);
    if (f.temp === SEM_SCORE ? t !== null : t !== f.temp) return false;
  }
  if (f.cadenceId) {
    if (f.cadenceId === SEM_CADENCIA ? !!i.cadenceId : i.cadenceId !== f.cadenceId) return false;
  }
  if (f.semContato) {
    const d = diasSemContato(i.ultimoContato, agora);
    if (f.semContato === "nunca") return d === null;
    if (d !== null && d < Number(f.semContato)) return false;
  }
  return true;
}

export function temFiltroCarteira(f: FiltrosCarteira): boolean {
  return !!(f.temp || f.semContato || f.cadenceId);
}
