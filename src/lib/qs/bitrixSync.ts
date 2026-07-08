// src/lib/qs/bitrixSync.ts
// ─────────────────────────────────────────────────────────────────────────────
// Sincronização QS → Bitrix DISPARADA POR EVENTO (webhook), na hora que o SDR age.
//
// Modelo: cada ação relevante (marcar Perdido/Ganho, agendar Reunião, salvar Nota)
// dispara um webhook do n8n. O n8n acha o negócio no Bitrix pelo `bitrix_id`,
// move a coluna / preenche os campos / comenta na timeline — e o Bitrix faz o
// resto (automações dele). Substitui o polling de 1 min do workflow antigo.
//
// Regras de ouro:
//  • Fire-and-forget: NUNCA trava a UI, NUNCA lança erro pro chamador. Se falhar,
//    só registra no console. A gravação no Supabase é a fonte da verdade; o Bitrix
//    é espelho. (Trade-off assumido do disparo pelo navegador: sem retry — se a
//    chamada falhar por queda de rede/n8n, aquele espelhamento se perde.)
//  • Sem `bitrix_id` não há o que sincronizar (lead que não veio do Bitrix) → pula.
//  • Sem VITE_N8N_SYNC_BASE configurado, vira no-op (nada quebra antes de ligar).
// ─────────────────────────────────────────────────────────────────────────────

/** Base dos webhooks do n8n, SEM barra final. Ex.: https://SEU-N8N/webhook */
const BASE = (import.meta.env.VITE_N8N_SYNC_BASE as string | undefined)
  ?.trim()
  .replace(/\/+$/, "");

export type BitrixSyncEvent = "perdido" | "ganho" | "reuniao" | "nota";

export interface BitrixSyncPayload {
  lead_id: string;
  bitrix_id?: string | null;
  [key: string]: unknown;
}

/**
 * Dispara o webhook do evento pro n8n. Cada evento tem seu path próprio
 * (`/qs-perdido`, `/qs-ganho`, `/qs-reuniao`, `/qs-nota`) — um "webhook por botão".
 */
export function notifyBitrix(event: BitrixSyncEvent, payload: BitrixSyncPayload): void {
  if (!BASE) return; // integração ainda não configurada → no-op silencioso
  if (!payload.bitrix_id) {
    console.info(`[bitrixSync] "${event}" pulado: lead sem bitrix_id (não veio do Bitrix)`);
    return;
  }

  const url = `${BASE}/qs-${event}`;
  try {
    // keepalive: garante o envio mesmo se a página navegar logo após o clique.
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, ...payload }),
      keepalive: true,
      mode: "cors",
    }).catch((err) => console.warn(`[bitrixSync] "${event}" falhou:`, err));
  } catch (err) {
    console.warn(`[bitrixSync] "${event}" erro ao disparar:`, err);
  }
}
