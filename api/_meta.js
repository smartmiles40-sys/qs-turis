// api/_meta.js
// -----------------------------------------------------------------------------
// Fala com a Graph API da Meta para gerenciar os MODELOS de mensagem do WhatsApp
// (o que o Gerenciador do WhatsApp Business faz na mão).
//
// De onde vêm as credenciais: da própria caixa oficial no Chatwoot. Quando o
// número da Cloud API foi ligado lá, o Chatwoot guardou `api_key` (token de
// usuário de sistema, que não expira), `phone_number_id` e `business_account_id`
// no provider_config da inbox. Reusar isso evita criar env nova — e evita ter o
// mesmo segredo em dois lugares, que é como um deles fica velho sem ninguém ver.
//
// ⚠️ O token NUNCA vai para o navegador. Toda chamada à Meta acontece aqui.
// -----------------------------------------------------------------------------

import { cw } from './_wa.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

let cache = null;   // { token, waba, phoneId, em } — vale por execução

/**
 * Acha a caixa da API oficial no Chatwoot e devolve as credenciais da Meta.
 * Devolve null quando não há caixa oficial configurada (aí o portal se desliga
 * sozinho em vez de estourar).
 */
export async function credenciaisDaMeta() {
  if (cache && Date.now() - cache.em < 5 * 60_000) return cache;
  try {
    const d = await cw('/inboxes');
    const lista = Array.isArray(d?.payload) ? d.payload : [];
    for (const i of lista) {
      if (!String(i.channel_type || '').includes('Channel::Whatsapp')) continue;
      const c = i.provider_config || {};
      if (!c.api_key || !c.business_account_id) continue;
      cache = { token: c.api_key, waba: c.business_account_id, phoneId: c.phone_number_id || null, em: Date.now() };
      return cache;
    }
  } catch (e) {
    console.warn('[meta] não consegui ler as credenciais no Chatwoot:', e?.message);
  }
  return null;
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
  const para = String(telefone || '').replace(/\D/g, '');
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

  const out = { phoneId: cr.phoneId, waba: cr.waba };

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
    const j = await graph(`/${cr.waba}/phone_numbers?fields=id,display_phone_number,verified_name`, { token: cr.token });
    out.numeros = (j?.data || []).map((n) => ({ id: n.id, numero: n.display_phone_number, nome: n.verified_name }));
  } catch (e) { out.numerosErro = e?.message; }

  // 3. Apps assinados na WABA.
  try {
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
  const to = String(para || '').replace(/\D/g, '');
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
  const wa = String(telefone || '').replace(/\D/g, '');
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
