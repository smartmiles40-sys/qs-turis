// api/mkt-drive.js
// -----------------------------------------------------------------------------
// DRIVE DO MARKETING (0241, 30/10/2026) — rota única. A conversa com o Google
// mora em api/_mktDriveGoogle.js; a sincronização em api/_mktDriveSync.js.
// Aqui é porta, permissão e validação.
//
// Quem entra: usuário ativo do QS com papel `marketing`, setor `marketing` ou admin.
// Tudo SEMPRE dentro do Drive compartilhado MKT_DRIVE_ID: antes de mexer num
// arquivo, o servidor confere no Google que ele é desse Drive.
//
//   POST { acao: 'config' }                                 → configurado? última sincronização, tags, expedições
//   POST { acao: 'listar', pastaId?, pageToken?, tamanho? } → uma pasta (direto do Drive) + migalhas
//   POST { acao: 'buscar', texto?, tipo?, pastaId?, desde?, ate?, pageToken? } → busca AO VIVO no Drive
//   POST { acao: 'buscar_indice', texto?, tipo?, pastaId?, desde?, ate?, tags?, destino?, expedicaoId?, offset? }
//                                                           → busca no índice local (tags/destino que o Drive não tem)
//   POST { acao: 'metadados', id }                          → arquivo + migalhas + tags + links de mídia
//   POST { acao: 'criar_pasta', nome, paiId? }
//   POST { acao: 'renomear', id, nome }
//   POST { acao: 'mover', id, destinoId }
//   POST { acao: 'lixeira' | 'restaurar', id }              → NUNCA apaga de vez
//   POST { acao: 'iniciar_envio', nome, mimeType, tamanho, pastaId? } → URL da sessão resumable
//   POST { acao: 'concluir_envio', id, tags?, destino?, expedicaoId? } → registra no índice + quem subiu
//   POST { acao: 'etiquetar', id, tags?, destino?, expedicaoId?, observacao? }
//   POST { acao: 'sincronizar' }                            → uma rodada da sincronização incremental
//   GET  ?cron=1  (Vercel Cron, Bearer CRON_SECRET, de hora em hora) → sincronizar
//   GET  ?acao=miniatura&id&exp&sig[&tam]                   → proxy da miniatura (link assinado)
//   GET  ?acao=midia&id&exp&sig                             → proxy da mídia em pedaços de 4 MB (player)
//   PUT  ?acao=pedaco (X-Upload-Url, Content-Range)          → plano B do envio: repassa um pedaço de 4 MB
//
// Upload: o servidor abre a sessão resumable no Google passando o Origin do QS;
// o navegador faz o PUT direto na URL devolvida (o arquivo NÃO passa pela
// função da Vercel — vídeo grande não caberia). Ver docs/MARKETING-DRIVE.md.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { getSupabaseUserId } from './_wa.js';
import {
  drive, lerCredenciais, montarQueryBusca, paramsListagem, idValido, paraTela, tipoDe,
  urlAssinada, conferirLink, faixaDoPedido, miniaturaNoTamanho, origemPermitida, nomeLimpo,
  tagsLimpas, tokenGoogle, CAMPOS_ARQUIVO, MIME_PASTA, MAX_PEDACO, TIPOS, linkPreview,
} from './_mktDriveGoogle.js';
import { sincronizar, gravarNoIndice } from './_mktDriveSync.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAMANHO_MAX_ENVIO = 50 * 1024 ** 3; // 50 GB (o Google aceita até 5 TB; aqui é bom senso)
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

async function quem(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !UUID.test(id)) return null;
  const u = (await rest(`qs_users?select=id,name,role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  return u?.is_active ? u : null;
}

/** Mesma regra da mkt_drive_pode() (0241). */
function ehDoMarketing(u) {
  const s = Array.isArray(u.setores) ? u.setores : [];
  return u.role === 'admin' || u.role === 'marketing' || s.includes('marketing');
}

// ── Links assinados (válidos por 2 h, alinhados na hora pro navegador cachear) ──
function horaCheia() { return Math.floor(Date.now() / 3_600_000) * 3600; }
function miniaturaUrl(id, tam = 400) {
  return urlAssinada('miniatura', id, { agora: horaCheia(), validade: 7200, extra: { tam: String(tam) } });
}
function midiaUrl(id) { return urlAssinada('midia', id, { agora: horaCheia(), validade: 7200 }); }

function comLinks(item) {
  const baixavel = item.mimeType && !String(item.mimeType).startsWith('application/vnd.google-apps.');
  return {
    ...item,
    miniaturaUrl: item.temMiniatura ? miniaturaUrl(item.id) : null,
    midiaUrl: baixavel && item.tipo !== 'pasta' ? midiaUrl(item.id) : null,
  };
}

/** Linha do índice → mesmo formato que paraTela(). */
function linhaParaTela(l) {
  return comLinks({
    id: l.drive_file_id,
    nome: l.nome,
    mimeType: l.mime_type,
    tipo: l.tipo,
    pastaId: l.pasta_id,
    webViewLink: l.web_view_link || `https://drive.google.com/file/d/${l.drive_file_id}/view`,
    previewLink: linkPreview(l.drive_file_id),
    temMiniatura: !!l.tem_miniatura,
    tamanho: l.tamanho ?? undefined,
    duracaoMs: l.duracao_ms ?? undefined,
    criadoEm: l.criado_no_drive,
    modificadoEm: l.modificado_no_drive,
    modificadoPor: l.modificado_por,
    naLixeira: !!l.na_lixeira,
    tags: l.tags || [],
    destino: l.destino,
    expedicaoId: l.expedicao_id,
    observacao: l.observacao,
    subidoPor: l.subido_por,
  });
}

/** Junta tags/destino do índice nos itens que vieram ao vivo do Drive. */
async function anexarDoIndice(itens) {
  const ids = itens.map((i) => i.id).filter(idValido);
  if (!ids.length) return itens;
  const linhas = await rest(`mkt_drive_arquivos?select=drive_file_id,tags,destino,expedicao_id,observacao,subido_por&drive_file_id=in.(${ids.map((i) => `"${i}"`).join(',')})`).catch(() => []);
  const mapa = new Map((linhas || []).map((l) => [l.drive_file_id, l]));
  return itens.map((i) => {
    const l = mapa.get(i.id);
    return { ...i, tags: l?.tags || [], destino: l?.destino || null, expedicaoId: l?.expedicao_id || null, observacao: l?.observacao || null, subidoPor: l?.subido_por || null };
  });
}

// ── Garantia: o arquivo é do NOSSO Drive compartilhado ──────────────────────
async function arquivoDoDrive(id, driveId, campos = CAMPOS_ARQUIVO) {
  if (!idValido(id)) { const e = new Error('Arquivo inválido.'); e.status = 400; throw e; }
  if (id === driveId) return { id: driveId, name: 'Marketing', mimeType: MIME_PASTA, driveId, parents: [] };
  const f = await drive(`files/${encodeURIComponent(id)}`, { query: { fields: campos.includes('driveId') ? campos : `${campos},driveId` } });
  if (f.driveId !== driveId) { const e = new Error('Esse arquivo não é do Drive do Marketing.'); e.status = 403; throw e; }
  return f;
}

let nomeDoDrive = null;
async function raiz(driveId) {
  if (!nomeDoDrive) {
    const d = await drive(`drives/${encodeURIComponent(driveId)}`, { query: { fields: 'id,name' } }).catch(() => null);
    nomeDoDrive = d?.name || 'Marketing';
  }
  return { id: driveId, nome: nomeDoDrive };
}

/** Migalhas: da raiz do Drive compartilhado até a pasta. */
async function caminhoDe(pastaId, driveId) {
  const trilha = [];
  let atual = pastaId;
  for (let i = 0; i < 15 && atual && atual !== driveId; i++) {
    const f = await drive(`files/${encodeURIComponent(atual)}`, { query: { fields: 'id,name,parents,driveId' } });
    if (f.driveId !== driveId) break;
    trilha.unshift({ id: f.id, nome: f.name });
    atual = Array.isArray(f.parents) ? f.parents[0] : null;
  }
  trilha.unshift(await raiz(driveId));
  return trilha;
}

async function patchIndice(id, campos) {
  await rest(`mkt_drive_arquivos?drive_file_id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', prefer: 'return=minimal', body: campos });
}

/** Campos do QS vindos da tela (só os que vieram). */
async function camposDoQs(body) {
  const c = {};
  if (body.tags !== undefined) c.tags = tagsLimpas(body.tags);
  if (body.destino !== undefined) c.destino = body.destino ? String(body.destino).trim().slice(0, 120) : null;
  if (body.observacao !== undefined) c.observacao = body.observacao ? String(body.observacao).trim().slice(0, 2000) : null;
  if (body.expedicaoId !== undefined) {
    if (body.expedicaoId && !UUID.test(String(body.expedicaoId))) { const e = new Error('Expedição inválida.'); e.status = 400; throw e; }
    c.expedicao_id = body.expedicaoId || null;
    if (c.expedicao_id && c.destino === undefined) {
      const ex = (await rest(`expedicoes?select=destino&id=eq.${c.expedicao_id}&limit=1`).catch(() => null))?.[0];
      if (ex?.destino) c.destino = ex.destino;
    }
  }
  return c;
}

// ── GET: cron + proxies assinados ───────────────────────────────────────────

async function servirMiniatura(req, res, q) {
  const f = await drive(`files/${encodeURIComponent(q.id)}`, { query: { fields: 'id,driveId,thumbnailLink,hasThumbnail' } });
  const { driveId } = lerCredenciais();
  if (f.driveId !== driveId || !f.thumbnailLink) return res.status(404).end();
  const link = miniaturaNoTamanho(f.thumbnailLink, q.tam);
  // O thumbnailLink de arquivo privado costuma exigir credencial: tenta com o
  // token da conta de serviço e, se o Google recusar, sem (link público).
  const token = await tokenGoogle();
  let r = await fetch(link, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) r = await fetch(link);
  if (!r.ok) return res.status(404).end();
  const buf = Buffer.from(await r.arrayBuffer());
  res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).end(buf);
}

async function servirMidia(req, res, q) {
  const { driveId } = lerCredenciais();
  const f = await drive(`files/${encodeURIComponent(q.id)}`, { query: { fields: 'id,driveId,mimeType,name,size' } });
  if (f.driveId !== driveId) return res.status(404).end();
  if (String(f.mimeType).startsWith('application/vnd.google-apps.')) return res.status(415).json({ error: 'Documento do Google: abra pela visualização do Drive.' });
  const total = Number(f.size || 0);
  const { inicio, fim: fimPedido } = faixaDoPedido(req.headers.range, MAX_PEDACO);
  if (total && inicio >= total) {
    res.setHeader('Content-Range', `bytes */${total}`);
    return res.status(416).end();
  }
  const fim = total ? Math.min(fimPedido, total - 1) : fimPedido;
  const r = await drive(`files/${encodeURIComponent(q.id)}`, {
    query: { alt: 'media' }, headers: { Range: `bytes=${inicio}-${fim}` }, cru: true,
  });
  if (!r.ok && r.status !== 206) return res.status(r.status === 404 ? 404 : 502).end();
  const buf = Buffer.from(await r.arrayBuffer());
  res.setHeader('Content-Type', f.mimeType || r.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name || 'arquivo')}`);
  if (total) {
    res.setHeader('Content-Range', `bytes ${inicio}-${inicio + buf.length - 1}/${total}`);
    return res.status(206).end(buf);
  }
  return res.status(200).end(buf);
}

// ── Plano B do envio: pedaço de até 4 MB passando pela função ───────────────
// Se o navegador não conseguir o PUT direto no Google (CORS), a tela manda o
// arquivo em pedaços de 4 MB (múltiplos de 256 KB, como o Google exige) por
// aqui, e o servidor repassa pra MESMA sessão resumable. Mais lento, mas sobe.
//   PUT /api/mkt-drive?acao=pedaco   Authorization, X-Upload-Url, Content-Range, corpo = bytes
export const URL_SESSAO = /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?[^#\s]*\bupload_id=[\w-]+/;

async function lerCorpoCru(req, max) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const partes = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > max) { const e = new Error('Pedaço grande demais.'); e.status = 413; throw e; }
    partes.push(c);
  }
  return Buffer.concat(partes);
}

async function repassarPedaco(req, res) {
  const u = await quem(req);
  if (!u) return res.status(401).json({ error: 'Sessão inválida.' });
  if (!ehDoMarketing(u)) return res.status(403).json({ error: 'O Drive é do Marketing.' });
  const url = String(req.headers['x-upload-url'] || '');
  const faixa = String(req.headers['content-range'] || '');
  if (!URL_SESSAO.test(url)) return res.status(400).json({ error: 'Sessão de envio inválida.' });
  if (!/^bytes (\d+-\d+|\*)\/\d+$/.test(faixa)) return res.status(400).json({ error: 'Content-Range inválido.' });
  try {
    const corpo = await lerCorpoCru(req, MAX_PEDACO + 1024);
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Range': faixa, 'Content-Length': String(corpo.length) }, body: corpo.length ? corpo : undefined });
    const texto = await r.text();
    return res.status(200).json({ status: r.status, range: r.headers.get('range'), texto: r.status < 300 ? texto : '' });
  } catch (e) {
    console.error('[mkt-drive] pedaço', e?.message);
    return res.status(e?.status === 413 ? 413 : 502).json({ error: e?.status === 413 ? e.message : 'O Google não recebeu o pedaço.' });
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    try {
      if (q.cron) {
        const segredo = String(process.env.CRON_SECRET || '').trim();
        const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        if (!segredo || veio !== segredo) return res.status(401).json({ error: 'Não autorizado' });
        try { lerCredenciais(); } catch { return res.status(200).json({ ok: true, pulado: 'Drive não configurado' }); }
        return res.status(200).json({ ok: true, ...(await sincronizar({ orcamentoMs: 45_000 })) });
      }
      if (q.acao === 'miniatura' || q.acao === 'midia') {
        if (!conferirLink({ acao: q.acao, id: q.id, exp: q.exp, sig: q.sig })) return res.status(403).end();
        return q.acao === 'miniatura' ? await servirMiniatura(req, res, q) : await servirMidia(req, res, q);
      }
      return res.status(400).json({ error: 'Ação desconhecida.' });
    } catch (e) {
      console.error('[mkt-drive GET]', q.acao || 'cron', e?.message);
      if (!res.headersSent) return res.status(e?.status === 404 ? 404 : 500).json({ error: 'Falhou.' });
      return res.end();
    }
  }
  if (req.method === 'PUT') return repassarPedaco(req, res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, PUT');
    return res.status(405).json({ error: 'Use POST' });
  }

  const u = await quem(req);
  if (!u) return res.status(401).json({ error: 'Sessão inválida.' });
  if (!ehDoMarketing(u)) return res.status(403).json({ error: 'O Drive é do Marketing.' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(body.acao || '');

  try {
    if (acao === 'config') {
      let configurado = true;
      let falta = null;
      try { lerCredenciais(); } catch (e) { configurado = false; falta = e.message; }
      const [estado, tags, expedicoes] = await Promise.all([
        rest('mkt_drive_estado?select=ultima_sync,varrendo,ultimo_erro,arquivos_vistos&id=eq.1&limit=1').then((r) => r?.[0] || null).catch(() => null),
        rest('rpc/mkt_drive_tags', { method: 'POST', body: {} }).catch(() => []),
        rest('expedicoes?select=id,nome,destino,data_embarque&order=data_embarque.desc.nullslast&limit=300').catch(() => []),
      ]);
      return res.status(200).json({
        configurado, falta, estado, tags: tags || [],
        expedicoes: expedicoes || [],
        raiz: configurado ? await raiz(lerCredenciais().driveId).catch(() => null) : null,
      });
    }

    const { driveId } = lerCredenciais(); // daqui pra baixo precisa do Google

    if (acao === 'listar') {
      const pastaId = body.pastaId && body.pastaId !== 'raiz' ? String(body.pastaId) : driveId;
      if (pastaId !== driveId) await arquivoDoDrive(pastaId, driveId, 'id,driveId');
      const r = await drive('files', {
        query: paramsListagem({ driveId, q: montarQueryBusca({ pastaId }), pageToken: body.pageToken, tamanho: body.tamanho }),
      });
      const itens = await anexarDoIndice((r.files || []).map(paraTela).map(comLinks));
      const caminho = body.pageToken ? undefined : await caminhoDe(pastaId, driveId);
      return res.status(200).json({ pastaId, caminho, itens, proximaPagina: r.nextPageToken || null });
    }

    if (acao === 'buscar') {
      if (body.tipo && !TIPOS[body.tipo]) return res.status(400).json({ error: 'Tipo inválido.' });
      if (body.pastaId && !idValido(body.pastaId)) return res.status(400).json({ error: 'Pasta inválida.' });
      const q = montarQueryBusca({ texto: body.texto, tipo: body.tipo, pastaId: body.pastaId, desde: body.desde, ate: body.ate });
      const r = await drive('files', {
        query: paramsListagem({ driveId, q, pageToken: body.pageToken, tamanho: body.tamanho, ordem: 'modifiedTime desc' }),
      });
      const itens = await anexarDoIndice((r.files || []).map(paraTela).map(comLinks));
      return res.status(200).json({ itens, proximaPagina: r.nextPageToken || null });
    }

    if (acao === 'buscar_indice') {
      const limite = Math.min(Math.max(Number(body.tamanho) || 50, 1), 200);
      const offset = Math.max(Number(body.offset) || 0, 0);
      if (body.tipo && !TIPOS[body.tipo]) return res.status(400).json({ error: 'Tipo inválido.' });
      if (body.expedicaoId && !UUID.test(String(body.expedicaoId))) return res.status(400).json({ error: 'Expedição inválida.' });
      const dia = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
      const linhas = await rest('rpc/mkt_drive_buscar', {
        method: 'POST',
        body: {
          p_texto: body.texto ? String(body.texto).slice(0, 200) : null,
          p_tipo: body.tipo || null,
          p_pasta: body.pastaId && idValido(body.pastaId) ? body.pastaId : null,
          p_desde: dia(body.desde), p_ate: dia(body.ate),
          p_tags: Array.isArray(body.tags) && body.tags.length ? tagsLimpas(body.tags) : null,
          p_destino: body.destino ? String(body.destino).slice(0, 120) : null,
          p_expedicao: body.expedicaoId || null,
          p_limite: limite, p_offset: offset,
        },
      });
      const itens = (linhas || []).map(linhaParaTela);
      return res.status(200).json({ itens, proximoOffset: itens.length === limite ? offset + limite : null });
    }

    if (acao === 'metadados') {
      const f = await arquivoDoDrive(body.id, driveId);
      const [item] = await anexarDoIndice([comLinks(paraTela(f))]);
      const caminho = await caminhoDe(Array.isArray(f.parents) ? f.parents[0] : driveId, driveId);
      return res.status(200).json({ item: { ...item, descricao: f.description || null, miniaturaGrandeUrl: item.temMiniatura ? miniaturaUrl(item.id, 1600) : null }, caminho });
    }

    if (acao === 'criar_pasta') {
      const nome = nomeLimpo(body.nome);
      if (!nome) return res.status(400).json({ error: 'Dê um nome pra pasta.' });
      const paiId = body.paiId && body.paiId !== 'raiz' ? String(body.paiId) : driveId;
      if (paiId !== driveId) {
        const pai = await arquivoDoDrive(paiId, driveId, 'id,driveId,mimeType');
        if (pai.mimeType !== MIME_PASTA) return res.status(400).json({ error: 'O destino não é uma pasta.' });
      }
      const f = await drive('files', { method: 'POST', query: { fields: CAMPOS_ARQUIVO }, body: { name: nome, mimeType: MIME_PASTA, parents: [paiId] } });
      await gravarNoIndice([f], driveId).catch(() => {});
      return res.status(200).json({ item: comLinks(paraTela(f)) });
    }

    if (acao === 'renomear') {
      const nome = nomeLimpo(body.nome);
      if (!nome) return res.status(400).json({ error: 'O nome não pode ficar vazio.' });
      await arquivoDoDrive(body.id, driveId, 'id,driveId');
      if (body.id === driveId) return res.status(400).json({ error: 'A raiz do Drive se renomeia no Google.' });
      const f = await drive(`files/${encodeURIComponent(body.id)}`, { method: 'PATCH', query: { fields: CAMPOS_ARQUIVO }, body: { name: nome } });
      await gravarNoIndice([f], driveId).catch(() => {});
      return res.status(200).json({ item: comLinks(paraTela(f)) });
    }

    if (acao === 'mover') {
      if (body.id === driveId) return res.status(400).json({ error: 'A raiz não se move.' });
      const f0 = await arquivoDoDrive(body.id, driveId, 'id,driveId,parents');
      const destinoId = body.destinoId && body.destinoId !== 'raiz' ? String(body.destinoId) : driveId;
      if (destinoId === body.id) return res.status(400).json({ error: 'Não dá pra mover uma pasta pra dentro dela mesma.' });
      if (destinoId !== driveId) {
        const d = await arquivoDoDrive(destinoId, driveId, 'id,driveId,mimeType');
        if (d.mimeType !== MIME_PASTA) return res.status(400).json({ error: 'O destino não é uma pasta.' });
        // Pasta dentro de uma subpasta dela mesma: o Google recusa, mas a mensagem dele é ruim.
        const trilha = await caminhoDe(destinoId, driveId);
        if (trilha.some((p) => p.id === body.id)) return res.status(400).json({ error: 'Não dá pra mover uma pasta pra dentro de uma subpasta dela.' });
      }
      const antigos = (f0.parents || []).join(',');
      const f = await drive(`files/${encodeURIComponent(body.id)}`, {
        method: 'PATCH', query: { addParents: destinoId, removeParents: antigos, fields: CAMPOS_ARQUIVO }, body: {},
      });
      await gravarNoIndice([f], driveId).catch(() => {});
      return res.status(200).json({ item: comLinks(paraTela(f)) });
    }

    if (acao === 'lixeira' || acao === 'restaurar') {
      if (body.id === driveId) return res.status(400).json({ error: 'A raiz não vai pra lixeira.' });
      await arquivoDoDrive(body.id, driveId, 'id,driveId');
      const f = await drive(`files/${encodeURIComponent(body.id)}`, { method: 'PATCH', query: { fields: CAMPOS_ARQUIVO }, body: { trashed: acao === 'lixeira' } });
      await gravarNoIndice([f], driveId).catch(() => {});
      return res.status(200).json({ item: comLinks(paraTela(f)) });
    }

    if (acao === 'iniciar_envio') {
      const nome = nomeLimpo(body.nome);
      const tamanho = Number(body.tamanho);
      const mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(body.mimeType || '')) ? String(body.mimeType) : 'application/octet-stream';
      if (!nome) return res.status(400).json({ error: 'Arquivo sem nome.' });
      if (!Number.isFinite(tamanho) || tamanho <= 0) return res.status(400).json({ error: 'Arquivo vazio.' });
      if (tamanho > TAMANHO_MAX_ENVIO) return res.status(400).json({ error: 'Arquivo acima de 50 GB: suba pelo Google Drive.' });
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const origem = origemPermitida(req.headers.origin || req.headers.referer, { host });
      if (!origem) return res.status(400).json({ error: 'Origem do envio não reconhecida.' });
      const pastaId = body.pastaId && body.pastaId !== 'raiz' ? String(body.pastaId) : driveId;
      if (pastaId !== driveId) {
        const p = await arquivoDoDrive(pastaId, driveId, 'id,driveId,mimeType');
        if (p.mimeType !== MIME_PASTA) return res.status(400).json({ error: 'O destino não é uma pasta.' });
      }
      // Sessão resumable. O Origin aqui é o que faz o Google responder com CORS
      // liberado pro PUT do navegador nessa URL.
      const r = await drive('files', {
        method: 'POST', upload: true, cru: true,
        query: { uploadType: 'resumable', fields: CAMPOS_ARQUIVO },
        headers: { Origin: origem, 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(tamanho) },
        body: { name: nome, parents: [pastaId], mimeType: mime },
      });
      const uploadUrl = r.headers.get('location');
      if (!r.ok || !uploadUrl) {
        const t = await r.text().catch(() => '');
        console.error('[mkt-drive] sessão resumable', r.status, t.slice(0, 300));
        return res.status(502).json({ error: 'O Google não abriu o envio. Tente de novo.' });
      }
      return res.status(200).json({ uploadUrl, pastaId });
    }

    if (acao === 'concluir_envio') {
      const f = await arquivoDoDrive(body.id, driveId);
      await gravarNoIndice([f], driveId);
      const extra = await camposDoQs(body);
      await patchIndice(f.id, { ...extra, subido_por: u.id, subido_em: new Date().toISOString() });
      const [item] = await anexarDoIndice([comLinks(paraTela(f))]);
      return res.status(200).json({ item });
    }

    if (acao === 'etiquetar') {
      const f = await arquivoDoDrive(body.id, driveId);
      // Arquivo que a sincronização ainda não viu: entra no índice agora.
      await gravarNoIndice([f], driveId);
      await patchIndice(f.id, await camposDoQs(body));
      const [item] = await anexarDoIndice([comLinks(paraTela(f))]);
      return res.status(200).json({ item });
    }

    if (acao === 'sincronizar') {
      return res.status(200).json({ ok: true, ...(await sincronizar({ orcamentoMs: 40_000 })) });
    }

    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (e) {
    if (e?.code === 'DRIVE_CONFIG') return res.status(503).json({ error: e.message, configurar: true });
    console.error('[mkt-drive]', acao, e?.message);
    const st = e?.status;
    if (st === 400 || st === 403) return res.status(st).json({ error: e.message });
    if (st === 404) return res.status(404).json({ error: 'Não achei esse arquivo no Drive (pode ter sido apagado).' });
    if (e?.code === 'DRIVE_AUTH') return res.status(502).json({ error: 'O Google recusou a conta de serviço. Confira a chave na Vercel.' });
    return res.status(500).json({ error: 'Não deu certo agora. Tente de novo.' });
  }
}

export const _interno = { ehDoMarketing, linhaParaTela, tipoDe };
