// api/wa-react.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/wa-react — AÇÕES SOBRE UMA MENSAGEM
//   { leadId, messageId, emoji }            reagir ("" remove a reação)
//   { leadId, messageId, acao: 'apagar' }   esconder no QS
//   { leadId, acao: 'lida' }                visto azul na última do cliente
//
// Desde 23/09/2026 (Evolution fora do QS) tudo sai pela Cloud API da Meta:
//
// REAGIR, em dois efeitos:
//   1. Grava a reação na mensagem do QS (qs_wa_react — atômica, uma por autor).
//   2. Manda a reação de verdade pro WhatsApp do cliente, pela Meta. Se a Meta
//      recusar (mensagem sem id, janela fechada), a reação fica só no QS e a
//      resposta avisa (`entregue: false`) — nada de fingir que chegou.
//
// APAGAR: a Meta NÃO tem "apagar para todos". Por decisão do Bruno (23/09), o
// botão esconde a mensagem só no QS (carimbo em `deleted_at`, 0045) — o cliente
// continua vendo no celular, e a tela diz isso com todas as letras.
//
// Mesma trava das outras rotas: o servidor confirma que o lead é deste usuário
// antes de escrever qualquer coisa.
// -----------------------------------------------------------------------------

import { assertCanAccessLead, getSupabaseUserId, signatureName, nomeCurto } from './_wa.js';
import { rest } from './_supabaseAdmin.js';
import { enviarReacao, marcarComoLida } from './_meta.js';
import { numeroDoEnvio } from './_waSaida.js';

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
  const apagar = String(body.acao || '').toLowerCase() === 'apagar';
  const lida = String(body.acao || '').toLowerCase() === 'lida';

  if (!leadId || (!messageId && !lida)) return res.status(400).json({ error: 'leadId e messageId obrigatórios' });
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

  // ── VISTO AZUL (29/09/2026) ─────────────────────────────────────────────
  // O SDR abriu a conversa no QS: o cliente vê que foi lida, como se tivesse
  // sido aberta no celular. Sai pelo número que RECEBEU a mensagem (a marca
  // cw_inbox_id dela), e só vale pra número de SDR/oficial ainda conectado.
  // Nunca atrapalha a tela: qualquer falha volta 200 com `marcada: false`.
  if (lida) {
    // Só o DONO do lead dá o visto: gestor olhando a conversa pra acompanhar
    // não pode fazer o cliente achar que o SDR leu.
    if (auth.lead?.owner_id && auth.lead.owner_id !== userId) {
      return res.status(200).json({ ok: true, marcada: false, motivo: 'nao-e-o-dono' });
    }
    try {
      const ult = (await rest(
        `qs_wa_messages?select=source_id,cw_inbox_id,status&lead_id=eq.${encodeURIComponent(leadId)}` +
        `&direction=eq.in&source_id=not.is.null&order=sent_at.desc&limit=1`
      ))?.[0];
      const wamid = ult?.source_id ? String(ult.source_id).replace(/^WAID:/i, '') : null;
      if (!wamid || ult.status === 'read' || ult.cw_inbox_id == null) return res.status(200).json({ ok: true, marcada: false });
      const n = (await rest(
        `qs_wa_numeros_meta?select=phone_number_id&cw_inbox_id=eq.${Number(ult.cw_inbox_id)}&status=eq.conectado&limit=1`
      ))?.[0];
      if (!n) return res.status(200).json({ ok: true, marcada: false, motivo: 'numero-desconectado' });
      const r = await marcarComoLida({ wamid, phoneId: n.phone_number_id });
      if (r.erro) {
        console.warn(`[wa-react] visto azul recusado (${r.erro}${r.codigo ? ' ' + r.codigo : ''}): ${r.detalhe || ''}`);
        return res.status(200).json({ ok: true, marcada: false, motivo: r.erro });
      }
      // Marca no QS pra não pedir de novo a cada abertura.
      await rest(`qs_wa_messages?source_id=eq.${encodeURIComponent(ult.source_id)}`, {
        method: 'PATCH', prefer: 'return=minimal', body: { status: 'read' },
      }).catch(() => {});
      return res.status(200).json({ ok: true, marcada: true });
    } catch (e) {
      console.warn('[wa-react] visto azul:', e?.message);
      return res.status(200).json({ ok: true, marcada: false });
    }
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

    // ── ESCONDER NO QS ────────────────────────────────────────────────────
    if (apagar) {
      if (msg.direction !== 'out') {
        return res.status(400).json({ error: 'Só dá para esconder mensagem enviada pela gente.' });
      }
      const ok = await rest('rpc/qs_wa_apagar', { method: 'POST', body: { p_msg: messageId, p_user: userId } });
      return res.status(200).json({
        ok: true,
        apagada: ok !== false,
        aviso: 'Escondida no QS. O cliente continua vendo no WhatsApp dele — a Meta não permite apagar.',
      });
    }

    // ── REAGIR ────────────────────────────────────────────────────────────
    const nome = (await signatureName(auth.user)) || nomeCurto(auth.user?.name) || 'SDR';
    const reactions = await rest('rpc/qs_wa_react', {
      method: 'POST',
      body: { p_msg: messageId, p_autor: userId, p_nome: nome, p_emoji: emoji },
    });
    if (reactions == null) return res.status(404).json({ error: 'Mensagem não encontrada' });

    let entregue = false;
    let motivo = null;
    const wamid = msg.source_id ? String(msg.source_id).replace(/^WAID:/i, '') : null;
    if (!wamid) {
      motivo = 'mensagem-sem-id-do-whatsapp';
    } else {
      // Reação sai pelo número da conversa — mensagem de um número não aceita
      // reação vinda de outro.
      const phoneId = await numeroDoEnvio({ leadId, userId, ownerId: auth.lead?.owner_id ?? null, papel: auth.user?.role ?? null });
      const r = await enviarReacao({ para: auth.lead?.phone, wamid, emoji, phoneId });
      if (r.erro) {
        console.warn(`[wa-react] a Meta recusou a reação (${r.erro}${r.codigo ? ' ' + r.codigo : ''}): ${r.detalhe || ''}`);
        motivo = 'meta-recusou';
      } else {
        entregue = true;
      }
    }
    return res.status(200).json({ ok: true, reactions, entregue, motivo });
  } catch (e) {
    console.error('[wa-react]', e?.message);
    return res.status(502).json({ error: 'Não consegui registrar a reação. Tente de novo.' });
  }
}
