// api/_waLinhaEnvio.js
// -----------------------------------------------------------------------------
// Mandar pelo NÚMERO DO PRÓPRIO SDR (0082). Usado pelo /api/wa-send (texto) e
// pelo /api/wa-send-media (áudio, foto, arquivo, figurinha) quando quem escreve
// tem linha conectada. Sem Chatwoot: o QS fala direto com a Evolution e grava a
// bolha na hora; o webhook traz o eco da mesma mensagem, que o banco reconhece
// pelo id do WhatsApp e não duplica.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { evo, resolveJid } from './_evolution.js';
import { numeroParaEnvio, sourceDoEnvio, gravarNaLinha, guardarMidia } from './_waLinha.js';

/** O número de destino já no formato que o WhatsApp conhece (com/sem o 9º dígito). */
async function destino(linha, phone) {
  if (!numeroParaEnvio(phone)) return null;
  const jid = await resolveJid(linha.instancia, phone);
  return jid ? String(jid).split('@')[0] : numeroParaEnvio(phone);
}

/**
 * A mensagem citada, SE for deste lead e deste número (o WhatsApp só cita o
 * que existe na conversa daquele chip). Citação é opcional: sem ela, a
 * mensagem sai sem citar — perder a citação é aceitável, perder a mensagem não.
 */
async function citacao(leadId, linha, respondendoA, numero) {
  if (!respondendoA) return null;
  try {
    const rows = await rest(
      `qs_wa_messages?select=source_id,content,direction,linha_user_id&id=eq.${encodeURIComponent(respondendoA)}` +
      `&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
    );
    const m = rows?.[0];
    if (!m?.source_id || m.linha_user_id !== linha.user_id) return null;
    return {
      source: m.source_id,
      trecho: m.content ? String(m.content).slice(0, 160) : null,
      evo: {
        key: { id: m.source_id, remoteJid: `${numero}@s.whatsapp.net`, fromMe: m.direction === 'out' },
        message: { conversation: m.content || '' },
      },
    };
  } catch {
    return null;
  }
}

/** Texto. Devolve { ok, sourceId } ou { erro, motivo, status }. */
export async function enviarTextoPelaLinha({ linha, lead, user, texto, respondendoA = null }) {
  const numero = await destino(linha, lead.phone);
  if (!numero) return { erro: 'Este lead não tem telefone válido.', motivo: 'lead-sem-telefone', status: 409 };

  const cit = await citacao(lead.id, linha, respondendoA, numero);
  const sent = await evo(`/message/sendText/${encodeURIComponent(linha.instancia)}`, {
    number: numero,
    text: texto,
    ...(cit ? { quoted: cit.evo } : {}),
  }, { timeoutMs: 20_000 });

  // ⚠️ DAQUI PRA BAIXO A MENSAGEM JÁ SAIU. Falha ao gravar é problema nosso: o
  // eco do webhook traz a mensagem de volta.
  const sourceId = sourceDoEnvio(sent) || `qs-${crypto.randomUUID()}`;
  try {
    await gravarNaLinha({
      leadId: lead.id, linhaUserId: linha.user_id, sourceId, direcao: 'out', texto,
      remetente: user?.name || null, status: 'sent',
      respondendoA: cit?.source || null, trechoCitado: cit?.trecho || null,
    });
  } catch (e) {
    console.error('[wa-linha] enviado, mas falhou ao gravar no QS:', e?.message);
  }
  return { ok: true, sourceId };
}

const TIPO_DA_BOLHA = (mime) =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio'
    : mime.startsWith('video/') ? 'video' : 'file';

/**
 * Arquivo. Três jeitos de mandar, porque o WhatsApp trata cada um diferente:
 *  - nota de voz → sendWhatsAppAudio (a Evolution converte pra OGG/Opus com a
 *    bolinha e a onda; mandado como "arquivo de áudio" chega como anexo)
 *  - figurinha (webp sem legenda) → sendSticker
 *  - o resto → sendMedia (imagem, vídeo, PDF), com legenda
 */
export async function enviarArquivoPelaLinha({ linha, lead, user, bytes, mime, nomeArquivo, legenda = '', notaDeVoz = false }) {
  const numero = await destino(linha, lead.phone);
  if (!numero) return { erro: 'Este lead não tem telefone válido.', motivo: 'lead-sem-telefone', status: 409 };

  const b64 = Buffer.from(bytes).toString('base64');
  const inst = encodeURIComponent(linha.instancia);
  const ehAudio = mime.startsWith('audio/');
  const ehFigurinha = mime === 'image/webp' && !legenda;

  let sent;
  if (ehAudio && notaDeVoz) {
    sent = await evo(`/message/sendWhatsAppAudio/${inst}`, { number: numero, audio: b64, encoding: true }, { timeoutMs: 45_000 });
  } else if (ehFigurinha) {
    sent = await evo(`/message/sendSticker/${inst}`, { number: numero, sticker: b64 }, { timeoutMs: 30_000 });
  } else {
    const mediatype = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video'
      : ehAudio ? 'audio' : 'document';
    sent = await evo(`/message/sendMedia/${inst}`, {
      number: numero, mediatype, mimetype: mime, media: b64,
      fileName: nomeArquivo || 'arquivo', ...(legenda ? { caption: legenda } : {}),
    }, { timeoutMs: 45_000 });
  }

  // Já saiu. Guardar o arquivo é pra bolha do QS ter o que mostrar.
  const sourceId = sourceDoEnvio(sent) || `qs-${crypto.randomUUID()}`;
  try {
    const url = await guardarMidia(bytes, mime, { leadId: lead.id, nomeArquivo });
    await gravarNaLinha({
      leadId: lead.id, linhaUserId: linha.user_id, sourceId, direcao: 'out',
      texto: legenda || (url ? '' : '📎 arquivo'),
      anexos: url ? [{ type: TIPO_DA_BOLHA(mime), url }] : [],
      remetente: user?.name || null, status: 'sent',
    });
  } catch (e) {
    console.error('[wa-linha] arquivo enviado, mas falhou ao gravar no QS:', e?.message);
  }
  return { ok: true, sourceId };
}
