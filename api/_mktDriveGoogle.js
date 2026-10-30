// api/_mktDriveGoogle.js
// -----------------------------------------------------------------------------
// DRIVE DO MARKETING (0241, 30/10/2026) — a conversa com o Google.
//
// O QS fala com UM Drive compartilhado ("Marketing") por uma CONTA DE SERVIÇO:
// ninguém do time loga no Google. A conta de serviço é membro do Drive
// compartilhado (Gerente de conteúdo) e o QS assina, ele mesmo, o JWT que troca
// por um access_token (sem a biblioteca `googleapis` — só node:crypto).
//
// Este arquivo NÃO fala com o Supabase: tudo que é puro (JWT, query de busca,
// paginação, faixa de bytes, link assinado) fica aqui e é testado em
// tests/mkt-drive/*.test.ts. Quem decide permissão é o api/mkt-drive.js.
//
// Env (Vercel → Settings → Environment Variables; ver docs/MARKETING-DRIVE.md):
//   GOOGLE_SA_JSON   o arquivo JSON inteiro da chave (texto ou base64)  — OU —
//   GOOGLE_SA_EMAIL  client_email da conta de serviço
//   GOOGLE_SA_KEY    private_key (PEM; aceita "\n" escapado)
//   MKT_DRIVE_ID     id do Drive compartilhado (o trecho depois de /folders/ na URL)
// -----------------------------------------------------------------------------

import { createSign, createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const ESCOPO_DRIVE = 'https://www.googleapis.com/auth/drive';
export const URL_TOKEN = 'https://oauth2.googleapis.com/token';
export const API_DRIVE = 'https://www.googleapis.com/drive/v3';
export const API_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const MIME_PASTA = 'application/vnd.google-apps.folder';

/** Campos que o QS usa de cada arquivo (files.list / files.get / changes). */
export const CAMPOS_ARQUIVO = [
  'id', 'name', 'mimeType', 'parents', 'driveId', 'size', 'createdTime', 'modifiedTime',
  'trashed', 'webViewLink', 'iconLink', 'thumbnailLink', 'hasThumbnail', 'fileExtension',
  'description', 'videoMediaMetadata', 'imageMediaMetadata', 'lastModifyingUser(displayName,emailAddress)',
].join(',');

// ── Credenciais ─────────────────────────────────────────────────────────────

function erroConfig(msg) {
  const e = new Error(msg);
  e.code = 'DRIVE_CONFIG';
  return e;
}

/** A chave PEM chega da Vercel de vários jeitos: com "\n" literal, entre aspas, com \r. */
export function normalizarChave(k) {
  let s = String(k || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s.replace(/\\n/g, '\n').replace(/\r/g, '');
}

/**
 * Lê as credenciais do ambiente. Devolve { email, chave, driveId } ou lança
 * DRIVE_CONFIG dizendo O QUE falta (a tela mostra isso pro Bruno).
 */
export function lerCredenciais(env = process.env) {
  let email = String(env.GOOGLE_SA_EMAIL || '').trim();
  let chave = env.GOOGLE_SA_KEY ? normalizarChave(env.GOOGLE_SA_KEY) : '';
  const bruto = String(env.GOOGLE_SA_JSON || '').trim();
  if (bruto) {
    let j = null;
    try { j = JSON.parse(bruto); } catch {
      try { j = JSON.parse(Buffer.from(bruto, 'base64').toString('utf8')); } catch { j = null; }
    }
    if (!j || typeof j !== 'object') throw erroConfig('GOOGLE_SA_JSON não é um JSON válido (cole o arquivo inteiro da chave).');
    email = email || String(j.client_email || '').trim();
    chave = chave || normalizarChave(j.private_key);
  }
  const driveId = String(env.MKT_DRIVE_ID || '').trim();
  const faltam = [];
  if (!email) faltam.push('GOOGLE_SA_EMAIL');
  if (!chave) faltam.push('GOOGLE_SA_KEY');
  if (!driveId) faltam.push('MKT_DRIVE_ID');
  if (faltam.length) throw erroConfig(`Drive do Marketing não configurado: falta ${faltam.join(', ')} na Vercel.`);
  if (!/BEGIN (RSA )?PRIVATE KEY/.test(chave)) throw erroConfig('GOOGLE_SA_KEY não parece uma chave PEM ("-----BEGIN PRIVATE KEY-----").');
  return { email, chave, driveId };
}

// ── JWT da conta de serviço ─────────────────────────────────────────────────

export function b64url(v) {
  const b = Buffer.isBuffer(v) ? v : Buffer.from(typeof v === 'string' ? v : JSON.stringify(v), 'utf8');
  return b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Monta e assina (RS256) o JWT que o Google troca por access_token.
 * `agora` em segundos (injetável pro teste). Validade 1 h (o máximo do Google).
 */
export function assinarJwt({ email, chave, escopo = ESCOPO_DRIVE, agora = Math.floor(Date.now() / 1000), sub } = {}) {
  const cabecalho = { alg: 'RS256', typ: 'JWT' };
  const corpo = { iss: email, scope: escopo, aud: URL_TOKEN, iat: agora, exp: agora + 3600 };
  if (sub) corpo.sub = sub;
  const base = `${b64url(cabecalho)}.${b64url(corpo)}`;
  const assinatura = createSign('RSA-SHA256').update(base).end().sign(chave);
  return `${base}.${b64url(assinatura)}`;
}

// Token em memória da instância (a função "quente" reaproveita por ~55 min).
let cacheToken = null;

export async function tokenGoogle({ fetchFn = fetch, env = process.env } = {}) {
  const agora = Math.floor(Date.now() / 1000);
  if (cacheToken && cacheToken.exp - 300 > agora) return cacheToken.token;
  const { email, chave } = lerCredenciais(env);
  const assertion = assinarJwt({ email, chave, agora });
  const r = await fetchFn(URL_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const e = new Error(`Google recusou a conta de serviço: ${j.error_description || j.error || r.status}`);
    e.code = 'DRIVE_AUTH';
    throw e;
  }
  cacheToken = { token: j.access_token, exp: agora + Number(j.expires_in || 3600) };
  return cacheToken.token;
}

/** Só pra teste: esquece o token guardado. */
export function _limparCacheToken() { cacheToken = null; }

// ── Chamadas à API ──────────────────────────────────────────────────────────

/**
 * Chama a Drive API v3. SEMPRE com supportsAllDrives=true (sem isso o Google
 * finge que os arquivos do Drive compartilhado não existem).
 */
export async function drive(caminho, { method = 'GET', query = {}, body, headers = {}, upload = false, fetchFn = fetch, cru = false } = {}) {
  const token = await tokenGoogle({ fetchFn });
  const qs = new URLSearchParams({ supportsAllDrives: 'true' });
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const url = `${upload ? API_UPLOAD : API_DRIVE}/${caminho}?${qs.toString()}`;
  const h = { Authorization: `Bearer ${token}`, ...headers };
  if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json; charset=UTF-8';
  const r = await fetchFn(url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (cru) return r;
  const texto = await r.text();
  let j = null;
  try { j = texto ? JSON.parse(texto) : null; } catch { j = texto; }
  if (!r.ok) {
    const msg = (j && j.error && (j.error.message || j.error)) || `Drive HTTP ${r.status}`;
    const e = new Error(`Google Drive: ${msg}`);
    e.status = r.status;
    e.code = 'DRIVE_API';
    throw e;
  }
  return j;
}

// ── Busca ───────────────────────────────────────────────────────────────────

/** Escapa um valor pra dentro de aspas simples na linguagem `q` do Drive. */
export function escaparQ(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Tipos que a tela oferece → condição do Drive. */
export const TIPOS = {
  pasta: `mimeType = '${MIME_PASTA}'`,
  video: "mimeType contains 'video/'",
  imagem: "mimeType contains 'image/'",
  audio: "mimeType contains 'audio/'",
  pdf: "mimeType = 'application/pdf'",
  documento: "(mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.presentation')",
};

/** Data "2026-10-30" ou ISO → RFC 3339 que o Drive aceita; inválida → null. */
export function dataRfc3339(v, fimDoDia = false) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T${fimDoDia ? '23:59:59' : '00:00:00'}-03:00`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Monta o `q` do files.list. Tudo que vem do navegador passa por escaparQ.
 *   { texto, tipo, pastaId, desde, ate, lixeira }
 * Sem lixeira → só o que não está na lixeira.
 */
export function montarQueryBusca({ texto, tipo, pastaId, desde, ate, lixeira = false } = {}) {
  const partes = [lixeira ? 'trashed = true' : 'trashed = false'];
  const t = String(texto || '').trim().slice(0, 200);
  if (t) partes.push(`name contains '${escaparQ(t)}'`);
  if (tipo && TIPOS[tipo]) partes.push(TIPOS[tipo]);
  if (pastaId) partes.push(`'${escaparQ(pastaId)}' in parents`);
  const de = dataRfc3339(desde, false);
  const ate_ = dataRfc3339(ate, true);
  if (de) partes.push(`modifiedTime >= '${de}'`);
  if (ate_) partes.push(`modifiedTime <= '${ate_}'`);
  return partes.join(' and ');
}

// ── Paginação ───────────────────────────────────────────────────────────────

/** Tamanho de página aceito (o files.list do Drive vai até 1000; a tela usa 50). */
export function tamanhoPagina(n, { padrao = 50, max = 200 } = {}) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return padrao;
  return Math.min(v, max);
}

/** pageToken do Drive é opaco: só aceita o formato que ele devolve. */
export function tokenPaginaValido(t) {
  const s = String(t || '');
  return s.length > 0 && s.length <= 2048 && /^[A-Za-z0-9_\-.~=+/]+$/.test(s);
}

/** Parâmetros do files.list de UMA pasta (ou da busca), no Drive compartilhado. */
export function paramsListagem({ driveId, q, pageToken, tamanho, ordem = 'folder,name' }) {
  const p = {
    corpora: 'drive',
    driveId,
    includeItemsFromAllDrives: 'true',
    q,
    pageSize: tamanhoPagina(tamanho),
    orderBy: ordem,
    fields: `nextPageToken,files(${CAMPOS_ARQUIVO})`,
  };
  if (tokenPaginaValido(pageToken)) p.pageToken = pageToken;
  return p;
}

/** Id de arquivo/pasta do Drive: letras, números, - e _. */
export function idValido(id) {
  return /^[A-Za-z0-9_-]{10,200}$/.test(String(id || ''));
}

// ── O arquivo como o QS enxerga ─────────────────────────────────────────────

export function linkPreview(id) { return `https://drive.google.com/file/d/${id}/preview`; }

export function tipoDe(mime) {
  const m = String(mime || '');
  if (m === MIME_PASTA) return 'pasta';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('image/')) return 'imagem';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('application/vnd.google-apps.')) return 'documento';
  return 'outro';
}

/** files#resource → linha do índice (só as colunas que o Drive manda; tags são do QS). */
export function paraIndice(f, driveId) {
  const v = f.videoMediaMetadata || {};
  const im = f.imageMediaMetadata || {};
  return {
    drive_file_id: f.id,
    drive_id: f.driveId || driveId || null,
    nome: String(f.name || '').slice(0, 500),
    mime_type: f.mimeType || 'application/octet-stream',
    tipo: tipoDe(f.mimeType),
    pasta_id: Array.isArray(f.parents) && f.parents[0] ? f.parents[0] : null,
    tamanho: f.size != null ? Number(f.size) : null,
    duracao_ms: v.durationMillis != null ? Number(v.durationMillis) : null,
    largura: v.width ?? im.width ?? null,
    altura: v.height ?? im.height ?? null,
    tem_miniatura: !!f.hasThumbnail,
    web_view_link: f.webViewLink || null,
    icone_link: f.iconLink || null,
    descricao_drive: f.description ? String(f.description).slice(0, 2000) : null,
    na_lixeira: !!f.trashed,
    removido: false,
    criado_no_drive: f.createdTime || null,
    modificado_no_drive: f.modifiedTime || null,
    modificado_por: f.lastModifyingUser?.displayName || f.lastModifyingUser?.emailAddress || null,
    sincronizado_em: new Date().toISOString(),
  };
}

/** files#resource → o que a tela recebe (ArquivoDrive + extras). */
export function paraTela(f) {
  return {
    id: f.id,
    nome: f.name,
    mimeType: f.mimeType,
    tipo: tipoDe(f.mimeType),
    pastaId: Array.isArray(f.parents) ? f.parents[0] || null : null,
    webViewLink: f.webViewLink || linkPreview(f.id).replace('/preview', '/view'),
    previewLink: linkPreview(f.id),
    temMiniatura: !!f.hasThumbnail,
    tamanho: f.size != null ? Number(f.size) : undefined,
    duracaoMs: f.videoMediaMetadata?.durationMillis != null ? Number(f.videoMediaMetadata.durationMillis) : undefined,
    criadoEm: f.createdTime || null,
    modificadoEm: f.modifiedTime || null,
    modificadoPor: f.lastModifyingUser?.displayName || null,
    naLixeira: !!f.trashed,
  };
}

// ── Link assinado (miniatura e mídia) ──────────────────────────────────────
// <img> e <video> não mandam o header Authorization. O servidor, depois de
// conferir quem é, devolve uma URL com validade curta e assinatura HMAC. A
// chave do HMAC é derivada da chave da conta de serviço — sem env nova, e ela
// muda sozinha se a chave for trocada.

function segredoLinks(env = process.env) {
  const { chave } = lerCredenciais(env);
  return createHash('sha256').update(`qs-mkt-drive-links:${chave}`).digest();
}

export function assinarLink({ acao, id, exp, segredo }) {
  return createHmac('sha256', segredo).update(`${acao}|${id}|${exp}`).digest('base64url');
}

/** Monta /api/mkt-drive?acao=...&id=...&exp=...&sig=... (validade em segundos). */
export function urlAssinada(acao, id, { validade = 3600, agora = Math.floor(Date.now() / 1000), env, segredo, extra = {} } = {}) {
  const exp = agora + validade;
  const sig = assinarLink({ acao, id, exp, segredo: segredo || segredoLinks(env) });
  const qs = new URLSearchParams({ acao, id, exp: String(exp), sig, ...extra });
  return `/api/mkt-drive?${qs.toString()}`;
}

export function conferirLink({ acao, id, exp, sig }, { agora = Math.floor(Date.now() / 1000), env, segredo } = {}) {
  const e = Number(exp);
  if (!idValido(id) || !Number.isFinite(e) || e < agora || !sig) return false;
  const esperado = Buffer.from(assinarLink({ acao, id, exp: e, segredo: segredo || segredoLinks(env) }));
  const veio = Buffer.from(String(sig));
  return esperado.length === veio.length && timingSafeEqual(esperado, veio);
}

// ── Faixa de bytes (player de vídeo) ───────────────────────────────────────
// A Vercel corta resposta acima de ~4,5 MB. O <video> pede "bytes=N-" e aceita
// 206 com um pedaço menor — então devolvemos no máximo MAX_PEDACO por vez e ele
// pede o resto sozinho.
export const MAX_PEDACO = 4 * 1024 * 1024;

/** "bytes=100-" → { inicio: 100, fim: 100+MAX-1 }. Sem Range → do zero. */
export function faixaDoPedido(range, max = MAX_PEDACO) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(range || '').trim());
  let inicio = 0;
  let fim = max - 1;
  if (m && m[1] !== '') {
    inicio = Number(m[1]);
    fim = m[2] !== '' ? Math.min(Number(m[2]), inicio + max - 1) : inicio + max - 1;
  } else if (m && m[1] === '' && m[2] !== '') {
    // "bytes=-500" (sufixo) — raro em player; trata como começo do arquivo.
    inicio = 0;
    fim = Math.min(Number(m[2]), max) - 1;
  }
  if (fim < inicio) fim = inicio;
  return { inicio, fim };
}

/** Miniatura em outro tamanho: o thumbnailLink termina em "=s220". */
export function miniaturaNoTamanho(link, px = 400) {
  const t = Math.max(64, Math.min(1600, Math.floor(Number(px)) || 400));
  const s = String(link || '');
  return /=s\d+(-[a-z0-9-]+)?$/i.test(s) ? s.replace(/=s\d+(-[a-z0-9-]+)?$/i, `=s${t}`) : s;
}

// ── Origem do envio (CORS do upload direto) ────────────────────────────────

/**
 * O navegador sobe o arquivo DIRETO pro Google (vídeo grande não cabe na função
 * da Vercel). Pro Google liberar o CORS desse PUT, a sessão resumable tem que
 * ser aberta com o header Origin do site. Só aceitamos a origem do próprio QS:
 * o mesmo host da requisição, a lista MKT_DRIVE_ORIGENS, ou localhost fora de
 * produção.
 */
export function origemPermitida(origem, { host, env = process.env } = {}) {
  let u;
  try { u = new URL(String(origem || '')); } catch { return null; }
  if (!['https:', 'http:'].includes(u.protocol)) return null;
  const o = `${u.protocol}//${u.host}`;
  const lista = String(env.MKT_DRIVE_ORIGENS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  if (lista.includes(o)) return o;
  if (host && u.protocol === 'https:' && u.host === String(host).trim()) return o;
  if (env.VERCEL_ENV !== 'production' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return o;
  return null;
}

/** Nome de arquivo/pasta: sem barra invertida e sem controle, até 250 caracteres. */
export function nomeLimpo(v) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 250);
}

/** Tags do QS: minúsculas, sem # e sem espaço sobrando, até 20, sem repetir. */
export function tagsLimpas(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(',');
  const out = [];
  for (const t of arr) {
    const s = String(t || '').replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 20) break;
  }
  return out;
}
