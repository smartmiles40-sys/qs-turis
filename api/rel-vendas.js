// api/rel-vendas.js
// -----------------------------------------------------------------------------
// PIPELINE DE VENDAS DO RELACIONAMENTO — a parte que depende do RELÓGIO (0218).
//
// Vercel Cron, de hora em hora (GET com Bearer CRON_SECRET, igual aos outros):
//   1. rel_oportunidades_gerar()   → cria os cartões das origens LIGADAS em
//      rel_rotinas_config (voltou de viagem / embarca sem seguro / aniversário).
//      Idempotente: cada cartão tem uma origem_chave única, então rodar de hora
//      em hora não duplica — e o teto por dia segura o primeiro dia.
//   2. rel_oportunidades_lembretes() → "próxima ação" vencendo vira aviso no
//      sino do dono (chave única por cartão + horário: não repete).
//
// Nada aqui fala com cliente: só cria cartão e aviso pro time.
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
    saida.geradas = await rest('rpc/rel_oportunidades_gerar', { method: 'POST', body: { p_simular: false } });
  } catch (e) {
    saida.erroGerar = String(e?.message || 'falhou').slice(0, 200);
  }
  try {
    saida.lembretes = await rest('rpc/rel_oportunidades_lembretes', { method: 'POST', body: {} });
  } catch (e) {
    saida.erroLembretes = String(e?.message || 'falhou').slice(0, 200);
  }
  console.log(`[rel-vendas] ${JSON.stringify(saida)}`);
  return res.status(saida.erroGerar || saida.erroLembretes ? 500 : 200).json(saida);
}
