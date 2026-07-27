// api/_wa.js
// -----------------------------------------------------------------------------
// Camada compartilhada do ATENDIMENTO NATIVO de WhatsApp do QS.
//
// O Chatwoot continua sendo o motor (ele fala com a Evolution, que fala com o
// WhatsApp). O que muda é quem MOSTRA a conversa: em vez de embutir o painel do
// Chatwoot — onde todo agente enxerga a caixa inteira, porque restringir por
// agente é recurso Enterprise (custom_roles = 404 na nossa instância) — o QS
// copia a conversa pra dentro dele e deixa a RLS do lead decidir quem vê.
//
// Regra de ouro deste arquivo: NADA aqui confia no navegador. Toda rota que
// devolve ou envia mensagem primeiro pergunta "este lead é mesmo deste usuário?"
// contra o banco, com service_role, e só então fala com o Chatwoot.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';

export const CW_BASE = (process.env.CHATWOOT_BASE_URL || 'https://chat.setuforeuvouviagens.com.br').replace(/\/+$/, '');
export const CW_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '1';
export const CW_API = `${CW_BASE}/api/v1/accounts/${CW_ACCOUNT_ID}`;

export const WA_INBOX_IDS = (process.env.CHATWOOT_WA_INBOX_IDS || '')
  .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));

export function cwHeaders() {
  return { api_access_token: process.env.CHATWOOT_AGENT_TOKEN || '', 'Content-Type': 'application/json' };
}

export function cwConfigured() {
  return Boolean(process.env.CHATWOOT_AGENT_TOKEN);
}

/** fetch no Chatwoot com timeout — nunca deixa a função serverless pendurada. */
export async function cw(path, { method = 'GET', body, timeoutMs = 10_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${CW_API}${path}`, {
      method,
      headers: cwHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!r.ok) {
      const err = new Error((json && json.message) || `Chatwoot HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// ── Telefone ────────────────────────────────────────────────────────────────

export function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

/** E.164 BR. <=11 dígitos = sem DDI → prepõe 55 (trata DDD 55/RS certo). */
export function toE164BR(raw) {
  const d = onlyDigits(raw);
  if (!d) return null;
  return '+' + (d.length <= 11 ? '55' + d : d);
}

/**
 * Chave canônica de comparação: DDD + 8 dígitos finais, SEM o nono dígito e SEM
 * o 55. Existe porque o mesmo celular aparece escrito de 4 jeitos diferentes
 * (com/sem +55, com/sem o 9) entre o CRM, o Chatwoot e o WhatsApp — comparar
 * string crua faria o lead certo não casar com a conversa dele.
 */
export function waKey(raw) {
  let d = onlyDigits(raw);
  if (!d) return null;
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10) return null;
  const ddd = d.slice(0, 2);
  let rest = d.slice(2);
  if (rest.length === 9 && rest.startsWith('9')) rest = rest.slice(1);
  if (rest.length !== 8) return null;
  return ddd + rest;
}

// ── Leads ───────────────────────────────────────────────────────────────────

const LEAD_COLS = 'id,owner_id,full_name,first_name,last_name,phone,status';

/**
 * Acha o lead dono deste telefone. Busca ampla pelos 8 dígitos finais (o que
 * sobrevive a qualquer formatação) e só então confirma pela chave canônica.
 */
export async function findLeadByPhone(phone) {
  const key = waKey(phone);
  if (!key) return null;
  const last8 = key.slice(-8);
  const rows = await rest(
    `qs_leads?select=${LEAD_COLS}&phone=ilike.*${encodeURIComponent(last8)}*&order=updated_at.desc&limit=20`
  );
  const list = Array.isArray(rows) ? rows : [];
  return list.find((l) => waKey(l.phone) === key) || null;
}

export async function getLead(leadId) {
  const rows = await rest(`qs_leads?select=${LEAD_COLS}&id=eq.${encodeURIComponent(leadId)}&limit=1`);
  return (Array.isArray(rows) && rows[0]) || null;
}

// ── Autorização ─────────────────────────────────────────────────────────────

/** Valida o JWT do Supabase Auth e devolve o id do usuário (ou null). */
export async function getSupabaseUserId(authHeader) {
  const jwt = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return null;
    const user = await r.json();
    return (user && user.id) || null;
  } catch {
    return null;
  }
}

/**
 * A trava do produto inteiro: este usuário pode mexer neste lead?
 * Mesma regra da RLS (0007): gestor/admin vê tudo; SDR só o dele ou sem dono.
 * Um usuário desativado não passa.
 */
export async function assertCanAccessLead(userId, leadId) {
  const [users, lead] = await Promise.all([
    rest(`qs_users?select=id,name,role,is_active&id=eq.${encodeURIComponent(userId)}&limit=1`),
    getLead(leadId),
  ]);
  const user = (Array.isArray(users) && users[0]) || null;
  if (!user || user.is_active === false) return { ok: false, reason: 'usuario-invalido' };
  if (!lead) return { ok: false, reason: 'lead-inexistente' };
  const isManager = user.role === 'admin' || user.role === 'gestor';
  if (isManager || lead.owner_id === userId || lead.owner_id == null) return { ok: true, lead, user };
  return { ok: false, reason: 'lead-de-outro-sdr' };
}

// ── Chatwoot: contato e conversa ────────────────────────────────────────────

export async function findContact(phoneE164) {
  try {
    const { payload = [] } = await cw('/contacts/filter', {
      method: 'POST',
      body: {
        payload: [{ attribute_key: 'phone_number', filter_operator: 'equal_to', values: [phoneE164], query_operator: null }],
      },
    });
    if (payload.length) return payload[0];
  } catch (e) { console.warn('[wa] contacts/filter:', e?.message); }

  try {
    const { payload = [] } = await cw(`/contacts/search?q=${encodeURIComponent(phoneE164.replace('+', ''))}`);
    return payload[0] || null;
  } catch (e) { console.warn('[wa] contacts/search:', e?.message); }

  return null;
}

export async function pickConversation(contactId) {
  try {
    const { payload = [] } = await cw(`/contacts/${contactId}/conversations`);
    let convs = Array.isArray(payload) ? payload : [];
    if (WA_INBOX_IDS.length) convs = convs.filter((c) => WA_INBOX_IDS.includes(c.inbox_id));
    convs.sort((a, b) => (b.last_activity_at || 0) - (a.last_activity_at || 0));
    return convs.find((c) => c.status && c.status !== 'resolved') || convs[0] || null;
  } catch (e) {
    console.warn('[wa] contact conversations:', e?.message);
    return null;
  }
}

// ── Gravação no QS ──────────────────────────────────────────────────────────

/** message_type do Chatwoot → direção nossa. 2=activity e afins ficam de fora. */
export function directionOf(message) {
  const t = message?.message_type;
  if (t === 0 || t === 'incoming') return 'in';
  if (t === 1 || t === 'outgoing') return 'out';
  return null;
}

/**
 * A data da mensagem chega em dois formatos diferentes: a API REST manda epoch em
 * segundos (número) e o webhook manda ISO ("2026-07-27T12:00:00.000Z"). Aceitar
 * só um dos dois jogaria metade das mensagens pro horário errado.
 */
export function parseCwDate(v) {
  if (v == null || v === '') return new Date().toISOString();
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    return new Date(Number(v) * 1000).toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function normalizeAttachments(message) {
  const list = Array.isArray(message?.attachments) ? message.attachments : [];
  return list.map((a) => ({
    type: a.file_type || 'file',
    url: a.data_url || a.thumb_url || null,
  })).filter((a) => a.url);
}

/**
 * Grava uma mensagem no QS (idempotente por cw_message_id) e atualiza a linha da
 * lista. Toda a soma de "não lidas" acontece dentro da função do banco.
 */
export async function ingestMessage({ leadId, conversationId, message, contactId = null, canReply = null, inboxId = null }) {
  const direction = directionOf(message);
  if (!direction) return false;

  const attachments = normalizeAttachments(message);
  const content = message?.content || '';
  if (!content && !attachments.length) return false; // nada pra mostrar

  const sentAt = parseCwDate(message?.created_at);

  const out = await rest('rpc/qs_wa_ingest', {
    method: 'POST',
    body: {
      p_lead: leadId,
      p_conv: conversationId ?? null,
      p_msg: message?.id ?? null,
      p_direction: direction,
      p_content: content,
      p_attachments: attachments,
      p_sender: message?.sender?.name || null,
      p_sent_at: sentAt,
      p_contact: contactId,
      p_can_reply: canReply,
      p_inbox: inboxId == null ? null : Number(inboxId),
    },
  });
  return out === true;
}
