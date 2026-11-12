// src/components/sdr/leads/cardBitrix.ts
// ─────────────────────────────────────────────────────────────────────────────
// CARD DO LEAD NO BITRIX (12/11/2026, migration 0362).
//
// Diretriz do Bruno: "todo card criado no QS TEM que nascer no Bitrix e ficar
// amarrado. Falha = pendência visível + nova tentativa."
//
// O estado mora no lead (bitrix_card_status/erro/…). Quem cria o negócio é o
// servidor: /api/bitrix-sync { event: "criar-card" } — que confere se a pessoa
// pode mexer no lead, procura o negócio pelo telefone antes de criar e, se
// falhar, deixa o lead PENDENTE pra rotina tentar de novo.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";

export type { EstadoCardBitrix, LeadComCardBitrix } from "./cardBitrixRegras";
export { seloDoCard } from "./cardBitrixRegras";

export interface ResultadoCriarCard {
  ok: boolean;
  bitrixId?: string | null;
  /** "criado" | "vinculado" | "ja_tinha" — o que aconteceu. */
  como?: string;
  error?: string;
}

/** Cria (ou amarra ao que já existe) o negócio do lead no Bitrix. Nunca lança. */
export async function criarCardNoBitrix(leadId: string): Promise<ResultadoCriarCard> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers["Authorization"] = `Bearer ${data.session.access_token}`;
    const res = await fetch("/api/bitrix-sync", {
      method: "POST",
      headers,
      body: JSON.stringify({ event: "criar-card", lead_id: leadId }),
    });
    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; code?: string; bitrix_id?: string | null; error?: string }
      | null;
    if (res.ok && json?.success) return { ok: true, bitrixId: json.bitrix_id ?? null, como: json.code };
    if (json?.code === "not_configured") return { ok: false, error: "A integração com o Bitrix está desligada no servidor." };
    return { ok: false, error: json?.error || `O Bitrix não criou o negócio (HTTP ${res.status}).` };
  } catch {
    return { ok: false, error: "Sem conexão com o servidor do QS." };
  }
}
