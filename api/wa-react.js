// api/wa-react.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/wa-react — AÇÕES SOBRE UMA MENSAGEM
//   { leadId, messageId, emoji }            reagir ("" remove a reação)
//   { leadId, messageId, acao: 'apagar' }   apagar para todos
//
// Duas ações na mesma rota de propósito: elas compartilham a parte cara e
// delicada (achar a mensagem, provar que ela é deste lead, resolver a instância
// da Evolution e montar a `key` do WhatsApp), e o projeto já roda no limite
// prático de funções da Vercel. O nome do arquivo ficou de quando só havia
// reação — trocar quebraria a URL que o front já usa em produção.
//
// REAGIR, em dois efeitos:
//   1. Grava a reação na mensagem do QS (qs_wa_react — atômica, uma por autor).
//   2. Se a Evolution estiver configurada, manda a reação DE VERDADE pro
//      WhatsApp do cliente. Sem Evolution, a reação fica visível só no QS e a
//      resposta avisa (`entregue: false`) — nada de fingir que chegou.
//
// APAGAR: some do WhatsApp do cliente e CONTINUA aqui. O QS é o arquivo da
// conversa — dele sai a auditoria do que foi combinado, e ela não pode ter
// buraco (migration 0046). No banco isso é só um carimbo em `deleted_at`.
// A ordem é WhatsApp primeiro porque é ele quem pode RECUSAR (só dá pra apagar
// mensagem nossa, e dentro do prazo dele): carimbar antes deixaria a mensagem
// marcada como apagada aqui e viva no celular do cliente.
//
// Mesma trava das outras rotas: o servidor confirma que o lead é deste usuário
// antes de escrever qualquer coisa.
// -----------------------------------------------------------------------------

import {
  assertCanAccessLead, getSupabaseUserId, signatureName, nomeCurto, cw, cwConfigured,
} from './_wa.js';
import { rest } from './_supabaseAdmin.js';
import {
  evoConfigured, instanciaDaCaixa, resolveJid, sendReaction, deleteForEveryone,
} from './_evolution.js';

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

/**
 * A `key` que identifica a mensagem PARA O WHATSAPP (remoteJid + id + fromMe).
 * Reagir e apagar precisam exatamente da mesma coisa.
 *
 * Devolve { key } ou { motivo }, nunca lança: cada motivo vira uma frase
 * diferente pro atendente, e "não deu" sem dizer por quê é o que fazia essas
 * falhas serem impossíveis de investigar.
 */
/**
 * Busca o WAID que faltou, direto no Chatwoot, na hora em que ele faz falta.
 *
 * MEDIDO em 13/08: ~40% das mensagens ENVIADAS ficam sem source_id (476 de
 * 1.194 em 7 dias) — a resposta do POST do Chatwoot ainda não traz o WAID e o
 * eco do webhook nem sempre volta com ele. Sem o id, reagir e apagar recusavam
 * com "mensagem antiga demais" MENTINDO: a mensagem era de minutos atrás.
 * O Chatwoot, esse, já sabe o id — só ninguém tinha ido perguntar.
 *
 * Pagina pra trás (?before=) no máximo 5 páginas; se a página já passou do
 * cw_message_id procurado e ele não apareceu, o Chatwoot não o tem — desiste.
 * Ao achar, grava no banco: a próxima ação nem precisa vir aqui.
 */
async function backfillSourceId(msg) {
  if (!cwConfigured() || msg.cw_conversation_id == null || msg.cw_message_id == null) return null;
  let before = null;
  for (let i = 0; i < 5; i++) {
    const data = await cw(`/conversations/${msg.cw_conversation_id}/messages${before ? `?before=${before}` : ''}`);
    const lista = Array.isArray(data?.payload) ? data.payload : [];
    if (!lista.length) return null;

    const alvo = lista.find((m) => Number(m.id) === Number(msg.cw_message_id));
    if (alvo) {
      const sid = alvo.source_id ? String(alvo.source_id) : null;
      if (sid) {
        await rest(`qs_wa_messages?id=eq.${encodeURIComponent(msg.id)}&source_id=is.null`, {
          method: 'PATCH', body: { source_id: sid }, prefer: 'return=minimal',
        });
      }
      return sid;
    }

    const ids = lista.map((m) => Number(m.id)).filter(Number.isFinite);
    const menor = Math.min(...ids);
    if (!Number.isFinite(menor) || menor <= Number(msg.cw_message_id)) return null; // já passou dele
    before = menor;
  }
  return null;
}

async function montarKeyDoWhatsApp(leadId, lead, msg) {
  if (!evoConfigured()) return { motivo: 'evolution-nao-configurada' };
  if (!msg.source_id) {
    // Antes de desistir, pergunta ao Chatwoot — ver backfillSourceId acima.
    const sid = await backfillSourceId(msg).catch((e) => {
      console.warn('[wa-react] backfill de source_id falhou:', e?.message);
      return null;
    });
    if (sid) msg.source_id = sid;
  }
  // Mensagem gravada antes da 0041 (ou que o Chatwoot não identificou): não há
  // como apontar pra ela lá fora.
  if (!msg.source_id) return { motivo: 'mensagem-sem-id-do-whatsapp' };

  const threads = await rest(
    `qs_wa_threads?select=cw_inbox_id&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
  );
  const instance = await instanciaDaCaixa(threads?.[0]?.cw_inbox_id ?? null);
  if (!instance) return { motivo: 'instancia-nao-mapeada' };

  const jid = await resolveJid(instance, lead.phone);
  if (!jid) return { motivo: 'lead-sem-telefone' };

  return {
    instance,
    key: {
      remoteJid: jid,
      fromMe: msg.direction === 'out',
      // O Chatwoot às vezes guarda o id com o prefixo "WAID:" — o WhatsApp só
      // conhece o id puro.
      id: String(msg.source_id).replace(/^WAID:/i, ''),
    },
  };
}

/** Frase que o atendente entende para cada motivo de não ter ido ao WhatsApp. */
function motivoHumanoAcao(motivo) {
  return {
    'evolution-nao-configurada': 'O WhatsApp não está conectado ao QS (falta configurar a Evolution).',
    'mensagem-sem-id-do-whatsapp': 'Esta mensagem é antiga demais — o QS não sabe qual é ela no WhatsApp.',
    'instancia-nao-mapeada': 'Não sei por qual número esta conversa corre.',
    'lead-sem-telefone': 'Este lead não tem telefone válido.',
    'evolution-falhou': 'O WhatsApp recusou. Mensagem muito antiga costuma ser o motivo.',
  }[motivo] || 'Não consegui falar com o WhatsApp.';
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
  const apagar = String(body.acao || '').toLowerCase() === 'apagar';

  if (!leadId || !messageId) return res.status(400).json({ error: 'leadId e messageId obrigatórios' });
  // 16 unidades cobre qualquer emoji composto (👨‍👩‍👧); corta abuso de texto.
  if (!apagar && emoji.length > 16) return res.status(400).json({ error: 'Reação inválida' });

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
      `qs_wa_messages?select=id,direction,source_id,cw_message_id,cw_conversation_id&id=eq.${encodeURIComponent(messageId)}` +
      `&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
    );
    const msg = Array.isArray(rows) && rows[0];
    if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' });


    // ── APAGAR PARA TODOS ─────────────────────────────────────────────────
    if (apagar) {
      // O WhatsApp só apaga o que é NOSSO. Barrar aqui evita prometer ao
      // atendente algo que o WhatsApp ia recusar de qualquer jeito.
      if (msg.direction !== 'out') {
        return res.status(400).json({
          error: 'Só dá para apagar mensagem enviada por você. A do cliente some apenas se ele apagar.',
        });
      }

      const { key, instance, motivo } = await montarKeyDoWhatsApp(leadId, auth.lead, msg);
      if (!key) {
        return res.status(409).json({ error: motivoHumanoAcao(motivo), motivo });
      }

      // Primeiro lá fora: se o WhatsApp recusar, a mensagem CONTINUA na tela do
      // QS igual está no celular do cliente — que é a verdade.
      try {
        await deleteForEveryone(instance, key);
      } catch (e) {
        console.error('[wa-react] apagar no WhatsApp:', e?.message);
        return res.status(409).json({ error: motivoHumanoAcao('evolution-falhou'), motivo: 'evolution-falhou' });
      }

      try {
        const ok = await rest('rpc/qs_wa_apagar', {
          method: 'POST',
          body: { p_msg: messageId, p_user: userId },
        });
        return res.status(200).json({ ok: true, apagada: ok !== false });
      } catch (e) {
        if (/qs_wa_apagar|schema cache|function/i.test(String(e?.message))) {
          // Já sumiu do celular do cliente; só o nosso lado ficou pra trás.
          return res.status(503).json({
            error: 'Apagada no WhatsApp, mas o QS ainda não sabe registrar isso (falta a migration 0045).',
          });
        }
        throw e;
      }
    }

    // ── REAGIR ────────────────────────────────────────────────────────────
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
    try {
      const alvo = await montarKeyDoWhatsApp(leadId, auth.lead, msg);
      if (!alvo.key) {
        motivo = alvo.motivo;
      } else {
        await sendReaction(alvo.instance, alvo.key, emoji);
        entregue = true;
      }
    } catch (e) {
      console.error('[wa-react] Evolution:', e?.message);
      motivo = 'evolution-falhou';
    }

    return res.status(200).json({ ok: true, reactions, entregue, motivo });
  } catch (e) {
    console.error('[wa-react]', e?.message);
    return res.status(502).json({ error: 'Não consegui registrar a reação. Tente de novo.' });
  }
}
