// api/gloria-transferir.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/gloria-transferir
//   header x-gloria-secret: <GLORIA_SECRET>
//   { lead_id, motivo, resumo?, temperatura? }
//
// A Glória sai da conversa e o time entra. É a saída de emergência dela — e
// também o final feliz: lead qualificado é lead transferido.
//
// motivo: pedido_humano | qualificado | urgencia | reclamacao | fora_da_janela_24h
//         | erro_da_ia  (qualquer outro texto também é aceito e vai pro log)
//
// O QUE ACONTECE AQUI, NESTA ORDEM
//
// 1. A IA é DESLIGADA neste lead (qs_gloria_pausar). Primeiro passo de
//    propósito: se qualquer coisa abaixo falhar, o pior cenário é o time ser
//    avisado por outro caminho — e não a IA continuar falando com alguém que
//    pediu para falar com uma pessoa.
// 2. Uma NOTA no card, com o resumo e a qualificação que ela juntou. É o que o
//    SDR lê antes de abrir a conversa.
// 3. Uma TAREFA extra de WhatsApp para AGORA, para o dono do lead. Sem tarefa,
//    a transferência vira um card parado que ninguém olha.
//
// Nada aqui reatribui dono, muda status nem mexe em cadência: quem decide isso
// é gente. A IA só entrega o bastão.
//
// Envs: GLORIA_SECRET + SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// -----------------------------------------------------------------------------

import { rest, insert } from './_supabaseAdmin.js';
import { portaria, corpo, buscarLead, registrar, pausar } from './_gloria.js';

const MOTIVOS = {
  pedido_humano: 'o lead pediu para falar com uma pessoa',
  qualificado: 'qualificação concluída — hora de agendar a call',
  urgencia: 'o lead demonstrou urgência',
  reclamacao: 'o lead reclamou',
  fora_da_janela_24h: 'janela de 24h fechada — só template aprovado passa',
  erro_da_ia: 'a IA não conseguiu responder',
  // A IA prefere confessar que não sabe a inventar um preço. Esta é a saída
  // dela quando a base de conhecimento não tem a resposta.
  duvida_sem_resposta: 'o lead perguntou algo que não está na base de conhecimento',
};

/** A qualificação que ela já tinha juntado, em texto de gente. */
function blocoQualificacao(s) {
  if (!s) return '';
  const linhas = [
    ['Data faz sentido', s.resposta_data],
    ['Investimento', s.resposta_investimento],
    ['Prazo de decisão', s.resposta_decisao],
    ['Perfil de viajante', s.perfil_viajante],
    ['Como pretende viajar', s.como_pretende_viajar],
  ].filter(([, v]) => v);
  if (!linhas.length) return '\n\nQualificação: ainda não respondeu nenhuma das 5.';
  return `\n\nQualificação (${linhas.length}/5)\n` + linhas.map(([k, v]) => `• ${k}: ${v}`).join('\n');
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
  const motivo = String(body.motivo || 'pedido_humano').trim().slice(0, 80);
  const resumo = String(body.resumo || '').trim().slice(0, 2000);
  const temperatura = ['Quente', 'Morno', 'Frio'].includes(body.temperatura) ? body.temperatura : null;

  if (!leadId) return res.status(400).json({ error: 'lead_id obrigatório' });

  try {
    const lead = await buscarLead(leadId);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });

    // (1) Desliga a IA. Se a 0053 não estiver colada, isto falha e o resto nem
    // deve tentar — o time seria avisado de uma transferência que não aconteceu.
    try {
      await pausar(leadId, motivo, resumo || null, true);
    } catch (e) {
      if (/qs_gloria_pausar|schema cache|does not exist/i.test(String(e?.message))) {
        return res.status(503).json({ error: 'A migration 0053 (Glória) ainda não foi aplicada', motivo: 'sem_0053' });
      }
      throw e;
    }

    if (temperatura) {
      await rest('rpc/qs_gloria_salvar', {
        method: 'POST',
        body: { p_lead: leadId, p_temperatura: temperatura },
      }).catch((e) => console.warn('[gloria-transferir] temperatura:', e?.message));
    }

    // A qualificação depois do pausar: assim a nota já sai com o que a IA
    // acabou de gravar na mesma rodada.
    let ses = null;
    try {
      const rows = await rest(
        `qs_gloria_sessoes?select=*&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
      );
      ses = rows?.[0] || null;
    } catch (e) {
      console.warn('[gloria-transferir] sessão:', e?.message);
    }

    // (2) A nota. author_id null = "não foi uma pessoa" — a tela mostra o corpo
    // do mesmo jeito, e o 🤖 na primeira linha entrega quem escreveu.
    const corpoNota =
      `🤖 Glória (IA) devolveu a conversa\n` +
      `Motivo: ${MOTIVOS[motivo] || motivo}` +
      (ses?.temperatura ? `\nTemperatura: ${ses.temperatura}` : '') +
      (resumo ? `\n\n${resumo}` : '') +
      blocoQualificacao(ses);

    let notaOk = false;
    try {
      await insert('qs_notes', { lead_id: leadId, author_id: null, body: corpoNota, tags: ['gloria'] }, { returning: false });
      notaOk = true;
    } catch (e) {
      console.warn('[gloria-transferir] nota:', e?.message);
    }

    // (3) A tarefa. `is_extra` porque não faz parte do plano da cadência — não
    // pode contar como o toque do dia nem empurrar os próximos.
    let tarefaOk = false;
    try {
      await insert('qs_tasks', {
        lead_id: leadId,
        owner_id: lead.owner_id ?? null,
        channel_type: 'whatsapp',
        priority: motivo === 'qualificado' || motivo === 'urgencia' ? 'alta' : 'media',
        scheduled_at: new Date().toISOString(),
        status: 'pendente',
        is_extra: true,
        notes: `Glória devolveu a conversa: ${MOTIVOS[motivo] || motivo}`.slice(0, 500),
        tags: ['gloria', motivo],
      }, { returning: false });
      tarefaOk = true;
    } catch (e) {
      console.warn('[gloria-transferir] tarefa:', e?.message);
    }

    await registrar(leadId, 'evento', resumo || null, `transferida: ${motivo}`, { notaOk, tarefaOk });

    return res.status(200).json({
      ok: true, lead_id: leadId, motivo,
      nota: notaOk, tarefa: tarefaOk,
      owner_id: lead.owner_id ?? null,
      // O n8n mostra isto pro modelo: com `ok:true` ele sabe que pode se
      // despedir do lead em vez de tentar transferir de novo.
      recado: 'Conversa devolvida ao time. Não responda mais este lead.',
    });
  } catch (e) {
    console.error('[gloria-transferir]', e?.message, e?.details || '');
    return res.status(500).json({ error: 'Falha ao transferir', detalhe: e?.message });
  }
}
