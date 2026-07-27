// api/wa-config.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET /api/wa-config
//
// Devolve, numa chamada só, as duas listas que o painel de atendimento precisa
// ao abrir:
//   • respostas — as respostas prontas do Chatwoot (/atalho)
//   • inboxes   — os NÚMEROS que existem de verdade, pro SDR escolher por qual
//                 falar. Vem do Chatwoot (não da configuração) porque só existe
//                 caixa quando o número está conectado: assim o número oficial
//                 aparece sozinho no seletor no dia em que entrar no ar.
//
// Por que uma rota só em vez de duas: o plano da Vercel limita o projeto a 12
// funções, e nós estamos no teto. Fundir as duas consultas — que o front fazia
// lado a lado de qualquer jeito — devolve a folga e ainda corta uma ida ao
// servidor. Se um dia precisar de mais rotas, o caminho é consolidar as wa-*
// num despachante único (ou subir o plano), não espremer mais.
//
// Nenhuma das duas é crítica: falhou, devolve lista vazia. Sem atalhos e sem
// seletor o SDR ainda conversa normalmente.
// -----------------------------------------------------------------------------

import { getSupabaseUserId, cwConfigured, cw, WA_INBOX_IDS, defaultInboxId } from './_wa.js';

async function buscarRespostas() {
  try {
    const data = await cw('/canned_responses');
    const list = Array.isArray(data) ? data : (data?.payload || []);
    return list
      .map((c) => ({ atalho: String(c.short_code || ''), texto: String(c.content || '') }))
      .filter((c) => c.atalho && c.texto);
  } catch (e) {
    console.warn('[wa-config] canned_responses:', e?.message);
    return [];
  }
}

async function buscarInboxes() {
  try {
    const data = await cw('/inboxes');
    const list = Array.isArray(data?.payload) ? data.payload : [];
    return list
      // Com a lista de caixas de WhatsApp configurada, ela manda. Sem ela,
      // devolvemos todas — melhor oferecer demais que travar o envio.
      .filter((i) => (WA_INBOX_IDS.length ? WA_INBOX_IDS.includes(Number(i.id)) : true))
      .map((i) => ({
        id: Number(i.id),
        nome: String(i.name || `Caixa ${i.id}`),
        canal: String(i.channel_type || ''),
      }));
  } catch (e) {
    console.warn('[wa-config] inboxes:', e?.message);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET' });
  }

  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  if (!cwConfigured()) {
    return res.status(200).json({ respostas: [], inboxes: [], padrao: null });
  }

  const [respostas, inboxes] = await Promise.all([buscarRespostas(), buscarInboxes()]);

  // Cache curto: as duas listas mudam raríssimo e o painel consulta a cada abertura.
  res.setHeader('Cache-Control', 'private, max-age=180');
  return res.status(200).json({ respostas, inboxes, padrao: defaultInboxId() });
}
