// api/closer.js
// -----------------------------------------------------------------------------
// ÁREA DO CLOSER (0174–0176, 22/10/2026) — o que precisa de servidor.
//
//   POST { acao: 'espelhar', negocioId }
//        → a ETAPA do cartão (qualquer uma, 0205) e o valor vão pro Bitrix:
//          crm.deal.update do negócio do lead (qs_leads.bitrix_id), na coluna
//          de MESMO NOME do funil em que o card está. "Tudo vai ser feito
//          dentro do QS e depois vai pro Bitrix" (Bruno, 26/10).
//   GET  ?acao=cron-bitrix (Vercel Cron, Bearer CRON_SECRET, a cada 10 min)
//        → reenvia os cartões com bitrix_status = 'pendente' (a reunião move
//          o cartão no banco; é o cron que leva isso pro Bitrix) e, 1x por
//          hora cada, os que ficaram em 'erro'. Nunca tira uma venda do Bitrix.
//   GET  ?acao=conferir-bitrix[&escopo=todos] (Bearer CRON_SECRET) ou
//   POST { acao: 'conferir-bitrix', escopo? } (gestão do Comercial)
//        → MODO CONFERIR (03/11): lista o que o cron mandaria (de → pra onde,
//          ou por que não mexe), SEM escrever nada no Bitrix nem no QS.
//          Script: scripts/closer-bitrix-conferir.mjs. Regras e mapeamento
//          etapa → coluna: api/_closerBitrixPlano.js.
//   POST { acao: 'config' } → { contrato, bitrix }: só sim/não, pra tela
//        esconder o que não está ligado na Vercel.
//   POST { acao: 'importar', dealId, closerId? }
//        → traz pro quadro um cliente que já tinha card no Bitrix.
//   POST { acao: 'pre-venda', negocioId }  (0207)
//        → depois da RPC closer_pre_venda: em pré-venda, o negócio vai pra
//          coluna de venda ("Em emissão") com "Tipo de venda" e valor — é o que
//          o Dashboard conta; desfeita, volta pra coluna da etapa do cartão.
//
// IDEMPOTENTE: lê o card antes; se valor e etapa já batem, não regrava nada.
// O resumo da ficha vai pra timeline uma vez, quando o cartão entra na venda.
// Mover o card no Bitrix dispara os robôs daquela coluna, como se fosse à mão.
//
// FALHOU? O erro fica no cartão (qs_closer_negocios.bitrix_status = 'erro' +
// bitrix_erro) e a tela mostra o botão "Reenviar ao Bitrix". A venda no QS já
// está gravada — o Bitrix é só o espelho.
//
// Env: BITRIX_WEBHOOK_BASE (a mesma do resto do QS), SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY.
//
// CONTRATO (0180, 22/10 — "tudo via código, sem n8n"; 27/10 — sem Google: o
// modelo mora em api/_contratoModelo.js; ver docs/CONTRATO.md):
//   POST { acao: 'contrato-config' }               → o que está pronto / o que falta
//   POST { acao: 'contrato-config-salvar', valor } → (gestão) assinante da agência
//   POST { acao: 'zapsign-testar' }                → (gestão) confere o ZAPSIGN_API_TOKEN
//   POST { acao: 'contrato-previa', negocioId }    → campos sugeridos + de onde vieram
//   POST { acao: 'contrato-pdf-teste', campos, negocioId?, previa? } → o PDF como vai sair (base64), sem enviar
//   POST { acao: 'contrato-enviar', negocioId, campos, substituir?, previa? }
//        (com o cartão, o que o closer corrigiu da pessoa volta pro rel_clientes — gravarNoCadastro)
//        → gera o PDF no QS, guarda no Storage, cria no ZapSign, grava o envio
//   POST { acao: 'contrato-pdf-link', contratoId, qual } → link de 10 min do PDF (gerado|assinado)
//   POST { acao: 'contrato-atualizar', contratoId }→ relê o documento no ZapSign
//   POST { acao: 'contrato-cancelar', contratoId, motivo } → apaga no ZapSign + cancela
//   POST ?acao=zapsign-webhook                     → o ZapSign avisa (header X-QS-Secret ou &s=)
// Envs: ZAPSIGN_API_TOKEN, ZAPSIGN_WEBHOOK_SECRET; opcionais QS_URL_PUBLICA e
// ZAPSIGN_API_URL (sandbox).
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { bx, bitrixConfigurado, comentarNoNegocio, atualizarNegocioComFunil } from './_bitrixLead.js';
import { getSupabaseUserId } from './_wa.js';
import {
  CAMPO_TIPO_VENDA, ETAPAS_DE_VENDA, FUNIL_COMERCIAL, FUNIL_PRE_VENDAS, NOME_ETAPA, emPreVenda, etapaParaColuna, planejarEspelho,
} from './_closerBitrixPlano.js';
import {
  apagarNoZapsign, arquivarAssinado, criarNoZapsign, gerarPdf, gravarNoCadastro, guardarPdf, hashDoCorpo, lerConfig, lerNoZapsign,
  linkDoPdf, montarPrevia, nomesDoArquivo, normalizarCampos, oQueFalta, statusDoDocumento, testarZapsign, urlDoApp,
  validarCampos,
} from './_contrato.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICO = {
  expedicao: 'Expedição', pacote: 'Pacote', aereo: 'Aéreo', hospedagem: 'Hospedagem', passeio: 'Passeio',
  cruzeiro: 'Cruzeiro', seguro: 'Seguro', concierge: 'Concierge', conta_liminar: 'Conta liminar', outro: 'Outro',
};
const FORMA = { pix: 'Pix', boleto: 'Boleto', cartao: 'Cartão', link: 'Link de pagamento', transferencia: 'Transferência', dinheiro: 'Dinheiro', outro: 'Outra' };

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

async function quemChama(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !UUID_RE.test(id)) return null;
  const u = (await rest(`qs_users?select=id,name,role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  return u?.is_active ? u : null;
}

/** Mesma regra do banco (closer_pode_mexer): gestor do Comercial/admin, ou o closer dono. */
function podeMexer(u, negocio) {
  if (u.role === 'admin') return true;
  if (u.role === 'gestor' && Array.isArray(u.setores) && u.setores.includes('comercial')) return true;
  return u.role === 'closer' && negocio.closer_id === u.id;
}

function resumoDaFicha(f, parcelas) {
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

async function marcar(negocioId, campos, evento, autorId) {
  await rest(`qs_closer_negocios?id=eq.${negocioId}`, { method: 'PATCH', body: campos, prefer: 'return=minimal' });
  if (evento) {
    await rest('qs_closer_negocio_eventos', {
      method: 'POST', prefer: 'return=minimal',
      body: { negocio_id: negocioId, tipo: 'bitrix', texto: evento, autor_id: autorId || null },
    }).catch(() => null);
  }
}

// ── Pipeline v2 (0205, 26/10): toda etapa do QS vai pro Bitrix ─────────────
// O QS manda. A DECISÃO (qual coluna, quando não mexer) mora em
// ./_closerBitrixPlano.js (03/11), com o mapeamento etapa → coluna conferido
// no portal. Os ids das colunas vêm do próprio funil (crm.status.list), 10 min.
const cacheFunis = new Map();
async function colunasDoFunil(categoria) {
  const cat = String(categoria ?? '0');
  const c = cacheFunis.get(cat);
  if (c && Date.now() - c.em < 600_000) return c.lista;
  const lista = (await bx('crm.status.list', { filter: { ENTITY_ID: cat === '0' ? 'DEAL_STAGE' : `DEAL_STAGE_${cat}` } }, 8_000)) || [];
  cacheFunis.set(cat, { em: Date.now(), lista });
  return lista;
}

// ── Pré-venda (0207, 27/10): "clicar na venda e já subir no Dashboard" ──────
// O cartão fica na etapa dele no QS; o BITRIX vai pra coluna de venda do funil
// (no Comercial 1 é "Em Emissão / Pix Expedição", UC_70BW8E — a coluna que o
// Dashboard conta como venda). Desfeita, o Bitrix volta pra etapa do cartão.

/** Manda a etapa (e o valor) do cartão pro Bitrix. `u` = quem pediu; null = o cron. */
async function espelhar(negocioId, u, extra = {}) {
  // select=*: as colunas da 0207 (pre_venda_*, bitrix_resumo_em) entram quando existirem.
  const n = (await rest(`qs_closer_negocios?select=*&id=eq.${negocioId}&limit=1`))?.[0];
  if (!n) return { status: 404, body: { error: 'Cartão não encontrado.' } };
  if (u && !podeMexer(u, n)) return { status: 403, body: { error: 'Sem permissão neste cartão.' } };
  if (n.arquivado_em) return { status: 409, body: { error: 'O cartão está no arquivo.' } };

  const lead = (await rest(`qs_leads?select=id,bitrix_id&id=eq.${n.lead_id}&limit=1`))?.[0];
  const dealId = String(lead?.bitrix_id || '').replace(/\D/g, '');
  if (!dealId) {
    if (extra.seco) return { status: 200, body: { seco: true, ok: false, motivo: 'O lead não tem negócio no Bitrix.' } };
    await marcar(n.id, { bitrix_status: 'sem_card', bitrix_erro: 'O lead não tem negócio no Bitrix.' });
    return { status: 200, body: { ok: false, status: 'sem_card', mensagem: 'Este cliente não tem card no Bitrix — ficou só no QS.' } };
  }

  try {
    const deal = await bx('crm.deal.get', { id: Number(dealId) }, 8_000);
    if (!deal) throw new Error(`Negócio ${dealId} não encontrado no Bitrix.`);
    const lista = await colunasDoFunil(deal.CATEGORY_ID);
    // Card ainda na Pré-Vendas: o plano leva pro Comercial 1 (precisa das colunas de lá).
    const listaComercial = String(deal.CATEGORY_ID ?? '0') === FUNIL_PRE_VENDAS ? await colunasDoFunil(FUNIL_COMERCIAL) : null;
    const plano = planejarEspelho({ n, deal, lista, listaComercial, porPessoa: Boolean(u) });
    // Modo CONFERIR (03/11): devolve o que seria enviado e não escreve nada.
    if (extra.seco) return { status: 200, body: { seco: true, dealId, ...plano } };
    if (!plano.ok) throw new Error(plano.motivo);
    const { fields, etapaAlvo, preVenda, valor } = plano;
    if (Object.keys(fields).length) {
      // atualizarNegocioComFunil: card ainda na Pré-Vendas troca de funil pelo
      // crm.item.update (o crm.deal.update ignora CATEGORY_ID calado — 04/11).
      await atualizarNegocioComFunil(dealId, fields, 8_000);
    }
    const marcas = { bitrix_status: 'ok', bitrix_erro: null, bitrix_etapa: etapaAlvo, bitrix_enviado_em: new Date().toISOString() };
    // Venda fechada pela ficha: o resumo vai pra timeline do negócio uma vez por
    // consolidação. Com a 0207 a marca é bitrix_resumo_em (com a pré-venda o
    // card já está na coluna de venda quando a ficha chega); sem ela, a regra antiga.
    const temMarcaResumo = Object.prototype.hasOwnProperty.call(n, 'bitrix_resumo_em');
    const falta = temMarcaResumo
      ? !n.bitrix_resumo_em || new Date(n.bitrix_resumo_em) < new Date(n.consolidada_em)
      : !ETAPAS_DE_VENDA.includes(n.bitrix_etapa || '');
    if (n.consolidada_em && ETAPAS_DE_VENDA.includes(n.etapa) && falta) {
      const parcelas = (await rest(`fin_planos?select=fin_parcelas(numero,valor,vencimento,forma,recorrente)&negocio_id=eq.${n.id}&limit=1`).catch(() => null))?.[0]?.fin_parcelas || [];
      parcelas.sort((a, b) => a.numero - b.numero);
      await comentarNoNegocio(dealId, resumoDaFicha(n.ficha, parcelas));
      if (temMarcaResumo) marcas.bitrix_resumo_em = new Date().toISOString();
    }
    // Pré-venda marcada/desfeita pelo botão: um recado na timeline do negócio.
    if (extra.comentario && fields.STAGE_ID) await comentarNoNegocio(dealId, extra.comentario(n, valor)).catch(() => null);
    const nota = Object.keys(fields).length
      ? `Bitrix atualizado (negócio ${dealId}): ${[
        fields.STAGE_ID ? `coluna "${preVenda ? 'venda (pré-venda)' : NOME_ETAPA[etapaAlvo]}"` : '',
        fields.OPPORTUNITY ? `valor ${brl(valor)}` : '',
        fields[CAMPO_TIPO_VENDA] ? 'tipo de venda' : '',
      ].filter(Boolean).join(' + ')}.`
      : null;
    await marcar(n.id, marcas, nota, u?.id);
    return { status: 200, body: { ok: true, status: 'ok', mudou: Object.keys(fields), dealId } };
  } catch (e) {
    const msg = String(e?.message || 'Falhou').slice(0, 500);
    console.error('[closer] espelhar', n.id, msg);
    // O cron tenta de novo a cada rodada: só registra o evento se a mensagem mudou.
    await marcar(n.id, { bitrix_status: 'erro', bitrix_erro: msg }, u ? `Bitrix recusou: ${msg}` : null, u?.id).catch(() => null);
    return { status: 200, body: { ok: false, status: 'erro', mensagem: msg } };
  }
}

/**
 * Cron: leva pro Bitrix os cartões que mudaram de etapa (inclusive os que a
 * reunião moveu). 27/10: também tenta de novo os que deram ERRO — no máximo
 * uma vez por hora cada (o espelhar regrava o cartão, e o atualizado_em anda),
 * pra ninguém precisar clicar em "Reenviar". Para antes de 45 s pra não
 * estourar a função; o que sobrar vai na rodada seguinte (10 min).
 *
 * 09/11: também os 'sem_card' cujo lead JÁ TEM bitrix_id. O espelhar marca
 * sem_card quando o lead ainda não tinha negócio; o card chega depois (adoção
 * pelo lead-inbound, vínculo manual) e ninguém tentava de novo. Não vira laço:
 * com o bitrix_id presente o espelhar sai em 'ok' ou 'erro', nunca em sem_card.
 */
const CRON_LOTE = 25;
export async function cronBitrix() {
  const umaHora = new Date(Date.now() - 60 * 60_000).toISOString();
  const pend = (await rest(`qs_closer_negocios?select=id&bitrix_status=eq.pendente&arquivado_em=is.null&order=atualizado_em.asc&limit=${CRON_LOTE}`)) || [];
  const erros = pend.length >= CRON_LOTE ? [] : (await rest(`qs_closer_negocios?select=id&bitrix_status=eq.erro&arquivado_em=is.null&atualizado_em=lt.${umaHora}&order=atualizado_em.asc&limit=${CRON_LOTE - pend.length}`).catch(() => null)) || [];
  const resta = CRON_LOTE - pend.length - erros.length;
  const semCard = resta <= 0 ? [] : ((await rest(
    'qs_closer_negocios?select=id,lead:qs_leads!inner(bitrix_id)&bitrix_status=eq.sem_card&arquivado_em=is.null' +
    `&lead.bitrix_id=not.is.null&order=atualizado_em.asc&limit=${resta}`
  ).catch(() => null)) || []).filter((c) => String(c.lead?.bitrix_id || '').replace(/\D/g, ''));
  const inicio = Date.now();
  let ok = 0, falhou = 0, sobrou = 0;
  for (const p of [...pend, ...erros, ...semCard]) {
    if (Date.now() - inicio > 45_000) { sobrou++; continue; }
    const r = await espelhar(p.id, null).catch(() => null);
    if (r?.body?.ok) ok++; else falhou++;
  }
  return { pendentes: pend.length, erros: erros.length, sem_card_com_bitrix: semCard.length, ok, falhou, sobrou };
}

/**
 * CONFERIR (03/11): o que o cron mandaria pro Bitrix, SEM mandar. Lê cada card
 * (crm.deal.get) e devolve de onde → pra onde, ou por que não mexeria.
 * escopo 'fila' (padrão) = pendentes + erro + sem_card; 'todos' = todo cartão aberto.
 */
async function conferirBitrix(escopo = 'fila') {
  const filtro = escopo === 'todos' ? 'bitrix_status=in.(pendente,erro,ok,sem_card)' : 'bitrix_status=in.(pendente,erro,sem_card)';
  const cartoes = (await rest(`qs_closer_negocios?select=id,etapa,bitrix_status,lead:qs_leads(full_name,bitrix_id),closer:qs_users!qs_closer_negocios_closer_id_fkey(name)&${filtro}&arquivado_em=is.null&order=atualizado_em.asc&limit=150`)) || [];
  const inicio = Date.now();
  const itens = [];
  let naoConferidos = 0;
  for (const c of cartoes) {
    if (Date.now() - inicio > 45_000) { naoConferidos++; continue; }
    const r = await espelhar(c.id, null, { seco: true }).catch((e) => ({ body: { ok: false, motivo: e?.message || 'falhou ao ler o Bitrix' } }));
    const b = r?.body || {};
    itens.push({
      negocioId: c.id, cliente: c.lead?.full_name || null, closer: c.closer?.name || null, dealId: b.dealId || c.lead?.bitrix_id || null,
      etapaQs: c.etapa, statusQs: c.bitrix_status, envia: Boolean(b.ok && Object.keys(b.fields || {}).length),
      ok: Boolean(b.ok), motivo: b.motivo || b.mensagem || null, de: b.de || null, para: b.para || null, campos: b.fields || {},
    });
  }
  const resumo = {
    conferidos: itens.length, naoConferidos,
    enviaria: itens.filter((i) => i.envia).length,
    jaIgual: itens.filter((i) => i.ok && !i.envia).length,
    bloqueados: itens.filter((i) => !i.ok).length,
  };
  return { seco: true, escopo, resumo, itens };
}

/** O que está ligado no servidor (só sim/não, nunca os valores) — a tela esconde o resto. */
async function configDaArea() {
  const bitrix = bitrixConfigurado();
  let contrato = false;
  try { contrato = (await situacaoDaConfig()).falta.length === 0; } catch { contrato = false; }
  return { contrato, bitrix };
}

/**
 * Traz pro quadro um cliente que JÁ EXISTE no Bitrix, pelo ID do negócio.
 * Já há lead do QS com esse bitrix_id → reaproveita (e o cartão do arquivo, se houver).
 * Não há → cria o lead já com o closer como dono: assim não entra na distribuição
 * dos SDRs nem conta como lead novo no Monitor. A etapa segue a coluna do Bitrix.
 */
async function importarDoBitrix(u, body) {
  const dealId = String(body.dealId || '').replace(/\D/g, '');
  if (!dealId) return { status: 400, body: { error: 'Informe o ID do negócio no Bitrix (só os números).' } };
  const closerId = u.role === 'closer' ? u.id : (UUID_RE.test(String(body.closerId || '')) ? String(body.closerId) : u.id);

  const deal = await bx('crm.deal.get', { id: Number(dealId) }, 8_000).catch(() => null);
  if (!deal) return { status: 404, body: { error: `Não achei o negócio ${dealId} no Bitrix.` } };

  let lead = (await rest(`qs_leads?select=id,full_name&bitrix_id=eq.${dealId}&limit=1`))?.[0];
  if (!lead) {
    const c = deal.CONTACT_ID ? await bx('crm.contact.get', { id: Number(deal.CONTACT_ID) }, 8_000).catch(() => null) : null;
    const nome = [c?.NAME, c?.SECOND_NAME, c?.LAST_NAME].filter(Boolean).join(' ').trim() || String(deal.TITLE || `Negócio ${dealId}`);
    const criado = await rest('qs_leads', {
      method: 'POST', prefer: 'return=representation',
      body: {
        full_name: nome,
        phone: c?.PHONE?.[0]?.VALUE || null,
        email: c?.EMAIL?.[0]?.VALUE || null,
        bitrix_id: dealId,
        owner_id: closerId,
        segment: 'Bitrix (trazido pelo closer)',
      },
    });
    lead = Array.isArray(criado) ? criado[0] : criado;
    if (!lead?.id) return { status: 500, body: { error: 'Não consegui criar o cliente no QS.' } };
    // Não é lead novo de marketing: sai do Monitor de distribuição.
    await rest(`qs_lead_entradas?lead_id=eq.${lead.id}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => null);
  }

  const nid = await rest('rpc/closer_negocio_trazer', {
    method: 'POST',
    body: { p_lead: lead.id, p_closer: closerId, p_texto: `Trazido do Bitrix (negócio ${dealId}).`, p_valor: Number(deal.OPPORTUNITY || 0) || null },
  });
  const negocioId = Array.isArray(nid) ? nid[0] : nid;
  if (!UUID_RE.test(String(negocioId || ''))) return { status: 500, body: { error: 'Não consegui abrir o cartão.' } };

  // Coluna de venda/cancelamento no Bitrix exige a ficha de fechamento no QS,
  // então nesses casos o cartão entra em Em negociação.
  const lista = await colunasDoFunil(deal.CATEGORY_ID).catch(() => []);
  const { etapa, nome: coluna } = etapaParaColuna(lista, deal.STAGE_ID);
  const PERMITIDAS = ['aguardando_reuniao', 'reagendamento', 'em_cotacao', 'em_negociacao', 'no_show', 'oportunidade_futura'];
  const destino = PERMITIDAS.includes(etapa) ? etapa : 'em_negociacao';
  // bitrix_etapa = destino: o gatilho não marca "pendente" e nada volta pro Bitrix.
  await rest(`qs_closer_negocios?id=eq.${negocioId}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: { etapa: destino, bitrix_etapa: destino, bitrix_status: 'ok', bitrix_erro: null },
  });
  await rest('qs_closer_negocio_eventos', {
    method: 'POST', prefer: 'return=minimal',
    body: {
      negocio_id: negocioId, tipo: 'bitrix', autor_id: u.id,
      texto: `No Bitrix o negócio estava em "${coluna}".${PERMITIDAS.includes(etapa) ? '' : ' Entrou em Em negociação: pra fechar a venda, preencha a ficha de fechamento.'}`,
    },
  }).catch(() => null);
  // 0334: se o cliente já estava com OUTRO closer ativo, o cartão continua com ele — a tela avisa.
  const dono = (await rest(`qs_closer_negocios?select=closer_id,closer:qs_users!qs_closer_negocios_closer_id_fkey(name)&id=eq.${negocioId}&limit=1`).catch(() => []))?.[0];
  const comOutro = Boolean(dono?.closer_id && dono.closer_id !== closerId);
  return { status: 200, body: { ok: true, negocioId, leadId: lead.id, etapa: destino, cliente: lead.full_name, com: dono?.closer?.name || null, comOutro } };
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// ═════════════════════════════════════════════════════════════════════════════
// CONTRATO
// ═════════════════════════════════════════════════════════════════════════════
const ehGestao = (u) => u.role === 'admin' || (u.role === 'gestor' && Array.isArray(u.setores) && u.setores.includes('comercial'));
const env = (k) => String(process.env[k] || '').trim();

async function carregarNegocio(id) {
  return (await rest(`qs_closer_negocios?select=id,lead_id,closer_id,etapa,ficha,valor_previsto,viagem_id,status_contrato&id=eq.${id}&limit=1`))?.[0] || null;
}

/** O ÚNICO caminho que muda status (só pra frente, idempotente) — 0180. */
async function registrarStatus(contratoId, status, extra = {}, autorId = null) {
  return rest('rpc/contrato_registrar_status', {
    method: 'POST',
    body: { p_contrato: contratoId, p_status: status, p_extra: extra, p_autor: autorId },
  });
}

async function situacaoDaConfig() {
  const cfg = await lerConfig();
  return { cfg, falta: oQueFalta(cfg) };
}

async function configParaTela(req, u) {
  const { cfg, falta } = await situacaoDaConfig();
  return {
    podeConfigurar: ehGestao(u),
    modo: falta.length ? 'manual' : 'automatico',
    falta,
    config: cfg,
    zapsign: {
      token: Boolean(env('ZAPSIGN_API_TOKEN')),
      webhookSecret: Boolean(env('ZAPSIGN_WEBHOOK_SECRET')),
      sandbox: /sandbox/i.test(env('ZAPSIGN_API_URL')),
    },
    // O segredo vai na própria URL (&s=…): o painel do ZapSign não deixa pôr header.
    webhookUrl: `${urlDoApp(req)}/api/closer?acao=zapsign-webhook&s=<ZAPSIGN_WEBHOOK_SECRET>`,
  };
}

async function contratoAtivo(negocioId) {
  return (await rest(`qs_contratos?select=id,status,modo,zapsign_token&negocio_id=eq.${negocioId}&status=in.(enviado,visualizado,assinado)&order=criado_em.desc&limit=1`).catch(() => null))?.[0] || null;
}

/** A prévia que a tela recebeu ({campos, origem}): diz o que o closer EDITOU (write-back). */
function previaDoCorpo(body) {
  const p = body?.previa;
  if (!p || typeof p !== 'object' || !p.campos || typeof p.campos !== 'object') return null;
  return { campos: p.campos, origem: p.origem && typeof p.origem === 'object' ? p.origem : {} };
}

async function enviarContrato(u, body) {
  const id = String(body.negocioId || '');
  if (!UUID_RE.test(id)) return { status: 400, body: { error: 'Cartão inválido.' } };
  const n = await carregarNegocio(id);
  if (!n) return { status: 404, body: { error: 'Cartão não encontrado.' } };
  if (!podeMexer(u, n)) return { status: 403, body: { error: 'Sem permissão neste cartão.' } };
  if (n.etapa === 'perdido') return { status: 409, body: { error: 'O cartão está como perdido.' } };

  const { cfg, falta } = await situacaoDaConfig();
  if (falta.length) return { status: 409, body: { error: 'O envio automático ainda não está configurado.', falta } };

  const c = normalizarCampos(body.campos);
  const { erros } = validarCampos(c);
  if (erros.length) return { status: 400, body: { error: `Falta preencher: ${erros.join(' ')}`, erros } };

  const ativo = await contratoAtivo(n.id);
  if (ativo && !body.substituir) {
    return { status: 409, body: { error: ativo.status === 'assinado' ? 'Este cliente já assinou um contrato.' : 'Já tem um contrato enviado aguardando assinatura.', precisaConfirmar: true, statusAtual: ativo.status } };
  }

  // "gerando" esquecido (função que estourou o tempo) vira erro e libera o cartão.
  const tresMin = new Date(Date.now() - 3 * 60_000).toISOString();
  await rest(`qs_contratos?negocio_id=eq.${n.id}&status=eq.gerando&criado_em=lt.${tresMin}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'erro', erro: 'Tempo esgotado ao gerar.' },
  }).catch(() => null);

  // O que o closer corrigiu (CPF, nascimento, RG, endereço, e-mail) volta pro
  // cadastro único — antes de gerar, pra valer mesmo se o ZapSign falhar.
  const cadastro = await gravarNoCadastro({ negocio: n, campos: c, previa: previaDoCorpo(body), userId: u.id });

  const lead = (await rest(`qs_leads?select=bitrix_id&id=eq.${n.lead_id}&limit=1`))?.[0];
  const dealId = String(lead?.bitrix_id || '').replace(/\D/g, '') || null;
  let linha;
  try {
    linha = (await rest('qs_contratos', {
      method: 'POST', prefer: 'return=representation',
      body: { negocio_id: n.id, lead_id: n.lead_id, tipo: c.tipo, modo: 'automatico', status: 'gerando', campos: c, bitrix_deal_id: dealId, enviado_por: u.id },
    }))?.[0];
  } catch (e) {
    if (e.status === 409) return { status: 409, body: { error: 'Já tem um contrato sendo gerado pra este cartão. Espere um pouco.' } };
    throw e;
  }

  const nomes = nomesDoArquivo(c, dealId, n.id);
  let guardado = null;
  try {
    const pdf = await gerarPdf(c);
    // Cópia do que foi enviado no Storage. Se o Storage falhar, segue: o ZapSign guarda o original.
    try {
      guardado = await guardarPdf(`${n.id}/${linha.id}.pdf`, pdf);
      await rest(`qs_contratos?id=eq.${linha.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { drive_pdf_id: guardado, drive_pdf_url: guardado } });
    } catch (e) {
      console.warn('[closer] PDF não guardado no Storage', linha.id, e?.message);
    }
    const zs = await criarNoZapsign({ c, cfg, nomes, pdf, negocioId: n.id });
    if (!zs.token) throw new Error('O ZapSign não devolveu o documento.');
    await rest(`qs_contratos?id=eq.${linha.id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { zapsign_token: zs.token, zapsign_open_id: zs.openId, link_assinatura: zs.link },
    });
    await registrarStatus(linha.id, 'enviado', {}, u.id);
  } catch (e) {
    const msg = String(e?.message || 'Falhou.').slice(0, 900);
    console.error('[closer] contrato', n.id, msg);
    await registrarStatus(linha.id, 'erro', { erro: msg }, u.id).catch(() => null);
    return { status: 200, body: { ok: false, erro: msg, cadastro } };
  }

  // O envio anterior (se o closer confirmou substituir) é cancelado — lá no ZapSign também.
  if (ativo) {
    if (ativo.zapsign_token && ativo.status !== 'assinado') await apagarNoZapsign(ativo.zapsign_token).catch(() => null);
    await registrarStatus(ativo.id, 'cancelado', { motivo: 'Substituído por um contrato novo.' }, u.id).catch(() => null);
  }
  if (dealId) await comentarNoNegocio(dealId, `📄 Contrato de ${c.tipo === 'expedicao' ? 'expedição' : 'pacote'} enviado pelo QS (ZapSign) para ${c.email}.`).catch(() => null);
  const final = (await rest(`qs_contratos?select=id,link_assinatura&id=eq.${linha.id}&limit=1`))?.[0];
  return { status: 200, body: { ok: true, contratoId: linha.id, link: final?.link_assinatura || null, cadastro } };
}

/** Lê o documento no ZapSign e aplica o status (webhook e botão "Atualizar"). */
async function conferirNoZapsign(contrato, autorId) {
  let doc;
  try {
    doc = await lerNoZapsign(contrato.zapsign_token);
  } catch (e) {
    // Documento apagado no ZapSign (doc_deleted, ou o "Cancelar" do próprio QS):
    // a leitura dá 404. Sem isto o webhook respondia 500 e o ZapSign reenviava
    // pra sempre (03/11). Cancelado só vale se ainda não foi assinado (a RPC barra).
    if (e?.status === 404) return registrarStatus(contrato.id, 'cancelado', { motivo: 'Documento apagado no ZapSign.' }, autorId);
    throw e;
  }
  const st = statusDoDocumento(doc, contrato.campos?.email);
  if (!st) return contrato.status;
  const extra = { ...(st.extra || {}) };
  // Arquiva a cópia assinada quando o cliente assina e DE NOVO quando o documento
  // fecha (a agência assinou): senão o QS guardava o PDF sem a 2ª assinatura.
  if (st.status === 'assinado' && st.arquivo && (!contrato.pdf_assinado_url || st.concluido)) {
    // Cópia assinada no Storage (o link do ZapSign expira em minutos).
    try {
      extra.pdf_assinado_url = await arquivarAssinado(st.arquivo, `${contrato.negocio_id}/${contrato.id}-assinado.pdf`);
    } catch (e) {
      console.warn('[closer] PDF assinado não arquivado', contrato.id, e?.message);
    }
  }
  const antes = contrato.status;
  const depois = await registrarStatus(contrato.id, st.status, extra, autorId);
  if (st.status === 'assinado' && antes !== 'assinado' && contrato.bitrix_deal_id) {
    await comentarNoNegocio(contrato.bitrix_deal_id, `✅ Contrato ASSINADO pelo cliente (ZapSign).${extra.pdf_assinado_url ? ' O PDF assinado está guardado no QS (cartão do closer).' : ''}`).catch(() => null);
  }
  return depois;
}

const COLS_CONTRATO = 'id,negocio_id,status,modo,campos,zapsign_token,pdf_assinado_url,bitrix_deal_id';

async function webhookZapsign(req, res) {
  const segredo = env('ZAPSIGN_WEBHOOK_SECRET');
  if (!segredo) return res.status(503).json({ error: 'ZAPSIGN_WEBHOOK_SECRET não configurado.' });
  // O painel do ZapSign nem sempre deixa pôr header: aceita o segredo também na URL (&s=...).
  // Seguro o bastante porque o status nunca vem do corpo — é reconsultado no ZapSign.
  // Também aceita "Authorization: Bearer <segredo>" — é o header que a API de
  // webhooks do ZapSign sugere (POST /api/v1/user/company/webhook/ com `headers`).
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const candidatos = [req.headers['x-qs-secret'], bearer, new URL(req.url || '', 'http://x').searchParams.get('s')].filter(Boolean);
  if (!candidatos.some((c) => segredoConfere(String(c), segredo))) return res.status(401).json({ error: 'Segredo inválido.' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const token = String(body.token || body.doc_token || body.document?.token || '').trim();
  const evento = String(body.event_type || body.event || '').slice(0, 60) || null;
  const chave = hashDoCorpo(body);

  // Idempotência: o mesmo corpo duas vezes = processa uma vez só.
  const nova = await rest('qs_contrato_webhooks?on_conflict=chave', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: { chave, zapsign_token: token || null, evento, payload: body },
  }).catch((e) => { console.error('[closer] webhook log', e?.message); return null; });
  if (Array.isArray(nova) && nova.length === 0) return res.status(200).json({ ok: true, repetido: true });
  const marcar = (resultado) => rest(`qs_contrato_webhooks?chave=eq.${chave}`, { method: 'PATCH', prefer: 'return=minimal', body: { resultado } }).catch(() => null);

  if (!/^[0-9a-f-]{20,60}$/i.test(token)) { await marcar('sem token'); return res.status(200).json({ ok: true, ignorado: 'sem token' }); }
  const contrato = (await rest(`qs_contratos?select=${COLS_CONTRATO}&zapsign_token=eq.${token}&limit=1`))?.[0];
  if (!contrato) { await marcar('documento não é do QS'); return res.status(200).json({ ok: true, ignorado: 'documento desconhecido' }); }

  try {
    let status;
    if (env('ZAPSIGN_API_TOKEN')) {
      // Nunca confia no corpo: relê o documento no ZapSign.
      status = await conferirNoZapsign(contrato, null);
    } else {
      // Sem token pra conferir (só acontece se tiraram o token depois): usa o corpo, já validado pelo segredo.
      const st = statusDoDocumento(body, contrato.campos?.email);
      status = st ? await registrarStatus(contrato.id, st.status, st.extra || {}, null) : contrato.status;
    }
    await marcar(`status: ${status}`);
    return res.status(200).json({ ok: true, status });
  } catch (e) {
    await marcar(`erro: ${String(e?.message || '').slice(0, 300)}`);
    // 500 faz o ZapSign tentar de novo depois — e o próximo corpo igual NÃO é
    // barrado pela idempotência porque apagamos a marca.
    await rest(`qs_contrato_webhooks?chave=eq.${chave}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => null);
    return res.status(500).json({ error: 'Falhou ao conferir no ZapSign.' });
  }
}

async function acaoDeContrato(acao, req, u, body) {
  if (acao === 'contrato-config') return { status: 200, body: await configParaTela(req, u) };

  if (acao === 'contrato-config-salvar') {
    if (!ehGestao(u)) return { status: 403, body: { error: 'Só a gestão do Comercial muda a configuração.' } };
    // Grava pela RPC (confere a permissão de novo no banco) — com o token do usuário.
    const r = await fetch(`${env('SUPABASE_URL').replace(/\/$/, '')}/rest/v1/rpc/contrato_config_salvar`, {
      method: 'POST',
      headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: req.headers['authorization'], 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_valor: body.valor || {} }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return { status: 400, body: { error: /id-google-invalido/.test(j.message) ? 'ID do Google inválido (copie só o pedaço entre /d/ e /edit).' : /email-invalido/.test(j.message) ? 'E-mail do assinante inválido.' : (j.message || 'Não salvou.') } };
    }
    return { status: 200, body: await configParaTela(req, u) };
  }

  if (acao === 'zapsign-testar') {
    if (!ehGestao(u)) return { status: 403, body: { error: 'Só a gestão do Comercial.' } };
    try { await testarZapsign(); return { status: 200, body: { ok: true } }; }
    catch (e) { return { status: 200, body: { ok: false, erro: e.message } }; }
  }

  if (acao === 'contrato-previa') {
    const id = String(body.negocioId || '');
    if (!UUID_RE.test(id)) return { status: 400, body: { error: 'Cartão inválido.' } };
    const n = await carregarNegocio(id);
    if (!n) return { status: 404, body: { error: 'Cartão não encontrado.' } };
    if (!podeMexer(u, n)) return { status: 403, body: { error: 'Sem permissão neste cartão.' } };
    const [previa, sit] = await Promise.all([montarPrevia(n), situacaoDaConfig()]);
    return { status: 200, body: { ...previa, modo: sit.falta.length ? 'manual' : 'automatico', falta: sit.falta } };
  }

  if (acao === 'contrato-enviar') return enviarContrato(u, body);

  // O PDF exatamente como vai sair, com os campos da prévia — sem enviar nada.
  if (acao === 'contrato-pdf-teste') {
    const c = normalizarCampos(body.campos);
    const pdf = await gerarPdf(c);
    // Gerado a partir do cartão (no modo manual é ESTE o contrato que vai pro
    // cliente): o que o closer corrigiu volta pro cadastro, se ele pode mexer no cartão.
    let cadastro = null;
    const negId = String(body.negocioId || '');
    if (UUID_RE.test(negId)) {
      const n = await carregarNegocio(negId);
      if (n && podeMexer(u, n)) cadastro = await gravarNoCadastro({ negocio: n, campos: c, previa: previaDoCorpo(body), userId: u.id });
    }
    return { status: 200, body: { ok: true, base64: pdf.toString('base64'), campos: c, cadastro, ...validarCampos(c) } };
  }

  if (acao === 'contrato-pdf-link') {
    const id = String(body.contratoId || '');
    if (!UUID_RE.test(id)) return { status: 400, body: { error: 'Contrato inválido.' } };
    const c = (await rest(`qs_contratos?select=negocio_id,drive_pdf_url,pdf_assinado_url&id=eq.${id}&limit=1`))?.[0];
    if (!c) return { status: 404, body: { error: 'Contrato não encontrado.' } };
    const n = await carregarNegocio(c.negocio_id);
    if (!n || !podeMexer(u, n)) return { status: 403, body: { error: 'Sem permissão neste cartão.' } };
    const guardado = body.qual === 'assinado' ? c.pdf_assinado_url : c.drive_pdf_url;
    if (!guardado) return { status: 404, body: { error: 'Este contrato não tem esse PDF guardado.' } };
    return { status: 200, body: { url: await linkDoPdf(guardado) } };
  }

  if (acao === 'contrato-atualizar' || acao === 'contrato-cancelar') {
    const id = String(body.contratoId || '');
    if (!UUID_RE.test(id)) return { status: 400, body: { error: 'Contrato inválido.' } };
    const c = (await rest(`qs_contratos?select=${COLS_CONTRATO}&id=eq.${id}&limit=1`))?.[0];
    if (!c) return { status: 404, body: { error: 'Contrato não encontrado.' } };
    const n = await carregarNegocio(c.negocio_id);
    if (!n || !podeMexer(u, n)) return { status: 403, body: { error: 'Sem permissão neste cartão.' } };
    if (acao === 'contrato-atualizar') {
      if (!c.zapsign_token) return { status: 409, body: { error: 'Este contrato foi enviado por fora do ZapSign do QS.' } };
      if (!env('ZAPSIGN_API_TOKEN')) return { status: 503, body: { error: 'Falta ZAPSIGN_API_TOKEN na Vercel.' } };
      const status = await conferirNoZapsign(c, u.id);
      return { status: 200, body: { ok: true, status } };
    }
    if (c.status === 'assinado') return { status: 409, body: { error: 'Contrato assinado não se cancela.' } };
    if (c.zapsign_token && env('ZAPSIGN_API_TOKEN')) await apagarNoZapsign(c.zapsign_token).catch((e) => console.warn('[closer] apagar no ZapSign', e?.message));
    const status = await registrarStatus(c.id, 'cancelado', { motivo: String(body.motivo || '').slice(0, 300) }, u.id);
    return { status: 200, body: { ok: true, status } };
  }
  return null;
}

export default async function handler(req, res) {
  // req.query vem da Vercel; a ponte do `vite dev` não preenche — lê da URL também.
  const acaoQ = String(req.query?.acao || new URL(req.url || '', 'http://x').searchParams.get('acao') || '');
  // Entradas SEM usuário logado (cada uma com a própria trava).
  if (acaoQ === 'zapsign-webhook' && req.method === 'POST') {
    try { return await webhookZapsign(req, res); }
    catch (e) { console.error('[closer] webhook', e?.message); return res.status(500).json({ error: 'Falhou.' }); }
  }

  // Vercel Cron (Bearer CRON_SECRET): cartões com etapa pendente → Bitrix.
  if (acaoQ === 'cron-bitrix' && req.method === 'GET') {
    const segredo = env('CRON_SECRET');
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Sem autorização.' });
    if (!bitrixConfigurado()) return res.status(503).json({ error: 'Falta BITRIX_WEBHOOK_BASE.' });
    // 03/11 (Bruno, opção b): o reenvio dos pendentes fica DESLIGADO no deploy até
    // conferirmos a lista (70 cartões parados desde 26/10). Liga com a env
    // CLOSER_CRON_BITRIX_LIGADO=1 na Vercel + redeploy.
    if (env('CLOSER_CRON_BITRIX_LIGADO') !== '1') return res.status(200).json({ pulado: 'Reenvio desligado (CLOSER_CRON_BITRIX_LIGADO).' });
    try { return res.status(200).json(await cronBitrix()); }
    catch (e) { console.error('[closer] cron-bitrix', e?.message); return res.status(500).json({ error: 'Falhou.' }); }
  }
  // Conferir (dry-run) com o mesmo segredo do cron: só lê o Bitrix.
  if (acaoQ === 'conferir-bitrix' && req.method === 'GET') {
    const segredo = env('CRON_SECRET');
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Sem autorização.' });
    if (!bitrixConfigurado()) return res.status(503).json({ error: 'Falta BITRIX_WEBHOOK_BASE.' });
    const escopo = new URL(req.url || '', 'http://x').searchParams.get('escopo') === 'todos' ? 'todos' : 'fila';
    try { return res.status(200).json(await conferirBitrix(escopo)); }
    catch (e) { console.error('[closer] conferir-bitrix', e?.message); return res.status(500).json({ error: 'Falhou.' }); }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }
  const u = await quemChama(req);
  if (!u) return res.status(401).json({ error: 'Entre de novo no QS.' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(req.query?.acao || body.acao || '');

  try {
    if (acao === 'config') return res.status(200).json(await configDaArea());
    if (acao === 'importar') {
      if (!bitrixConfigurado()) return res.status(503).json({ error: 'Falta BITRIX_WEBHOOK_BASE na Vercel.' });
      if (!(u.role === 'closer' || ehGestao(u))) return res.status(403).json({ error: 'Só closer e gestão do Comercial.' });
      const r = await importarDoBitrix(u, body);
      return res.status(r.status).json(r.body);
    }
    // 0207: pré-venda marcada/desfeita no banco (RPC closer_pre_venda) → Bitrix agora.
    if (acao === 'pre-venda') {
      if (!bitrixConfigurado()) return res.status(503).json({ error: 'Falta BITRIX_WEBHOOK_BASE na Vercel.' });
      const id = String(body.negocioId || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Cartão inválido.' });
      const r = await espelhar(id, u, {
        comentario: (n, valor) => (emPreVenda(n)
          ? `⚡ PRÉ-VENDA marcada no QS por ${u.name || 'closer'}: ${brl(valor)}. O cliente fechou; a ficha de fechamento (plano de pagamento) vem depois e não conta a venda de novo.`
          : `↩️ Pré-venda DESFEITA no QS por ${u.name || 'closer'}. O negócio voltou pra "${NOME_ETAPA[n.etapa] || n.etapa}".`),
      });
      return res.status(r.status).json(r.body);
    }
    // Conferir pela tela (gestão): a mesma lista do GET, sem enviar nada.
    if (acao === 'conferir-bitrix') {
      if (!bitrixConfigurado()) return res.status(503).json({ error: 'Falta BITRIX_WEBHOOK_BASE na Vercel.' });
      if (!ehGestao(u)) return res.status(403).json({ error: 'Só a gestão do Comercial.' });
      return res.status(200).json(await conferirBitrix(body.escopo === 'todos' ? 'todos' : 'fila'));
    }
    if (acao === 'espelhar') {
      if (!bitrixConfigurado()) return res.status(503).json({ error: 'Falta BITRIX_WEBHOOK_BASE na Vercel.' });
      const id = String(body.negocioId || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Cartão inválido.' });
      const r = await espelhar(id, u);
      return res.status(r.status).json(r.body);
    }
    if (acao.startsWith('contrato-') || acao === 'zapsign-testar') {
      if (!(u.role === 'closer' || ehGestao(u))) return res.status(403).json({ error: 'Só closer e gestão do Comercial.' });
      const r = await acaoDeContrato(acao, req, u, body);
      if (r) return res.status(r.status).json(r.body);
    }
    return res.status(400).json({ error: 'Ação inválida.' });
  } catch (e) {
    console.error('[closer]', e?.message);
    return res.status(500).json({ error: e?.message || 'Falhou.' });
  }
}
