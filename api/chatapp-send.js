// api/chatapp-send.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/chatapp-send
// Envia uma mensagem de texto para UM lead específico via ChatApp.
//
// Body esperado (JSON):
//   { "phone": "5511999998888", "text": "Olá! ..." }
//   ou
//   { "chatId": "5511999998888@c.us", "text": "Olá! ..." }
//
// Segurança — a rota aceita DUAS formas de autorização:
//   1. Servidor-a-servidor: header x-internal-secret = INTERNAL_API_SECRET.
//   2. Usuário logado no QS: header Authorization: Bearer <access_token do
//      Supabase Auth> — validado no endpoint /auth/v1/user do Supabase. É assim
//      que o botão "Enviar pelo ChatApp" do app envia direto.
// -----------------------------------------------------------------------------

import { sendMessageToLead, ChatAppError } from './_chatapp.js';

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

  // Autorização: segredo interno OU usuário autenticado do QS — SEMPRE exigida.
  // (Antes, sem INTERNAL_API_SECRET configurado na Vercel, a checagem inteira era
  // pulada e QUALQUER pessoa na internet podia mandar WhatsApp pelo número da
  // agência. Agora fail-CLOSED: sem secret, só o caminho de usuário autenticado.)
  const secret = process.env.INTERNAL_API_SECRET;
  const bySecret = Boolean(secret) && req.headers['x-internal-secret'] === secret;
  const byUser = !bySecret && (await isValidSupabaseUser(req.headers['authorization']));
  if (!bySecret && !byUser) {
    return res.status(401).json({ success: false, error: 'Não autorizado' });
  }

  // O body pode chegar como objeto (Vercel já parseia JSON) ou string.
  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const { phone, chatId, text } = body;

  if (!text || (!phone && !chatId)) {
    return res.status(400).json({
      success: false,
      error: 'Envie { text } e ({ phone } ou { chatId })',
    });
  }

  try {
    const data = await sendMessageToLead({ phone, chatId, text });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    const status = err instanceof ChatAppError ? err.status || 500 : 500;
    // Log no servidor pra depurar (aparece nos logs da Vercel), sem vazar detalhes sensíveis pro cliente.
    console.error('[chatapp-send]', err.code || '', err.message);
    return res.status(status).json({
      success: false,
      error: err.message || 'Falha ao enviar mensagem',
      code: err.code,
    });
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
