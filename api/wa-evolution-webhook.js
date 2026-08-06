// api/wa-evolution-webhook.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/wa-evolution-webhook?secret=<EVOLUTION_WEBHOOK_SECRET>
//
// É por aqui que a REAÇÃO DO CLIENTE chega no QS. A ponte Evolution→Chatwoot
// não repassa reação (ela vira, no máximo, um emoji solto perdido) — então a
// própria Evolution avisa o QS direto, e a reação aparece pendurada na
// mensagem certa, como no celular.
//
// Configurar na Evolution (Manager → instância → Webhook, EM CADA instância):
//   URL:     https://qs.setuforeuvouviagens.com.br/api/wa-evolution-webhook?secret=<segredo>
//   Eventos: MESSAGES_UPSERT   (só este — o resto continua indo pelo Chatwoot)
//
// Envs: EVOLUTION_WEBHOOK_SECRET + SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// Responde 200 quase sempre (mesma etiqueta do wa-webhook): erro aqui viraria
// retentativa eterna. Tudo que a Evolution mandar que NÃO for reação é ignorado
// de propósito — mensagem comum já entra pelo webhook do Chatwoot.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

/** O corpo pode trazer UM evento ou uma lista; normaliza pra lista. */
function eventosDe(body) {
  const data = body?.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data];
  return [];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const secret = String(process.env.EVOLUTION_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    console.error('[wa-evo] EVOLUTION_WEBHOOK_SECRET ausente — rota desligada');
    return res.status(503).json({ error: 'Webhook não configurado' });
  }
  const sent = String(req.query?.secret || req.headers['x-qs-secret'] || '').trim();
  if (!segredoConfere(sent, secret)) {
    console.warn(`[wa-evo] segredo não confere (recebido: ${sent ? 'presente' : 'ausente'})`);
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const event = String(body?.event || '').toLowerCase().replace(/_/g, '.');
  if (event && event !== 'messages.upsert') {
    return res.status(200).json({ ignored: 'evento-nao-tratado', event });
  }

  let reacoes = 0;
  for (const item of eventosDe(body)) {
    const reacao = item?.message?.reactionMessage;
    if (!reacao?.key?.id) continue;

    // Reação nossa (mandada pelo QS ou pelo celular da empresa) ecoa de volta
    // com fromMe=true. O QS já gravou a dele na hora do clique — regravar aqui
    // duplicaria; e a do celular fica de fora por enquanto (raro e inofensivo).
    if (item?.key?.fromMe === true) continue;

    const targetId = String(reacao.key.id);
    const emoji = String(reacao.text ?? '').trim();   // vazio = cliente removeu

    try {
      // Acha a mensagem alvo pelo id do WhatsApp e pega o nome do lead junto —
      // é ele que aparece na "pill" da reação. O Chatwoot pode ter gravado o
      // source_id puro ou com o prefixo "WAID:" — cobre os dois.
      const filtro = encodeURIComponent(
        `(source_id.eq."${targetId}",source_id.eq."WAID:${targetId}")`
      );
      const rows = await rest(
        `qs_wa_messages?select=id,lead:qs_leads(first_name,full_name)` +
        `&or=${filtro}&order=sent_at.desc&limit=1`
      );
      const msg = Array.isArray(rows) && rows[0];
      if (!msg) {
        // Mensagem de antes da 0041 (sem source_id) ou de conversa não vinculada.
        console.warn('[wa-evo] reação sem mensagem correspondente:', targetId);
        continue;
      }

      const lead = Array.isArray(msg.lead) ? msg.lead[0] : msg.lead;
      const nome = lead?.first_name
        || String(lead?.full_name || '').trim().split(/\s+/)[0]
        || 'Cliente';

      await rest('rpc/qs_wa_react', {
        method: 'POST',
        body: { p_msg: msg.id, p_autor: 'lead', p_nome: nome, p_emoji: emoji },
      });
      reacoes += 1;
    } catch (e) {
      console.error('[wa-evo] falha ao gravar reação:', e?.message);
    }
  }

  return res.status(200).json({ ok: true, reacoes });
}
