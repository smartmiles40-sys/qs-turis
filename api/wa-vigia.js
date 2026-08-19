// api/wa-vigia.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET /api/wa-vigia   (Authorization: Bearer <JWT>)
//
// O vigia dos números, mas acionado por QUEM ESTÁ USANDO O QS — não por um
// agendador externo e não por um segredo em URL.
//
// POR QUE EXISTE. Até 19/08 o vigia dependia de uma única perna: um monitor
// externo (UptimeRobot) batendo em /api/wa-monitor?secret=… Essa perna parou de
// disparar em 17/08 às 15:13 e ficou dois dias sem ninguém notar. O modo de
// falha é o pior possível: silêncio parece "está tudo bem".
//
// Agora são três pernas, e cada uma cobre o buraco da outra:
//   1. o webhook do Chatwoot (cada mensagem que entra faz o pulso)  — vale
//      enquanto CHEGA mensagem; morre junto se o VPS morrer;
//   2. esta rota, chamada pelo navegador das SDRs com o QS aberto    — vale
//      justamente quando NADA chega, que é o caso que a perna 1 não vê;
//   3. o agendador externo, se estiver de pé                         — cobre a
//      madrugada, quando não há ninguém com o QS aberto.
//
// Só lê e devolve saúde; a ronda de verdade tem trava de 10 minutos no banco,
// então mil abas abertas não viram mil chamadas à Evolution.
//
// Envs: as mesmas do wa-monitor (EVOLUTION_URL, EVOLUTION_APIKEY,
//       WA_ALERTA_NUMEROS, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
// -----------------------------------------------------------------------------

import { getSupabaseUserId } from './_wa.js';
import { verificarSeVencido, saudeDoVigia } from './_waAlerta.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET' });
  }

  // Sem segredo em URL de propósito: quem chama é o navegador de uma pessoa
  // logada, e o que autoriza é a sessão dela. Segredo que vai pro front não é
  // segredo.
  const userId = await getSupabaseUserId(req.headers.authorization);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  // A ronda é best-effort: se a Evolution estiver fora, `verificarSeVencido`
  // registra a falha no estado e não lança. A tela precisa da SAÚDE de
  // qualquer jeito — inclusive (e principalmente) quando a ronda falhou.
  const ronda = await verificarSeVencido();

  try {
    const saude = await saudeDoVigia();
    return res.status(200).json({ ok: true, rondou: !ronda.pulou, ...saude });
  } catch (e) {
    console.error('[wa-vigia]', e?.message);
    return res.status(200).json({ ok: false, erro: e?.message || 'falha' });
  }
}
