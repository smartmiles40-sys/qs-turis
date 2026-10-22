// api/avisos.js
// -----------------------------------------------------------------------------
// AVISOS NA TELA (0196, 22/10/2026) — a parte que depende do RELÓGIO.
//
// Cron da Vercel a cada 5 min (GET com Bearer CRON_SECRET, igual aos outros):
//   1. qs_avisos_tempo()  → prazo de solicitação vencendo (faltam 30 min) ou
//      estourado, reunião começando em ~10 min, etapas da Esteira que vencem
//      hoje (1 aviso por pessoa por dia) e o resumo das tarefas atrasadas do
//      SDR às 9h. Tudo idempotente: a chave do aviso impede repetir.
//   2. qs_avisos_limpar() → apaga avisos lidos há mais de 30 dias.
//
// Os avisos "de ação" (pedido novo, passou pra você, concluída, comentário…)
// nascem na hora pelos gatilhos do banco — não passam por aqui.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });
  const segredo = String(process.env.CRON_SECRET || '').trim();
  const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Não autorizado' });

  const saida = {};
  try {
    saida.tempo = await rest('rpc/qs_avisos_tempo', { method: 'POST', body: {} });
  } catch (e) {
    console.error('[avisos] tempo falhou:', String(e?.message || '').slice(0, 200));
    saida.erroTempo = String(e?.message || 'falhou').slice(0, 200);
  }
  try {
    saida.apagados = await rest('rpc/qs_avisos_limpar', { method: 'POST', body: {} });
  } catch (e) {
    console.warn('[avisos] limpeza falhou:', String(e?.message || '').slice(0, 200));
    saida.erroLimpeza = String(e?.message || 'falhou').slice(0, 200);
  }
  console.log(`[avisos] ${JSON.stringify(saida)}`);
  return res.status(saida.erroTempo ? 500 : 200).json(saida);
}
