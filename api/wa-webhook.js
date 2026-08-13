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

import { findLeadByPhone, ingestMessage, inboxAceita } from './_wa.js';
import { insert, rest, segredoConfere } from './_supabaseAdmin.js';

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
    if (!lead) {
      // Não é erro: é gente falando com a agência que ainda não virou lead.
      // Registrado porque essa lista É oportunidade comercial — e porque, sem
      // ela, "sumiu mensagem" não tem onde ser investigado.
      await registrarDescarte('sem-lead-correspondente', {
        phone, inboxId, messageId: message?.id, nome: extractNome(body, message),
      });
      return res.status(200).json({ ignored: 'sem-lead-correspondente' });
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

    return res.status(200).json({ ok: true, leadId: lead.id, novo: saved });
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
