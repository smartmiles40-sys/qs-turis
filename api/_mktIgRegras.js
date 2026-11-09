// api/_mktIgRegras.js
// -----------------------------------------------------------------------------
// INSTAGRAM NO EDITOR DE FLUXOS — a parte PURA (sem banco, sem rede). 09/11/2026.
//
// O editor de fluxo é UM só (WhatsApp e Instagram). O plano de cada bloco
// (api/_mktAutoRegras.js planoDoNo) monta o corpo no formato da Cloud API do
// WhatsApp; aqui ele é TRADUZIDO para o formato do Instagram antes de sair.
// Também moram aqui: quem dispara (comentário, DM, story, link ig.me), a regra
// da resposta privada (1 mensagem, 7 dias), a renovação do token, os links de
// entrada (wa.me / ig.me com contagem de cliques) e a conversão das regras
// simples antigas (mkt_ig_automacoes) em fluxo.
//
// Fontes (Meta, conferidas em 09/11/2026):
//  • Resposta privada: https://developers.facebook.com/docs/instagram-platform/private-replies
//    "Only one message can be sent to the commenter", "within 7 days", depois só
//    "if the recipient responds, and must be sent within 24 hours of the response".
//  • Respostas rápidas: .../instagram-api-with-instagram-login/messaging-api/quick-replies
//    (até 13, título até 20 caracteres; o clique volta em message.quick_reply.payload)
//  • Modelo de botões: .../messaging-api/button-template (1–3 botões web_url/postback, texto até 640)
//  • Mensagens: .../instagram-api-with-instagram-login/messaging-api ("1000 bytes or less";
//    anexos image/video/audio/file(pdf))
//  • Webhooks: https://developers.facebook.com/docs/instagram-platform/webhooks/examples
//  • ig.me com ref: https://developers.facebook.com/docs/messenger-platform/instagram/features/ig-me-links
//    (ref: letras, números, - _ =; chega em messaging[].referral.ref)
//  • Token: https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token
//    (ig_refresh_token, token com 24 h+ de vida, vale 60 dias) e .../reference/access_token
//    (ig_exchange_token: curto → longo, com o segredo do app)
// -----------------------------------------------------------------------------

import { casaPalavraChave, normalizarTexto, linkDeReferencia } from './_mktAutoRegras.js';

export const LIMITES_IG = {
  textoBytes: 1000,
  textoModelo: 640,
  respostasRapidas: 13,
  tituloBotao: 20,
  botoesModelo: 3,
  privadaDias: 7,
};

export const GATILHOS_IG_FLUXO = ['ig_comentario', 'ig_dm_palavra', 'ig_story_resposta', 'ig_story_mencao', 'ig_boas_vindas', 'ig_ref'];

/** Corta pelo tamanho em BYTES (a Meta conta bytes UTF-8), sem partir um caractere. */
export function cortarBytes(texto, max = LIMITES_IG.textoBytes) {
  const s = String(texto ?? '');
  if (Buffer.byteLength(s, 'utf8') <= max) return s;
  let out = '';
  let n = 0;
  for (const ch of s) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (n + b > max - 3) break;
    out += ch;
    n += b;
  }
  return `${out}…`;
}

const corta = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function textoDaInterativa(it) {
  return [it?.header?.text, it?.body?.text, it?.footer?.text].map((x) => String(x ?? '').trim()).filter(Boolean).join('\n\n');
}

/**
 * Um corpo da Cloud API do WhatsApp → as mensagens do Instagram, NA ORDEM.
 * `{ mensagens: [message, ...] }` ou `{ erro }`. Mídia com legenda vira 2
 * mensagens (o Instagram não tem legenda em anexo).
 */
export function corpoParaInstagram(corpo) {
  const t = String(corpo?.type ?? '');
  if (t === 'text') return { mensagens: [{ text: cortarBytes(corpo.text?.body) }] };
  if (t === 'template') return { erro: 'Modelo (template) é só do WhatsApp — no Instagram use uma Mensagem.' };
  if (t === 'interactive') {
    const it = corpo.interactive || {};
    const texto = textoDaInterativa(it);
    if (it.type === 'button' || it.type === 'list') {
      const opcoes = it.type === 'button'
        ? (it.action?.buttons || []).map((b) => ({ id: b.reply?.id, titulo: b.reply?.title }))
        : (it.action?.sections || []).flatMap((s) => (s.rows || []).map((r) => ({ id: r.id, titulo: r.title })));
      const quick = opcoes.filter((o) => o.id && o.titulo).slice(0, LIMITES_IG.respostasRapidas)
        .map((o) => ({ content_type: 'text', title: corta(o.titulo, LIMITES_IG.tituloBotao), payload: String(o.id) }));
      return { mensagens: [{ text: cortarBytes(texto), ...(quick.length ? { quick_replies: quick } : {}) }] };
    }
    if (it.type === 'cta_url') {
      const p = it.action?.parameters || {};
      if (!/^https?:\/\//i.test(String(p.url ?? ''))) return { mensagens: [{ text: cortarBytes(texto) }] };
      return {
        mensagens: [{
          attachment: {
            type: 'template',
            payload: { template_type: 'button', text: corta(texto, LIMITES_IG.textoModelo), buttons: [{ type: 'web_url', url: String(p.url), title: corta(p.display_text || 'Abrir', LIMITES_IG.tituloBotao) }] },
          },
        }],
      };
    }
    return { mensagens: [{ text: cortarBytes(texto) }] };
  }
  const tipoIg = { image: 'image', video: 'video', audio: 'audio', document: 'file' }[t];
  if (tipoIg) {
    const m = corpo[t] || {};
    if (!/^https:\/\//i.test(String(m.link ?? ''))) return { erro: 'Mídia sem link https.' };
    const saem = [{ attachment: { type: tipoIg, payload: { url: String(m.link) } } }];
    if (m.caption) saem.push({ text: cortarBytes(m.caption) });
    return { mensagens: saem };
  }
  return { erro: `Tipo de mensagem que o Instagram não aceita: ${t || '?'}.` };
}

/** Versão só-texto (se a Meta recusar botões na resposta privada, manda o texto). */
export function soTextoIg(message) {
  const t = message?.text ?? message?.attachment?.payload?.text ?? '';
  return t ? { text: cortarBytes(t) } : null;
}

/** Uma linha legível do que saiu. */
export function previaIg(message) {
  if (typeof message?.text === 'string') return message.text;
  const a = message?.attachment;
  if (a?.type === 'template') return String(a.payload?.text ?? '[botões]');
  const rotulo = { image: 'imagem', video: 'vídeo', audio: 'áudio', file: 'arquivo' };
  return a ? `[${rotulo[a.type] ?? a.type}]` : '[mensagem]';
}

// ── O que a pessoa fez ──────────────────────────────────────────────────────

/** Um item de `entry[].messaging[]` → o que o motor precisa. */
export function lerEntradaIg(m) {
  const msg = m?.message || null;
  const post = m?.postback || null;
  const anexo = msg?.attachments?.[0];
  const ref = String(m?.referral?.ref ?? msg?.referral?.ref ?? post?.referral?.ref ?? '').trim() || null;
  const ehMencaoStory = anexo?.type === 'story_mention';
  const ehRespostaStory = Boolean(msg?.reply_to?.story);
  const idResposta = post?.payload ?? msg?.quick_reply?.payload ?? null;
  const texto = post ? String(post.title ?? '') : String(msg?.text ?? '');
  const tipo = ehMencaoStory ? 'story_mencao' : ehRespostaStory ? 'story_resposta' : post ? 'postback'
    : msg?.quick_reply ? 'resposta_botao' : anexo ? (anexo.type ?? 'anexo') : msg ? 'texto' : ref ? 'referral' : 'outro';
  const previa = texto || (ehMencaoStory ? 'Mencionou você no story' : anexo ? `[${anexo.type}]` : ref ? `Abriu pelo link (${ref})` : '');
  return { tipo, texto, idResposta: idResposta ? String(idResposta) : null, ref, ehMencaoStory, ehRespostaStory, previa, mid: msg?.mid ?? post?.mid ?? null };
}

/** O código do link de entrada que veio no `ref` do ig.me. */
export function codigoDoRef(ref) {
  const r = String(ref ?? '').trim().toLowerCase();
  return /^[a-z0-9_-]{2,40}$/.test(r) ? r : null;
}

const ativos = (gs, tipo) => (gs || []).filter((g) => g.tipo === tipo && g.ativo !== false);

/**
 * Quem responde a uma DM que não foi clique nem resposta esperada.
 * Ordem: link ig.me → menção no story → resposta ao story → palavra → boas-vindas.
 */
export function escolherGatilhoIgDm(gatilhos, entrada, { nova = false } = {}) {
  const codigo = codigoDoRef(entrada?.ref);
  if (codigo) {
    const g = ativos(gatilhos, 'ig_ref').find((x) => String(x.config?.codigo ?? '').toLowerCase() === codigo);
    if (g) return g;
  }
  if (entrada?.ehMencaoStory) return ativos(gatilhos, 'ig_story_mencao')[0] ?? null;
  if (entrada?.ehRespostaStory) {
    const g = ativos(gatilhos, 'ig_story_resposta').find((x) => {
      const ps = (x.config?.palavras ?? []).filter((p) => normalizarTexto(p));
      return !ps.length || x.config?.qualquer_palavra || casaPalavraChave(entrada.texto, { palavras: ps, modo: 'contem' });
    });
    if (g) return g;
  }
  if (entrada?.texto) {
    const g = ativos(gatilhos, 'ig_dm_palavra').find((x) => x.config?.qualquer_palavra || casaPalavraChave(entrada.texto, x.config));
    if (g) return g;
  }
  if (nova) return ativos(gatilhos, 'ig_boas_vindas')[0] ?? null;
  return null;
}

/**
 * Qual gatilho responde a um comentário: o mais específico ganha (posts
 * escolhidos > palavra > qualquer comentário); empate → prioridade, depois o mais antigo.
 */
export function escolherGatilhoIgComentario(gatilhos, texto, mediaId) {
  const c = ativos(gatilhos, 'ig_comentario').filter((g) => {
    const posts = (g.config?.posts ?? []).map(String);
    if (posts.length && (!mediaId || !posts.includes(String(mediaId)))) return false;
    const palavras = (g.config?.palavras ?? []).filter((p) => normalizarTexto(p));
    if (g.config?.qualquer_palavra || !palavras.length) return true;
    return casaPalavraChave(texto, { palavras, modo: g.config?.modo ?? 'contem' });
  });
  const peso = (g) => ((g.config?.posts ?? []).length ? 2 : 0) + (!g.config?.qualquer_palavra && (g.config?.palavras ?? []).length ? 1 : 0);
  return [...c].sort((a, b) => peso(b) - peso(a) || (b.prioridade ?? 0) - (a.prioridade ?? 0) || String(a.criado_em ?? '').localeCompare(String(b.criado_em ?? '')))[0] ?? null;
}

/** Confere e limpa a configuração de um gatilho do Instagram. `{ config }` ou `{ erro }`. */
export function limparConfigGatilhoIg(tipo, bruta) {
  const c = bruta && typeof bruta === 'object' ? bruta : {};
  const lista = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,\n]/)).map((x) => String(x).trim()).filter(Boolean);
  switch (tipo) {
    case 'ig_comentario': {
      const palavras = lista(c.palavras).slice(0, 30);
      const qualquer = Boolean(c.qualquer_palavra);
      if (!palavras.length && !qualquer) return { erro: 'Escreva as palavras ou marque "qualquer comentário".' };
      return { config: {
        palavras: qualquer ? [] : palavras, qualquer_palavra: qualquer, modo: c.modo === 'exata' || c.modo === 'comeca' ? c.modo : 'contem',
        posts: lista(c.posts).filter((p) => /^\d+$/.test(p)).slice(0, 50),
        respostas_publicas: lista(Array.isArray(c.respostas_publicas) ? c.respostas_publicas : String(c.respostas_publicas ?? '').split('\n')).map((r) => r.slice(0, 300)).slice(0, 10),
      } };
    }
    case 'ig_dm_palavra': {
      const palavras = lista(c.palavras).slice(0, 30);
      if (!palavras.length && !c.qualquer_palavra) return { erro: 'Escreva pelo menos uma palavra.' };
      return { config: { palavras, qualquer_palavra: Boolean(c.qualquer_palavra), modo: c.modo === 'exata' || c.modo === 'comeca' ? c.modo : 'contem' } };
    }
    case 'ig_story_resposta':
      return { config: { palavras: lista(c.palavras).slice(0, 30) } };
    case 'ig_story_mencao':
    case 'ig_boas_vindas':
      return { config: {} };
    case 'ig_ref': {
      const codigo = normalizarTexto(String(c.codigo ?? '')).replace(/\s+/g, '-').slice(0, 40);
      if (!/^[a-z0-9_-]{2,40}$/.test(codigo)) return { erro: 'O código do link usa letras, números e hífen (2 a 40).' };
      return { config: { codigo, nome: String(c.nome ?? '').trim().slice(0, 80) } };
    }
    default:
      return { erro: 'Tipo de gatilho do Instagram desconhecido.' };
  }
}

// ── Resposta privada (comentário → DM) ──────────────────────────────────────

/**
 * Ainda dá pra usar a resposta privada? Uma mensagem só, até 7 dias depois do
 * comentário (margem de 10 min). `privada` = { comment_id, em, usada }.
 */
export function privadaDisponivel(privada, agora = Date.now()) {
  if (!privada?.comment_id || privada.usada) return false;
  const t = Date.parse(privada.em ?? '');
  if (!Number.isFinite(t)) return false;
  const a = agora instanceof Date ? agora.getTime() : Number(agora);
  return a - t < LIMITES_IG.privadaDias * 86_400_000 - 10 * 60_000;
}

/** Para onde vai a próxima DM: conversa aberta → id; senão a resposta privada; senão não sai. */
export function destinoDaDm({ igsid, janela, privada }, agora = Date.now()) {
  if (janela) return { id: String(igsid) };
  if (privadaDisponivel(privada, agora)) return { comment_id: String(privada.comment_id) };
  return null;
}

// ── Token: renovação e situação ─────────────────────────────────────────────

const H = 3_600_000;
const D = 24 * H;

/**
 * Renovar o token desta conta agora? Só token com 24 h+ de vida (regra da Meta),
 * sem tentativa nas últimas 12 h, e que vence em menos de 15 dias (ou validade
 * desconhecida). Token já vencido não renova — precisa conectar de novo.
 */
export function precisaRenovarToken(conta, agora = Date.now()) {
  if (!conta || conta.status === 'desconectada') return false;
  const ms = (v) => (v ? Date.parse(v) : NaN);
  const tentativa = ms(conta.token_tentativa_em);
  if (Number.isFinite(tentativa) && agora - tentativa < 12 * H) return false;
  const emitido = ms(conta.token_renovado_em) || ms(conta.criado_em);
  if (Number.isFinite(emitido) && agora - emitido < D) return false;
  const expira = ms(conta.token_expira_em);
  if (Number.isFinite(expira) && expira <= agora) return false;
  return !Number.isFinite(expira) || expira - agora < 15 * D;
}

/** 'ok' | 'vence_logo' (< 7 dias) | 'vencido' | 'erro' | 'desconhecido'. */
export function situacaoToken(conta, agora = Date.now()) {
  if (!conta) return 'desconhecido';
  if (conta.status === 'erro') return 'erro';
  const expira = conta.token_expira_em ? Date.parse(conta.token_expira_em) : NaN;
  if (!Number.isFinite(expira)) return 'desconhecido';
  if (expira <= agora) return 'vencido';
  return expira - agora < 7 * D ? 'vence_logo' : 'ok';
}

// ── Links de entrada (growth tools) ─────────────────────────────────────────

export function linkIgMe(usuario, codigo) {
  const u = String(usuario ?? '').replace(/^@/, '').trim();
  return `https://ig.me/m/${encodeURIComponent(u)}?ref=${encodeURIComponent(codigo)}`;
}

/** O destino do /e/<código>: wa.me com [ref:…] ou ig.me?ref=…; null se faltar o número/conta. */
export function destinoDaEntrada(g, { numero = null, usuarioIg = null } = {}) {
  const codigo = String(g?.codigo ?? g?.config?.codigo ?? '');
  if (!codigo) return null;
  if (g.tipo === 'link_ref') return numero ? linkDeReferencia(numero, codigo, g.texto ?? g.config?.texto) : null;
  if (g.tipo === 'ig_ref') return usuarioIg ? linkIgMe(usuarioIg, codigo) : null;
  return null;
}

/** Robôs de pré-visualização (WhatsApp, Facebook, Telegram…) não contam como clique. */
export function ehRobo(ua) {
  return /bot|crawler|spider|preview|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|skype|linkedin|twitter|curl|wget|python|headless/i.test(String(ua ?? ''));
}

// ── Regra simples antiga → fluxo ────────────────────────────────────────────

const GATILHO_DA_REGRA = { comentario: 'ig_comentario', dm_palavra: 'ig_dm_palavra', story_resposta: 'ig_story_resposta', story_mencao: 'ig_story_mencao', boas_vindas: 'ig_boas_vindas' };

/**
 * Uma automação de mkt_ig_automacoes vira { nome, grafo, gatilho } no editor de
 * fluxos: Início → Mensagem (texto + 1º botão de link; os outros links viram
 * linhas do texto) → Ações (as tags). Marcadores {{nome}}/{{usuario}} seguem
 * valendo ({{nome}} → nome do contato; {{usuario}} → @ da pessoa).
 */
export function fluxoDaRegraIg(regra) {
  const tipo = GATILHO_DA_REGRA[regra?.gatilho];
  if (!tipo) return { erro: 'Regra com gatilho desconhecido.' };
  const c = regra.config || {};
  const botoes = (c.dm_botoes ?? []).filter((b) => b?.titulo && /^https?:\/\//i.test(b.url ?? ''));
  const extras = botoes.slice(1).map((b) => `${b.titulo}: ${b.url}`);
  const texto = [String(c.dm_texto ?? '').trim(), ...extras].filter(Boolean).join('\n');
  const nos = [{ id: 'ini_1', tipo: 'inicio', x: 40, y: 160, dados: {} }];
  const ligacoes = [];
  let anterior = 'ini_1';
  if (texto) {
    nos.push({
      id: 'men_1', tipo: 'mensagem', x: 340, y: 120,
      dados: { blocos: [{ tipo: 'texto', texto }], interacao: botoes[0] ? { tipo: 'link', rotulo: botoes[0].titulo.slice(0, 20), url: botoes[0].url } : { tipo: 'nenhuma' }, digitando: false },
    });
    ligacoes.push({ id: 'l_1', de: anterior, saida: 'proximo', para: 'men_1' });
    anterior = 'men_1';
  }
  const tags = (c.tags ?? []).map((t) => String(t).trim()).filter(Boolean);
  if (tags.length) {
    nos.push({ id: 'aca_1', tipo: 'acao', x: 640, y: 160, dados: { acoes: tags.map((tag) => ({ tipo: 'adicionar_tag', tag })) } });
    ligacoes.push({ id: 'l_2', de: anterior, saida: 'proximo', para: 'aca_1' });
  }
  const config = tipo === 'ig_comentario'
    ? { palavras: c.palavras ?? [], qualquer_palavra: Boolean(c.qualquer_palavra), posts: c.posts ?? [], respostas_publicas: c.respostas_publicas ?? [] }
    : tipo === 'ig_dm_palavra' ? { palavras: c.palavras ?? [], qualquer_palavra: Boolean(c.qualquer_palavra) }
    : tipo === 'ig_story_resposta' ? { palavras: c.qualquer_palavra ? [] : c.palavras ?? [] }
    : {};
  return { nome: regra.nome || 'Automação do Instagram', grafo: { nos, ligacoes }, gatilho: { tipo, config } };
}
