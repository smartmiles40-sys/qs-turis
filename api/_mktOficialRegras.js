// api/_mktOficialRegras.js
// -----------------------------------------------------------------------------
// DISPARO OFICIAL DO MARKETING (0341, 09/11/2026) — as regras PURAS.
//
// Sem banco e sem Meta: tudo aqui é função de entrada → saída, provada em
// tests/mkt/disparo-oficial.test.ts. Quem fala com o banco e com a Meta é
// api/_mktDisparoOficial.js.
//
// Fontes oficiais (conferidas em 09/11/2026):
//   • erros:   https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
//   • limites: https://developers.facebook.com/docs/whatsapp/messaging-limits
//              (250 → 2K → 10K → 100K → ilimitado, contatos ÚNICOS em 24 h
//               corridas, por PORTFÓLIO; campo whatsapp_business_manager_messaging_limit)
//   • ritmo:   https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput.md
//              (80 msg/s por número; passou disso = erro 130429)
//   • preço:   https://developers.facebook.com/docs/whatsapp/pricing
//              (por mensagem ENTREGUE desde 01/07/2025; categoria marketing/utility/…;
//               recibo traz pricing { billable, pricing_model, type, category })
//   • modelos: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-management.md
//   • recibos: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status.md
// -----------------------------------------------------------------------------

// ── Travas do envio real ────────────────────────────────────────────────────

/**
 * O envio REAL do Marketing só acontece com TODAS as travas ligadas:
 *   1. env MKT_DISPARO_ENVIO=1 na Vercel (desligada por padrão);
 *   2. qs_settings.mkt_disparo_simulacao = false (padrão: true);
 *   3. número do Marketing cadastrado (qs_wa_numeros_meta, setor marketing);
 *   4. o QS tem o token desse número (conectado pelo painel).
 * (A 5ª trava — modelo APROVADO sincronizado da WABA — é por campanha.)
 * Devolve { real, motivos[] } — `motivos` diz o que falta, em português.
 */
export function travasDoEnvio({ envLigado, simulacao, numero, temToken }) {
  const motivos = [];
  if (!envLigado) motivos.push('a trava MKT_DISPARO_ENVIO=1 não está ligada na Vercel');
  if (simulacao !== false) motivos.push('o modo simulação do Marketing está ligado (qs_settings.mkt_disparo_simulacao)');
  if (!numero?.phone_number_id) motivos.push('o Marketing não tem número cadastrado');
  else if (!temToken) motivos.push('o QS não tem o token do número do Marketing (conecte pelo painel)');
  return { real: motivos.length === 0, motivos };
}

// ── Limite do número (tier) ─────────────────────────────────────────────────

const TIERS = {
  TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10000,
  TIER_100K: 100000, TIER_UNLIMITED: Infinity,
};

/** "TIER_2K" → 2000. Desconhecido/vazio = o menor de hoje (250), o lado seguro. */
export function limiteDoTier(tier) {
  const t = String(tier || '').toUpperCase().trim();
  return t in TIERS ? TIERS[t] : 250;
}

/**
 * Quantos ainda cabem NESTA rodada. O mínimo entre:
 *   • o tier do número (com margem — o limite é do PORTFÓLIO e outros números
 *     da mesma empresa gastam dele) menos os contatos únicos das últimas 24 h;
 *   • o teto diário configurado menos o que já saiu hoje (Brasília);
 *   • o que o ritmo por segundo permite no tempo da rodada.
 */
export function calcularFolga({ tier, margem = 0.8, porDia, enviados24h, enviadosHoje, porSegundo, segundos }) {
  const lim = limiteDoTier(tier);
  const m = Math.min(1, Math.max(0.1, Number(margem) || 0.8));
  const doTier = lim === Infinity ? Infinity : Math.floor(lim * m) - (Number(enviados24h) || 0);
  const doDia = (Number(porDia) || 0) - (Number(enviadosHoje) || 0);
  const doRitmo = Math.floor(Math.max(0.1, Number(porSegundo) || 1) * Math.max(0, Number(segundos) || 0));
  return Math.max(0, Math.min(doTier, doDia, doRitmo));
}

/** Pausa entre dois envios pra respeitar `por_segundo` (o teto da Meta é 80/s). */
export const pausaEntreEnvios = (porSegundo) => Math.ceil(1000 / Math.min(80, Math.max(0.1, Number(porSegundo) || 1)));

// ── Erros da Meta ───────────────────────────────────────────────────────────
//
// `acao` diz o que a rodada faz:
//   'destinatario' → só este envio vira erro (os outros seguem);
//   'optout'       → este envio é pulado e o contato sai do marketing;
//   'esperar'      → o envio VOLTA pra fila e a rodada para este número
//                    (retoma sozinha na próxima — limite de velocidade);
//   'parar'        → o envio volta pra fila e a CAMPANHA pausa com o motivo
//                    (modelo com problema, número restrito, conta bloqueada).

const ERROS = {
  131026: ['destinatario', 'não entregável: o número não tem WhatsApp, não aceitou os termos novos ou o app está desatualizado'],
  131047: ['destinatario', 'fora da janela de 24 h (só modelo aprovado sai fora dela)'],
  131049: ['destinatario', 'a Meta segurou pra proteger o ecossistema (muito marketing pra esta pessoa) — não reenviar antes de 24 h'],
  131050: ['optout', 'a pessoa desligou as mensagens de marketing da empresa no WhatsApp'],
  131056: ['esperar', 'muitas mensagens pra mesma pessoa em pouco tempo — tenta de novo depois'],
  130429: ['esperar', 'limite de velocidade da Meta (por segundo) — a fila retoma sozinha'],
  80007: ['esperar', 'limite de chamadas da conta (WABA) — a fila retoma sozinha'],
  4: ['esperar', 'limite de chamadas do aplicativo — a fila retoma sozinha'],
  131048: ['parar', 'a Meta restringiu o número por bloqueios/denúncias de spam — confira a qualidade no WhatsApp Manager antes de retomar'],
  368: ['parar', 'a conta (WABA) foi restringida por violar política — veja o Business Support'],
  131031: ['parar', 'a conta foi restringida/desativada — veja a saúde da conta no WhatsApp Manager'],
  131053: ['parar', 'a Meta não conseguiu usar a mídia do topo (tipo ou tamanho do arquivo)'],
  131009: ['parar', 'algum valor do envio é inválido (variável, botão ou mídia) — confira o modelo e as variáveis'],
  131051: ['parar', 'tipo de mensagem não suportado'],
  132000: ['parar', 'o número de variáveis não bate com o modelo'],
  132001: ['parar', 'o modelo não existe ou não está aprovado neste idioma'],
  132005: ['parar', 'o texto traduzido do modelo ficou longo demais'],
  132007: ['parar', 'o modelo viola uma política do WhatsApp'],
  132012: ['parar', 'o formato de uma variável não é o que o modelo pede'],
  132015: ['parar', 'a Meta PAUSOU o modelo por baixa qualidade — edite e espere aprovar de novo'],
  132016: ['parar', 'a Meta DESATIVOU o modelo de vez (pausado vezes demais) — crie outro com outro texto'],
};

/**
 * Código de erro da Meta → { acao, motivo, codigo }. Qualquer 132xxx não
 * listado é problema do MODELO (para a campanha). Sem código = erro deste
 * destinatário (rede, timeout): não derruba a campanha.
 */
export function classificarErroMeta(codigo, detalhe = '') {
  const c = Number(codigo);
  const d = String(detalhe || '').slice(0, 160);
  if (Number.isFinite(c) && ERROS[c]) return { acao: ERROS[c][0], motivo: `${ERROS[c][1]} (código ${c})`, codigo: c };
  if (Number.isFinite(c) && c >= 132000 && c < 133000) return { acao: 'parar', motivo: `problema no modelo (código ${c})${d ? `: ${d}` : ''}`, codigo: c };
  return { acao: 'destinatario', motivo: `a Meta recusou${Number.isFinite(c) && c ? ` (código ${c})` : ''}${d ? `: ${d}` : ''}`, codigo: Number.isFinite(c) && c ? c : null };
}

// ── Modelos (message_templates) ─────────────────────────────────────────────

const STATUS_TELA = { APPROVED: 'aprovado', PENDING: 'enviado', IN_APPEAL: 'enviado', REJECTED: 'recusado', PAUSED: 'pausado', DISABLED: 'recusado' };

/**
 * Um item de GET /{waba}/message_templates → a linha de mkt_wa_modelos.
 * Guarda o que a tela e o envio precisam: corpo, topo (texto ou mídia),
 * rodapé, botões (com quais pedem variável) e o formato dos parâmetros.
 */
export function modeloDaMeta(t, wabaId = null) {
  const comp = Array.isArray(t?.components) ? t.components : [];
  const de = (tipo) => comp.find((c) => String(c?.type || '').toUpperCase() === tipo);
  const body = de('BODY');
  const header = de('HEADER');
  const botoes = (de('BUTTONS')?.buttons || []).map((b, i) => ({
    indice: i,
    tipo: String(b?.type || '').toUpperCase(),            // QUICK_REPLY | URL | PHONE_NUMBER | COPY_CODE…
    texto: String(b?.text || ''),
    url: b?.url ? String(b.url) : null,
    // URL com {{1}} no fim = sufixo dinâmico: precisa de valor no envio.
    variavel: String(b?.type || '').toUpperCase() === 'URL' && /{{\s*[^}]+\s*}}/.test(String(b?.url || '')),
  }));
  const formatoTopo = header ? String(header.format || 'TEXT').toUpperCase() : null;
  return {
    meta_id: String(t?.id || ''),
    waba_id: wabaId ? String(wabaId) : null,
    nome: String(t?.name || ''),
    idioma: String(t?.language || 'pt_BR'),
    categoria: String(t?.category || '').toUpperCase(),     // MARKETING | UTILITY | AUTHENTICATION
    status: String(t?.status || '').toUpperCase(),          // APPROVED | PENDING | REJECTED | PAUSED | DISABLED
    formato_parametros: String(t?.parameter_format || 'POSITIONAL').toUpperCase(),
    corpo: String(body?.text || ''),
    cabecalho_formato: formatoTopo,                         // TEXT | IMAGE | VIDEO | DOCUMENT | LOCATION | null
    cabecalho_texto: formatoTopo === 'TEXT' ? String(header?.text || '') : null,
    rodape: de('FOOTER')?.text ? String(de('FOOTER').text) : null,
    botoes,
    motivo: t?.rejected_reason && t.rejected_reason !== 'NONE' ? String(t.rejected_reason) : null,
    componentes: comp,
  };
}

const varsDe = (s) => [...new Set([...String(s || '').matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]))];

/** Linha de mkt_wa_modelos → o formato de modelo que a tela já usa (ModeloDisparo). */
export function modeloParaTela(m) {
  return {
    nome: m.nome, idioma: m.idioma || 'pt_BR',
    categoria: m.categoria === 'UTILITY' ? 'UTILITY' : 'MARKETING',
    categoriaMeta: m.categoria || null,
    corpo: m.corpo || '', cabecalho: m.cabecalho_texto || null, rodape: m.rodape || null,
    status: STATUS_TELA[m.status] || 'rascunho',
    statusMeta: m.status || null,
    setor: 'marketing', origem: 'meta',
    cabecalhoFormato: m.cabecalho_formato || null,
    precisaMidia: ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(m.cabecalho_formato || '')),
    variaveisTopo: m.cabecalho_formato === 'TEXT' ? varsDe(m.cabecalho_texto) : [],
    botoes: (m.botoes || []).map((b) => ({ indice: b.indice, tipo: b.tipo, texto: b.texto, variavel: Boolean(b.variavel) })),
    formatoParametros: m.formato_parametros || 'POSITIONAL',
    // O botão "Parar de receber" só aparece na prévia se o modelo tem.
    botaoParar: (m.botoes || []).some((b) => /parar/i.test(b.texto)),
  };
}

// ── O envio: components do template ─────────────────────────────────────────

const ordenar = (ks) => [...ks].sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a.localeCompare(b)));

/**
 * Monta `template.components` do POST /{phone}/messages.
 *   modelo  → linha de mkt_wa_modelos
 *   corpo   → { "1": "Ana", … } (ou { nome: "Ana" } em modelo NAMED)
 *   topo    → valor da variável do topo de texto (se o modelo tiver)
 *   midia   → { id } ou { link }, + nome (documento) — topo IMAGE/VIDEO/DOCUMENT
 *   botoes  → { [indice]: "sufixo" } dos botões URL dinâmicos
 * Devolve { components } ou { erro, nivel } — nivel 'campanha' (falta a mídia:
 * ninguém da campanha pode receber) ou 'destinatario' (valor vazio só deste).
 */
export function montarComponentes({ modelo, corpo = {}, topo = null, midia = null, botoes = {} }) {
  const components = [];
  const f = String(modelo?.cabecalho_formato || '');
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(f)) {
    if (!midia?.id && !midia?.link) return { erro: `o modelo pede ${f === 'IMAGE' ? 'uma imagem' : f === 'VIDEO' ? 'um vídeo' : 'um documento'} no topo e a campanha não tem`, nivel: 'campanha' };
    const tipo = f.toLowerCase();
    components.push({
      type: 'header',
      parameters: [{ type: tipo, [tipo]: { ...(midia.id ? { id: String(midia.id) } : { link: String(midia.link) }), ...(tipo === 'document' && midia.nome ? { filename: String(midia.nome) } : {}) } }],
    });
  } else if (f === 'TEXT' && varsDe(modelo?.cabecalho_texto).length) {
    const v = String(topo ?? '').trim();
    if (!v) return { erro: 'a variável do topo ficou vazia', nivel: 'destinatario' };
    const nome = varsDe(modelo.cabecalho_texto)[0];
    components.push({ type: 'header', parameters: [{ type: 'text', text: v, ...(/^\d+$/.test(nome) ? {} : { parameter_name: nome }) }] });
  }

  const vars = varsDe(modelo?.corpo);
  if (vars.length) {
    const nomeado = String(modelo?.formato_parametros || '').toUpperCase() === 'NAMED';
    const params = [];
    for (const k of ordenar(vars)) {
      const v = String(corpo[k] ?? '').trim();
      if (!v) return { erro: `variável {{${k}}} ficou vazia`, nivel: 'destinatario' };
      params.push(nomeado ? { type: 'text', parameter_name: k, text: v } : { type: 'text', text: v });
    }
    components.push({ type: 'body', parameters: params });
  }

  for (const b of modelo?.botoes || []) {
    if (!(b.tipo === 'URL' && b.variavel)) continue;
    const v = String(botoes?.[b.indice] ?? '').trim();
    if (!v) return { erro: `o botão "${b.texto}" pede o final do link e ficou vazio`, nivel: 'destinatario' };
    // A Meta pede o valor do link já codificado (ex.: "Gonçalves" → "Gon%C3%A7alves").
    components.push({ type: 'button', sub_type: 'url', index: String(b.indice), parameters: [{ type: 'text', text: encodeURI(v) }] });
  }
  return { components };
}

/** O corpo do POST /{phone}/messages de um modelo. */
export function pacoteDoEnvio({ para, modelo, components, marca }) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(para),
    type: 'template',
    // Volta no recibo (statuses[].biz_opaque_callback_data): achar o envio sem depender só do wamid.
    ...(marca ? { biz_opaque_callback_data: String(marca).slice(0, 512) } : {}),
    template: {
      name: modelo.nome,
      language: { code: modelo.idioma || 'pt_BR' },
      ...(components?.length ? { components } : {}),
    },
  };
}

// ── Recibo: custo ───────────────────────────────────────────────────────────

/** statuses[].pricing → { cobranca_categoria, cobravel } (null = o recibo não trouxe). */
export function cobrancaDoRecibo(st) {
  const p = st?.pricing;
  if (!p || typeof p !== 'object') return null;
  return { cobranca_categoria: p.category ? String(p.category).toLowerCase() : null, cobravel: p.billable === true };
}

/**
 * Custo estimado = Σ (cobráveis por categoria × preço da categoria).
 * Sem preço configurado a categoria entra como null (a tela pede o preço).
 */
export function custoEstimado(porCategoria, precos) {
  let total = 0;
  let semPreco = false;
  for (const [cat, n] of Object.entries(porCategoria || {})) {
    const p = Number(precos?.[cat]);
    if (!Number.isFinite(p) || p < 0 || precos?.[cat] === null || precos?.[cat] === undefined || precos?.[cat] === '') { if (n > 0) semPreco = true; continue; }
    total += p * n;
  }
  return { total: Math.round(total * 100) / 100, moeda: precos?.moeda || 'BRL', completo: !semPreco };
}

// ── Extras da campanha (mídia do topo, variável do topo, botões de link) ────

const FONTES_EXTRA = ['nome', 'destino', 'texto', 'campo'];
const okFonte = (x) => x && FONTES_EXTRA.includes(x.fonte) && (!['texto', 'campo'].includes(x.fonte) || String(x.valor || '').trim());

/**
 * Confere e limpa o `envio_extra` da campanha contra o modelo (formato da
 * tela, modeloParaTela). Devolve { extra } ou { erro } em português.
 */
export function conferirExtra(modelo, extra) {
  const e = extra && typeof extra === 'object' ? extra : {};
  const out = {};
  if (modelo?.precisaMidia) {
    const m = e.midia || {};
    const link = String(m.link || '').trim();
    const id = String(m.id || '').trim();
    if (!link && !id) return { erro: `Este modelo tem ${modelo.cabecalhoFormato === 'IMAGE' ? 'imagem' : modelo.cabecalhoFormato === 'VIDEO' ? 'vídeo' : 'documento'} no topo: cole o link do arquivo.` };
    if (link && !/^https:\/\/\S+$/i.test(link)) return { erro: 'O link da mídia precisa começar com https://' };
    if (id && !/^\d{5,30}$/.test(id)) return { erro: 'O id da mídia (Meta) é só números.' };
    out.midia = { ...(id ? { id } : { link }), ...(String(m.nome || '').trim() ? { nome: String(m.nome).trim().slice(0, 120) } : {}) };
  }
  if ((modelo?.variaveisTopo || []).length) {
    if (!okFonte(e.topo)) return { erro: 'Diga de onde vem a variável do título (topo) do modelo.' };
    out.topo = { fonte: e.topo.fonte, ...(e.topo.valor ? { valor: String(e.topo.valor).slice(0, 200) } : {}) };
  }
  const botoes = {};
  for (const b of modelo?.botoes || []) {
    if (!(b.tipo === 'URL' && b.variavel)) continue;
    const x = e.botoes?.[b.indice] ?? e.botoes?.[String(b.indice)];
    if (!okFonte(x)) return { erro: `Diga o final do link do botão "${b.texto}".` };
    botoes[String(b.indice)] = { fonte: x.fonte, ...(x.valor ? { valor: String(x.valor).slice(0, 200) } : {}) };
  }
  if (Object.keys(botoes).length) out.botoes = botoes;
  return { extra: out };
}
