// api/gloria-abordar.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/gloria-abordar
//   { lead_id, teste? }
//
// "Glória, puxa assunto com este lead." A regra inteira mora em `_abordagem.js`;
// aqui é só a portaria e a tradução do resultado pra uma frase que o SDR
// entenda.
//
// DUAS PORTARIAS, porque são dois chamadores legítimos:
//
//   • O SDR, pelo botão do quadro (Bearer do Supabase). Ele só aborda lead que
//     pode ver — a mesma regra de acesso do resto do QS.
//   • Uma máquina (x-gloria-secret): o n8n, um teste de curl, ou uma automação
//     de fora. A entrada automática de lead novo NÃO passa por aqui — ela chama
//     `abordar()` direto, sem dar a volta pela rede.
//
// `teste: true` mostra o que ela mandaria, sem mandar. É o jeito de conferir se
// o template está bem preenchido antes de gastar um disparo com um lead de
// verdade.
//
// Envs: GLORIA_SECRET + CHATWOOT_* + SUPABASE_*
// -----------------------------------------------------------------------------

import { getSupabaseUserId, assertCanAccessLead } from './_wa.js';
import { segredoConfere } from './_supabaseAdmin.js';
import { corpo, buscarLead } from './_gloria.js';
import { abordar } from './_abordagem.js';

/**
 * O motivo cru vira frase. Cada uma dessas linhas existe porque o motivo cru
 * (`sem_template_de_abertura`) não diz o que fazer, e o que o SDR precisa saber
 * é o que fazer.
 */
const EXPLICACAO = {
  gloria_desligada: 'A Glória está desligada. Ligue no topo da tela Atendimento IA.',
  fora_do_pipeline: 'Este lead não está no atendimento por IA. Coloque no quadro primeiro.',
  ia_desligada_neste_lead: 'A IA já saiu desta conversa. Reabra o card no quadro pra ela voltar.',
  ja_abordado: 'Ela já puxou assunto com este lead — não vai puxar de novo.',
  teto_do_dia: 'O teto de primeiros contatos do dia foi atingido. Aumente o teto ou espere amanhã.',
  teto_zerado: 'O teto de primeiros contatos está em zero — ninguém é abordado.',
  lead_sem_telefone: 'Este lead não tem telefone.',
  sem_template_de_abertura: 'Falta escolher o modelo aprovado da Meta pro primeiro contato.',
  template_incompleto: 'O modelo escolhido tem uma variável que este lead não preenche.',
  'modelo-nao-encontrado': 'O modelo escolhido não está mais aprovado na Meta (ou mudou de nome).',
  'modelo-sem-corpo': 'O modelo escolhido não tem corpo de texto.',
  chatwoot_nao_configurado: 'O WhatsApp não está configurado neste ambiente.',
  n8n_recusou: 'O n8n recusou o aviso — confira a credencial do webhook da Glória.',
  ultima_mensagem_sem_texto: 'A última mensagem dele é áudio/imagem sem texto: ela não tem o que responder.',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const body = corpo(req);
  const leadId = String(body.lead_id || body.leadId || '').trim();
  if (!leadId) return res.status(400).json({ error: 'lead_id obrigatório' });

  // ── Portaria ──────────────────────────────────────────────────────────────
  const segredo = String(process.env.GLORIA_SECRET || '').trim();
  const recebido = String(req.headers['x-gloria-secret'] || '').trim();
  const porMaquina = !!segredo && !!recebido && segredoConfere(recebido, segredo);

  if (!porMaquina) {
    let userId;
    try {
      userId = await getSupabaseUserId(req.headers.authorization);
    } catch {
      userId = null;
    }
    if (!userId) return res.status(401).json({ error: 'Não autorizado' });
    try {
      await assertCanAccessLead(userId, leadId);
    } catch (e) {
      return res.status(403).json({ error: e?.message || 'Sem acesso a este lead' });
    }
  }

  try {
    const lead = await buscarLead(leadId);
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });

    const r = await abordar({
      lead,
      origem: porMaquina ? 'maquina' : 'manual',
      teste: body.teste === true || body.teste === 'true',
    });

    if (r.ok) return res.status(200).json(r);

    // 200 mesmo quando não abordou, e de propósito: "ela já falou com este lead"
    // não é erro de servidor, é resposta. Quem chama precisa do MOTIVO, não de
    // um status pra tratar como falha.
    return res.status(200).json({
      ...r,
      explicacao: EXPLICACAO[r.motivo] || r.detalhe || `Não abordou: ${r.motivo}`,
    });
  } catch (e) {
    console.error('[gloria-abordar]', e?.message);
    return res.status(500).json({ error: 'Falha ao abordar', detalhe: e?.message });
  }
}
