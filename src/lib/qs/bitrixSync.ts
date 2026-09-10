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

// "primeiro-contato" (2026-07-28): disparado quando o SDR conclui uma atividade
// que NÃO encerra o lead. O n8n só move o negócio se ele AINDA estiver em "Novo
// lead" — por isso podemos disparar em toda conclusão sem contador nem flag: da
// 2ª em diante o evento chega, olha e não faz nada. Repetir é inofensivo, e se o
// primeiro disparo se perder (rede/n8n fora) o próximo conserta sozinho.
// "reuniao-campos" (2026-08-14): desfecho da reunião preenche os CAMPOS do
// negócio (Data da reunião realizada, Data de No Show, Reagendamento, SAL) —
// o mapeamento desfecho→UF_CRM_* vive no servidor, nunca no navegador.
export type BitrixSyncEvent = "perdido" | "ganho" | "reuniao" | "nota" | "primeiro-contato" | "reuniao-campos";

export interface BitrixSyncPayload {
  lead_id: string;
  bitrix_id?: string | null;
  [key: string]: unknown;
}

let warnedNotConfigured = false;

/** O que o envio deu, para quem PRECISA saber (um botão, por exemplo). */
export interface BitrixSyncResult {
  ok: boolean;
  /** Servidor sem N8N_SYNC_BASE: não é falha, é integração desligada. */
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
    // "Lead sem bitrix_id" volta como SUCESSO do servidor — e é o certo pro
    // disparo automático, que não pode berrar por cada lead que não veio do
    // Bitrix. Mas um botão que a pessoa apertou não pode dizer "enviado" quando
    // não existe card do outro lado: aqui isso vira resposta, não silêncio.
    if (json?.code === "skipped_no_bitrix_id") return { ok: false, semCard: true };
    if (!res.ok || !json?.success) {
      const erro = String(json?.error ?? "");
      return {
        ok: false,
        // Mesma distinção do notifyBitrix: dizer QUEM recusou. Culpar o Bitrix
        // quando quem devolveu 403 foi o n8n já mandou o diagnóstico pro lugar
        // errado uma vez (agosto/2026).
        error: erro.startsWith("n8n ")
          ? "A automação (n8n) recusou — o Bitrix não chegou a ser chamado."
          : erro || `O Bitrix não aceitou (HTTP ${res.status}).`,
      };
    }
    return { ok: true };
  } catch (err) {
    console.warn(`[bitrixSync] "${event}" falhou:`, err);
    return { ok: false, error: "Sem conexão com o servidor do QS." };
  }
}

/**
 * Dispara o evento pro n8n via /api/bitrix-sync (autenticado com o JWT da sessão).
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
        /** "n8n HTTP 403", "bitrix-recusou", … — é o que diz QUEM recusou. */
        error?: string;
      } | null;

      if (json?.code === "not_configured") {
        if (!warnedNotConfigured) {
          warnedNotConfigured = true;
          console.info("[bitrixSync] integração desligada no servidor (N8N_SYNC_BASE não configurado)");
        }
        return;
      }
      if (!res.ok || !json?.success) {
        console.warn(`[bitrixSync] "${event}" falhou:`, res.status, json);
        // A mensagem diz QUEM recusou. A antiga culpava o Bitrix sempre — e em
        // agosto o Bitrix estava bem: quem devolvia 403 era o n8n, com os
        // endereços registrados num workflow antigo. Diagnóstico começou no
        // lugar errado por causa deste texto.
        const erro = String(json?.error ?? "");
        notifyError(
          erro.startsWith("n8n ")
            ? "A automação recusou esta atualização (o Bitrix não chegou a ser chamado). O QS salvou normalmente — atualize o negócio no Bitrix manualmente."
            : "O Bitrix não recebeu esta atualização. O QS salvou normalmente — atualize o negócio no Bitrix manualmente."
        );
      }
    } catch (err) {
      console.warn(`[bitrixSync] "${event}" falhou:`, err);
      notifyError("O Bitrix não recebeu esta atualização (sem conexão?). O QS salvou normalmente — atualize o negócio no Bitrix manualmente.");
    }
  })();
}
