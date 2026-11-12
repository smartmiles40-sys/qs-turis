// src/components/sdr/leads/cardBitrixRegras.ts
// Regras PURAS do selo do card no Bitrix (sem supabase — testável em node).
// Chamada ao servidor: ./cardBitrix.ts. Contexto: migration 0362.

export type EstadoCardBitrix = "ok" | "pendente" | "falhou" | null;

/** Os campos do lead que o selo lê (a 0362 pode ainda não estar aplicada: tudo opcional). */
export interface LeadComCardBitrix {
  id: string;
  bitrix_id?: string | null;
  status?: string | null;
  bitrix_card_status?: EstadoCardBitrix;
  bitrix_card_erro?: string | null;
  bitrix_card_tentativas?: number | null;
}

/** O que o selo mostra. null = tem card, não mostra nada. Puro. */
export function seloDoCard(lead: LeadComCardBitrix): { texto: string; tom: "warn" | "danger"; detalhe: string | null } | null {
  if (lead.bitrix_id) return null;
  const erro = (lead.bitrix_card_erro ?? "").trim() || null;
  if (lead.bitrix_card_status === "falhou") {
    return { texto: `Falhou: ${erro ?? "o Bitrix não criou o card"}`, tom: "danger", detalhe: erro };
  }
  if (lead.bitrix_card_status === "pendente") {
    return { texto: "Sem card no Bitrix — tentando de novo", tom: "warn", detalhe: erro };
  }
  // Lead antigo (sem marca): perdido fica fora da rotina automática.
  if (lead.status === "perdido") return { texto: "Sem card no Bitrix", tom: "warn", detalhe: null };
  return { texto: "Sem card no Bitrix — tentando de novo", tom: "warn", detalhe: erro };
}
