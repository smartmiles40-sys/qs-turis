// api/_relGruposPrivado.js
// -----------------------------------------------------------------------------
// REDE DE SEGURANÇA DO 1:1 DO RELACIONAMENTO (30/10/2026, V2).
//
// O número do Rel (4183) está em DOIS lugares ao mesmo tempo: na Cloud API (COEX,
// é por onde o time conversa e RESPONDE) e na Evolution (QR, só pra ler grupos).
// A Evolution também recebe as conversas com PESSOAS — até hoje a gente jogava
// fora. Em 29/10 a Meta entregou 4 mensagens de clientes (uma delas era o Rafael
// respondendo no privado o grupo "Expedição Tailândia - G1 2026") e o banco não
// respondeu em 10 s: a gravação falhou calada, a Meta recebeu 200 e não reenviou.
// A mensagem existia só na Evolution.
//
// Aqui a Evolution vira a CÓPIA DE RESERVA do 1:1:
//   • só GRAVA (rel_wa_ingest) — nada sai por aqui. A regra do Bruno continua:
//     por essa instância nunca sai mensagem pra pessoa. A resposta do atendente
//     segue pela Cloud API (api/rel-wa.js), que recusa responder a quem não tem
//     número (lid:…).
//   • wamid "evo:<id>". O id do WhatsApp (key.id) está DENTRO do wamid da Meta
//     (base64): "wamid.HBgM…EhgU<id>AA" → é por ele que as duas cópias se acham.
//     Conferido em 28–30/10: 375/375 entradas e 286/288 saídas batem.
//   • quando a cópia da Meta chega depois, ela "assume" a linha da Evolution
//     (troca o wamid pelo oficial — recibos, reação e citação voltam a valer).
//   • telefone: key.remoteJidAlt (vem em ~100% desde 28/10) > participante de
//     grupo (rel_wa_grupo_participantes, @lid → telefone) > "lid:<código>" numa
//     conversa SEM NÚMERO (só com a 0231 aplicada — a trava de telefone do banco
//     não aceita outra coisa).
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { guardarMidia, rotuloDaMidia } from './_waMidia.js';
import { INSTANCIA, evo, ehGrupo } from './_relGruposEvo.js';

const MAX_MIDIA = 16 * 1024 * 1024;

// ── O id do WhatsApp dentro do wamid ────────────────────────────────────────

/**
 * "wamid.HBgM…" → o id da mensagem no WhatsApp (o mesmo key.id da Evolution).
 * "evo:<id>" → <id>. Qualquer outra coisa → null.
 * O wamid é um protobuf em base64 que termina em 0x18 <tamanho> <id> 0x00.
 */
export function chaveDoWamid(wamid) {
  const w = String(wamid || '');
  if (w.startsWith('evo:')) return w.slice(4) || null;
  if (!w.startsWith('wamid.')) return null;
  let b;
  try { b = Buffer.from(w.slice(6), 'base64'); } catch { return null; }
  if (b.length < 12 || b[b.length - 1] !== 0) return null;
  for (let L = 8; L <= 64; L++) {
    const i = b.length - 1 - L;
    if (i < 2) break;
    if (b[i - 1] === L && b[i - 2] === 0x18) {
      const s = b.subarray(i, b.length - 1).toString('latin1');
      if (/^[0-9A-Za-z]+$/.test(s)) return s;
    }
  }
  return null;
}

// ── Lendo a mensagem do Baileys (formato da Evolution) ──────────────────────

const so = (s) => String(s || '').replace(/\D/g, '');
const ehPessoa = (jid) => /@(s\.whatsapp\.net|lid)$/.test(String(jid || ''));

/** Variantes BR com/sem o 9 (o WhatsApp manda 55 85 9xxxx-xxxx como 558599…). */
export function variantesBr(d) {
  if (/^55\d{2}9\d{8}$/.test(d)) return [d, d.slice(0, 4) + d.slice(5)];
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return [d, `${d.slice(0, 4)}9${d.slice(4)}`];
  return [d];
}

/** contextInfo: a Evolution põe no topo (d.contextInfo) e o Baileys dentro da mensagem. */
function contextoDe(d) {
  if (d?.contextInfo && (d.contextInfo.stanzaId || d.contextInfo.remoteJid)) return d.contextInfo;
  const m = d?.message || {};
  for (const v of Object.values(m)) if (v && typeof v === 'object' && v.contextInfo?.stanzaId) return v.contextInfo;
  return d?.contextInfo || null;
}

/** Partes da mensagem do Baileys que não são conteúdo (não viram bolha). */
const SEM_BOLHA = new Set([
  'messageContextInfo', 'senderKeyDistributionMessage', 'reactionMessage', 'encReactionMessage',
  'pollUpdateMessage', 'protocolMessage', 'keepInChatMessage', 'pinInChatMessage', 'deviceSentMessage',
  'albumMessage', 'associatedChildMessage', 'messageHistoryBundle', 'callLogMesssage', 'call',
  'base64', 'mediaUrl',
  'templateMessage', // anúncio de outra empresa pro número do Rel (o modelo que o Rel manda vem pela Meta)
]);

const textoCitado = (q) => q?.conversation || q?.extendedTextMessage?.text || q?.imageMessage?.caption || q?.videoMessage?.caption
  || (q?.imageMessage ? '📷 foto' : q?.videoMessage ? '🎬 vídeo' : q?.audioMessage ? '🎤 áudio' : q?.documentMessage ? '📎 arquivo' : '');

/**
 * Uma mensagem 1:1 da Evolution → o que o QS grava. null = não é conversa com
 * pessoa ou não vira bolha (reação, sistema, cifrada, anúncio de outra empresa).
 */
export function lerPrivado(d) {
  const key = d?.key || {};
  const jid = String(key.remoteJid || '');
  if (!key.id || ehGrupo(jid) || !ehPessoa(jid)) return null;
  let m = d.message || {};
  // mensagem temporária / visualização única vêm embrulhadas
  for (let i = 0; i < 3; i++) {
    const dentro = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessageV2Extension?.message;
    if (!dentro) break;
    m = dentro;
  }
  let tipo = null; let texto = ''; let midia = null; let nome = null;
  if (m.conversation != null) { tipo = 'texto'; texto = m.conversation; }
  else if (m.extendedTextMessage) { tipo = 'texto'; texto = m.extendedTextMessage.text || ''; }
  else if (m.imageMessage) { tipo = 'image'; texto = m.imageMessage.caption || ''; midia = 'image'; }
  else if (m.videoMessage) { tipo = 'video'; texto = m.videoMessage.caption || ''; midia = 'video'; }
  else if (m.audioMessage) { tipo = 'audio'; midia = 'audio'; }
  else if (m.stickerMessage) { tipo = 'image'; midia = 'image'; }
  else if (m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage) {
    const doc = m.documentMessage || m.documentWithCaptionMessage.message.documentMessage;
    tipo = 'file'; texto = doc.caption || ''; midia = 'file'; nome = doc.fileName || null;
  } else if (m.locationMessage) {
    tipo = 'texto'; texto = `📍 Localização: https://maps.google.com/?q=${m.locationMessage.degreesLatitude},${m.locationMessage.degreesLongitude}`;
  } else if (m.contactMessage) { tipo = 'texto'; texto = `👤 Contato: ${m.contactMessage.displayName || ''}`.trim(); }
  else if (m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3) { tipo = 'texto'; texto = `📊 ${(m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3).name || 'Enquete'}`; }
  // 05/11 — "absolutamente tudo sobe pro QS": os tipos que antes sumiam.
  else if (m.ptvMessage) { tipo = 'video'; texto = m.ptvMessage.caption || ''; midia = 'video'; } // vídeo redondinho
  else if (m.liveLocationMessage) {
    tipo = 'texto'; texto = `📍 Localização em tempo real: https://maps.google.com/?q=${m.liveLocationMessage.degreesLatitude},${m.liveLocationMessage.degreesLongitude}`;
  } else if (m.contactsArrayMessage) {
    tipo = 'texto'; texto = (m.contactsArrayMessage.contacts || []).map((c) => `👤 Contato: ${c?.displayName || ''}`.trim()).join('\n') || '👤 Contatos';
  } else if (m.buttonsResponseMessage || m.listResponseMessage || m.templateButtonReplyMessage || m.interactiveResponseMessage) {
    const r = m.buttonsResponseMessage?.selectedDisplayText || m.listResponseMessage?.title || m.templateButtonReplyMessage?.selectedDisplayText
      || m.interactiveResponseMessage?.body?.text;
    tipo = 'texto'; texto = r ? `↩️ ${r}` : '↩️ Respondeu a uma mensagem interativa';
  } else if (m.eventMessage) { tipo = 'texto'; texto = `📅 Evento: ${m.eventMessage.name || ''}`.trim(); }
  else if (m.orderMessage || m.productMessage) { tipo = 'texto'; texto = '🛒 Pedido/produto do catálogo'; }
  else if (m.groupInviteMessage) { tipo = 'texto'; texto = `👥 Convite para o grupo ${m.groupInviteMessage.groupName || ''}`.trim(); }
  else if (m.editedMessage || m.protocolMessage?.type === 14 || m.protocolMessage?.type === 'MESSAGE_EDIT') {
    const p = m.editedMessage?.message?.protocolMessage || m.protocolMessage || {};
    const e = p.editedMessage || {};
    const novo = e.conversation || e.extendedTextMessage?.text || e.imageMessage?.caption || e.videoMessage?.caption || '';
    tipo = 'texto'; texto = novo ? `✏️ Editou a mensagem: ${novo}` : '✏️ Editou uma mensagem (abra no celular para ver)';
  } else if (m.protocolMessage?.type === 0 || m.protocolMessage?.type === 'REVOKE') {
    tipo = 'texto'; texto = '🗑️ Apagou uma mensagem';
  } else {
    // (cifrada/sem corpo NÃO vira aviso: chega de novo decifrada com o mesmo id,
    // e o aviso ocuparia o lugar dela; a cópia da Meta cobre esse caso)
    const chaves = Object.keys(m).filter((k) => !SEM_BOLHA.has(k));
    if (chaves.length) { tipo = 'texto'; texto = `⚠️ Mensagem do tipo "${chaves[0].replace(/Message$/, '')}" que o sistema ainda não mostra — abra no celular para ver.`; }
  }
  if (!tipo) return null; // reação, voto de enquete, chaves de criptografia, protocolo…

  const ctx = contextoDe(d);
  const grupoCitado = ctx && ehGrupo(ctx.remoteJid)
    ? { jid: String(ctx.remoteJid), msg_id: ctx.stanzaId || null, autor: ctx.participant || null, texto: textoCitado(ctx.quotedMessage).slice(0, 300) }
    : null;
  const ts = Number(d.messageTimestamp);
  const alt = [key.remoteJidAlt, key.senderPn].map((x) => String(x || '')).find((x) => x.endsWith('@s.whatsapp.net')) || '';
  return {
    id: String(key.id),
    deMim: Boolean(key.fromMe),
    jid,
    lid: jid.endsWith('@lid') ? jid : null,
    telefone: jid.endsWith('@s.whatsapp.net') ? so(jid) : (so(alt) || null),
    nome: key.fromMe ? null : (d.pushName || null),
    tipo, texto: String(texto || ''), midia, nomeArquivo: nome,
    quando: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
    // citação de mensagem DA PRÓPRIA conversa (resolvida pro wamid na gravação)
    citaId: ctx?.stanzaId && !grupoCitado ? String(ctx.stanzaId) : null,
    grupoCitado,
  };
}

// ── Banco ───────────────────────────────────────────────────────────────────

let cacheNumero = { em: 0, v: null };
/** O número do Relacionamento na Cloud API (a conversa é dele). */
async function numeroRel() {
  if (cacheNumero.v && Date.now() - cacheNumero.em < 10 * 60_000) return cacheNumero.v;
  const r = (await rest('qs_wa_numeros_meta?select=phone_number_id&setor=eq.relacionamento&status=eq.conectado&order=conectado_em.desc.nullslast&limit=1'))?.[0];
  if (!r?.phone_number_id) throw new Error('Número do Relacionamento não encontrado.');
  cacheNumero = { em: Date.now(), v: String(r.phone_number_id) };
  return cacheNumero.v;
}

let cache0231 = { em: 0, v: null };
/** A 0231 está no banco? (colunas via/grupo_citado + conversa "sem número"). */
export async function tem0231() {
  if (cache0231.v !== null && Date.now() - cache0231.em < 10 * 60_000) return cache0231.v;
  let v = false;
  try { await rest('rel_wa_mensagens?select=via,grupo_citado&limit=0'); v = true; } catch { v = false; }
  cache0231 = { em: Date.now(), v };
  return v;
}

/** @lid → telefone pelos participantes dos grupos (0143). */
async function telefoneDoLid(lid) {
  if (!lid) return null;
  const r = (await rest(`rel_wa_grupo_participantes?select=telefone&participante=eq.${encodeURIComponent(lid)}&telefone=not.is.null&limit=1`).catch(() => null))?.[0];
  return r?.telefone ? so(r.telefone) : null;
}

const nomesDosGrupos = new Map();
async function nomeDoGrupo(jid) {
  if (nomesDosGrupos.has(jid)) return nomesDosGrupos.get(jid);
  const n = (await rest(`rel_wa_grupos?select=nome&jid=eq.${encodeURIComponent(jid)}&limit=1`).catch(() => null))?.[0]?.nome || null;
  nomesDosGrupos.set(jid, n);
  return n;
}

/** A conversa do Rel com esse telefone (com ou sem o 9). */
async function conversaDe(phoneId, fone) {
  const lista = variantesBr(fone).map((x) => encodeURIComponent(x)).join(',');
  return (await rest(`rel_wa_conversas?select=id,telefone,ultima_entrada_em,ultima_saida_em&phone_number_id=eq.${encodeURIComponent(phoneId)}&telefone=in.(${lista})&order=ultima_entrada_em.desc.nullslast&limit=1`))?.[0] || null;
}

/** As mensagens da conversa perto da hora (pra achar a cópia da Meta e a citada). */
async function vizinhas(conversaId, quando) {
  const t = new Date(quando).getTime();
  const de = new Date(t - 2 * 86400_000).toISOString();
  const ate = new Date(t + 2 * 86400_000).toISOString();
  return (await rest(`rel_wa_mensagens?select=id,wamid,via,grupo_citado&conversa_id=eq.${conversaId}&enviada_em=gte.${de}&enviada_em=lte.${ate}&limit=1000`).catch(async () =>
    rest(`rel_wa_mensagens?select=id,wamid&conversa_id=eq.${conversaId}&enviada_em=gte.${de}&enviada_em=lte.${ate}&limit=1000`))) || [];
}

async function baixarMidia(id, fone) {
  try {
    const r = await evo(`/chat/getBase64FromMediaMessage/${encodeURIComponent(INSTANCIA())}`, {
      method: 'POST', body: { message: { key: { id } }, convertToMp4: false }, timeoutMs: 20000,
    });
    if (!r?.base64) return null;
    const bytes = Buffer.from(r.base64, 'base64');
    if (!bytes.length || bytes.length > MAX_MIDIA) return null;
    const url = await guardarMidia(bytes, r.mimetype, { leadId: `rel-${fone || 'sem-numero'}`, nomeArquivo: r.fileName });
    return url ? { url, tamanho: bytes.length } : null;
  } catch (e) {
    console.warn('[rel-privado] mídia:', e?.message);
    return null;
  }
}

/**
 * Grava (ou reconhece) uma mensagem 1:1 da Evolution na conversa da Cloud API.
 * Devolve 'gravada' | 'repetida' | 'enriquecida' | 'ignorada' | 'sem-numero' | 'sem-numero-guardada'.
 * Lança só se o banco falhar — quem chama decide (webhook responde 500).
 */
export async function gravarPrivado(d, { baixar = true, seco = false } = {}) {
  const p = lerPrivado(d);
  if (!p) return { r: 'ignorada' };
  const phoneId = await numeroRel();
  let fone = p.telefone || await telefoneDoLid(p.lid);
  const com0231 = await tem0231();

  if (!fone) {
    // Sem número: só com a 0231 (conversa "lid:<código>", trava de envio no rel-wa).
    if (!com0231 || !p.lid) {
      console.error(`[rel-privado] SEM NÚMERO e sem a 0231 — não gravei ${p.id} de ${p.jid} (${p.nome || '?'}): "${p.texto.slice(0, 60)}"`);
      return { r: 'sem-numero', p };
    }
    fone = `lid:${so(p.lid)}`;
  }

  const conv = fone.startsWith('lid:')
    ? (await rest(`rel_wa_conversas?select=id,telefone,ultima_entrada_em,ultima_saida_em&phone_number_id=eq.${encodeURIComponent(phoneId)}&telefone=eq.${encodeURIComponent(fone)}&limit=1`))?.[0] || null
    : await conversaDe(phoneId, fone);
  const telefone = conv?.telefone || fone;

  // Já existe? (mesma chave = cópia da Meta ou esta mesma, de outra vez)
  const msgs = conv ? await vizinhas(conv.id, p.quando) : [];
  const ja = msgs.find((m) => chaveDoWamid(m.wamid) === p.id);
  if (ja) {
    // A Meta não diz que era resposta a um GRUPO; a Evolution diz. Completa a linha.
    if (p.grupoCitado && com0231 && !ja.grupo_citado && !seco) {
      const g = { ...p.grupoCitado, nome: await nomeDoGrupo(p.grupoCitado.jid) };
      await rest(`rel_wa_mensagens?id=eq.${ja.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { grupo_citado: g } }).catch(() => null);
      return { r: 'enriquecida', p, telefone };
    }
    return { r: 'repetida', p, telefone };
  }
  if (seco) return { r: fone.startsWith('lid:') ? 'sem-numero-guardada' : 'gravada', p, telefone, conversa: conv?.id || null };

  // Chegou atrasada (a conversa já andou depois dela)? Entra como histórico: não
  // mexe em SLA/estado nem volta "última mensagem" pra trás.
  const ultima = Math.max(Date.parse(conv?.ultima_entrada_em || 0) || 0, Date.parse(conv?.ultima_saida_em || 0) || 0);
  const atrasada = ultima > new Date(p.quando).getTime() + 1000;
  const origem = atrasada ? 'historico' : (p.deMim ? 'celular' : 'cliente');

  let anexos = [];
  if (p.midia && baixar) {
    const a = await baixarMidia(p.id, fone.startsWith('lid:') ? null : fone);
    if (a) anexos = [{ type: p.midia, url: a.url, ...(p.nomeArquivo ? { nome: p.nomeArquivo } : {}), tamanho: a.tamanho }];
  }
  const texto = p.texto || (p.midia && !anexos.length ? rotuloDaMidia(p.midia) : '');
  const citada = p.citaId ? msgs.find((m) => chaveDoWamid(m.wamid) === p.citaId) : null;

  const r = await rest('rpc/rel_wa_ingest', {
    method: 'POST',
    body: {
      p_phone_id: phoneId, p_telefone: telefone, p_nome: p.nome, p_wamid: `evo:${p.id}`,
      p_direcao: p.deMim ? 'out' : 'in', p_origem: origem, p_texto: texto, p_anexos: anexos,
      p_enviada_em: p.quando, p_autor: null, p_autor_nome: p.deMim ? 'Celular do Relacionamento' : null,
      p_status: p.deMim ? 'sent' : null, p_resp: citada?.wamid || null,
    },
  });
  if (r?.nova !== true) return { r: 'repetida', p, telefone };
  if (com0231) {
    const extra = { via: 'aparelho' };
    if (p.grupoCitado) extra.grupo_citado = { ...p.grupoCitado, nome: await nomeDoGrupo(p.grupoCitado.jid) };
    await rest(`rel_wa_mensagens?wamid=eq.${encodeURIComponent(`evo:${p.id}`)}`, { method: 'PATCH', prefer: 'return=minimal', body: extra })
      .catch((e) => console.warn('[rel-privado] selo não gravado:', e?.message));
  }
  console.log(`[rel-privado] gravada pela Evolution: ${p.id} ${p.deMim ? '→' : '←'} …${String(telefone).slice(-4)}${p.grupoCitado ? ' (respondendo grupo)' : ''}${atrasada ? ' (atrasada)' : ''}`);
  return { r: fone.startsWith('lid:') ? 'sem-numero-guardada' : 'gravada', p, telefone, conversa: r?.conversa || null };
}

// ── Varredura (cron + script de recuperação) ────────────────────────────────

/**
 * Lê na Evolution as mensagens desde `desde` (mais novas primeiro, paginado) e
 * grava as 1:1 que faltam. `ate` = não mexe nas muito recentes (dá tempo da
 * Meta entregar a dela primeiro). Para no `prazo`.
 */
export async function varrerPrivado({ desde, ate = new Date(Date.now() - 2 * 60_000), prazo = Date.now() + 20_000, seco = false, baixar = true, porPagina = 200, maxPaginas = 40 } = {}) {
  const ini = new Date(desde).getTime() / 1000;
  const fim = new Date(ate).getTime() / 1000;
  const conta = { lidas: 0, pessoas: 0, gravada: 0, repetida: 0, enriquecida: 0, ignorada: 0, 'sem-numero': 0, 'sem-numero-guardada': 0, erros: 0, cortou: false };
  const achadas = [];
  // As chaves que o banco já tem na janela (uma consulta só, em vez de duas por mensagem).
  const conhecidas = new Set();
  const de = new Date(new Date(desde).getTime() - 30 * 60_000).toISOString();
  for (let off = 0; ; off += 1000) {
    const lote = await rest(`rel_wa_mensagens?select=wamid&enviada_em=gte.${de}&order=enviada_em.asc,id.asc&offset=${off}&limit=1000`);
    for (const m of lote || []) { const k = chaveDoWamid(m.wamid); if (k) conhecidas.add(k); }
    if (!lote || lote.length < 1000) break;
  }
  for (let page = 1; page <= maxPaginas; page++) {
    if (Date.now() > prazo) { conta.cortou = true; break; }
    const r = await evo(`/chat/findMessages/${encodeURIComponent(INSTANCIA())}`, { method: 'POST', body: { where: {}, page, offset: porPagina }, timeoutMs: 20000 });
    const recs = r?.messages?.records || [];
    if (!recs.length) break;
    for (const d of recs) {
      const ts = Number(d.messageTimestamp);
      if (!(ts >= ini && ts <= fim)) continue;
      conta.lidas++;
      if (ehGrupo(d?.key?.remoteJid) || !ehPessoa(d?.key?.remoteJid)) continue;
      conta.pessoas++;
      // já está no banco e não traz citação de grupo pra completar → nada a fazer
      if (conhecidas.has(String(d?.key?.id)) && !lerPrivado(d)?.grupoCitado) { conta.repetida++; continue; }
      if (Date.now() > prazo) { conta.cortou = true; break; }
      try {
        const g = await gravarPrivado(d, { seco, baixar });
        conta[g.r] = (conta[g.r] || 0) + 1;
        if (g.r !== 'repetida' && g.r !== 'ignorada') achadas.push({ r: g.r, id: g.p?.id, quando: g.p?.quando, deMim: g.p?.deMim, telefone: g.telefone || null, nome: g.p?.nome, texto: (g.p?.texto || g.p?.tipo || '').slice(0, 80), grupo: g.p?.grupoCitado?.jid || null });
      } catch (e) {
        conta.erros++;
        console.warn('[rel-privado] varredura:', d?.key?.id, e?.message);
      }
    }
    const minTs = Math.min(...recs.map((x) => Number(x.messageTimestamp) || Infinity));
    if (minTs < ini) break;
  }
  return { conta, achadas };
}
