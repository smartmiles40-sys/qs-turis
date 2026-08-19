// api/_gloria.js
// -----------------------------------------------------------------------------
// O que a Glória (a IA de atendimento, que mora no n8n) precisa do lado do QS.
//
// Duas rotas usam este arquivo: `gloria-responder` (ela manda o que escreveu) e
// `gloria-transferir` (ela devolve a conversa pro time). Nenhuma delas passa por
// login de usuário — quem chama é uma máquina — então TUDO aqui depende de um
// segredo compartilhado (GLORIA_SECRET) e de a IA estar ligada no banco.
//
// Envs: GLORIA_SECRET + SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// -----------------------------------------------------------------------------

import { rest, insert, segredoConfere } from './_supabaseAdmin.js';
import { parseCwDate } from './_wa.js';

/**
 * O nome com que as mensagens dela são gravadas.
 *
 * Não é enfeite: é este texto que o gatilho `qs_gloria_humano_assumiu` (0053)
 * usa pra saber que a mensagem que acabou de entrar foi ELA, e não o SDR
 * assumindo a conversa. Mudar aqui sem mudar na migration faz a IA se desligar
 * sozinha a cada resposta que der.
 */
export const ASSINATURA_IA = 'Glória (IA)';

/**
 * Portaria das rotas da Glória. Devolve null quando pode seguir, ou um objeto
 * { status, error } pra rota responder.
 *
 * O segredo pode vir no header `x-gloria-secret` ou em `?secret=` — o n8n manda
 * pelo header (credencial Header Auth), a querystring fica pro teste no curl.
 */
export function portaria(req) {
  const esperado = String(process.env.GLORIA_SECRET || '').trim();
  if (!esperado) {
    console.error('[gloria] GLORIA_SECRET ausente — rota desligada');
    return { status: 503, error: 'Atendimento por IA não configurado' };
  }
  // .trim() dos dois lados: segredo colado no painel da Vercel vem com espaço
  // invisível com frequência alta demais, e o sintoma (401 em tudo) é péssimo
  // de diagnosticar.
  const recebido = String(req.headers['x-gloria-secret'] || req.query?.secret || '').trim();
  if (!segredoConfere(recebido, esperado)) {
    console.warn(`[gloria] segredo não confere (recebido: ${recebido ? 'presente' : 'ausente'})`);
    return { status: 401, error: 'Não autorizado' };
  }
  return null;
}

/** O lead, com o mínimo que as duas rotas precisam. */
export async function buscarLead(leadId) {
  const rows = await rest(
    `qs_leads?select=id,owner_id,full_name,first_name,last_name,phone,status,segment,bitrix_id` +
    `&id=eq.${encodeURIComponent(leadId)}&limit=1`
  );
  return (Array.isArray(rows) && rows[0]) || null;
}

/**
 * A sessão da IA neste lead. É o interruptor: `ativa=false` significa que
 * alguém (ou o gatilho) já tirou a IA desta conversa, e nada mais pode sair em
 * nome dela — nem uma mensagem que o n8n já tinha na mão quando isso aconteceu.
 */
export async function sessao(leadId) {
  try {
    const rows = await rest(
      `qs_gloria_sessoes?select=lead_id,ativa,motivo,etapa,temperatura,resumo,respondidas,transferida_em` +
      `&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
    );
    return (Array.isArray(rows) && rows[0]) || null;
  } catch (e) {
    // Tabela ausente = a 0053 ainda não foi colada. Quem trata é a rota.
    if (/qs_gloria_sessoes|schema cache|does not exist/i.test(String(e?.message))) {
      const err = new Error('A migration 0053 (Glória) ainda não foi aplicada no banco');
      err.code = 'SEM_0053';
      throw err;
    }
    throw e;
  }
}

/** Uma linha no diário da IA. Best-effort: log que quebra rota não serve. */
export async function registrar(leadId, direcao, conteudo, motivo = null, payload = {}) {
  try {
    await insert('qs_gloria_log', { lead_id: leadId, direcao, conteudo, motivo, payload }, { returning: false });
  } catch (e) {
    console.warn('[gloria] não deu pra registrar no log:', e?.message);
  }
}

/** Desliga a IA nesta conversa (rpc da 0053). */
export function pausar(leadId, motivo, resumo = null, transferida = false) {
  return rest('rpc/qs_gloria_pausar', {
    method: 'POST',
    body: { p_lead: leadId, p_motivo: motivo, p_resumo: resumo, p_transferida: transferida },
  });
}

/**
 * Cutuca o n8n: "chegou mensagem deste lead, veja se você responde".
 *
 * Chamado pelo webhook do WhatsApp a cada mensagem NOVA do cliente. Três
 * decisões que importam:
 *
 * • NÃO decide nada aqui. Quem sabe se a IA está ligada, se já respondeu e se a
 *   janela está aberta é o banco (qs_gloria_contexto, 0053), e quem pergunta é
 *   o n8n. Duplicar essa regra em dois lugares é como ela começa a divergir.
 *
 * • É `await`, e não fire-and-forget. Na Vercel a função pode ser congelada no
 *   instante em que responde: um fetch solto morreria pela metade em parte das
 *   execuções — o pior tipo de bug, o que só acontece às vezes. O workflow
 *   responde na hora (ele processa depois), então a espera é de milissegundos.
 *
 * • Falhar aqui NUNCA pode derrubar o webhook. n8n fora do ar significa lead
 *   sem resposta automática; erro propagado significa mensagem que não entra no
 *   QS. A segunda é muito pior.
 */
export async function avisarGloria({ lead, message, conversationId = null, telefone = null }) {
  const url = String(process.env.GLORIA_WEBHOOK_URL || '').trim();
  if (!url) return { ok: false, motivo: 'sem_url' };

  const texto = String(message?.content || '').trim();
  // Áudio/imagem sem texto: a IA não tem o que ler. Fica com o humano.
  if (!texto) return { ok: false, motivo: 'sem_texto' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3_000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gloria-secret': String(process.env.GLORIA_SECRET || '').trim(),
      },
      body: JSON.stringify({
        lead_id: lead?.id,
        telefone: telefone || lead?.phone || null,
        nome: lead?.first_name || lead?.full_name || null,
        mensagem: texto,
        conversation_id: conversationId,
        cw_message_id: message?.id ?? null,
        // O n8n usa este instante pra saber se, depois de esperar o lead
        // terminar de escrever, chegou mensagem mais nova que esta.
        // parseCwDate porque o Chatwoot manda epoch em SEGUNDOS: `new Date(x)`
        // cru daria 1970 e a comparação lá no banco perderia o sentido.
        sent_at: parseCwDate(message?.created_at),
      }),
      signal: ctrl.signal,
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    console.warn('[gloria] não consegui avisar o n8n:', e?.name === 'AbortError' ? 'timeout' : e?.message);
    return { ok: false, motivo: 'falha' };
  } finally {
    clearTimeout(timer);
  }
}

/** Lê o corpo tanto quando a Vercel já parseou quanto quando veio string. */
export function corpo(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}
