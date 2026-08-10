// api/_evolution.js
// -----------------------------------------------------------------------------
// A ponte DIRETA com a Evolution API — usada só pro que o Chatwoot não faz.
//
// O atendimento continua passando pelo Chatwoot (mensagem, mídia, histórico).
// Mas o Chatwoot NÃO tem endpoint de reação (o 👍 sobre a mensagem), então a
// reação sai daqui, falando com a mesma Evolution que já move o WhatsApp dos
// números da agência.
//
// Envs (Vercel):
//   EVOLUTION_URL        ex.: https://evo.setuforeuvouviagens.com.br
//   EVOLUTION_APIKEY     a apikey global da Evolution (Manager → Settings)
//   EVOLUTION_INSTANCE   nome da instância (quando só há 1 número)  — OU
//   EVOLUTION_INSTANCES  mapa caixa-do-Chatwoot → instância, em JSON:
//                        {"2":"setufor-principal","5":"setufor-oficial"}
//
// Sem as envs, tudo aqui devolve "não configurado" e o QS segue funcionando —
// a reação só fica visível dentro do QS até o Bruno ligar os fios.
// -----------------------------------------------------------------------------

import { toE164BR } from './_wa.js';

export const EVO_BASE = String(process.env.EVOLUTION_URL || '').replace(/\/+$/, '');

export function evoConfigured() {
  return Boolean(EVO_BASE && process.env.EVOLUTION_APIKEY);
}

/** Qual instância da Evolution atende a caixa (inbox) do Chatwoot. */
export function evoInstanceForInbox(inboxId) {
  const raw = process.env.EVOLUTION_INSTANCES;
  if (raw) {
    try {
      const mapa = JSON.parse(raw);
      const hit = mapa?.[String(inboxId)];
      if (hit) return String(hit);
    } catch {
      console.warn('[evo] EVOLUTION_INSTANCES não é JSON válido — usando EVOLUTION_INSTANCE');
    }
  }
  return process.env.EVOLUTION_INSTANCE || null;
}

/** POST na Evolution com timeout. Nunca deixa a função serverless pendurada. */
export async function evo(path, body, { timeoutMs = 10_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${EVO_BASE}${path}`, {
      method: 'POST',
      headers: { apikey: process.env.EVOLUTION_APIKEY || '', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!r.ok) {
      const err = new Error(
        (json && (json.message || json.error)) || `Evolution HTTP ${r.status}`
      );
      err.status = r.status;
      err.body = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** GET na Evolution, mesmo timeout e mesmo tratamento de erro do `evo`. */
export async function evoGet(path, { timeoutMs = 10_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${EVO_BASE}${path}`, {
      headers: { apikey: process.env.EVOLUTION_APIKEY || '' },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!r.ok) {
      const err = new Error(
        (json && (json.message || json.error)) || `Evolution HTTP ${r.status}`
      );
      err.status = r.status;
      err.body = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Estado de todas as instâncias, já normalizado.
 *
 * A Evolution mudou o formato entre versões: a v2 devolve os campos na raiz
 * (`name`/`connectionStatus`), a v1 embrulhava em `{ instance: {...} }`. Ler os
 * dois evita que uma atualização do servidor cegue o monitor em silêncio.
 */
export async function listarInstancias() {
  const out = await evoGet('/instance/fetchInstances');
  const linhas = Array.isArray(out) ? out : [out];
  return linhas.filter(Boolean).map((linha) => {
    const i = linha.instance && typeof linha.instance === 'object' ? linha.instance : linha;
    const jid = String(i.ownerJid || i.owner || '');
    return {
      nome: String(i.name || i.instanceName || ''),
      status: String(i.connectionStatus || i.status || 'unknown'),
      numero: jid.split('@')[0] || null,
    };
  }).filter((i) => i.nome);
}

/** Só `open` é "no ar". `close` = deslogada, `connecting` = esperando o QR. */
export function noAr(status) {
  return String(status).toLowerCase() === 'open';
}

/** Manda texto simples. Formato v2 (`{number,text}`) com fallback pro da v1. */
export async function sendText(instance, numero, texto) {
  const number = String(numero).replace(/\D/g, '');
  try {
    return await evo(`/message/sendText/${encodeURIComponent(instance)}`, {
      number, text: texto,
    });
  } catch (e) {
    if (e?.status !== 400 && e?.status !== 422) throw e;
    return await evo(`/message/sendText/${encodeURIComponent(instance)}`, {
      number, textMessage: { text: texto },
    });
  }
}

/** O JID "chutado" a partir do telefone: 55DDD…@s.whatsapp.net. */
export function jidFromPhone(phone) {
  const e164 = toE164BR(phone);
  if (!e164) return null;
  return `${e164.replace('+', '')}@s.whatsapp.net`;
}

/**
 * O JID REAL do número no WhatsApp. Importa porque celular brasileiro antigo
 * vive no WhatsApp SEM o nono dígito — o JID derivado do cadastro erraria e a
 * reação iria pro nada. A Evolution resolve isso consultando o próprio WhatsApp;
 * se a consulta falhar, cai no derivado (melhor tentar do que desistir).
 */
export async function resolveJid(instance, phone) {
  const chute = jidFromPhone(phone);
  if (!chute) return null;
  try {
    const out = await evo(`/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
      numbers: [chute.split('@')[0]],
    });
    const hit = Array.isArray(out) ? out[0] : out?.[0];
    if (hit && hit.exists !== false && hit.jid) return hit.jid;
  } catch (e) {
    console.warn('[evo] whatsappNumbers falhou, usando JID derivado:', e?.message);
  }
  return chute;
}

/**
 * A URL da foto de perfil do contato no WhatsApp.
 *
 * Devolve null em silêncio quando não há foto — e isso é comum, não é erro:
 * quem configura "foto de perfil: só meus contatos" fica invisível pro nosso
 * número, e a resposta certa nesse caso são as iniciais coloridas.
 *
 * ⚠️ A URL que volta é ASSINADA e EXPIRA em poucos dias. Guardar ela crua no
 * banco dá foto quebrada depois — quem chama precisa baixar e rehospedar.
 */
export async function fetchProfilePicture(instance, phone) {
  const numero = onlyDigitsEvo(phone);
  if (!numero) return null;
  try {
    const r = await evo(`/chat/fetchProfilePictureUrl/${encodeURIComponent(instance)}`, { number: numero });
    const url = r?.profilePictureUrl || r?.profilePicUrl || null;
    return url && /^https?:\/\//i.test(String(url)) ? String(url) : null;
  } catch (e) {
    // 404 = contato sem foto (ou sem permissão de ver). Não polui o log.
    if (e?.status !== 404 && e?.status !== 400) {
      console.warn('[evo] fetchProfilePicture:', e?.message);
    }
    return null;
  }
}

function onlyDigitsEvo(v) {
  return String(v || '').replace(/\D/g, '');
}

/**
 * Apaga a mensagem PARA TODOS no WhatsApp — o "Apagar para todos" do celular.
 *
 * A Evolution expõe isso como DELETE em /chat/deleteMessageForEveryone, e o
 * corpo é a mesma `key` da reação (remoteJid + id + fromMe). O WhatsApp só
 * deixa apagar mensagem NOSSA e dentro da janela dele — passou do prazo, ele
 * recusa, e quem chama precisa saber disso pra não mentir na tela.
 */
export async function deleteForEveryone(instance, key) {
  const url = `${EVO_BASE}/chat/deleteMessageForEveryone/${encodeURIComponent(instance)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(url, {
      method: 'DELETE',
      headers: { apikey: process.env.EVOLUTION_APIKEY || '', 'Content-Type': 'application/json' },
      body: JSON.stringify(key),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!r.ok) {
      const err = new Error((json && (json.message || json.error)) || `Evolution HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Manda a reação pro WhatsApp do cliente. `emoji` vazio REMOVE a reação —
 * mesma semântica do celular. Tenta o formato da Evolution v2 e, se a instância
 * for v1, repete no formato antigo.
 */
export async function sendReaction(instance, key, emoji) {
  const reaction = String(emoji || '');
  try {
    return await evo(`/message/sendReaction/${encodeURIComponent(instance)}`, {
      key, reaction,
    });
  } catch (e) {
    if (e?.status !== 400 && e?.status !== 422) throw e;
    // Evolution v1: o corpo vem embrulhado em reactionMessage.
    return await evo(`/message/sendReaction/${encodeURIComponent(instance)}`, {
      reactionMessage: { key, reaction },
    });
  }
}
