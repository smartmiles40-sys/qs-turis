// src/lib/leadScore.ts
// -----------------------------------------------------------------------------
// Lead Score / temperatura calculado no próprio QS a partir dos sinais que já
// temos (sem depender de dado externo). Dá pra trocar por um score vindo do
// Bitrix/LP depois — basta preencher lead.estimated_value ou um campo dedicado
// e ajustar aqui. Retorna nível (quente/morno/frio) + número 0–100 + cores.
// -----------------------------------------------------------------------------

import type { Lead, Cadence } from "@/components/sdr/types";

export type LeadTemperature = "quente" | "morno" | "frio";

export interface LeadScore {
  score: number; // 0–100
  level: LeadTemperature;
  label: string; // "Quente" | "Morno" | "Frio"
  emoji: string;
  color: string; // cor do texto/borda
  bg: string; // fundo do chip
}

const TEMP_META: Record<LeadTemperature, { label: string; emoji: string; color: string; bg: string }> = {
  quente: { label: "Quente", emoji: "🔥", color: "#E5484D", bg: "rgba(229,72,77,.11)" },
  morno:  { label: "Morno",  emoji: "🌤️", color: "#E8920B", bg: "rgba(232,146,11,.13)" },
  frio:   { label: "Frio",   emoji: "❄️", color: "#2563EB", bg: "rgba(37,99,235,.10)" },
};

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, (Date.now() - t) / 86_400_000);
}

/**
 * Calcula a temperatura do lead.
 * @param attempts nº de tentativas de contato já feitas (0 = ainda não contatado)
 */
export function computeLeadScore(
  lead: Lead | undefined | null,
  cadence?: Cadence | undefined | null,
  attempts = 0
): LeadScore {
  let score = 50;

  // Recência da chegada (lead novo = mais quente)
  const d = daysSince(lead?.arrived_at) ?? daysSince(lead?.created_at);
  if (d !== null) {
    if (d < 1) score += 30;
    else if (d < 3) score += 15;
    else if (d < 7) score += 5;
    else if (d < 15) score -= 5;
    else score -= 15;
  }

  // Canal de aquisição
  switch (cadence?.acquisition_channel) {
    case "levantada_de_mao": score += 20; break;
    case "indicacao": score += 10; break;
    case "resgate": score -= 5; break;
    default: break; // outbound / desconhecido
  }

  // Tentativas sem sucesso esfriam o lead
  if (attempts > 1) score -= (attempts - 1) * 8;

  // Completude do cadastro (lead mais "trabalhável")
  if (lead?.email) score += 5;
  if (lead?.phone) score += 5;
  if (lead?.linkedin_url) score += 3;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const level: LeadTemperature = score >= 70 ? "quente" : score >= 40 ? "morno" : "frio";
  const meta = TEMP_META[level];
  return { score, level, ...meta };
}
