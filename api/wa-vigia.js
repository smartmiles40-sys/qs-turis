// api/wa-vigia.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET /api/wa-vigia   (Authorization: Bearer <JWT>)
//
// A saúde do número OFICIAL, pedida pelo navegador de quem está com o QS
// aberto. É o que acende a faixa de aviso quando a Meta para de entregar
// mensagem (o ponto cego que custou 02/09 a 22/09 — ver _waSaude.js).
//
// Até 23/09/2026 esta rota também fazia a ronda das instâncias da Evolution e
// mandava alerta por WhatsApp. A Evolution saiu do QS (era ela que derrubava os
// números) e o alerta saiu junto: o aviso agora é só na tela.
//
// O formato da resposta ficou igual (instancias/caidas vazias) pra tela antiga
// não quebrar enquanto houver aba aberta com código velho.
// -----------------------------------------------------------------------------

import { getSupabaseUserId } from './_wa.js';
import { saudeDaCaixaOficial } from './_waSaude.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET' });
  }

  const userId = await getSupabaseUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const oficial = await saudeDaCaixaOficial();
    return res.status(200).json({
      ok: true,
      rondou: false,
      verificadoEm: new Date().toISOString(),
      paradoHaMs: 0,
      falha: null,
      instancias: [],
      caidas: [],
      oficial,
    });
  } catch (e) {
    console.error('[wa-vigia]', e?.message);
    return res.status(200).json({ ok: false, erro: e?.message || 'falha' });
  }
}
