// api/bitrix-sync.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/bitrix-sync
// PROXY autenticado do sync QS → Bitrix (webhooks do n8n).
//
// Por que existe: antes o navegador chamava o n8n DIRETO (VITE_N8N_SYNC_BASE no
// bundle + webhooks sem auth) — qualquer visitante podia extrair a URL e mover
// negócios no Bitrix. Agora a URL do n8n e o segredo ficam SÓ no servidor.
//
// Body (JSON): { "event": "perdido"|"ganho"|"reuniao"|"nota", "lead_id": uuid, ...payload }
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

import { rest } from './_supabaseAdmin.js';

const EVENTS = new Set(['perdido', 'ganho', 'reuniao', 'nota']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function isValidSupabaseUser(authHeader) {
  const jwt = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return false;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return false;
    const user = await r.json();
    return Boolean(user && user.id);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Use POST' });
  }

  // Autorização SEMPRE exigida (fail-closed).
  const secret = process.env.INTERNAL_API_SECRET;
  const bySecret = Boolean(secret) && req.headers['x-internal-secret'] === secret;
  const byUser = !bySecret && (await isValidSupabaseUser(req.headers['authorization']));
  if (!bySecret && !byUser) {
    return res.status(401).json({ success: false, error: 'Não autorizado' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const { event, ...payload } = body;
  if (!EVENTS.has(event)) {
    return res.status(400).json({ success: false, error: 'event inválido (perdido|ganho|reuniao|nota)' });
  }

  // bitrix_id NUNCA vem do cliente (auditoria 2026-07-14): qualquer usuário
  // logado podia apontar o evento pra um deal ARBITRÁRIO do Bitrix. Agora o
  // servidor resolve o bitrix_id a partir do lead_id, na fonte da verdade
  // (qs_leads, via service_role), e ignora o que veio no payload.
  const leadId = String(payload.lead_id || '').trim();
  if (!UUID_RE.test(leadId)) {
    return res.status(400).json({ success: false, error: 'lead_id inválido (esperado UUID)' });
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

  const headers = { 'Content-Type': 'application/json' };
  const syncSecret = (process.env.N8N_SYNC_SECRET || '').trim();
  if (syncSecret) headers['x-qs-sync-secret'] = syncSecret;

  // Timeout: n8n lento não pode segurar a função até o limite da Vercel.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
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
    console.error('[bitrix-sync]', event, err?.name === 'AbortError' ? 'timeout 10s' : err?.message);
    return res.status(502).json({ success: false, error: 'Falha ao falar com o n8n' });
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
