// api/mkt-instagram.js
// -----------------------------------------------------------------------------
// Webhook do INSTAGRAM do Marketing (objeto `instagram`: comments, messages,
// mentions…). 30/10/2026. Separado do /api/wa-calls de propósito: aquele é o
// webhook do WhatsApp (Comercial/Rel/Marketing) e não pode ser tocado.
//
//   GET  → handshake da Meta (hub.verify_token = MKT_IG_VERIFY_TOKEN)
//   POST → assinatura X-Hub-Signature-256 com MKT_IG_APP_SECRET (o app do
//          Instagram) ou META_CALLS_APP_SECRET (o app do QS). Nenhum
//          configurado = recusa (falha FECHADA).
//
// Desligado (mkt_auto_config.instagram.ligado=false): responde 200 e ignora —
// a Meta desativa webhook que responde erro por muito tempo.
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import { processarWebhookInstagram } from './_mktInstagram.js';

export const config = { api: { bodyParser: false } };

async function corpoCru(req) {
  const partes = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > 1_000_000) throw new Error('corpo grande demais');
    partes.push(c);
  }
  return Buffer.concat(partes);
}

export function assinaturaConfere(raw, cabecalho, segredo) {
  const h = String(cabecalho || '');
  if (!h.startsWith('sha256=') || !segredo) return false;
  const a = Buffer.from(h.slice(7), 'hex');
  const b = crypto.createHmac('sha256', segredo).update(raw).digest();
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const token = String(process.env.MKT_IG_VERIFY_TOKEN || '').trim();
    const q = req.query || {};
    if (token && q['hub.mode'] === 'subscribe' && String(q['hub.verify_token']) === token) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(String(q['hub.challenge'] ?? ''));
    }
    if (!q['hub.mode']) return res.status(200).json({ ok: true, servico: 'qs/mkt-instagram', verifyToken: Boolean(token) });
    return res.status(403).send('forbidden');
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET ou POST' });
  }
  const segredos = [process.env.MKT_IG_APP_SECRET, process.env.META_CALLS_APP_SECRET].map((s) => String(s || '').trim()).filter(Boolean);
  if (!segredos.length) return res.status(503).json({ error: 'Chave secreta do app não configurada.' });
  let raw;
  try { raw = await corpoCru(req); } catch { return res.status(400).json({ error: 'corpo invalido' }); }
  if (!raw.length && req.body != null) raw = Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body), 'utf8');
  if (!segredos.some((s) => assinaturaConfere(raw, req.headers['x-hub-signature-256'], s))) {
    console.warn('[mkt-instagram] assinatura não confere');
    return res.status(401).json({ error: 'assinatura invalida' });
  }
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.status(200).json({ ok: true, ignorado: 'json' }); }
  const r = await processarWebhookInstagram(payload).catch((e) => ({ erros: [e?.message] }));
  if (r?.erros?.length) console.error('[mkt-instagram] erros:', r.erros.slice(0, 5));
  return res.status(200).json({ ok: true, ...(r?.desligado ? { desligado: true } : {}) });
}
