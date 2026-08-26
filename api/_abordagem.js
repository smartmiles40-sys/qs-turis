// api/_abordagem.js
// -----------------------------------------------------------------------------
// O PRIMEIRO CONTATO — a Glória falando ANTES do cliente.
//
// Até aqui ela só sabia responder. Isso funciona pro lead que chega pelo
// WhatsApp ("vi o anúncio, quero saber da Antártida"), e é inútil pro lead que
// chega pelo FORMULÁRIO da landing page: esse preencheu o form e foi embora.
// Ninguém escreveu no WhatsApp, então não existe mensagem pra responder, e a
// Glória fica parada olhando um lead novo.
//
// Como tráfego pago manda quase tudo pelo formulário, é isto que faltava pra
// ligar tráfego nela. Sem isto, o pipeline dela só enche na mão.
//
// ── AS DUAS PORTAS, E POR QUE SÃO DUAS ─────────────────────────────────────
//
// A Meta só deixa mandar TEXTO LIVRE pra quem falou com a gente nas últimas 24
// horas. Fora dessa janela, só template aprovado. Não é regra nossa e não tem
// como contornar: mensagem livre fora da janela simplesmente não é entregue.
//
//   JANELA ABERTA  (o lead escreveu faz pouco, mas a IA não estava ligada
//                   naquele momento) → não inventamos nada: entregamos a última
//                   mensagem dele pro fluxo normal, como se tivesse acabado de
//                   chegar. Ela responde do jeito de sempre.
//
//   JANELA FECHADA (o caso do formulário: nunca escreveu) → TEMPLATE APROVADO,
//                   montado e enviado pelo QS. O corpo vem do Chatwoot, que
//                   sincroniza da Meta — nunca daqui. Template adulterado a Meta
//                   recusa, e template certo com corpo errado gravaria no QS uma
//                   coisa diferente do que o cliente recebeu.
//
// A CONVERSA CONTINUA SOZINHA. Depois que o template sai, a resposta do cliente
// abre a janela de 24h e cai no `wa-webhook`, que já chama a Glória. Ou seja: só
// o primeiro passo é diferente. Do segundo em diante é o fluxo que já existe e
// já foi testado.
//
// ── O FREIO ────────────────────────────────────────────────────────────────
//
// `gloria_teto_dia` limita quantos primeiros contatos ela dá por dia. Existe por
// dois motivos que só aparecem com tráfego ligado:
//
//   • CUSTO. Cada conversa iniciada por template é cobrada pela Meta, e cada
//     resposta gasta modelo. Campanha que escala à noite pode multiplicar isso
//     enquanto ninguém está olhando.
//   • ESTRAGO. Se ela estiver falando besteira, o teto é o que separa "20
//     conversas ruins" de "400 conversas ruins".
//
// Bater o teto NÃO PERDE O LEAD: ele fica no pipeline sem ser abordado e a
// abordagem sai no dia seguinte, ou um humano assume. Perder lead pago é o
// único erro que não dá pra desfazer.
//
// Envs: CHATWOOT_* (ver _wa.js) + SUPABASE_*
// -----------------------------------------------------------------------------

import {
  cwConfigured, cw, ingestMessage, ensureConversation, defaultInboxId,
  clienteFalouRecente, resolverModelo,
} from './_wa.js';
import { rest } from './_supabaseAdmin.js';
import { avisarGloria, registrar, ASSINATURA_IA } from './_gloria.js';

/** Qual template aprovado ela usa pra puxar assunto. Ver `montarParams`. */
export const CHAVE_TEMPLATE = 'gloria_template_abertura';

/** Quantos primeiros contatos por dia, no máximo. 0 = ninguém. */
export const CHAVE_TETO = 'gloria_teto_dia';
const TETO_PADRAO = 30;

/** Motivo com que a abordagem entra no log. É por ele que o teto é contado. */
const MOTIVO_LOG = 'primeiro_contato';

// ── Configuração ────────────────────────────────────────────────────────────

async function config(chave, padrao) {
  try {
    const rows = await rest(`qs_settings?select=value&key=eq.${encodeURIComponent(chave)}&limit=1`);
    const v = rows?.[0]?.value;
    return v === undefined || v === null ? padrao : v;
  } catch {
    return padrao;
  }
}

/** Quantas abordagens já saíram hoje (no fuso de São Paulo, que é o do time). */
export async function abordagensDeHoje() {
  // A virada do dia é a de São Paulo, não a do UTC. Sem isso o teto zeraria às
  // 21h — no meio do horário de maior volume das campanhas.
  const agora = new Date();
  const emSP = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const meiaNoiteSP = new Date(emSP);
  meiaNoiteSP.setHours(0, 0, 0, 0);
  const desde = new Date(agora.getTime() - (emSP.getTime() - meiaNoiteSP.getTime())).toISOString();

  try {
    const r = await rest(
      `qs_gloria_log?select=id&direcao=eq.out&motivo=eq.${MOTIVO_LOG}` +
      `&criado_em=gte.${encodeURIComponent(desde)}&limit=1000`
    );
    return Array.isArray(r) ? r.length : 0;
  } catch (e) {
    // Na dúvida, o número que TRAVA. Um teto que falha aberto não é um teto.
    console.warn('[abordagem] não consegui contar as de hoje:', e?.message);
    return Number.MAX_SAFE_INTEGER;
  }
}

// ── O template ──────────────────────────────────────────────────────────────

/**
 * Preenche os `params` do template com dados do lead.
 *
 * O que fica salvo em `gloria_template_abertura` é, por exemplo:
 *
 *   { "nome": "boas_vindas_expedicao", "idioma": "pt_BR",
 *     "params": { "1": "{{primeiro_nome}}", "2": "{{expedicao}}" } }
 *
 * As chaves de `params` são as variáveis DO TEMPLATE (a Meta usa {{1}}, {{2}});
 * os valores podem ser texto fixo ou um destes apelidos. Escrever o apelido
 * errado devolve erro em vez de mandar "{{primeiro_nome}}" pro cliente — é o
 * tipo de coisa que só se descobre pelo print do cliente reclamando.
 */
function montarParams(modelo, lead) {
  const nomeCompleto = String(lead?.full_name || lead?.first_name || '').trim();
  const primeiro = (lead?.first_name || nomeCompleto.split(/\s+/)[0] || '').trim();

  const apelidos = {
    nome: nomeCompleto || primeiro,
    primeiro_nome: primeiro,
    expedicao: String(lead?.segment || '').trim(),
    empresa: 'Se Tu For, Eu Vou',
  };

  const entrada = (modelo?.params && typeof modelo.params === 'object') ? modelo.params : {};
  const saida = {};
  for (const [chave, bruto] of Object.entries(entrada)) {
    const v = String(bruto ?? '');
    const ref = v.match(/^\s*\{\{\s*([a-z_]+)\s*\}\}\s*$/i);
    if (!ref) { saida[chave] = v; continue; }
    const apelido = ref[1].toLowerCase();
    if (!(apelido in apelidos)) return { erro: `apelido desconhecido no template: {{${apelido}}}` };
    const valor = String(apelidos[apelido] || '').trim();
    // Variável vazia a Meta recusa, e o Chatwoot responde 422 sem dizer qual.
    // Melhor barrar aqui, com o nome da variável, do que perder a abordagem.
    if (!valor) return { erro: `o lead não tem ${apelido} — o template precisa de {{${apelido}}}` };
    saida[chave] = valor;
  }
  return { params: saida };
}

// ── A abordagem ─────────────────────────────────────────────────────────────

/**
 * Ela puxa assunto com este lead. Devolve sempre um objeto com `ok` e `motivo` —
 * nunca lança, porque quem chama é o caminho de criação de lead e derrubar a
 * criação do lead por causa da abordagem seria trocar um problema pequeno por um
 * grande.
 *
 * `teste: true` faz tudo menos enviar: útil pra ver qual porta ela usaria e com
 * que texto, sem gastar template nem incomodar ninguém.
 */
export async function abordar({ lead, origem = 'automatica', teste = false }) {
  const leadId = lead?.id;
  if (!leadId) return { ok: false, motivo: 'sem_lead' };
  if (!lead?.phone) return { ok: false, motivo: 'lead_sem_telefone' };

  // (1) Ela está ligada?
  const ativa = await config('gloria_ativa', false);
  if (ativa !== true && String(ativa) !== 'true') return { ok: false, motivo: 'gloria_desligada' };

  // (2) A sessão precisa estar ativa. Se alguém já tirou a IA desta conversa
  //     (ou o lead já foi devolvido pro time), abordar seria a IA voltando a
  //     falar por cima de um humano.
  let ses = null;
  try {
    const rows = await rest(
      `qs_gloria_sessoes?select=lead_id,ativa,motivo&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
    );
    ses = rows?.[0] || null;
  } catch (e) {
    return { ok: false, motivo: 'sem_sessao', detalhe: e?.message };
  }
  if (!ses) return { ok: false, motivo: 'fora_do_pipeline' };
  if (ses.ativa === false) return { ok: false, motivo: 'ia_desligada_neste_lead', detalhe: ses.motivo };

  // (3) Já falamos com ele? Duas abordagens seguidas é o erro que o cliente
  //     percebe na hora — e o que mais rápido faz alguém bloquear o número.
  try {
    const ja = await rest(
      `qs_gloria_log?select=id&lead_id=eq.${encodeURIComponent(leadId)}` +
      `&direcao=eq.out&motivo=eq.${MOTIVO_LOG}&limit=1`
    );
    if (Array.isArray(ja) && ja.length) return { ok: false, motivo: 'ja_abordado' };
  } catch { /* melhor arriscar abordar do que travar por causa do log */ }

  // (4) O freio.
  const teto = Number(await config(CHAVE_TETO, TETO_PADRAO));
  if (!Number.isFinite(teto) || teto <= 0) return { ok: false, motivo: 'teto_zerado' };
  const hoje = await abordagensDeHoje();
  if (hoje >= teto) {
    await registrar(leadId, 'evento', null, 'teto_do_dia', { hoje, teto });
    return { ok: false, motivo: 'teto_do_dia', hoje, teto };
  }

  // (5) Qual porta.
  const janelaAberta = await clienteFalouRecente(leadId, 24);

  if (janelaAberta) return abordarPelaJanela({ leadId, lead, origem, teste });
  return abordarPorTemplate({ leadId, lead, origem, teste });
}

/**
 * JANELA ABERTA — o lead escreveu nas últimas 24h e a IA não estava na conversa
 * naquele momento (entrou no pipeline depois, ou foi reaberta).
 *
 * Aqui NÃO inventamos uma saudação. A última mensagem dele volta pro fluxo
 * normal como se tivesse acabado de chegar, e ela responde do jeito de sempre —
 * com o contexto que ele já deu. Isso vale mais que qualquer "oi, tudo bem?", e
 * de quebra não exige nada de novo no n8n: é exatamente a chamada que o webhook
 * do WhatsApp já faz mil vezes por dia.
 */
async function abordarPelaJanela({ leadId, lead, origem, teste }) {
  let ultima = null;
  try {
    const rows = await rest(
      `qs_wa_messages?select=cw_message_id,content,transcricao,sent_at,cw_conversation_id` +
      `&lead_id=eq.${encodeURIComponent(leadId)}&direction=eq.in&order=sent_at.desc&limit=1`
    );
    ultima = rows?.[0] || null;
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_ler_conversa', detalhe: e?.message };
  }

  const texto = String(ultima?.transcricao || ultima?.content || '').trim();
  if (!texto) return { ok: false, motivo: 'ultima_mensagem_sem_texto' };

  if (teste) return { ok: true, teste: true, porta: 'janela_aberta', responderia_a: texto.slice(0, 200) };

  const r = await avisarGloria({
    lead,
    telefone: lead.phone,
    conversationId: ultima.cw_conversation_id ?? null,
    message: {
      id: ultima.cw_message_id ?? null,
      content: texto,
      created_at: ultima.sent_at ?? null,
    },
  });

  await registrar(leadId, 'out', texto.slice(0, 500), MOTIVO_LOG, { porta: 'janela_aberta', origem, n8n: r?.status ?? null });

  return r?.ok
    ? { ok: true, porta: 'janela_aberta' }
    : { ok: false, motivo: 'n8n_recusou', detalhe: r?.status || r?.motivo, porta: 'janela_aberta' };
}

/**
 * JANELA FECHADA — o caso do formulário. Só template aprovado passa.
 *
 * Enviado pelo QS, e não pelo n8n, de propósito: é o mesmo caminho que o SDR já
 * usa (`wa-send`), então cai na mesma conversa, é gravado na thread do lead e
 * aparece na tela junto com o resto. Um template disparado por fora existiria só
 * dentro de uma execução do n8n.
 */
async function abordarPorTemplate({ leadId, lead, origem, teste }) {
  if (!cwConfigured()) return { ok: false, motivo: 'chatwoot_nao_configurado' };

  const modelo = await config(CHAVE_TEMPLATE, null);
  if (!modelo?.nome) {
    return {
      ok: false,
      motivo: 'sem_template_de_abertura',
      // Este texto vai pra tela: é a diferença entre "não funcionou" e "faltou
      // escolher o modelo".
      detalhe: 'Escolha o modelo aprovado da Meta em Atendimento IA → Primeiro contato.',
    };
  }

  const p = montarParams(modelo, lead);
  if (p.erro) return { ok: false, motivo: 'template_incompleto', detalhe: p.erro };

  const resolvido = await resolverModelo({ nome: modelo.nome, idioma: modelo.idioma, params: p.params });
  if (resolvido?.error) return { ok: false, motivo: resolvido.error, detalhe: resolvido.variavel || null };

  if (teste) {
    return { ok: true, teste: true, porta: 'template', modelo: modelo.nome, texto: resolvido.texto };
  }

  // A conversa pode não existir: lead de formulário nunca escreveu.
  let conversationId = null;
  let contactId = null;
  let inboxId = resolvido.inboxId || defaultInboxId();
  try {
    const rows = await rest(
      `qs_wa_threads?select=cw_conversation_id,cw_contact_id,cw_inbox_id` +
      `&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
    );
    conversationId = rows?.[0]?.cw_conversation_id ?? null;
    contactId = rows?.[0]?.cw_contact_id ?? null;
    if (rows?.[0]?.cw_inbox_id) inboxId = rows[0].cw_inbox_id;
  } catch { /* sem thread ainda é o normal aqui */ }

  if (!conversationId) {
    try {
      // A inbox do template MANDA: o template foi aprovado num número
      // específico. Mandar por outro é 422 na hora.
      const r = await ensureConversation(lead, resolvido.inboxId || null);
      conversationId = r?.conversation?.id ?? null;
      contactId = r?.contact?.id ?? contactId;
      inboxId = r?.conversation?.inbox_id ?? inboxId;
    } catch (e) {
      return { ok: false, motivo: 'falha_ao_abrir_conversa', detalhe: e?.message };
    }
  }
  if (!conversationId) return { ok: false, motivo: 'sem_conversa' };

  let sent;
  try {
    sent = await cw(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: {
        // O corpo aprovado, sem assinatura por cima: assinatura muda o texto e a
        // Meta recusa. Se ela precisa se apresentar, isso mora na copy do
        // template — que é onde a Meta consegue ler.
        content: resolvido.texto,
        message_type: 'outgoing',
        private: false,
        template_params: resolvido.templateParams,
      },
    });
  } catch (e) {
    await registrar(leadId, 'erro', resolvido.texto, `abordagem_falhou: ${e?.message || 'erro'}`);
    return { ok: false, motivo: 'envio_falhou', detalhe: e?.message };
  }

  // ⚠️ DAQUI PRA BAIXO A MENSAGEM JÁ SAIU. O log vem ANTES da ingestão pela
  // mesma razão do gloria-responder: é por ele que o gatilho da 0053 reconhece
  // o eco desta mensagem e não a confunde com "humano assumiu a conversa".
  await registrar(leadId, 'out', resolvido.texto, MOTIVO_LOG, {
    porta: 'template', modelo: modelo.nome, origem, cw_message_id: sent?.id ?? null,
  });

  try {
    await ingestMessage({
      leadId, conversationId, contactId, inboxId,
      message: {
        id: sent?.id ?? null,
        content: resolvido.texto,
        message_type: 1,
        created_at: sent?.created_at ?? null,
        sender: { name: ASSINATURA_IA },
        source_id: sent?.source_id ?? null,
        status: sent?.status || 'sent',
      },
    });
  } catch (e) {
    console.error('[abordagem] enviado, mas falhou ao gravar:', e?.message);
  }

  return { ok: true, porta: 'template', modelo: modelo.nome, conversationId };
}
