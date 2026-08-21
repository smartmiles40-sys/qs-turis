// api/wa-webhook.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/wa-webhook?secret=<WA_WEBHOOK_SECRET>
//
// É por aqui que a mensagem de WhatsApp entra no QS. O Chatwoot dispara este
// webhook a cada mensagem (recebida ou enviada); nós descobrimos de qual LEAD é
// aquele telefone e gravamos a mensagem amarrada a ele. A partir daí a RLS faz o
// resto: só o SDR dono do lead (e o gestor) enxerga aquela conversa.
//
// Configurar no Chatwoot: Configurações → Integrações → Webhooks → adicionar
//   https://qs.setuforeuvouviagens.com.br/api/wa-webhook?secret=<segredo>
//   evento: "Mensagem criada" (message_created).
//
// Envs: WA_WEBHOOK_SECRET + SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//       (CHATWOOT_WA_INBOX_IDS opcional — atalho que evita uma consulta ao
//        Chatwoot; quais caixas são de WhatsApp o próprio Chatwoot informa)
//
// Responde 200 quase sempre, de propósito: webhook que recebe erro fica em
// retentativa eterna e entope a fila do Chatwoot. O que não deu pra tratar vira
// log na Vercel com o motivo.
// -----------------------------------------------------------------------------

import {
  findLeadByPhone, ingestMessage, inboxAceita, completeWhatsAppTask, directionOf,
  reabrirPorFalha, extractStatus, parseCwDate, waKey,
} from './_wa.js';
import { insert, rest, segredoConfere } from './_supabaseAdmin.js';
import { procurarNegocioPorTelefone } from './_bitrixLead.js';
import { createInboundLead } from './_leads.js';
import { verificarSeVencido } from './_waAlerta.js';
import { avisarGloria, rodarFilaDeToques } from './_gloria.js';

/**
 * O cliente apagou a mensagem no celular dele.
 *
 * O Chatwoot avisa por message_updated com content_attributes.deleted = true.
 * Nós apenas CARIMBAMOS a mensagem (qs_wa_apagar, migration 0046): o texto fica
 * no QS, que é o arquivo da conversa — saber o que o cliente apagou é
 * justamente o que interessa a um time comercial. A tela mostra a marca "o
 * cliente apagou · só você vê".
 *
 * Best-effort: falhou, o webhook segue e a mensagem apenas não é marcada.
 */
async function marcarApagada(cwMessageId) {
  try {
    const rows = await rest(
      `qs_wa_messages?select=id&cw_message_id=eq.${encodeURIComponent(cwMessageId)}&limit=1`
    );
    const id = Array.isArray(rows) && rows[0]?.id;
    if (!id) return false;
    // p_user null: quem apagou foi o cliente, não alguém do time.
    await rest('rpc/qs_wa_apagar', { method: 'POST', body: { p_msg: id, p_user: null } });
    return true;
  } catch (e) {
    // Função ausente = a 0045 ainda não foi colada. Não é motivo de alarme.
    if (!/qs_wa_apagar|schema cache|function/i.test(String(e?.message))) {
      console.warn('[wa-webhook] marcarApagada:', e?.message);
    }
    return false;
  }
}

/**
 * Registra a mensagem que NÃO deu pra vincular.
 *
 * O webhook responde 200 e segue a vida de propósito (erro aqui vira
 * retentativa eterna do Chatwoot). O preço disso era a mensagem sumir sem
 * rastro em lugar nenhum — foi assim que "não estão chegando mensagens" ficou
 * invisível. Agora cada descarte deixa uma linha.
 *
 * Best-effort: se o próprio registro falhar, o webhook segue. Registrar o
 * problema nunca pode virar um problema maior.
 */
async function registrarDescarte(motivo, dados = {}) {
  const linha = {
    motivo,
    phone: dados.phone ? String(dados.phone).replace(/\D/g, '') : null,
    inbox_id: dados.inboxId ?? null,
    cw_message_id: dados.messageId ?? null,
    detalhe: dados.detalhe ?? null,
  };
  try {
    // O nome como o WhatsApp mostra (coluna da 0047). É o que transforma a
    // triagem de uma lista de telefones numa lista de PESSOAS — reconhecer
    // "é a Tainara, do time" leva um segundo; deduzir isso de +5585… não.
    await insert('qs_wa_descartadas', { ...linha, contato_nome: dados.nome || null }, { returning: false });
  } catch (e) {
    // Coluna ausente = 0047 ainda não colada. Registrar o descarte importa mais
    // que o nome: sem a linha, "sumiu mensagem" volta a não ter onde ser
    // investigado — que é exatamente o buraco que a 0038 fechou.
    if (/contato_nome|42703|PGRST204/i.test(String(e?.message))) {
      try {
        await insert('qs_wa_descartadas', linha, { returning: false });
        return;
      } catch (e2) {
        console.warn('[wa-webhook] não deu pra registrar o descarte:', e2?.message);
        return;
      }
    }
    console.warn('[wa-webhook] não deu pra registrar o descarte:', e?.message);
  }
}

/**
 * Os números que NUNCA viram lead: o próprio time.
 *
 * Vem de `qs_users.whatsapp_number` (o cadastro que já existe na tela de
 * usuários) mais a chave `wa_ignorar_numeros` em `qs_settings` — uma lista de
 * telefones em texto, pro Bruno acrescentar caso de exceção sem precisar de
 * deploy. Comparação pela chave canônica, então o formato tanto faz.
 *
 * Cache de 5 min: isto roda no caminho do webhook e a lista quase nunca muda.
 */
let cacheIgnorados = null;

async function numerosIgnorados() {
  if (cacheIgnorados && Date.now() - cacheIgnorados.em < 5 * 60_000) return cacheIgnorados.set;
  const set = new Set();
  try {
    const users = await rest('qs_users?select=whatsapp_number&whatsapp_number=not.is.null');
    for (const u of (users || [])) {
      const k = waKey(u.whatsapp_number);
      if (k) set.add(k);
    }
  } catch (e) {
    console.warn('[wa-webhook] não deu pra ler os números do time:', e?.message);
  }
  try {
    const s = await rest(`qs_settings?select=value&key=eq.wa_ignorar_numeros&limit=1`);
    const bruto = s?.[0]?.value;
    const lista = Array.isArray(bruto) ? bruto : String(bruto ?? '').split(/[,;\s]+/);
    for (const n of lista) {
      const k = waKey(n);
      if (k) set.add(k);
    }
  } catch {
    // chave inexistente é o normal — não é erro.
  }
  cacheIgnorados = { set, em: Date.now() };
  return set;
}

/**
 * Número desconhecido escreveu: decide se vira lead e devolve o lead criado
 * (ou null pra cair na triagem de sempre).
 *
 * Só nasce lead de mensagem RECEBIDA. Se fomos NÓS que escrevemos primeiro pra
 * um número solto — disparo do time, contato pessoal de alguém, teste —, criar
 * card seria inventar demanda: o time não perdeu ninguém, ele que iniciou.
 */
async function nascerDoWhatsApp({ phone, nome, direcao, inboxId }) {
  if (direcao !== 'in') return null;

  const chave = waKey(phone);
  if (!chave) return null;
  if ((await numerosIgnorados()).has(chave)) {
    console.log('[wa-webhook] número do time escreveu; não vira lead:', chave);
    return null;
  }

  // O Bitrix é a fonte da verdade sobre "essa pessoa já é nossa cliente?".
  const noBitrix = await procurarNegocioPorTelefone(phone);

  // Bitrix fora do ar não autoriza chutar. Sem a resposta dele, criar seria
  // apostar que a pessoa é nova — e a medição de 13/08 diz que a aposta perde:
  // 13 em cada 18 já existiam lá. Cai na triagem, que é reversível; card
  // duplicado no funil do Comercial não é.
  if (noBitrix?.indisponivel) {
    console.warn('[wa-webhook] Bitrix indisponível, mando pra triagem:', noBitrix.motivo);
    return null;
  }

  const payload = {
    full_name: nome || `WhatsApp ${String(phone).replace(/\D/g, '').slice(-8)}`,
    phone,
    source: 'api',
    segment: 'WhatsApp (API oficial)',
    // Achou negócio lá: o lead nasce colado nele. O createInboundLead entende
    // `bitrix_id` preenchido como "já tem card" e NÃO abre negócio novo — que é
    // justamente o que evita a duplicata que sujou o funil em 18/08.
    ...(noBitrix?.dealId ? { bitrix_id: noBitrix.dealId } : {}),
  };

  const { lead } = await createInboundLead(payload, {
    // Cliente que já está no Bitrix entra sem cadência (ver o porquê no
    // _leads.js). Gente nova de verdade entra na cadência padrão.
    semCadencia: !!noBitrix?.dealId,
  });
  if (!lead) return null;

  // Rastro pra quem abrir o card entender de onde ele saiu — e, quando veio do
  // Bitrix, que NÃO é um lead novo apesar de ter acabado de aparecer no QS.
  try {
    await insert('qs_notes', {
      lead_id: lead.id,
      author_id: null,
      body: (noBitrix?.dealId
        ? `📲 Escreveu no WhatsApp (API oficial).\nJá existia no Bitrix — negócio ${noBitrix.dealId}. Card do QS ligado a ele, sem abrir negócio novo.`
        : '📲 Escreveu no WhatsApp (API oficial) e não existia no Bitrix. Lead e negócio criados agora.')
        // Qual LINHA recebeu importa: o time tem mais de uma (SDR na API
        // oficial, closer no número conectado por QR). Saber por onde a pessoa
        // entrou é o que permite responder pela linha certa depois.
        + (inboxId ? `\nCaixa: ${inboxId}.` : ''),
      tags: ['whatsapp', 'origem'],
    }, { returning: false });
  } catch (e) {
    console.warn('[wa-webhook] nota de origem do WhatsApp falhou (segue):', e?.message);
  }

  console.log(`[wa-webhook] lead ${lead.id} nasceu do WhatsApp (${noBitrix?.dealId ? 'reaproveitou negócio ' + noBitrix.dealId : 'negócio novo ' + (lead.bitrix_id || '-')})`);
  return lead;
}

/** O nome que o Chatwoot mostra pro contato da conversa (pode não existir). */
function extractNome(body, message) {
  const conv = body?.conversation || message?.conversation || {};
  return conv?.meta?.sender?.name || body?.contact?.name || null;
}

/**
 * O payload do webhook não tem uma forma só: dependendo do evento, a mensagem
 * vem achatada na raiz ou dentro de `message`. Normaliza os dois.
 */
function extractMessage(body) {
  if (body?.message && typeof body.message === 'object') return body.message;
  if (body?.id != null && (body?.content != null || body?.attachments)) return body;
  return null;
}

/**
 * O telefone do CLIENTE. Cuidado: em mensagem enviada, `sender` é o atendente —
 * pegar o telefone dali gravaria a conversa no lead errado (ou em nenhum). O
 * contato da conversa (`conversation.meta.sender`) é o único que vale sempre.
 */
function extractPhone(body, message) {
  const conv = body?.conversation || message?.conversation || {};
  const metaSender = conv?.meta?.sender || {};
  const candidates = [
    metaSender.phone_number,
    metaSender.identifier,
    body?.contact?.phone_number,
    // só como último recurso, e só quando quem mandou foi o próprio contato
    (message?.message_type === 0 || message?.message_type === 'incoming')
      ? (message?.sender?.phone_number || body?.sender?.phone_number)
      : null,
  ];
  return candidates.find((c) => c) || null;
}

function inboxIdOf(body, message) {
  const conv = body?.conversation || message?.conversation || {};
  return conv.inbox_id ?? body?.inbox?.id ?? null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  // .trim() dos dois lados de propósito: segredo colado no painel da Vercel vem
  // com espaço/quebra de linha invisível com uma frequência alta demais, e o
  // sintoma é péssimo de diagnosticar — 401 em toda mensagem, sem pista nenhuma.
  const secret = String(process.env.WA_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    console.error('[wa-webhook] WA_WEBHOOK_SECRET ausente — rota desligada');
    return res.status(503).json({ error: 'Webhook não configurado' });
  }
  const sent = String(req.query?.secret || req.headers['x-qs-secret'] || '').trim();
  if (!segredoConfere(sent, secret)) {
    // Não loga os valores (é segredo); loga só o suficiente pra saber se é
    // "não mandaram" ou "mandaram diferente".
    console.warn(`[wa-webhook] segredo não confere (recebido: ${sent ? 'presente' : 'ausente'})`);
    return res.status(401).json({ error: 'Não autorizado' });
  }

  // ── O VIGIA PEGA CARONA NO MOVIMENTO ───────────────────────────────────────
  // Fica ANTES do tratamento do evento de propósito: a maior parte do que o
  // Chatwoot manda é evento repetido que ignoramos logo abaixo, e esses hits
  // valem como pulso igual. Assim o vigia depende do WhatsApp estar sendo
  // usado — não de um agendador externo que morre calado (foi o que aconteceu
  // entre 17/08 e 19/08). Trava de 10min: uma ronda a cada ~50 mensagens.
  await verificarSeVencido().catch(() => {});

  // ── A CADÊNCIA DA GLÓRIA PEGA CARONA NO MESMO MOVIMENTO ────────────────────
  // Mesma ideia, mesma lição: agendador externo morre calado. Aqui o limite é
  // DOIS de propósito — o caminho do webhook não pode engordar (auditoria de
  // 20/08), e a fila tem trava de 5 minutos, então a esmagadora maioria das
  // mensagens só paga um SELECT. A perna principal continua sendo o QS aberto
  // na tela, que roda a fila inteira.
  await rodarFilaDeToques({ limite: 2 }).catch(() => {});

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const event = body?.event || '';

  if (event && event !== 'message_created' && event !== 'message_updated') {
    return res.status(200).json({ ignored: 'evento-nao-tratado', event });
  }

  const message = extractMessage(body);
  if (!message) return res.status(200).json({ ignored: 'sem-mensagem' });

  // Apagada no celular do cliente: chega como message_updated com o conteúdo já
  // vazio. Tem que ser tratado ANTES da ingestão — que descartaria o evento por
  // "nada pra mostrar" e a mensagem nunca ganharia a marca de apagada.
  if (message?.content_attributes?.deleted === true && message?.id != null) {
    const ok = await marcarApagada(message.id);
    return res.status(200).json({ ok, apagada: true, messageId: message.id });
  }

  // Caixa de e-mail/site não interessa aqui — só WhatsApp. Quem decide é o
  // channel_type que o Chatwoot informa; a env CHATWOOT_WA_INBOX_IDS virou
  // atalho, não requisito (ver inboxAceita em _wa.js). Antes, caixa nova que
  // ninguém somou na env tinha TODA mensagem descartada em silêncio.
  const inboxId = inboxIdOf(body, message);
  const porta = await inboxAceita(inboxId);
  if (!porta.aceita) {
    await registrarDescarte(porta.motivo || 'inbox-fora-do-whatsapp', {
      inboxId, messageId: message?.id, phone: extractPhone(body, message),
    });
    return res.status(200).json({ ignored: porta.motivo || 'inbox-fora-do-whatsapp', inboxId });
  }

  const phone = extractPhone(body, message);
  if (!phone) {
    await registrarDescarte('sem-telefone', { inboxId, messageId: message?.id });
    return res.status(200).json({ ignored: 'sem-telefone' });
  }

  try {
    // A conversa já tem dono? O vínculo conversa→lead da thread VENCE o match
    // por telefone. Motivo (medido em 13/08): com os leads duplicados por
    // telefone, o findLeadByPhone ordena por updated_at e o "vencedor" muda ao
    // longo do tempo — 26 conversas ficaram com o histórico DIVIDIDO entre dois
    // cards (ex.: 6 mensagens num, 1 no outro). A thread torna o roteamento
    // determinístico: quem recebeu a conversa uma vez fica com ela.
    const convId = (body?.conversation || message?.conversation || {})?.id;
    let lead = null;
    if (convId != null) {
      try {
        const th = await rest(
          `qs_wa_threads?select=lead_id&cw_conversation_id=eq.${encodeURIComponent(convId)}&order=synced_at.desc.nullslast&limit=1`
        );
        const leadId = Array.isArray(th) && th[0]?.lead_id;
        if (leadId) {
          const rows = await rest(`qs_leads?select=id,owner_id,full_name,first_name,last_name,phone,status&id=eq.${encodeURIComponent(leadId)}&limit=1`);
          lead = (Array.isArray(rows) && rows[0]) || null;
        }
      } catch (e) {
        console.warn('[wa-webhook] lookup por conversa falhou (cai pro telefone):', e?.message);
      }
    }

    if (!lead) lead = await findLeadByPhone(phone);

    // ── PERGUNTA AO BITRIX ANTES DE CRIAR (Bruno, 20/08) ───────────────────
    //
    // Histórico curto, porque ele explica a regra: de 13 a 18/08 a caixa oficial
    // criava lead pra QUALQUER número que escrevesse, e isso rendeu ~18 cards de
    // gente que não era lead novo (cliente antigo com telefone em outro formato,
    // pós-venda, colega de time). Em 18/08 a criação foi desligada e todo mundo
    // passou a cair numa fila de triagem manual — que acumulou 38 pessoas sem
    // ninguém tratar, e aí o cliente ficava invisível nos DOIS sistemas.
    //
    // A saída não é escolher entre sujar e sumir: é PERGUNTAR AO BITRIX.
    //   • Achou negócio lá  → o lead nasce no QS AMARRADO nele. Nenhum card
    //                         novo, nenhuma cadência: é cliente, não prospect.
    //   • Não achou         → gente nova de verdade: nasce no QS e ganha card.
    //   • Número do time    → ignora (ninguém quer card do próprio colega).
    //
    // Tudo best-effort: qualquer erro cai na triagem de antes, que continua
    // existindo. Nada aqui pode custar a mensagem.
    if (!lead) {
      const nomeContato = extractNome(body, message);
      try {
        lead = await nascerDoWhatsApp({
          phone, nome: nomeContato, direcao: directionOf(message), inboxId,
        });
      } catch (e) {
        console.warn('[wa-webhook] nascimento pelo WhatsApp falhou (vai pra triagem):', e?.message);
      }
      if (!lead) {
        // Não é erro: é gente falando com a agência que ainda não virou lead.
        // Registrado porque essa lista É oportunidade comercial — e porque, sem
        // ela, "sumiu mensagem" não tem onde ser investigado.
        await registrarDescarte('sem-lead-correspondente', {
          phone, inboxId, messageId: message?.id, nome: nomeContato,
        });
        return res.status(200).json({ ignored: 'sem-lead-correspondente' });
      }
    }

    const conv = body?.conversation || message?.conversation || {};
    const saved = await ingestMessage({
      leadId: lead.id,
      conversationId: conv.id ?? null,
      message,
      contactId: conv?.meta?.sender?.id ?? null,
      canReply: typeof conv.can_reply === 'boolean' ? conv.can_reply : null,
      inboxId,
    });

    // ── A ATIVIDADE FECHA VENHA A RESPOSTA DE ONDE VIER ────────────────────
    // Antes, só o botão de enviar do QS baixava a tarefa de WhatsApp. Quem
    // respondia por fora — pela caixa do Chatwoot, pelo aparelho, ou por
    // qualquer automação que fale pela API oficial — deixava a atividade em
    // aberto: o cliente já tinha sido atendido e a fila continuava cobrando.
    //
    // Aqui a origem não importa: se saiu uma mensagem NOSSA pra esse lead, o
    // toque de WhatsApp do dia está feito. Chamar duas vezes não atrapalha —
    // a função só encosta em tarefa que ainda está `pendente`.
    //
    // Só em `message_created`: `message_updated` traz mudança de STATUS, e uma
    // mensagem que virou "failed" não pode passar por atendimento feito.
    let tarefa = null;
    const ehNossa = directionOf(message) === 'out' && message?.private !== true;
    if (ehNossa && (!event || event === 'message_created')) {
      try {
        tarefa = await completeWhatsAppTask(lead.id, lead.owner_id ?? null);
      } catch (e) {
        console.warn('[wa-webhook] não consegui concluir a atividade:', e?.message);
      }
    }

    // E o contrário: a mensagem que baixou a atividade acabou de virar "falhou".
    // Sem isto, a fila dá o lead como atendido por uma mensagem que o cliente
    // nunca recebeu — o buraco que deixou 40 mensagens mortas desde 01/08.
    let reaberta = null;
    if (ehNossa && event === 'message_updated' && extractStatus(message) === 'failed') {
      reaberta = await reabrirPorFalha(lead.id, lead.owner_id ?? null, parseCwDate(message?.created_at));
    }

    // ── A GLÓRIA (IA) FICA SABENDO ─────────────────────────────────────────
    // Só de mensagem NOVA do cliente: `saved` false é evento repetido do
    // Chatwoot (acontece o tempo todo) e faria a IA responder duas vezes.
    // Se ela deve ou não falar, quem decide é o banco — aqui é só o aviso.
    let gloria = null;
    if (saved && directionOf(message) === 'in' && (!event || event === 'message_created')) {
      gloria = await avisarGloria({
        lead, message, conversationId: conv.id ?? null, telefone: phone,
      });
    }

    return res.status(200).json({ ok: true, leadId: lead.id, novo: saved, tarefaConcluida: tarefa, reaberta, gloria });
  } catch (e) {
    // Erro nosso: loga e responde 200 mesmo assim (ver cabeçalho do arquivo).
    console.error('[wa-webhook]', e?.message, e?.details || '');
    await registrarDescarte('erro', { phone, inboxId, messageId: message?.id, detalhe: e?.message });
    return res.status(200).json({ ok: false, erro: e?.message || 'falha' });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
