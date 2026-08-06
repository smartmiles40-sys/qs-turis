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
