// api/gloria-responder.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/gloria-responder
//   header x-gloria-secret: <GLORIA_SECRET>
//   { lead_id, mensagens: [{ texto, delay_ms }], resumo? }
//
// A Glória (IA, no n8n) escreve; QUEM MANDA É O QS. De propósito: assim a
// mensagem sai pelo mesmo número oficial do time, cai na mesma conversa do
// Chatwoot, é gravada na thread do lead com o nome dela e aparece na tela do SDR
// junto com o resto — em vez de existir só dentro de uma execução do n8n.
//
// TRÊS COISAS QUE ESTA ROTA RECUSA (e é bom que recuse):
//
// 1. IA desligada nesta conversa. Entre o n8n decidir a resposta e ela chegar
//    aqui passam alguns segundos — tempo suficiente pro SDR ter assumido a
//    conversa. A checagem é feita AQUI, no último instante antes de enviar.
// 2. Fora da janela de 24h. Só template aprovado passa, e template a IA não
//    dispara: vira transferência pro time.
// 3. Mensagem repetida. Se o texto já saiu pra este lead nos últimos 10
//    minutos, não sai de novo — é o remendo final contra execução duplicada.
//
// Envs: GLORIA_SECRET + CHATWOOT_* (ver _wa.js) + SUPABASE_*
// -----------------------------------------------------------------------------

import {
  cwConfigured, cw, ingestMessage, ensureConversation, defaultInboxId,
  motivoHumano, conversaOndeOClienteFala,
} from './_wa.js';
import { rest } from './_supabaseAdmin.js';
import { portaria, corpo, buscarLead, sessao, registrar, pausar, ASSINATURA_IA } from './_gloria.js';

const MAX_BALOES = 3;
const MAX_LEN = 900;
// Teto do tempo total de digitação. A função tem 30s (vercel.json) e cada balão
// ainda gasta uma ida ao Chatwoot: passar disso é a função morrer no meio, com
// metade da resposta entregue.
const TETO_PAUSA_MS = 9_000;

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Esta frase já saiu pra este lead há pouco? (anti-duplicata) */
async function jaMandou(leadId, texto) {
  try {
    const desde = new Date(Date.now() - 10 * 60_000).toISOString();
    const rows = await rest(
      `qs_gloria_log?select=id&lead_id=eq.${encodeURIComponent(leadId)}&direcao=eq.out` +
      `&criado_em=gt.${encodeURIComponent(desde)}` +
      `&conteudo=eq.${encodeURIComponent(texto)}&limit=1`
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    // Na dúvida, deixa passar: perder uma resposta é pior que repetir uma.
    console.warn('[gloria-responder] checagem de duplicata falhou:', e?.message);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const barrado = portaria(req);
  if (barrado) return res.status(barrado.status).json({ error: barrado.error });

  const body = corpo(req);
  const leadId = String(body.lead_id || body.leadId || '').trim();
  if (!leadId) return res.status(400).json({ error: 'lead_id obrigatório' });

  const mensagens = (Array.isArray(body.mensagens) ? body.mensagens : [])
    .map((m) => (typeof m === 'string' ? { texto: m } : m || {}))
    .map((m) => ({ texto: String(m.texto || '').trim(), delay_ms: Number(m.delay_ms) || 0 }))
    .filter((m) => m.texto)
    .slice(0, MAX_BALOES);

  if (!mensagens.length) return res.status(400).json({ error: 'Nada pra enviar' });
  if (mensagens.some((m) => m.texto.length > MAX_LEN)) {
    return res.status(400).json({ error: `Balão muito longo (máx. ${MAX_LEN})` });
  }

  if (!cwConfigured()) {
    return res.status(503).json({ error: 'Atendimento não configurado (falta CHATWOOT_AGENT_TOKEN)' });
  }

  try {
    const lead = await buscarLead(leadId);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });

    // (1) A IA ainda está no comando desta conversa?
    let ses;
    try {
      ses = await sessao(leadId);
    } catch (e) {
      if (e?.code === 'SEM_0053') return res.status(503).json({ error: e.message, motivo: 'sem_0053' });
      throw e;
    }
    // A DESPEDIDA AINDA PASSA. Na mesma rodada em que se despede, a IA chama a
    // ferramenta de transferir — que desliga a sessão ANTES de a resposta
    // chegar aqui. Sem esta janela de 2 minutos, o lead pede para falar com uma
    // pessoa e recebe silêncio: a transferência acontece nos bastidores e ele
    // nunca fica sabendo. Só vale para transferência recente, e uma vez.
    const despedida =
      ses?.ativa === false &&
      ses?.etapa === 'transferida' &&
      ses?.transferida_em &&
      Date.now() - new Date(ses.transferida_em).getTime() < 120_000;

    if (!ses || (ses.ativa === false && !despedida)) {
      await registrar(leadId, 'evento', 'resposta descartada: IA já estava desligada', ses?.motivo || 'sessao_inativa');
      return res.status(409).json({ ok: false, motivo: ses?.motivo || 'ia_desligada', enviadas: 0 });
    }

    // ── MODO TESTE ────────────────────────────────────────────────────────
    // `teste: true` faz tudo o que é LEITURA e para antes de qualquer efeito:
    // nenhum WhatsApp sai, nada é gravado, nada é pausado. Devolve os balões
    // que teriam ido e o estado que decidiria o envio.
    //
    // POR QUE NO SERVIDOR e não num IF do n8n: a ferramenta de transferência
    // quem dispara é o MODELO, no meio do raciocínio dele. Um desvio no
    // workflow não segura isso — a trava tem que estar de quem executa.
    //
    // O que é conferido ANTES daqui continua valendo no teste (lead existe,
    // sessão ativa, balões dentro do limite), que é o que torna o teste útil.
    if (body.teste === true || body.teste === 'true') {
      let janela = null;
      let conversa = null;
      try {
        const t = await rest(
          `qs_wa_threads?select=can_reply,cw_conversation_id&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
        );
        janela = t?.[0]?.can_reply ?? null;
        conversa = t?.[0]?.cw_conversation_id ?? null;
      } catch { /* sem thread ainda: o teste segue */ }

      return res.status(200).json({
        ok: true,
        teste: true,
        enviadas: 0,
        aviso: 'MODO TESTE — nada foi enviado ao cliente e nada foi gravado.',
        lead: { id: lead.id, nome: lead.first_name || lead.full_name, telefone: lead.phone },
        janela_de_24h_aberta: janela !== false,
        conversa_que_seria_usada: conversa,
        baloes: mensagens.map((m, i) => ({ ordem: i + 1, texto: m.texto, delay_ms: m.delay_ms })),
      });
    }

    // Resolve a conversa. A blindagem é a mesma do wa-send: responde onde o
    // cliente falou por último, que sai das mensagens e não do ponteiro da
    // thread (que já foi flagrado errado em 17/08).
    let conversationId = null;
    let contactId = null;
    let inboxId = null;
    try {
      const rows = await rest(
        `qs_wa_threads?select=cw_conversation_id,cw_contact_id,cw_inbox_id,can_reply` +
        `&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
      );
      conversationId = rows?.[0]?.cw_conversation_id ?? null;
      contactId = rows?.[0]?.cw_contact_id ?? null;
      inboxId = rows?.[0]?.cw_inbox_id ?? null;

      // (2) Janela de 24h fechada: a IA não dispara template. Devolve pro time.
      if (rows?.[0]?.can_reply === false) {
        await pausar(leadId, 'fora_da_janela_24h', 'Janela de 24h fechada — só template aprovado passa.', false);
        return res.status(409).json({ ok: false, motivo: 'fora_da_janela_24h', enviadas: 0 });
      }
    } catch (e) {
      console.warn('[gloria-responder] thread:', e?.message);
    }

    const doCliente = await conversaOndeOClienteFala(leadId);
    if (doCliente != null && Number(doCliente) !== Number(conversationId)) {
      try {
        const d = await cw(`/conversations/${doCliente}`);
        const convCerta = d?.id != null ? d : (d?.payload?.id != null ? d.payload : null);
        if (convCerta) {
          conversationId = convCerta.id;
          inboxId = convCerta.inbox_id ?? inboxId;
        }
      } catch (e) {
        console.warn('[gloria-responder] conversa do cliente:', e?.message);
      }
    }

    if (!conversationId) {
      const r = await ensureConversation(lead, null);
      if (r.error) {
        await registrar(leadId, 'erro', 'não consegui abrir conversa', r.error);
        return res.status(409).json({ error: motivoHumano(r.error), motivo: r.error });
      }
      conversationId = r.conversation.id;
      contactId = r.contact.id;
      inboxId = r.conversation.inbox_id ?? defaultInboxId();
    }

    const enviadas = [];
    let gastoMs = 0;

    for (const [i, m] of mensagens.entries()) {
      // (3) Já mandamos isto agora há pouco?
      if (await jaMandou(leadId, m.texto)) {
        await registrar(leadId, 'evento', m.texto, 'duplicata_descartada');
        continue;
      }

      // Tempo de digitação entre um balão e outro. Nenhuma pausa antes do
      // primeiro: o lead já esperou o n8n pensar.
      if (i > 0) {
        const espera = Math.min(Math.max(m.delay_ms, 800), Math.max(TETO_PAUSA_MS - gastoMs, 0));
        if (espera > 0) { await pausa(espera); gastoMs += espera; }
      }

      // A assinatura vai só no PRIMEIRO balão, e no formato do time (*Nome* na
      // primeira linha). Nos balões seguintes ela poluiria a conversa.
      const texto = i === 0 ? `*Glória*\n${m.texto}` : m.texto;

      let sent;
      try {
        sent = await cw(`/conversations/${conversationId}/messages`, {
          method: 'POST',
          body: { content: texto, message_type: 'outgoing', private: false },
        });
      } catch (e) {
        // Balão que não saiu para a fila aqui: insistir nos próximos entregaria
        // a resposta pela metade e fora de ordem.
        console.error('[gloria-responder] falha ao enviar:', e?.message);
        await registrar(leadId, 'erro', m.texto, `envio_falhou: ${e?.message || 'erro'}`);
        break;
      }

      // ⚠️ DAQUI PRA BAIXO A MENSAGEM JÁ SAIU PRO CLIENTE. Nada abaixo pode
      // virar "não enviei" — o n8n reenviaria e o cliente receberia duas vezes.

      // O log ANTES da ingestão, de propósito: é ele que o gatilho da 0053 usa
      // pra reconhecer o eco desta mensagem e não confundir com "humano
      // assumiu". Se o webhook do Chatwoot chegar antes da nossa ingestão, o
      // log já está lá.
      await registrar(leadId, 'out', m.texto, 'resposta_da_ia', { ordem: i + 1, cw_message_id: sent?.id ?? null });

      try {
        await ingestMessage({
          leadId,
          conversationId,
          contactId,
          inboxId,
          message: {
            id: sent?.id ?? null,
            content: texto,
            message_type: 1,
            created_at: sent?.created_at ?? null,
            // O nome que o gatilho da 0053 procura. Sem ele, a própria resposta
            // da IA desligaria a IA.
            sender: { name: ASSINATURA_IA },
            source_id: sent?.source_id ?? null,
            status: sent?.status || 'sent',
          },
        });
      } catch (e) {
        console.error('[gloria-responder] enviado, mas falhou ao gravar:', e?.message);
      }

      enviadas.push({ ordem: i + 1, cw_message_id: sent?.id ?? null });
    }

    // ATÉ ONDE DA CONVERSA ESTA RESPOSTA LEU.
    //
    // Vem do n8n, e é o horário da última mensagem do lead que entrou no
    // prompt — não é "agora". A diferença é a mensagem que o lead manda
    // enquanto a IA pensa: ela chegou tarde pra esta resposta, e se
    // marcássemos "agora" ela seria dada como respondida e ninguém nunca mais
    // olharia pra ela. Assim ela continua pendente e entra na próxima rodada.
    //
    // Só grava se ALGO saiu: resposta que não chegou no cliente não pode
    // marcar a conversa como atendida.
    if (enviadas.length && body.respondida_ate) {
      await rest(`qs_gloria_sessoes?lead_id=eq.${encodeURIComponent(leadId)}`, {
        method: 'PATCH',
        body: { respondida_ate: body.respondida_ate },
        prefer: 'return=minimal',
      }).catch((e) => console.warn('[gloria-responder] respondida_ate:', e?.message));
    }

    // NÃO conclui a tarefa de WhatsApp do SDR de propósito: a atividade do dia é
    // do humano. Se a IA baixasse a tarefa, o toque apareceria como feito e o
    // SDR nunca olharia uma conversa que a IA pode ter deixado pela metade.

    if (body.resumo) {
      await rest('rpc/qs_gloria_salvar', {
        method: 'POST',
        body: { p_lead: leadId, p_resumo: String(body.resumo).slice(0, 2000) },
      }).catch((e) => console.warn('[gloria-responder] resumo:', e?.message));
    }

    return res.status(200).json({ ok: true, enviadas: enviadas.length, conversationId, mensagens: enviadas });
  } catch (e) {
    console.error('[gloria-responder]', e?.message, e?.details || '');
    await registrar(leadId, 'erro', null, e?.message || 'falha');
    if (e?.status === 401 || e?.status === 403) {
      return res.status(503).json({ error: 'O atendimento recusou o token (CHATWOOT_AGENT_TOKEN).' });
    }
    return res.status(502).json({ error: 'Não consegui enviar a mensagem.' });
  }
}
