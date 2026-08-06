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
  inboxPermitida, assinarComoUsuario, CW_BASE,
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

/**
 * A Evolution decide "isso é áudio ou vídeo?" pela EXTENSÃO que aparece na URL do
 * anexo — e na tabela mime que ela usa, `.webm` é **video/webm**; a extensão de
 * áudio WebM é `.weba`. Ou seja: um áudio chamado `.webm` chegava no cliente como
 * mensagem de VÍDEO, sem imagem, num contêiner que o iPhone não abre. Era o
 * "áudio estranho".
 *
 * Com a extensão certa ela classifica como áudio, roda o ffmpeg embutido e manda
 * OGG/Opus mono com ptt — a nota de voz de verdade, com bolinha e onda.
 */
const EXT_POR_MIME = {
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'audio/aac': 'm4a', 'audio/wav': 'wav', 'audio/webm': 'weba',
};

function nomeComExtensaoCerta(nome, mime) {
  const ext = EXT_POR_MIME[mime];
  if (!ext) return nome;
  if (nome.toLowerCase().endsWith('.' + ext)) return nome;
  const base = nome.replace(/\.[^.]+$/, '') || 'audio';
  return `${base}.${ext}`;
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
  const isVoiceMessage = body.isVoiceMessage === true || body.isVoiceMessage === 'true';

  // Figurinha salva da galeria: o navegador manda só a URL (o arquivo mora no
  // Chatwoot e o CORS impede o front de baixá-lo). O servidor busca — e SÓ do
  // nosso Chatwoot: URL de fora é recusada, senão isto vira um proxy aberto.
  const stickerUrl = String(body.stickerUrl || '').trim();

  if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });
  if (!dataBase64 && !stickerUrl) return res.status(400).json({ error: 'Arquivo vazio' });

  const inboxPedida = inboxPermitida(body.inboxId);
  if (inboxPedida == null && body.inboxId != null && body.inboxId !== '') {
    return res.status(400).json({ error: 'Esse número não está liberado para envio.' });
  }
  let bytes;
  let mimeFinal = mimeType;

  if (stickerUrl) {
    if (!stickerUrl.startsWith(`${CW_BASE}/`)) {
      return res.status(400).json({ error: 'Figurinha inválida.' });
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const r = await fetch(stickerUrl, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      bytes = Buffer.from(await r.arrayBuffer());
      const tipo = String(r.headers.get('content-type') || '').split(';')[0].trim();
      mimeFinal = TIPOS_OK.includes(tipo) ? tipo : 'image/webp';
    } catch (e) {
      console.error('[wa-send-media] baixar figurinha:', e?.message);
      return res.status(502).json({ error: 'Não consegui baixar a figurinha salva.' });
    } finally {
      clearTimeout(timer);
    }
  } else {
    if (!TIPOS_OK.includes(mimeType)) {
      return res.status(415).json({ error: 'Tipo de arquivo não aceito.' });
    }
    try {
      bytes = Buffer.from(dataBase64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Arquivo inválido' });
    }
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

    // Mesma regra do wa-send: pediu número específico, o atalho só vale se a
    // conversa conhecida for daquele número.
    if (inboxPedida != null && Number(inboxId) !== Number(inboxPedida)) {
      conversationId = null;
      contactId = null;
      inboxId = null;
    }

    if (!conversationId) {
      const r = await ensureConversation(auth.lead, inboxPedida);
      if (r.error) return res.status(409).json({ error: motivoHumano(r.error), motivo: r.error });
      conversationId = r.conversation.id;
      contactId = r.contact.id;
      inboxId = r.conversation.inbox_id ?? inboxPedida ?? defaultInboxId();
    }

    // Legenda assinada, mesma regra do texto. Duas exceções:
    // - NOTA DE VOZ: o WhatsApp nem mostra legenda, e o nome sozinho viraria
    //   uma bolha de texto solta antes do áudio.
    // - FIGURINHA (webp sem legenda): sticker não carrega texto — a assinatura
    //   entraria como legenda (assinarTexto('') devolve `*Nome*`) e forçaria o
    //   envio como imagem comum em vez de figurinha.
    const ehNotaDeVoz = isVoiceMessage && mimeFinal.startsWith('audio/');
    const ehFigurinha = mimeFinal === 'image/webp' && !caption;
    const captionFinal = (ehNotaDeVoz || ehFigurinha)
      ? caption
      : await assinarComoUsuario(caption, auth.user);

    const form = new FormData();
    form.append('message_type', 'outgoing');
    form.append('private', 'false');
    if (captionFinal) form.append('content', captionFinal);
    // Marca a bolha como nota de voz no Chatwoot (player com onda em vez de
    // "arquivo"). Quem manda no WhatsApp é o formato — isto é só a UI de lá.
    if (isVoiceMessage && mimeFinal.startsWith('audio/')) {
      form.append('is_voice_message', 'true');
    }
    form.append(
      'attachments[]',
      new Blob([bytes], { type: mimeFinal }),
      nomeComExtensaoCerta(fileName, mimeFinal)
    );

    const sent = await cwForm(`/conversations/${conversationId}/messages`, form);

    // ⚠️ DAQUI PRA BAIXO O ARQUIVO JÁ SAIU PRO CLIENTE.
    // Nada aqui pode virar "não consegui enviar" — o SDR reenviaria e o cliente
    // receberia o mesmo áudio duas vezes. Falha de gravação é problema nosso.
    const anexos = Array.isArray(sent?.attachments) ? sent.attachments : [];
    const temUrl = anexos.some((a) => a.data_url || a.thumb_url);

    let tarefa = null;
    try {
      await ingestMessage({
        leadId,
        conversationId,
        contactId,
        inboxId,
        message: {
          id: sent?.id ?? null,
          content: captionFinal || (temUrl ? '' : rotuloDe(mimeFinal)),
          message_type: 1,
          created_at: sent?.created_at ?? null,
          attachments: anexos,
          sender: { name: auth.user?.name || null },
          // O id no WhatsApp costuma chegar só no message_updated do webhook,
          // mas quando o Chatwoot já devolve, aproveita.
          source_id: sent?.source_id ?? null,
        },
      });
      tarefa = await completeWhatsAppTask(leadId, auth.lead?.owner_id ?? null);
    } catch (e) {
      console.error('[wa-send-media] enviado, mas falhou ao gravar no QS:', e?.message);
    }

    return res.status(200).json({ ok: true, conversationId, messageId: sent?.id ?? null, tarefaConcluida: tarefa });
  } catch (e) {
    console.error('[wa-send-media]', e?.message);
    if (e?.status === 401 || e?.status === 403) {
      return res.status(503).json({ error: 'O atendimento recusou o token (CHATWOOT_AGENT_TOKEN).' });
    }
    return res.status(502).json({ error: 'Não consegui enviar o arquivo. Tente de novo.' });
  }
}
