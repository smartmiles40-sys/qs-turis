// src/lib/leadScore.ts
// -----------------------------------------------------------------------------
// Temperatura do lead = REFLEXO do rótulo que veio do Bitrix (lead.lead_score).
// NÃO calculamos mais nada localmente: o QS não inventa "Quente". Se o Bitrix não
// mandou temperatura, a função devolve null e o card simplesmente não mostra chip.
//
// O Bitrix manda um rótulo cru ("Quente"/"Morno"/"Frio", ou "hot"/"warm"/"cold");
// aqui a gente normaliza pra quente|morno|frio e devolve as cores do chip.
// -----------------------------------------------------------------------------

import type { Lead } from "@/components/sdr/types";

export type LeadTemperature = "quente" | "morno" | "frio";

export interface LeadScore {
  level: LeadTemperature;
  label: string; // "Quente" | "Morno" | "Frio"
  emoji: string;
  color: string; // cor do texto/borda do chip
  bg: string; // fundo do chip
}

const TEMP_META: Record<LeadTemperature, { label: string; emoji: string; color: string; bg: string }> = {
  quente: { label: "Quente", emoji: "🔥", color: "#E5484D", bg: "rgba(229,72,77,.11)" },
  morno:  { label: "Morno",  emoji: "🌤️", color: "#E8920B", bg: "rgba(232,146,11,.13)" },
  frio:   { label: "Frio",   emoji: "❄️", color: "#2563EB", bg: "rgba(37,99,235,.10)" },
};

/**
 * Traduz o rótulo cru do Bitrix para um nível de temperatura conhecido.
 * Aceita PT (quente/morno/frio), EN (hot/warm/cold) e sinônimos comuns.
 * Devolve null quando não reconhece (aí o card fica sem chip).
 */
export function normalizeTemperature(raw: string | null | undefined): LeadTemperature | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/(quente|hot|alta|high)/.test(s)) return "quente";
  if (/(morno|warm|m[eé]dia|medium|med)/.test(s)) return "morno";
  if (/(frio|cold|baixa|low)/.test(s)) return "frio";
  return null;
}

/**
 * Temperatura do lead a partir do rótulo do Bitrix (lead.lead_score).
 * @returns o chip pronto, ou null se o lead não tem score do Bitrix.
 */
export function getLeadScore(lead: Lead | undefined | null): LeadScore | null {
  const level = normalizeTemperature(lead?.lead_score);
  if (!level) return null;
  return { level, ...TEMP_META[level] };
}

// ── Temperatura do SDR (05/11, migration 0311) ──────────────────────────────
// A SEGUNDA temperatura: a leitura de quem conversou com o cliente. Obrigatória
// ao agendar a 1ª reunião; é o que o closer usa pra decidir quem atender primeiro.
// Fica em qs_leads.temperatura_sdr (atual) e qs_meetings.temperatura_sdr (foto
// do agendamento). Gravada sempre em minúsculo: quente | morno | frio.

export const TEMPERATURAS: LeadTemperature[] = ["quente", "morno", "frio"];

export function chipDaTemperatura(level: LeadTemperature): LeadScore {
  return { level, ...TEMP_META[level] };
}

/** Chip da temperatura do SDR, ou null se o SDR ainda não classificou. */
export function getSdrTemperature(raw: string | null | undefined): LeadScore | null {
  const level = normalizeTemperature(raw);
  return level ? chipDaTemperatura(level) : null;
}
