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
//         | erro_da_ia | duvida_sem_resposta | sem_resposta
//         (qualquer outro texto também é aceito e vai pro log)
//
// O QUE ACONTECE, NESTA ORDEM: a IA é desligada neste lead, nasce uma NOTA no
// card com o resumo e a qualificação, e uma TAREFA extra de WhatsApp pra AGORA,
// pro dono do lead. Sem tarefa, a transferência vira um card parado que ninguém
// olha.
//
// A execução mora em `devolverProTime` (api/_gloria.js), e não aqui, porque são
// DOIS caminhos que precisam dela: esta rota (quando o próprio modelo decide
// sair) e a cadência da IA (quando ela dá os toques e o lead não volta). A
// regra de como se entrega o bastão precisa ser uma só.
//
// Nada aqui reatribui dono, muda status nem mexe em cadência: quem decide isso
// é gente. A IA só entrega o bastão.
//
// Envs: GLORIA_SECRET + SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// -----------------------------------------------------------------------------

import { portaria, corpo, buscarLead, devolverProTime } from './_gloria.js';

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

  try {
    const lead = await buscarLead(leadId);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });

    // MODO TESTE: nada é desligado, nenhuma nota e nenhuma tarefa nascem.
    // Vale principalmente aqui: esta rota é chamada pelo MODELO quando ele
    // decide transferir, então sem esta trava um teste conversacional criaria
    // tarefa de verdade na fila de alguém.
    const teste = body.teste === true || body.teste === 'true';

    let r;
    try {
      r = await devolverProTime({
        leadId,
        lead,
        teste,
        motivo: body.motivo,
        resumo: body.resumo,
        temperatura: body.temperatura,
        // Só é lido quando o motivo é `perdido`. Uma das quatro palavras que
        // ela pode julgar (ver MOTIVOS_DE_PERDA em _gloria.js); qualquer outra
        // coisa e o lead vira perdido sem motivo em vez de com motivo errado.
        motivoPerda: body.motivo_perda ?? body.motivoPerda ?? null,
      });
    } catch (e) {
      if (/qs_gloria_pausar|schema cache|does not exist/i.test(String(e?.message))) {
        return res.status(503).json({ error: 'A migration 0053 (Glória) ainda não foi aplicada', motivo: 'sem_0053' });
      }
      throw e;
    }

    if (r?.teste) return res.status(200).json(r);

    return res.status(200).json({
      ...r,
      // O n8n mostra isto pro modelo: com `ok:true` ele sabe que pode se
      // despedir do lead em vez de tentar transferir de novo.
      recado: 'Conversa devolvida ao time. Não responda mais este lead.',
    });
  } catch (e) {
    console.error('[gloria-transferir]', e?.message, e?.details || '');
    return res.status(500).json({ error: 'Falha ao transferir', detalhe: e?.message });
  }
}
