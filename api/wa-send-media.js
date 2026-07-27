// api/wa-send-media.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/wa-send-media
//   { leadId, fileName, mimeType, dataBase64, caption? }
//
// Envia áudio (nota de voz gravada no navegador), imagem ou arquivo. Mesma trava
// do /api/wa-send: o servidor confirma que o lead é deste usuário ANTES de tocar
// no Chatwoot — não existe caminho pra mandar mídia pro lead de outro SDR.
//
// Por que base64 e não upload direto: o navegador não pode falar com o Chatwoot
// (o token é server-side). O arquivo vem em JSON, vira Blob aqui e sai como
// multipart pro Chatwoot, que repassa pra Evolution e daí pro WhatsApp.
//
// ⚠️ Limite: a Vercel aceita ~4,5 MB de corpo, e base64 infla ~33%. Por isso o
// teto é 3 MB de arquivo — o navegador já comprime imagem antes de mandar.
// -----------------------------------------------------------------------------

import {
  assertCanAccessLead, getSupabaseUserId, cwConfigured, cwForm,
  ensureConversation, defaultInboxId, motivoHumano, completeWhatsAppTask, ingestMessage,
} from './_wa.js';
import { rest } from './_supabaseAdmin.js';

const MAX_BYTES = 3 * 1024 * 1024;

const TIPOS_OK = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav',
  'video/mp4', 'application/pdf',
];

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

/** Rótulo pra bolha não ficar vazia quando o Chatwoot ainda não devolveu a URL. */
function rotuloDe(mime) {
  if (mime.startsWith('audio/')) return '🎤 áudio';
  if (mime.startsWith('image/')) return '📷 imagem';
  if (mime.startsWith('video/')) return '🎬 vídeo';
  return '📎 arquivo';
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
  const fileName = String(body.fileName || 'arquivo').slice(0, 120);
  // O navegador manda "audio/webm;codecs=opus" — o parâmetro atrapalha a checagem.
  const mimeType = String(body.mimeType || '').toLowerCase().split(';')[0].trim();
  const caption = String(body.caption || '').trim().slice(0, 1000);
  const dataBase64 = String(body.dataBase64 || '');

  if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });
  if (!dataBase64) return res.status(400).json({ error: 'Arquivo vazio' });
  if (!TIPOS_OK.includes(mimeType)) {
    return res.status(415).json({ error: 'Tipo de arquivo não aceito.' });
  }

  let bytes;
  try {
    bytes = Buffer.from(dataBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Arquivo inválido' });
  }
  if (!bytes.length) return res.status(400).json({ error: 'Arquivo vazio' });
  if (bytes.length > MAX_BYTES) {
    return res.status(413).json({ error: 'Arquivo grande demais (máx. 3 MB).' });
  }

  let auth;
  try {
    auth = await assertCanAccessLead(userId, leadId);
  } catch (e) {
    console.error('[wa-send-media] checagem de acesso:', e?.message);
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
      if (r.error) return res.status(409).json({ error: motivoHumano(r.error), motivo: r.error });
      conversationId = r.conversation.id;
      contactId = r.contact.id;
      inboxId = r.conversation.inbox_id ?? defaultInboxId();
    }

    const form = new FormData();
    form.append('message_type', 'outgoing');
    form.append('private', 'false');
    if (caption) form.append('content', caption);
    form.append('attachments[]', new Blob([bytes], { type: mimeType }), fileName);

    const sent = await cwForm(`/conversations/${conversationId}/messages`, form);

    // Se o Chatwoot ainda não devolveu a URL do anexo, a bolha ficaria vazia —
    // mostra um rótulo até o webhook chegar com o arquivo de verdade.
    const anexos = Array.isArray(sent?.attachments) ? sent.attachments : [];
    const temUrl = anexos.some((a) => a.data_url || a.thumb_url);

    await ingestMessage({
      leadId,
      conversationId,
      contactId,
      inboxId,
      message: {
        id: sent?.id ?? null,
        content: caption || (temUrl ? '' : rotuloDe(mimeType)),
        message_type: 1,
        created_at: sent?.created_at ?? null,
        attachments: anexos,
        sender: { name: auth.user?.name || null },
      },
    });

    const tarefa = await completeWhatsAppTask(leadId);

    return res.status(200).json({ ok: true, conversationId, messageId: sent?.id ?? null, tarefaConcluida: tarefa });
  } catch (e) {
    console.error('[wa-send-media]', e?.message);
    if (e?.status === 401 || e?.status === 403) {
      return res.status(503).json({ error: 'O atendimento recusou o token (CHATWOOT_AGENT_TOKEN).' });
    }
    return res.status(502).json({ error: 'Não consegui enviar o arquivo. Tente de novo.' });
  }
}
