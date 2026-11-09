// api/_closerBitrixFamilia.js
// -----------------------------------------------------------------------------
// A FAMÍLIA DA VENDA NO BITRIX (0351, Bruno 09/11/2026)
//   "O card da família tem que ficar no Bitrix também! Assim fazemos
//    double-check de todas as pessoas que vão e não esquecemos ninguém."
//
// REGRA JÁ DECIDIDA (Dashboard, migration 20261001_id_pai_herda_fonte no outro
// Supabase): CADA CARD = 1 VENDA COM O PRÓPRIO VALOR; o card filho aponta pro
// pai em "Número do ID pai" (UF_CRM_1790891281841) e herda a origem/fonte dele.
// Por isso, com família:
//   • cada pessoa que não é o titular ganha um card FILHO (contato próprio,
//     mesma pipeline/coluna do pai, ID pai preenchido, OPPORTUNITY = valor dela,
//     título "Família Silva — Maria (filho(a))");
//   • o card PAI (o do lead) passa a levar SÓ o que não foi pros filhos
//     (total da venda − soma dos filhos) — senão o Dashboard conta em dobro.
//
// IDEMPOTENTE: o id do card filho fica em qs_venda_pessoas.bitrix_deal_id. Antes
// de criar, procura no Bitrix um filho que já aponte pro pai com o mesmo contato
// ou o mesmo título (o card pode ter nascido e o QS não ter gravado o id).
// Pessoa que SAIU da venda: o card NÃO é apagado — o QS escreve na timeline do
// filho e do pai e marca 'removida_avisada'.
//
// Duas camadas, como o _closerBitrixPlano.js:
//   • funções PURAS (montar payload, decidir o que fazer) — testadas sem rede;
//   • espelharFamilia(): a execução, com `bx`/`rest` injetáveis (o teste passa
//     um fetch de mentira).
// Quem chama: api/closer.js → espelhar() (o mesmo caminho do botão e do cron;
// o cron só roda com CLOSER_CRON_BITRIX_LIGADO=1 — trava de lá, não daqui).
// -----------------------------------------------------------------------------

import { CAMPO_TIPO_VENDA, ETAPAS_DE_VENDA, ETAPAS_ENCERRADAS, etapaParaColuna } from './_closerBitrixPlano.js';

export const CAMPO_ID_PAI = 'UF_CRM_1790891281841';      // "Número do ID pai" (texto) — negócio
export const CAMPO_DEAL_CPF = 'UF_CRM_1762288761917';    // CPF — negócio (api/rel-viagens.js)
export const CAMPO_DEAL_NASC = 'UF_CRM_1756148121396';   // Data de nascimento — negócio
export const CAMPO_CONTATO_CPF = 'UF_CRM_1749757426655'; // CPF — contato

export const ROTULO_VINCULO = {
  conjuge: 'cônjuge', filho: 'filho(a)', pai_mae: 'pai/mãe', irmao: 'irmão(ã)', amigo: 'amigo(a)', outro: 'acompanhante',
};
const CAMPOS_ORIGEM = ['SOURCE_ID', 'SOURCE_DESCRIPTION', 'UTM_SOURCE', 'UTM_MEDIUM', 'UTM_CAMPAIGN', 'UTM_CONTENT', 'UTM_TERM'];
const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'jr', 'jr.', 'junior', 'júnior', 'filho', 'neto', 'sobrinho']);

const centavos = (v) => Math.round(Number(v || 0) * 100) / 100;
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const limpa = (v) => String(v ?? '').trim();
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** "Ana Maria da Silva Filho" → "Silva" (o sobrenome de família, sem partícula/sufixo). */
export function sobrenome(nome) {
  const partes = limpa(nome).split(/\s+/).filter(Boolean);
  for (let i = partes.length - 1; i > 0; i--) {
    if (!PARTICULAS.has(partes[i].toLowerCase())) return partes[i];
  }
  return partes[0] || '';
}
export const primeiroNome = (nome) => limpa(nome).split(/\s+/)[0] || '';

/** "Família Silva — Maria (filho(a))" */
export function tituloFilho(titularNome, pessoa) {
  const fam = sobrenome(titularNome);
  const rot = ROTULO_VINCULO[pessoa?.vinculo] || 'acompanhante';
  return `${fam ? `Família ${fam}` : 'Família'} — ${primeiroNome(pessoa?.nome) || 'Acompanhante'} (${rot})`;
}

export const filhosAtivos = (pessoas) => (pessoas || []).filter((p) => !p.comprador && !p.removida_em);

/** Soma do que foi pros cards filhos (só quem está na venda e tem valor). */
export function somaDosFilhos(pessoas) {
  return centavos(filhosAtivos(pessoas).reduce((s, p) => s + (Number(p.valor) > 0 ? Number(p.valor) : 0), 0));
}

/**
 * O valor do card PAI: o total da venda menos o que foi pros filhos.
 * Sem filho com valor → null (o pai segue com o total, regra de antes).
 */
export function valorDoPai(totalVenda, pessoas) {
  const filhos = somaDosFilhos(pessoas);
  if (!(filhos > 0)) return null;
  return Math.max(centavos(Number(totalVenda || 0) - filhos), 0);
}

/** Contato do Bitrix pra pessoa (a ficha única é a fonte; o Bitrix só recebe). */
export function montarContato(pessoa, titularNome) {
  const p = pessoa?.cliente || pessoa || {};
  const fone = soDigitos(p.telefone);
  const cpf = soDigitos(p.cpf);
  const nasc = /^\d{4}-\d{2}-\d{2}/.test(String(p.nascimento || '')) ? String(p.nascimento).slice(0, 10) : null;
  return {
    NAME: limpa(p.nome) || 'Acompanhante',
    OPENED: 'Y',
    ...(fone ? { PHONE: [{ VALUE: fone, VALUE_TYPE: 'MOBILE' }] } : {}),
    ...(limpa(p.email) ? { EMAIL: [{ VALUE: limpa(p.email), VALUE_TYPE: 'HOME' }] } : {}),
    ...(nasc ? { BIRTHDATE: nasc } : {}),
    ...(cpf.length === 11 ? { [CAMPO_CONTATO_CPF]: cpf } : {}),
    COMMENTS: `Viaja com ${limpa(titularNome) || 'o titular'} (família da venda no QS).`,
  };
}

function comentarioDoFilho(pessoa, titularNome, dealPaiId) {
  const linhas = [
    `Card FILHO criado pelo QS: ${limpa(pessoa?.cliente?.nome) || 'acompanhante'} (${ROTULO_VINCULO[pessoa?.vinculo] || 'acompanhante'} de ${limpa(titularNome) || 'titular'}).`,
    `Negócio pai: ${dealPaiId}. Este card leva só o valor desta pessoa (${brl(pessoa?.valor)}).`,
  ];
  if (pessoa?.menor) linhas.push(`MENOR DE IDADE na viagem — responsável: ${limpa(pessoa?.responsavel_nome) || limpa(titularNome) || 'o titular'} (assina o contrato).`);
  linhas.push('A fonte dos dados é o QS (cartão do closer › Família / Quem vai).');
  return linhas.join('\n');
}

/**
 * O card filho como deve nascer.
 *   pessoa  = linha de qs_venda_pessoas com `cliente` (rel_clientes) e `responsavel_nome`
 *   dealPai = crm.deal.get do pai
 *   para    = { funil, coluna } (o mesmo destino do pai — planejarEspelho)
 */
export function montarDealFilho({ pessoa, titularNome, dealPai, para, contatoId }) {
  const c = pessoa?.cliente || {};
  const cpf = soDigitos(c.cpf);
  const nasc = /^\d{4}-\d{2}-\d{2}/.test(String(c.nascimento || '')) ? String(c.nascimento).slice(0, 10) : null;
  const fields = {
    TITLE: tituloFilho(titularNome, { ...pessoa, nome: c.nome }),
    CATEGORY_ID: Number(para.funil),
    STAGE_ID: String(para.coluna),
    TYPE_ID: dealPai?.TYPE_ID || 'SALE',
    OPPORTUNITY: centavos(pessoa?.valor),
    CURRENCY_ID: 'BRL',
    OPENED: 'Y',
    [CAMPO_ID_PAI]: String(dealPai?.ID ?? ''),
    COMMENTS: comentarioDoFilho(pessoa, titularNome, dealPai?.ID),
  };
  if (contatoId) fields.CONTACT_ID = String(contatoId);
  if (dealPai?.ASSIGNED_BY_ID) fields.ASSIGNED_BY_ID = dealPai.ASSIGNED_BY_ID;
  // Origem/fonte: o filho herda do pai (é a regra do Dashboard; aqui só deixa o card coerente).
  for (const k of CAMPOS_ORIGEM) if (limpa(dealPai?.[k])) fields[k] = dealPai[k];
  const tipo = dealPai?.[CAMPO_TIPO_VENDA];
  const tipoTxt = String(Array.isArray(tipo) ? tipo[0] ?? '' : tipo ?? '');
  if (tipoTxt) fields[CAMPO_TIPO_VENDA] = tipoTxt;
  if (cpf.length === 11) fields[CAMPO_DEAL_CPF] = cpf;
  if (nasc) fields[CAMPO_DEAL_NASC] = nasc;
  return fields;
}

/**
 * O que mudar num card filho que já existe (só o necessário — idempotente).
 * Etapa: acompanha o pai SÓ no mesmo funil; e o cron (porPessoa=false) não tira
 * da coluna um filho que alguém encerrou ou levou pra venda à mão.
 */
export function diffDealFilho({ atual, desejado, lista, porPessoa = false }) {
  const f = {};
  if (!atual) return f;
  if (limpa(atual.TITLE) !== limpa(desejado.TITLE)) f.TITLE = desejado.TITLE;
  if (Math.abs(Number(atual.OPPORTUNITY || 0) - Number(desejado.OPPORTUNITY || 0)) > 0.009) {
    f.OPPORTUNITY = desejado.OPPORTUNITY;
    f.CURRENCY_ID = 'BRL';
  }
  if (String(atual[CAMPO_ID_PAI] ?? '') !== String(desejado[CAMPO_ID_PAI])) f[CAMPO_ID_PAI] = desejado[CAMPO_ID_PAI];
  // CPF/nascimento: só preenche o vazio (quem corrigiu à mão no Bitrix não perde).
  for (const k of [CAMPO_DEAL_CPF, CAMPO_DEAL_NASC]) {
    if (desejado[k] && !limpa(Array.isArray(atual[k]) ? atual[k][0] : atual[k])) f[k] = desejado[k];
  }
  const mesmoFunil = String(atual.CATEGORY_ID ?? '0') === String(desejado.CATEGORY_ID);
  if (mesmoFunil && String(atual.STAGE_ID) !== String(desejado.STAGE_ID)) {
    const noBitrix = etapaParaColuna(lista, atual.STAGE_ID).etapa;
    const alvo = etapaParaColuna(lista, desejado.STAGE_ID).etapa;
    const filhoMexidoAMao = ETAPAS_ENCERRADAS.includes(noBitrix) || (ETAPAS_DE_VENDA.includes(noBitrix) && !ETAPAS_DE_VENDA.includes(alvo));
    if (porPessoa || !filhoMexidoAMao) f.STAGE_ID = desejado.STAGE_ID;
  }
  return f;
}

/** Acha, entre os filhos que já apontam pro pai no Bitrix, o card desta pessoa. */
export function acharFilhoExistente(existentes, pessoa, titulo) {
  const lista = existentes || [];
  const porId = pessoa?.bitrix_deal_id && lista.find((d) => String(d.ID) === String(pessoa.bitrix_deal_id));
  if (porId) return porId;
  const contato = pessoa?.bitrix_contato_id || pessoa?.cliente?.bitrix_contato_id;
  if (contato) {
    const porContato = lista.find((d) => String(d.CONTACT_ID ?? '') === String(contato));
    if (porContato) return porContato;
  }
  return lista.find((d) => limpa(d.TITLE) === limpa(titulo)) || null;
}

/**
 * O PLANO da família (sem rede): uma ação por pessoa.
 *   { tipo: 'criar' | 'atualizar' | 'igual' | 'avisar_removida' | 'nada', pessoa, dealId?, fields?, motivo? }
 */
export function planejarFamilia({ pessoas, titularNome, dealPai, para, lista, existentes = [], porPessoa = false }) {
  const acoes = [];
  for (const p of pessoas || []) {
    if (p.comprador) continue;
    const titulo = tituloFilho(titularNome, { ...p, nome: p?.cliente?.nome });
    const achado = acharFilhoExistente(existentes, p, titulo);
    if (p.removida_em) {
      const dealId = p.bitrix_deal_id || achado?.ID || null;
      if (dealId && p.bitrix_status !== 'removida_avisada') acoes.push({ tipo: 'avisar_removida', pessoa: p, dealId: String(dealId) });
      else acoes.push({ tipo: 'nada', pessoa: p, motivo: dealId ? 'já avisado' : 'saiu antes de ter card' });
      continue;
    }
    const desejado = montarDealFilho({ pessoa: p, titularNome, dealPai, para, contatoId: achado?.CONTACT_ID || null });
    if (!achado) { acoes.push({ tipo: 'criar', pessoa: p, fields: desejado }); continue; }
    const fields = diffDealFilho({ atual: achado, desejado, lista, porPessoa });
    acoes.push({ tipo: Object.keys(fields).length ? 'atualizar' : 'igual', pessoa: p, dealId: String(achado.ID), fields });
  }
  return acoes;
}

// ═════════════════════════════════════════════════════════════════════════════
// Execução (rede). `bx(metodo, params)` e `rest(path, opts)` injetáveis.
// ═════════════════════════════════════════════════════════════════════════════

const SELECT_PESSOAS = 'id,venda_id,cliente_id,comprador,vinculo,menor,valor,aereo_incluso,removida_em,' +
  'bitrix_deal_id,bitrix_contato_id,bitrix_status,' +
  'cliente:rel_clientes!qs_venda_pessoas_cliente_id_fkey(id,nome,telefone,email,cpf,nascimento,bitrix_contato_id),' +
  'responsavel:rel_clientes!qs_venda_pessoas_responsavel_cliente_id_fkey(nome)';

/** A venda do cartão + as pessoas (service_role). null = sem venda ou banco sem a 0351. */
export async function carregarFamilia(negocioId, { rest }) {
  const venda = (await rest(`qs_vendas?select=id,valor_total,cliente_id&negocio_id=eq.${negocioId}&limit=1`))?.[0];
  if (!venda) return null;
  let pessoas;
  try {
    pessoas = (await rest(`qs_venda_pessoas?select=${SELECT_PESSOAS}&venda_id=eq.${venda.id}&order=criado_em.asc`)) || [];
  } catch (e) {
    if (/qs_venda_pessoas/.test(String(e?.message || ''))) return null; // banco sem a 0351
    throw e;
  }
  for (const p of pessoas) p.responsavel_nome = p.responsavel?.nome || null;
  return { venda, pessoas };
}

async function acharOuCriarContato(pessoa, titularNome, { bx }) {
  const c = pessoa.cliente || {};
  const conhecido = pessoa.bitrix_contato_id || c.bitrix_contato_id;
  if (conhecido) return String(conhecido);
  const fone = soDigitos(c.telefone);
  if (fone.length >= 10) {
    const dup = await bx('crm.duplicate.findbycomm', { entity_type: 'CONTACT', type: 'PHONE', values: [fone, fone.replace(/^55/, '')] }).catch(() => null);
    if (Array.isArray(dup?.CONTACT) && dup.CONTACT[0]) return String(dup.CONTACT[0]);
  }
  if (limpa(c.email)) {
    const dup = await bx('crm.duplicate.findbycomm', { entity_type: 'CONTACT', type: 'EMAIL', values: [limpa(c.email)] }).catch(() => null);
    if (Array.isArray(dup?.CONTACT) && dup.CONTACT[0]) return String(dup.CONTACT[0]);
  }
  const id = await bx('crm.contact.add', { fields: montarContato(pessoa, titularNome), params: { REGISTER_SONET_EVENT: 'N' } });
  return id ? String(id) : null;
}

/**
 * Cria/atualiza os cards filhos do pai `dealPai` (já atualizado pelo espelhar).
 * Devolve { criados, atualizados, iguais, avisados, erros: [{nome, msg}], resumo }.
 * Nunca lança: erro de uma pessoa fica na linha dela (bitrix_status='erro').
 */
export async function espelharFamilia({ familia, titularNome, dealPai, para, lista, porPessoa = false }, { bx, rest, agora = () => new Date().toISOString() }) {
  const out = { criados: [], atualizados: 0, iguais: 0, avisados: 0, erros: [] };
  const pessoas = familia?.pessoas || [];
  if (!pessoas.some((p) => !p.comprador)) return out;

  // Filhos que já apontam pro pai (idempotência mesmo se o QS perdeu o id).
  let existentes = [];
  try {
    existentes = (await bx('crm.deal.list', {
      filter: { [CAMPO_ID_PAI]: String(dealPai.ID) },
      select: ['ID', 'TITLE', 'CONTACT_ID', 'CATEGORY_ID', 'STAGE_ID', 'OPPORTUNITY', CAMPO_ID_PAI, CAMPO_DEAL_CPF, CAMPO_DEAL_NASC],
    })) || [];
  } catch (e) {
    out.erros.push({ nome: 'família', msg: `não consegui listar os cards filhos (${e?.message || 'erro'})` });
    return out;
  }
  // Card filho que o QS conhece mas não veio na lista (alguém mudou o ID pai): lê direto.
  for (const p of pessoas) {
    if (p.bitrix_deal_id && !existentes.some((d) => String(d.ID) === String(p.bitrix_deal_id))) {
      const d = await bx('crm.deal.get', { id: Number(p.bitrix_deal_id) }).catch(() => null);
      if (d) existentes.push(d);
    }
  }

  const acoes = planejarFamilia({ pessoas, titularNome, dealPai, para, lista, existentes, porPessoa });
  const marcar = (p, campos) => rest(`qs_venda_pessoas?id=eq.${p.id}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { ...campos, bitrix_em: agora(), atualizado_em: agora() },
  }).catch((e) => console.warn('[closer-familia] marcar', p.id, e?.message));

  for (const a of acoes) {
    const p = a.pessoa;
    const nome = p.cliente?.nome || 'acompanhante';
    try {
      if (a.tipo === 'nada') continue;
      if (a.tipo === 'avisar_removida') {
        const quando = String(p.removida_em || agora()).slice(0, 10).split('-').reverse().join('/');
        await bx('crm.timeline.comment.add', { fields: { ENTITY_ID: Number(a.dealId), ENTITY_TYPE: 'deal',
          COMMENT: `⚠️ ${nome} SAIU da venda no QS em ${quando}. Este card NÃO foi apagado: confira com o closer e encerre/cancele à mão se for o caso.` } });
        await bx('crm.timeline.comment.add', { fields: { ENTITY_ID: Number(dealPai.ID), ENTITY_TYPE: 'deal',
          COMMENT: `⚠️ Família: ${nome} saiu da venda no QS em ${quando}. O card filho ${a.dealId} continua no Bitrix — confira.` } });
        await marcar(p, { bitrix_status: 'removida_avisada', bitrix_deal_id: a.dealId, bitrix_erro: null });
        out.avisados++;
        continue;
      }
      let dealId = a.dealId || null;
      let contatoId = null;
      if (a.tipo === 'criar') {
        contatoId = await acharOuCriarContato(p, titularNome, { bx });
        const fields = contatoId ? { ...a.fields, CONTACT_ID: contatoId } : a.fields;
        dealId = String(await bx('crm.deal.add', { fields, params: { REGISTER_SONET_EVENT: 'N' } }) || '');
        if (!dealId) throw new Error('o Bitrix não devolveu o id do card');
        out.criados.push({ nome, dealId, valor: Number(p.valor || 0), vinculo: p.vinculo });
        // A ficha guarda o contato (o próximo card desta pessoa reaproveita).
        if (contatoId && p.cliente?.id && !p.cliente?.bitrix_contato_id) {
          await rest(`rel_clientes?id=eq.${p.cliente.id}&bitrix_contato_id=is.null`, {
            method: 'PATCH', prefer: 'return=minimal', body: { bitrix_contato_id: contatoId },
          }).catch(() => null);
        }
      } else if (a.tipo === 'atualizar') {
        await bx('crm.deal.update', { id: Number(dealId), fields: a.fields, params: { REGISTER_SONET_EVENT: 'Y' } });
        out.atualizados++;
      } else {
        out.iguais++;
      }
      const existente = (existentes || []).find((d) => String(d.ID) === String(dealId));
      await marcar(p, {
        bitrix_status: 'ok', bitrix_erro: null, bitrix_deal_id: dealId,
        bitrix_contato_id: contatoId || existente?.CONTACT_ID || p.bitrix_contato_id || null,
      });
    } catch (e) {
      const msg = String(e?.message || 'falhou').slice(0, 300);
      out.erros.push({ nome, msg });
      await marcar(p, { bitrix_status: 'erro', bitrix_erro: msg, ...(a.dealId ? { bitrix_deal_id: a.dealId } : {}) });
    }
  }

  // O pai ganha um recado com a família quando nasce card filho novo.
  if (out.criados.length) {
    const linhas = out.criados.map((c) => `• ${c.nome} (${ROTULO_VINCULO[c.vinculo] || 'acompanhante'}) — card ${c.dealId} — ${brl(c.valor)}`);
    await bx('crm.timeline.comment.add', { fields: { ENTITY_ID: Number(dealPai.ID), ENTITY_TYPE: 'deal',
      COMMENT: `👨‍👩‍👧 Família no QS: ${filhosAtivos(pessoas).length + 1} pessoas nesta venda. Cards filhos criados agora:\n${linhas.join('\n')}\nEste card (pai) passa a levar só o valor do titular.` } }).catch(() => null);
  }
  return out;
}

/** Uma linha pro histórico do cartão / bitrix_erro. */
export function resumoDaFamilia(r) {
  if (!r) return '';
  const partes = [];
  if (r.criados?.length) partes.push(`${r.criados.length} card(s) filho(s) criado(s)`);
  if (r.atualizados) partes.push(`${r.atualizados} atualizado(s)`);
  if (r.avisados) partes.push(`${r.avisados} saída(s) avisada(s)`);
  if (r.erros?.length) partes.push(`falhou: ${r.erros.map((e) => `${e.nome} (${e.msg})`).join('; ')}`);
  return partes.length ? `Família: ${partes.join(', ')}.` : '';
}
