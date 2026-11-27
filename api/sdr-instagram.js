// api/sdr-instagram.js
// -----------------------------------------------------------------------------
// INSTAGRAM NA CONVERSA DO SDR (Bruno, 27/11/2026). POST /api/sdr-instagram
//
//   { leadId, texto }          responde a DM do lead pelo @ da agência
//   { leadId, acao: 'lida' }   zera o "não lidas" (só o dono do lead)
//
// A conversa é a do Marketing (mkt_ig_conversas, 0244) amarrada ao lead pelo @
// (0430). Mesma trava das rotas do WhatsApp: o servidor confirma que o usuário
// pode falar com este lead (assertCanAccessLead) antes de mandar qualquer coisa.
//
// Regra da Meta: só dá pra responder até 24 h depois da última mensagem do
// cliente. Fora disso a rota recusa com `motivo: 'janela-fechada'` — a tela
// explica e manda abrir o Instagram no celular.
// -----------------------------------------------------------------------------

import { assertCanAccessLead, getSupabaseUserId } from './_wa.js';
import { rest } from './_supabaseAdmin.js';
import { enviarDm, montarMensagemIg, janelaIg } from './_mktInstagram.js';
import { pausaPorRespostaManual } from './_mktAutoRegras.js';
import { comSentry } from './_sentry.js';

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }
  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const leadId = String(body.leadId || '').trim();
  const lida = String(body.acao || '').toLowerCase() === 'lida';
  const texto = String(body.texto ?? '').trim();
  if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });
  if (!lida && !texto) return res.status(400).json({ error: 'Escreva a mensagem' });
  if (texto.length > 1000) return res.status(400).json({ error: 'Mensagem longa demais (máx. 1000 caracteres no Instagram)' });

  const auth = await assertCanAccessLead(userId, leadId).catch(() => null);
  if (!auth) return res.status(500).json({ error: 'Falha ao validar o lead' });
  if (!auth.ok) return res.status(auth.reason === 'lead-de-outro-sdr' ? 403 : 404).json({ error: 'Sem acesso a este lead', motivo: auth.reason });

  const conv = (await rest(
    `mkt_ig_conversas?select=id,igsid,conta_id,ultima_entrada_em&lead_id=eq.${encodeURIComponent(leadId)}` +
    `&order=ultima_mensagem_em.desc.nullslast&limit=1`,
  ).catch(() => null))?.[0];
  if (!conv) return res.status(404).json({ error: 'Este lead ainda não mandou DM pro Instagram da agência', motivo: 'sem-conversa' });

  if (lida) {
    if (auth.lead?.owner_id && auth.lead.owner_id !== userId) return res.status(200).json({ ok: true, marcada: false });
    await rest(`mkt_ig_conversas?id=eq.${conv.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { nao_lidas: 0 } }).catch(() => null);
    return res.status(200).json({ ok: true, marcada: true });
  }

  if (!janelaIg(conv.ultima_entrada_em)) {
    return res.status(409).json({
      error: 'Passou de 24 h desde a última mensagem do cliente: a Meta não deixa responder por aqui. Responda pelo app do Instagram — quando o cliente escrever de novo, a conversa volta a abrir no QS.',
      motivo: 'janela-fechada',
    });
  }
  const conta = (await rest(`mkt_ig_contas?select=id,ig_user_id,username,status&id=eq.${conv.conta_id}&limit=1`).catch(() => null))?.[0];
  if (!conta || conta.status !== 'conectada') return res.status(409).json({ error: 'O Instagram da agência está desconectado — avise o Marketing.', motivo: 'conta-desconectada' });

  try {
    const mid = await enviarDm(conta, conv.id, { id: conv.igsid }, montarMensagemIg(texto), 'manual', null);
    // A SDR assumiu: o robô do Marketing sai do caminho por 12 h, e a conversa conta como lida.
    await rest(`mkt_ig_conversas?id=eq.${conv.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { automacao_pausada_ate: pausaPorRespostaManual(12), nao_lidas: 0 } }).catch(() => null);
    return res.status(200).json({ ok: true, mid });
  } catch (e) {
    return res.status(502).json({ error: `O Instagram recusou: ${String(e?.message || e).slice(0, 200)}` });
  }
}

export default comSentry(handler);
