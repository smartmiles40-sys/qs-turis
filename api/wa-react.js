// api/wa-react.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/wa-react
//   { leadId, messageId, emoji }      emoji "" = remover a reação
//
// O SDR reage a UMA mensagem da conversa (👍❤️😂…), como no WhatsApp — em vez
// de mandar um emoji solto que parece mensagem.
//
// Dois efeitos, nesta ordem:
//   1. Grava a reação na mensagem do QS (qs_wa_react — atômica, uma por autor).
//   2. Se a Evolution estiver configurada, manda a reação DE VERDADE pro
//      WhatsApp do cliente. Sem Evolution, a reação fica visível só no QS e a
//      resposta avisa (`entregue: false`) — nada de fingir que chegou.
//
// Mesma trava das outras rotas: o servidor confirma que o lead é deste usuário
// antes de escrever qualquer coisa.
// -----------------------------------------------------------------------------

import {
  assertCanAccessLead, getSupabaseUserId, signatureName, nomeCurto,
} from './_wa.js';
import { rest } from './_supabaseAdmin.js';
import { evoConfigured, evoInstanceForInbox, resolveJid, sendReaction } from './_evolution.js';

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
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
  const messageId = String(body.messageId || '').trim();
  const emoji = String(body.emoji ?? '').trim();

  if (!leadId || !messageId) return res.status(400).json({ error: 'leadId e messageId obrigatórios' });
  // 16 unidades cobre qualquer emoji composto (👨‍👩‍👧); corta abuso de texto.
  if (emoji.length > 16) return res.status(400).json({ error: 'Reação inválida' });

  let auth;
  try {
    auth = await assertCanAccessLead(userId, leadId);
  } catch (e) {
    console.error('[wa-react] checagem de acesso:', e?.message);
    return res.status(500).json({ error: 'Falha ao validar o lead' });
  }
  if (!auth.ok) {
    const status = auth.reason === 'lead-de-outro-sdr' ? 403 : 404;
    return res.status(status).json({ error: 'Sem acesso a este lead', motivo: auth.reason });
  }

  try {
    // A mensagem tem que ser DESTE lead — sem isso, um messageId chutado
    // reagiria na conversa de outro cliente.
    const rows = await rest(
      `qs_wa_messages?select=id,direction,source_id&id=eq.${encodeURIComponent(messageId)}` +
      `&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
    );
    const msg = Array.isArray(rows) && rows[0];
    if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' });

    // O nome que aparece na "pill" — o mesmo com que o SDR assina.
    const nome = (await signatureName(auth.user)) || nomeCurto(auth.user?.name) || 'SDR';

    let reactions;
    try {
      reactions = await rest('rpc/qs_wa_react', {
        method: 'POST',
        body: { p_msg: messageId, p_autor: userId, p_nome: nome, p_emoji: emoji },
      });
    } catch (e) {
      // Função ainda não existe = migration 0041 não foi aplicada.
      if (/qs_wa_react/i.test(String(e?.message))) {
        return res.status(503).json({ error: 'Reações ainda não ativadas no banco (falta a migration 0041).' });
      }
      throw e;
    }
    if (reactions == null) return res.status(404).json({ error: 'Mensagem não encontrada' });

    // ── A reação de verdade, no celular do cliente ─────────────────────────
    let entregue = false;
    let motivo = null;

    if (!evoConfigured()) {
      motivo = 'evolution-nao-configurada';
    } else if (!msg.source_id) {
      // Mensagem gravada antes da 0041 (ou o Chatwoot não repassou o id do
      // WhatsApp) — não há como apontar a reação pra ela lá fora.
      motivo = 'mensagem-sem-id-do-whatsapp';
    } else {
      try {
        const threads = await rest(
          `qs_wa_threads?select=cw_inbox_id&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
        );
        const inbox = threads?.[0]?.cw_inbox_id ?? null;
        const instance = evoInstanceForInbox(inbox);
        if (!instance) {
          motivo = 'instancia-nao-mapeada';
        } else {
          const jid = await resolveJid(instance, auth.lead.phone);
          if (!jid) {
            motivo = 'lead-sem-telefone';
          } else {
            // O Chatwoot às vezes guarda o id com o prefixo "WAID:" — o
            // WhatsApp só conhece o id puro.
            await sendReaction(instance, {
              remoteJid: jid,
              fromMe: msg.direction === 'out',
              id: String(msg.source_id).replace(/^WAID:/i, ''),
            }, emoji);
            entregue = true;
          }
        }
      } catch (e) {
        console.error('[wa-react] Evolution:', e?.message);
        motivo = 'evolution-falhou';
      }
    }

    return res.status(200).json({ ok: true, reactions, entregue, motivo });
  } catch (e) {
    console.error('[wa-react]', e?.message);
    return res.status(502).json({ error: 'Não consegui registrar a reação. Tente de novo.' });
  }
}
