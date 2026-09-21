// api/wa-evolution-webhook.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/wa-evolution-webhook?secret=<EVOLUTION_WEBHOOK_SECRET>
//
// DUAS FUNÇÕES:
//
// 1) NÚMEROS DOS SDRs (0082, 21/09/2026) — cada SDR conecta o chip dele pelo QR
//    dentro do QS, e TUDO desse número entra por aqui: mensagem recebida,
//    mensagem mandada do celular, recibo (✓✓/azul), apagada e conexão. O QS cria
//    essas instâncias já apontando o webhook pra cá (ver _waLinha.js).
//
// 2) NÚMEROS ANTIGOS (1935, marketing…) — só a reação do cliente e o aviso de
//    número caído, como antes. Mensagem comum desses entra pelo Chatwoot.
//
// É por aqui que a REAÇÃO DO CLIENTE chega no QS. A ponte Evolution→Chatwoot
// não repassa reação (ela vira, no máximo, um emoji solto perdido) — então a
// própria Evolution avisa o QS direto, e a reação aparece pendurada na
// mensagem certa, como no celular.
//
// Configurar na Evolution (Manager → instância → Webhook, EM CADA instância):
//   URL:     https://qs.setuforeuvouviagens.com.br/api/wa-evolution-webhook?secret=<segredo>
//   Eventos: MESSAGES_UPSERT     (reação do cliente)
//            CONNECTION_UPDATE   (o número caiu/voltou → avisa no WhatsApp)
//   O resto continua indo pelo Chatwoot.
//
// Envs: EVOLUTION_WEBHOOK_SECRET + SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// Responde 200 quase sempre (mesma etiqueta do wa-webhook): erro aqui viraria
// retentativa eterna. Tudo que a Evolution mandar que NÃO for reação é ignorado
// de propósito — mensagem comum já entra pelo webhook do Chatwoot.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { verificar } from './_waAlerta.js';
import { linhaDaInstancia, atualizarLinha, numeroDaInstancia } from './_waLinha.js';
import { receberDaLinha, recibosDaLinha, apagadaNaLinha } from './_waLinhaEntrada.js';

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

  // Esta instância é o número de um SDR? (null = instância antiga)
  let linha = null;
  try {
    linha = await linhaDaInstancia(String(body?.instance || body?.instanceName || ''));
  } catch (e) {
    // Tabela ausente (0082 não aplicada) ou banco lento: trata como antiga.
    console.warn('[wa-evo] não consegui ler qs_wa_linhas:', e?.message);
  }

  if (linha && event === 'connection.update') {
    const estado = String(body?.data?.state || body?.data?.status || '').toLowerCase();
    if (estado) {
      const agora = new Date().toISOString();
      const patch = { status: estado, status_em: agora };
      if (estado === 'open') {
        patch.conectado_em = agora;
        const numero = await numeroDaInstancia(linha.instancia);
        if (numero) patch.numero = numero;
      }
      await atualizarLinha(linha.user_id, patch)
        .catch((e) => console.warn('[wa-evo] status da linha não gravado:', e?.message));
    }
    return res.status(200).json({ ok: true, linha: linha.instancia, estado });
  }

  if (linha && event === 'messages.update') {
    const recibos = await recibosDaLinha(linha, eventosDe(body));
    return res.status(200).json({ ok: true, recibos });
  }

  if (linha && event === 'messages.upsert') {
    const resultado = [];
    for (const item of eventosDe(body)) {
      if (item?.message?.reactionMessage) continue;   // tratada logo abaixo
      if (item?.message?.protocolMessage) {
        resultado.push({ apagada: await apagadaNaLinha(linha, item) });
        continue;
      }
      try {
        resultado.push(await receberDaLinha(linha, item));
      } catch (e) {
        // 200 mesmo assim: erro aqui viraria retentativa eterna da Evolution.
        console.error('[wa-evo] mensagem da linha não gravada:', e?.message);
        resultado.push({ erro: e?.message });
      }
    }
    const reacoes = await gravarReacoes(eventosDe(body));
    return res.status(200).json({ ok: true, linha: linha.instancia, resultado, reacoes });
  }

  // Número caiu/voltou. Em vez de decidir aqui, dispara a MESMA verificação do
  // /api/wa-monitor: o estado e a regra anti-spam ficam num lugar só, e o
  // aviso sai na hora em vez de esperar a próxima varredura do agendador.
  if (event === 'connection.update') {
    try {
      const resumo = await verificar();
      return res.status(200).json({ ok: true, gatilho: 'connection.update', ...resumo });
    } catch (e) {
      console.error('[wa-evo] monitor falhou no connection.update:', e?.message);
      return res.status(200).json({ ok: false, erro: e?.message });
    }
  }

  if (event && event !== 'messages.upsert') {
    return res.status(200).json({ ignored: 'evento-nao-tratado', event });
  }

  const reacoes = await gravarReacoes(eventosDe(body));
  return res.status(200).json({ ok: true, reacoes });
}

/**
 * Reação do cliente pendurada na mensagem certa. Serve às duas famílias de
 * número: a mensagem alvo é achada pelo id do WhatsApp (source_id), que as
 * mensagens da linha do SDR também gravam.
 */
async function gravarReacoes(itens) {
  let reacoes = 0;
  for (const item of itens) {
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

  return reacoes;
}
