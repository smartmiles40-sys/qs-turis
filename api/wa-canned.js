// api/wa-canned.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET /api/wa-canned
//
// Devolve as RESPOSTAS PRONTAS que já estão cadastradas no Chatwoot (/primeiro-
// contato, /follow-up, /retomada, /agendar). O SDR digita "/" no campo de
// mensagem e escolhe.
//
// De propósito NÃO duplicamos isso no banco do QS: o Bruno já mantém as
// respostas no Chatwoot, e duas listas pra manter sempre viram duas listas
// diferentes. Aqui é só um proxy autenticado (o token do Chatwoot é server-side).
// -----------------------------------------------------------------------------

import { getSupabaseUserId, cwConfigured, cw } from './_wa.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET' });
  }

  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  if (!cwConfigured()) return res.status(200).json({ respostas: [] });

  try {
    const data = await cw('/canned_responses');
    const list = Array.isArray(data) ? data : (data?.payload || []);
    const respostas = list
      .map((c) => ({ atalho: String(c.short_code || ''), texto: String(c.content || '') }))
      .filter((c) => c.atalho && c.texto);

    // Cache curto: a lista muda raríssimo e o SDR abre o menu o tempo todo.
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).json({ respostas });
  } catch (e) {
    console.warn('[wa-canned]', e?.message);
    return res.status(200).json({ respostas: [] });   // sem atalhos ≠ erro de tela
  }
}
