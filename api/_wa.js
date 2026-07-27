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
  // Timeout obrigatório: a função inteira tem 10s na Vercel. Sem isto, um
  // /auth/v1/user lento consome sozinho todo o orçamento e o envio "falha"
  // depois de já ter saído.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${jwt}` },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const user = await r.json();
    return (user && user.id) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
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

  // Quem passou o lead adiante continua podendo falar com o cliente. Sem este
  // ramo, o SDR VÊ a conversa (a RLS da 0025 permite) mas toma 403 ao responder
  // — quebrando exatamente o fluxo "agendou, foi pro closer, mas continuo junto".
  // Espelha `qs_owns_lead` da migration 0025: as duas regras têm que andar juntas.
  try {
    const passou = await rest(
      `qs_handovers?select=lead_id&lead_id=eq.${encodeURIComponent(leadId)}` +
      `&from_user_id=eq.${encodeURIComponent(userId)}&limit=1`
    );
    if (Array.isArray(passou) && passou.length) return { ok: true, lead, user };
  } catch (e) {
    console.warn('[wa] checagem de handover:', e?.message);
  }

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

/** Envio multipart (mídia). O cw() normal manda JSON e não serve aqui. */
// 45s cabe no maxDuration de 60s que a rota de mídia declara no vercel.json.
// Antes eram 25s contra um teto de 10s: o AbortController nunca disparava, a
// Vercel matava a função e o SDR via "não consegui enviar" com o arquivo já
// entregue — e reenviava.
export async function cwForm(path, form, { timeoutMs = 45_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${CW_API}${path}`, {
      method: 'POST',
      // Sem Content-Type: o fetch monta o boundary do multipart sozinho.
      headers: { api_access_token: process.env.CHATWOOT_AGENT_TOKEN || '' },
      body: form,
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

/** Por qual caixa (= qual número nosso) a mensagem sai. */
export function defaultInboxId() {
  const env = Number(process.env.CHATWOOT_DEFAULT_INBOX_ID);
  if (Number.isFinite(env) && env > 0) return env;
  return WA_INBOX_IDS[0] ?? null;
}

/** source_id = a "linha" que liga aquele contato àquela caixa; a conversa precisa dela. */
async function sourceIdFor(contactId, inboxId) {
  try {
    const { payload = [] } = await cw(`/contacts/${contactId}/contactable_inboxes`);
    const hit = payload.find((p) => (p.inbox?.id ?? p.inbox_id) === inboxId) || payload[0];
    return hit?.source_id || null;
  } catch (e) {
    console.warn('[wa] contactable_inboxes:', e?.message);
    return null;
  }
}

/**
 * Devolve a conversa do lead, CRIANDO contato/conversa se ainda não existir —
 * assim a primeira abordagem também sai pelo QS, e não por fora.
 */
export async function ensureConversation(lead) {
  const phone = toE164BR(lead.phone);
  if (!phone) return { error: 'lead-sem-telefone' };

  const inboxId = defaultInboxId();
  if (!inboxId) return { error: 'inbox-nao-configurada' };

  let contact = await findContact(phone);

  if (!contact) {
    const name = lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || phone;
    try {
      const created = await cw('/contacts', {
        method: 'POST',
        body: { inbox_id: inboxId, name, phone_number: phone },
      });
      contact = created?.payload?.contact || created?.payload || null;
    } catch (e) {
      console.error('[wa] criar contato:', e?.message);
      return { error: 'falha-ao-criar-contato' };
    }
  }
  if (!contact?.id) return { error: 'sem-contato' };

  const existing = await pickConversation(contact.id);
  if (existing) return { conversation: existing, contact };

  const sourceId = await sourceIdFor(contact.id, inboxId);
  if (!sourceId) return { error: 'sem-source-id' };

  try {
    const conv = await cw('/conversations', {
      method: 'POST',
      body: { source_id: sourceId, inbox_id: inboxId, contact_id: contact.id },
    });
    return { conversation: conv, contact };
  } catch (e) {
    console.error('[wa] criar conversa:', e?.message);
    return { error: 'falha-ao-criar-conversa' };
  }
}

/** Mensagem humana pros erros de ensureConversation. */
export function motivoHumano(code) {
  return {
    'lead-sem-telefone': 'Este lead não tem telefone cadastrado.',
    'inbox-nao-configurada': 'Falta dizer por qual número enviar (CHATWOOT_DEFAULT_INBOX_ID).',
    'falha-ao-criar-contato': 'Não consegui criar o contato no atendimento.',
    'falha-ao-criar-conversa': 'Não consegui abrir a conversa no atendimento.',
    'sem-source-id': 'A caixa de WhatsApp não aceitou este contato.',
    'sem-contato': 'Não consegui identificar o contato no atendimento.',
  }[code] || 'Não consegui abrir a conversa.';
}

// ── Cadência: baixar a atividade de WhatsApp sozinha ────────────────────────

/**
 * Quando o SDR responde pelo QS, a tarefa de WhatsApp daquele lead que estava
 * pendente pra hoje (ou atrasada) é dada como feita. Some o trabalho de marcar
 * na mão — que é onde a aderência costuma se perder.
 *
 * Best-effort de propósito: se falhar, o envio da mensagem NÃO pode falhar junto.
 * Desligável em qs_settings.wa_auto_complete_task = false.
 */
export async function completeWhatsAppTask(leadId, ownerId = null) {
  try {
    const cfg = await rest(`qs_settings?select=value&key=eq.wa_auto_complete_task&limit=1`);
    if (cfg?.[0]?.value === false) return null;
  } catch { /* sem config = ligado */ }

  try {
    // Tem que ser "até a próxima meia-noite de BRASÍLIA", não "daqui a 24h".
    // Com janela deslizante, uma mensagem às 15h de hoje concluía o FUP das 9h
    // de AMANHÃ — a atividade sumia da fila sem nunca ter sido feita.
    const BRT_OFFSET_H = 3;
    const agora = new Date();
    const brt = new Date(agora.getTime() - BRT_OFFSET_H * 3600_000);
    const meiaNoiteBrtSeguinte = new Date(Date.UTC(
      brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate() + 1, BRT_OFFSET_H, 0, 0
    ));
    const limite = meiaNoiteBrtSeguinte.toISOString();

    // Só a tarefa DO DONO: depois de um handover, o closer respondendo não pode
    // baixar a atividade do SDR (e vice-versa) — isso sujaria a aderência de cada um.
    const filtroDono = ownerId ? `&owner_id=eq.${encodeURIComponent(ownerId)}` : '';

    const abertas = await rest(
      `qs_tasks?select=id,scheduled_at&lead_id=eq.${encodeURIComponent(leadId)}` +
      `&channel_type=eq.whatsapp&status=eq.pendente&scheduled_at=lt.${encodeURIComponent(limite)}` +
      filtroDono +
      `&order=scheduled_at.asc&limit=1`
    );
    const alvo = abertas?.[0];
    if (!alvo) return null;

    await rest(`qs_tasks?id=eq.${encodeURIComponent(alvo.id)}`, {
      method: 'PATCH',
      body: { status: 'concluida', completed_at: new Date().toISOString() },
      prefer: 'return=minimal',
    });
    return alvo.id;
  } catch (e) {
    console.warn('[wa] completeWhatsAppTask:', e?.message);
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
  // Nota PRIVADA do Chatwoot é message_type=1 (outgoing) com private=true. Sem
  // este corte ela entraria na tela do SDR como se tivesse ido pro cliente — e
  // ainda mexeria no last_out_at, fazendo uma conversa parada sumir do
  // "esperando resposta".
  if (message?.private === true) return false;

  const direction = directionOf(message);
  if (!direction) return false;

  // Sem o id do Chatwoot não há como deduplicar (o índice único é parcial e
  // ignora NULL): a mesma mensagem entraria de novo pelo webhook e o SDR veria
  // duplicado na tela. Melhor deixar o webhook gravar, que sempre traz o id.
  if (message?.id == null) {
    console.warn('[wa] mensagem sem id do Chatwoot — deixando pro webhook gravar');
    return false;
  }

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
