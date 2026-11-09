// api/mkt-grupos-link.js
// -----------------------------------------------------------------------------
// LINK INTELIGENTE DE GRUPO (0342) — a rota PÚBLICA, sem login.
//   GET /g/<slug>   (rewrite do vercel.json → /api/mkt-grupos-link?slug=<slug>)
//
// • Pessoa: 302 pro convite do primeiro grupo que não lotou (a RPC
//   mkt_grupos_link_escolher decide e conta, atômica, com a chave de serviço).
// • Robô de prévia (WhatsApp, Instagram…): página com o título, NÃO conta clique.
// • Tudo lotado: página "grupos lotados" (ou "abrindo um grupo novo" que recarrega
//   sozinha, quando o link cria o próximo grupo).
// • Não expõe nada: nem jid, nem número, nem quantos membros. O cookie guarda só
//   um resumo (hash) do grupo, pra quem clica de novo voltar pro mesmo grupo.
// • Só redireciona pra https://chat.whatsapp.com/<código>.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { slugValido, ehRobo, conviteValido, paginaHtml } from './_mktGruposLinkRegras.js';

const REF = /^[0-9a-f]{12}$/;

function lerCookie(req, nome) {
  const bruto = String(req.headers?.cookie || '');
  for (const parte of bruto.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

function html(res, status, corpo) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(status).send(corpo);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }
  const slug = String(req.query?.slug || '').trim().toLowerCase();
  if (!slugValido(slug)) return html(res, 404, paginaHtml({ titulo: 'Link não encontrado', texto: 'Confira o endereço e tente de novo.' }));

  const robo = ehRobo(req.headers?.['user-agent']) || req.method === 'HEAD';
  const nomeCookie = `g_${slug.replace(/-/g, '_')}`;
  const ref = lerCookie(req, nomeCookie);

  let r;
  try {
    r = await rest('rpc/mkt_grupos_link_escolher', {
      method: 'POST', timeoutMs: 6_000,
      body: { p_slug: slug, p_modo: robo ? 'bot' : 'clique', p_ref: ref && REF.test(ref) ? ref : null },
    });
  } catch (e) {
    console.error('[mkt-grupos-link]', slug, e?.message);
    return html(res, 503, paginaHtml({ titulo: 'Um instante…', texto: 'Não consegui abrir o grupo agora. Tente de novo em alguns segundos.', recarregarEm: 10 }));
  }

  const status = r?.status;
  const titulo = r?.titulo || 'Grupo do WhatsApp';
  if (status === 'nao_existe') return html(res, 404, paginaHtml({ titulo: 'Link não encontrado', texto: 'Confira o endereço e tente de novo.' }));
  if (robo) return html(res, 200, paginaHtml({ titulo, descricao: r?.descricao || '', texto: r?.descricao || '' }));
  if (status === 'ok' && conviteValido(r?.convite)) {
    if (r?.ref && REF.test(r.ref)) {
      res.setHeader('Set-Cookie', `${nomeCookie}=${r.ref}; Max-Age=86400; Path=/g/${slug}; HttpOnly; Secure; SameSite=Lax`);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Location', r.convite);
    return res.status(302).end();
  }
  if (status === 'pausado') return html(res, 200, paginaHtml({ titulo, texto: r?.mensagem || 'As entradas por este link estão fechadas no momento.' }));
  if (status === 'aguarde') return html(res, 200, paginaHtml({ titulo, texto: 'Os grupos lotaram e estamos abrindo um novo. Esta página tenta de novo sozinha em 30 segundos.', recarregarEm: 30 }));
  return html(res, 200, paginaHtml({ titulo: 'Grupos lotados', texto: r?.mensagem || 'Todos os grupos deste link estão cheios. Fique de olho nas nossas redes: logo abrimos mais vagas.' }));
}
