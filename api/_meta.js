// api/_meta.js
// -----------------------------------------------------------------------------
// Fala com a Graph API da Meta: mensagens, arquivos, reações, MODELOS e ligações
// do número oficial. É o ÚNICO caminho de WhatsApp do QS desde 23/09/2026.
//
// De onde vêm as credenciais (23/09/2026): SÓ das variáveis de ambiente.
//
//   META_CALLS_TOKEN (ou META_WA_TOKEN) — o token do app na Meta;
//   META_PHONE_NUMBER_ID                — o número oficial;
//   META_WABA_ID                        — a conta do WhatsApp Business. Opcional:
//                                         sem ela, o QS descobre sozinho pelo
//                                         próprio token (ver descobrirWaba).
//
// Até 22/09 havia uma rede de segurança que buscava as credenciais dentro da
// caixa oficial do Chatwoot. O Chatwoot saiu do QS em 23/09 e a rede saiu junto.
//
// ⚠️ O token NUNCA vai para o navegador. Toda chamada à Meta acontece aqui.
// -----------------------------------------------------------------------------

import { toE164BR } from './_wa.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

/**
 * O NÚMERO COMO A META QUER: só dígitos, COM DDI.
 *
 * Não é preciosismo — é o defeito de 01/09. O caminho de MENSAGEM já passava por
 * `toE164BR` e por isso funcionava com lead cadastrado como "11992221156"; o
 * caminho de LIGAÇÃO fazia `replace(/\D/g,'')` e mandava os 11 dígitos crus, que
 * a Meta recusa. Mesmo lead, mesma tela: mensagem ia, ligação não.
 *
 * Todo número que sai daqui pra Meta passa por esta função. Colocar a regra em
 * cada chamada era o que já tinha dado errado.
 */
function foneMeta(raw) {
  const e164 = toE164BR(raw);
  return e164 ? e164.replace(/\D/g, '') : '';
}

let cache = null;   // { token, waba, phoneId, em } — vale por execução

/**
 * O WABA a partir do próprio token, quando META_WABA_ID não está preenchida.
 *
 * O token de usuário de sistema carrega, no `debug_token`, a lista das contas
 * que ele pode administrar (`granular_scopes` → whatsapp_business_management).
 * Com uma conta só — o nosso caso — é ela. Com mais de uma, não chuta: devolve
 * null e a tela pede a variável.
 */
async function descobrirWaba(token) {
  try {
    const r = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`
    );
    const j = await r.json().catch(() => null);
    const escopos = Array.isArray(j?.data?.granular_scopes) ? j.data.granular_scopes : [];
    const ids = escopos.find((s) => s.scope === 'whatsapp_business_management')?.target_ids || [];
    if (ids.length === 1) return String(ids[0]);
    if (ids.length > 1) {
      console.warn('[meta] o token enxerga mais de uma WABA — preencha META_WABA_ID');
      return null;
    }
  } catch (e) {
    console.warn('[meta] debug_token falhou:', e?.message);
  }
  // Segundo caminho: a empresa dona do token e as contas de WhatsApp dela.
  try {
    const r = await fetch(
      `${GRAPH}/me/businesses?fields=owned_whatsapp_business_accounts{id}&access_token=${encodeURIComponent(token)}`
    );
    const j = await r.json().catch(() => null);
    const ids = (j?.data || []).flatMap((b) => (b.owned_whatsapp_business_accounts?.data || []).map((w) => w.id));
    if (ids.length === 1) return String(ids[0]);
  } catch (e) {
    console.warn('[meta] /me/businesses falhou:', e?.message);
  }
  console.warn('[meta] não descobri a WABA pelo token — preencha META_WABA_ID na Vercel');
  return null;
}

/**
 * As credenciais da Meta, do ambiente. Devolve null quando falta o token ou o
 * número (aí cada tela se desliga com um aviso em vez de estourar).
 */
export async function credenciaisDaMeta() {
  if (cache && Date.now() - cache.em < 30 * 60_000) return cache;

  const token = String(process.env.META_WA_TOKEN || process.env.META_CALLS_TOKEN || '').trim();
  const phoneId = String(process.env.META_PHONE_NUMBER_ID || '').trim();
  if (!token || !phoneId) return null;

  let waba = String(process.env.META_WABA_ID || '').trim() || null;
  let origemWaba = waba ? 'env' : null;
  if (!waba) {
    waba = await descobrirWaba(token);
    if (waba) origemWaba = 'token';
  }
  cache = { token, waba, phoneId, em: Date.now(), origem: 'env', origemWaba };
  return cache;
}

/** Diagnóstico para a tela de configuração: o que está preenchido e o que falta. */
export async function origemDasCredenciais() {
  const cr = await credenciaisDaMeta();
  return {
    origem: cr?.origem || null,
    temToken: Boolean(cr?.token),
    temWaba: Boolean(cr?.waba),
    wabaDescoberta: cr?.origemWaba === 'token',
    temPhoneId: Boolean(cr?.phoneId),
  };
}

async function graph(path, { method = 'GET', body, token, timeoutMs = 12_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${GRAPH}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const json = await r.json().catch(() => null);
    if (json?.error) {
      const err = new Error(json.error.error_user_msg || json.error.message || 'A Meta recusou');
      err.metaCode = json.error.code;
      err.status = r.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** TODOS os modelos, com status — é o que o admin precisa ver (não só os aprovados). */
export async function listarModelos() {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  if (!cr.waba) return { erro: 'sem-waba-id' };
  const d = await graph(`/${cr.waba}/message_templates?limit=200`, { token: cr.token });
  const modelos = (d?.data || []).map((t) => {
    const comp = Array.isArray(t.components) ? t.components : [];
    const corpo = comp.find((c) => String(c.type).toUpperCase() === 'BODY')?.text || '';
    const header = comp.find((c) => String(c.type).toUpperCase() === 'HEADER');
    return {
      id: t.id,
      nome: t.name,
      idioma: t.language,
      categoria: t.category,
      status: t.status,                       // APPROVED | PENDING | REJECTED | PAUSED
      motivo: t.rejected_reason || null,      // por que a Meta recusou
      corpo,
      cabecalho: header?.format === 'TEXT' ? header.text : null,
      cabecalhoMidia: header && header.format !== 'TEXT' ? header.format : null,
      rodape: comp.find((c) => String(c.type).toUpperCase() === 'FOOTER')?.text || null,
      variaveis: [...corpo.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]),
    };
  });
  return { modelos };
}

/**
 * Cria um modelo e manda pra análise da Meta.
 *
 * As regras que a Meta impõe e que a gente checa ANTES de mandar (erro dela vem
 * em inglês e sem contexto — melhor explicar aqui):
 *  • nome só com minúsculas, números e _;
 *  • variáveis numeradas em sequência a partir de 1 ({{1}}, {{2}}…);
 *  • corpo não pode começar nem terminar com variável;
 *  • categoria MARKETING | UTILITY (AUTHENTICATION tem regra própria).
 */
export async function criarModelo({ nome, categoria, idioma, corpo, cabecalho, rodape }) {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  if (!cr.waba) return { erro: 'sem-waba-id' };

  const problema = validarModelo({ nome, categoria, corpo });
  if (problema) return { erro: 'invalido', mensagem: problema };

  const components = [];
  if (cabecalho?.trim()) components.push({ type: 'HEADER', format: 'TEXT', text: cabecalho.trim() });
  components.push({ type: 'BODY', text: corpo.trim() });
  if (rodape?.trim()) components.push({ type: 'FOOTER', text: rodape.trim() });

  try {
    const d = await graph(`/${cr.waba}/message_templates`, {
      method: 'POST',
      token: cr.token,
      body: { name: nome.trim(), category: categoria, language: idioma || 'pt_BR', components },
    });
    return { ok: true, id: d?.id, status: d?.status || 'PENDING' };
  } catch (e) {
    return { erro: 'meta-recusou', mensagem: e.message, codigo: e.metaCode };
  }
}

export async function excluirModelo(nome) {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  if (!cr.waba) return { erro: 'sem-waba-id' };
  try {
    await graph(`/${cr.waba}/message_templates?name=${encodeURIComponent(nome)}`, { method: 'DELETE', token: cr.token });
    return { ok: true };
  } catch (e) {
    return { erro: 'meta-recusou', mensagem: e.message, codigo: e.metaCode };
  }
}

/** Devolve a explicação do problema, ou null quando está tudo certo. */
export function validarModelo({ nome, categoria, corpo }) {
  const n = String(nome || '').trim();
  if (!n) return 'Dê um nome ao modelo.';
  if (!/^[a-z0-9_]+$/.test(n)) {
    return 'O nome só aceita letras minúsculas, números e _ (sem espaço, acento ou maiúscula). Ex.: retomada_outubro';
  }
  if (n.length > 512) return 'O nome está longo demais.';

  const c = String(corpo || '').trim();
  if (!c) return 'Escreva o texto da mensagem.';
  if (c.length > 1024) return 'O texto passa de 1024 caracteres — a Meta não aceita.';

  if (!['MARKETING', 'UTILITY'].includes(String(categoria))) {
    return 'Escolha a categoria: Utilidade (aviso, confirmação) ou Marketing (oferta, retomada).';
  }

  const vars = [...c.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1].trim());
  if (vars.length) {
    if (!vars.every((v) => /^\d+$/.test(v))) {
      return 'As variáveis precisam ser numeradas: use {{1}}, {{2}}… (não {{nome}}).';
    }
    const nums = vars.map(Number);
    const esperado = Array.from({ length: Math.max(...nums) }, (_, i) => i + 1);
    if (!esperado.every((e) => nums.includes(e))) {
      return `As variáveis têm que ser em sequência a partir de 1 — está faltando alguma de {{1}} a {{${Math.max(...nums)}}}.`;
    }
    if (/^\s*{{/.test(c) || /}}\s*$/.test(c)) {
      return 'O texto não pode começar nem terminar com variável — a Meta recusa. Escreva algo antes e depois.';
    }
  }
  return null;
}

// ─── ENVIO DIRETO PELA CLOUD API ─────────────────────────────────────────────
//
// POR QUE NÃO PELO CHATWOOT, aqui. O resto do QS manda WhatsApp pelo Chatwoot
// de propósito: a mensagem cai na conversa e aparece na tela do SDR. O disparo
// de PRIMEIRO CONTATO é a exceção, por duas razões que só valem pra ele:
//
//   1. O vídeo não precisa aparecer pra equipe (Bruno, 28/08) — é um disparo,
//      não uma conversa. A conversa começa quando o lead responde, e a resposta
//      entra pelo caminho normal (Chatwoot → wa-webhook).
//   2. O Chatwoot NÃO entrega template com cabeçalho de mídia: a issue #13159
//      (aberta desde 29/12/2025) mostra que ele monta um payload inválido pra
//      Meta e a mensagem fica presa em "sending". Aqui o payload é montado
//      certo, por nós.
//
// De quebra, isto libera o `media_id`: sem o Chatwoot no meio, dá pra subir o
// vídeo UMA vez e reusar por 30 dias, em vez de a Meta baixar 5,7 MB do bucket
// a cada lead.

/**
 * Sobe um arquivo por URL pra Meta e devolve o `media_id`.
 *
 * Vale 30 dias. Quem chama guarda o id e a data — e re-sobe antes de vencer,
 * porque id vencido a Meta recusa com a mensagem mais inútil possível.
 */
export async function subirMidiaPorUrl(url) {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  if (!cr.phoneId) return { erro: 'sem-phone-number-id' };

  let bytes; let tipo;
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) return { erro: 'arquivo-inacessivel', detalhe: `HTTP ${r.status}` };
    tipo = String(r.headers.get('content-type') || '').split(';')[0].trim() || 'video/mp4';
    bytes = new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    return { erro: 'arquivo-inacessivel', detalhe: e?.message };
  }

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', tipo);
  form.append('file', new Blob([bytes], { type: tipo }), 'midia');

  try {
    const r = await fetch(
      `${GRAPH}/${cr.phoneId}/media?access_token=${encodeURIComponent(cr.token)}`,
      { method: 'POST', body: form }
    );
    const j = await r.json().catch(() => null);
    if (j?.error) return { erro: 'meta-recusou', detalhe: j.error.message };
    if (!j?.id) return { erro: 'sem-id-na-resposta' };
    return { id: String(j.id), tipo, bytes: bytes.length };
  } catch (e) {
    return { erro: 'falha-no-upload', detalhe: e?.message };
  }
}

/**
 * Manda um template aprovado direto pela Cloud API.
 *
 * `midia` aceita { id } (preferido) ou { url }. A Meta exige um OU outro, nunca
 * os dois — com `url` ela baixa o arquivo a cada envio; com `id` não baixa nada.
 *
 * `params` é o mapa posicional do corpo ({ "1": "Bruno" }); a Meta lê por
 * ORDEM, então a ordenação numérica aqui não é estética: fora de ordem, o
 * cliente recebe as variáveis trocadas de lugar.
 */
export async function enviarTemplate({ para, nome, idioma = 'pt_BR', params = {}, midia = null, formatoMidia = 'VIDEO' }) {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  if (!cr.phoneId) return { erro: 'sem-phone-number-id' };

  const components = [];

  if (midia?.id || midia?.url) {
    const tipo = String(formatoMidia || 'VIDEO').toLowerCase(); // video | image | document
    components.push({
      type: 'header',
      parameters: [{ type: tipo, [tipo]: midia.id ? { id: midia.id } : { link: midia.url } }],
    });
  }

  const ordenados = Object.keys(params)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b));
  if (ordenados.length) {
    components.push({
      type: 'body',
      parameters: ordenados.map((k) => ({ type: 'text', text: String(params[k] ?? '') })),
    });
  }

  try {
    const j = await graph(`/${cr.phoneId}/messages`, {
      method: 'POST',
      token: cr.token,
      timeoutMs: 20_000,
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: String(para),
        type: 'template',
        template: {
          name: nome,
          language: { code: idioma || 'pt_BR' },
          ...(components.length ? { components } : {}),
        },
      },
    });
    // O wamid é o comprovante: é por ele que se acha a mensagem no suporte da
    // Meta quando o cliente jura que não recebeu.
    return { wamid: j?.messages?.[0]?.id || null };
  } catch (e) {
    return { erro: 'meta-recusou', detalhe: e?.message, codigo: e?.metaCode };
  }
}

// ─── CONVERSA PELO NÚMERO OFICIAL (23/09/2026) ───────────────────────────────
//
// Desde que Chatwoot e Evolution saíram, TODA mensagem do QS sai por aqui: texto
// do SDR/closer, arquivo, reação e as respostas da Glória. O número é
// um só (o oficial); quem escreveu vai assinado na primeira linha.
//
// A regra que a Meta impõe e que a tela precisa respeitar: texto livre só é
// entregue se o cliente escreveu nas últimas 24h. Fora disso, só MODELO
// aprovado (`enviarTemplate`). Quem chama confere a janela antes.

/** Um POST em /{phone}/messages. Devolve { wamid } ou { erro, detalhe, codigo }. */
async function mandar(para, conteudo, { responderA = null } = {}) {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  const numero = foneMeta(para);
  if (!numero) return { erro: 'telefone-invalido' };
  try {
    const j = await graph(`/${cr.phoneId}/messages`, {
      method: 'POST',
      token: cr.token,
      timeoutMs: 20_000,
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: numero,
        ...(responderA ? { context: { message_id: String(responderA) } } : {}),
        ...conteudo,
      },
    });
    return { wamid: j?.messages?.[0]?.id || null };
  } catch (e) {
    return { erro: 'meta-recusou', detalhe: e?.message, codigo: e?.metaCode };
  }
}

/** Texto livre (dentro da janela de 24h). `responderA` = wamid da mensagem citada. */
export function enviarTexto({ para, texto, responderA = null }) {
  return mandar(para, { type: 'text', text: { body: String(texto), preview_url: true } }, { responderA });
}

/**
 * Sobe bytes pra Meta (o arquivo que o SDR anexou) e devolve o `media_id`.
 * Irmã da `subirMidiaPorUrl`, pra quando o arquivo já está na memória.
 */
export async function subirMidiaBytes(bytes, mime, nomeArquivo = 'arquivo') {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  const tipo = String(mime || 'application/octet-stream').split(';')[0].trim();
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', tipo);
  form.append('file', new Blob([bytes], { type: tipo }), nomeArquivo);
  try {
    const r = await fetch(`${GRAPH}/${cr.phoneId}/media?access_token=${encodeURIComponent(cr.token)}`, {
      method: 'POST', body: form,
    });
    const j = await r.json().catch(() => null);
    if (j?.error) return { erro: 'meta-recusou', detalhe: j.error.message, codigo: j.error.code };
    if (!j?.id) return { erro: 'sem-id-na-resposta' };
    return { id: String(j.id) };
  } catch (e) {
    return { erro: 'falha-no-upload', detalhe: e?.message };
  }
}

/**
 * Arquivo: `tipo` image | video | audio | document | sticker. Legenda não
 * existe em áudio nem figurinha (a Meta recusa); nome do arquivo só em documento.
 */
export function enviarMidia({ para, tipo, mediaId, legenda = null, nomeArquivo = null, responderA = null }) {
  const t = ['image', 'video', 'audio', 'document', 'sticker'].includes(tipo) ? tipo : 'document';
  const corpo = { id: String(mediaId) };
  if (legenda && t !== 'audio' && t !== 'sticker') corpo.caption = String(legenda);
  if (nomeArquivo && t === 'document') corpo.filename = String(nomeArquivo);
  return mandar(para, { type: t, [t]: corpo }, { responderA });
}

/** Reação a uma mensagem (emoji vazio tira a reação). */
export function enviarReacao({ para, wamid, emoji }) {
  return mandar(para, { type: 'reaction', reaction: { message_id: String(wamid), emoji: String(emoji ?? '') } });
}

/**
 * Os modelos APROVADOS, no formato que a tela do chat usa (corpo com os
 * {{buracos}}, variáveis em ordem, se precisa de mídia). Antes vinham do
 * Chatwoot, que sincronizava os modelos da caixa oficial; agora vêm da Meta.
 */
export async function modelosAprovados() {
  const r = await listarModelos().catch((e) => ({ erro: e?.message }));
  if (r?.erro || !Array.isArray(r?.modelos)) return [];
  return r.modelos
    .filter((m) => String(m.status).toUpperCase() === 'APPROVED' && m.corpo)
    .map((m) => ({
      nome: m.nome,
      idioma: m.idioma || 'pt_BR',
      categoria: m.categoria || '',
      cabecalho: m.cabecalho || null,
      headerFormato: m.cabecalhoMidia ? String(m.cabecalhoMidia).toUpperCase() : 'TEXT',
      precisaMidia: ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(m.cabecalhoMidia || '').toUpperCase()),
      corpo: m.corpo,
      rodape: m.rodape || null,
      variaveis: m.variaveis || [],
    }));
}


// ─── CHAMADAS (Cloud API Calling) ────────────────────────────────────────────
//
// Trilho SEPARADO do de mensagem, e vale dizer porque confunde: ativar o
// webhook `calls` não faz template aparecer, e template nenhum pede permissão
// de ligação. São coisas diferentes que a Meta chama pelo mesmo nome.

/** Lê o bloco `calling` do número. É o único jeito de saber se está mesmo ligado. */
export async function lerConfigChamadas() {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  if (!cr.phoneId) return { erro: 'sem-phone-number-id' };
  try {
    const j = await graph(`/${cr.phoneId}/settings`, { token: cr.token });
    return { calling: j?.calling ?? null, phoneId: cr.phoneId };
  } catch (e) {
    return { erro: 'meta-recusou', detalhe: e?.message, codigo: e?.metaCode };
  }
}

/**
 * Liga chamadas no número.
 *
 * PRÉ-REQUISITO DA META: limite de mensagens de 2.000 ou mais. Abaixo disso ela
 * recusa, e a mensagem de erro dela não diz isso com clareza — por isso o
 * chamador deve conferir o tier antes de culpar o código.
 */
export async function ativarChamadas() {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  if (!cr.phoneId) return { erro: 'sem-phone-number-id' };
  try {
    const j = await graph(`/${cr.phoneId}/settings`, {
      method: 'POST', token: cr.token,
      body: {
        calling: {
          status: 'ENABLED',
          call_icon_visibility: 'DEFAULT',
          callback_permission_status: 'ENABLED',
        },
      },
    });
    return { ok: j?.success === true };
  } catch (e) {
    return { erro: 'meta-recusou', detalhe: e?.message, codigo: e?.metaCode };
  }
}

/**
 * Pede permissão pra ligar. NÃO é template — é mensagem interativa do tipo
 * `call_permission_request`.
 *
 * EXIGE CONVERSA ABERTA: a pessoa precisa ter escrito nas últimas 24h. Quem
 * nunca respondeu não pode receber o pedido — e é justamente o lead de
 * formulário que o SDR mais quer ligar. Limite: 1 pedido por 24h e 2 por
 * semana, por pessoa.
 */
export async function pedirPermissaoDeLigacao(telefone, texto) {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  if (!cr.phoneId) return { erro: 'sem-phone-number-id' };
  const para = foneMeta(telefone);
  if (!para) return { erro: 'telefone-invalido' };
  try {
    const j = await graph(`/${cr.phoneId}/messages`, {
      method: 'POST', token: cr.token,
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: para,
        type: 'interactive',
        interactive: {
          type: 'call_permission_request',
          action: { name: 'call_permission_request' },
          body: { text: String(texto || 'Podemos te ligar por aqui pelo WhatsApp?').slice(0, 1024) },
        },
      },
    });
    return { wamid: j?.messages?.[0]?.id || null };
  } catch (e) {
    return { erro: 'meta-recusou', detalhe: e?.message, codigo: e?.metaCode };
  }
}

/**
 * DIAGNÓSTICO COMPLETO DA LIGAÇÃO — as quatro perguntas numa resposta só.
 *
 * Existe porque a configuração de chamada mente por omissão: `subscribed_apps`
 * diz QUAIS apps estão na WABA mas não QUAIS CAMPOS cada um assina, e o painel
 * mostra o toggle `calls` aceso mesmo quando a assinatura não foi gravada. O
 * resultado é o pior tipo de bug: tudo responde `success: true` e nada é
 * entregue — foi a tarde inteira do dia 31/08 nisso, no Graph Explorer, uma
 * pergunta por vez.
 *
 * A pergunta que fecha o caso é a 4: `GET /{app_id}/subscriptions` com token de
 * APP (`app_id|app_secret`) é o único lugar que lista os campos de verdade.
 */
export async function diagnosticoChamadas() {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };

  // Sem WABA o diagnóstico continua: ele é a tela que alguém abre JUSTAMENTE
  // quando falta credencial. Os blocos que precisam do WABA se anunciam
  // sozinhos logo abaixo; desligar tudo aqui esconderia a resposta de quem veio
  // procurar por ela.
  const out = { phoneId: cr.phoneId, waba: cr.waba, origemDasCredenciais: cr.origem || null };
  if (!cr.waba) out.avisoWaba = 'Sem META_WABA_ID: números e apps inscritos não podem ser conferidos.';

  // 1. O bloco `calling` INTEIRO — não só os três campos que a tela mostrava.
  //    `connection_mode` mora aqui: se estiver em SIP, o evento vai pro servidor
  //    SIP da empresa e NUNCA pro webhook, por definição.
  try {
    const j = await graph(`/${cr.phoneId}/settings`, { token: cr.token });
    out.calling = j?.calling ?? null;
  } catch (e) { out.callingErro = e?.message; }

  // 2. Quem é esse phone_number_id por extenso. A tela pega o id do Chatwoot;
  //    WABA com mais de um número deixa a gente lendo a config de um e ligando
  //    pro outro — e isso não aparece em lugar nenhum.
  try {
    if (!cr.waba) throw new Error('sem META_WABA_ID');
    const j = await graph(`/${cr.waba}/phone_numbers?fields=id,display_phone_number,verified_name`, { token: cr.token });
    out.numeros = (j?.data || []).map((n) => ({ id: n.id, numero: n.display_phone_number, nome: n.verified_name }));
  } catch (e) { out.numerosErro = e?.message; }

  // 3. Apps assinados na WABA.
  try {
    if (!cr.waba) throw new Error('sem META_WABA_ID');
    const j = await graph(`/${cr.waba}/subscribed_apps`, { token: cr.token });
    out.apps = (j?.data || []).map((a) => ({
      id: a?.whatsapp_business_api_data?.id || null,
      nome: a?.whatsapp_business_api_data?.name || null,
    }));
  } catch (e) { out.appsErro = e?.message; }

  // 4. OS CAMPOS. Token de app, não de usuário: é o que dá acesso ao
  //    /subscriptions. O app secret já está na Vercel (o webhook confere HMAC
  //    com ele); falta só o id, que não é segredo.
  const appId = String(process.env.META_CALLS_APP_ID || '').trim();
  const appSecret = String(process.env.META_CALLS_APP_SECRET || '').trim();
  if (!appId || !appSecret) {
    out.camposErro = appId ? 'sem-META_CALLS_APP_SECRET' : 'sem-META_CALLS_APP_ID';
  } else {
    try {
      const j = await graph(`/${appId}/subscriptions`, { token: `${appId}|${appSecret}` });
      const wa = (j?.data || []).find((x) => x?.object === 'whatsapp_business_account');
      out.campos = (wa?.fields || []).map((f) => (typeof f === 'string' ? f : f?.name)).filter(Boolean);
      out.assinaCalls = out.campos.includes('calls');
      out.callbackUrl = wa?.callback_url || null;
      out.appNome = appId;
    } catch (e) { out.camposErro = e?.message; }
  }

  return out;
}

/**
 * APONTA O WEBHOOK DA META PRO QS (23/09/2026).
 *
 * Medido em 23/09: a Meta não entregava NADA ao /api/wa-calls desde 01/09 —
 * nenhum evento de ligação, nenhuma mensagem de cliente. O envio funcionava, a
 * volta não. Isto faz as duas coisas que a Meta exige para entregar:
 *
 *   1. o app assinado na WABA   → POST /{waba}/subscribed_apps (token do sistema)
 *   2. a URL e os CAMPOS do app → POST /{app}/subscriptions (token do APP:
 *      app_id|app_secret) com callback = /api/wa-calls, campos messages + calls.
 *
 * No passo 2 a Meta chama o GET de verificação na hora; o wa-calls responde com
 * META_CALLS_VERIFY_TOKEN. Se a URL antiga do app era a do Chatwoot, ela deixa
 * de receber — que é o certo desde que o Chatwoot saiu do QS.
 */
export async function apontarWebhookProQs(urlBase) {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  if (!cr.waba) return { erro: 'sem-waba-id' };
  const appId = String(process.env.META_CALLS_APP_ID || '').trim();
  const appSecret = String(process.env.META_CALLS_APP_SECRET || '').trim();
  const verify = String(process.env.META_CALLS_VERIFY_TOKEN || '').trim();
  if (!appId || !appSecret || !verify) return { erro: 'sem-dados-do-app' };

  const out = {};
  try {
    const j = await graph(`/${cr.waba}/subscribed_apps`, { method: 'POST', token: cr.token });
    out.appAssinado = j?.success === true;
  } catch (e) {
    return { erro: 'meta-recusou', etapa: 'subscribed_apps', detalhe: e?.message, codigo: e?.metaCode };
  }
  try {
    const callback = `${String(urlBase).replace(/\/+$/, '')}/api/wa-calls`;
    const j = await graph(`/${appId}/subscriptions`, {
      method: 'POST',
      token: `${appId}|${appSecret}`,
      timeoutMs: 20_000,
      body: {
        object: 'whatsapp_business_account',
        callback_url: callback,
        verify_token: verify,
        fields: 'messages,calls',
        include_values: true,
      },
    });
    out.webhook = j?.success === true;
    out.callbackUrl = callback;
  } catch (e) {
    return { ...out, erro: 'meta-recusou', etapa: 'subscriptions', detalhe: e?.message, codigo: e?.metaCode };
  }
  return { ok: true, ...out };
}

// ─── A VOLTA: LIGAR PRO CLIENTE (business-initiated) ─────────────────────────
//
// Ao contrário da mensagem, aqui o servidor NÃO consegue ligar sozinho: a Meta
// exige um SDP offer de verdade no corpo do pedido, e SDP só sai de um ponto de
// áudio real. Quem gera é o navegador do SDR; este arquivo só carrega o
// envelope até a Meta e traz a resposta de volta.
//
// O fluxo inteiro, medido contra a doc e contra o evento real de 31/08:
//   1. navegador  -> offer            (getUserMedia + RTCPeerConnection)
//   2. QS         -> POST /calls action=connect  { session: {sdp_type:'offer', sdp} }
//                    devolve o `wacid` na hora — mas NÃO o áudio
//   3. Meta       -> webhook `connect` com sdp_type=answer   ← chega pelo wa-calls
//   4. navegador  -> setRemoteDescription(answer), e aí sim o áudio flui
//   5. desligar   -> POST /calls action=terminate (obrigatório mesmo com RTCP BYE)
//
// O passo 3 chegar por WEBHOOK, e não na resposta do passo 2, é o que obriga o
// navegador a ficar esperando: é assíncrono por natureza.

/**
 * Pede pra Meta ligar pro cliente, carregando o SDP offer do navegador.
 *
 * `to` com DDI, só dígitos. Erro 138006 da Meta = falta permissão de ligação
 * daquela pessoa — e permissão é assunto do `call_permission_request`, não deste
 * endpoint.
 */
export async function iniciarLigacao({ para, sdp, marcador }) {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  if (!cr.phoneId) return { erro: 'sem-phone-number-id' };
  const to = foneMeta(para);
  if (!to) return { erro: 'telefone-invalido' };
  if (!sdp) return { erro: 'sem-sdp' };

  try {
    const j = await graph(`/${cr.phoneId}/calls`, {
      method: 'POST', token: cr.token, timeoutMs: 20_000,
      body: {
        messaging_product: 'whatsapp',
        to,
        action: 'connect',
        session: { sdp_type: 'offer', sdp: String(sdp) },
        ...(marcador ? { biz_opaque_callback_data: String(marcador).slice(0, 512) } : {}),
      },
    });
    return { callId: j?.calls?.[0]?.id || null };
  } catch (e) {
    return { erro: 'meta-recusou', detalhe: e?.message, codigo: e?.metaCode };
  }
}

/**
 * Desliga. A Meta é explícita: mandar `terminate` é OBRIGATÓRIO mesmo quando o
 * RTCP BYE já foi pelo caminho de mídia — sem isso a chamada fica aberta do
 * lado dela, contando minuto.
 */
export async function encerrarLigacao(callId) {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  if (!cr.phoneId) return { erro: 'sem-phone-number-id' };
  if (!callId) return { erro: 'sem-call-id' };
  try {
    const j = await graph(`/${cr.phoneId}/calls`, {
      method: 'POST', token: cr.token,
      body: { messaging_product: 'whatsapp', call_id: String(callId), action: 'terminate' },
    });
    return { ok: j?.success !== false };
  } catch (e) {
    return { erro: 'meta-recusou', detalhe: e?.message, codigo: e?.metaCode };
  }
}

/**
 * "POSSO LIGAR PRA ESSA PESSOA AGORA?" — a fonte da verdade da Meta, sem tentar
 * e tomar 138006 na cara do cliente.
 *
 * O FORMATO REAL DA RESPOSTA (conferido na doc em 01/09, porque a versão
 * anterior desta função chutava os nomes e perdia a validade da permissão):
 *
 *   { permission: { status: 'no_permission' | 'temporary' | 'permanent',
 *                   expiration_time: 1745343479 },      ← em SEGUNDOS, e o nome
 *     actions: [                                          NÃO é expiration_timestamp
 *       { action_name: 'send_call_permission_request',
 *         can_perform_action: true,
 *         limits: [{ time_period: 'PT24H', max_allowed: 1, current_usage: 0 }] },
 *       { action_name: 'start_call',
 *         can_perform_action: false,
 *         limits: [{ time_period: 'PT24H', max_allowed: 5, current_usage: 5 }] } ] }
 *
 * `actions` vale MAIS que `status`, e é a parte que faltava: a permissão pode
 * estar válida e mesmo assim a ligação ser recusada, porque o teto é de 5
 * chamadas atendidas por 24h com a mesma pessoa. `can_perform_action` já traz
 * essa conta pronta — perguntar só o `status` é como olhar o saldo e ignorar o
 * limite diário.
 */
export async function lerPermissaoDeLigacao(telefone) {
  const cr = await credenciaisDaMeta();
  if (!cr) return { erro: 'sem-caixa-oficial' };
  if (!cr.phoneId) return { erro: 'sem-phone-number-id' };
  const wa = foneMeta(telefone);
  if (!wa) return { erro: 'telefone-invalido' };
  try {
    const j = await graph(`/${cr.phoneId}/call_permissions?user_wa_id=${encodeURIComponent(wa)}`, { token: cr.token });
    const p = j?.permission || {};
    const acao = (nome) => (Array.isArray(j?.actions) ? j.actions : []).find((a) => a?.action_name === nome) || null;
    const ligar = acao('start_call');
    const pedir = acao('send_call_permission_request');
    // Segundos → ISO. A Meta manda epoch em segundos; jogar isso direto num
    // timestamptz daria 1970 e a permissão nasceria vencida.
    const seg = p.expiration_time ?? p.expiration_timestamp ?? null;
    return {
      status: p.status || 'no_permission',
      expiraEm: seg ? new Date(Number(seg) * 1000).toISOString() : null,
      podeLigar: ligar ? ligar.can_perform_action === true : null,
      podePedir: pedir ? pedir.can_perform_action === true : null,
      limiteLigar: ligar?.limits?.[0] ?? null,
      limitePedir: pedir?.limits?.[0] ?? null,
      cru: j,
    };
  } catch (e) {
    return { erro: 'meta-recusou', detalhe: e?.message, codigo: e?.metaCode };
  }
}
