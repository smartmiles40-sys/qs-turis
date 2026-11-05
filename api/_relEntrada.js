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
import { chaveDoWamid } from './_relGruposPrivado.js';
import { motivoDaFalha, ehMidiaDoClienteQueNaoChegou } from './_waFalhas.js';

const STATUS_OK = new Set(['sent', 'delivered', 'read', 'failed']);

/**
 * A cópia da Evolution (wamid "evo:<id>", api/_relGruposPrivado.js) chegou antes
 * desta, da Meta? Então a linha já existe: a Meta "assume" (wamid oficial, pra
 * recibo/reação/citação funcionarem) e não grava de novo. Com a 0231 o próprio
 * rel_wa_ingest faz isso com trava; aqui é o mesmo sem depender dela.
 */
async function assumirCopiaDaEvolution({ wamid, status, origem, autorId, autorNome }) {
  const chave = chaveDoWamid(wamid);
  if (!chave || !String(wamid).startsWith('wamid.')) return null;
  const ja = (await rest(`rel_wa_mensagens?select=id,conversa_id,origem&wamid=eq.${encodeURIComponent(`evo:${chave}`)}&limit=1`))?.[0];
  if (!ja) return null;
  const body = { wamid: String(wamid) };
  if (status) body.status = status;
  if (origem === 'qs' || origem === 'automatica') Object.assign(body, { origem, autor_id: autorId, autor_nome: autorNome });
  await rest(`rel_wa_mensagens?id=eq.${ja.id}`, { method: 'PATCH', prefer: 'return=minimal', body });
  return { nova: false, conversa: ja.conversa_id };
}

const transitorio = (e) => e?.code === 'TIMEOUT' || (e?.status >= 500) || /fetch failed|ECONNRESET|socket/i.test(String(e?.message || ''));

/**
 * Grava uma mensagem. Devolve { nova, conversa, erro? } — nunca lança.
 * 30/10: tenta de novo quando o banco demora (em 29/10 quatro mensagens de
 * clientes se perderam num "PostgREST não respondeu em 10000ms") e devolve
 * `erro: true` pra quem chamou poder pedir à Meta que reenvie.
 */
export async function gravarRel({ phoneId, telefone, nome = null, wamid, direcao, origem, texto, anexos = [], enviadaEm = null, autorId = null, autorNome = null, status = null, respondendoA = null }) {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const assumida = await assumirCopiaDaEvolution({ wamid, status, origem, autorId, autorNome });
      if (assumida) return assumida;
      return await ingerir({ phoneId, telefone, nome, wamid, direcao, origem, texto, anexos, enviadaEm, autorId, autorNome, status, respondendoA }, tentativa);
    } catch (e) {
      console.error(`[rel-entrada] não gravei (tentativa ${tentativa}): ${e?.message}`);
      // erro de dado (não some com o tempo) não pede reenvio — a Meta repetiria pra sempre
      if (!transitorio(e)) return { nova: false, conversa: null, falhou: true };
      if (tentativa === 2) return { nova: false, conversa: null, erro: true };
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return { nova: false, conversa: null, erro: true };
}

async function ingerir({ phoneId, telefone, nome, wamid, direcao, origem, texto, anexos, enviadaEm, autorId, autorNome, status, respondendoA }, tentativa) {
    const r = await rest('rpc/rel_wa_ingest', {
      method: 'POST',
      // 2ª tentativa com mais folga: o insert é idempotente (wamid único)
      timeoutMs: tentativa > 1 ? 20_000 : 10_000,
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
  const conta = { recebidas: 0, ecos: 0, historico: 0, recibos: 0, pendentes: 0 };
  const value = ch?.value || {};
  const phoneId = numero.phone_number_id;
  const pasta = (fone) => `rel-${String(fone).replace(/\D/g, '')}`;

  // Reação (14/10): fica na bolha reagida. Emoji vazio = tirou a reação.
  async function reacao(m, de, nome) {
    const alvo = m?.reaction?.message_id;
    if (!alvo) return;
    await rest('rpc/rel_wa_reagir', {
      method: 'POST',
      body: { p_wamid: String(alvo), p_de: de, p_nome: nome, p_emoji: String(m.reaction.emoji ?? '') },
    }).catch((e) => console.warn('[rel-entrada] reação não gravada:', e?.message));
  }

  async function uma(m, { direcao, origem, telefone, nome, baixar }) {
    const lida = lerMensagemMeta(m);
    if (!lida?.id || !telefone) {
      if (m?.type && m.type !== 'reaction' && m.type !== 'request_welcome') console.warn(`[rel-entrada] mensagem sem id/telefone, tipo=${m.type} id=${m?.id}`);
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
      if (m.type === 'reaction') { await reacao(m, 'cliente', (nomes.get(telefone) || 'Cliente').split(' ')[0]); continue; }
      const r = await uma(m, { direcao: 'in', origem: 'cliente', telefone, nome: nomes.get(telefone) || null, baixar: true });
      if (r?.erro) conta.pendentes++;
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
      const aplicar = () => rest('rpc/rel_wa_status', { method: 'POST', body: { p_wamid: String(st.id), p_status: s } }).catch(() => false);
      let mudou = await aplicar();
      if (s === 'failed') {
        if (ehMidiaDoClienteQueNaoChegou(st) && mudou !== true) {
          // 05/11: vídeo de 150 MB do cliente sumia calado — vira aviso na conversa.
          if (st.recipient_id) {
            await gravarRel({
              phoneId, telefone: String(st.recipient_id), wamid: `falha-arquivo:${st.id}`, direcao: 'in', origem: 'cliente',
              texto: '⚠️ O cliente tentou mandar um arquivo que não chegou (grande demais, acima de 100 MB, ou expirou). Peça para mandar de novo, menor ou por link.',
              enviadaEm: Number(st.timestamp) > 0 ? new Date(Number(st.timestamp) * 1000).toISOString() : null,
            });
          }
          continue;
        }
        if (mudou !== true) { await new Promise((r) => setTimeout(r, 2000)); mudou = await aplicar(); }
        const erro = motivoDaFalha(st.errors);
        console.warn(`[rel-entrada] Meta recusou ${st.id}: ${erro}`);
        await rest('rpc/rel_wa_status_erro', { method: 'POST', body: { p_wamid: String(st.id), p_erro: erro } })
          .catch((e) => console.warn('[rel-entrada] motivo da falha não gravado (0313?):', e?.message));
      }
      if (mudou === true) conta.recibos++;
    }
  }

  if (ch.field === 'smb_message_echoes') {
    for (const m of value.message_echoes || []) {
      if (m.type === 'reaction') { await reacao(m, 'celular', 'Celular'); continue; }
      const r = await uma(m, { direcao: 'out', origem: 'celular', telefone: String(m.to || ''), nome: null, baixar: true });
      if (r?.erro) conta.pendentes++;
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
          if (r?.erro) conta.pendentes++;
          if (r?.nova) conta.historico++;
        }
      }
    }
  }
  return conta;
}
