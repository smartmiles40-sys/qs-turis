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

import { rest } from './_supabaseAdmin.js';

const BASE_URL = (process.env.CHATAPP_BASE_URL || 'https://api.chatapp.online').replace(/\/$/, '');

// Configuração vinda das Environment Variables (Vercel) / .env local.
// licenseId/messenger podem também vir do registro qs_settings['chatapp_token']
// gravado pelo n8n (ver getSettingsToken) — a env, quando existir, tem prioridade.
function config() {
  return {
    email: process.env.CHATAPP_EMAIL,
    password: process.env.CHATAPP_PASSWORD,
    appId: process.env.CHATAPP_APP_ID,
    licenseId: process.env.CHATAPP_LICENSE_ID || settingsCache.licenseId,
    // grWhatsApp | telegram | whatsApp | max ... (ver doc). Default = WhatsApp via GreenAPI.
    messenger: process.env.CHATAPP_MESSENGER || settingsCache.messenger || 'grWhatsApp',
  };
}

// ⚠️ ÚNICO CAMPO A CONFIRMAR — NUNCA VALIDADO COM ENVIO REAL (sem credencial
// ativa até 2026-07-16). A doc renderizada não mostrou o corpo do endpoint
// messages-text; "text" é dedução pelo nome do endpoint e convenção da API.
//
// COMO VALIDAR (1 envio real, quando o token do n8n estiver ativo em qs_settings):
//   POST https://qs-turis.vercel.app/api/chatapp-send
//   header  x-internal-secret: <INTERNAL_API_SECRET>
//   body    { "phone": "55DDDSEUNUMERO", "text": "teste QS" }
//   → chegou no WhatsApp: campo certo. → erro de validação (400/422): troque
//     abaixo por 'body' ou 'message' e repita (é o ÚNICO lugar que muda).
// Passo a passo também em n8n/README.md (seção do chatapp-token-refresh).
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
// licenseId/messenger vindos do qs_settings (preenchidos junto do token do n8n).
let settingsCache = { licenseId: null, messenger: null };

/**
 * Token mantido pelo n8n em qs_settings (chave 'chatapp_token').
 * O workflow "ChatApp token" renova a cada 6h — assim o QS nunca gera token
 * por conta própria (limite de 100/dia) nem depende das CHATAPP_* na Vercel.
 */
async function getSettingsToken() {
  try {
    const rows = await rest("qs_settings?select=value&key=eq.chatapp_token&limit=1");
    const v = rows && rows[0] && rows[0].value;
    if (!v || !v.accessToken) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (v.expiresAt && nowSec >= v.expiresAt - 300) return null; // vencido/na borda
    if (v.licenseId && String(v.licenseId).indexOf('PREENCHA') === -1) settingsCache.licenseId = v.licenseId;
    if (v.messenger) settingsCache.messenger = v.messenger;
    return { accessToken: v.accessToken, expiresAt: v.expiresAt || nowSec + 3600 };
  } catch (e) {
    console.warn('[chatapp] qs_settings indisponível:', e?.message);
    return null;
  }
}

async function getAccessToken() {
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokenCache.accessToken && nowSec < tokenCache.expiresAt - 300) {
    return tokenCache.accessToken;
  }

  // 1º: token mantido pelo n8n no banco (caminho preferido).
  const fromSettings = await getSettingsToken();
  if (fromSettings) {
    tokenCache = fromSettings;
    return tokenCache.accessToken;
  }

  // 2º: fallback — gerar por credenciais (se existirem nas envs).
  const { email, password, appId } = config();
  if (!email || !password || !appId) {
    throw new ChatAppError(
      'Sem token do ChatApp: ative o workflow "ChatApp token" no n8n (grava em qs_settings) ou preencha CHATAPP_EMAIL / CHATAPP_PASSWORD / CHATAPP_APP_ID',
      500,
      'CONFIG'
    );
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

// O licenseId pode chegar junto do token (qs_settings, preenchido pelo n8n),
// então a config é lida DENTRO do callback autenticado — depois do token.
function requireLicense() {
  const { licenseId, messenger } = config();
  if (!licenseId) {
    throw new ChatAppError('Sem licenseId do ChatApp: preencha no workflow do n8n (chatapp_token.licenseId) ou na env CHATAPP_LICENSE_ID', 500, 'CONFIG');
  }
  return { licenseId, messenger };
}

async function resolveChatId(phone) {
  const num = onlyDigits(phone);
  if (!num) throw new ChatAppError('Telefone vazio/inválido', 400, 'BAD_PHONE');

  const data = await withAuth((token) => {
    const { licenseId, messenger } = requireLicense();
    return callApi(`/v1/licenses/${licenseId}/messengers/${messenger}/phones/${num}/check`, { token });
  });

  if (!data?.exist || !data?.chatId) {
    throw new ChatAppError(`Número ${num} não está registrado no WhatsApp/messenger configurado`, 404, 'NOT_ON_MESSENGER');
  }
  return data.chatId;
}

async function sendText(chatId, text) {
  return withAuth((token) => {
    const { licenseId, messenger } = requireLicense();
    return callApi(`/v1/licenses/${licenseId}/messengers/${messenger}/chats/${chatId}/messages-text`, {
      method: 'POST',
      token,
      body: { [MESSAGE_TEXT_FIELD]: text },
    });
  });
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
