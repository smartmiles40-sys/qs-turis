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
import { rest, insert } from './_supabaseAdmin.js';

// Guard-rails do envio (auditoria 2026-07-14):
//  • MAX_TEXT_CHARS: mensagem gigante não passa (custo/abuso/erro de integração).
//  • Rate limit por USUÁRIO: serverless é stateless, então a contagem vive no
//    banco — tabela qs_message_log (migration 0018). Cada envio é gravado ANTES
//    de chamar o ChatApp; os últimos 5 min são contados a cada requisição.
//    Chamadas pelo segredo interno (n8n) contam num balde próprio (user_id null).
//  • O registro em qs_message_log também dá RASTRO server-side a qualquer
//    chamada direta na rota (antes: nenhum log de quem mandou o quê pra quem).
const MAX_TEXT_CHARS = 4096;
const RATE_LIMIT_MAX = 30;          // envios…
const RATE_LIMIT_WINDOW_MS = 5 * 60_000; // …por janela de 5 minutos

// Devolve o ID do usuário autenticado (Supabase Auth) ou null.
async function getSupabaseUserId(authHeader) {
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

// A tabela de log pode ainda não existir (migration 0018 pendente) — nesse caso
// o envio segue SEM limite, com aviso no log (mesmo padrão defensivo do bitrix_id).
function isMissingTable(err) {
  const code = err?.details?.code || err?.code || '';
  return code === '42P01' || code === 'PGRST205';
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
  // userId = quem envia (pro rate limit e pro log). Segredo interno → null.
  const userId = bySecret ? null : await getSupabaseUserId(req.headers['authorization']);
  if (!bySecret && !userId) {
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

  const textStr = String(text);
  if (textStr.length > MAX_TEXT_CHARS) {
    return res.status(400).json({
      success: false,
      error: `Mensagem longa demais (${textStr.length} caracteres; máx. ${MAX_TEXT_CHARS})`,
      code: 'TEXT_TOO_LONG',
    });
  }

  // Rate limit + log server-side (qs_message_log). O registro entra ANTES do
  // envio: mesmo que o ChatApp falhe, fica o rastro da tentativa.
  const phoneDigits = String(phone || chatId || '').replace(/\D/g, '') || null;
  try {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const who = userId ? `user_id=eq.${encodeURIComponent(userId)}` : 'user_id=is.null';
    const recent = await rest(
      `qs_message_log?select=id&${who}&created_at=gte.${encodeURIComponent(since)}&limit=${RATE_LIMIT_MAX}`
    );
    if (recent && recent.length >= RATE_LIMIT_MAX) {
      return res.status(429).json({
        success: false,
        error: `Limite de envios atingido (${RATE_LIMIT_MAX} a cada 5 min). Aguarde alguns minutos.`,
        code: 'RATE_LIMITED',
      });
    }
    await insert('qs_message_log', { user_id: userId, phone: phoneDigits, chars: textStr.length }, { returning: false });
  } catch (err) {
    if (isMissingTable(err)) {
      console.warn('[chatapp-send] qs_message_log não existe (aplicar migration 0018) — enviando sem rate limit');
    } else {
      // Falha de infra no limitador NÃO derruba o envio (a autorização acima
      // continua fail-closed) — mas fica gritando no log da Vercel.
      console.error('[chatapp-send] falha no rate limit/log:', err?.message);
    }
  }
  // Rastro no log da função (sem o conteúdo da mensagem — LGPD).
  console.log('[chatapp-send] envio:', userId || 'interno(n8n)', '→', phoneDigits || chatId, `(${textStr.length} chars)`);

  try {
    const data = await sendMessageToLead({ phone, chatId, text: textStr });
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
