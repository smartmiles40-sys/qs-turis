// api/gloria-toques.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET|POST /api/gloria-toques
//   Authorization: Bearer <JWT>        (o QS aberto na tela de alguém)
//   ou header x-gloria-secret          (o n8n, ou um agendador, se você quiser)
//
// A CADÊNCIA DA GLÓRIA — os toques que ela dá quando o lead some no meio da
// conversa. Roda a fila e devolve o que fez.
//
// POR QUE NÃO TEM AGENDADOR. O vigia dos números dependia de um monitor
// externo; ele parou de disparar em 17/08 e ficou dois dias sem ninguém notar,
// porque silêncio parece "está tudo bem". A cadência aqui pega carona em duas
// coisas que já acontecem — o webhook de cada mensagem que entra e o QS aberto
// no navegador — e a trava de 5 minutos no banco impede que mil abas virem mil
// rodadas. Se você QUISER pendurar um agendador para cobrir a madrugada, ele é
// a terceira perna, nunca a única (e nem faz falta: a janela de horário dos
// toques é 8h–21h).
//
// Quem decide QUEM leva toque é o banco (`qs_gloria_fila_de_toques`, 0060);
// quem escreve o texto é a Glória no n8n. Aqui só se junta uma coisa à outra.
//
// Envs: GLORIA_WEBHOOK_URL + GLORIA_SECRET + SUPABASE_*
// -----------------------------------------------------------------------------

import { getSupabaseUserId } from './_wa.js';
import { rodarFilaDeToques, saudeDaFila, portaria } from './_gloria.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET' });
  }

  // Duas portas, e as duas exigem credencial: a sessão de quem está com o QS
  // aberto, ou o segredo compartilhado. Segredo em URL não entra aqui.
  //
  // A checagem do segredo só roda se ele VEIO — senão a portaria registraria
  // "segredo não confere" a cada 5 minutos por aba aberta, e log de alerta que
  // toca sozinho o tempo todo é log que ninguém lê.
  const mandouSegredo = !!req.headers['x-gloria-secret'];
  const temSegredo = mandouSegredo && portaria(req) === null;
  const userId = temSegredo ? null : await getSupabaseUserId(req.headers.authorization);
  if (!temSegredo && !userId) return res.status(401).json({ error: 'Não autorizado' });

  // `forcar` só pela porta do segredo: um botão na tela que fura a trava de 5
  // minutos vira martelo em cima do lead se alguém segurar o F5.
  const forcar = temSegredo && (req.query?.forcar === '1' || req.body?.forcar === true);

  try {
    const rodada = await rodarFilaDeToques({ forcar });
    const saude = await saudeDaFila();
    return res.status(200).json({ ok: true, ...rodada, saude });
  } catch (e) {
    // A tela precisa da saúde de qualquer jeito — inclusive (e principalmente)
    // quando a rodada falhou.
    console.error('[gloria-toques]', e?.message);
    return res.status(200).json({ ok: false, erro: e?.message || 'falha', saude: await saudeDaFila().catch(() => null) });
  }
}
