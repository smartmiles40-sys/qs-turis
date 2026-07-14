// api/bitrix-sync.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/bitrix-sync
// PROXY autenticado do sync QS → Bitrix (webhooks do n8n).
//
// Por que existe: antes o navegador chamava o n8n DIRETO (VITE_N8N_SYNC_BASE no
// bundle + webhooks sem auth) — qualquer visitante podia extrair a URL e mover
// negócios no Bitrix. Agora a URL do n8n e o segredo ficam SÓ no servidor.
//
// Body (JSON): { "event": "perdido"|"ganho"|"reuniao"|"nota", ...payload }
//   → encaminhado para `${N8N_SYNC_BASE}/qs-<event>` com o header
//     x-qs-sync-secret = N8N_SYNC_SECRET (validar no nó Webhook do n8n).
//
// Segurança (igual ao chatapp-send, fail-closed):
//   1. Servidor-a-servidor: header x-internal-secret = INTERNAL_API_SECRET.
//   2. Usuário logado no QS: Authorization: Bearer <access_token Supabase>.
//
// Env (Vercel): N8N_SYNC_BASE (sem barra final), N8N_SYNC_SECRET.
// Sem N8N_SYNC_BASE → responde { code: "not_configured" } e o front ignora.
// -----------------------------------------------------------------------------

const EVENTS = new Set(['perdido', 'ganho', 'reuniao', 'nota']);

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
