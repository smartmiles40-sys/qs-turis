// api/mkt-email-publico.js
// -----------------------------------------------------------------------------
// MARKETING › E-MAIL (0245) — as únicas portas que um ESTRANHO usa (sem login):
//
//   GET  ?r=o&t=TOKEN               → pixel de abertura (gif 1x1)
//   GET  ?r=c&t=TOKEN&u=…&s=…       → clique: confere o HMAC, conta, 302 pro destino
//   GET  ?r=u&t=TOKEN               → página com UM botão "Descadastrar" (NÃO descadastra:
//                                     Safe Links/Proofpoint abrem os links sozinhos)
//   POST ?r=u&t=TOKEN               → descadastra (botão ou List-Unsubscribe=One-Click)
//   POST ?r=webhook                 → Resend (Svix): entregue / bounce / spam.
//                                     Sem segredo → 503 (falha FECHADO: senão qualquer um
//                                     marcava a base inteira como bounce)
//
// Token "teste-…" (e-mail de teste) não conta nada nem descadastra.
// A URL desta rota vai embutida em cada e-mail enviado: renomear = quebrar os antigos.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { lerConfig } from './_mktEmailResend.js';
import { destinoDoClique, ehUmCliqueDoProvedor, svixConfere, traduzirEventoResend } from './_mktEmailMontar.js';

// Corpo cru: a assinatura do Svix é sobre os bytes exatos.
export const config = { api: { bodyParser: false } };

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

async function corpoCru(req) {
  const partes = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > 512_000) throw new Error('corpo grande demais');
    partes.push(c);
  }
  return Buffer.concat(partes).toString('utf8');
}

const registrar = (token, tipo, url) =>
  rest('rpc/mkt_email_registrar', { method: 'POST', body: { p_token: token, p_tipo: tipo, p_url: url ?? null } });

const tokenOk = (t) => /^[A-Za-z0-9_-]{16,80}$/.test(String(t || ''));

function pagina(estado) {
  const c = {
    confirmar: ['Sair da lista de e-mails', 'Clique no botão abaixo e você não recebe mais nossos e-mails.'],
    feito: ['Pronto, você saiu da lista', 'Você não vai mais receber nossos e-mails. Se foi sem querer, é só falar com a gente que a inscrição volta.'],
    'nao-encontrado': ['Não encontramos este cadastro', 'O link pode ter expirado ou o descadastro já foi feito antes. De qualquer forma, você não está mais na lista.'],
  }[estado];
  const botao = estado === 'confirmar'
    ? '<form method="post"><input type="hidden" name="confirmar" value="1"><button type="submit">Descadastrar meu e-mail</button></form>'
    : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${c[0]}</title><style>
:root{color-scheme:light dark}*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#F8F6F7;color:#09282B;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}
.cartao{background:#fff;border-radius:16px;padding:36px 32px;max-width:460px;width:100%;box-shadow:0 12px 40px rgba(9,40,43,.10);text-align:center}
h1{margin:0 0 12px;font-size:22px;line-height:1.3}p{margin:0;color:#3F5E5B}form{margin-top:24px}
button{font:inherit;font-weight:600;color:#09282B;background:#D7F264;border:0;border-radius:10px;padding:14px 28px;min-height:48px;width:100%;cursor:pointer}
button:hover{background:#C0E046}button:focus-visible{outline:3px solid #09282B;outline-offset:2px}
.marca{margin-top:26px;font-size:12px;letter-spacing:.14em;color:#6F8F8A}
@media (prefers-color-scheme:dark){body{background:#051C1E;color:#F8F6F7}.cartao{background:#09282B}p{color:#8FAEA9}button:focus-visible{outline-color:#D7F264}}
</style></head><body><main class="cartao"><h1>${c[0]}</h1><p>${c[1]}</p>${botao}
<div class="marca">SE TU FOR, EU VOU! VIAGENS</div></main></body></html>`;
}

function html(res, estado) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(200).send(pagina(estado));
}

export default async function handler(req, res) {
  const q = req.query || {};
  const r = String(q.r || '');
  const t = String(q.t || '');
  const teste = t.startsWith('teste-');

  // ── Pixel ──
  if (r === 'o' && req.method === 'GET') {
    if (!teste && tokenOk(t)) await registrar(t, 'abriu').catch(() => {});
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.status(200).send(GIF);
  }

  // ── Clique ──
  if (r === 'c' && req.method === 'GET') {
    const cfg = await lerConfig().catch(() => ({}));
    const destino = destinoDoClique(cfg.hmac, t, String(q.u || ''), String(q.s || ''));
    if (!destino) return res.status(400).json({ error: 'Link inválido ou adulterado.' });
    if (!teste && tokenOk(t)) await registrar(t, 'clicou', destino).catch(() => {});
    // 302 (não 301): 301 fica no cache e os próximos cliques não passariam por aqui.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', destino);
    return res.status(302).end();
  }

  // ── Descadastro ──
  if (r === 'u') {
    if (req.method === 'GET') return html(res, 'confirmar');
    if (req.method === 'POST') {
      const corpo = await corpoCru(req).catch(() => '');
      let ok = false;
      if (!teste && tokenOk(t)) ok = (await registrar(t, 'descadastrou').catch(() => false)) === true;
      if (ehUmCliqueDoProvedor(corpo)) return res.status(200).send('OK');
      return html(res, ok ? 'feito' : 'nao-encontrado');
    }
    return res.status(405).end();
  }

  // ── Webhook do Resend ──
  if (r === 'webhook' && req.method === 'POST') {
    const corpo = await corpoCru(req).catch(() => '');
    const cfg = await lerConfig().catch(() => ({}));
    if (!cfg.webhookSecret) return res.status(503).json({ error: 'Webhook do Resend não configurado (Marketing › E-mail › Conexão).' });
    const cab = {
      'svix-id': req.headers['svix-id'],
      'svix-timestamp': req.headers['svix-timestamp'],
      'svix-signature': req.headers['svix-signature'],
    };
    if (!svixConfere(corpo, cab, cfg.webhookSecret)) return res.status(401).json({ error: 'assinatura inválida' });
    let p;
    try { p = JSON.parse(corpo); } catch { return res.status(200).json({ ok: true, ignorado: 'corpo inválido' }); }
    const tipo = traduzirEventoResend(String(p?.type || ''));
    const id = p?.data?.email_id;
    if (!tipo || !id) return res.status(200).json({ ok: true, ignorado: p?.type || 'sem tipo' });
    try {
      await rest('rpc/mkt_email_webhook', {
        method: 'POST',
        body: { p_provider_id: String(id), p_tipo: tipo, p_detalhe: p?.data?.bounce?.message || p?.data?.reason || null },
      });
    } catch (e) {
      // Erro nosso não vira erro pro Resend (ele entraria em ciclo de retentativa).
      console.error('[mkt-email-publico] webhook', e?.message);
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(404).json({ error: 'Não encontrado.' });
}
