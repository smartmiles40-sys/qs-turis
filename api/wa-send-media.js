// api/wa-send-media.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/wa-send-media
//   { leadId, fileName, mimeType, dataBase64, caption? }
//   (áudio sempre sai como nota de voz: OGG/Opus é o que a Meta entrega assim)
//   { leadId, stickerUrl }   → figurinha salva da galeria
//
// Envia áudio (nota de voz gravada no navegador), imagem, vídeo, PDF ou
// figurinha pelo número OFICIAL, direto na Cloud API (23/09/2026 — Chatwoot e
// Evolution saíram do QS). Mesma trava do /api/wa-send: o servidor confirma que
// o lead é deste usuário antes de mandar qualquer coisa.
//
// O caminho do arquivo: navegador (base64) → aqui → sobe pra Meta (/media,
// devolve um id) → manda a mensagem com esse id → guarda uma cópia no bucket
// `wa-midia` pra bolha do QS mostrar o arquivo.
//
// ⚠️ Limite: a Vercel aceita ~4,5 MB de corpo, e base64 infla ~33%. Por isso o
// teto é 3 MB de arquivo — o navegador já comprime imagem antes de mandar.
// -----------------------------------------------------------------------------

import {
  assertCanAccessLead, getSupabaseUserId, completeWhatsAppTask, assinarComoUsuario,
} from './_wa.js';
import { subirMidiaBytes, enviarMidia } from './_meta.js';
import { janelaAberta, registrarSaida } from './_waSaida.js';
import { guardarMidia, rotuloDaMidia } from './_waMidia.js';
import { pediuParaParar } from './_waOptout.js';
import { webmParaOggBytes, ehWebm } from './_opusRemux.js';

const MAX_BYTES = 3 * 1024 * 1024;

const TIPOS_OK = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac',
  'video/mp4', 'application/pdf',
];

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

/**
 * Como a Meta quer cada tipo. Ela é mais estreita que o WhatsApp do celular:
 * imagem só JPG/PNG, WebP só como FIGURINHA, GIF só como documento.
 */
function tipoNaMeta(mime) {
  if (mime === 'image/jpeg' || mime === 'image/png') return 'image';
  if (mime === 'image/webp') return 'sticker';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'video/mp4') return 'video';
  return 'document';
}

/** A bolha do QS usa os tipos de sempre (image/audio/video/file). */
function tipoDaBolha(tipoMeta) {
  return { image: 'image', sticker: 'image', audio: 'audio', video: 'video' }[tipoMeta] || 'file';
}

/** Figurinha salva: só aceita arquivo do NOSSO bucket, senão vira proxy aberto. */
function urlDoNossoBucket(url) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  return Boolean(base) && url.startsWith(`${base}/storage/v1/object/public/wa-midia/`);
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
  const stickerUrl = String(body.stickerUrl || '').trim();

  if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });
  if (!dataBase64 && !stickerUrl) return res.status(400).json({ error: 'Arquivo vazio' });

  let bytes;
  let mimeFinal = mimeType;

  if (stickerUrl) {
    if (!urlDoNossoBucket(stickerUrl)) return res.status(400).json({ error: 'Figurinha inválida.' });
    try {
      const r = await fetch(stickerUrl, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      bytes = Buffer.from(await r.arrayBuffer());
      mimeFinal = 'image/webp';
    } catch (e) {
      console.error('[wa-send-media] baixar figurinha:', e?.message);
      return res.status(502).json({ error: 'Não consegui baixar a figurinha salva.' });
    }
  } else {
    if (!TIPOS_OK.includes(mimeType)) return res.status(415).json({ error: 'Tipo de arquivo não aceito.' });
    try {
      bytes = Buffer.from(dataBase64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Arquivo inválido' });
    }
  }

  if (!bytes.length) return res.status(400).json({ error: 'Arquivo vazio' });
  if (bytes.length > MAX_BYTES) return res.status(413).json({ error: 'Arquivo grande demais (máx. 3 MB).' });

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
  const telefone = auth.lead?.phone;
  if (!telefone) return res.status(409).json({ error: 'Este lead não tem telefone.', motivo: 'sem-telefone' });

  if (await pediuParaParar(leadId).catch(() => false)) {
    return res.status(409).json({ error: 'Este cliente pediu para não receber mais mensagens.', motivo: 'optout' });
  }
  // Arquivo é mensagem livre: só dentro da janela de 24h.
  if (!(await janelaAberta(leadId))) {
    return res.status(409).json({
      error: 'O cliente não fala com a gente há mais de 24h. Pelo número oficial só sai MODELO aprovado.',
      motivo: 'fora-da-janela-24h',
    });
  }

  // ── ÁUDIO: a Meta só aceita OGG/Opus (webm é recusado, e calado) ─────────
  // Roda mesmo com a conversão já feita no navegador: aba aberta o dia inteiro
  // roda código velho, e aqui não existe aba velha.
  if (mimeFinal.startsWith('audio/') && ehWebm(bytes)) {
    const ogg = webmParaOggBytes(bytes);
    if (!ogg) {
      return res.status(415).json({
        error: 'Não consegui preparar este áudio para o WhatsApp. Grave de novo, ou mande por escrito.',
        motivo: 'audio-webm-nao-convertido',
      });
    }
    bytes = ogg;
    mimeFinal = 'audio/ogg';
  }
  if (mimeFinal === 'audio/webm') mimeFinal = 'audio/ogg';

  const tipo = tipoNaMeta(mimeFinal);
  // Legenda assinada, como o texto — menos em nota de voz e figurinha, que não
  // levam legenda nenhuma no WhatsApp.
  const legenda = (tipo === 'audio' || tipo === 'sticker') ? null : await assinarComoUsuario(caption, auth.user);

  try {
    const up = await subirMidiaBytes(bytes, mimeFinal, fileName);
    if (up.erro) {
      console.warn(`[wa-send-media] upload recusado (${up.erro}): ${up.detalhe || ''}`);
      return res.status(502).json({ error: up.detalhe || 'A Meta não aceitou o arquivo.', motivo: up.erro });
    }
    const r = await enviarMidia({ para: telefone, tipo, mediaId: up.id, legenda, nomeArquivo: fileName });
    if (r.erro) {
      console.warn(`[wa-send-media] a Meta recusou (${r.erro}${r.codigo ? ' ' + r.codigo : ''}): ${r.detalhe || ''}`);
      if (r.codigo === 131047) {
        return res.status(409).json({ error: 'A janela de 24h está fechada. Use um modelo aprovado.', motivo: 'fora-da-janela-24h' });
      }
      return res.status(502).json({ error: r.detalhe || 'A Meta não aceitou o arquivo.', motivo: r.erro, codigo: r.codigo });
    }

    // ⚠️ DAQUI PRA BAIXO O ARQUIVO JÁ SAIU PRO CLIENTE: nada pode virar erro.
    const url = await guardarMidia(bytes, mimeFinal, { leadId, nomeArquivo: fileName }).catch(() => null);
    const bolha = tipoDaBolha(tipo);
    await registrarSaida({
      leadId,
      wamid: r.wamid,
      texto: legenda || (url ? '' : rotuloDaMidia(bolha)),
      anexos: url ? [{ type: bolha, url }] : [],
      remetente: auth.user?.name || null,
    });

    let tarefa = null;
    try {
      tarefa = await completeWhatsAppTask(leadId, auth.lead?.owner_id ?? null);
    } catch (e) {
      console.warn('[wa-send-media] não consegui concluir a atividade:', e?.message);
    }
    return res.status(200).json({ ok: true, wamid: r.wamid, tarefaConcluida: tarefa });
  } catch (e) {
    console.error('[wa-send-media]', e?.message);
    return res.status(502).json({ error: 'Não consegui enviar o arquivo. Tente de novo.' });
  }
}
