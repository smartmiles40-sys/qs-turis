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

// ── Assinatura do SDR ───────────────────────────────────────────────────────
// Todo mundo escreve pelo MESMO token de serviço do Chatwoot. Do lado do
// cliente, isso significa que sem assinatura ninguém sabe com quem está falando
// — e a assinatura automática do Chatwoot (`signMsg`) não resolve: ela carimba o
// nome do dono do token, igual pra todos, o que é pior do que não ter nome.
//
// Então o nome vai daqui, e vai do SERVIDOR: o navegador manda só o texto, quem
// diz quem está assinando é a sessão autenticada. Um SDR não consegue mandar
// mensagem assinada com o nome de outro.
//
// O nome exibido é editável em Configurações → Atendimento (mapa
// `wa_signature_names`), porque o cadastro costuma ter o nome completo
// ("Victor Hugo Silva Santos") e no WhatsApp o time se apresenta pelo nome curto.
// Sem nada mapeado, cai no automático: os dois primeiros nomes do cadastro.

export const WA_SIGNATURE_MAP_KEY = 'wa_signature_names';
export const WA_SIGNATURE_ENABLED_KEY = 'wa_signature_enabled';

/** Nome curto padrão: "Victor Hugo Silva" → "Victor Hugo"; "Yanka" → "Yanka". */
export function nomeCurto(nomeCompleto) {
  const partes = String(nomeCompleto || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '';
  // Nome composto ("Victor Hugo", "Ana Paula", "Maria Clara") só é preservado
  // quando a 2ª palavra NÃO é conectivo de sobrenome (da, de, dos...).
  const conectivos = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  if (partes.length > 1 && !conectivos.has(partes[1].toLowerCase())) {
    return `${partes[0]} ${partes[1]}`;
  }
  return partes[0];
}

// Configuração de assinatura muda uma vez por mês; mensagem sai o dia inteiro.
// Sem cache, cada envio pagaria duas idas ao banco antes de falar com o Chatwoot.
// 60s é curto o bastante pra ninguém "esperar" a mudança e longo o bastante pra
// sumir com o custo numa rajada de mensagens (a função serverless quente reusa
// o processo; se ela reciclar, o cache simplesmente nasce vazio de novo).
const CACHE_MS = 60_000;
let cacheAssinatura = { em: 0, mapa: null, ligada: true };

async function lerConfigAssinatura() {
  if (Date.now() - cacheAssinatura.em < CACHE_MS) return cacheAssinatura;
  try {
    const rows = await rest(
      `qs_settings?select=key,value&key=in.(${WA_SIGNATURE_MAP_KEY},${WA_SIGNATURE_ENABLED_KEY})`
    );
    const porChave = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
    const mapa = porChave[WA_SIGNATURE_MAP_KEY];
    cacheAssinatura = {
      em: Date.now(),
      mapa: mapa && typeof mapa === 'object' ? mapa : null,
      ligada: porChave[WA_SIGNATURE_ENABLED_KEY] !== false,
    };
  } catch (e) {
    // Banco fora do ar não pode impedir o SDR de responder o cliente: segue com
    // o padrão (ligada, nome do cadastro) e tenta de novo na próxima.
    console.warn('[wa] config de assinatura indisponível:', e?.message);
    cacheAssinatura = { em: Date.now(), mapa: null, ligada: true };
  }
  return cacheAssinatura;
}

/**
 * Como este usuário assina. Lê o mapa das Configurações; volta pro nome curto do
 * cadastro quando não houver nada mapeado. String vazia = não assina.
 */
export async function signatureName(user) {
  if (!user?.id) return '';
  const { mapa } = await lerConfigAssinatura();
  const escolhido = mapa?.[user.id];
  // Mapeado como "" de propósito = este usuário não assina.
  if (typeof escolhido === 'string') return escolhido.trim();
  return nomeCurto(user.name);
}

/** A assinatura está ligada? (padrão: sim) */
export async function signatureEnabled() {
  const { ligada } = await lerConfigAssinatura();
  return ligada;
}

/**
 * Carimba o nome como primeira linha, em negrito do WhatsApp:
 *
 *   *Victor Hugo*
 *   Oi João, tudo bem?
 *
 * Idempotente: reenviar um texto que já está assinado com o mesmo nome não
 * empilha duas assinaturas (acontece quando o SDR copia e cola a própria
 * mensagem anterior).
 */
export function assinarTexto(text, nome) {
  const corpo = String(text ?? '');
  const assinatura = String(nome || '').trim();
  if (!assinatura) return corpo;
  const primeiraLinha = corpo.split('\n', 1)[0].trim();
  if (primeiraLinha === `*${assinatura}*`) return corpo;
  return corpo ? `*${assinatura}*\n${corpo}` : `*${assinatura}*`;
}

/** Atalho: resolve o nome e assina, respeitando o liga/desliga. */
export async function assinarComoUsuario(text, user) {
  const { ligada } = await lerConfigAssinatura();
  if (!ligada) return String(text ?? '');
  return assinarTexto(text, await signatureName(user));
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
/** A chave de UM número já isolado. DDD + 8 dígitos, sem 55 e sem o 9º. */
function chaveDeUmNumero(d) {
  if (!d) return null;
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10) return null;
  const ddd = d.slice(0, 2);
  let rest = d.slice(2);
  if (rest.length === 9 && rest.startsWith('9')) rest = rest.slice(1);
  if (rest.length !== 8) return null;
  return ddd + rest;
}

/**
 * Candidatos de telefone dentro de um campo que pode ter MAIS DE UM.
 *
 * O Bitrix manda o telefone como lista, e o campo chega assim:
 *
 *     " 5519993152056,  551993152056"    ← o mesmo número com e sem o 9º dígito
 *     "5547999689893554799689893"        ← dois números COLADOS, sem separador
 *
 * O segundo caso é obra nossa: o normalizador antigo fazia
 * `replace(/\D/g,'')` na string inteira e grudava os dois. Medido em produção:
 * 57 leads assim — e mensagem de WhatsApp desses leads NUNCA vinculava, porque a
 * chave dava null e o webhook descartava em silêncio.
 */
function candidatosDeTelefone(raw) {
  const bruto = String(raw ?? '');
  const fora = [];

  // 1) separadores explícitos (vírgula, ponto e vírgula, barra, quebra de linha)
  for (const p of bruto.split(/[,;/|\n\r]+/)) {
    const d = onlyDigits(p);
    if (d) fora.push(d);
  }

  // 2) grudados: uma sequência longa demais pra ser um número só. Tenta os
  //    tamanhos plausíveis do começo — 13 (55+DDD+9), 12, 11 (DDD+9), 10.
  for (const d of [...fora]) {
    if (d.length > 13) {
      for (const n of [13, 12, 11, 10]) fora.push(d.slice(0, n));
    }
  }

  return fora;
}

/**
 * Chave canônica do telefone (DDD + 8 dígitos). Tolera campo com vários números:
 * devolve a chave do PRIMEIRO que for válido.
 */
export function waKey(raw) {
  const cands = candidatosDeTelefone(raw);
  for (const cand of cands) {
    const k = chaveDeUmNumero(cand);
    if (k) return k;
  }

  // Número de fora do Brasil (Portugal, Alemanha, Paraguai — clientes reais de
  // uma agência de viagens). A regra brasileira não serve, mas a comparação
  // continua valendo: os dois lados passam por aqui, então basta uma chave
  // ESTÁVEL. Prefixo "i:" pra nunca colidir com uma chave de DDD+8.
  const internacional = cands.filter((d) => d.length >= 10 && d.length <= 15).sort((a, b) => b.length - a.length)[0];
  return internacional ? `i:${internacional}` : null;
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
  // Espelha `qs_owns_lead` da migration 0029: as duas regras têm que andar juntas.
  //
  // Só o handover MAIS RECENTE conta. Antes bastava existir qualquer passagem
  // histórica em nome do usuário, o que dava acesso vitalício: um lead que rodou
  // por três donos ficava legível pelos três, para sempre.
  try {
    const ultimo = await rest(
      `qs_handovers?select=from_user_id&lead_id=eq.${encodeURIComponent(leadId)}` +
      `&order=created_at.desc&limit=1`
    );
    if (Array.isArray(ultimo) && ultimo[0]?.from_user_id === userId) {
      return { ok: true, lead, user };
    }
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

/**
 * Acha a conversa do contato. Com `inboxId`, procura a conversa DAQUELE número —
 * é o que permite o SDR escolher por qual número falar: no Chatwoot cada conversa
 * pertence a uma caixa só, então trocar de número é trocar de conversa.
 */
export async function pickConversation(contactId, inboxId = null) {
  try {
    const { payload = [] } = await cw(`/contacts/${contactId}/conversations`);
    let convs = Array.isArray(payload) ? payload : [];
    if (inboxId != null) convs = convs.filter((c) => Number(c.inbox_id) === Number(inboxId));
    else if (WA_INBOX_IDS.length) convs = convs.filter((c) => WA_INBOX_IDS.includes(c.inbox_id));
    convs.sort((a, b) => (b.last_activity_at || 0) - (a.last_activity_at || 0));
    return convs.find((c) => c.status && c.status !== 'resolved') || convs[0] || null;
  } catch (e) {
    console.warn('[wa] contact conversations:', e?.message);
    return null;
  }
}

/** Envio multipart (mídia). O cw() normal manda JSON e não serve aqui. */
// REGRA: este timeout tem que ser MENOR que o maxDuration da rota no
// vercel.json (hoje 60s pra wa-send-media). Se for maior, o AbortController
// nunca dispara, a Vercel mata a função no meio, e o SDR vê "não consegui
// enviar" com o arquivo JÁ entregue — e reenvia. Mexeu num, mexa no outro.
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
export async function ensureConversation(lead, inboxEscolhida = null) {
  const phone = toE164BR(lead.phone);
  if (!phone) return { error: 'lead-sem-telefone' };

  const inboxId = inboxEscolhida != null ? Number(inboxEscolhida) : defaultInboxId();
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

  const existing = await pickConversation(contact.id, inboxId);
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

/**
 * Só deixa enviar por uma caixa que a configuração autoriza. Sem isto, um pedido
 * adulterado mandaria mensagem por qualquer caixa da conta — inclusive a do
 * widget do site, onde ela nunca chegaria no WhatsApp e ninguém veria o erro.
 * Devolve o id validado, ou null se o pedido for inválido.
 */
export function inboxPermitida(id) {
  if (id == null || id === '') return defaultInboxId();
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (WA_INBOX_IDS.length && !WA_INBOX_IDS.includes(n)) return null;
  return n;
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
