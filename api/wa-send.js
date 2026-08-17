// api/wa-send.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/wa-send
//   { leadId, text }                          → mensagem de texto normal
//   { leadId, modelo: { nome, idioma, params } } → TEMPLATE aprovado da Meta
//
// Envia a mensagem de WhatsApp do SDR pelo Chatwoot (que fala com a Evolution,
// que fala com o WhatsApp) — sem o navegador nunca ter visto o token do Chatwoot
// e, principalmente, sem o SDR conseguir escrever pra um lead que não é dele:
// a conversa é resolvida A PARTIR do lead, depois de o servidor confirmar a posse.
//
// Se ainda não existe conversa (lead que nunca falou com a gente), cria contato e
// conversa no Chatwoot antes de mandar — assim a primeira abordagem também sai
// pelo QS, e não por fora.
//
// TEMPLATE (número oficial): fora da janela de 24h — ou numa conversa que nunca
// existiu — a Meta só aceita template aprovado. O corpo NÃO vem do navegador:
// o servidor busca o template no Chatwoot pelo nome, preenche as variáveis e
// manda com template_params. Assim o que sai é sempre o texto aprovado, sem
// assinatura por cima (assinatura mudaria o texto e a Meta recusaria).
//
// Envs: CHATWOOT_* (ver _wa.js) + CHATWOOT_DEFAULT_INBOX_ID (ou a 1ª de
//       CHATWOOT_WA_INBOX_IDS) pra saber por qual número mandar.
// -----------------------------------------------------------------------------

import {
  assertCanAccessLead, getSupabaseUserId, cwConfigured, cw, ingestMessage,
  ensureConversation, defaultInboxId, motivoHumano, completeWhatsAppTask, inboxPermitida,
  assinarComoUsuario,
} from './_wa.js';
import { rest } from './_supabaseAdmin.js';

const MAX_LEN = 4000;

/**
 * Busca no Chatwoot o template aprovado com esse nome/idioma e devolve o corpo
 * já preenchido. A fonte é o Chatwoot (que sincroniza da Meta) — nunca o texto
 * que veio do navegador: template adulterado a Meta recusa, e template certo
 * com corpo errado gravaria no QS uma coisa diferente do que o cliente recebeu.
 */
async function resolverModelo(modelo) {
  const nome = String(modelo?.nome || '').trim();
  if (!nome) return { error: 'modelo-sem-nome' };
  const params = (modelo?.params && typeof modelo.params === 'object') ? modelo.params : {};

  const data = await cw('/inboxes');
  const list = Array.isArray(data?.payload) ? data.payload : [];
  for (const i of list) {
    if (!String(i.channel_type || '').includes('Channel::Whatsapp')) continue;
    const t = (Array.isArray(i.message_templates) ? i.message_templates : []).find((x) =>
      x.name === nome &&
      String(x.status || '').toLowerCase() === 'approved' &&
      (!modelo.idioma || x.language === modelo.idioma)
    );
    if (!t) continue;

    const comp = Array.isArray(t.components) ? t.components : [];
    const corpo = comp.find((c) => String(c.type).toUpperCase() === 'BODY')?.text || '';
    if (!corpo) return { error: 'modelo-sem-corpo' };

    let faltando = null;
    const preenchido = corpo.replace(/{{\s*([^}]+?)\s*}}/g, (_, chave) => {
      const v = params[chave];
      if (v == null || String(v).trim() === '') { faltando = chave; return ''; }
      return String(v).trim();
    });
    if (faltando) return { error: 'modelo-variavel-vazia', variavel: faltando };

    return {
      inboxId: Number(i.id),
      texto: preenchido,
      templateParams: {
        name: t.name,
        category: t.category,
        language: t.language,
        namespace: t.namespace ?? null,
        processed_params: Object.fromEntries(
          Object.entries(params).map(([k, v]) => [k, String(v).trim()])
        ),
      },
    };
  }
  return { error: 'modelo-nao-encontrado' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const leadId = String(body.leadId || '').trim();
  const text = String(body.text || '').trim();
  const modelo = body.modelo && typeof body.modelo === 'object' ? body.modelo : null;
  // Responder citando: o front manda o id da mensagem NO QS; aqui viramos o id
  // dela no Chatwoot, que é o que a API dele entende em content_attributes.
  const respondendoA = String(body.respondendoA || '').trim();

  if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });
  if (!modelo && !text) return res.status(400).json({ error: 'Mensagem vazia' });
  if (text.length > MAX_LEN) return res.status(400).json({ error: `Mensagem muito longa (máx. ${MAX_LEN})` });

  // Por qual número o SDR escolheu falar (WhatsApp normal x API oficial).
  // Template dispensa a escolha: ele PERTENCE a uma caixa (a do número oficial,
  // descoberta no Chatwoot) — e essa caixa vem do servidor, não do navegador,
  // então não passa pelo filtro da env.
  let inboxPedida = null;
  if (!modelo) {
    inboxPedida = inboxPermitida(body.inboxId);
    if (inboxPedida == null && body.inboxId != null && body.inboxId !== '') {
      return res.status(400).json({ error: 'Esse número não está liberado para envio.' });
    }
  }

  let auth;
  try {
    auth = await assertCanAccessLead(userId, leadId);
  } catch (e) {
    console.error('[wa-send] checagem de acesso:', e?.message);
    return res.status(500).json({ error: 'Falha ao validar o lead' });
  }
  if (!auth.ok) {
    const status = auth.reason === 'lead-de-outro-sdr' ? 403 : 404;
    return res.status(status).json({ error: 'Sem acesso a este lead', motivo: auth.reason });
  }

  if (!cwConfigured()) {
    return res.status(503).json({ error: 'Atendimento não configurado (falta CHATWOOT_AGENT_TOKEN)' });
  }

  try {
    // Template: resolve ANTES de tudo — o corpo final e a caixa saem daqui.
    let templateParams = null;
    let textoModelo = null;
    if (modelo) {
      const r = await resolverModelo(modelo);
      if (r.error) {
        const msg = {
          'modelo-nao-encontrado': 'Esse modelo não está aprovado na Meta (ou foi removido).',
          'modelo-variavel-vazia': `Preencha a variável {{${r.variavel}}} do modelo.`,
          'modelo-sem-corpo': 'Esse modelo não tem corpo de texto.',
          'modelo-sem-nome': 'Modelo inválido.',
        }[r.error] || 'Não consegui usar esse modelo.';
        return res.status(400).json({ error: msg, motivo: r.error });
      }
      templateParams = r.templateParams;
      textoModelo = r.texto;
      inboxPedida = r.inboxId;
    }

    // Caminho rápido: conversa que o QS já conhece. Só cai no Chatwoot se não souber.
    let conversationId = null;
    let contactId = null;
    let inboxId = null;
    try {
      const rows = await rest(
        `qs_wa_threads?select=cw_conversation_id,cw_contact_id,cw_inbox_id&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
      );
      conversationId = rows?.[0]?.cw_conversation_id ?? null;
      contactId = rows?.[0]?.cw_contact_id ?? null;
      inboxId = rows?.[0]?.cw_inbox_id ?? null;
    } catch { /* segue pro caminho completo */ }

    // Pediu um número específico? Então o atalho acima só vale se a conversa que
    // já conhecemos for DAQUELE número — no Chatwoot cada conversa pertence a uma
    // caixa só, e mandar pela conversa errada sairia pelo número errado.
    if (inboxPedida != null && Number(inboxId) !== Number(inboxPedida)) {
      conversationId = null;
      contactId = null;
      inboxId = null;
    }

    if (!conversationId) {
      const r = await ensureConversation(auth.lead, inboxPedida);
      if (r.error) {
        return res.status(409).json({ error: motivoHumano(r.error), motivo: r.error });
      }
      conversationId = r.conversation.id;
      contactId = r.contact.id;
      inboxId = r.conversation.inbox_id ?? inboxPedida ?? defaultInboxId();
    }

    // O nome de quem está falando vai na primeira linha. Sai daqui, e não do
    // navegador: quem assina é a sessão autenticada, não o que o cliente mandar.
    // Template NÃO leva assinatura: o texto tem que sair idêntico ao aprovado.
    const textoFinal = templateParams ? textoModelo : await assinarComoUsuario(text, auth.user);

    // A citação é OPCIONAL de verdade: se a mensagem citada não for deste lead,
    // ou o QS não souber o id dela no Chatwoot, mandamos sem citar. Perder a
    // citação é aceitável; perder a mensagem, não.
    let citando = null;
    let citadoTexto = null;
    if (respondendoA) {
      try {
        const alvo = await rest(
          `qs_wa_messages?select=cw_message_id,content&id=eq.${encodeURIComponent(respondendoA)}` +
          `&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
        );
        citando = alvo?.[0]?.cw_message_id ?? null;
        // Guardamos o trecho AGORA, daqui: o webhook devolve a nossa mensagem
        // sem o texto da citada, e sem isso a citação apareceria como uma faixa
        // vazia na própria tela de quem acabou de responder.
        citadoTexto = alvo?.[0]?.content ? String(alvo[0].content).slice(0, 160) : null;
      } catch (e) {
        console.warn('[wa-send] citação ignorada:', e?.message);
      }
    }

    const sent = await cw(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: {
        content: textoFinal,
        message_type: 'outgoing',
        private: false,
        // É o template_params que faz o Chatwoot mandar como TEMPLATE pra Meta
        // (única coisa que ela aceita fora da janela de 24h).
        ...(templateParams ? { template_params: templateParams } : {}),
        ...(citando ? { content_attributes: { in_reply_to: citando } } : {}),
      },
    });

    // ⚠️ DAQUI PRA BAIXO A MENSAGEM JÁ SAIU PRO CLIENTE.
    // Nada aqui pode virar "não consegui enviar": o SDR reenviaria e o cliente
    // receberia duas, três vezes. Falha de gravação é problema NOSSO, vai pro
    // log, e o webhook do Chatwoot traz a mensagem de volta em seguida.
    let tarefa = null;
    try {
      await ingestMessage({
        leadId,
        conversationId,
        contactId,
        inboxId,
        message: {
          id: sent?.id ?? null,
          // Grava o que o cliente REALMENTE recebeu (com a assinatura) — a bolha
          // no QS tem que ser igual à do celular dele.
          content: textoFinal,
          message_type: 1,
          created_at: sent?.created_at ?? null,
          sender: { name: auth.user?.name || null },
          // Id no WhatsApp (quando o Chatwoot já devolve) — liga a mensagem às
          // reações da 0041; o message_updated do webhook completa os demais.
          source_id: sent?.source_id ?? null,
          // Nasce como "enviada" (✓). O webhook do Chatwoot promove pra
          // entregue/lida depois; sem este valor inicial a bolha ficaria sem
          // recibo nenhum até o cliente abrir a conversa.
          status: sent?.status || 'sent',
          ...(citando ? {
            content_attributes: { in_reply_to: citando, in_reply_to_content: citadoTexto },
          } : {}),
        },
      });
      tarefa = await completeWhatsAppTask(leadId, auth.lead?.owner_id ?? null);
    } catch (e) {
      console.error('[wa-send] enviado, mas falhou ao gravar no QS:', e?.message);
    }

    return res.status(200).json({ ok: true, conversationId, messageId: sent?.id ?? null, tarefaConcluida: tarefa });
  } catch (e) {
    console.error('[wa-send]', e?.message);
    // 401/403 do Chatwoot = token errado; o resto tratamos como falha de envio.
    if (e?.status === 401 || e?.status === 403) {
      return res.status(503).json({ error: 'O atendimento recusou o token (CHATWOOT_AGENT_TOKEN).' });
    }
    return res.status(502).json({ error: 'Não consegui enviar a mensagem. Tente de novo.' });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
