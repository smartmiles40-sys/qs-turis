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
  assertCanAccessLead, getSupabaseUserId, cwConfigured, cw,
  toE164BR, findContact, pickConversation, ingestMessage, WA_INBOX_IDS,
} from './_wa.js';
import { rest } from './_supabaseAdmin.js';

const MAX_LEN = 4000;

/** Por qual caixa (= qual número nosso) a mensagem sai. */
function defaultInboxId() {
  const env = Number(process.env.CHATWOOT_DEFAULT_INBOX_ID);
  if (Number.isFinite(env) && env > 0) return env;
  return WA_INBOX_IDS[0] ?? null;
}

/** source_id = a "linha" que liga aquele contato àquela caixa; a conversa precisa dela. */
async function sourceIdFor(contactId, inboxId) {
  try {
    const { payload = [] } = await cw(`/contacts/${contactId}/contactable_inboxes`);
    const hit = payload.find((p) => (p.inbox?.id ?? p.inbox_id) === inboxId) || payload[0];
    return hit?.source_id || null;
  } catch (e) {
    console.warn('[wa-send] contactable_inboxes:', e?.message);
    return null;
  }
}

async function ensureConversation(lead) {
  const phone = toE164BR(lead.phone);
  if (!phone) return { error: 'lead-sem-telefone' };

  const inboxId = defaultInboxId();
  if (!inboxId) return { error: 'inbox-nao-configurada' };

  let contact = await findContact(phone);

  if (!contact) {
    const name = lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || phone;
    try {
      const created = await cw('/contacts', {
        method: 'POST',
        body: { inbox_id: inboxId, name, phone_number: phone },
      });
      contact = created?.payload?.contact || created?.payload || null;
    } catch (e) {
      console.error('[wa-send] criar contato:', e?.message);
      return { error: 'falha-ao-criar-contato' };
    }
  }
  if (!contact?.id) return { error: 'sem-contato' };

  const existing = await pickConversation(contact.id);
  if (existing) return { conversation: existing, contact };

  const sourceId = await sourceIdFor(contact.id, inboxId);
  if (!sourceId) return { error: 'sem-source-id' };

  try {
    const conv = await cw('/conversations', {
      method: 'POST',
      body: { source_id: sourceId, inbox_id: inboxId, contact_id: contact.id },
    });
    return { conversation: conv, contact };
  } catch (e) {
    console.error('[wa-send] criar conversa:', e?.message);
    return { error: 'falha-ao-criar-conversa' };
  }
}

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

    if (!conversationId) {
      const r = await ensureConversation(auth.lead);
      if (r.error) {
        const humano = {
          'lead-sem-telefone': 'Este lead não tem telefone cadastrado.',
          'inbox-nao-configurada': 'Falta dizer por qual número enviar (CHATWOOT_DEFAULT_INBOX_ID).',
          'falha-ao-criar-contato': 'Não consegui criar o contato no atendimento.',
          'falha-ao-criar-conversa': 'Não consegui abrir a conversa no atendimento.',
          'sem-source-id': 'A caixa de WhatsApp não aceitou este contato.',
          'sem-contato': 'Não consegui identificar o contato no atendimento.',
        }[r.error] || 'Não consegui abrir a conversa.';
        return res.status(409).json({ error: humano, motivo: r.error });
      }
      conversationId = r.conversation.id;
      contactId = r.contact.id;
      inboxId = r.conversation.inbox_id ?? defaultInboxId();
    }

    const sent = await cw(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: { content: text, message_type: 'outgoing', private: false },
    });

    // Grava já, sem esperar o webhook: o SDR vê a própria mensagem na hora.
    // Se o webhook chegar depois com a mesma mensagem, o id do Chatwoot dedupe.
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

    return res.status(200).json({ ok: true, conversationId, messageId: sent?.id ?? null });
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
