// api/wa-history.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/wa-history  { leadId }
//
// Baixa o histórico COMPLETO daquele cliente do Chatwoot pro QS — não só as
// ~20 últimas que o /api/wa-sync traz. É o "trazer tudo que já foi conversado
// com esse cliente pra dentro do sistema".
//
// Como funciona a paginação do Chatwoot: /messages devolve o bloco mais recente;
// pra ir pra trás, manda-se ?before=<id da mensagem mais antiga do bloco>.
// Repetimos até acabar (ou até o teto de segurança), ingerindo cada bloco.
//
// Idempotente: reingerir não duplica (a chave é o id da mensagem no Chatwoot).
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import {
  assertCanAccessLead, getSupabaseUserId, cwConfigured, cw,
  toE164BR, findContact, pickConversation, ingestMessage,
} from './_wa.js';

// Teto de segurança: 20 blocos ≈ 400 mensagens. Evita função pendurada num
// contato antigo com anos de conversa (e o limite de tempo da Vercel).
const MAX_BLOCOS = 20;

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
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
  if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });

  let auth;
  try {
    auth = await assertCanAccessLead(userId, leadId);
  } catch (e) {
    console.error('[wa-history] checagem de acesso:', e?.message);
    return res.status(500).json({ error: 'Falha ao validar o lead' });
  }
  if (!auth.ok) {
    const status = auth.reason === 'lead-de-outro-sdr' ? 403 : 404;
    return res.status(status).json({ error: 'Sem acesso a este lead', motivo: auth.reason });
  }

  if (!cwConfigured()) return res.status(503).json({ error: 'Atendimento não configurado' });

  const phone = toE164BR(auth.lead.phone);
  if (!phone) return res.status(200).json({ importadas: 0, motivo: 'lead-sem-telefone' });

  try {
    const contact = await findContact(phone);
    if (!contact) return res.status(200).json({ importadas: 0, motivo: 'sem-contato-no-chatwoot' });

    const conv = await pickConversation(contact.id);
    if (!conv) return res.status(200).json({ importadas: 0, motivo: 'sem-conversa' });

    let importadas = 0;
    let lidas = 0;
    let before = null;
    let completo = false;

    for (let bloco = 0; bloco < MAX_BLOCOS; bloco++) {
      const qs = before ? `?before=${encodeURIComponent(before)}` : '';
      const data = await cw(`/conversations/${conv.id}/messages${qs}`);
      const list = Array.isArray(data?.payload) ? data.payload : [];
      if (!list.length) { completo = true; break; }

      lidas += list.length;
      for (const m of list) {
        const novo = await ingestMessage({
          leadId,
          conversationId: conv.id,
          message: m,
          contactId: contact.id,
          inboxId: conv.inbox_id ?? null,
          canReply: typeof conv.can_reply === 'boolean' ? conv.can_reply : null,
        });
        if (novo) importadas++;
      }

      // O bloco vem do mais antigo pro mais novo: o cursor é o primeiro id.
      const maisAntiga = list[0]?.id;
      if (!maisAntiga || maisAntiga === before) { completo = true; break; }
      before = maisAntiga;
    }

    await rest('qs_wa_threads?on_conflict=lead_id', {
      method: 'POST',
      body: [{
        lead_id: leadId,
        cw_conversation_id: conv.id,
        cw_contact_id: contact.id,
        cw_inbox_id: conv.inbox_id ?? null,
        history_synced: completo,
        synced_at: new Date().toISOString(),
      }],
      prefer: 'resolution=merge-duplicates,return=minimal',
    });

    return res.status(200).json({ importadas, lidas, completo });
  } catch (e) {
    console.error('[wa-history]', e?.message);
    return res.status(500).json({ error: 'Falha ao baixar o histórico' });
  }
}
