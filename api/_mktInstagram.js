// api/_mktInstagram.js
// -----------------------------------------------------------------------------
// INSTAGRAM DO @ DA AGÊNCIA — automações (porte do SendFlow, 0025). 30/10/2026.
//
// NASCE DESLIGADO: mkt_auto_config.instagram.ligado = false. Enquanto estiver
// assim, o webhook (/api/mkt-instagram) responde 200 e não grava nem responde
// nada. O que o Bruno precisa fazer no painel da Meta: docs/MARKETING-AUTOMACOES.md.
//
//   comentário em post   → resposta pública no comentário + DM privada (Private Reply)
//   resposta a story     → DM
//   menção em story      → DM
//   palavra na DM        → DM
//   1ª mensagem          → boas-vindas
//
// Idempotente: comentário por comment_id único (insere ANTES de responder),
// DM por mid único. Laço: a resposta pública volta como comentário da PRÓPRIA
// conta e a DM volta como eco — os dois são reconhecidos e ignorados.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';

export const IG_GRAPH = 'https://graph.instagram.com/v23.0';
const enc = encodeURIComponent;
const quieto = (p) => Promise.resolve(p).catch((e) => console.warn('[mkt-ig]', e?.message));

// ── Regras puras ────────────────────────────────────────────────────────────

export const GATILHOS_IG = ['comentario', 'dm_palavra', 'story_resposta', 'story_mencao', 'boas_vindas'];

/** Minúsculas, sem acento, sem pontuação (mantém # e @). */
export function normalizarIg(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s#@]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Palavra (ou expressão) INTEIRA: "eu" não casa com "europa". */
export function casaPalavra(texto, palavra) {
  const p = normalizarIg(palavra);
  return Boolean(p) && ` ${normalizarIg(texto)} `.includes(` ${p} `);
}

export function casaAlguma(texto, cfg = {}) {
  const palavras = (cfg.palavras ?? []).filter((p) => normalizarIg(p));
  if (!palavras.length) return Boolean(cfg.qualquer_palavra);
  return palavras.some((p) => casaPalavra(texto, p));
}

function ordenarPorEspecificidade(lista) {
  const peso = (a) => ((a.config?.posts ?? []).length ? 2 : 0) + ((a.config?.palavras ?? []).length ? 1 : 0);
  return [...lista].sort((x, y) => peso(y) - peso(x) || String(x.criado_em ?? '').localeCompare(String(y.criado_em ?? '')));
}

/** Qual automação responde a um comentário: a mais específica ganha (post > palavra > qualquer). */
export function escolherParaComentario(automacoes, texto, mediaId) {
  const c = (automacoes || []).filter((a) => {
    if (!a.ativo || a.gatilho !== 'comentario') return false;
    const posts = a.config?.posts ?? [];
    if (posts.length && (!mediaId || !posts.includes(mediaId))) return false;
    return casaAlguma(texto, a.config);
  });
  return ordenarPorEspecificidade(c)[0] ?? null;
}

export function escolherParaDm(automacoes, ev) {
  const ativas = (automacoes || []).filter((a) => a.ativo);
  const doTipo = (g) => ordenarPorEspecificidade(ativas.filter((a) => a.gatilho === g));
  if (ev.ehMencaoStory) return doTipo('story_mencao')[0] ?? null;
  if (ev.ehRespostaStory) {
    const r = doTipo('story_resposta').find((a) => casaAlguma(ev.texto, { ...a.config, qualquer_palavra: a.config?.qualquer_palavra ?? !(a.config?.palavras ?? []).length }));
    if (r) return r;
  }
  const porPalavra = doTipo('dm_palavra').find((a) => casaAlguma(ev.texto, a.config));
  if (porPalavra) return porPalavra;
  if (ev.primeiraMensagem) return doTipo('boas_vindas')[0] ?? null;
  return null;
}

export function personalizarIg(texto, pessoa = {}) {
  const primeiro = String(pessoa.nome ?? '').trim().split(/\s+/)[0] || String(pessoa.username ?? '').trim() || '';
  return String(texto ?? '')
    .replace(/\{\{\s*(nome|primeiro_nome)\s*\}\}/gi, primeiro)
    .replace(/\{\{\s*usuario\s*\}\}/gi, pessoa.username ? `@${pessoa.username}` : primeiro)
    .replace(/[ \t]+([,.!?])/g, '$1')
    .trim();
}

/** Corpo `message`: com botões (até 3, título até 20, texto até 640) ou texto puro (até 1000). */
export function montarMensagemIg(texto, botoes = []) {
  const validos = (botoes || []).filter((b) => b.titulo?.trim() && /^https?:\/\//i.test(b.url ?? '')).slice(0, 3);
  if (!validos.length) return { text: String(texto).slice(0, 1000) };
  return {
    attachment: {
      type: 'template',
      payload: { template_type: 'button', text: String(texto).slice(0, 640), buttons: validos.map((b) => ({ type: 'web_url', url: b.url.trim(), title: b.titulo.trim().slice(0, 20) })) },
    },
  };
}

export function sortear(lista, aleatorio = Math.random) {
  if (!lista?.length) return null;
  return lista[Math.floor(aleatorio() * lista.length)] ?? lista[0];
}

/** Janela de 24 h do Instagram para mensagem livre (a resposta privada a comentário tem regra própria: 7 dias, 1 vez). */
export function janelaIg(ultimaEntrada, agora = new Date()) {
  if (!ultimaEntrada) return false;
  return agora.getTime() - Date.parse(ultimaEntrada) < 24 * 3_600_000;
}

/** Confere e limpa a automação que vem da tela. */
export function validarAutomacaoIg(entrada) {
  const nome = String(entrada?.nome ?? '').trim();
  if (!nome) return { ok: false, erro: 'Dê um nome à automação.' };
  const gatilho = String(entrada?.gatilho ?? '');
  if (!GATILHOS_IG.includes(gatilho)) return { ok: false, erro: 'Escolha o gatilho.' };
  const c = entrada.config ?? {};
  const lista = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,\n]/)).map((x) => String(x).trim()).filter(Boolean);
  const config = {
    palavras: lista(c.palavras).slice(0, 30),
    qualquer_palavra: Boolean(c.qualquer_palavra),
    posts: gatilho === 'comentario' ? lista(c.posts).filter((p) => /^\d+$/.test(p)).slice(0, 50) : [],
    respostas_publicas: gatilho === 'comentario' ? lista(Array.isArray(c.respostas_publicas) ? c.respostas_publicas : String(c.respostas_publicas ?? '').split('\n')).slice(0, 10) : [],
    dm_texto: String(c.dm_texto ?? '').trim(),
    dm_botoes: (Array.isArray(c.dm_botoes) ? c.dm_botoes : []).map((b) => ({ titulo: String(b?.titulo ?? '').trim(), url: String(b?.url ?? '').trim() })).filter((b) => b.titulo || b.url).slice(0, 3),
    tags: lista(c.tags).map((t) => t.toLowerCase()).slice(0, 10),
  };
  if ((gatilho === 'comentario' || gatilho === 'dm_palavra') && !config.palavras.length && !config.qualquer_palavra) return { ok: false, erro: 'Informe as palavras-chave ou marque "qualquer texto".' };
  if (!config.dm_texto && !config.respostas_publicas.length) return { ok: false, erro: 'Escreva a mensagem privada (ou, no comentário, uma resposta pública).' };
  if (config.dm_texto.length > 1000) return { ok: false, erro: 'A mensagem passa de 1.000 caracteres.' };
  for (const b of config.dm_botoes) {
    if (!b.titulo || !/^https?:\/\//i.test(b.url)) return { ok: false, erro: 'Cada botão precisa de título e de um link começando com https://.' };
    if (b.titulo.length > 20) return { ok: false, erro: `O botão "${b.titulo}" passa de 20 caracteres.` };
  }
  if (config.dm_botoes.length && config.dm_texto.length > 640) return { ok: false, erro: 'Com botões, a mensagem pode ter até 640 caracteres.' };
  return { ok: true, valor: { nome, gatilho, ativo: entrada.ativo === undefined ? true : Boolean(entrada.ativo), config } };
}

// ── API do Instagram ────────────────────────────────────────────────────────

const cacheToken = new Map();
async function tokenDaConta(igUserId) {
  const g = cacheToken.get(igUserId);
  if (g && g.ate > Date.now()) return g.token;
  const t = await rest('rpc/mkt_ig_token', { method: 'POST', body: { p_ig_user_id: igUserId } }).catch(() => null);
  const token = typeof t === 'string' && t ? t : null;
  cacheToken.set(igUserId, { token, ate: Date.now() + 60_000 });
  return token;
}

function traduzir(codigo, sub, msg) {
  if (codigo === 190) return 'O token do Instagram expirou ou foi revogado — conecte a conta de novo.';
  if (codigo === 10 && sub === 2534022) return 'Fora da janela de 24 h: a pessoa precisa mandar mensagem primeiro.';
  if (codigo === 10 || codigo === 200) return `Permissão negada pela Meta (${msg}). Confira as permissões do app.`;
  if (codigo === 551) return 'Essa pessoa não pode receber mensagens desta conta agora.';
  return msg;
}

export async function ig(caminho, { method = 'GET', body, token = null, conta = null, timeoutMs = 15_000 } = {}) {
  const tk = token || (conta ? await tokenDaConta(conta) : null);
  if (!tk) throw new Error('Conta do Instagram sem token — conecte de novo.');
  const url = caminho.startsWith('http') ? caminho : `${IG_GRAPH}${caminho}`;
  const r = await fetch(url, {
    method, headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw new Error(traduzir(j?.error?.code ?? null, j?.error?.error_subcode ?? null, j?.error?.message || `erro ${r.status}`));
  return j;
}

// ── Motor ───────────────────────────────────────────────────────────────────

export async function instagramLigado() {
  const r = await rest('mkt_auto_config?select=valor&chave=eq.instagram&limit=1').catch(() => null);
  return r?.[0]?.valor?.ligado === true;
}

async function automacoesAtivas() {
  const r = await rest('mkt_ig_automacoes?select=id,nome,ativo,gatilho,config,criado_em&ativo=eq.true').catch(() => []);
  return Array.isArray(r) ? r : [];
}

async function garantirConversaIg(conta, igsid, dados = {}) {
  const sel = 'id,nome,username,tags,automacao_pausada_ate,nao_lidas';
  const ja = (await rest(`mkt_ig_conversas?select=${sel}&conta_id=eq.${conta.id}&igsid=eq.${enc(igsid)}&limit=1`))?.[0];
  if (ja) return { ...ja, nova: false };
  let perfil = {};
  try { perfil = await ig(`/${igsid}?fields=name,username`, { conta: conta.ig_user_id, timeoutMs: 6000 }); } catch { perfil = {}; }
  const r = await rest(`mkt_ig_conversas?on_conflict=conta_id,igsid&select=${sel}`, {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
    body: { conta_id: conta.id, igsid, nome: perfil.name ?? null, username: perfil.username ?? dados.username ?? null },
  });
  return { ...(r?.[0] || {}), nova: true };
}

export async function enviarDm(conta, conversaId, destino, message, origem, automacaoId = null) {
  const previa = typeof message.text === 'string' ? message.text : String(message.attachment?.payload?.text ?? '[mensagem]');
  try {
    const r = await ig(`/${conta.ig_user_id}/messages`, { method: 'POST', conta: conta.ig_user_id, body: { recipient: destino, message } });
    await quieto(rest('mkt_ig_mensagens', { method: 'POST', prefer: 'return=minimal', body: { conversa_id: conversaId, direcao: 'saida', tipo: destino.comment_id ? 'resposta_privada' : 'texto', texto: previa, payload: message, mid: r.message_id ?? null, origem, automacao_id: automacaoId } }));
    await quieto(rest(`mkt_ig_conversas?id=eq.${conversaId}`, { method: 'PATCH', prefer: 'return=minimal', body: { ultima_mensagem_em: new Date().toISOString(), ultima_previa: previa.slice(0, 140) } }));
    return r.message_id ?? null;
  } catch (e) {
    await quieto(rest('mkt_ig_mensagens', { method: 'POST', prefer: 'return=minimal', body: { conversa_id: conversaId, direcao: 'saida', tipo: 'texto', texto: previa, payload: message, status: 'falha', erro: e?.message, origem, automacao_id: automacaoId } }));
    throw e;
  }
}

async function aplicarTags(conversaId, atuais, novas = []) {
  if (!novas.length) return;
  await quieto(rest(`mkt_ig_conversas?id=eq.${conversaId}`, { method: 'PATCH', prefer: 'return=minimal', body: { tags: [...new Set([...(atuais ?? []), ...novas])] } }));
}

async function tratarComentario(conta, v, r) {
  const commentId = String(v.id ?? '');
  const fromId = String(v.from?.id ?? '');
  if (!commentId || !fromId) return;
  if (fromId === conta.ig_user_id || (v.from?.username && v.from.username === conta.username)) return; // a própria conta
  const texto = String(v.text ?? '');
  const mediaId = v.media?.id ? String(v.media.id) : null;
  const automacao = escolherParaComentario(await automacoesAtivas(), texto, mediaId);
  try {
    await rest('mkt_ig_comentarios', { method: 'POST', prefer: 'return=minimal', body: { conta_id: conta.id, comment_id: commentId, media_id: mediaId, from_id: fromId, from_username: v.from?.username ?? null, texto, automacao_id: automacao?.id ?? null } });
  } catch (e) { if (e?.status === 409) return; throw e; } // repetido
  r.comentarios++;
  if (!automacao) return;
  const pessoa = { username: v.from?.username ?? null, nome: null };
  const cfg = automacao.config || {};
  let algum = false;
  const publica = sortear(cfg.respostas_publicas ?? []);
  if (publica) {
    try {
      await ig(`/${commentId}/replies`, { method: 'POST', conta: conta.ig_user_id, body: { message: personalizarIg(publica, pessoa) } });
      await quieto(rest(`mkt_ig_comentarios?comment_id=eq.${enc(commentId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { respondido_publico_em: new Date().toISOString() } }));
      algum = true;
    } catch (e) { r.erros.push(`resposta pública: ${e?.message}`); }
  }
  if (cfg.dm_texto) {
    try {
      const conv = await garantirConversaIg(conta, fromId, { username: v.from?.username ?? null });
      await enviarDm(conta, conv.id, { comment_id: commentId }, montarMensagemIg(personalizarIg(cfg.dm_texto, { ...pessoa, nome: conv.nome }), cfg.dm_botoes), 'automacao', automacao.id);
      await aplicarTags(conv.id, conv.tags, cfg.tags);
      await quieto(rest(`mkt_ig_comentarios?comment_id=eq.${enc(commentId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { respondido_dm_em: new Date().toISOString() } }));
      algum = true;
    } catch (e) {
      r.erros.push(`resposta privada: ${e?.message}`);
      await quieto(rest(`mkt_ig_comentarios?comment_id=eq.${enc(commentId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { erro: String(e?.message).slice(0, 300) } }));
    }
  }
  if (algum) { r.respostas++; await quieto(rest('rpc/mkt_ig_contar_disparo', { method: 'POST', body: { p_automacao: automacao.id } })); }
}

async function tratarMensagem(conta, m, r) {
  const msg = m.message;
  const post = m.postback;
  const mid = msg?.mid ?? post?.mid ?? null;
  if (!mid) return;
  if (msg?.is_echo) {
    const igsid = String(m.recipient?.id ?? '');
    if (!igsid) return;
    const conv = await garantirConversaIg(conta, igsid);
    try {
      await rest('mkt_ig_mensagens', { method: 'POST', prefer: 'return=minimal', body: { conversa_id: conv.id, direcao: 'saida', texto: msg.text ?? '[mídia]', mid, origem: 'eco', payload: msg } });
    } catch (e) { if (e?.status === 409) return; throw e; } // o QS já gravou quando mandou
    // Alguém respondeu pelo celular: o robô sai do caminho por 12 h.
    await quieto(rest(`mkt_ig_conversas?id=eq.${conv.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { automacao_pausada_ate: new Date(Date.now() + 12 * 3_600_000).toISOString(), ultima_mensagem_em: new Date().toISOString(), ultima_previa: (msg.text ?? '[mídia]').slice(0, 140) } }));
    return;
  }
  if (msg?.is_deleted) return;
  const igsid = String(m.sender?.id ?? '');
  if (!igsid || igsid === conta.ig_user_id) return;
  const anexo = msg?.attachments?.[0];
  const ehMencaoStory = anexo?.type === 'story_mention';
  const ehRespostaStory = Boolean(msg?.reply_to?.story);
  const texto = post ? String(post.title ?? post.payload ?? '') : String(msg?.text ?? '');
  const tipo = ehMencaoStory ? 'story_mencao' : ehRespostaStory ? 'story_resposta' : post ? 'postback' : anexo ? (anexo.type ?? 'anexo') : 'texto';
  const conv = await garantirConversaIg(conta, igsid);
  try {
    await rest('mkt_ig_mensagens', { method: 'POST', prefer: 'return=minimal', body: { conversa_id: conv.id, direcao: 'entrada', tipo, texto: texto || (ehMencaoStory ? 'Mencionou você no story' : anexo ? `[${anexo.type}]` : ''), payload: m, mid, origem: 'cliente' } });
  } catch (e) { if (e?.status === 409) return; throw e; }
  r.mensagens++;
  const agora = new Date().toISOString();
  await quieto(rest(`mkt_ig_conversas?id=eq.${conv.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ultima_entrada_em: agora, ultima_mensagem_em: agora, ultima_previa: (texto || `[${tipo}]`).slice(0, 140), nao_lidas: Number(conv.nao_lidas ?? 0) + 1 } }));
  await quieto(rest(`mkt_ig_contas?id=eq.${conta.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ultima_entrada_em: agora } }));
  if (conv.automacao_pausada_ate && Date.parse(conv.automacao_pausada_ate) > Date.now()) return;
  const automacao = escolherParaDm(await automacoesAtivas(), { texto, ehRespostaStory, ehMencaoStory, primeiraMensagem: conv.nova });
  if (!automacao?.config?.dm_texto) return;
  try {
    await enviarDm(conta, conv.id, { id: igsid }, montarMensagemIg(personalizarIg(automacao.config.dm_texto, conv), automacao.config.dm_botoes), 'automacao', automacao.id);
    await aplicarTags(conv.id, conv.tags, automacao.config.tags);
    await quieto(rest('rpc/mkt_ig_contar_disparo', { method: 'POST', body: { p_automacao: automacao.id } }));
    r.respostas++;
  } catch (e) { r.erros.push(`resposta na DM: ${e?.message}`); }
}

/** Entrada do webhook `object: instagram`. Nunca lança. */
export async function processarWebhookInstagram(payload) {
  const r = { mensagens: 0, comentarios: 0, respostas: 0, erros: [], desligado: false };
  if (payload?.object !== 'instagram') return r;
  if (!(await instagramLigado())) { r.desligado = true; return r; }
  for (const e of payload.entry ?? []) {
    const conta = (await rest(`mkt_ig_contas?select=id,ig_user_id,username,status&ig_user_id=eq.${enc(String(e.id ?? ''))}&limit=1`).catch(() => null))?.[0];
    if (!conta || conta.status !== 'conectada') continue;
    for (const m of e.messaging ?? []) {
      try { await tratarMensagem(conta, m, r); } catch (err) { r.erros.push(err?.message || String(err)); }
    }
    for (const c of e.changes ?? []) {
      if (c.field !== 'comments' && c.field !== 'live_comments') continue;
      try { if (c.value) await tratarComentario(conta, c.value, r); } catch (err) { r.erros.push(err?.message || String(err)); }
    }
  }
  return r;
}
