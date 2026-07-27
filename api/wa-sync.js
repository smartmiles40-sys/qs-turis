// api/wa-sync.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET /api/wa-sync?leadId=<uuid>
//
// Puxa o histórico da conversa daquele lead do Chatwoot pra dentro do QS. Serve
// pra duas coisas: (1) a primeira vez que alguém abre um lead — o webhook só
// grava o que acontece DEPOIS que ele foi ligado, então o passado precisa vir
// por aqui; (2) rede de segurança, se um webhook se perder.
//
// Idempotente: reingerir a mesma mensagem não duplica (chave é o id do Chatwoot).
//
// SEGURANÇA: não basta estar logado — o servidor confere que o lead é DESTE
// usuário antes de devolver qualquer coisa. Lead de outro SDR responde 403.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import {
  assertCanAccessLead, getSupabaseUserId, cwConfigured, cw,
  toE164BR, findContact, pickConversation, ingestMessage,
} from './_wa.js';

async function gravarThread(leadId, patch) {
  await rest('qs_wa_threads?on_conflict=lead_id', {
    method: 'POST',
    body: [{ lead_id: leadId, ...patch }],
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

/**
 * Grava o estado da conversa. Se a coluna `avatar_url` ainda não existir (a
 * migration 0026 é opcional), o PostgREST recusa a linha INTEIRA — e aí se
 * perderiam também a caixa, o id da conversa e o synced_at. Por isso, ao falhar
 * com a foto, tenta de novo sem ela em vez de desistir de tudo.
 */
async function saveThreadMeta(leadId, patch) {
  try {
    await gravarThread(leadId, patch);
  } catch (e) {
    if ('avatar_url' in patch) {
      const { avatar_url: _ignorado, ...semFoto } = patch;
      try {
        await gravarThread(leadId, semFoto);
        console.warn('[wa-sync] avatar_url ignorado — aplique a migration 0026 pra ver as fotos');
        return;
      } catch (e2) {
        console.warn('[wa-sync] saveThreadMeta:', e2?.message);
        return;
      }
    }
    console.warn('[wa-sync] saveThreadMeta:', e?.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET' });
  }

  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  const leadId = String(req.query?.leadId || '').trim();
  if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });

  let auth;
  try {
    auth = await assertCanAccessLead(userId, leadId);
  } catch (e) {
    console.error('[wa-sync] checagem de acesso:', e?.message);
    return res.status(500).json({ error: 'Falha ao validar o lead' });
  }
  if (!auth.ok) {
    const status = auth.reason === 'lead-de-outro-sdr' ? 403 : 404;
    return res.status(status).json({ error: 'Sem acesso a este lead', motivo: auth.reason });
  }

  if (!cwConfigured()) {
    console.warn('[wa-sync] CHATWOOT_AGENT_TOKEN ausente — configure na Vercel');
    return res.status(200).json({ configured: false, conversationId: null, importadas: 0 });
  }

  const phone = toE164BR(auth.lead.phone);
  if (!phone) return res.status(200).json({ conversationId: null, importadas: 0, motivo: 'lead-sem-telefone' });

  try {
    const contact = await findContact(phone);
    if (!contact) {
      await saveThreadMeta(leadId, { synced_at: new Date().toISOString() });
      return res.status(200).json({ conversationId: null, importadas: 0, motivo: 'sem-contato-no-chatwoot' });
    }

    const conv = await pickConversation(contact.id);
    if (!conv) {
      await saveThreadMeta(leadId, { cw_contact_id: contact.id, synced_at: new Date().toISOString() });
      return res.status(200).json({ conversationId: null, contactId: contact.id, importadas: 0, motivo: 'sem-conversa' });
    }

    const data = await cw(`/conversations/${conv.id}/messages`);
    const list = Array.isArray(data?.payload) ? data.payload : [];

    let importadas = 0;
    for (const m of list) {
      const novo = await ingestMessage({
        leadId,
        conversationId: conv.id,
        message: m,
        contactId: contact.id,
        canReply: typeof conv.can_reply === 'boolean' ? conv.can_reply : null,
        inboxId: conv.inbox_id ?? null,
      });
      if (novo) importadas++;
    }

    await saveThreadMeta(leadId, {
      cw_conversation_id: conv.id,
      cw_contact_id: contact.id,
      cw_inbox_id: conv.inbox_id ?? null,
      // Foto de perfil do WhatsApp (coluna da migration 0026). Se a coluna não
      // existir, o PostgREST recusa a linha inteira — por isso saveThreadMeta
      // engole o erro e o resto do sync segue normal.
      avatar_url: contact.thumbnail || null,
      can_reply: typeof conv.can_reply === 'boolean' ? conv.can_reply : null,
      synced_at: new Date().toISOString(),
    });

    return res.status(200).json({
      conversationId: conv.id,
      contactId: contact.id,
      canReply: conv.can_reply ?? null,
      lidas: list.length,
      importadas,
    });
  } catch (e) {
    console.error('[wa-sync]', e?.message);
    return res.status(500).json({ error: 'Falha ao sincronizar com o Chatwoot' });
  }
}
