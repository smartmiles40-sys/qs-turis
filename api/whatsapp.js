// api/whatsapp.js
// -----------------------------------------------------------------------------
// O LINK DE WHATSAPP DAS PÁGINAS (Bruno, 29/09/2026: "vamos tirar o 1935 das
// páginas! Obrigatoriamente ele deve passar pela API e distribuir para os SDRs").
//
// Antes, todo botão das páginas era `wa.me/5511951251935` e o distribuidor.js
// trocava o número no clique — se o script não carregasse, o lead caía no 1935.
// Agora o botão aponta PRA CÁ:
//
//   https://qs-turis.vercel.app/api/whatsapp?text=<mensagem>&o=<origem>
//
// e esta rota decide o SDR no servidor (mesma roda `fila:forms` das LPs, via
// sdr_da_vez) e responde 302 pro wa.me DELE. Não depende de JavaScript na
// página. Se o banco falhar, vai pro chip de um SDR sorteado (_numeroReserva.js).
// Não há caminho que termine no 1935.
//
// GET, sem segredo, de propósito: é um link. Contenções: teto por IP (o mesmo
// do /api/lead) e robô/pré-visualização de link não gira a roda.
// -----------------------------------------------------------------------------
import { createHash } from 'node:crypto';
import { rest } from './_supabaseAdmin.js';
import { numeroReserva, numeroValido } from './_numeroReserva.js';

const MSG_PADRAO = 'Quero seguir os próximos passos';
const RPC_TIMEOUT_MS = 3500;
const TETO_PADRAO = 20;

// Pré-visualização de link (WhatsApp, Facebook, Slack…) e buscadores abrem o
// link sozinhos. Se girassem a roda, um SDR "receberia" lead que não existe.
const ROBO = /bot|crawl|spider|slurp|preview|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|linkedin|skype|embedly|headless|lighthouse/i;

function chaveIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xff || req.socket?.remoteAddress || '';
  if (!ip) return '';
  const sal = process.env.LEAD_INBOUND_SECRET || 'qs-lp';
  return createHash('sha256').update(`${sal}:${ip}`).digest('hex').slice(0, 32);
}

function texto(v, max) {
  if (v == null) return null;
  // eslint-disable-next-line no-control-regex
  const s = String(Array.isArray(v) ? v[0] : v).replace(/[\x00-\x1F\x7F]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

// De onde veio o clique: `o` explícito, senão host+caminho do Referer.
function origemDo(req) {
  const o = texto(req.query?.o, 70);
  if (o) return o;
  try {
    const u = new URL(String(req.headers.referer || ''));
    return (u.hostname + u.pathname).slice(0, 70);
  } catch {
    return null;
  }
}

async function tetoPorIp(req) {
  try {
    const chave = chaveIp(req);
    if (!chave) return true;
    const rows = await rest('qs_settings?select=value&key=eq.lp_rate_limit', { timeoutMs: 1500 }).catch(() => null);
    const v = Number(rows?.[0]?.value);
    const teto = Number.isFinite(v) ? v : TETO_PADRAO;
    const ok = await rest('rpc/qs_lp_rate_bump', {
      method: 'POST',
      body: { p_chave: chave, p_teto: teto },
      timeoutMs: 2000,
    });
    return ok !== false;
  } catch {
    return true; // falha aberta: contador fora do ar não pode travar lead
  }
}

async function decidir(req) {
  const ua = String(req.headers['user-agent'] || '');
  if (!ua || ROBO.test(ua)) return numeroReserva();
  if (!(await tetoPorIp(req))) return numeroReserva();
  try {
    const origem = origemDo(req);
    const linhas = await rest('rpc/sdr_da_vez', {
      method: 'POST',
      body: { p_origem: origem ? `link:${origem}` : 'link', p_fila: 'forms' },
      timeoutMs: RPC_TIMEOUT_MS,
    });
    const r = Array.isArray(linhas) ? linhas[0] : linhas;
    const numero = r && numeroValido(r.numero);
    if (numero) return numero;
    console.warn('[whatsapp] sem SDR válido no rodízio — chip reserva');
  } catch (err) {
    console.error('[whatsapp]', err?.code || '', err?.message || err);
  }
  return numeroReserva();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const msg = texto(req.query?.text, 1000) || MSG_PADRAO;
  const numero = await decidir(req);

  if (!numero) {
    // Nenhum SDR com chip ativo e nenhum reserva válido. Melhor pedir um
    // instante do que mandar pro 1935.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(503).send(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Um instante</title><body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 24px;color:#09282B">' +
      '<h1 style="font-size:22px">Estamos conectando você ao nosso time</h1>' +
      '<p>Tente de novo em alguns segundos.</p>' +
      '<p><a href="javascript:location.reload()" style="color:#09282B;font-weight:600">Tentar de novo</a></p></body>'
    );
  }

  res.setHeader('Location', `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`);
  return res.status(302).end();
}
