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
// Segurança: se a env INTERNAL_API_SECRET estiver setada, a rota exige o header
//   x-internal-secret com esse valor. Assim ninguém de fora dispara mensagens.
// -----------------------------------------------------------------------------

import { sendMessageToLead, ChatAppError } from './_chatapp.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Use POST' });
  }

  // Proteção opcional por segredo compartilhado.
  const secret = process.env.INTERNAL_API_SECRET;
  if (secret && req.headers['x-internal-secret'] !== secret) {
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
