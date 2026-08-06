// api/wa-monitor.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET /api/wa-monitor?secret=<WA_MONITOR_SECRET>
//
// O vigia dos números de WhatsApp. Um agendador externo bate aqui de tempos em
// tempos; a rota pergunta à Evolution como estão as instâncias e manda mensagem
// pro Bruno quando alguma cai, volta ou some. Detalhes da decisão em _waAlerta.js.
//
// POR QUE POR FORA e não um agendador no VPS: se o problema for o próprio VPS
// (Evolution parada, container morto, servidor fora), um monitor rodando lá
// dentro morre junto e ninguém é avisado. Daqui, a Vercel enxerga o VPS de fora.
//
// O CÓDIGO HTTP É PROPOSITAL — é a última linha de defesa:
//   200 = o vigia trabalhou (mesmo que um número esteja caído: o aviso saiu)
//   503 = o vigia NÃO conseguiu trabalhar ou não conseguiu avisar
// Serviços de ping (UptimeRobot, cron-job.org) alertam sozinhos quando a URL
// responde erro. Então, se TODOS os números estiverem fora — e não houver por
// onde mandar WhatsApp —, o 503 faz o próprio agendador avisar por e-mail.
//
// Envs: WA_MONITOR_SECRET, EVOLUTION_URL, EVOLUTION_APIKEY, WA_ALERTA_NUMEROS,
//       SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// -----------------------------------------------------------------------------

import { segredoConfere } from './_supabaseAdmin.js';
import { verificar, destinos } from './_waAlerta.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET' });
  }

  const secret = String(process.env.WA_MONITOR_SECRET || '').trim();
  if (!secret) {
    console.error('[wa-monitor] WA_MONITOR_SECRET ausente — rota desligada');
    return res.status(503).json({ error: 'Monitor não configurado' });
  }
  const sent = String(req.query?.secret || req.headers['x-qs-secret'] || '').trim();
  if (!segredoConfere(sent, secret)) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  if (!destinos().length) {
    console.error('[wa-monitor] WA_ALERTA_NUMEROS vazio — não há pra quem avisar');
    return res.status(503).json({ error: 'WA_ALERTA_NUMEROS não configurado' });
  }

  try {
    const resumo = await verificar();
    // Alerta que não conseguiu sair é falha do vigia, não sucesso silencioso.
    return res.status(resumo.entregue ? 200 : 503).json({ ok: resumo.entregue, ...resumo });
  } catch (e) {
    // Evolution fora do ar cai aqui. É o pior cenário (nem dá pra mandar
    // WhatsApp), e é justamente quando o 503 vira o canal de aviso.
    console.error('[wa-monitor] verificação falhou:', e?.message);
    return res.status(503).json({ error: e?.message || 'Falha ao verificar', code: e?.code });
  }
}
