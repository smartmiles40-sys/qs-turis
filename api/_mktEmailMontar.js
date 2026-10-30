// api/_mktEmailMontar.js
// -----------------------------------------------------------------------------
// E-MAIL MARKETING (0245) — montagem do e-mail que sai para UMA pessoa.
// Tudo puro (sem banco, sem rede): dá pra testar o HTML final inteiro.
//
// Herdado do SendFlow, com as pegadinhas que já custaram caro lá:
//  • link de clique ASSINADO com HMAC — sem isso o nosso domínio vira
//    redirecionador aberto (phishing com a nossa cara);
//  • descadastro fora do rastreamento e por POST (Safe Links abre os links do
//    e-mail sozinho; GET só mostra o botão);
//  • List-Unsubscribe + List-Unsubscribe-Post (Gmail/Yahoo exigem desde 2024);
//  • a URL pública vai embutida em CADA e-mail enviado — trocar depois quebra
//    pixel, cliques e descadastro dos e-mails antigos.
// -----------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from 'node:crypto';

// ── Personalização ─────────────────────────────────────────────────────────

export function escaparHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function primeiroNome(nome) {
  const n = String(nome ?? '').trim();
  return n ? n.split(/\s+/)[0] : '';
}

// Variáveis que a etapa seguinte troca (não são dados da pessoa).
const ESTRUTURAIS = new Set(['descadastro', 'preheader']);

function mapaDaPessoa(p) {
  return {
    nome: String(p.nome ?? '').trim(),
    primeiro_nome: primeiroNome(p.nome),
    email: String(p.email ?? ''),
    ...Object.fromEntries(
      Object.entries(p.campos ?? {})
        .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
        .map(([k, v]) => [k.toLowerCase(), String(v ?? '')]),
    ),
  };
}

/**
 * Troca {{variavel}} pelos dados da pessoa (HTML: valor ESCAPADO). Variável que
 * não existe vira vazio — "Olá {{nome}}," visível é o erro mais constrangedor.
 */
export function personalizar(texto, pessoa, { html = true } = {}) {
  const mapa = mapaDaPessoa(pessoa || {});
  return String(texto ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (inteiro, bruta) => {
    const chave = bruta.trim().toLowerCase();
    if (ESTRUTURAIS.has(chave)) return inteiro;
    if (!(chave in mapa)) return '';
    return html ? escaparHtml(mapa[chave]) : mapa[chave];
  });
}

// ── HMAC dos links ─────────────────────────────────────────────────────────

export function assinar(segredo, texto) {
  if (!segredo) throw new Error('Sem chave HMAC: não dá pra assinar link de e-mail.');
  return createHmac('sha256', segredo).update(String(texto)).digest('base64url');
}

export function assinaturaConfere(segredo, texto, recebida) {
  if (!segredo || !recebida) return false;
  const a = Buffer.from(String(recebida));
  const b = Buffer.from(assinar(segredo, texto));
  return a.length === b.length && timingSafeEqual(a, b);
}

const rota = (base, r, token) => `${base}/api/mkt-email-publico?r=${r}&t=${encodeURIComponent(token)}`;

export function urlDeClique(base, segredo, token, destino) {
  const u = Buffer.from(String(destino), 'utf8').toString('base64url');
  return `${rota(base, 'c', token)}&u=${u}&s=${assinar(segredo, `${token}.${u}`)}`;
}
export const urlDoPixel = (base, token) => rota(base, 'o', token);
export const urlDeDescadastro = (base, token) => rota(base, 'u', token);

/**
 * Confere um clique. Devolve o destino (http/https) ou null. Na dúvida, recusa:
 * clique não contado é KPI impreciso; redirecionador aberto é incidente.
 */
export function destinoDoClique(segredo, token, u, s) {
  if (!token || !u || !s) return null;
  if (!assinaturaConfere(segredo, `${token}.${u}`, s)) return null;
  try {
    const destino = Buffer.from(String(u), 'base64url').toString('utf8');
    const url = new URL(destino);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return destino;
  } catch {
    return null;
  }
}

const NAO_RASTREAR = /^(mailto:|tel:|sms:|#|\{\{|data:|javascript:)/i;

/** Reescreve os href http(s) para o redirecionador assinado. Descadastro fica de fora. */
export function reescreverLinks(html, { base, segredo, token }) {
  return String(html).replace(/href\s*=\s*(["'])(.*?)\1/gi, (inteiro, aspas, url) => {
    const limpa = url.trim();
    if (!limpa || NAO_RASTREAR.test(limpa)) return inteiro;
    if (limpa.startsWith(`${base}/api/mkt-email-publico`)) return inteiro;
    if (!/^https?:\/\//i.test(limpa)) return inteiro;
    const real = limpa.replace(/&amp;/g, '&');
    return `href=${aspas}${urlDeClique(base, segredo, token, real).replace(/&/g, '&amp;')}${aspas}`;
  });
}

// ── Peças ──────────────────────────────────────────────────────────────────

export function blocoPreheader(texto) {
  const enchimento = '&#8199;&#65279;&nbsp;'.repeat(60);
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:transparent;">${escaparHtml(texto)}${enchimento}</div>`;
}

export function blocoPixel(base, token) {
  return `<img src="${urlDoPixel(base, token).replace(/&/g, '&amp;')}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;" />`;
}

export function blocoRodapePadrao({ base, token, rodapeTexto, rodapeEndereco }) {
  const link = urlDeDescadastro(base, token).replace(/&/g, '&amp;');
  const partes = [
    rodapeTexto ? escaparHtml(rodapeTexto) : '',
    rodapeEndereco ? escaparHtml(rodapeEndereco) : '',
    `<a href="${link}" style="color:inherit;text-decoration:underline;">Descadastrar meu e-mail</a>`,
  ].filter(Boolean);
  return `<div style="margin:24px auto;max-width:600px;padding:0 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6B7280;text-align:center;">${partes.join('<br>')}</div>`;
}

export function htmlParaTexto(html) {
  return String(html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<div[^>]*display:\s*none[\s\S]*?<\/div>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<a[^>]*href\s*=\s*["'](.*?)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, url, txt) => {
      const limpo = String(txt).replace(/<[^>]+>/g, '').trim();
      const u = String(url).replace(/&amp;/g, '&');
      return limpo ? `${limpo} (${u})` : u;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8199;|&#65279;/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Cabeçalhos de descadastro em 1 clique (RFC 8058). */
export function cabecalhosDescadastro(url) {
  if (!url) return {};
  return { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

/** `Nome <email>`, com aspas quando o nome tem pontuação. */
export function formatarRemetente(nome, email) {
  const limpo = String(nome ?? '').trim().replace(/[\r\n]/g, ' ');
  if (!limpo) return email;
  const seguro = limpo.replace(/"/g, "'");
  return /[",.<>:;@[\]]/.test(limpo) ? `"${seguro}" <${email}>` : `${seguro} <${email}>`;
}

// ── Montagem final ─────────────────────────────────────────────────────────

/**
 * HTML da campanha (já gerado pelo editor de blocos, com {{descadastro}} no
 * rodapé) → e-mail exato de UMA pessoa.
 * Ordem: personalizar → descadastro → links rastreados → preheader + pixel.
 */
export function montarEmail({ html, assunto, preheader }, pessoa, opcoes) {
  const { base, segredo, token, rastrear = true } = opcoes;
  const urlSair = urlDeDescadastro(base, token);

  let corpo = personalizar(html, pessoa);
  const temSaida = /\{\{\s*descadastro\s*\}\}/i.test(corpo);
  corpo = corpo.replace(/\{\{\s*descadastro\s*\}\}/gi, urlSair.replace(/&/g, '&amp;'));
  // Modelo sem rodapé de descadastro: acrescenta um (sem saída visível = denúncia de spam).
  if (!temSaida) corpo += blocoRodapePadrao({ ...opcoes, base, token });

  if (rastrear) corpo = reescreverLinks(corpo, { base, segredo, token });

  const pre = preheader ? personalizar(preheader, pessoa, { html: false }) : '';
  const abertura = pre ? blocoPreheader(pre) : '';
  const pixel = rastrear ? blocoPixel(base, token) : '';
  // O pixel entra antes do </body> quando o HTML é documento completo.
  const final = /<\/body>/i.test(corpo)
    ? corpo.replace(/<body([^>]*)>/i, `<body$1>${abertura}`).replace(/<\/body>/i, `${pixel}</body>`)
    : `${abertura}${corpo}${pixel}`;

  return {
    html: final,
    texto: htmlParaTexto(final),
    assunto: personalizar(assunto, pessoa, { html: false }).replace(/[\r\n]+/g, ' ').trim(),
    urlDescadastro: urlSair,
  };
}

// ── Webhook do Resend (Svix) ───────────────────────────────────────────────

/**
 * Confere a assinatura Svix: HMAC-SHA256 de `id.timestamp.corpo` com o segredo
 * (base64 depois do prefixo whsec_). Janela de 5 min contra reenvio.
 */
export function svixConfere(corpo, cab, segredoBruto, agoraSeg = Date.now() / 1000) {
  const id = cab['svix-id'];
  const ts = cab['svix-timestamp'];
  const assinaturas = cab['svix-signature'];
  if (!segredoBruto || !id || !ts || !assinaturas) return false;
  const idade = Math.abs(agoraSeg - Number(ts));
  if (!Number.isFinite(idade) || idade > 300) return false;
  const chave = Buffer.from(String(segredoBruto).replace(/^whsec_/, ''), 'base64');
  const esperada = Buffer.from(createHmac('sha256', chave).update(`${id}.${ts}.${corpo}`).digest('base64'));
  return String(assinaturas).split(' ').some((parte) => {
    const v = Buffer.from(parte.includes(',') ? parte.split(',')[1] : parte);
    return v.length === esperada.length && timingSafeEqual(v, esperada);
  });
}

/** `email.bounced` → 'bounce'. O resto (sent, opened, clicked…) a gente ignora: abertura e clique são medidos aqui. */
export function traduzirEventoResend(tipo) {
  switch (tipo) {
    case 'email.delivered': return 'entregue';
    case 'email.bounced': return 'bounce';
    case 'email.complained': return 'spam';
    default: return null;
  }
}

/** O POST do Gmail/Yahoo traz exatamente `List-Unsubscribe=One-Click`. */
export function ehUmCliqueDoProvedor(corpo) {
  return /(^|&)List-Unsubscribe=One-Click(&|$)/i.test(String(corpo ?? '').trim());
}
