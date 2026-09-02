// api/_permissaoLigacao.js
// -----------------------------------------------------------------------------
// "ESSE CLIENTE LIBEROU PRA GENTE LIGAR PRA ELE?"
//
// Toda a regra de permissão de ligação da Cloud API mora aqui. O resto do QS
// (webhook, botão, cadência) pergunta pra este arquivo — três cópias dessa regra
// virariam três respostas diferentes pro mesmo lead.
//
// -- POR QUE ISSO EXISTE ------------------------------------------------------
//
// Mandar mensagem e ligar são coisas diferentes na Meta. Mensagem depende da
// janela de 24h; LIGAÇÃO depende de a pessoa ter AUTORIZADO receber chamada do
// número da empresa. Sem autorização a Meta recusa com 138006 — e hoje o SDR só
// descobre isso depois de clicar, liberar o microfone e esperar. A tabela
// `qs_call_permissions` (0070) existe pra essa pergunta ser respondida ANTES.
//
// -- AS TRÊS FONTES, E POR QUE NENHUMA SOZINHA RESOLVE ------------------------
//
//   1. `resposta-do-cliente` (webhook `call_permission_reply`) — a mais precisa:
//      diz se foi "Permitir" (permanente) ou "Permitir por enquanto" (7 dias).
//      Chega no campo `messages`, NÃO no `calls`.
//   2. `ligacao-do-cliente` — quem liga pra empresa autoriza a volta
//      (`callback_permission_status: ENABLED`). A doc afirma isso mas não diz
//      por quanto tempo vale; gravamos 7 dias e `confirmado: false`.
//   3. `api` — o GET /call_permissions da Meta. Fonte da verdade, mas custa uma
//      ida à Graph API por lead: serve pra decidir UMA ligação, não pra varrer
//      fila.
//
// A divisão de trabalho que sai disso: as fontes 1 e 2 mantêm a fila e a
// cadência EM DIA de graça (chegam sozinhas, por webhook); a fonte 3 é a
// conferência do clique. É por isso que o botão pode ser otimista sem mentir.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { lerPermissaoDeLigacao } from './_meta.js';
import { generateCadenceTasks } from './_leads.js';
import { toE164BR } from './_wa.js';

/** Permissão temporária da Meta dura 7 dias — é a janela que a doc publica. */
const DIAS_TEMPORARIA = 7;

/**
 * A CHAVE DA TABELA — e ela precisa ser a MESMA dos dois lados.
 *
 * O webhook da Meta entrega `5511992221156`; o cadastro do lead pode estar
 * `11992221156` (11 de 2.935 leads estão assim). Sem normalizar, a autorização
 * chegaria gravada numa chave e a fila procuraria em outra: a permissão existiria
 * no banco e a tela juraria que não. Por isso o 55 entra AQUI, e não em cada
 * chamador.
 */
export function soDigitos(telefone) {
  const e164 = toE164BR(telefone);
  return e164 ? e164.replace(/\D/g, '') : '';
}

/**
 * A regra de "vale?" — a MESMA que a função `qs_permissao_vale` do banco.
 * Permanente sempre vale; temporária vale enquanto não expirou.
 */
export function permissaoVale(linha) {
  if (!linha) return false;
  if (linha.status === 'permanent') return true;
  if (linha.status !== 'temporary') return false;
  return !!linha.expira_em && new Date(linha.expira_em).getTime() > Date.now();
}

/**
 * Grava o que sabemos sobre um telefone. Upsert por `wa_id`.
 *
 * `lead_id` só é escrito quando vem preenchido: um webhook que não resolveu o
 * dono não pode APAGAR o dono que outra fonte já tinha descoberto.
 */
export async function gravarPermissao(waId, dados) {
  const wa = soDigitos(waId);
  if (!wa) return null;
  const linha = { wa_id: wa, atualizado_em: new Date().toISOString(), ...dados };
  if (linha.lead_id == null) delete linha.lead_id;
  try {
    await rest('qs_call_permissions?on_conflict=wa_id', {
      method: 'POST',
      body: linha,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    return linha;
  } catch (e) {
    console.error('[permissao] não gravou', wa.slice(-4), e?.message);
    return null;
  }
}

/** O que o banco já sabe. Sem ida à Meta. */
export async function lerPermissaoLocal(telefone) {
  const wa = soDigitos(telefone);
  if (!wa) return null;
  try {
    const r = await rest(`qs_call_permissions?wa_id=eq.${encodeURIComponent(wa)}&limit=1`);
    return (Array.isArray(r) && r[0]) || null;
  } catch (e) {
    console.warn('[permissao] não li', wa.slice(-4), e?.message);
    return null;
  }
}

/**
 * Pergunta PRA META e regrava. É esta que o botão de ligar usa no clique.
 *
 * Devolve `{ vale, podeLigar, status, expiraEm, ... }`. Em caso de erro da Meta
 * devolve `{ erro }` — e quem chamou decide: barrar seria transformar
 * instabilidade da Graph API em "ninguém liga hoje".
 */
export async function sincronizarPermissao(telefone, leadId = null) {
  const wa = soDigitos(telefone);
  if (!wa) return { erro: 'telefone-invalido' };

  const r = await lerPermissaoDeLigacao(wa);
  if (r?.erro) return r;

  const linha = {
    lead_id: leadId,
    status: r.status || 'no_permission',
    expira_em: r.expiraEm,
    pode_ligar: r.podeLigar,
    pode_pedir: r.podePedir,
    fonte: 'api',
    confirmado: true,
    cru: r.cru ?? null,
  };
  await gravarPermissao(wa, linha);

  return {
    ...r,
    vale: permissaoVale({ status: linha.status, expira_em: linha.expira_em }),
    // `podeLigar` null = a Meta não mandou a ação. Aí o `vale` é o que temos.
    liberado: r.podeLigar === null ? permissaoVale(linha) : r.podeLigar === true,
  };
}

/**
 * Lê a resposta do cliente ao pedido de permissão.
 *
 * Formato do webhook (campo `messages`, tipo interativo):
 *   { type: 'interactive',
 *     interactive: { type: 'call_permission_reply',
 *                    call_permission_reply: {
 *                      response: 'accept' | 'reject',
 *                      response_source: 'user_action',
 *                      expiration_timestamp: 1759836840,   ← temporária (7 dias)
 *                      is_permanent: true } } }            ← ou permanente
 *
 * Devolve null quando a mensagem não é uma resposta de permissão — o que é o
 * caso da esmagadora maioria delas.
 */
export function lerRespostaDePermissao(msg) {
  const interativo = msg?.interactive;
  if (!interativo || interativo.type !== 'call_permission_reply') return null;
  const r = interativo.call_permission_reply || {};
  const aceitou = String(r.response || '').toLowerCase() === 'accept';

  let status = 'no_permission';
  let expira = null;
  if (aceitou) {
    if (r.is_permanent === true) status = 'permanent';
    else {
      status = 'temporary';
      // Sem timestamp na resposta, os 7 dias da doc são o melhor palpite — e
      // errar pra menos é o lado seguro: o pior que acontece é o QS pedir
      // permissão de novo antes da hora.
      expira = r.expiration_timestamp
        ? new Date(Number(r.expiration_timestamp) * 1000).toISOString()
        : new Date(Date.now() + DIAS_TEMPORARIA * 86400_000).toISOString();
    }
  }

  return {
    de: soDigitos(msg.from),
    status,
    expira_em: expira,
    resposta: aceitou ? 'accept' : 'reject',
    respondido_em: msg.timestamp
      ? new Date(Number(msg.timestamp) * 1000).toISOString()
      : new Date().toISOString(),
    // A resposta do cliente é o próprio ato de autorizar: não há o que conferir.
    confirmado: true,
    fonte: 'resposta-do-cliente',
    cru: msg,
  };
}

/**
 * Permissão INFERIDA de o cliente ter ligado pra empresa.
 *
 * Com `callback_permission_status: ENABLED` — que é como o número está — quem
 * liga autoriza a volta. A doc não publica a validade, então usamos os 7 dias da
 * permissão temporária e marcamos `confirmado: false`: serve pra fila e pra
 * cadência pescarem a pessoa, e o clique confere na Meta antes de discar.
 */
export function permissaoPorLigacaoDoCliente(waId) {
  return {
    de: soDigitos(waId),
    status: 'temporary',
    expira_em: new Date(Date.now() + DIAS_TEMPORARIA * 86400_000).toISOString(),
    resposta: 'accept',
    respondido_em: new Date().toISOString(),
    confirmado: false,
    fonte: 'ligacao-do-cliente',
  };
}

/**
 * A CADÊNCIA DE QUEM LIBEROU.
 *
 * Chave `cadencia_permissao_ligacao` em qs_settings; sem ela, não faz nada — é
 * assim que a coisa nasce desligada e o Bruno escolhe a cadência na tela.
 *
 * As atividades dela são ACRESCENTADAS ao lead — ele não sai da cadência em que
 * está. É o desenho que o Bruno pediu em 02/09: tirar a ligação de WhatsApp da
 * cadência do SDR (onde poluía a métrica com atividade que quase ninguém pode
 * executar) e deixá-la nascer só quando o cliente autoriza.
 *
 * O IMPORT DO `_leads.js` É ESTÁTICO, e a escolha tem motivo. Ele era `await
 * import()` pra não pesar o caminho do webhook, mas a economia é ilusória: o
 * `_leads.js` só arrasta o `_bitrixLead.js` a mais (o `_supabaseAdmin` e o
 * `_wa` esta rota já carrega), e nenhum dos dois tem efeito colateral de
 * módulo. Em troca, o import dinâmico dependia de o rastreador de arquivos da
 * Vercel enxergar a string — e se não enxergasse, a cadência falharia com
 * MODULE_NOT_FOUND só no dia em que alguém ligasse a automação pela primeira
 * vez. Trocar centavos de cold start por uma falha que só aparece na estreia é
 * mau negócio.
 */
export async function moverParaCadenciaDePermissao(lead) {
  if (!lead?.id) return { movido: false, motivo: 'sem-lead' };
  // Cliente fechado não volta pra fila de prospecção, nem pra ligar.
  if (lead.status === 'ganho' || lead.status === 'perdido') {
    return { movido: false, motivo: `lead-${lead.status}` };
  }

  let cadenciaId = null;
  try {
    const r = await rest('qs_settings?select=value&key=eq.cadencia_permissao_ligacao&limit=1');
    const v = Array.isArray(r) && r[0] ? r[0].value : null;
    cadenciaId = typeof v === 'string' && v.length === 36 ? v : null;
  } catch (e) {
    console.warn('[permissao] não li a cadência configurada:', e?.message);
    return { movido: false, motivo: 'nao-consegui-ler-config' };
  }
  if (!cadenciaId) return { movido: false, motivo: 'cadencia-nao-configurada' };

  // ── ACRESCENTA, NÃO MOVE ──────────────────────────────────────────────────
  //
  // Era `moverLeadParaCadencia`, e estava errado pro que esta cadência é. Mover
  // troca o `cadence_id` do lead: ele SAI da cadência do SDR: o trabalho de
  // prospecção que estava em curso é abandonado porque o cliente aceitou uma
  // ligação. E as travas do "mover" recusam qualquer lead com atividade em
  // aberto — ou seja, justamente os que estão sendo trabalhados nunca
  // ganhariam a ligação. Os dois desfechos são ruins e opostos.
  //
  // A cadência de ligação é ADICIONAL: as atividades dela nascem por cima, o
  // lead continua na cadência de sempre, e a métrica do SDR não muda de dono.
  // `generateCadenceTasks` grava o `cadence_id` NA TAREFA sem tocar no lead —
  // é isso que torna as duas cadências capazes de conviver.
  //
  // O DONO É O DO LEAD: a atividade tem que cair na fila de quem já cuida dele.

  // Não duplica: um segundo `call_permission_reply` (a pessoa reabre o pedido,
  // a Meta reentrega o webhook) não pode gerar a mesma cadência de novo.
  try {
    const abertas = await rest(
      `qs_tasks?select=id&lead_id=eq.${encodeURIComponent(lead.id)}` +
      `&cadence_id=eq.${encodeURIComponent(cadenciaId)}&status=in.(pendente,atrasada)&limit=1`
    );
    if (Array.isArray(abertas) && abertas.length) {
      return { movido: false, motivo: 'ja-tem-a-cadencia-de-ligacao' };
    }
  } catch (e) {
    // Na dúvida NÃO gera: duplicar atividade na fila do SDR é pior que atrasar.
    console.warn('[permissao] não conferi as atividades existentes:', e?.message);
    return { movido: false, motivo: 'nao-consegui-conferir' };
  }

  try {
    const tarefas = await generateCadenceTasks({
      leadId: lead.id,
      cadenceId: cadenciaId,
      ownerId: lead.owner_id ?? null,
    });
    return { movido: tarefas > 0, tarefas, motivo: tarefas ? null : 'cadencia-sem-atividades' };
  } catch (e) {
    console.error('[permissao] cadência de ligação não gerou atividades:', e?.message);
    return { movido: false, motivo: 'falhou-ao-gerar' };
  }
}
