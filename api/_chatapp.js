// api/_chatapp.js
// -----------------------------------------------------------------------------
// Cliente do ChatApp (https://api.chatapp.online) para uso NO SERVIDOR.
//
// Por que no servidor (serverless) e não no browser?
//  - O token de acesso NÃO pode ficar exposto no front (qualquer um copiaria e
//    mandaria mensagem em nome da agência).
//  - A doc não garante CORS, então chamada direta do browser provavelmente falha.
//  - Há limite de 100 tokens/dia por email+appId, então cacheamos o token aqui.
//
// Arquivos começando com "_" dentro de /api NÃO viram rota pública na Vercel —
// isto é só um módulo auxiliar, importado por api/chatapp-send.js.
// -----------------------------------------------------------------------------

const BASE_URL = (process.env.CHATAPP_BASE_URL || 'https://api.chatapp.online').replace(/\/$/, '');

// Configuração vinda das Environment Variables (Vercel) / .env local.
function config() {
  return {
    email: process.env.CHATAPP_EMAIL,
    password: process.env.CHATAPP_PASSWORD,
    appId: process.env.CHATAPP_APP_ID,
    licenseId: process.env.CHATAPP_LICENSE_ID,
    // grWhatsApp | telegram | whatsApp | max ... (ver doc). Default = WhatsApp via GreenAPI.
    messenger: process.env.CHATAPP_MESSENGER || 'grWhatsApp',
  };
}

// ⚠️ ÚNICO CAMPO A CONFIRMAR: a doc renderizada não mostrou o corpo do
// endpoint messages-text. Pelo nome do endpoint e convenção da API, o campo do
// texto é "text". Se ao enviar der erro de validação, troque aqui por "body"
// ou "message" (é o único lugar que muda).
const MESSAGE_TEXT_FIELD = 'text';

// -----------------------------------------------------------------------------
// Chamada genérica: trata o envelope { success, data, error } da API.
// -----------------------------------------------------------------------------
async function callApi(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = token; // token CRU, sem "Bearer"

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let json;
  try {
    json = await res.json();
  } catch {
    throw new ChatAppError(`Resposta não-JSON do ChatApp (HTTP ${res.status})`, res.status);
  }

  if (!res.ok || json?.success === false) {
    const code = json?.error?.code || `HTTP_${res.status}`;
    const message = json?.error?.message || 'Erro desconhecido do ChatApp';
    throw new ChatAppError(message, res.status, code);
  }
  return json.data;
}

class ChatAppError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ChatAppError';
    this.status = status;
    this.code = code;
  }
}

// -----------------------------------------------------------------------------
// Token com cache em memória (dura enquanto a instância serverless estiver quente).
// Renova sozinho quando faltar < 5 min pro fim. Respeita o limite de 100/dia.
// Produção com muito tráfego: dá pra persistir esse token no Supabase (o app já
// usa Supabase) pra sobreviver a cold starts — ver CHATAPP.md.
// -----------------------------------------------------------------------------
let tokenCache = { accessToken: null, expiresAt: 0 };

async function getAccessToken() {
  const { email, password, appId } = config();
  if (!email || !password || !appId) {
    throw new ChatAppError('Faltam CHATAPP_EMAIL / CHATAPP_PASSWORD / CHATAPP_APP_ID nas variáveis de ambiente', 500, 'CONFIG');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (tokenCache.accessToken && nowSec < tokenCache.expiresAt - 300) {
    return tokenCache.accessToken;
  }

  const data = await callApi('/v1/tokens', {
    method: 'POST',
    body: { email, password, appId },
  });

  tokenCache = {
    accessToken: data.accessToken,
    // accessTokenEndTime vem em segundos (unix). Fallback: 23h.
    expiresAt: data.accessTokenEndTime || nowSec + 23 * 3600,
  };
  return tokenCache.accessToken;
}

// Se um token cacheado expirar antes da hora, limpamos e tentamos de novo 1x.
async function withAuth(fn) {
  try {
    return await fn(await getAccessToken());
  } catch (err) {
    if (err instanceof ChatAppError && err.status === 401) {
      tokenCache = { accessToken: null, expiresAt: 0 };
      return await fn(await getAccessToken());
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Telefone -> chatId. Ex.: "5511999998888" -> "5511999998888@c.us" (WhatsApp).
// Passamos só dígitos (a API espera o número, sem +, espaços ou traços).
// -----------------------------------------------------------------------------
function onlyDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

async function resolveChatId(phone) {
  const { licenseId, messenger } = config();
  const num = onlyDigits(phone);
  if (!num) throw new ChatAppError('Telefone vazio/inválido', 400, 'BAD_PHONE');

  const data = await withAuth((token) =>
    callApi(`/v1/licenses/${licenseId}/messengers/${messenger}/phones/${num}/check`, { token })
  );

  if (!data?.exist || !data?.chatId) {
    throw new ChatAppError(`Número ${num} não está registrado no ${messenger}`, 404, 'NOT_ON_MESSENGER');
  }
  return data.chatId;
}

async function sendText(chatId, text) {
  const { licenseId, messenger } = config();
  return withAuth((token) =>
    callApi(`/v1/licenses/${licenseId}/messengers/${messenger}/chats/${chatId}/messages-text`, {
      method: 'POST',
      token,
      body: { [MESSAGE_TEXT_FIELD]: text },
    })
  );
}

// -----------------------------------------------------------------------------
// Função de alto nível usada pela rota: manda "text" pro lead.
// Aceita chatId direto (mais rápido) OU phone (resolve o chatId antes).
// -----------------------------------------------------------------------------
export async function sendMessageToLead({ phone, chatId, text }) {
  if (!text || !String(text).trim()) {
    throw new ChatAppError('Mensagem (text) é obrigatória', 400, 'EMPTY_TEXT');
  }
  const id = chatId || (await resolveChatId(phone));
  const result = await sendText(id, text);
  return { chatId: id, result };
}

export { getAccessToken, resolveChatId, sendText, ChatAppError, config, BASE_URL };
