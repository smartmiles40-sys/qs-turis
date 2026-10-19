// api/rel-grupos.js
// -----------------------------------------------------------------------------
// GRUPOS DO WHATSAPP NO RELACIONAMENTO (0137, 15/10/2026).
//
// O número do Relacionamento está na API oficial pelo COEX, e a Meta não
// entrega grupos por ali. Os grupos vêm por uma segunda ligação, pela Evolution
// (QR, instância REL_GRUPOS_INSTANCIA). REGRA DO BRUNO, sem exceção: por essa
// ligação SÓ existem grupos. Por isso:
//   • a entrada joga fora, antes de gravar qualquer coisa, tudo que não é @g.us;
//   • o envio só aceita endereço de grupo que JÁ está em rel_wa_grupos, e é a
//     única função do QS que manda mensagem pela Evolution (enviarNoGrupo).
//
//   POST /api/rel-grupos?secret=…        → webhook da Evolution (sem login)
//   GET  /api/rel-grupos?estado=1        → a ligação está de pé?
//   POST { acao: 'sincronizar' }         → puxa a lista de grupos da Evolution
//   POST { acao: 'texto', jid, texto }   → manda texto NO GRUPO (assinado)
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { guardarMidia } from './_waMidia.js';
import { quemChama } from './_relWa.js';

const INSTANCIA = () => String(process.env.REL_GRUPOS_INSTANCIA || 'relacionamento-grupos-4183');
const EVO_URL = () => String(process.env.EVOLUTION_URL || '').replace(/\/+$/, '');
const MAX_TEXTO = 4000;
const MAX_MIDIA = 8 * 1024 * 1024;

// Endereço de grupo do WhatsApp: "1203634…@g.us" (ou o formato antigo "5511…-1612…@g.us").
const JID_GRUPO = /^[0-9]+(-[0-9]+)?@g\.us$/;
const ehGrupo = (jid) => JID_GRUPO.test(String(jid || ''));

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

async function evo(caminho, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  const base = EVO_URL();
  const chave = process.env.EVOLUTION_APIKEY;
  if (!base || !chave) throw new Error('Evolution não configurada (EVOLUTION_URL / EVOLUTION_APIKEY).');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}${caminho}`, {
      method,
      headers: { apikey: chave, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const txt = await r.text();
    const json = safeParse(txt);
    if (!r.ok) throw new Error(`Evolution ${r.status}: ${txt.slice(0, 200)}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}

/**
 * A ÚNICA saída de mensagem pela Evolution no QS. Recusa qualquer destino que
 * não seja um grupo já conhecido — nunca manda pra pessoa.
 */
async function grupoLiberado(jid) {
  if (!ehGrupo(jid)) throw new Error('Destino não é grupo — envio bloqueado.');
  const g = (await rest(`rel_wa_grupos?select=jid,saiu_em&jid=eq.${encodeURIComponent(jid)}&limit=1`))?.[0];
  if (!g) throw new Error('Grupo desconhecido — envio bloqueado.');
  if (g.saiu_em) throw new Error('O número não está mais nesse grupo.');
}

/** A chave de uma mensagem do grupo como o WhatsApp quer (pra citar, reagir, apagar, editar). */
function chaveDe(m) {
  return { remoteJid: m.grupo_jid, fromMe: Boolean(m.de_mim), id: m.msg_id, ...(m.de_mim ? {} : { participant: m.autor_participante || m.autor_jid || undefined }) };
}

async function enviarNoGrupo(jid, texto, { citada = null, mencoes = [] } = {}) {
  await grupoLiberado(jid);
  const body = { number: jid, text: texto };
  if (citada) body.quoted = { key: chaveDe(citada), message: { conversation: citada.texto || '' } };
  if (mencoes.length) body.mentioned = mencoes;
  return evo(`/message/sendText/${encodeURIComponent(INSTANCIA())}`, { method: 'POST', body });
}

// ── Entrada ──────────────────────────────────────────────────────────────────

/** Tipo + texto + "tem arquivo?" de uma mensagem do Baileys. null = ignorar. */
function lerConteudo(m) {
  if (!m || typeof m !== 'object') return null;
  if (m.reactionMessage || m.protocolMessage) return null;
  if (m.conversation) return { tipo: 'texto', texto: m.conversation };
  if (m.extendedTextMessage) return { tipo: 'texto', texto: m.extendedTextMessage.text || '' };
  if (m.imageMessage) return { tipo: 'imagem', texto: m.imageMessage.caption || '', midia: true };
  if (m.videoMessage) return { tipo: 'video', texto: m.videoMessage.caption || '', midia: true };
  if (m.audioMessage) return { tipo: 'audio', texto: '', midia: true };
  if (m.stickerMessage) return { tipo: 'figurinha', texto: '', midia: true };
  const doc = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage;
  if (doc) return { tipo: 'arquivo', texto: doc.caption || '', midia: true, nome: doc.fileName || null };
  const enquete = m.pollCreationMessage || m.pollCreationMessageV3;
  if (enquete) return { tipo: 'enquete', texto: `📊 ${enquete.name || 'Enquete'}` };
  if (m.locationMessage) return { tipo: 'local', texto: '📍 localização' };
  if (m.contactMessage) return { tipo: 'contato', texto: `👤 ${m.contactMessage.displayName || 'contato'}` };
  return null;
}

const ROTULO = { imagem: '📷 imagem', video: '🎬 vídeo', audio: '🎤 áudio', figurinha: '🏷️ figurinha', arquivo: '📎 arquivo' };

async function baixarMidia(msgId) {
  try {
    const r = await evo(`/chat/getBase64FromMediaMessage/${encodeURIComponent(INSTANCIA())}`, {
      method: 'POST', body: { message: { key: { id: msgId } }, convertToMp4: false }, timeoutMs: 20000,
    });
    if (!r?.base64) return null;
    const bytes = Buffer.from(r.base64, 'base64');
    if (!bytes.length || bytes.length > MAX_MIDIA) return null;
    return await guardarMidia(bytes, r.mimetype, { leadId: 'rel-grupos', nomeArquivo: r.fileName });
  } catch (e) {
    console.warn('[rel-grupos] mídia:', e?.message);
    return null;
  }
}

/** Garante a linha do grupo (o webhook pode trazer mensagem de grupo novo). */
async function garantirGrupo(jid, nome) {
  const ja = (await rest(`rel_wa_grupos?select=jid,nome&jid=eq.${encodeURIComponent(jid)}&limit=1`))?.[0];
  if (ja) return;
  let info = null;
  try { info = await evo(`/group/findGroupInfos/${encodeURIComponent(INSTANCIA())}?groupJid=${encodeURIComponent(jid)}`); } catch { /* fica sem nome */ }
  await rest('rel_wa_grupos?on_conflict=jid', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
    body: { jid, nome: info?.subject || nome || null, descricao: info?.desc || null, participantes: info?.size ?? null },
  });
}

/** Quem a mensagem marcou com @ (contextInfo.mentionedJid de qualquer tipo de mensagem). */
function mencoesDe(m) {
  const out = new Set();
  const visitar = (o, prof = 0) => {
    if (!o || typeof o !== 'object' || prof > 4) return;
    if (Array.isArray(o.mentionedJid)) o.mentionedJid.forEach((j) => out.add(String(j)));
    for (const v of Object.values(o)) if (v && typeof v === 'object') visitar(v, prof + 1);
  };
  visitar(m);
  return out;
}

/**
 * Os ids do PRÓPRIO número nos grupos: o telefone e os códigos @lid. O @lid não
 * vem em lugar nenhum de graça — a gente aprende quando o número manda mensagem
 * num grupo (key.participant da mensagem fromMe) e guarda em rel_config.
 */
let cacheMeus = null;
async function meusIds(key) {
  if (!cacheMeus) {
    const r = (await rest("rel_config?select=valor&chave=eq.rel_grupos_meus_ids&limit=1").catch(() => null))?.[0]?.valor;
    cacheMeus = new Set(Array.isArray(r) ? r : []);
    cacheMeus.add(`${String(process.env.REL_GRUPOS_NUMERO || '5511980124183')}@s.whatsapp.net`);
  }
  const novo = key?.fromMe ? [key.participant, key.participantAlt].filter((x) => x && !cacheMeus.has(x)) : [];
  if (novo.length) {
    novo.forEach((x) => cacheMeus.add(x));
    await rest('rel_config?on_conflict=chave', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { chave: 'rel_grupos_meus_ids', valor: [...cacheMeus] } }).catch(() => null);
  }
  return cacheMeus;
}

/** contextInfo de qualquer tipo de mensagem (citação e @). */
function contextoDe(m) {
  if (!m || typeof m !== 'object') return null;
  for (const v of Object.values(m)) if (v && typeof v === 'object' && v.contextInfo) return v.contextInfo;
  return null;
}
const textoDe = (m) => m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || m?.videoMessage?.caption
  || (m?.imageMessage ? '📷 foto' : m?.videoMessage ? '🎬 vídeo' : m?.audioMessage ? '🎤 áudio' : m?.stickerMessage ? '🏷️ figurinha' : m?.documentMessage ? '📎 arquivo' : '');

/** Reação nova/trocada/retirada na mensagem alvo (reações ficam numa lista por pessoa). */
async function aplicarReacao(alvoId, de, nome, emoji) {
  const m = (await rest(`rel_wa_grupo_mensagens?select=id,reacoes&msg_id=eq.${encodeURIComponent(alvoId)}&limit=1`))?.[0];
  if (!m) return;
  const lista = (Array.isArray(m.reacoes) ? m.reacoes : []).filter((r) => r.de !== de);
  if (emoji) lista.push({ de, nome: nome || null, emoji });
  await rest(`rel_wa_grupo_mensagens?id=eq.${m.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { reacoes: lista } });
}

async function gravarMensagem(d) {
  const key = d?.key || {};
  const jid = key.remoteJid;
  if (!ehGrupo(jid)) return 'ignorada'; // ← pessoa, status, canal: nunca entra
  const msg = d.message || {};
  // reação de alguém (ou do celular do número)
  if (msg.reactionMessage) {
    const r = msg.reactionMessage;
    const de = key.fromMe ? 'eu' : (key.participantAlt || key.participant || 'alguém');
    await aplicarReacao(r.key?.id, de, key.fromMe ? 'Você' : d.pushName, r.text || '');
    return 'reacao';
  }
  // apagou para todos / editou
  const proto = msg.protocolMessage || msg.editedMessage?.message?.protocolMessage;
  if (proto?.key?.id) {
    if (proto.type === 0 || proto.type === 'REVOKE') {
      await rest(`rel_wa_grupo_mensagens?msg_id=eq.${encodeURIComponent(proto.key.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { apagada_em: new Date().toISOString() } });
      return 'apagada';
    }
    const novo = textoDe(proto.editedMessage);
    if (novo) {
      await rest(`rel_wa_grupo_mensagens?msg_id=eq.${encodeURIComponent(proto.key.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { texto: novo, editada_em: new Date().toISOString() } });
      return 'editada';
    }
    return 'ignorada';
  }
  const c = lerConteudo(msg);
  if (!c || !key.id) return 'ignorada';
  const ctx = contextoDe(msg);

  await garantirGrupo(jid);
  const ja = (await rest(`rel_wa_grupo_mensagens?select=id&msg_id=eq.${encodeURIComponent(key.id)}&limit=1`))?.[0];
  if (ja) return 'repetida';

  const anexo = c.midia ? await baixarMidia(key.id) : null;
  const texto = c.texto || (c.midia && !anexo ? ROTULO[c.tipo] : '') || '';
  const ts = Number(d.messageTimestamp);
  const quando = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString();

  await rest('rel_wa_grupo_mensagens?on_conflict=msg_id', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
    body: {
      grupo_jid: jid, msg_id: key.id, de_mim: Boolean(key.fromMe),
      autor_jid: key.participantAlt || key.participant || null,
      autor_participante: key.participant || null,
      autor_nome: key.fromMe ? null : (d.pushName || null),
      tipo: c.tipo, texto, anexo_url: anexo, anexo_nome: c.nome || null, criado_em: quando,
      responde_a: ctx?.stanzaId || null,
      citado_texto: ctx?.quotedMessage ? textoDe(ctx.quotedMessage).slice(0, 300) : null,
      citado_autor: ctx?.participant || null,
      mencoes: Array.isArray(ctx?.mentionedJid) ? ctx.mentionedJid.map(String) : [],
    },
  });
  const previa = (texto || ROTULO[c.tipo] || '').slice(0, 140);
  // não lidas + "@" (0142): mensagem nossa zera; dos outros soma e vê se marcou o número
  const meus = await meusIds(key);
  const marcados = [...mencoesDe(d.message)];
  const digitos = [...meus].map((x) => x.split('@')[0]);
  const mencionou = !key.fromMe && (marcados.some((m) => meus.has(m) || digitos.includes(m.split('@')[0]))
    || digitos.some((n) => n && texto.includes(`@${n}`)));
  await rest('rpc/rel_wa_grupo_nova_msg', {
    method: 'POST',
    body: { p_jid: jid, p_quando: quando, p_previa: previa, p_de_mim: Boolean(key.fromMe), p_mencionou: mencionou },
  });
  return 'gravada';
}

async function atualizarGrupos(lista) {
  const linhas = (Array.isArray(lista) ? lista : [lista])
    .filter((g) => ehGrupo(g?.id))
    .map((g) => ({
      jid: g.id,
      ...(g.subject !== undefined ? { nome: g.subject } : {}),
      ...(g.desc !== undefined ? { descricao: g.desc } : {}),
      ...(g.size !== undefined ? { participantes: g.size } : {}),
      atualizado_em: new Date().toISOString(),
    }));
  for (const l of linhas) {
    await rest('rel_wa_grupos?on_conflict=jid', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: l });
  }
}

async function webhook(req, res) {
  if (!segredoConfere(req.query?.secret, process.env.REL_GRUPOS_SECRET)) {
    return res.status(401).json({ error: 'segredo' });
  }
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  // Só a instância dos grupos. Qualquer outra que aponte pra cá é ignorada.
  if (body.instance && body.instance !== INSTANCIA()) return res.status(200).json({ ok: true, ignorado: 'instancia' });
  const evento = String(body.event || '').toLowerCase().replace(/_/g, '.');
  try {
    if (evento === 'messages.upsert') {
      const itens = Array.isArray(body.data) ? body.data : [body.data];
      const r = [];
      for (const d of itens) r.push(await gravarMensagem(d));
      return res.status(200).json({ ok: true, r });
    }
    // Queda/volta da ligação: fica registrada pra medir se ela aguenta (0138).
    if (evento === 'connection.update') {
      const estado = String(body.data?.state || '');
      if (estado && estado !== 'connecting') {
        await rest('rel_wa_grupos_conexao', {
          method: 'POST', prefer: 'return=minimal',
          body: { estado, motivo: body.data?.statusReason != null ? String(body.data.statusReason) : null },
        });
      }
      return res.status(200).json({ ok: true });
    }
    if (evento === 'groups.upsert' || evento === 'groups.update') {
      await atualizarGrupos(body.data);
      return res.status(200).json({ ok: true });
    }
    // alguém apagou mensagem pra todos (0144) — também chega como protocolMessage no upsert
    if (evento === "messages.delete") {
      const d = Array.isArray(body.data) ? body.data[0] : body.data;
      const id = d?.key?.id || d?.id || d?.keyId;
      if (id) await rest(`rel_wa_grupo_mensagens?msg_id=eq.${encodeURIComponent(id)}`, { method: "PATCH", prefer: "return=minimal", body: { apagada_em: new Date().toISOString() } }).catch(() => null);
      return res.status(200).json({ ok: true });
    }
    // entrou/saiu gente do grupo (0143)
    if (evento === 'group.participants.update' || evento === 'group-participants.update') {
      const d = body.data || {};
      const jid = String(d.id || d.groupJid || '');
      if (ehGrupo(jid)) {
        const lista = Array.isArray(d.participants) ? d.participants : [];
        if (d.action === 'remove') {
          for (const p of lista) await rest(`rel_wa_grupo_participantes?grupo_jid=eq.${encodeURIComponent(jid)}&participante=eq.${encodeURIComponent(String(p?.id || p))}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => null);
        } else if (d.action === 'add' || d.action === 'promote' || d.action === 'demote') {
          await garantirGrupo(jid);
          await gravarParticipantes(jid, lista.map((p) => (typeof p === 'object' ? { ...p, admin: d.action === 'promote' ? 'admin' : d.action === 'demote' ? null : p.admin } : p)), new Date().toISOString());
        }
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(200).json({ ok: true, ignorado: evento });
  } catch (e) {
    console.error('[rel-grupos] webhook:', e?.message);
    return res.status(500).json({ error: 'falhou' });
  }
}

// ── Sincronizar: lista de grupos + participantes (0143) ─────────────────────

/** "5511…@s.whatsapp.net" → "5511…"; @lid → null. */
const telDe = (j) => (String(j || '').endsWith('@s.whatsapp.net') ? String(j).split('@')[0].split(':')[0] : null);

async function gravarParticipantes(grupoJid, participantes, marca) {
  const linhas = (participantes || []).map((p) => {
    const id = String(p?.id || p || '');
    return { grupo_jid: grupoJid, participante: id, telefone: telDe(p?.phoneNumber) || telDe(p?.jid) || telDe(id), admin: p?.admin || null, atualizado_em: marca };
  }).filter((l) => l.participante);
  for (let i = 0; i < linhas.length; i += 500) {
    await rest('rel_wa_grupo_participantes?on_conflict=grupo_jid,participante', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: linhas.slice(i, i + 500) });
  }
  return linhas.length;
}

/** Puxa todos os grupos (com participantes) da Evolution e acerta o banco. */
export async function sincronizarGrupos() {
  const lista = await evo(`/group/fetchAllGroups/${encodeURIComponent(INSTANCIA())}?getParticipants=true`, { timeoutMs: 45000 });
  const grupos = (Array.isArray(lista) ? lista : []).filter((g) => ehGrupo(g?.id));
  await atualizarGrupos(grupos);
  // Grupo que sumiu da lista = o número saiu. Volta se reaparecer.
  const ids = new Set(grupos.map((g) => g.id));
  const nossos = (await rest('rel_wa_grupos?select=jid,saiu_em').catch(() => [])) || [];
  const agora = new Date().toISOString();
  for (const g of nossos) {
    const esta = ids.has(g.jid);
    if (!esta && !g.saiu_em) await rest(`rel_wa_grupos?jid=eq.${encodeURIComponent(g.jid)}`, { method: 'PATCH', prefer: 'return=minimal', body: { saiu_em: agora } });
    if (esta && g.saiu_em) await rest(`rel_wa_grupos?jid=eq.${encodeURIComponent(g.jid)}`, { method: 'PATCH', prefer: 'return=minimal', body: { saiu_em: null } });
  }
  // participantes: grava os de agora e apaga quem não está mais (marca de tempo desta rodada)
  let participantes = 0;
  for (const g of grupos) {
    if (!Array.isArray(g.participants)) continue;
    participantes += await gravarParticipantes(g.id, g.participants, agora);
    await rest(`rel_wa_grupo_participantes?grupo_jid=eq.${encodeURIComponent(g.id)}&atualizado_em=lt.${encodeURIComponent(agora)}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => null);
  }
  return { grupos: grupos.length, participantes };
}

/** Foto no grupo — também só aceita grupo já conhecido. */
async function enviarImagemNoGrupo(jid, base64, mime, caption, fileName, mediatype = 'image') {
  await grupoLiberado(jid);
  return evo(`/message/sendMedia/${encodeURIComponent(INSTANCIA())}`, {
    // `base64` pode ser a URL do arquivo no nosso storage (a Evolution aceita os dois)
    method: 'POST', timeoutMs: /^https:/.test(base64) ? 55000 : 30000,
    body: { number: jid, mediatype, mimetype: mime, ...(caption ? { caption } : {}), media: base64, fileName },
  });
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'POST' && req.query?.secret !== undefined) return webhook(req, res);

  if (req.method === 'GET' && req.query?.cron) {
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || veio !== segredo) return res.status(401).json({ error: 'Não autorizado' });
    try { const r = await sincronizarGrupos(); console.log(`[rel-grupos] cron: ${JSON.stringify(r)}`); return res.status(200).json(r); }
    catch (e) { console.error('[rel-grupos] cron:', e?.message); return res.status(502).json({ error: 'Evolution não respondeu' }); }
  }

  const u = await quemChama(req); // Relacionamento ou admin — o Financeiro não usa grupos
  if (!u) return res.status(401).json({ error: 'Sem acesso ao Relacionamento.' });

  if (req.method === 'GET') {
    if (req.query?.estado) {
      try {
        const r = await evo(`/instance/connectionState/${encodeURIComponent(INSTANCIA())}`);
        const estado = String(r?.instance?.state || r?.state || 'desconhecido');
        return res.status(200).json({ conectado: estado === 'open', estado });
      } catch (e) {
        return res.status(200).json({ conectado: false, estado: 'erro', erro: String(e?.message || '').slice(0, 160) });
      }
    }
    return res.status(400).json({ error: 'Pedido inválido.' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET ou POST' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(body.acao || '');

  if (acao === 'sincronizar') {
    try {
      const r = await sincronizarGrupos();
      return res.status(200).json({ ok: true, ...r });
    } catch {
      return res.status(502).json({ error: 'A Evolution não respondeu. A ligação dos grupos está de pé?' });
    }
  }

  if (acao === 'imagem' || acao === 'midia') {
    const jid = String(body.jid || '');
    if (!ehGrupo(jid)) return res.status(400).json({ error: 'Só dá pra mandar em grupo.' });
    const mime = String(body.mimeType || '').toLowerCase().split(';')[0];
    const mediatype = /^image\/(jpeg|png|webp)$/.test(mime) ? 'image' : mime === 'video/mp4' ? 'video' : /^audio\//.test(mime) ? 'audio' : 'document';
    if (acao === 'imagem' && mediatype !== 'image') return res.status(400).json({ error: 'Só foto (JPG, PNG ou WEBP).' });
    // Arquivo grande (19/10): o navegador já subiu em wa-midia/rel-envio/ e manda a URL —
    // a Evolution baixa de lá (o corpo da Vercel não passa de ~4,5 MB).
    const urlSubida = body.url ? String(body.url) : null;
    if (urlSubida && !/^https:\/\/[^/]+\/storage\/v1\/object\/public\/wa-midia\/rel-envio\//.test(urlSubida)) return res.status(400).json({ error: 'Arquivo de fora do QS.' });
    const bytes = urlSubida ? null : Buffer.from(String(body.dataBase64 || ''), 'base64');
    if (bytes && (!bytes.length || bytes.length > 3 * 1024 * 1024)) return res.status(400).json({ error: 'Arquivo vazio ou maior que 3 MB.' });
    const legenda = String(body.legenda || '').trim().slice(0, 1000);
    const nome = String(u.name || '').trim().replace(/\s+/g, ' ') || 'Relacionamento';
    const caption = legenda ? `*${nome}:*\n${legenda}` : `*${nome}*`;
    let r;
    try { r = await enviarImagemNoGrupo(jid, urlSubida || bytes.toString('base64'), mime, mediatype === 'audio' ? '' : caption, String(body.fileName || 'arquivo'), mediatype); }
    catch (e) { return res.status(502).json({ error: String(e?.message || 'Não enviou.').slice(0, 200) }); }
    const url = urlSubida || await guardarMidia(bytes, mime, { leadId: 'rel-grupos', nomeArquivo: String(body.fileName || 'foto.jpg') }).catch(() => null);
    const msgId = r?.key?.id;
    if (msgId) {
      await rest('rel_wa_grupo_mensagens?on_conflict=msg_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { grupo_jid: jid, msg_id: msgId, de_mim: true, tipo: { image: 'imagem', video: 'video', audio: 'audio', document: 'arquivo' }[mediatype], texto: mediatype === 'audio' ? '' : caption, anexo_url: url, anexo_nome: mediatype === 'document' ? String(body.fileName || '') : null, enviado_por: u.id, criado_em: new Date().toISOString() },
      }).catch(() => null);
      await rest('rpc/rel_wa_grupo_nova_msg', { method: 'POST', body: { p_jid: jid, p_quando: new Date().toISOString(), p_previa: { image: '📷 foto', video: '🎬 vídeo', audio: '🎤 áudio', document: '📎 arquivo' }[mediatype], p_de_mim: true, p_mencionou: false } }).catch(() => null);
    }
    return res.status(200).json({ ok: true });
  }

  // as ações abaixo mexem numa mensagem já gravada do grupo
  const daMensagem = async () => {
    const id = String(body.msgId || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return (await rest(`rel_wa_grupo_mensagens?select=*&id=eq.${id}&limit=1`))?.[0] || null;
  };

  if (acao === 'reacao') {
    const m = await daMensagem();
    if (!m) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    const emoji = String(body.emoji ?? '').slice(0, 16);
    try {
      await grupoLiberado(m.grupo_jid);
      await evo(`/message/sendReaction/${encodeURIComponent(INSTANCIA())}`, { method: 'POST', body: { key: chaveDe(m), reaction: emoji } });
    } catch (e) { return res.status(502).json({ error: String(e?.message || 'Não reagiu.').slice(0, 200) }); }
    await aplicarReacao(m.msg_id, 'eu', String(u.name || '').split(' ')[0] || 'Você', emoji);
    return res.status(200).json({ ok: true });
  }

  if (acao === 'apagar') {
    const m = await daMensagem();
    if (!m) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    if (!m.de_mim) return res.status(403).json({ error: 'Só dá pra apagar mensagem do próprio número.' });
    try {
      await grupoLiberado(m.grupo_jid);
      await evo(`/chat/deleteMessageForEveryone/${encodeURIComponent(INSTANCIA())}`, { method: 'DELETE', body: { id: m.msg_id, remoteJid: m.grupo_jid, fromMe: true } });
    } catch (e) { return res.status(502).json({ error: String(e?.message || 'Não apagou.').slice(0, 200) }); }
    await rest(`rel_wa_grupo_mensagens?id=eq.${m.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { apagada_em: new Date().toISOString() } });
    return res.status(200).json({ ok: true });
  }

  if (acao === 'editar') {
    const m = await daMensagem();
    if (!m) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    if (!m.de_mim || m.tipo !== 'texto') return res.status(403).json({ error: 'Só dá pra editar texto enviado pelo número.' });
    if (Date.now() - new Date(m.criado_em).getTime() > 15 * 60_000) return res.status(400).json({ error: 'O WhatsApp só deixa editar até 15 minutos depois de enviar.' });
    const novo = String(body.texto || '').trim();
    if (!novo) return res.status(400).json({ error: 'Mensagem vazia.' });
    const nome = String(u.name || '').trim().replace(/\s+/g, ' ') || 'Relacionamento';
    const final = `*${nome}:*\n${novo}`;
    try {
      await grupoLiberado(m.grupo_jid);
      await evo(`/chat/updateMessage/${encodeURIComponent(INSTANCIA())}`, { method: 'POST', body: { number: m.grupo_jid, key: { remoteJid: m.grupo_jid, fromMe: true, id: m.msg_id }, text: final } });
    } catch (e) { return res.status(502).json({ error: String(e?.message || 'Não editou.').slice(0, 200) }); }
    await rest(`rel_wa_grupo_mensagens?id=eq.${m.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { texto: final, editada_em: new Date().toISOString() } });
    return res.status(200).json({ ok: true });
  }

  if (acao === 'figurinha') {
    const jid = String(body.jid || '');
    const fid = String(body.figurinhaId || '');
    const f = /^[0-9a-f-]{36}$/i.test(fid) ? (await rest(`rel_wa_figurinhas?select=url&id=eq.${fid}&limit=1`))?.[0] : null;
    if (!f) return res.status(404).json({ error: 'Figurinha não encontrada.' });
    let r;
    try { await grupoLiberado(jid); r = await evo(`/message/sendSticker/${encodeURIComponent(INSTANCIA())}`, { method: 'POST', timeoutMs: 30000, body: { number: jid, sticker: f.url } }); }
    catch (e) { return res.status(502).json({ error: String(e?.message || 'Não enviou.').slice(0, 200) }); }
    if (r?.key?.id) {
      await rest('rel_wa_grupo_mensagens?on_conflict=msg_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { grupo_jid: jid, msg_id: r.key.id, de_mim: true, tipo: 'figurinha', texto: '', anexo_url: f.url, enviado_por: u.id, criado_em: new Date().toISOString() } }).catch(() => null);
      await rest('rpc/rel_wa_grupo_nova_msg', { method: 'POST', body: { p_jid: jid, p_quando: new Date().toISOString(), p_previa: '🏷️ figurinha', p_de_mim: true, p_mencionou: false } }).catch(() => null);
    }
    return res.status(200).json({ ok: true });
  }

  if (acao === 'voz') {
    const jid = String(body.jid || '');
    const bytes = Buffer.from(String(body.dataBase64 || ''), 'base64');
    if (!bytes.length || bytes.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Áudio vazio ou grande demais.' });
    let r;
    try { await grupoLiberado(jid); r = await evo(`/message/sendWhatsAppAudio/${encodeURIComponent(INSTANCIA())}`, { method: 'POST', timeoutMs: 40000, body: { number: jid, audio: bytes.toString('base64'), encoding: true } }); }
    catch (e) { return res.status(502).json({ error: String(e?.message || 'Não enviou.').slice(0, 200) }); }
    const url = await guardarMidia(bytes, String(body.mimeType || 'audio/webm').split(';')[0], { leadId: 'rel-grupos', nomeArquivo: 'voz.webm' }).catch(() => null);
    if (r?.key?.id) {
      await rest('rel_wa_grupo_mensagens?on_conflict=msg_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { grupo_jid: jid, msg_id: r.key.id, de_mim: true, tipo: 'audio', texto: '', anexo_url: url, enviado_por: u.id, criado_em: new Date().toISOString() } }).catch(() => null);
      await rest('rpc/rel_wa_grupo_nova_msg', { method: 'POST', body: { p_jid: jid, p_quando: new Date().toISOString(), p_previa: '🎤 áudio', p_de_mim: true, p_mencionou: false } }).catch(() => null);
    }
    return res.status(200).json({ ok: true });
  }

  if (acao === 'texto') {
    const jid = String(body.jid || '');
    const texto = String(body.texto || '').trim();
    if (!ehGrupo(jid)) return res.status(400).json({ error: 'Só dá pra mandar em grupo.' });
    if (!texto) return res.status(400).json({ error: 'Mensagem vazia.' });
    if (texto.length > MAX_TEXTO) return res.status(400).json({ error: 'Mensagem longa demais.' });
    const nome = String(u.name || '').trim().replace(/\s+/g, ' ') || 'Relacionamento';
    const final = `*${nome}:*\n${texto}`;
    const citada = body.respondendoA ? (await rest(`rel_wa_grupo_mensagens?select=*&id=eq.${String(body.respondendoA).replace(/[^0-9a-f-]/gi, '')}&grupo_jid=eq.${encodeURIComponent(jid)}&limit=1`).catch(() => []))?.[0] || null : null;
    // @: só dígitos de telefone; o texto já leva "@5511…" (é assim que o WhatsApp mostra o nome)
    const mencoes = (Array.isArray(body.mencoes) ? body.mencoes : []).map((x) => String(x).replace(/\D/g, '')).filter((x) => x.length >= 10).map((x) => `${x}@s.whatsapp.net`);
    let r;
    try {
      r = await enviarNoGrupo(jid, final, { citada, mencoes });
    } catch (e) {
      return res.status(502).json({ error: String(e?.message || 'Não enviou.').slice(0, 200) });
    }
    const msgId = r?.key?.id;
    if (msgId) {
      await rest('rel_wa_grupo_mensagens?on_conflict=msg_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { grupo_jid: jid, msg_id: msgId, de_mim: true, tipo: 'texto', texto: final, enviado_por: u.id, criado_em: new Date().toISOString(),
          responde_a: citada?.msg_id || null, citado_texto: citada ? String(citada.texto || '').slice(0, 300) : null, citado_autor: citada ? (citada.de_mim ? 'eu' : citada.autor_jid) : null, mencoes },
      }).catch(() => null);
      // respondeu pelo QS = leu (zera não lidas e o @)
      await rest('rpc/rel_wa_grupo_nova_msg', {
        method: 'POST',
        body: { p_jid: jid, p_quando: new Date().toISOString(), p_previa: final.slice(0, 140), p_de_mim: true, p_mencionou: false },
      }).catch(() => null);
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Ação desconhecida.' });
}
