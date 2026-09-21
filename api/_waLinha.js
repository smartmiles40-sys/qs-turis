// api/_waLinha.js
// -----------------------------------------------------------------------------
// O WHATSAPP DE CADA SDR (0082, 21/09/2026).
//
// Cada SDR tem um chip da empresa e conecta o número DENTRO do QS, lendo o QR.
// O transporte é a Evolution DIRETO — sem Chatwoot no meio. Motivo: foi o
// caminho Chatwoot→QS que morreu em 02/09 e deixou o time 3 semanas no
// WhatsApp Web; aqui a Evolution avisa o QS (/api/wa-evolution-webhook) e o QS
// fala com a Evolution. Uma peça a menos pra cair calada.
//
// A mensagem pertence ao NÚMERO (`qs_wa_messages.linha_user_id`): o dono vê;
// admin, gestor e closer veem tudo. A regra mora na RLS da 0082.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { EVO_BASE, evo, evoGet, evoConfigured, noAr, estadoInstancia } from './_evolution.js';
import { toE164BR } from './_wa.js';

export const EVENTOS_DA_LINHA = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'];

const LINHA_COLS = 'user_id,instancia,numero,status,status_em,conectado_em,historico_em';

// ── Onde mora cada linha ────────────────────────────────────────────────────

export async function linhaDoUsuario(userId) {
  if (!userId) return null;
  const rows = await rest(`qs_wa_linhas?select=${LINHA_COLS}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return (Array.isArray(rows) && rows[0]) || null;
}

/**
 * A linha dona de uma instância. Cache de 60s: roda em TODA mensagem do
 * webhook, e a tabela só muda quando alguém conecta um número. `null` também é
 * guardado — as instâncias antigas (1935, marketing) mandam evento o tempo todo.
 */
const cacheInstancia = new Map();
export async function linhaDaInstancia(nome) {
  if (!nome) return null;
  const hit = cacheInstancia.get(nome);
  if (hit && Date.now() - hit.em < 60_000) return hit.linha;
  const rows = await rest(`qs_wa_linhas?select=${LINHA_COLS}&instancia=eq.${encodeURIComponent(nome)}&limit=1`);
  const linha = (Array.isArray(rows) && rows[0]) || null;
  cacheInstancia.set(nome, { linha, em: Date.now() });
  return linha;
}

export async function atualizarLinha(userId, patch) {
  cacheInstancia.clear();
  await rest(`qs_wa_linhas?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH', body: patch, prefer: 'return=minimal',
  });
}

/**
 * Nome da instância na Evolution. Legível no Manager (o Bruno reconhece
 * "qs-mariana-3f9a1c") e único pelo pedaço do id — dois SDRs com o mesmo
 * primeiro nome não colidem.
 */
export function nomeDaInstancia(user) {
  const primeiro = String(user?.name || 'sdr').trim().split(/\s+/)[0]
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '') || 'sdr';
  return `qs-${primeiro}-${String(user.id).replace(/-/g, '').slice(0, 6)}`;
}

/** A URL do webhook que a Evolution vai chamar pra ESTE QS. */
export function urlDoWebhook(req) {
  const segredo = String(process.env.EVOLUTION_WEBHOOK_SECRET || '').trim();
  if (!segredo) return null;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return null;
  return `https://${host}/api/wa-evolution-webhook?secret=${encodeURIComponent(segredo)}`;
}

/**
 * Cria a instância na Evolution (ou reaproveita, se já existir) e aponta o
 * webhook dela pro QS. Idempotente: chamar de novo só reafirma o webhook.
 *
 * Os ajustes contam:
 *  - groupsIgnore: o chip é de prospecção; grupo só geraria ruído (e custo).
 *  - syncFullHistory: é o que permite puxar pro QS as conversas feitas pelo
 *    WhatsApp Web desde 03/09 (a Evolution guarda; o QS importa depois).
 *  - readMessages false: abrir a conversa no QS não pode marcar "lida" pro
 *    cliente sozinho.
 */
export async function garantirInstancia(nome, webhookUrl) {
  let existe = false;
  try {
    const out = await evoGet(`/instance/connectionState/${encodeURIComponent(nome)}`);
    existe = Boolean(out);
  } catch (e) {
    if (e?.status !== 404) throw e;
  }

  const webhook = { enabled: true, url: webhookUrl, byEvents: false, base64: false, events: EVENTOS_DA_LINHA };

  if (!existe) {
    await evo('/instance/create', {
      instanceName: nome,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      groupsIgnore: true,
      rejectCall: false,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: true,
      webhook,
    }, { timeoutMs: 20_000 });
  }

  // Sempre reafirma: versão da Evolution que ignora o `webhook` do create, ou
  // domínio do QS que mudou, se resolvem aqui sem ninguém abrir o Manager.
  try {
    await evo(`/webhook/set/${encodeURIComponent(nome)}`, { webhook });
  } catch (e) {
    console.warn('[wa-linha] webhook/set falhou:', e?.message);
    if (!existe) throw e;
  }
}

/** O número conectado (ownerJid) da instância, se estiver no ar. */
export async function numeroDaInstancia(nome) {
  try {
    const out = await evoGet(`/instance/fetchInstances?instanceName=${encodeURIComponent(nome)}`);
    const linha = Array.isArray(out) ? out[0] : out;
    const i = linha?.instance && typeof linha.instance === 'object' ? linha.instance : linha;
    const jid = String(i?.ownerJid || i?.owner || '');
    return jid.split('@')[0] || null;
  } catch {
    return null;
  }
}

// ── Lendo a mensagem que a Evolution manda ─────────────────────────────────

/**
 * O telefone do CONTATO de uma mensagem. Cuidado com o `@lid`: desde 2025 o
 * WhatsApp identifica muita gente por um id interno ("12345@lid") que NÃO é o
 * telefone. Quando isso acontece, o telefone real vem ao lado
 * (`remoteJidAlt` / `senderPn`, conforme a versão da Evolution). Sem esta
 * leitura, a mensagem não casa com lead nenhum e vai pra triagem calada.
 */
export function telefoneDoContato(key = {}) {
  const jids = [key.remoteJid, key.remoteJidAlt, key.senderPn, key.participantAlt];
  for (const j of jids) {
    const s = String(j || '');
    if (s.endsWith('@s.whatsapp.net')) return s.split('@')[0];
  }
  return null;
}

/** Conversa que o QS não trata: grupo, status, canal, broadcast. */
export function ehConversaIgnorada(remoteJid) {
  const j = String(remoteJid || '');
  return !j || j.endsWith('@g.us') || j.endsWith('@broadcast') || j.endsWith('@newsletter')
    || j === 'status@broadcast';
}

/** Desembrulha as mensagens "com capa" (efêmera, visualização única, legenda de documento). */
function miolo(m) {
  let msg = m || {};
  for (let i = 0; i < 4; i++) {
    const dentro = msg.ephemeralMessage?.message
      || msg.viewOnceMessage?.message
      || msg.viewOnceMessageV2?.message
      || msg.documentWithCaptionMessage?.message
      || msg.editedMessage?.message;
    if (!dentro) break;
    msg = dentro;
  }
  return msg;
}

const TIPOS_DE_MIDIA = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'file',
  stickerMessage: 'image',
};

/**
 * Traduz o formato da Evolution/Baileys pro que o QS grava. Devolve null pro
 * que não vira bolha (reação, apagada, protocolo, enquete…) — cada um desses é
 * tratado à parte por quem chama.
 */
export function lerMensagem(item) {
  const key = item?.key || {};
  const m = miolo(item?.message);
  const ctx = m.extendedTextMessage?.contextInfo
    || m.imageMessage?.contextInfo || m.videoMessage?.contextInfo
    || m.audioMessage?.contextInfo || m.documentMessage?.contextInfo
    || m.stickerMessage?.contextInfo || null;

  let texto = m.conversation ?? m.extendedTextMessage?.text ?? null;
  let midia = null;
  for (const [campo, tipo] of Object.entries(TIPOS_DE_MIDIA)) {
    if (m[campo]) {
      const d = m[campo];
      midia = {
        tipo,
        campo,
        mime: String(d.mimetype || '').split(';')[0].trim() || null,
        nomeArquivo: d.fileName || null,
        figurinha: campo === 'stickerMessage',
      };
      texto = texto ?? d.caption ?? null;
      break;
    }
  }
  if (!texto && !midia) {
    if (m.contactMessage) texto = `👤 Contato: ${m.contactMessage.displayName || ''}`.trim();
    else if (m.locationMessage) {
      const l = m.locationMessage;
      texto = `📍 Localização: https://maps.google.com/?q=${l.degreesLatitude},${l.degreesLongitude}`;
    }
  }
  if (!texto && !midia) return null;

  const ts = Number(item?.messageTimestamp);
  return {
    id: String(key.id || ''),
    fromMe: key.fromMe === true,
    remoteJid: String(key.remoteJid || ''),
    telefone: telefoneDoContato(key),
    nomeContato: key.fromMe ? null : (item?.pushName || null),
    texto: texto ? String(texto) : '',
    midia,
    enviadaEm: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
    respondendoA: ctx?.stanzaId ? String(ctx.stanzaId) : null,
    trechoCitado: ctx?.quotedMessage
      ? String(ctx.quotedMessage.conversation || ctx.quotedMessage.extendedTextMessage?.text
        || ctx.quotedMessage.imageMessage?.caption || '').slice(0, 160) || null
      : null,
  };
}

/** Recibo da Evolution → vocabulário do QS. PENDING não é recibo nenhum. */
export function statusDaEvolution(s) {
  const v = String(s ?? '').toUpperCase();
  if (v === 'SERVER_ACK' || v === '2') return 'sent';
  if (v === 'DELIVERY_ACK' || v === '3') return 'delivered';
  if (v === 'READ' || v === 'PLAYED' || v === '4' || v === '5') return 'read';
  if (v === 'ERROR' || v === '0') return 'failed';
  return null;
}

// ── Mídia ───────────────────────────────────────────────────────────────────

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav',
  'audio/webm': 'weba', 'video/mp4': 'mp4', 'application/pdf': 'pdf',
};

/**
 * Guarda o arquivo no bucket `wa-midia` e devolve a URL pública. O caminho leva
 * um pedaço aleatório: público como eram as URLs do Chatwoot, mas ninguém
 * chega nele chutando.
 */
export async function guardarMidia(bytes, mime, { leadId, nomeArquivo } = {}) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !chave || !bytes?.length) return null;

  const tipo = String(mime || 'application/octet-stream').split(';')[0].trim();
  const extDoNome = String(nomeArquivo || '').match(/\.([a-z0-9]{1,5})$/i)?.[1];
  const ext = EXT[tipo] || extDoNome || 'bin';
  const sorteio = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const caminho = `${leadId || 'sem-lead'}/${Date.now()}-${sorteio}.${ext}`;

  const up = await fetch(`${base}/storage/v1/object/wa-midia/${caminho}`, {
    method: 'POST',
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': tipo },
    body: bytes,
  });
  if (!up.ok) {
    console.warn('[wa-linha] upload da mídia:', up.status, (await up.text()).slice(0, 160));
    return null;
  }
  return `${base}/storage/v1/object/public/wa-midia/${caminho}`;
}

/**
 * Baixa a mídia de uma mensagem (a Evolution descriptografa) e guarda no QS.
 * Best-effort: falhou, a bolha entra com o rótulo "📷 imagem" e sem arquivo —
 * perder a foto é ruim, perder a mensagem é pior.
 */
export async function baixarMidia(instancia, lida, leadId) {
  if (!lida?.midia) return [];
  try {
    const out = await evo(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instancia)}`, {
      message: { key: { id: lida.id } },
      convertToMp4: false,
    }, { timeoutMs: 20_000 });
    const b64 = String(out?.base64 || '').replace(/^data:[^,]+,/, '');
    if (!b64) return [];
    const mime = String(out?.mimetype || lida.midia.mime || '').split(';')[0].trim();
    const url = await guardarMidia(Buffer.from(b64, 'base64'), mime, { leadId, nomeArquivo: lida.midia.nomeArquivo });
    return url ? [{ type: lida.midia.tipo, url }] : [];
  } catch (e) {
    console.warn('[wa-linha] mídia não baixada:', e?.message);
    return [];
  }
}

export function rotuloDaMidia(tipo) {
  return { image: '📷 imagem', audio: '🎤 áudio', video: '🎬 vídeo' }[tipo] || '📎 arquivo';
}

// ── Gravar ──────────────────────────────────────────────────────────────────

export async function gravarNaLinha({ leadId, linhaUserId, sourceId, direcao, texto, anexos = [],
  remetente = null, enviadaEm = null, status = null, respondendoA = null, trechoCitado = null }) {
  const novo = await rest('rpc/qs_wa_ingest_linha', {
    method: 'POST',
    body: {
      p_lead: leadId,
      p_linha: linhaUserId,
      p_source: sourceId,
      p_direction: direcao,
      p_content: texto ?? '',
      p_attachments: anexos,
      p_sender: remetente,
      p_sent_at: enviadaEm || new Date().toISOString(),
      p_status: status,
      p_reply_to: respondendoA,
      p_reply_prev: trechoCitado,
    },
  });
  return novo === true;
}

// ── Enviar ──────────────────────────────────────────────────────────────────

/**
 * A linha por onde ESTE usuário manda. Só a própria: o closer que abre a
 * conversa de um SDR responde pelo caminho dele (número do papel), não pelo
 * chip do SDR.
 *
 * Devolve:
 *   null                        → usuário sem linha: segue o caminho antigo
 *   { linha }                   → linha no ar, manda por ela
 *   { erro, motivo }            → tem linha mas ela está fora do ar
 */
export async function linhaParaEnviar(userId) {
  if (!evoConfigured()) return null;
  let linha;
  try {
    linha = await linhaDoUsuario(userId);
  } catch (e) {
    // Tabela ausente (0082 não aplicada) ou banco lento: segue o caminho antigo.
    console.warn('[wa-linha] não consegui ler a linha do usuário:', e?.message);
    return null;
  }
  if (!linha) return null;
  if (!noAr(linha.status)) {
    // O banco pode estar atrasado (o CONNECTION_UPDATE se perdeu). Antes de
    // barrar o SDR, pergunta à própria Evolution.
    const agora = await estadoInstancia(linha.instancia);
    if (noAr(agora)) {
      atualizarLinha(userId, { status: 'open', status_em: new Date().toISOString() })
        .catch(() => {});
      return { linha: { ...linha, status: 'open' } };
    }
  }
  if (!noAr(linha.status)) {
    return {
      erro: 'Seu WhatsApp está DESCONECTADO do QS — a mensagem não sairia. ' +
            'Abra a aba WhatsApp → "Meu WhatsApp" e leia o QR de novo.',
      motivo: 'numero-desconectado',
    };
  }
  return { linha };
}

/** Número pra Evolution: só dígitos, com 55. */
export function numeroParaEnvio(phone) {
  const e164 = toE164BR(phone);
  return e164 ? e164.replace('+', '') : null;
}

export function sourceDoEnvio(sent) {
  return String(sent?.key?.id || sent?.message?.key?.id || '').trim() || null;
}

export { EVO_BASE };
