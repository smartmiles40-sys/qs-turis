// api/_mktRegras.js
// -----------------------------------------------------------------------------
// AUTOMAÇÕES DO MARKETING — a parte PURA (sem banco, sem rede). 30/10/2026.
//
// Portado do SendFlow (src/lib/automacao/montar.ts + tipos.ts + o "o que fazer
// neste bloco" do motor.ts). Tudo que decide O QUE sai e PARA ONDE o fluxo vai
// mora aqui; o motor (_mktMotor.js) só busca os dados, chama estas funções e
// grava/manda o resultado. É isso que deixa testar cada regra sem banco e sem
// gastar mensagem (tests/mkt/*.test.ts).
//
// O editor (src/mkt/automacoes/tipos.ts) tem uma cópia em TypeScript de
// `saidasDoNo` — o QS não compartilha código entre api/ e src/. O teste
// tests/mkt/regras.test.ts confere que as duas devolvem as MESMAS saídas: se
// divergissem, uma seta desenhada no editor nunca seria seguida pelo motor.
// -----------------------------------------------------------------------------

// ── Limites da Meta ─────────────────────────────────────────────────────────
export const LIMITES = {
  botoes: 3,
  tituloBotao: 20,
  itensLista: 10,
  tituloItem: 24,
  descricaoItem: 72,
  rotuloBotaoLista: 20,
  textoInterativo: 1024,
  texto: 4096,
  cabecalho: 60,
  rodape: 60,
  legenda: 1024,
};

/** Teto de blocos por rodada (um laço sem "Aguardar" não pode prender a função). */
export const MAX_PASSOS_RODADA = 40;
/** Teto de blocos na vida de uma execução. */
export const MAX_PASSOS_TOTAL = 400;
/** "Ir para outro fluxo" / "tag adicionada" encadeados. */
export const MAX_PROFUNDIDADE = 4;

// ── Janela de 24 h ──────────────────────────────────────────────────────────
export const JANELA_MS = 24 * 60 * 60 * 1000;

/**
 * A janela de 24 h está aberta? Conta da ÚLTIMA mensagem DA PESSOA (não da
 * nossa). Margem de 2 min: a Meta conta do lado dela, e mandar no segundo 23:59
 * vira erro 131047 com o cliente esperando.
 */
export function janelaAberta(ultimaEntradaEm, agora = Date.now()) {
  if (!ultimaEntradaEm) return false;
  const t = new Date(ultimaEntradaEm).getTime();
  const a = agora instanceof Date ? agora.getTime() : Number(agora);
  return Number.isFinite(t) && a - t >= -60_000 && a - t < JANELA_MS - 2 * 60_000;
}

/** Corpo que pode sair FORA da janela? Só template. */
export function podeSairForaDaJanela(corpo) {
  return String(corpo?.type || '') === 'template';
}

// ── Telefone ────────────────────────────────────────────────────────────────

/** Só dígitos, com 55 na frente quando é número brasileiro sem DDI. */
export function normalizarTelefone(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}

/**
 * O telefone que vai para `mkt_contatos.telefone` (o contrato da 0242: só
 * dígitos com 55). Celular brasileiro de 12 dígitos ganha o nono dígito — a Meta
 * às vezes manda sem, o formulário manda com, e sem isto seriam duas pessoas.
 */
export function telefoneCanonico(v) {
  const d = normalizarTelefone(v);
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return `${d.slice(0, 4)}9${d.slice(4)}`;
  return d;
}

/** As formas do mesmo número no Brasil: com e sem o nono dígito. */
export function variantesTelefone(v) {
  const d = normalizarTelefone(v);
  const out = new Set(d ? [d] : []);
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) out.add(`${d.slice(0, 4)}9${d.slice(4)}`);
  if (/^55\d{2}9\d{8}$/.test(d)) out.add(`${d.slice(0, 4)}${d.slice(5)}`);
  return [...out];
}

// ── Personalização ──────────────────────────────────────────────────────────

function primeiroNome(nome) {
  const n = String(nome ?? '').trim();
  return n ? n.split(/\s+/)[0] : '';
}

/**
 * `{{primeiro_nome}}`, `{{nome}}`, `{{telefone}}`, `{{email}}` e qualquer campo
 * personalizado (`{{destino}}`). Desconhecida vira vazio: "Oi {{nome}}" cru no
 * WhatsApp do cliente é pior do que "Oi ". Não escapa HTML (WhatsApp é texto).
 */
export function personalizar(texto, p = {}) {
  const mapa = {
    nome: String(p.nome ?? '').trim(),
    primeiro_nome: primeiroNome(p.nome),
    email: String(p.email ?? ''),
    telefone: String(p.telefone ?? ''),
  };
  for (const [k, v] of Object.entries(p.campos ?? {})) {
    if (v !== null && v !== undefined && typeof v !== 'object') mapa[k.toLowerCase()] = String(v);
  }
  return String(texto ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, chave) => mapa[chave.trim().toLowerCase()] ?? '');
}

const corta = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── As saídas de cada bloco ─────────────────────────────────────────────────

/**
 * As saídas que um bloco oferece. MESMA regra do editor (tipos.ts) — o teste
 * de paridade garante.
 */
export function saidasDoNo(no) {
  const d = no?.dados || {};
  switch (no?.tipo) {
    case 'inicio':
      return [{ id: 'proximo', rotulo: 'Começar' }];
    case 'mensagem': {
      const it = d.interacao || { tipo: 'nenhuma' };
      const extras = [];
      if ((d.esperarMinutos ?? 0) > 0 && it.tipo !== 'nenhuma' && it.tipo !== 'link') {
        extras.push({ id: 'sem_resposta', rotulo: 'Não respondeu', secundaria: true });
      }
      extras.push({ id: 'janela_fechada', rotulo: 'Janela de 24 h fechada', secundaria: true });
      if (it.tipo === 'botoes') {
        return [
          ...(it.botoes || []).map((b) => ({ id: b.id, rotulo: b.titulo || 'Botão' })),
          { id: 'texto_livre', rotulo: 'Digitou outra coisa', secundaria: true },
          ...extras,
        ];
      }
      if (it.tipo === 'lista') {
        return [
          ...(it.secoes || []).flatMap((s) => (s.itens || []).map((i) => ({ id: i.id, rotulo: i.titulo || 'Opção' }))),
          { id: 'texto_livre', rotulo: 'Digitou outra coisa', secundaria: true },
          ...extras,
        ];
      }
      return [{ id: 'proximo', rotulo: 'Depois de enviar' }, ...extras];
    }
    case 'template':
      return [
        { id: 'proximo', rotulo: 'Depois de enviar' },
        ...(d.botoes || []).map((b, i) => ({ id: `botao_${i}`, rotulo: b })),
        { id: 'falha', rotulo: 'Não enviou', secundaria: true },
      ];
    case 'pergunta':
      return [
        { id: 'respondeu', rotulo: 'Respondeu' },
        { id: 'nao_respondeu', rotulo: 'Não respondeu / inválido', secundaria: true },
        { id: 'janela_fechada', rotulo: 'Janela de 24 h fechada', secundaria: true },
      ];
    case 'aguardar':
      return [{ id: 'proximo', rotulo: 'Depois de esperar' }];
    case 'condicao':
      return [{ id: 'sim', rotulo: 'Sim' }, { id: 'nao', rotulo: 'Não' }];
    case 'acao':
      return [{ id: 'proximo', rotulo: 'Depois' }];
    case 'randomizador':
      return (d.variantes || []).map((v) => ({ id: v.id, rotulo: `${v.nome} · ${v.peso}%` }));
    case 'ir_para':
    case 'fim':
    default:
      return [];
  }
}

export function normalizarGrafo(g) {
  const x = g && typeof g === 'object' ? g : {};
  return { nos: Array.isArray(x.nos) ? x.nos : [], ligacoes: Array.isArray(x.ligacoes) ? x.ligacoes : [] };
}

export function proximoNo(grafo, noId, saida) {
  return (grafo?.ligacoes || []).find((l) => l.de === noId && l.saida === saida)?.para ?? null;
}

export function saidaLigada(grafo, noId, saida) {
  return proximoNo(grafo, noId, saida) !== null;
}

// ── Montagem do que sai ─────────────────────────────────────────────────────

function corpoDeMidia(b, p) {
  const chave = b.tipo === 'documento' ? 'document' : b.tipo === 'imagem' ? 'image' : b.tipo;
  const midia = { link: b.url };
  // Áudio não aceita legenda na Meta (erro 100).
  if (b.legenda && b.tipo !== 'audio') midia.caption = corta(personalizar(b.legenda, p), LIMITES.legenda);
  if (b.tipo === 'documento') midia.filename = b.nome || 'documento.pdf';
  return { type: chave, [chave]: midia };
}

/**
 * Bloco Mensagem → os corpos que saem, NA ORDEM. A interação (botões, lista,
 * link) vai presa ao ÚLTIMO texto, numa bolha só, como no ManyChat.
 */
export function montarMensagens(d, p, prefixoId = '') {
  const saem = [];
  const blocos = d?.blocos ?? [];
  const interativa = d?.interacao && d.interacao.tipo !== 'nenhuma';
  const ultimoTexto = interativa && blocos[blocos.length - 1]?.tipo === 'texto' ? blocos.length - 1 : -1;
  blocos.forEach((b, i) => {
    if (b.tipo !== 'texto') { if (b.url) saem.push(corpoDeMidia(b, p)); return; }
    const texto = personalizar(b.texto, p);
    if (!texto.trim()) return;
    if (i !== ultimoTexto) {
      saem.push({ type: 'text', text: { body: corta(texto, LIMITES.texto), preview_url: /https?:\/\//.test(texto) } });
      return;
    }
    saem.push(montarInterativa(d, texto, p, prefixoId));
  });
  return saem;
}

function montarInterativa(d, texto, p, prefixoId) {
  const it = d.interacao;
  const base = { body: { text: corta(texto, LIMITES.textoInterativo) } };
  if (d.cabecalho?.trim()) base.header = { type: 'text', text: corta(personalizar(d.cabecalho, p), LIMITES.cabecalho) };
  if (d.rodape?.trim()) base.footer = { text: corta(personalizar(d.rodape, p), LIMITES.rodape) };
  if (it.tipo === 'botoes') {
    return {
      type: 'interactive',
      interactive: {
        type: 'button', ...base,
        action: {
          buttons: (it.botoes || []).slice(0, LIMITES.botoes).map((b) => ({
            type: 'reply', reply: { id: `${prefixoId}${b.id}`, title: corta(personalizar(b.titulo, p), LIMITES.tituloBotao) },
          })),
        },
      },
    };
  }
  if (it.tipo === 'lista') {
    return {
      type: 'interactive',
      interactive: {
        type: 'list', ...base,
        action: {
          button: corta(it.rotuloBotao || 'Ver opções', LIMITES.rotuloBotaoLista),
          sections: (it.secoes || []).map((s) => ({
            ...(s.titulo ? { title: corta(s.titulo, 24) } : {}),
            rows: (s.itens || []).map((i) => ({
              id: `${prefixoId}${i.id}`,
              title: corta(personalizar(i.titulo, p), LIMITES.tituloItem),
              ...(i.descricao ? { description: corta(personalizar(i.descricao, p), LIMITES.descricaoItem) } : {}),
            })),
          })),
        },
      },
    };
  }
  if (it.tipo === 'link') {
    return {
      type: 'interactive',
      interactive: {
        type: 'cta_url', ...base,
        action: { name: 'cta_url', parameters: { display_text: corta(it.rotulo || 'Abrir', LIMITES.tituloBotao), url: personalizar(it.url, p) } },
      },
    };
  }
  return { type: 'text', text: { body: texto } };
}

/** A pergunta: texto puro, ou com as sugestões como botões. */
export function montarPergunta(d, p, prefixoId) {
  const texto = personalizar(d?.pergunta, p);
  const sugestoes = (d?.sugestoes ?? []).filter((s) => String(s).trim()).slice(0, LIMITES.botoes);
  if (!sugestoes.length) return { type: 'text', text: { body: corta(texto, LIMITES.texto) } };
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: corta(texto, LIMITES.textoInterativo) },
      action: { buttons: sugestoes.map((s, i) => ({ type: 'reply', reply: { id: `${prefixoId}_s${i}`, title: corta(s, LIMITES.tituloBotao) } })) },
    },
  };
}

/**
 * O template com as variáveis já preenchidas. `nVariaveis` vem do modelo
 * aprovado na Meta (quantos {{n}} o corpo tem); sem saber, usa o que o bloco tem.
 */
export function montarTemplate(d, p, { nVariaveis = null } = {}) {
  const chaves = Object.keys(d?.variaveis || {}).filter((k) => /^\d+$/.test(k)).map(Number);
  const n = nVariaveis ?? (chaves.length ? Math.max(...chaves) : 0);
  const params = {};
  for (let i = 1; i <= n; i++) params[String(i)] = personalizar(d.variaveis?.[String(i)] ?? '', p) || '-';
  return { nome: d?.nome || '', idioma: d?.idioma || 'pt_BR', params, cabecalhoUrl: d?.cabecalhoUrl || null };
}

/** Uma linha legível do que saiu (caixa de conversa, prévia). */
export function previaDoCorpo(c) {
  const t = String(c?.type ?? '');
  if (t === 'text') return String(c.text?.body ?? '');
  if (t === 'interactive') return String(c.interactive?.body?.text ?? '');
  if (t === 'template') return `[modelo ${c.template?.name ?? ''}]`;
  const rotulo = { image: 'imagem', video: 'vídeo', audio: 'áudio', document: 'documento' };
  const legenda = c?.[t]?.caption;
  return legenda ? `[${rotulo[t] ?? t}] ${legenda}` : `[${rotulo[t] ?? t}]`;
}

export function tipoDoCorpo(c) {
  const t = String(c?.type ?? '');
  if (t === 'text') return 'texto';
  if (t === 'interactive') {
    const it = String(c.interactive?.type ?? '');
    return it === 'button' ? 'botoes' : it === 'list' ? 'lista' : it === 'cta_url' ? 'link' : 'interativa';
  }
  return { image: 'imagem', video: 'video', audio: 'audio', document: 'documento', template: 'template' }[t] ?? t;
}

// ── Id do clique ────────────────────────────────────────────────────────────
// Todo botão que sai de um fluxo leva no id o endereço de onde ele leva:
// `f:<fluxo>:<bloco>:<saída>`. O clique chega certo mesmo dias depois, mesmo
// numa mensagem antiga — é o que se espera de um botão.

export function prefixoDeResposta(fluxoId, noId) {
  return `f:${fluxoId}:${noId}:`;
}

export function lerIdDeResposta(id) {
  const m = String(id ?? '').match(/^f:([0-9a-f-]{36}):([^:]+):(.+)$/i);
  return m ? { fluxoId: m[1], noId: m[2], saida: m[3] } : null;
}

// ── O que a pessoa mandou ───────────────────────────────────────────────────

/** Normaliza uma mensagem da Cloud API para o que o motor precisa. */
export function lerEntrada(m) {
  const ref = m?.referral || null;
  const anuncioId = ref && (ref.source_type === 'ad' || ref.source_id) ? (String(ref.source_id ?? '') || 'anuncio') : null;
  const base = { anuncioId, ctwaClid: ref?.ctwa_clid || null };
  switch (m?.type) {
    case 'text':
      return { ...base, tipo: 'texto', texto: m.text?.body ?? '', idResposta: null, previa: m.text?.body ?? '' };
    case 'interactive': {
      const br = m.interactive?.button_reply;
      if (br) return { ...base, tipo: 'resposta_botao', texto: br.title ?? '', idResposta: br.id ?? null, previa: br.title ?? '' };
      const lr = m.interactive?.list_reply;
      if (lr) return { ...base, tipo: 'resposta_lista', texto: lr.title ?? '', idResposta: lr.id ?? null, previa: lr.title ?? '' };
      return { ...base, tipo: 'interativa', texto: '', idResposta: null, previa: '[resposta]' };
    }
    case 'button':
      // Botão de resposta rápida de TEMPLATE: texto + payload.
      return { ...base, tipo: 'resposta_botao', texto: m.button?.text ?? '', idResposta: m.button?.payload ?? null, previa: m.button?.text ?? '' };
    case 'image':
      return { ...base, tipo: 'imagem', texto: m.image?.caption ?? '', idResposta: null, previa: `[imagem] ${m.image?.caption ?? ''}`.trim() };
    case 'video':
      return { ...base, tipo: 'video', texto: m.video?.caption ?? '', idResposta: null, previa: `[vídeo] ${m.video?.caption ?? ''}`.trim() };
    case 'audio':
      return { ...base, tipo: 'audio', texto: '', idResposta: null, previa: '[áudio]' };
    case 'document':
      return { ...base, tipo: 'documento', texto: m.document?.caption ?? '', idResposta: null, previa: `[documento] ${m.document?.filename ?? ''}`.trim() };
    case 'sticker':
      return { ...base, tipo: 'figurinha', texto: '', idResposta: null, previa: '[figurinha]' };
    case 'location':
      return { ...base, tipo: 'localizacao', texto: m.location?.address ?? m.location?.name ?? '', idResposta: null, previa: '[localização]' };
    case 'contacts':
      return { ...base, tipo: 'contato', texto: '', idResposta: null, previa: '[contato]' };
    case 'reaction':
      return { ...base, tipo: 'reacao', texto: '', idResposta: null, previa: `reagiu ${m.reaction?.emoji ?? ''}`.trim() };
    default:
      return { ...base, tipo: 'outro', texto: '', idResposta: null, previa: `[${m?.type ?? 'mensagem'}]` };
  }
}

// ── Palavra-chave, link de referência ───────────────────────────────────────

/** Minúsculas, sem acento, sem pontuação. "Japão!!" → "japao". */
export function normalizarTexto(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Casou a palavra? `contem` casa PALAVRA INTEIRA: "peru" não dispara com
 * "perguntar" — o erro mais irritante de robô de palavra-chave.
 */
export function casaPalavraChave(texto, cfg = {}) {
  const alvo = normalizarTexto(texto);
  if (!alvo) return false;
  const modo = cfg.modo ?? 'contem';
  return (cfg.palavras ?? []).some((bruta) => {
    const p = normalizarTexto(bruta);
    if (!p) return false;
    if (modo === 'exata') return alvo === p;
    if (modo === 'comeca') return alvo === p || alvo.startsWith(`${p} `);
    return ` ${alvo} `.includes(` ${p} `);
  });
}

/** O texto pré-preenchido do link wa.me carrega o código: "… [ref:live-peru]". */
export function codigoDeReferencia(texto) {
  const m = String(texto ?? '').match(/\[ref:([a-z0-9_-]{2,40})\]/i);
  return m ? m[1].toLowerCase() : null;
}

export function linkDeReferencia(numero, codigo, texto) {
  const frase = `${String(texto ?? '').trim() || 'Olá!'} [ref:${codigo}]`;
  return `https://wa.me/${String(numero).replace(/\D/g, '')}?text=${encodeURIComponent(frase)}`;
}

// ── Gatilhos ────────────────────────────────────────────────────────────────

export const TIPOS_GATILHO = ['palavra_chave', 'boas_vindas', 'padrao', 'link_ref', 'anuncio', 'tag_adicionada', 'webhook'];

/**
 * Qual gatilho responde a uma mensagem que NÃO foi consumida por clique nem por
 * resposta esperada. Ordem do ManyChat: link de referência → anúncio →
 * palavra-chave (prioridade) → boas-vindas (1ª mensagem) → resposta padrão
 * (com intervalo mínimo). `gatilhos` já vem só dos fluxos ATIVOS, ordenado por
 * prioridade desc e criação asc.
 */
export function escolherGatilho(gatilhos, entrada, { nova = false, respostaPadraoEm = null, agora = Date.now() } = {}) {
  const deTipo = (t) => (gatilhos || []).filter((g) => g.tipo === t && g.ativo !== false);

  const codigo = codigoDeReferencia(entrada?.texto);
  if (codigo) {
    const g = deTipo('link_ref').find((x) => String(x.config?.codigo ?? '').toLowerCase() === codigo);
    if (g) return g;
  }
  if (entrada?.anuncioId) {
    const g = deTipo('anuncio').find((x) => {
      const ids = (x.config?.ad_ids ?? []).map(String).filter(Boolean);
      return !ids.length || ids.includes(String(entrada.anuncioId));
    });
    if (g) return g;
  }
  if (entrada?.texto) {
    const g = deTipo('palavra_chave').find((x) => casaPalavraChave(entrada.texto, x.config));
    if (g) return g;
  }
  if (nova) {
    const g = deTipo('boas_vindas')[0];
    if (g) return g;
  }
  const padrao = deTipo('padrao')[0];
  if (padrao) {
    const horas = Number(padrao.config?.intervalo_horas ?? 24);
    const ultima = respostaPadraoEm ? new Date(respostaPadraoEm).getTime() : 0;
    if (!ultima || agora - ultima >= horas * 3_600_000) return padrao;
  }
  return null;
}

/** Confere e limpa a configuração de um gatilho. `{ config }` ou `{ erro }`. */
export function limparConfigGatilho(tipo, bruta, novoToken = () => '') {
  const c = bruta && typeof bruta === 'object' ? bruta : {};
  switch (tipo) {
    case 'palavra_chave': {
      const palavras = [...new Set((c.palavras ?? []).map((p) => String(p).trim()).filter(Boolean))].slice(0, 50);
      if (!palavras.length) return { erro: 'Escreva pelo menos uma palavra-chave.' };
      return { config: { palavras, modo: c.modo === 'exata' || c.modo === 'comeca' ? c.modo : 'contem' } };
    }
    case 'link_ref': {
      const codigo = normalizarTexto(String(c.codigo ?? '')).replace(/\s+/g, '-').slice(0, 40);
      if (!/^[a-z0-9_-]{2,40}$/.test(codigo)) return { erro: 'O código do link usa letras, números e hífen (2 a 40).' };
      return { config: { codigo, texto: String(c.texto ?? '').trim().slice(0, 200) } };
    }
    case 'anuncio':
      return { config: { ad_ids: (c.ad_ids ?? []).map((x) => String(x).replace(/\D/g, '')).filter(Boolean).slice(0, 50) } };
    case 'tag_adicionada': {
      const tag = String(c.tag ?? '').trim();
      if (!tag) return { erro: 'Escolha a tag.' };
      return { config: { tag } };
    }
    case 'padrao': {
      const h = Number(c.intervalo_horas ?? 24);
      return { config: { intervalo_horas: Number.isFinite(h) && h >= 0 ? Math.min(h, 720) : 24 } };
    }
    case 'webhook':
      return { config: { token: c.token && /^[a-f0-9]{24,64}$/.test(c.token) ? c.token : novoToken() } };
    case 'boas_vindas':
      return { config: {} };
    default:
      return { erro: 'Tipo de gatilho desconhecido.' };
  }
}

// ── Resposta da pergunta ────────────────────────────────────────────────────

/** Confere e normaliza. `null` = inválida (pergunta de novo). */
export function validarResposta(tipo, bruto, hoje = new Date()) {
  const v = String(bruto ?? '').trim();
  if (!v) return null;
  switch (tipo) {
    case 'numero': {
      const n = Number(v.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) && /\d/.test(v) ? String(n) : null;
    }
    case 'email': {
      const e = v.toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
    }
    case 'telefone': {
      const d = v.replace(/\D/g, '');
      if (d.length === 10 || d.length === 11) return `55${d}`;
      return d.length >= 12 && d.length <= 15 ? d : null;
    }
    case 'data': {
      const m = v.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
      if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
      const dia = Number(m[1]);
      const mes = Number(m[2]);
      let ano = m[3] ? Number(m[3]) : hoje.getFullYear();
      if (ano < 100) ano += 2000;
      if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
      return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    }
    default:
      return v.slice(0, 1000);
  }
}

// ── Condição ────────────────────────────────────────────────────────────────

function valorDoCampo(r, c) {
  switch (r.campo) {
    case 'nome': return String(c.nome ?? '');
    case 'email': return String(c.email ?? '');
    case 'telefone': return String(c.telefone ?? '');
    case 'campo': {
      const v = c.campos?.[r.chave ?? ''];
      return v === null || v === undefined ? '' : String(v);
    }
    default: return '';
  }
}

export function avaliarRegra(r, c) {
  if (r.campo === 'tag') {
    const tem = (c.tags ?? []).some((t) => normalizarTexto(t) === normalizarTexto(r.valor ?? ''));
    return r.operador === 'nao_tem' ? !tem : tem;
  }
  if (r.campo === 'janela_aberta') return r.operador === 'nao_tem' || r.operador === 'diferente' ? !c.janelaAberta : !!c.janelaAberta;
  if (r.campo === 'inscrito_whatsapp') return r.operador === 'nao_tem' || r.operador === 'diferente' ? !c.inscritoWhatsapp : !!c.inscritoWhatsapp;
  const atual = valorDoCampo(r, c);
  const a = normalizarTexto(atual);
  const b = normalizarTexto(r.valor ?? '');
  const na = Number(atual.replace(',', '.'));
  const nb = Number(String(r.valor ?? '').replace(',', '.'));
  switch (r.operador) {
    case 'igual': return a === b;
    case 'diferente': return a !== b;
    case 'contem': return b ? a.includes(b) : false;
    case 'nao_contem': return b ? !a.includes(b) : true;
    case 'vazio': return !atual.trim();
    case 'preenchido':
    case 'tem': return Boolean(atual.trim());
    case 'nao_tem': return !atual.trim();
    case 'maior': return Number.isFinite(na) && Number.isFinite(nb) ? na > nb : atual > String(r.valor ?? '');
    case 'menor': return Number.isFinite(na) && Number.isFinite(nb) ? na < nb : atual < String(r.valor ?? '');
    default: return false;
  }
}

export function avaliarCondicao(d, c) {
  const regras = d?.regras || [];
  if (!regras.length) return false;
  return d.combinar === 'qualquer' ? regras.some((r) => avaliarRegra(r, c)) : regras.every((r) => avaliarRegra(r, c));
}

// ── Teste A/B ───────────────────────────────────────────────────────────────

export function escolherVariante(variantes, sorteio = Math.random()) {
  const validas = (variantes || []).filter((v) => v.peso > 0);
  const total = validas.reduce((s, v) => s + v.peso, 0);
  if (!total) return null;
  let alvo = sorteio * total;
  for (const v of validas) {
    alvo -= v.peso;
    if (alvo < 0) return v;
  }
  return validas[validas.length - 1];
}

// ── Aguardar (hora de São Paulo) ────────────────────────────────────────────

const FMT_SP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** { data: 'AAAA-MM-DD', minutos: minutos desde 00:00 } no relógio de São Paulo. */
export function partesSP(d) {
  const p = Object.fromEntries(FMT_SP.formatToParts(d).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute) };
}

/** A hora `hh:mm` de um dia de São Paulo (sem horário de verão desde 2019: -03:00). */
export function dataSP(data, hhmm) {
  return new Date(`${data}T${hhmm}:00-03:00`);
}

function minutosDoDia(hhmm) {
  const m = String(hhmm ?? '').match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const MS = { minutos: 60_000, horas: 3_600_000, dias: 86_400_000 };

/**
 * Até quando esperar. Com faixa de horário, o fim que cair fora da faixa vai
 * para a próxima abertura — "espere 1 dia, só entre 9h e 20h" não acorda
 * ninguém às 3h só porque a pessoa escreveu de madrugada.
 */
export function calcularAcordar(d, agora = new Date()) {
  const passo = Math.max(1, Number(d?.quantidade) || 1) * (MS[d?.unidade] ?? MS.minutos);
  const alvo = new Date(agora.getTime() + passo);
  const ini = minutosDoDia(d?.janelaInicio);
  const fim = minutosDoDia(d?.janelaFim);
  if (ini === null || fim === null || ini === fim) return alvo;
  const { data, minutos } = partesSP(alvo);
  const dentro = ini < fim ? minutos >= ini && minutos < fim : minutos >= ini || minutos < fim;
  if (dentro) return alvo;
  // Faixa normal (09–20): antes de abrir → hoje na abertura; depois de fechar → amanhã.
  // Faixa que vira a noite (20–08): fora dela só pode ser entre 08 e 20 → hoje às 20.
  if (ini < fim && minutos >= fim) {
    const amanha = partesSP(new Date(dataSP(data, '12:00').getTime() + 86_400_000)).data;
    return dataSP(amanha, d.janelaInicio);
  }
  return dataSP(data, d.janelaInicio);
}

// ── O que fazer em cada bloco (o "plano") ───────────────────────────────────
//
// O motor pergunta ao plano e executa: manda os corpos, aplica as ações, grava a
// espera. O mesmo plano roda no SIMULADOR (abaixo), que é o "Testar" sem gastar
// mensagem nenhuma.
//
// Formas do plano:
//   { tipo:'seguir', saida, enviar?:[corpos], acoes?:[...] }
//   { tipo:'esperar', estado, acordarEm, aguardando, enviar?:[corpos] }
//   { tipo:'template', dados }        → o motor manda e escolhe proximo/falha/espera
//   { tipo:'ir_para', fluxoId }
//   { tipo:'fim', erro? }

export function planoDoNo(no, fluxo, { pessoa = {}, janela = false, inscrito = true, agora = new Date(), sorteio = Math.random() } = {}) {
  const grafo = fluxo?.grafo || { nos: [], ligacoes: [] };
  const d = no?.dados || {};
  const prefixo = prefixoDeResposta(fluxo?.id || '00000000-0000-0000-0000-000000000000', no?.id);
  switch (no?.tipo) {
    case 'inicio':
      return { tipo: 'seguir', saida: 'proximo' };
    case 'mensagem': {
      if (!janela) {
        if (saidaLigada(grafo, no.id, 'janela_fechada')) return { tipo: 'seguir', saida: 'janela_fechada', aviso: 'janela de 24 h fechada' };
        return { tipo: 'fim', erro: 'Janela de 24 h fechada: só modelo (template) pode sair. Use um bloco Template antes.' };
      }
      const enviar = montarMensagens(d, pessoa, prefixo);
      const it = d.interacao?.tipo;
      if (it === 'botoes' || it === 'lista') {
        const min = Number(d.esperarMinutos ?? 0);
        return {
          tipo: 'esperar', estado: 'aguardando_resposta', enviar,
          acordarEm: min > 0 ? new Date(agora.getTime() + min * 60_000).toISOString() : null,
          aguardando: { tipo: 'botoes' },
        };
      }
      return { tipo: 'seguir', saida: 'proximo', enviar };
    }
    case 'pergunta': {
      if (!janela) {
        if (saidaLigada(grafo, no.id, 'janela_fechada')) return { tipo: 'seguir', saida: 'janela_fechada', aviso: 'janela de 24 h fechada' };
        return { tipo: 'fim', erro: 'Janela de 24 h fechada: a pergunta não pôde sair.' };
      }
      const min = Number(d.esperarMinutos ?? 0);
      return {
        tipo: 'esperar', estado: 'aguardando_resposta',
        enviar: [montarPergunta(d, pessoa, prefixo)],
        acordarEm: min > 0 ? new Date(agora.getTime() + min * 60_000).toISOString() : null,
        aguardando: { tipo: 'pergunta', tentativas: 0 },
      };
    }
    case 'template':
      return { tipo: 'template', dados: d };
    case 'aguardar':
      return { tipo: 'esperar', estado: 'aguardando_tempo', acordarEm: calcularAcordar(d, agora).toISOString(), aguardando: { tipo: 'tempo' } };
    case 'condicao':
      return { tipo: 'seguir', saida: avaliarCondicao(d, { ...pessoa, janelaAberta: janela, inscritoWhatsapp: inscrito }) ? 'sim' : 'nao' };
    case 'acao':
      return { tipo: 'seguir', saida: 'proximo', acoes: d.acoes || [] };
    case 'randomizador': {
      const v = escolherVariante(d.variantes, sorteio);
      return v ? { tipo: 'seguir', saida: v.id } : { tipo: 'fim' };
    }
    case 'ir_para':
      return d.fluxoId && d.fluxoId !== fluxo?.id ? { tipo: 'ir_para', fluxoId: d.fluxoId } : { tipo: 'fim' };
    case 'fim':
    default:
      return { tipo: 'fim' };
  }
}

/** Ação aplicada na "pessoa" em memória (simulador e motor usam a mesma conta). */
export function aplicarAcaoNaPessoa(pessoa, a) {
  const p = { ...pessoa, tags: [...(pessoa.tags || [])], campos: { ...(pessoa.campos || {}) } };
  const tag = (t) => personalizar(t, pessoa).trim();
  switch (a?.tipo) {
    case 'adicionar_tag': {
      const t = tag(a.tag);
      if (t && !p.tags.some((x) => x.toLowerCase() === t.toLowerCase())) p.tags.push(t);
      break;
    }
    case 'remover_tag': {
      const t = tag(a.tag).toLowerCase();
      p.tags = p.tags.filter((x) => x.toLowerCase() !== t);
      break;
    }
    case 'adicionar_lista': {
      const t = `lista:${String(a.lista || '').trim()}`;
      if (a.lista && !p.tags.includes(t)) p.tags.push(t);
      break;
    }
    case 'remover_lista':
      p.tags = p.tags.filter((x) => x !== `lista:${String(a.lista || '').trim()}`);
      break;
    case 'definir_campo': {
      const v = personalizar(a.valor, pessoa);
      if (a.chave === 'nome' || a.chave === 'email') p[a.chave] = v || null;
      else if (v === '') delete p.campos[a.chave];
      else p.campos[a.chave] = v;
      break;
    }
    case 'limpar_campo':
      if (a.chave === 'nome' || a.chave === 'email') p[a.chave] = null;
      else delete p.campos[a.chave];
      break;
    default:
      break;
  }
  return p;
}

/**
 * O SIMULADOR: anda pelo fluxo como o motor andaria, sem banco e sem Meta.
 * Devolve cada passo e os corpos que SAIRIAM. Esperas de tempo são "puladas"
 * (anotadas); espera de clique/resposta para — a não ser que `respostas` diga
 * qual saída seguir naquele bloco ({ [noId]: 'id_da_saida' }).
 */
export function simularFluxo(fluxo, { pessoa = {}, janela = true, respostas = {}, agora = new Date(), sorteio = 0.5 } = {}) {
  const grafo = normalizarGrafo(fluxo?.grafo);
  const f = { ...fluxo, grafo };
  const passos = [];
  let p = { ...pessoa };
  let atual = grafo.nos.find((n) => n.tipo === 'inicio')?.id ?? null;
  if (!atual) return { passos, fim: 'sem bloco Início', pessoa: p };
  for (let i = 0; i < MAX_PASSOS_RODADA; i++) {
    const no = grafo.nos.find((n) => n.id === atual);
    if (!no) return { passos, fim: 'concluído', pessoa: p };
    const plano = planoDoNo(no, f, { pessoa: p, janela, agora, sorteio });
    const passo = { noId: no.id, tipo: no.tipo, titulo: no.titulo || null, enviar: plano.enviar || [], saida: null, nota: plano.aviso || null };
    passos.push(passo);
    if (plano.tipo === 'fim') return { passos, fim: plano.erro || 'concluído', erro: Boolean(plano.erro), pessoa: p };
    if (plano.tipo === 'ir_para') return { passos, fim: `vai para o fluxo ${plano.fluxoId}`, pessoa: p };
    if (plano.tipo === 'template') {
      const t = montarTemplate(plano.dados, p);
      passo.enviar = [{ type: 'template', template: { name: t.nome, language: { code: t.idioma } }, params: t.params }];
      passo.saida = 'proximo';
    } else if (plano.tipo === 'esperar') {
      if (plano.estado === 'aguardando_tempo') {
        passo.nota = `esperaria até ${plano.acordarEm}`;
        passo.saida = 'proximo';
      } else if (respostas[no.id]) {
        passo.saida = respostas[no.id];
      } else {
        return { passos, fim: 'esperando a resposta da pessoa', pessoa: p };
      }
    } else {
      for (const a of plano.acoes || []) p = aplicarAcaoNaPessoa(p, a);
      passo.saida = plano.saida;
    }
    atual = proximoNo(grafo, no.id, passo.saida);
    if (!atual) return { passos, fim: 'concluído', pessoa: p };
  }
  return { passos, fim: `parou no teto de ${MAX_PASSOS_RODADA} passos (laço sem Aguardar?)`, erro: true, pessoa: p };
}

// ── Pausa do robô ───────────────────────────────────────────────────────────

/** Robô pausado nesta conversa (atendente assumiu)? */
export function roboPausado(pausadoAte, agora = Date.now()) {
  return Boolean(pausadoAte && new Date(pausadoAte).getTime() > agora);
}

/** Responder à mão pausa o robô por N horas (padrão 12). */
export function pausaPorRespostaManual(horas = 12, agora = Date.now()) {
  const h = Number.isFinite(Number(horas)) && Number(horas) >= 0 ? Math.min(Number(horas), 720) : 12;
  return h ? new Date(agora + h * 3_600_000).toISOString() : null;
}
