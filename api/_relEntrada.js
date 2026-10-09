// api/_relEntrada.js
// -----------------------------------------------------------------------------
// WHATSAPP DO RELACIONAMENTO — a entrada (Fase 2, 0101, 09/10/2026).
//
// A Meta entrega TODOS os números no mesmo /api/wa-calls. O _metaEntrada olha o
// setor do número e, quando é 'relacionamento', manda pra cá. Aqui a mensagem
// vira conversa do pós-venda (rel_wa_conversas / rel_wa_mensagens), ligada à
// ficha do cliente pelo telefone — e NUNCA vira lead do Comercial.
//
//   messages            → o cliente escreveu (+ recibos ✓ ✓✓)
//   smb_message_echoes  → alguém do time respondeu pelo celular (Coexistência)
//   history             → o histórico do celular, uma vez, ao conectar
//
// O prazo de resposta (SLA) é todo do banco (rel_wa_ingest): entrada abre a
// espera, saída fecha e registra quanto tempo útil o cliente esperou.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { enviarTexto } from './_meta.js';
import { lerMensagemMeta, baixarMidiaMeta } from './_metaEntrada.js';
import { rotuloDaMidia } from './_waMidia.js';
import { ehPedidoDeParada } from './_waOptout.js';

const STATUS_OK = new Set(['sent', 'delivered', 'read', 'failed']);

/** Grava uma mensagem. Devolve { nova, conversa } — nunca lança. */
export async function gravarRel({ phoneId, telefone, nome = null, wamid, direcao, origem, texto, anexos = [], enviadaEm = null, autorId = null, autorNome = null, status = null, respondendoA = null }) {
  try {
    const r = await rest('rpc/rel_wa_ingest', {
      method: 'POST',
      body: {
        p_phone_id: String(phoneId),
        p_telefone: String(telefone || ''),
        p_nome: nome,
        p_wamid: String(wamid || ''),
        p_direcao: direcao,
        p_origem: origem,
        p_texto: texto || '',
        p_anexos: anexos,
        p_enviada_em: enviadaEm || new Date().toISOString(),
        p_autor: autorId,
        p_autor_nome: autorNome,
        p_status: status,
        p_resp: respondendoA,
      },
    });
    return { nova: r?.nova === true, conversa: r?.conversa || null };
  } catch (e) {
    console.error('[rel-entrada] não gravei:', e?.message);
    return { nova: false, conversa: null };
  }
}

// ── "Fora do horário" ───────────────────────────────────────────────────────
// Mensagem automática quando o cliente escreve fora do horário de atendimento.
// Nasce DESLIGADA (rel_config.fora_horario.ativo). No máximo uma a cada 12h por
// conversa — cliente que manda 5 mensagens seguidas recebe um aviso, não cinco.

let cacheForaHorario = { em: 0, v: null };
async function configForaHorario() {
  if (Date.now() - cacheForaHorario.em < 60_000) return cacheForaHorario.v;
  let v = null;
  try {
    const r = await rest('rel_config?select=valor&chave=eq.fora_horario&limit=1');
    v = r?.[0]?.valor || null;
  } catch { /* na dúvida, não manda */ }
  cacheForaHorario = { em: Date.now(), v };
  return v;
}

async function talvezAvisarForaDoHorario({ phoneId, telefone, conversaId }) {
  const cfg = await configForaHorario();
  const texto = String(cfg?.texto || '').trim();
  if (!cfg?.ativo || !texto) return;
  try {
    const dentro = await rest('rpc/rel_dentro_do_horario', { method: 'POST', body: {} });
    if (dentro === true) return;
    const c = (await rest(`rel_wa_conversas?select=auto_resposta_em&id=eq.${encodeURIComponent(conversaId)}&limit=1`))?.[0];
    if (c?.auto_resposta_em && Date.now() - new Date(c.auto_resposta_em).getTime() < 12 * 3600_000) return;
    const env = await enviarTexto({ para: telefone, texto, phoneId });
    if (!env?.wamid) {
      console.warn('[rel-entrada] fora do horário não enviada:', env?.detalhe || env?.erro);
      return;
    }
    await gravarRel({
      phoneId, telefone, wamid: env.wamid, direcao: 'out', origem: 'automatica',
      texto, autorNome: 'Mensagem automática', status: 'sent',
    });
  } catch (e) {
    console.warn('[rel-entrada] fora do horário falhou:', e?.message);
  }
}

// ── "PARAR" (Fase 4, 0105) ──────────────────────────────────────────────────
// Cliente que pede pra sair não recebe mais DISPARO (campanha nem automação).
// Fica gravado na conversa (sempre) e na ficha ligada a ela (se houver) — a
// conversa cobre quem ainda não tem ficha; quando a ficha for criada com o
// mesmo telefone, o disparo confere as duas. Atendimento normal continua: se o
// cliente escrever de novo, o time responde.
async function registrarOptoutRel(conversaId) {
  try {
    const agora = new Date().toISOString();
    const c = (await rest(`rel_wa_conversas?select=cliente_id,optout_em&id=eq.${encodeURIComponent(conversaId)}&limit=1`))?.[0];
    if (!c) return;
    if (!c.optout_em) {
      await rest(`rel_wa_conversas?id=eq.${encodeURIComponent(conversaId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { optout_em: agora } });
    }
    if (c.cliente_id) {
      await rest(`rel_clientes?id=eq.${encodeURIComponent(c.cliente_id)}&optout_em=is.null`, { method: 'PATCH', prefer: 'return=minimal', body: { optout_em: agora } });
    }
    console.log(`[rel-entrada] conversa ${conversaId} pediu para não receber disparos`);
  } catch (e) {
    console.warn('[rel-entrada] optout não gravado:', e?.message);
  }
}

// ── O webhook ───────────────────────────────────────────────────────────────

/**
 * Uma `change` do webhook cujo número é do Relacionamento. Nunca lança pra
 * cima por mensagem individual: uma ruim não pode derrubar as outras.
 */
export async function processarRelacionamento(ch, numero, nomes) {
  const conta = { recebidas: 0, ecos: 0, historico: 0, recibos: 0 };
  const value = ch?.value || {};
  const phoneId = numero.phone_number_id;
  const pasta = (fone) => `rel-${String(fone).replace(/\D/g, '')}`;

  async function uma(m, { direcao, origem, telefone, nome, baixar }) {
    const lida = lerMensagemMeta(m);
    if (!lida?.id || !telefone) {
      if (m?.type && m.type !== 'reaction') console.log(`[rel-entrada] tipo ignorado: ${m.type}`);
      return null;
    }
    const anexos = baixar ? await baixarMidiaMeta(lida.midia, pasta(telefone), phoneId) : [];
    const texto = lida.texto || (lida.midia && !anexos.length ? rotuloDaMidia(lida.midia.tipo) : '');
    return gravarRel({
      phoneId, telefone, nome, wamid: lida.id, direcao, origem, texto, anexos,
      enviadaEm: lida.enviadaEm, respondendoA: lida.respondendoA,
      autorNome: origem === 'celular' ? 'Celular do Relacionamento' : null,
      status: direcao === 'out' ? 'sent' : null,
    });
  }

  if (ch.field === 'messages') {
    for (const m of value.messages || []) {
      const telefone = String(m.from || '');
      const r = await uma(m, { direcao: 'in', origem: 'cliente', telefone, nome: nomes.get(telefone) || null, baixar: true });
      if (r?.nova) {
        conta.recebidas++;
        // "PARAR" antes de qualquer resposta automática.
        if (r.conversa && ehPedidoDeParada(lerMensagemMeta(m)?.texto || '')) await registrarOptoutRel(r.conversa);
        if (r.conversa) await talvezAvisarForaDoHorario({ phoneId, telefone, conversaId: r.conversa });
      }
    }
    for (const st of value.statuses || []) {
      const s = String(st.status || '').toLowerCase();
      if (!STATUS_OK.has(s) || !st.id) continue;
      const mudou = await rest('rpc/rel_wa_status', { method: 'POST', body: { p_wamid: String(st.id), p_status: s } }).catch(() => false);
      if (mudou === true) conta.recibos++;
      if (s === 'failed') console.warn(`[rel-entrada] Meta recusou ${st.id}: ${JSON.stringify(st.errors || []).slice(0, 300)}`);
    }
  }

  if (ch.field === 'smb_message_echoes') {
    for (const m of value.message_echoes || []) {
      const r = await uma(m, { direcao: 'out', origem: 'celular', telefone: String(m.to || ''), nome: null, baixar: true });
      if (r?.nova) conta.ecos++;
    }
  }

  if (ch.field === 'history') {
    for (const bloco of value.history || []) {
      for (const th of bloco.threads || []) {
        const cliente = String(th.id || '');
        for (const m of th.messages || []) {
          const daEmpresa = String(m.from || '') !== cliente;
          const r = await uma(m, { direcao: daEmpresa ? 'out' : 'in', origem: 'historico', telefone: cliente, nome: null, baixar: false });
          if (r?.nova) conta.historico++;
        }
      }
    }
  }
  return conta;
}
