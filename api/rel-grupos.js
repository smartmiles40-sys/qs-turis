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
async function enviarNoGrupo(jid, texto) {
  if (!ehGrupo(jid)) throw new Error('Destino não é grupo — envio bloqueado.');
  const g = (await rest(`rel_wa_grupos?select=jid,saiu_em&jid=eq.${encodeURIComponent(jid)}&limit=1`))?.[0];
  if (!g) throw new Error('Grupo desconhecido — envio bloqueado.');
  if (g.saiu_em) throw new Error('O número não está mais nesse grupo.');
  return evo(`/message/sendText/${encodeURIComponent(INSTANCIA())}`, {
    method: 'POST', body: { number: jid, text: texto },
  });
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

async function gravarMensagem(d) {
  const key = d?.key || {};
  const jid = key.remoteJid;
  if (!ehGrupo(jid)) return 'ignorada'; // ← pessoa, status, canal: nunca entra
  const c = lerConteudo(d.message);
  if (!c || !key.id) return 'ignorada';

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
      autor_nome: key.fromMe ? null : (d.pushName || null),
      tipo: c.tipo, texto, anexo_url: anexo, anexo_nome: c.nome || null, criado_em: quando,
    },
  });
  const previa = (texto || ROTULO[c.tipo] || '').slice(0, 140);
  await rest(`rel_wa_grupos?jid=eq.${encodeURIComponent(jid)}&or=(ultima_msg_em.is.null,ultima_msg_em.lte.${encodeURIComponent(quando)})`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: { ultima_msg_em: quando, ultima_msg: previa, atualizado_em: new Date().toISOString() },
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
    return res.status(200).json({ ok: true, ignorado: evento });
  } catch (e) {
    console.error('[rel-grupos] webhook:', e?.message);
    return res.status(500).json({ error: 'falhou' });
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'POST' && req.query?.secret !== undefined) return webhook(req, res);

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
    let lista;
    try {
      lista = await evo(`/group/fetchAllGroups/${encodeURIComponent(INSTANCIA())}?getParticipants=false`, { timeoutMs: 40000 });
    } catch {
      return res.status(502).json({ error: 'A Evolution não respondeu. A ligação dos grupos está de pé?' });
    }
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
    return res.status(200).json({ ok: true, grupos: grupos.length });
  }

  if (acao === 'texto') {
    const jid = String(body.jid || '');
    const texto = String(body.texto || '').trim();
    if (!ehGrupo(jid)) return res.status(400).json({ error: 'Só dá pra mandar em grupo.' });
    if (!texto) return res.status(400).json({ error: 'Mensagem vazia.' });
    if (texto.length > MAX_TEXTO) return res.status(400).json({ error: 'Mensagem longa demais.' });
    const nome = String(u.name || '').trim().replace(/\s+/g, ' ') || 'Relacionamento';
    const final = `*${nome}:*\n${texto}`;
    let r;
    try {
      r = await enviarNoGrupo(jid, final);
    } catch (e) {
      return res.status(502).json({ error: String(e?.message || 'Não enviou.').slice(0, 200) });
    }
    const msgId = r?.key?.id;
    if (msgId) {
      await rest('rel_wa_grupo_mensagens?on_conflict=msg_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { grupo_jid: jid, msg_id: msgId, de_mim: true, tipo: 'texto', texto: final, enviado_por: u.id, criado_em: new Date().toISOString() },
      }).catch(() => null);
      await rest(`rel_wa_grupos?jid=eq.${encodeURIComponent(jid)}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { ultima_msg_em: new Date().toISOString(), ultima_msg: final.slice(0, 140) },
      }).catch(() => null);
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Ação desconhecida.' });
}
