// api/_closerEspelho.js
// -----------------------------------------------------------------------------
// O ESPELHO DO CARTÃO DO CLOSER NO BITRIX — a execução (sprint final do
// "Subir venda", 11/11/2026). Saiu de api/closer.js pra dar pra testar com
// `bx`/`rest` de mentira; o closer.js só injeta as dependências de verdade.
//
// ORDEM (furo da revisão de 10/11): FILHOS → PAI.
//   1. lê o cartão, o card do lead e a FAMÍLIA (qs_vendas + qs_venda_pessoas).
//      Falhou ao ler a família → status 'erro' com mensagem, e NADA vai pro
//      Bitrix (antes virava null calado e o pai ia com o valor cheio = dobra).
//   2. planeja o pai (planejarEspelho) só pra saber a coluna de destino.
//   3. cria/atualiza os cards FILHOS na MESMA coluna (todos juntos — negociação,
//      pré-venda, ganho, perdido, cancelada).
//   4. SÓ ENTÃO grava o pai, descontando apenas os filhos que EXISTEM no Bitrix
//      (filho que falhou ao nascer não é descontado → a soma nunca passa do total).
//
// ESTADO DA VENDA (qs_vendas.estado, 0356):
//   • reservada  → conta como venda: o card vai pra "Em emissão" (como a
//                  pré-venda da 0207), mesmo se o cartão não marcou pre_venda_em.
//   • consolidada→ venda; 'pre-venda' devolve ok "já consolidada" sem mexer.
//   • cancelada  → tira da coluna de venda (volta pra etapa aberta do cartão ou
//                  vai pra "Cancelamento" se o cartão estava em venda), recado na
//                  timeline do pai e de cada filho (uma vez — marca no histórico).
// -----------------------------------------------------------------------------

import { CAMPO_MOTIVO_DESISTENCIA, CAMPO_MOTIVO_PERDA, CAMPO_TIPO_VENDA, ETAPAS_DE_VENDA, FUNIL_COMERCIAL, FUNIL_PRE_VENDAS, NOME_ETAPA, planejarEspelho } from './_closerBitrixPlano.js';
import { carregarFamilia, carregarVenda, espelharFamilia, filhosAtivos, resumoDaFamilia, somaDosFilhos, textoVendaCancelada } from './_closerBitrixFamilia.js';

const SERVICO = {
  expedicao: 'Expedição', pacote: 'Pacote', aereo: 'Aéreo', hospedagem: 'Hospedagem', passeio: 'Passeio',
  cruzeiro: 'Cruzeiro', seguro: 'Seguro', concierge: 'Concierge', conta_liminar: 'Conta liminar', outro: 'Outro',
};
const FORMA = { pix: 'Pix', boleto: 'Boleto', cartao: 'Cartão', link: 'Link de pagamento', transferencia: 'Transferência', dinheiro: 'Dinheiro', outro: 'Outra' };
export const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

/** Marca do histórico que diz "o cancelamento já foi avisado no Bitrix" (idempotência do cron). */
export const MARCA_CANCELADA = 'VENDA CANCELADA avisada no Bitrix';

export function resumoDaFicha(f, parcelas) {
  const linhas = [
    '✅ VENDA CONSOLIDADA no QS (o QS é a fonte da verdade desta venda).',
    `Serviço: ${SERVICO[f?.servico] || f?.servico || '—'}${f?.destino ? ` — ${f.destino}` : ''}`,
    `Datas: ${dataBr(f?.data_ida)} → ${dataBr(f?.data_volta)} · Passageiros: ${f?.qtd_passageiros || '—'}`,
    `Valor total: ${brl(f?.valor_total)}`,
  ];
  if (parcelas.length) {
    linhas.push('Plano de pagamento:');
    for (const p of parcelas) {
      linhas.push(`• ${p.numero === 0 ? 'Entrada' : `Parcela ${p.numero}`}: ${brl(p.valor)} — vence ${dataBr(p.vencimento)} — ${FORMA[p.forma] || p.forma}${p.recorrente ? ' (recorrente)' : ''}`);
    }
  }
  return linhas.join('\n');
}

/**
 * O cartão como o Bitrix deve vê-lo, levando em conta qs_vendas.estado. Puro.
 *   reservada  → pré-venda (coluna de venda + valor da venda), se ainda não consolidou.
 *   cancelada  → sem pré-venda; cartão em etapa de venda vira 'venda_cancelada'.
 *   consolidada (cartão em 'aguardando_emissao') → 'venda_realizada' (WON) — 12/11.
 *   negociacao/sem estado → o cartão como está.
 */
export function cartaoComEstadoDaVenda(n, venda) {
  const estado = venda?.estado || null;
  const total = Number(venda?.valor_total || 0);
  if (estado === 'reservada' && !n.consolidada_em) {
    return {
      ...n,
      pre_venda_em: n.pre_venda_em || venda.reservada_em || new Date(0).toISOString(),
      pre_venda_valor: total > 0 ? total : n.pre_venda_valor,
    };
  }
  if (estado === 'cancelada') {
    return {
      ...n,
      pre_venda_em: null, pre_venda_valor: null,
      etapa: ETAPAS_DE_VENDA.includes(n.etapa) ? 'venda_cancelada' : n.etapa,
      // 12/11: o motivo do cancelamento da venda vai pro campo do Bitrix quando o cartão não tem um.
      motivo_perda: n.motivo_perda || venda.cancelada_motivo || null,
    };
  }
  // Mapa do Bruno (12/11): reservou → "Em emissão / Pix Expedição"; CONSOLIDOU → "Venda realizada".
  // O closer_consolidar deixa o cartão do QS em 'aguardando_emissao' (o Ops ainda emite);
  // no Bitrix a venda consolidada já é Venda realizada — pai e filhos da família.
  if ((estado === 'consolidada' || (n.consolidada_em && estado !== 'cancelada')) && n.etapa === 'aguardando_emissao') {
    return { ...n, etapa: 'venda_realizada' };
  }
  return n;
}

/** A venda já está consolidada? (estado da 0356 ou a marca antiga do cartão) */
export const vendaConsolidada = (n, venda) => venda?.estado === 'consolidada' || (Boolean(n?.consolidada_em) && venda?.estado !== 'cancelada');

/**
 * O responsável do cartão foi trocado no QS (0365: closer_trocado_em) depois do
 * último envio? Então o card do Bitrix também muda de dono (ASSIGNED_BY_ID).
 * Sem a marca (banco sem a 0365) ou já enviado depois da troca → não mexe no dono.
 */
export function responsavelPendente(n) {
  const troca = Date.parse(n?.closer_trocado_em || '');
  if (!Number.isFinite(troca) || !n?.closer_id) return false;
  const enviado = Date.parse(n?.bitrix_enviado_em || '');
  return !Number.isFinite(enviado) || troca > enviado;
}

/**
 * Manda a etapa (e o valor) do cartão pro Bitrix — pai e filhos.
 *   u     = quem pediu (null = o cron)
 *   extra = { seco?, preVenda?, comentario?(n, valor) }
 *   deps  = { rest, bx, atualizarNegocioComFunil, comentarNoNegocio, colunasDoFunil, podeMexer, responsavelNoBitrix? }
 * Devolve { status, body } (o handler responde com isso).
 */
export async function espelharCartao(negocioId, u, extra = {}, deps) {
  const { rest, bx, atualizarNegocioComFunil, comentarNoNegocio, colunasDoFunil, podeMexer, responsavelNoBitrix } = deps;
  const marcar = async (campos, evento) => {
    await rest(`qs_closer_negocios?id=eq.${negocioId}`, { method: 'PATCH', body: campos, prefer: 'return=minimal' });
    if (evento) {
      await rest('qs_closer_negocio_eventos', {
        method: 'POST', prefer: 'return=minimal',
        body: { negocio_id: negocioId, tipo: 'bitrix', texto: evento, autor_id: u?.id || null },
      }).catch(() => null);
    }
  };

  // select=*: as colunas da 0207 (pre_venda_*, bitrix_resumo_em) entram quando existirem.
  const n = (await rest(`qs_closer_negocios?select=*&id=eq.${negocioId}&limit=1`))?.[0];
  if (!n) return { status: 404, body: { error: 'Cartão não encontrado.' } };
  if (u && !podeMexer(u, n)) return { status: 403, body: { error: 'Sem permissão neste cartão.' } };
  if (n.arquivado_em) return { status: 409, body: { error: 'O cartão está no arquivo.' } };

  // "Reservar vaga" numa venda que já foi consolidada: nada a fazer, e não é erro
  // (editar venda consolidada não deve travar a tela com "já consolidada").
  if (extra.preVenda) {
    let venda = null;
    try { venda = await carregarVenda(n.id, { rest }); } catch { venda = null; }
    if (vendaConsolidada(n, venda)) {
      return { status: 200, body: { ok: true, status: 'ok', jaConsolidada: true, mensagem: 'Esta venda já está consolidada: a vaga já está garantida e o Bitrix já conta a venda.' } };
    }
  }

  const lead = (await rest(`qs_leads?select=id,bitrix_id&id=eq.${n.lead_id}&limit=1`))?.[0];
  const dealId = String(lead?.bitrix_id || '').replace(/\D/g, '');
  if (!dealId) {
    if (extra.seco) return { status: 200, body: { seco: true, ok: false, motivo: 'O lead não tem negócio no Bitrix.' } };
    await marcar({ bitrix_status: 'sem_card', bitrix_erro: 'O lead não tem negócio no Bitrix.' });
    return { status: 200, body: { ok: false, status: 'sem_card', mensagem: 'Este cliente não tem card no Bitrix — ficou só no QS.' } };
  }

  try {
    // 1) A família ANTES de qualquer escrita. Erro aqui = erro do cartão (nada enviado).
    let familia;
    try {
      familia = await carregarFamilia(n.id, { rest });
    } catch (e) {
      const msg = `Não consegui ler a família desta venda (${String(e?.message || 'erro').slice(0, 200)}). Nada foi enviado ao Bitrix, pra o card do titular não ficar com o valor errado. Tente "Reenviar ao Bitrix".`;
      if (extra.seco) return { status: 200, body: { seco: true, ok: false, dealId, motivo: msg } };
      throw new Error(msg);
    }
    const venda = familia?.venda || null;
    const nEf = cartaoComEstadoDaVenda(n, venda);

    const deal = await bx('crm.deal.get', { id: Number(dealId) }, 8_000);
    if (!deal) throw new Error(`Negócio ${dealId} não encontrado no Bitrix.`);
    const lista = await colunasDoFunil(deal.CATEGORY_ID);
    // Card ainda na Pré-Vendas: o plano leva pro Comercial 1 (precisa das colunas de lá).
    const listaComercial = String(deal.CATEGORY_ID ?? '0') === FUNIL_PRE_VENDAS ? await colunasDoFunil(FUNIL_COMERCIAL) : null;
    const porPessoa = Boolean(u);
    // 12/11: responsável trocado no QS → o id dele no Bitrix (casado por e-mail).
    // Sem par no Bitrix: não trava o resto do envio; fica anotado no histórico.
    let responsavel = null;
    let semParNoBitrix = false;
    if (responsavelNoBitrix && responsavelPendente(n)) {
      responsavel = await responsavelNoBitrix(n.closer_id).catch(() => null);
      semParNoBitrix = !responsavel;
    }
    const temFilhos = Boolean(familia?.pessoas?.some((p) => !p.comprador));

    // Modo CONFERIR (03/11): devolve o que seria enviado e não escreve nada.
    if (extra.seco) {
      const plano = planejarEspelho({ n: nEf, deal, lista, listaComercial, porPessoa, vendaCancelada: venda?.estado === 'cancelada', valorFilhos: somaDosFilhos(familia?.pessoas), responsavel });
      const filhos = filhosAtivos(familia?.pessoas);
      return { status: 200, body: { seco: true, dealId, ...plano, estadoVenda: venda?.estado || null, familia: familia ? {
        pessoas: (familia.pessoas || []).filter((p) => !p.removida_em).length,
        filhos: filhos.length, semCard: filhos.filter((p) => !p.bitrix_deal_id).length,
        saidasSemAviso: (familia.pessoas || []).filter((p) => p.bitrix_status === 'removida').length,
      } : null } };
    }

    // 2) Destino do pai (o valor ainda não importa: só a coluna).
    const destino = planejarEspelho({ n: nEf, deal, lista, listaComercial, porPessoa, vendaCancelada: venda?.estado === 'cancelada', valorFilhos: 0, responsavel });
    if (!destino.ok) throw new Error(destino.motivo);

    // Venda cancelada ainda não avisada? (uma vez só — a marca fica no histórico do cartão)
    let cancelada = null;
    if (venda?.estado === 'cancelada') {
      const desde = venda.cancelada_em ? `&criado_em=gte.${encodeURIComponent(venda.cancelada_em)}` : '';
      const ja = (await rest(`qs_closer_negocio_eventos?select=id&negocio_id=eq.${n.id}&tipo=eq.bitrix&texto=like.${encodeURIComponent(`*${MARCA_CANCELADA}*`)}${desde}&limit=1`).catch(() => null)) || [];
      if (!ja.length) cancelada = { quando: venda.cancelada_em || new Date().toISOString(), motivo: venda.cancelada_motivo || null };
    }

    // 3) FILHOS primeiro, na mesma coluna do pai.
    let fam = null;
    if (temFilhos) {
      const titularNome = familia.pessoas.find((p) => p.comprador)?.cliente?.nome || deal.TITLE || '';
      const listaDoPai = String(destino.para.funil) === String(deal.CATEGORY_ID ?? '0') ? lista : listaComercial || lista;
      // O filho herda do pai o que o pai vai receber agora (ex.: "Tipo de venda" da pré-venda).
      const { OPPORTUNITY: _o, CURRENCY_ID: _c, STAGE_ID: _s, CATEGORY_ID: _f, ...herda } = destino.fields;
      fam = await espelharFamilia(
        { familia, titularNome, dealPai: { ...deal, ...herda, ID: dealId }, para: destino.para, lista: listaDoPai, porPessoa, cancelada },
        { bx, rest },
      );
    }

    // 4) Só agora o PAI: desconta apenas os filhos que existem no Bitrix.
    const plano = fam
      ? planejarEspelho({ n: nEf, deal, lista, listaComercial, porPessoa, vendaCancelada: venda?.estado === 'cancelada', valorFilhos: fam.valorNoBitrix, responsavel })
      : destino;
    const { fields, etapaAlvo, preVenda, valor } = plano;
    if (Object.keys(fields).length) {
      // atualizarNegocioComFunil: card ainda na Pré-Vendas troca de funil pelo
      // crm.item.update (o crm.deal.update ignora CATEGORY_ID calado — 04/11).
      await atualizarNegocioComFunil(dealId, fields, 8_000);
    }
    const marcas = { bitrix_status: 'ok', bitrix_erro: null, bitrix_etapa: etapaAlvo, bitrix_enviado_em: new Date().toISOString() };
    // Venda fechada pela ficha: o resumo vai pra timeline do negócio uma vez por consolidação.
    const temMarcaResumo = Object.prototype.hasOwnProperty.call(n, 'bitrix_resumo_em');
    const falta = temMarcaResumo
      ? !n.bitrix_resumo_em || new Date(n.bitrix_resumo_em) < new Date(n.consolidada_em)
      : !ETAPAS_DE_VENDA.includes(n.bitrix_etapa || '');
    if (n.consolidada_em && venda?.estado !== 'cancelada' && ETAPAS_DE_VENDA.includes(n.etapa) && falta) {
      const parcelas = (await rest(`fin_planos?select=fin_parcelas(numero,valor,vencimento,forma,recorrente)&negocio_id=eq.${n.id}&limit=1`).catch(() => null))?.[0]?.fin_parcelas || [];
      parcelas.sort((a, b) => a.numero - b.numero);
      await comentarNoNegocio(dealId, resumoDaFicha(n.ficha, parcelas));
      if (temMarcaResumo) marcas.bitrix_resumo_em = new Date().toISOString();
    }
    // 12/11: o motivo acabou de ir pro campo → o texto inteiro que o closer escreveu vai pra timeline (uma vez).
    if (fields[CAMPO_MOTIVO_PERDA] || fields[CAMPO_MOTIVO_DESISTENCIA]) {
      await Promise.resolve(comentarNoNegocio(dealId, `${etapaAlvo === 'venda_cancelada' ? '⛔ Venda cancelada' : '❌ Perdido'} no QS. Motivo escrito pelo closer: ${String(nEf.motivo_perda || '').slice(0, 500)}`)).catch(() => null);
    }
    // Pré-venda marcada/desfeita pelo botão: um recado na timeline do negócio.
    if (extra.comentario && fields.STAGE_ID && !cancelada) await comentarNoNegocio(dealId, extra.comentario(nEf, valor)).catch(() => null);
    // Venda cancelada: recado no pai (os filhos já receberam no passo 3).
    let avisouCancelada = false;
    if (cancelada) {
      avisouCancelada = Boolean(await Promise.resolve(comentarNoNegocio(dealId, textoVendaCancelada({ papel: 'pai', quando: cancelada.quando, motivo: cancelada.motivo }))).catch(() => null));
    }

    const notaFamilia = resumoDaFamilia(fam);
    const partesPai = Object.keys(fields).length ? `Bitrix atualizado (negócio ${dealId}): ${[
      fields.STAGE_ID ? `coluna "${preVenda ? 'venda (pré-venda)' : NOME_ETAPA[etapaAlvo] || etapaAlvo}"` : '',
      fields.OPPORTUNITY !== undefined ? `valor ${brl(valor)}${plano.valorFilhos > 0 ? ` (titular; ${brl(plano.valorFilhos)} nos cards da família)` : ''}` : '',
      fields[CAMPO_TIPO_VENDA] ? 'tipo de venda' : '',
      fields[CAMPO_MOTIVO_PERDA] || fields[CAMPO_MOTIVO_DESISTENCIA] ? 'motivo' : '',
      fields.ASSIGNED_BY_ID ? 'responsável' : '',
    ].filter(Boolean).join(' + ')}.` : '';
    const avisoDono = semParNoBitrix ? 'O responsável novo não tem usuário no Bitrix com o mesmo e-mail: o dono do card lá não mudou.' : '';
    const nota = [partesPai, notaFamilia, avisouCancelada ? `${MARCA_CANCELADA}.` : '', avisoDono].filter(Boolean).join(' ') || null;
    if (fam?.erros?.length) {
      Object.assign(marcas, {
        bitrix_status: 'erro',
        bitrix_erro: `O card do titular foi atualizado (descontando só os cards da família que existem), mas ${notaFamilia}`.slice(0, 500),
      });
    }
    await marcar(marcas, nota);
    if (fam?.erros?.length) return { status: 200, body: { ok: false, status: 'erro', mensagem: marcas.bitrix_erro, dealId, familia: fam } };
    return { status: 200, body: { ok: true, status: 'ok', mudou: Object.keys(fields), dealId, familia: fam, estadoVenda: venda?.estado || null } };
  } catch (e) {
    const msg = String(e?.message || 'Falhou').slice(0, 500);
    console.error('[closer] espelhar', n.id, msg);
    // O cron tenta de novo a cada rodada: só registra o evento quando é uma pessoa.
    await marcar({ bitrix_status: 'erro', bitrix_erro: msg }, u ? `Bitrix recusou: ${msg}` : null).catch(() => null);
    return { status: 200, body: { ok: false, status: 'erro', mensagem: msg } };
  }
}
