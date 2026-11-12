// src/lib/qs/bitrixSync.ts
// ─────────────────────────────────────────────────────────────────────────────
// Sincronização QS → Bitrix DISPARADA POR EVENTO (webhook), na hora que o SDR age.
//
// Modelo: cada ação relevante (marcar Perdido/Ganho, agendar Reunião, salvar Nota)
// chama a rota serverless /api/bitrix-sync, que valida o LOGIN do SDR (JWT do
// Supabase), acha o negócio no Bitrix pelo `bitrix_id` do lead e move a coluna /
// preenche campos / comenta na timeline DIRETO no Bitrix (sem n8n desde 03/11).
//
// Segurança (mudança 2026-07-13): antes o navegador chamava o n8n DIRETO com
// VITE_N8N_SYNC_BASE no bundle e webhooks sem auth — qualquer visitante podia
// extrair a URL e mover negócios arbitrários no Bitrix. Agora o webhook do Bitrix
// vive SÓ na env do servidor (BITRIX_WEBHOOK_BASE na Vercel).
//
// Regras de ouro:
//  • Fire-and-forget: NUNCA trava a UI, NUNCA lança erro pro chamador. Se falhar,
//    avisa por toast (o QS é a fonte da verdade; o Bitrix é espelho).
//  • Sem `bitrix_id` não há o que sincronizar (lead que não veio do Bitrix) → pula.
//  • Servidor sem BITRIX_WEBHOOK_BASE → no-op silencioso (nada quebra antes de ligar).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import { notifyError } from "@/lib/qs/notify";

// "primeiro-contato" (2026-07-28): disparado quando o SDR conclui uma atividade
// que NÃO encerra o lead. O servidor só move o negócio se ele AINDA estiver em "Novo
// lead" — por isso podemos disparar em toda conclusão sem contador nem flag: da
// 2ª em diante o evento chega, olha e não faz nada. Repetir é inofensivo, e se o
// primeiro disparo se perder (rede/Bitrix fora) o próximo conserta sozinho.
// "reuniao-campos" (2026-08-14): desfecho da reunião preenche os CAMPOS do
// negócio (Data da reunião realizada, Data de No Show, Reagendamento, SAL) —
// o mapeamento desfecho→UF_CRM_* vive no servidor, nunca no navegador.
export type BitrixSyncEvent = "perdido" | "ganho" | "reuniao" | "nota" | "primeiro-contato" | "reuniao-campos" | "criar-card";

export interface BitrixSyncPayload {
  lead_id: string;
  bitrix_id?: string | null;
  [key: string]: unknown;
}

let warnedNotConfigured = false;
/** Leads sem card já avisados nesta sessão (um toast por lead, não por evento). */
const avisadosSemCard = new Set<string>();

/** O que o envio deu, para quem PRECISA saber (um botão, por exemplo). */
export interface BitrixSyncResult {
  ok: boolean;
  /** Servidor sem BITRIX_WEBHOOK_BASE: não é falha, é integração desligada. */
  desligado?: boolean;
  /** O lead não tem card no Bitrix — não houve o que atualizar. */
  semCard?: boolean;
  error?: string;
}

/**
 * A MESMA entrega do notifyBitrix, mas ESPERÁVEL.
 *
 * Existe desde 09/09 por causa do botão "Enviar pro Bitrix" do desfecho: um
 * botão que não pode dizer se funcionou é pior que não ter botão — o closer
 * clica, não acontece nada visível, e ele clica de novo. O fire-and-forget
 * continua sendo o padrão de TODO o resto (nunca travar a UI do SDR); aqui a
 * espera é o ponto, porque a pessoa pediu o envio e está olhando.
 *
 * NÃO lança: devolve o motivo em texto. Quem chama decide o que mostrar.
 */
export async function enviarAoBitrix(
  event: BitrixSyncEvent,
  payload: BitrixSyncPayload
): Promise<BitrixSyncResult> {
  if (!payload.bitrix_id && !payload.lead_id) {
    return { ok: false, error: "Sem lead_id nem bitrix_id — não há o que sincronizar." };
  }
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers["Authorization"] = `Bearer ${data.session.access_token}`;

    const res = await fetch("/api/bitrix-sync", {
      method: "POST",
      headers,
      body: JSON.stringify({ event, ...payload }),
      keepalive: true,
    });
    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      code?: string;
      error?: string;
    } | null;

    if (json?.code === "not_configured") return { ok: false, desligado: true };
    // "Lead sem bitrix_id": desde 12/11 o servidor responde success:false com
    // este code (antes era um sucesso falso). Um botão que a pessoa apertou
    // não pode dizer "enviado" quando não existe card do outro lado.
    if (json?.code === "skipped_no_bitrix_id") return { ok: false, semCard: true };
    if (!res.ok || !json?.success) {
      const erro = String(json?.error ?? "");
      return {
        ok: false,
        // Sem n8n no meio (03/11), quem recusa é o próprio Bitrix (ou a rede).
        error: erro || `O Bitrix não aceitou (HTTP ${res.status}).`,
      };
    }
    return { ok: true };
  } catch (err) {
    console.warn(`[bitrixSync] "${event}" falhou:`, err);
    return { ok: false, error: "Sem conexão com o servidor do QS." };
  }
}

/**
 * Dispara o evento pro Bitrix via /api/bitrix-sync (autenticado com o JWT da sessão).
 */
export function notifyBitrix(event: BitrixSyncEvent, payload: BitrixSyncPayload): void {
  // O SERVIDOR resolve o bitrix_id a partir do lead_id (e ignora o do cliente).
  // Abortar aqui quando o campo não veio era o que matava o desfecho lançado
  // pela Agenda do Dia — que carrega reuniões SEM o embed do lead — enquanto a
  // mesma ação funcionava na página de Reuniões. Só desistimos quando não há
  // nem lead_id, porque aí não há o que resolver.
  if (!payload.bitrix_id && !payload.lead_id) {
    console.info(`[bitrixSync] "${event}" pulado: sem lead_id nem bitrix_id`);
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
      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        code?: string;
        /** "bitrix-recusou", "bitrix-inacessivel", … — o que deu errado. */
        error?: string;
      } | null;

      if (json?.code === "not_configured") {
        if (!warnedNotConfigured) {
          warnedNotConfigured = true;
          console.info("[bitrixSync] integração desligada no servidor (BITRIX_WEBHOOK_BASE não configurado)");
        }
        return;
      }
      // Lead sem card (12/11): o servidor deixou de responder "sucesso" e marca
      // a pendência no lead. Avisa UMA vez por lead nesta sessão — sem isso,
      // cada nota de um lead sem card virava um toast.
      if (json?.code === "skipped_no_bitrix_id") {
        if (!avisadosSemCard.has(payload.lead_id)) {
          avisadosSemCard.add(payload.lead_id);
          notifyError("Este lead ainda não tem card no Bitrix — a atualização ficou só no QS. O card vai ser criado (veja o selo na ficha do lead).");
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
