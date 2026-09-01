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

/** Permissão temporária da Meta dura 7 dias — é a janela que a doc publica. */
const DIAS_TEMPORARIA = 7;

export function soDigitos(telefone) {
  return String(telefone || '').replace(/\D/g, '');
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
 * A troca passa pelo `moverLeadParaCadencia`, que já carrega as travas: lead
 * ganho, com reunião marcada ou com atividade de cadência em aberto NÃO é
 * movido. Autorizar ligação não pode atropelar quem já está sendo trabalhado —
 * a graça é pescar quem estava parado.
 */
export async function moverParaCadenciaDePermissao(lead) {
  if (!lead?.id) return { movido: false, motivo: 'sem-lead' };
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

  // Import tardio de propósito: o `_leads.js` puxa meia dúzia de módulos, e o
  // caminho do webhook de chamada não pode pagar por isso quando ninguém
  // configurou a cadência.
  const { moverLeadParaCadencia } = await import('./_leads.js');
  return moverLeadParaCadencia(lead, cadenciaId);
}
