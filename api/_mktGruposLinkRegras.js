// api/_mktGruposLinkRegras.js
// -----------------------------------------------------------------------------
// LINK INTELIGENTE DE GRUPO (0342) — regras PURAS (sem rede, sem banco), testadas
// em tests/mkt-grupos/link.test.ts. Usadas pela rota pública
// (api/mkt-grupos-link.js), pelo cron (api/_mktGruposLink.js) e pela tela.
//
// A escolha do grupo no clique roda no BANCO (RPC mkt_grupos_link_escolher, pra
// ser atômica). escolherGrupo() aqui é o MESMO critério, pra testar e pra tela
// mostrar "este é o grupo que está recebendo agora".
// -----------------------------------------------------------------------------

export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const CONVITE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}$/;
export const CAPACIDADE_MAX = 5000;

/** "Japão 2027 — Live!" → "japao-2027-live" */
export function slugDe(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60).replace(/-+$/g, '');
}

export const slugValido = (s) => typeof s === 'string' && s.length >= 3 && s.length <= 60 && SLUG.test(s);

/** Só convite de grupo do WhatsApp (a rota pública nunca redireciona pra outro lugar). */
export const conviteValido = (u) => CONVITE.test(String(u || ''));

/** Convite a partir da resposta da Evolution (inviteUrl / inviteCode). */
export function conviteDaResposta(r) {
  const url = r?.inviteUrl || (r?.inviteCode ? `https://chat.whatsapp.com/${r.inviteCode}` : null);
  return conviteValido(url) ? url : null;
}

/** Robôs de prévia (WhatsApp, Instagram/Facebook, Telegram…) não contam clique. */
export function ehRobo(ua) {
  return /bot|crawl|spider|preview|facebookexternalhit|facebookcatalog|meta-externalagent|whatsapp|telegram|slack|discord|twitter|linkedin|skype|embedly|vkshare|pinterest|google-?inspectiontool|headless|curl\/|wget|python-requests|go-http-client/i.test(String(ua || ''));
}

/** Capacidade efetiva do grupo no link. */
export const capacidadeDe = (g, link) => Math.min(CAPACIDADE_MAX, Math.max(1, Number(g?.capacidade ?? link?.capacidade ?? 1000) || 1000));

/** Ocupação estimada (membros contados + cliques únicos ainda não contados). */
export const ocupacaoDe = (g) => Math.max(0, Number(g?.membros ?? 0) || 0) + Math.max(0, Number(g?.pendentes ?? 0) || 0);

/** O grupo pode receber? (no link, ativo, chip ainda nele, com convite válido) */
export const grupoUtil = (g) => Boolean(g && g.ativo !== false && !g.saiu_em && conviteValido(g.link_convite));

/**
 * O MESMO critério da RPC: o primeiro grupo (pela ordem) que cabe mais um.
 * Quem volta (ref do cookie) vai pro mesmo grupo se ainda couber, sem contar de novo.
 * grupos: [{ grupo_jid, ref?, ordem, capacidade, membros, pendentes, link_convite, ativo, saiu_em }]
 * (ref = refDoGrupo(jid), calculado no servidor — este arquivo não usa node:crypto.)
 * → { status: 'ok', grupo, unico } | { status: 'lotado' }
 */
export function escolherGrupo(link, grupos, ref = null) {
  if (!link?.ativo) return { status: 'pausado' };
  const lista = (grupos || []).filter(grupoUtil)
    .map((g, i) => ({ g, i, volta: Boolean(ref) && g.ref === ref }))
    .sort((a, b) => (Number(b.volta) - Number(a.volta)) || ((a.g.ordem ?? 0) - (b.g.ordem ?? 0)) || (a.i - b.i));
  for (const { g, volta } of lista) {
    const unico = !volta;
    if (ocupacaoDe(g) + (unico ? 1 : 0) <= capacidadeDe(g, link)) return { status: 'ok', grupo: g, unico };
  }
  return { status: 'lotado' };
}

/** Situação de cada grupo pra tela: recebendo agora · na fila · lotado · sem convite · fora. */
export function situacaoDosGrupos(link, grupos) {
  const escolhido = escolherGrupo({ ...link, ativo: true }, grupos);
  const jidAtual = escolhido.status === 'ok' ? escolhido.grupo.grupo_jid : null;
  return (grupos || []).map((g) => {
    let situacao;
    if (g.ativo === false) situacao = 'desligado';
    else if (g.saiu_em) situacao = 'saiu';
    else if (!conviteValido(g.link_convite)) situacao = 'sem_convite';
    else if (g.grupo_jid === jidAtual) situacao = 'recebendo';
    else if (ocupacaoDe(g) >= capacidadeDe(g, link)) situacao = 'lotado';
    else situacao = 'fila';
    return { ...g, situacao, capacidadeEfetiva: capacidadeDe(g, link), ocupacao: ocupacaoDe(g) };
  });
}

/**
 * Precisa criar o próximo grupo? Só com "criar_grupo", abaixo do teto, e quando
 * TODOS os grupos úteis passaram de criar_ao_pct% (ou não há nenhum útil).
 */
export function precisaCriarProximo(link, grupos) {
  if (!link?.ativo || link.ao_lotar !== 'criar_grupo') return false;
  if (Number(link.criados_auto || 0) >= Number(link.limite_auto ?? 10)) return false;
  if (!String(link.modelo_nome || '').trim() || !(link.modelo_admins || []).length) return false;
  const pct = Math.min(100, Math.max(50, Number(link.criar_ao_pct ?? 90)));
  const uteis = (grupos || []).filter(grupoUtil);
  return uteis.every((g) => ocupacaoDe(g) >= Math.ceil(capacidadeDe(g, link) * pct / 100));
}

/** Trava do cron: livre se ninguém está criando, ou se a última tentativa travou há > 5 min. */
export const criacaoLivre = (criandoEm, agora = new Date()) => !criandoEm || (agora.getTime() - Date.parse(criandoEm)) > 5 * 60_000;

/** "Japão 2027 #{n}" + 3 → "Japão 2027 #3"; sem {n}: "Japão 2027 3". Máx. 100 (limite do WhatsApp é ~100). */
export function nomeNumerado(modelo, n) {
  const m = String(modelo || '').trim();
  const nome = m.includes('{n}') ? m.split('{n}').join(String(n)) : `${m} ${n}`;
  return nome.slice(0, 100);
}

/** Telefones pra Evolution: só dígitos, 10–15, sem repetir. Devolve { numeros, invalidos }. */
export function limparNumeros(entrada) {
  // Separa por vírgula/ponto e vírgula/linha. Um pedaço com espaços ("(11) 99999-8888")
  // é UM número se tiver só sinais de telefone e 10–15 dígitos; senão, separa pelos espaços.
  const pedacos = Array.isArray(entrada) ? entrada.map(String) : String(entrada || '').split(/[,;\n\r]+/);
  const brutos = [];
  for (const p of pedacos) {
    const so = String(p).trim();
    const d = so.replace(/\D/g, '');
    if (/^[\d\s()+.-]+$/.test(so) && d.length >= 10 && d.length <= 15) brutos.push(so);
    else brutos.push(...so.split(/\s+/));
  }
  const numeros = []; const invalidos = [];
  for (const b of brutos) {
    const s = String(b || '').trim();
    if (!s) continue;
    let d = s.replace(/\D/g, '');
    if (d.length === 10 || d.length === 11) d = `55${d}`;   // DDD + número, sem o 55
    if (d.length < 12 || d.length > 15) { invalidos.push(s); continue; }
    if (!numeros.includes(d)) numeros.push(d);
  }
  return { numeros, invalidos };
}

/** Quais grupos contar nesta rodada: os mais atrasados, respeitando o intervalo (mais curto se o link está "quente"). */
export function gruposParaContar(itens, { agora = new Date(), minutos = 5, minutosQuente = 2, limite = 8 } = {}) {
  const vistos = new Set();
  return (itens || [])
    .filter((g) => {
      if (!g?.grupo_jid || vistos.has(g.grupo_jid) || g.saiu_em) return false;
      vistos.add(g.grupo_jid);
      const intervalo = (g.quente ? minutosQuente : minutos) * 60_000;
      return !g.contado_em || (agora.getTime() - Date.parse(g.contado_em)) >= intervalo;
    })
    .sort((a, b) => (Date.parse(a.contado_em || 0) || 0) - (Date.parse(b.contado_em || 0) || 0))
    .slice(0, limite);
}

/** Webhook group-participants.update → { grupo, entradas, saidas } (ou null). */
export function lerMovimento(d) {
  const grupo = String(d?.id || d?.groupJid || '');
  if (!/^[0-9]+(-[0-9]+)?@g\.us$/.test(grupo)) return null;
  const n = Array.isArray(d?.participants) ? d.participants.length : 0;
  if (!n) return null;
  const acao = String(d?.action || '').toLowerCase();
  if (acao === 'add') return { grupo, entradas: n, saidas: 0 };
  if (acao === 'remove' || acao === 'leave') return { grupo, entradas: 0, saidas: n };
  return null;   // promote/demote não muda a contagem
}

// ── Páginas da rota pública (HTML mínimo, sem dado nenhum além do título) ──
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function paginaHtml({ titulo = 'Grupo do WhatsApp', texto = '', descricao = '', recarregarEm = 0 } = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(titulo)}</title><meta property="og:title" content="${esc(titulo)}">
${descricao ? `<meta property="og:description" content="${esc(descricao)}"><meta name="description" content="${esc(descricao)}">` : ''}
${recarregarEm > 0 ? `<meta http-equiv="refresh" content="${Number(recarregarEm) | 0}">` : ''}
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f0f2f5;color:#111b21}
main{max-width:420px;margin:16px;padding:28px 24px;background:#fff;border-radius:16px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.06)}
h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#54656f;white-space:pre-line}
@media (prefers-color-scheme:dark){body{background:#0b141a;color:#e9edef}main{background:#202c33}p{color:#aebac1}}</style></head>
<body><main><h1>${esc(titulo)}</h1>${texto ? `<p>${esc(texto)}</p>` : ''}</main></body></html>`;
}
