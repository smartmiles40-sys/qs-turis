// api/_mktEmailResend.js
// -----------------------------------------------------------------------------
// E-MAIL MARKETING (0245) — falar com o Resend por fetch (sem dependência) e ler
// a configuração. Segredos (chave da API, segredo do webhook, chave HMAC) moram
// no Vault (mkt_email_segredo / mkt_email_guardar_segredo, só service_role); o
// resto em mkt_email_config (linha única). Env RESEND_API_KEY /
// RESEND_WEBHOOK_SECRET são só reserva.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { cabecalhosDescadastro, formatarRemetente } from './_mktEmailMontar.js';
import { retryAfterMs } from './_mktEmailRegras.js';

const API = 'https://api.resend.com';

export class EmailError extends Error {
  constructor(mensagem, { permanente = false, status = 0, esperarMs = 0 } = {}) {
    super(mensagem);
    this.name = 'EmailError';
    this.permanente = permanente;
    this.status = status;
    this.esperarMs = esperarMs;
  }
}

// ── Configuração ───────────────────────────────────────────────────────────

let cache = null;
export function esquecerConfig() { cache = null; }

async function segredo(nome) {
  const r = await rest('rpc/mkt_email_segredo', { method: 'POST', body: { p_nome: nome } }).catch(() => null);
  return typeof r === 'string' && r ? r : null;
}

export async function guardarSegredo(nome, valor) {
  await rest('rpc/mkt_email_guardar_segredo', { method: 'POST', body: { p_nome: nome, p_valor: valor } });
  esquecerConfig();
}
export async function apagarSegredo(nome) {
  await rest('rpc/mkt_email_apagar_segredo', { method: 'POST', body: { p_nome: nome } });
  esquecerConfig();
}

/** A URL pública que vai em CADA e-mail. Sem ela o motor para (não chuta). */
export function urlPublica() {
  const u = String(process.env.QS_URL_PUBLICA || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^/]+/.test(u) ? u : null;
}

export async function lerConfig({ fresca = false } = {}) {
  if (!fresca && cache && cache.ate > Date.now()) return cache.v;
  const [linha, chave, webhook, hmac] = await Promise.all([
    rest('mkt_email_config?select=*&id=eq.1&limit=1').then((r) => r?.[0] || {}).catch(() => ({})),
    segredo('resend_api_key'),
    segredo('resend_webhook_secret'),
    segredo('hmac'),
  ]);
  const env = (k) => String(process.env[k] || '').trim() || null;
  const v = {
    ...linha,
    resendKey: chave || env('RESEND_API_KEY'),
    webhookSecret: webhook || env('RESEND_WEBHOOK_SECRET'),
    hmac,
    url: urlPublica(),
  };
  cache = { v, ate: Date.now() + 30_000 };
  return v;
}

export async function gravarConfig(campos) {
  await rest('mkt_email_config?id=eq.1', { method: 'PATCH', body: campos, prefer: 'return=minimal' });
  esquecerConfig();
}

// ── API do Resend ──────────────────────────────────────────────────────────

async function chamar(chave, caminho, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API}${caminho}`, {
      method,
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new EmailError('Não consegui falar com o Resend. Tente de novo.');
  }
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (corpo?.name === 'restricted_api_key') {
      throw new EmailError('Essa chave só tem permissão de ENVIO. Crie uma "Full access" no Resend (API Keys) — é com ela que o QS lê o domínio e cria o webhook.', { permanente: true, status: res.status });
    }
    if (res.status === 401 || res.status === 403) {
      throw new EmailError('O Resend recusou a chave. Confira se copiou inteira (começa com re_).', { permanente: true, status: res.status });
    }
    throw new EmailError(`Resend ${res.status}: ${corpo?.message || corpo?.name || 'erro sem detalhe'}`, {
      // 4xx (menos 429) é pedido errado — repetir não conserta.
      permanente: res.status >= 400 && res.status < 500 && res.status !== 429,
      status: res.status,
      esperarMs: res.status === 429 ? retryAfterMs(res.headers.get('retry-after')) : 0,
    });
  }
  return corpo;
}

export function chaveComFormatoOk(chave) {
  return /^re_[A-Za-z0-9_]{16,}$/.test(String(chave ?? '').trim());
}

export const listarDominios = async (chave) => (await chamar(chave, '/domains'))?.data ?? [];
export const lerDominio = (chave, id) => chamar(chave, `/domains/${encodeURIComponent(id)}`);
export const criarDominio = (chave, nome) => chamar(chave, '/domains', { method: 'POST', body: { name: nome } });
export const pedirVerificacao = (chave, id) => chamar(chave, `/domains/${encodeURIComponent(id)}/verify`, { method: 'POST' });

export const EVENTOS_WEBHOOK = ['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained'];

/** Cria o webhook. O formato do retorno (signing_secret) NÃO foi provado ao vivo — há o caminho de colar o whsec_. */
export const criarWebhook = (chave, endpoint) =>
  chamar(chave, '/webhooks', { method: 'POST', body: { endpoint, events: EVENTOS_WEBHOOK } });

/** Envia UM e-mail. Devolve o id do Resend (vira provider_id, chave do webhook). */
export async function enviarEmail(chave, msg) {
  const corpo = await chamar(chave, '/emails', {
    method: 'POST',
    body: {
      from: formatarRemetente(msg.deNome, msg.de),
      to: [msg.para],
      subject: msg.assunto,
      html: msg.html,
      text: msg.texto,
      ...(msg.responderPara ? { reply_to: msg.responderPara } : {}),
      headers: cabecalhosDescadastro(msg.urlDescadastro),
      ...(msg.tags ? { tags: msg.tags } : {}),
    },
  });
  return corpo?.id ?? null;
}
