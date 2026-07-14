// src/lib/qs/bitrixSync.ts
// ─────────────────────────────────────────────────────────────────────────────
// Sincronização QS → Bitrix DISPARADA POR EVENTO (webhook), na hora que o SDR age.
//
// Modelo: cada ação relevante (marcar Perdido/Ganho, agendar Reunião, salvar Nota)
// chama a rota serverless /api/bitrix-sync, que valida o LOGIN do SDR (JWT do
// Supabase) e encaminha pro n8n com um segredo server-side. O n8n acha o negócio
// no Bitrix pelo `bitrix_id`, move a coluna / comenta na timeline.
//
// Segurança (mudança 2026-07-13): antes o navegador chamava o n8n DIRETO com
// VITE_N8N_SYNC_BASE no bundle e webhooks sem auth — qualquer visitante podia
// extrair a URL e mover negócios arbitrários no Bitrix. Agora a URL e o segredo
// vivem SÓ nas envs do servidor (N8N_SYNC_BASE / N8N_SYNC_SECRET na Vercel).
//
// Regras de ouro:
//  • Fire-and-forget: NUNCA trava a UI, NUNCA lança erro pro chamador. Se falhar,
//    avisa por toast (o QS é a fonte da verdade; o Bitrix é espelho).
//  • Sem `bitrix_id` não há o que sincronizar (lead que não veio do Bitrix) → pula.
//  • Servidor sem N8N_SYNC_BASE → no-op silencioso (nada quebra antes de ligar).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import { notifyError } from "@/lib/qs/notify";

export type BitrixSyncEvent = "perdido" | "ganho" | "reuniao" | "nota";

export interface BitrixSyncPayload {
  lead_id: string;
  bitrix_id?: string | null;
  [key: string]: unknown;
}

let warnedNotConfigured = false;

/**
 * Dispara o evento pro n8n via /api/bitrix-sync (autenticado com o JWT da sessão).
 */
export function notifyBitrix(event: BitrixSyncEvent, payload: BitrixSyncPayload): void {
  if (!payload.bitrix_id) {
    console.info(`[bitrixSync] "${event}" pulado: lead sem bitrix_id (não veio do Bitrix)`);
    return;
  }

  void (async () => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) headers["Authorization"] = `Bearer ${data.session.access_token}`;

      // keepalive: garante o envio mesmo se a página navegar logo após o clique.
      const res = await fetch("/api/bitrix-sync", {
        method: "POST",
        headers,
        body: JSON.stringify({ event, ...payload }),
        keepalive: true,
      });
      const json = (await res.json().catch(() => null)) as { success?: boolean; code?: string } | null;

      if (json?.code === "not_configured") {
        if (!warnedNotConfigured) {
          warnedNotConfigured = true;
          console.info("[bitrixSync] integração desligada no servidor (N8N_SYNC_BASE não configurado)");
        }
        return;
      }
      if (!res.ok || !json?.success) {
        console.warn(`[bitrixSync] "${event}" falhou:`, res.status, json);
        notifyError("O Bitrix não recebeu esta atualização. O QS salvou normalmente — atualize o negócio no Bitrix manualmente.");
      }
    } catch (err) {
      console.warn(`[bitrixSync] "${event}" falhou:`, err);
      notifyError("O Bitrix não recebeu esta atualização (sem conexão?). O QS salvou normalmente — atualize o negócio no Bitrix manualmente.");
    }
  })();
}
