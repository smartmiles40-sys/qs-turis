// api/wa-inboxes.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET /api/wa-inboxes
//
// Diz quais NÚMEROS estão realmente disponíveis pra enviar. O SDR escolhe entre
// eles na hora de mandar a mensagem (WhatsApp normal x API oficial).
//
// Por que perguntar ao Chatwoot em vez de ler só a configuração: o número oficial
// só existe depois que a caixa dele é criada lá. Assim o botão aparece sozinho
// quando o número entrar no ar — e some se a caixa for removida. Nada de oferecer
// um canal que não está conectado.
//
// O rótulo bonito ("Comercial", "API oficial") vem de qs_settings.wa_inbox_labels,
// que o front já lê; aqui devolvemos o que EXISTE, com o nome cru do Chatwoot.
// -----------------------------------------------------------------------------

import { getSupabaseUserId, cwConfigured, cw, WA_INBOX_IDS, defaultInboxId } from './_wa.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET' });
  }

  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  if (!cwConfigured()) return res.status(200).json({ inboxes: [], padrao: null });

  try {
    const data = await cw('/inboxes');
    const list = Array.isArray(data?.payload) ? data.payload : [];

    const inboxes = list
      // Se a lista de caixas de WhatsApp estiver configurada, ela manda. Sem ela,
      // devolvemos todas — melhor oferecer demais que travar o envio.
      .filter((i) => (WA_INBOX_IDS.length ? WA_INBOX_IDS.includes(Number(i.id)) : true))
      .map((i) => ({
        id: Number(i.id),
        nome: String(i.name || `Caixa ${i.id}`),
        canal: String(i.channel_type || ''),
      }));

    res.setHeader('Cache-Control', 'private, max-age=120');
    return res.status(200).json({ inboxes, padrao: defaultInboxId() });
  } catch (e) {
    console.warn('[wa-inboxes]', e?.message);
    return res.status(200).json({ inboxes: [], padrao: defaultInboxId() });
  }
}
