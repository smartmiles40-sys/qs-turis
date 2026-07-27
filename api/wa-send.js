// api/wa-send.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/wa-send  { leadId, text }
//
// Envia a mensagem de WhatsApp do SDR pelo Chatwoot (que fala com a Evolution,
// que fala com o WhatsApp) — sem o navegador nunca ter visto o token do Chatwoot
// e, principalmente, sem o SDR conseguir escrever pra um lead que não é dele:
// a conversa é resolvida A PARTIR do lead, depois de o servidor confirmar a posse.
//
// Se ainda não existe conversa (lead que nunca falou com a gente), cria contato e
// conversa no Chatwoot antes de mandar — assim a primeira abordagem também sai
// pelo QS, e não por fora.
//
// Envs: CHATWOOT_* (ver _wa.js) + CHATWOOT_DEFAULT_INBOX_ID (ou a 1ª de
//       CHATWOOT_WA_INBOX_IDS) pra saber por qual número mandar.
// -----------------------------------------------------------------------------

import {
  assertCanAccessLead, getSupabaseUserId, cwConfigured, cw, ingestMessage,
  ensureConversation, defaultInboxId, motivoHumano, completeWhatsAppTask, inboxPermitida,
} from './_wa.js';
import { rest } from './_supabaseAdmin.js';

const MAX_LEN = 4000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const leadId = String(body.leadId || '').trim();
  const text = String(body.text || '').trim();

  if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });
  if (!text) return res.status(400).json({ error: 'Mensagem vazia' });
  if (text.length > MAX_LEN) return res.status(400).json({ error: `Mensagem muito longa (máx. ${MAX_LEN})` });

  // Por qual número o SDR escolheu falar (WhatsApp normal x API oficial).
  const inboxPedida = inboxPermitida(body.inboxId);
  if (inboxPedida == null && body.inboxId != null && body.inboxId !== '') {
    return res.status(400).json({ error: 'Esse número não está liberado para envio.' });
  }

  let auth;
  try {
    auth = await assertCanAccessLead(userId, leadId);
  } catch (e) {
    console.error('[wa-send] checagem de acesso:', e?.message);
    return res.status(500).json({ error: 'Falha ao validar o lead' });
  }
  if (!auth.ok) {
    const status = auth.reason === 'lead-de-outro-sdr' ? 403 : 404;
    return res.status(status).json({ error: 'Sem acesso a este lead', motivo: auth.reason });
  }

  if (!cwConfigured()) {
    return res.status(503).json({ error: 'Atendimento não configurado (falta CHATWOOT_AGENT_TOKEN)' });
  }

  try {
    // Caminho rápido: conversa que o QS já conhece. Só cai no Chatwoot se não souber.
    let conversationId = null;
    let contactId = null;
    let inboxId = null;
    try {
      const rows = await rest(
        `qs_wa_threads?select=cw_conversation_id,cw_contact_id,cw_inbox_id&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
      );
      conversationId = rows?.[0]?.cw_conversation_id ?? null;
      contactId = rows?.[0]?.cw_contact_id ?? null;
      inboxId = rows?.[0]?.cw_inbox_id ?? null;
    } catch { /* segue pro caminho completo */ }

    // Pediu um número específico? Então o atalho acima só vale se a conversa que
    // já conhecemos for DAQUELE número — no Chatwoot cada conversa pertence a uma
    // caixa só, e mandar pela conversa errada sairia pelo número errado.
    if (inboxPedida != null && Number(inboxId) !== Number(inboxPedida)) {
      conversationId = null;
      contactId = null;
      inboxId = null;
    }

    if (!conversationId) {
      const r = await ensureConversation(auth.lead, inboxPedida);
      if (r.error) {
        return res.status(409).json({ error: motivoHumano(r.error), motivo: r.error });
      }
      conversationId = r.conversation.id;
      contactId = r.contact.id;
      inboxId = r.conversation.inbox_id ?? inboxPedida ?? defaultInboxId();
    }

    const sent = await cw(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: { content: text, message_type: 'outgoing', private: false },
    });

    // ⚠️ DAQUI PRA BAIXO A MENSAGEM JÁ SAIU PRO CLIENTE.
    // Nada aqui pode virar "não consegui enviar": o SDR reenviaria e o cliente
    // receberia duas, três vezes. Falha de gravação é problema NOSSO, vai pro
    // log, e o webhook do Chatwoot traz a mensagem de volta em seguida.
    let tarefa = null;
    try {
      await ingestMessage({
        leadId,
        conversationId,
        contactId,
        inboxId,
        message: {
          id: sent?.id ?? null,
          content: text,
          message_type: 1,
          created_at: sent?.created_at ?? null,
          sender: { name: auth.user?.name || null },
        },
      });
      tarefa = await completeWhatsAppTask(leadId, auth.lead?.owner_id ?? null);
    } catch (e) {
      console.error('[wa-send] enviado, mas falhou ao gravar no QS:', e?.message);
    }

    return res.status(200).json({ ok: true, conversationId, messageId: sent?.id ?? null, tarefaConcluida: tarefa });
  } catch (e) {
    console.error('[wa-send]', e?.message);
    // 401/403 do Chatwoot = token errado; o resto tratamos como falha de envio.
    if (e?.status === 401 || e?.status === 403) {
      return res.status(503).json({ error: 'O atendimento recusou o token (CHATWOOT_AGENT_TOKEN).' });
    }
    return res.status(502).json({ error: 'Não consegui enviar a mensagem. Tente de novo.' });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
