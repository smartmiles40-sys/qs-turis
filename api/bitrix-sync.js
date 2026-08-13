// api/bitrix-sync.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/bitrix-sync
// PROXY autenticado do sync QS → Bitrix (webhooks do n8n).
//
// Por que existe: antes o navegador chamava o n8n DIRETO (VITE_N8N_SYNC_BASE no
// bundle + webhooks sem auth) — qualquer visitante podia extrair a URL e mover
// negócios no Bitrix. Agora a URL do n8n e o segredo ficam SÓ no servidor.
//
// Body (JSON): { "event": "perdido"|"ganho"|"reuniao"|"nota"|"primeiro-contato", "lead_id": uuid, ...payload }
//   → encaminhado para `${N8N_SYNC_BASE}/qs-<event>` com o header
//     x-qs-sync-secret = N8N_SYNC_SECRET (validar no nó Webhook do n8n).
//   O `bitrix_id` é resolvido AQUI a partir do lead_id (qs_leads via service
//   role) — o valor enviado pelo cliente é ignorado. Lead sem bitrix_id → skip
//   silencioso ({ success: true, code: "skipped_no_bitrix_id" }).
//
// Segurança (igual ao chatapp-send, fail-closed):
//   1. Servidor-a-servidor: header x-internal-secret = INTERNAL_API_SECRET.
//   2. Usuário logado no QS: Authorization: Bearer <access_token Supabase>.
//
// Env (Vercel): N8N_SYNC_BASE (sem barra final), N8N_SYNC_SECRET.
// Sem N8N_SYNC_BASE → responde { code: "not_configured" } e o front ignora.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';

// 'primeiro-contato' (2026-07-28): o SDR conclui a 1ª atividade no QS e o negócio
// anda sozinho de "Novo lead" para "Follow-up 1" no Bitrix. Quem decide se move é
// o n8n (só move o que ainda está em Novo lead) — aqui é só o repasse.
const EVENTS = new Set(['perdido', 'ganho', 'reuniao', 'nota', 'primeiro-contato']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Devolve o ID do usuário autenticado (ou null). Antes esta função devolvia um
 * BOOLEANO e a identidade era jogada fora — então qualquer pessoa logada movia
 * o negócio de QUALQUER lead no Bitrix, inclusive marcando como ganho/perdido o
 * lead de outro SDR. Precisamos do id para checar a posse mais abaixo.
 */
async function getSupabaseUserId(authHeader) {
  const jwt = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
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

/** Este usuário pode mexer neste lead? Mesma regra da RLS (0007/0022). */
async function podeMexerNoLead(userId, leadId) {
  const [users, leads] = await Promise.all([
    rest(`qs_users?select=role,is_active&id=eq.${encodeURIComponent(userId)}&limit=1`),
    rest(`qs_leads?select=owner_id&id=eq.${encodeURIComponent(leadId)}&limit=1`),
  ]);
  const user = (Array.isArray(users) && users[0]) || null;
  const lead = (Array.isArray(leads) && leads[0]) || null;
  if (!user || user.is_active === false) return { ok: false, reason: 'usuario-invalido' };
  if (!lead) return { ok: false, reason: 'lead-inexistente' };
  if (user.role === 'admin' || user.role === 'gestor') return { ok: true };
  if (lead.owner_id === userId || lead.owner_id == null) return { ok: true };
  return { ok: false, reason: 'lead-de-outro-sdr' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Use POST' });
  }

  // Autorização SEMPRE exigida (fail-closed).
  const secret = process.env.INTERNAL_API_SECRET;
  const bySecret = segredoConfere(req.headers['x-internal-secret'], secret);
  const userId = bySecret ? null : await getSupabaseUserId(req.headers['authorization']);
  if (!bySecret && !userId) {
    return res.status(401).json({ success: false, error: 'Não autorizado' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const { event, ...payload } = body;
  if (!EVENTS.has(event)) {
    return res.status(400).json({ success: false, error: 'event inválido (perdido|ganho|reuniao|nota|primeiro-contato)' });
  }

  // bitrix_id NUNCA vem do cliente (auditoria 2026-07-14): qualquer usuário
  // logado podia apontar o evento pra um deal ARBITRÁRIO do Bitrix. Agora o
  // servidor resolve o bitrix_id a partir do lead_id, na fonte da verdade
  // (qs_leads, via service_role), e ignora o que veio no payload.
  const leadId = String(payload.lead_id || '').trim();
  if (!UUID_RE.test(leadId)) {
    return res.status(400).json({ success: false, error: 'lead_id inválido (esperado UUID)' });
  }

  // A correção de 14/07 fechou o bitrix_id (o servidor resolve), mas o lead_id
  // continuava livre: um SDR podia marcar como ganho/perdido no Bitrix o negócio
  // de um lead que não é dele — e forjar closed_value junto. Agora a posse é
  // conferida no banco, com a mesma regra da RLS. O caminho do segredo interno
  // (n8n) segue sem essa checagem, de propósito: lá não existe "usuário".
  if (userId) {
    let posse;
    try {
      posse = await podeMexerNoLead(userId, leadId);
    } catch (err) {
      console.error('[bitrix-sync] falha ao checar posse do lead', leadId, ':', err?.message);
      return res.status(502).json({ success: false, error: 'Falha ao validar o lead' });
    }
    if (!posse.ok) {
      console.warn('[bitrix-sync] recusado:', userId, '→', leadId, `(${posse.reason})`);
      const status = posse.reason === 'lead-inexistente' ? 404 : 403;
      return res.status(status).json({ success: false, error: 'Sem acesso a este lead', motivo: posse.reason });
    }
  }

  let serverBitrixId = null;
  try {
    const rows = await rest(`qs_leads?select=bitrix_id&id=eq.${encodeURIComponent(leadId)}&limit=1`);
    serverBitrixId = (rows && rows[0] && rows[0].bitrix_id) || null;
  } catch (err) {
    console.error('[bitrix-sync] falha ao resolver bitrix_id do lead', leadId, ':', err?.message);
    return res.status(502).json({ success: false, error: 'Falha ao consultar o lead' });
  }
  if (!serverBitrixId) {
    // Lead sem vínculo com o Bitrix (não veio de lá) — mesmo comportamento de
    // sempre: pula sem erro (o front já pulava quando não tinha bitrix_id).
    return res.status(200).json({ success: true, code: 'skipped_no_bitrix_id' });
  }
  payload.bitrix_id = serverBitrixId; // sobrescreve qualquer valor do cliente

  const base = (process.env.N8N_SYNC_BASE || '').trim().replace(/\/+$/, '');
  if (!base) {
    // Integração ainda não configurada — no-op declarado (o front não mostra erro).
    return res.status(200).json({ success: false, code: 'not_configured' });
  }

  // Manda os DOIS nomes de header, com o mesmo segredo.
  //
  // Por quê: o n8n valida NOME + valor. Como os sete webhooks dividem uma única
  // credencial de Header Auth, o nome dela vira uma variável global — e em 07/08
  // isso derrubou a integração quatro vezes seguidas, porque arrumar o
  // sincronismo quebrava a agenda e vice-versa, dependendo de qual nome estava
  // salvo naquele momento.
  //
  // Mandando os dois, o nome deixa de importar: qualquer que seja o configurado,
  // a requisição carrega. Sobra uma única coisa para acertar — o VALOR. Header a
  // mais é ignorado por quem não o espera, então não há custo.
  const headers = { 'Content-Type': 'application/json' };
  const sync = (process.env.N8N_SYNC_SECRET || '').trim();
  const agenda = (process.env.N8N_AGENDA_SECRET || '').trim();
  if (sync || agenda) {
    headers['x-qs-sync-secret'] = sync || agenda;
    headers['x-qs-agenda-secret'] = agenda || sync;
  }

  // Timeout: n8n lento não pode segurar a função até o limite da Vercel.
  // 7s, não 10s: o maxDuration da rota É 10s e a autenticação que roda antes
  // gasta até 5s — timeout igual ao teto significa que a Vercel mata a função
  // ANTES do abort disparar (a regra de _wa.js: o timeout do fetch tem que ser
  // MENOR que o maxDuration, senão ele nunca age).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7_000);
  try {
    const r = await fetch(`${base}/qs-${event}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event, ...payload }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.error('[bitrix-sync] n8n respondeu', r.status, 'para', event);
      return res.status(502).json({ success: false, error: `n8n HTTP ${r.status}` });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[bitrix-sync]', event, err?.name === 'AbortError' ? 'timeout 7s' : err?.message);
    return res.status(502).json({ success: false, error: 'Falha ao falar com o n8n' });
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
