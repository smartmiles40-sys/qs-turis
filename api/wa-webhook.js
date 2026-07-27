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
//       (CHATWOOT_WA_INBOX_IDS opcional — restringe às caixas de WhatsApp)
//
// Responde 200 quase sempre, de propósito: webhook que recebe erro fica em
// retentativa eterna e entope a fila do Chatwoot. O que não deu pra tratar vira
// log na Vercel com o motivo.
// -----------------------------------------------------------------------------

import { findLeadByPhone, ingestMessage, WA_INBOX_IDS } from './_wa.js';

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
  if (sent !== secret) {
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

  // Caixa de e-mail/site não interessa aqui — só WhatsApp.
  const inboxId = inboxIdOf(body, message);
  if (WA_INBOX_IDS.length && inboxId != null && !WA_INBOX_IDS.includes(Number(inboxId))) {
    return res.status(200).json({ ignored: 'inbox-fora-do-whatsapp', inboxId });
  }

  const phone = extractPhone(body, message);
  if (!phone) return res.status(200).json({ ignored: 'sem-telefone' });

  try {
    const lead = await findLeadByPhone(phone);
    if (!lead) {
      // Normal: cliente que ainda não é lead no QS. Fica só no Chatwoot.
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
    return res.status(200).json({ ok: false, erro: e?.message || 'falha' });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
