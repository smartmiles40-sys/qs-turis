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
//          o cartão no banco; é o cron que leva isso pro Bitrix).
//   POST { acao: 'importar', dealId, closerId? }
//        → traz pro quadro um cliente que já tinha card no Bitrix.
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
// CONTRATO (0180, 22/10 — "tudo via código, sem n8n"; ver docs/CONTRATO.md):
//   POST { acao: 'contrato-config' }               → o que está pronto / o que falta
//   POST { acao: 'contrato-config-salvar', valor } → (gestão) templates, pasta, assinante
//   POST { acao: 'google-conectar' }               → (gestão) URL do consentimento do Google
//   GET  ?acao=google-callback&code&state          → o Google volta aqui; grava o refresh token
//   POST { acao: 'google-desconectar' }            → (gestão) revoga e apaga
//   POST { acao: 'zapsign-testar' }                → (gestão) confere o ZAPSIGN_API_TOKEN
//   POST { acao: 'contrato-previa', negocioId }    → campos sugeridos + de onde vieram
//   POST { acao: 'contrato-enviar', negocioId, campos, substituir? }
//        → gera pelo Google, arquiva o PDF no Drive, cria no ZapSign, grava o envio
//   POST { acao: 'contrato-atualizar', contratoId }→ relê o documento no ZapSign
//   POST { acao: 'contrato-cancelar', contratoId, motivo } → apaga no ZapSign + cancela
//   POST ?acao=zapsign-webhook                     → o ZapSign avisa (header X-QS-Secret)
// Envs novas: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, ZAPSIGN_API_TOKEN,
// ZAPSIGN_WEBHOOK_SECRET; opcionais QS_URL_PUBLICA e ZAPSIGN_API_URL (sandbox).
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { bx, bitrixConfigurado, comentarNoNegocio } from './_bitrixLead.js';
import { getSupabaseUserId } from './_wa.js';
import {
  apagarNoZapsign, arquivarAssinado, conectarGoogle, conferirEstado, contaGoogle, criarNoZapsign, desconectarGoogle,
  gerarPdf, hashDoCorpo, lerConfig, lerNoZapsign, montarPrevia, nomesDoArquivo, normalizarCampos, oQueFalta,
  statusDoDocumento, testarZapsign, urlDeConsentimento, urlDeRetorno, urlDoApp, validarCampos,
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
// O QS manda. O negócio do Bitrix vai pra coluna de MESMO NOME no funil em que
// ele está (sem acento/caixa). Os ids das colunas não ficam no código: vêm do
// próprio funil (crm.status.list), guardados 10 min.
const NOMES_BITRIX = {
  aguardando_reuniao: [/aguardando\s+reuni/],
  reagendamento: [/reagend/],
  em_cotacao: [/em\s+cotac/, /cotac/],
  em_negociacao: [/negocia/],
  no_show: [/no.?show/],
  oportunidade_futura: [/oportunidade\s+futura/],
  aguardando_emissao: [/aguardando\s+emiss/, /em\s+emiss/],
  venda_cancelada: [/venda\s+cancelada/, /cancelad/, /desist/],
  perdido: [/perdid/],
  venda_realizada: [/venda\s+realizada/],
};
const NOME_ETAPA = {
  aguardando_reuniao: 'Aguardando reunião', reagendamento: 'Reagendamento', em_cotacao: 'Em cotação',
  em_negociacao: 'Em negociação', no_show: 'No-show', oportunidade_futura: 'Oportunidade futura',
  aguardando_emissao: 'Aguardando emissão', venda_cancelada: 'Venda cancelada', perdido: 'Perdido',
  venda_realizada: 'Venda realizada',
};
const ETAPAS_DE_VENDA = ['aguardando_emissao', 'venda_realizada'];
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const cacheFunis = new Map();
async function colunasDoFunil(categoria) {
  const cat = String(categoria ?? '0');
  const c = cacheFunis.get(cat);
  if (c && Date.now() - c.em < 600_000) return c.lista;
  const lista = (await bx('crm.status.list', { filter: { ENTITY_ID: cat === '0' ? 'DEAL_STAGE' : `DEAL_STAGE_${cat}` } }, 8_000)) || [];
  cacheFunis.set(cat, { em: Date.now(), lista });
  return lista;
}

/** A coluna do Bitrix pra uma etapa do QS (null se o funil não tem). */
function colunaParaEtapa(lista, etapa) {
  for (const re of NOMES_BITRIX[etapa] || []) {
    const achou = lista.find((e) => re.test(semAcento(e?.NAME)));
    if (achou) return String(achou.STATUS_ID);
  }
  const id = (e) => String(e?.STATUS_ID || '');
  if (etapa === 'venda_realizada') { const w = lista.find((e) => /(^|:)WON$/.test(id(e))); if (w) return id(w); }
  if (etapa === 'perdido') { const l = lista.find((e) => /(^|:)LOSE$/.test(id(e))); if (l) return id(l); }
  return null;
}

/** O caminho de volta, usado na importação: coluna do Bitrix → etapa do QS. */
function etapaParaColuna(lista, statusId) {
  const col = lista.find((e) => String(e?.STATUS_ID) === String(statusId));
  const nome = col?.NAME || String(statusId);
  const n = semAcento(col?.NAME);
  for (const [etapa, res] of Object.entries(NOMES_BITRIX)) if (n && res.some((re) => re.test(n))) return { etapa, nome };
  if (/(^|:)WON$/.test(String(statusId))) return { etapa: 'venda_realizada', nome };
  if (/(^|:)LOSE$/.test(String(statusId))) return { etapa: 'perdido', nome };
  return { etapa: null, nome };
}

/** Manda a etapa (e o valor) do cartão pro Bitrix. `u` = quem pediu; null = o cron. */
async function espelhar(negocioId, u) {
  const n = (await rest(`qs_closer_negocios?select=id,lead_id,closer_id,etapa,ficha,valor_previsto,consolidada_em,arquivado_em,bitrix_status,bitrix_etapa&id=eq.${negocioId}&limit=1`))?.[0];
  if (!n) return { status: 404, body: { error: 'Cartão não encontrado.' } };
  if (u && !podeMexer(u, n)) return { status: 403, body: { error: 'Sem permissão neste cartão.' } };
  if (n.arquivado_em) return { status: 409, body: { error: 'O cartão está no arquivo.' } };

  const lead = (await rest(`qs_leads?select=id,bitrix_id&id=eq.${n.lead_id}&limit=1`))?.[0];
  const dealId = String(lead?.bitrix_id || '').replace(/\D/g, '');
  if (!dealId) {
    await marcar(n.id, { bitrix_status: 'sem_card', bitrix_erro: 'O lead não tem negócio no Bitrix.' });
    return { status: 200, body: { ok: false, status: 'sem_card', mensagem: 'Este cliente não tem card no Bitrix — ficou só no QS.' } };
  }

  try {
    const deal = await bx('crm.deal.get', { id: Number(dealId) }, 8_000);
    if (!deal) throw new Error(`Negócio ${dealId} não encontrado no Bitrix.`);
    const lista = await colunasDoFunil(deal.CATEGORY_ID);
    const alvo = colunaParaEtapa(lista, n.etapa);
    if (!alvo) throw new Error(`O funil deste negócio não tem a coluna "${NOME_ETAPA[n.etapa] || n.etapa}". Crie a coluna com esse nome no Bitrix e reenvie.`);
    const valor = Number(n.ficha?.valor_total ?? n.valor_previsto ?? 0);
    const fields = {};
    if (String(deal.STAGE_ID) !== alvo) fields.STAGE_ID = alvo;
    if (valor > 0 && Math.abs(Number(deal.OPPORTUNITY || 0) - valor) > 0.009) {
      fields.OPPORTUNITY = valor;
      fields.CURRENCY_ID = 'BRL';
    }
    if (Object.keys(fields).length) {
      await bx('crm.deal.update', { id: Number(dealId), fields, params: { REGISTER_SONET_EVENT: 'Y' } }, 8_000);
    }
    // Venda fechada pela ficha: o resumo vai pra timeline do negócio uma vez só,
    // quando o cartão entra na venda (Aguardando emissão ou Venda realizada).
    if (n.consolidada_em && ETAPAS_DE_VENDA.includes(n.etapa) && !ETAPAS_DE_VENDA.includes(n.bitrix_etapa || '')) {
      const parcelas = (await rest(`fin_planos?select=fin_parcelas(numero,valor,vencimento,forma,recorrente)&negocio_id=eq.${n.id}&limit=1`).catch(() => null))?.[0]?.fin_parcelas || [];
      parcelas.sort((a, b) => a.numero - b.numero);
      await comentarNoNegocio(dealId, resumoDaFicha(n.ficha, parcelas));
    }
    const nota = Object.keys(fields).length
      ? `Bitrix atualizado (negócio ${dealId}): ${fields.STAGE_ID ? `coluna "${NOME_ETAPA[n.etapa]}"` : ''}${fields.STAGE_ID && fields.OPPORTUNITY ? ' + ' : ''}${fields.OPPORTUNITY ? `valor ${brl(valor)}` : ''}.`
      : null;
    await marcar(n.id, { bitrix_status: 'ok', bitrix_erro: null, bitrix_etapa: n.etapa, bitrix_enviado_em: new Date().toISOString() }, nota, u?.id);
    return { status: 200, body: { ok: true, status: 'ok', mudou: Object.keys(fields), dealId } };
  } catch (e) {
    const msg = String(e?.message || 'Falhou').slice(0, 500);
    console.error('[closer] espelhar', n.id, msg);
    // O cron tenta de novo a cada rodada: só registra o evento se a mensagem mudou.
    await marcar(n.id, { bitrix_status: 'erro', bitrix_erro: msg }, u ? `Bitrix recusou: ${msg}` : null, u?.id).catch(() => null);
    return { status: 200, body: { ok: false, status: 'erro', mensagem: msg } };
  }
}

/** Cron: leva pro Bitrix os cartões que mudaram de etapa (inclusive os que a reunião moveu). */
async function cronBitrix() {
  const pend = (await rest('qs_closer_negocios?select=id&bitrix_status=eq.pendente&arquivado_em=is.null&order=atualizado_em.asc&limit=25')) || [];
  let ok = 0, falhou = 0;
  for (const p of pend) {
    const r = await espelhar(p.id, null).catch(() => null);
    if (r?.body?.ok) ok++; else falhou++;
  }
  return { pendentes: pend.length, ok, falhou };
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
  return { status: 200, body: { ok: true, negocioId, leadId: lead.id, etapa: destino, cliente: lead.full_name } };
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
  const [cfg, g] = await Promise.all([lerConfig(), contaGoogle()]);
  return { cfg, g, falta: oQueFalta(cfg, g) };
}

async function configParaTela(req, u) {
  const { cfg, g, falta } = await situacaoDaConfig();
  return {
    podeConfigurar: ehGestao(u),
    modo: falta.length ? 'manual' : 'automatico',
    falta,
    config: cfg,
    google: {
      clienteConfigurado: Boolean(env('GOOGLE_OAUTH_CLIENT_ID') && env('GOOGLE_OAUTH_CLIENT_SECRET')),
      conectado: Boolean(g?.refresh_token),
      email: g?.email || null,
      conectadoEm: g?.conectado_em || null,
      ultimoErro: g?.ultimo_erro || null,
    },
    zapsign: {
      token: Boolean(env('ZAPSIGN_API_TOKEN')),
      webhookSecret: Boolean(env('ZAPSIGN_WEBHOOK_SECRET')),
      sandbox: /sandbox/i.test(env('ZAPSIGN_API_URL')),
    },
    redirectUri: urlDeRetorno(req),
    webhookUrl: `${urlDoApp(req)}/api/closer?acao=zapsign-webhook`,
  };
}

async function contratoAtivo(negocioId) {
  return (await rest(`qs_contratos?select=id,status,modo,zapsign_token&negocio_id=eq.${negocioId}&status=in.(enviado,visualizado,assinado)&order=criado_em.desc&limit=1`).catch(() => null))?.[0] || null;
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
  let gerado = null;
  try {
    gerado = await gerarPdf(c, cfg, nomes);
    await rest(`qs_contratos?id=eq.${linha.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { drive_pdf_id: gerado.driveId, drive_pdf_url: gerado.driveUrl } });
    const zs = await criarNoZapsign({ c, cfg, nomes, pdf: gerado.pdf, negocioId: n.id });
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
    return { status: 200, body: { ok: false, erro: msg, sobraram: e.sobraram || null, pdf: gerado?.driveUrl || null } };
  }

  // O envio anterior (se o closer confirmou substituir) é cancelado — lá no ZapSign também.
  if (ativo) {
    if (ativo.zapsign_token && ativo.status !== 'assinado') await apagarNoZapsign(ativo.zapsign_token).catch(() => null);
    await registrarStatus(ativo.id, 'cancelado', { motivo: 'Substituído por um contrato novo.' }, u.id).catch(() => null);
  }
  if (dealId) await comentarNoNegocio(dealId, `📄 Contrato de ${c.tipo === 'expedicao' ? 'expedição' : 'pacote'} enviado pelo QS (ZapSign) para ${c.email}.`).catch(() => null);
  const final = (await rest(`qs_contratos?select=id,link_assinatura,drive_pdf_url&id=eq.${linha.id}&limit=1`))?.[0];
  return { status: 200, body: { ok: true, contratoId: linha.id, link: final?.link_assinatura || null, pdf: final?.drive_pdf_url || null } };
}

/** Lê o documento no ZapSign e aplica o status (webhook e botão "Atualizar"). */
async function conferirNoZapsign(contrato, autorId) {
  const doc = await lerNoZapsign(contrato.zapsign_token);
  const st = statusDoDocumento(doc, contrato.campos?.email);
  if (!st) return contrato.status;
  const extra = { ...(st.extra || {}) };
  if (st.status === 'assinado' && !contrato.pdf_assinado_url && st.arquivo) {
    // Cópia assinada no Drive (o link do ZapSign expira). Sem Google: fica sem cópia.
    try {
      const cfg = await lerConfig();
      const nomes = nomesDoArquivo(contrato.campos || {}, contrato.bitrix_deal_id, contrato.negocio_id);
      extra.pdf_assinado_url = await arquivarAssinado(st.arquivo, `${nomes.arquivo} (assinado).pdf`, cfg);
    } catch (e) {
      console.warn('[closer] PDF assinado não arquivado', contrato.id, e?.message);
    }
  }
  const antes = contrato.status;
  const depois = await registrarStatus(contrato.id, st.status, extra, autorId);
  if (st.status === 'assinado' && antes !== 'assinado' && contrato.bitrix_deal_id) {
    await comentarNoNegocio(contrato.bitrix_deal_id, `✅ Contrato ASSINADO pelo cliente (ZapSign).${extra.pdf_assinado_url ? ` PDF: ${extra.pdf_assinado_url}` : ''}`).catch(() => null);
  }
  return depois;
}

const COLS_CONTRATO = 'id,negocio_id,status,modo,campos,zapsign_token,pdf_assinado_url,bitrix_deal_id';

async function webhookZapsign(req, res) {
  const segredo = env('ZAPSIGN_WEBHOOK_SECRET');
  if (!segredo) return res.status(503).json({ error: 'ZAPSIGN_WEBHOOK_SECRET não configurado.' });
  if (!segredoConfere(req.headers['x-qs-secret'], segredo)) return res.status(401).json({ error: 'Segredo inválido.' });
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

async function googleCallback(req, res) {
  const app = urlDoApp(req);
  const voltar = (resultado) => { res.statusCode = 302; res.setHeader('Location', `${app}/#closer/contrato/${resultado}`); return res.end(); };
  const estado = conferirEstado(req.query?.state);
  if (!estado) return voltar('erro-estado');
  if (req.query?.error) return voltar('erro-negado');
  const u = (await rest(`qs_users?select=id,role,setores,is_active&id=eq.${estado.u}&limit=1`).catch(() => null))?.[0];
  if (!u?.is_active || !ehGestao(u)) return voltar('erro-permissao');
  try {
    await conectarGoogle(req, String(req.query?.code || ''), u.id);
    return voltar('conectado');
  } catch (e) {
    console.error('[closer] google callback', e?.message);
    await rest('qs_contrato_google?id=eq.1', { method: 'PATCH', prefer: 'return=minimal', body: { ultimo_erro: String(e?.message).slice(0, 300), ultimo_erro_em: new Date().toISOString() } }).catch(() => null);
    return voltar('erro-google');
  }
}

async function acaoDeContrato(acao, req, u, body) {
  if (acao === 'contrato-config') return { status: 200, body: await configParaTela(req, u) };

  if (acao === 'contrato-config-salvar') {
    if (!ehGestao(u)) return { status: 403, body: { error: 'Só a gestão do Comercial muda a configuração.' } };
    // Grava pela RPC (valida os IDs e confere a permissão de novo no banco) — com o token do usuário.
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

  if (acao === 'google-conectar') {
    if (!ehGestao(u)) return { status: 403, body: { error: 'Só a gestão do Comercial conecta a conta Google.' } };
    if (!env('GOOGLE_OAUTH_CLIENT_ID') || !env('GOOGLE_OAUTH_CLIENT_SECRET')) return { status: 503, body: { error: 'Falta GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET na Vercel.' } };
    return { status: 200, body: { url: urlDeConsentimento(req, u.id) } };
  }

  if (acao === 'google-desconectar') {
    if (!ehGestao(u)) return { status: 403, body: { error: 'Só a gestão do Comercial desconecta.' } };
    await desconectarGoogle();
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
  const acaoQ = String(req.query?.acao || '');
  // Entradas SEM usuário logado (cada uma com a própria trava).
  if (acaoQ === 'google-callback' && req.method === 'GET') return googleCallback(req, res);
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
    try { return res.status(200).json(await cronBitrix()); }
    catch (e) { console.error('[closer] cron-bitrix', e?.message); return res.status(500).json({ error: 'Falhou.' }); }
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
    if (acao === 'importar') {
      if (!bitrixConfigurado()) return res.status(503).json({ error: 'Falta BITRIX_WEBHOOK_BASE na Vercel.' });
      if (!(u.role === 'closer' || ehGestao(u))) return res.status(403).json({ error: 'Só closer e gestão do Comercial.' });
      const r = await importarDoBitrix(u, body);
      return res.status(r.status).json(r.body);
    }
    if (acao === 'espelhar') {
      if (!bitrixConfigurado()) return res.status(503).json({ error: 'Falta BITRIX_WEBHOOK_BASE na Vercel.' });
      const id = String(body.negocioId || '');
      if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Cartão inválido.' });
      const r = await espelhar(id, u);
      return res.status(r.status).json(r.body);
    }
    if (acao.startsWith('contrato-') || acao.startsWith('google-') || acao === 'zapsign-testar') {
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
