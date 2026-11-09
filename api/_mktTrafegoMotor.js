// api/_mktTrafegoMotor.js
// -----------------------------------------------------------------------------
// TRÁFEGO › META ADS — o motor (banco + Meta). 03/11/2026 (0265).
//
//   sincronizar()  lê a Meta (estrutura + insights diários), grava nas
//                  mkt_trafego_*, tira a fotografia acumulada e devolve as
//                  mudanças (orçamento que subiu por fora, campanha nova).
//   montarPainel() lê o banco e monta TUDO que a tela mostra (verba, funil,
//                  campanhas, travas avaliadas, histórico) — com as contas de
//                  api/_mktTrafegoCalc.js.
//   agir()         o cron: avalia as travas e executa (aviso / pausa /
//                  "pausaria"), mais os alertas extras. Idempotente pela
//                  `chave` do histórico: a mesma coisa não avisa nem pausa 2x
//                  no mesmo dia.
//   reativar()     o botão "Reativar" do histórico (manual, com confirmação).
//
// NUNCA reativa sozinho. NUNCA mexe em orçamento. A única escrita na Meta é
// status=PAUSED (trava) e status=ACTIVE (botão Reativar, pessoa logada).
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { metaConfig, faltaConfigurar, lerEstrutura, lerInsightsDiarios, lerConta, mudarStatus } from './_metaAds.js';
import * as C from './_mktTrafegoCalc.js';

const HORA_MS = 3_600_000;
const SEM_DADO_HORAS = 2;
const GUARDA_LEITURAS_H = 96;

// ── banco ───────────────────────────────────────────────────────────────────
/** Lê tudo (PostgREST corta em 1000 sem avisar): pagina pela ordem dada. */
async function todas(caminho, ordem) {
  const saida = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const sep = caminho.includes('?') ? '&' : '?';
    const lote = await rest(`${caminho}${sep}order=${ordem}&limit=1000&offset=${offset}`);
    saida.push(...(lote || []));
    if (!lote || lote.length < 1000) break;
  }
  return saida;
}
async function upsert(tabela, linhas, conflito) {
  for (let i = 0; i < linhas.length; i += 500) {
    await rest(`${tabela}?on_conflict=${conflito}`, {
      method: 'POST', body: linhas.slice(i, i + 500), prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }
}
/** Grava no histórico. Devolve a linha, ou null se a chave já existia (já feito). */
export async function registrar(linha) {
  const r = await rest('mkt_trafego_acoes?on_conflict=chave', {
    method: 'POST', body: linha, prefer: 'resolution=ignore-duplicates,return=representation',
  });
  return Array.isArray(r) && r[0] ? r[0] : null;
}
async function avisar(titulo, texto, chave) {
  try {
    await rest('rpc/mkt_trafego_avisar', { method: 'POST', body: { p_titulo: titulo, p_texto: texto, p_chave: chave, p_link: '#mkt/meta-ads?aba=historico' } });
  } catch (e) {
    console.warn('[mkt-trafego] aviso falhou:', String(e?.message || '').slice(0, 200));
  }
}
const ehTabelaQueFalta = (e) => ['42P01', 'PGRST205', 'PGRST202', '42883'].includes(e?.details?.code) || e?.status === 404;

// ── sincronizar ─────────────────────────────────────────────────────────────
/**
 * @param o.fetchImpl  fetch (falso nos testes)
 * @param o.agora      ms
 * @param o.orcamentoMs tempo máximo da rodada (a rota tem maxDuration 60 s)
 */
export async function sincronizar({ fetchImpl = fetch, agora = Date.now(), orcamentoMs = 40_000 } = {}) {
  const cfg = metaConfig();
  const ateMs = Date.now() + orcamentoMs;
  const hoje = C.diaSP(agora);
  await rest('mkt_trafego_estado?id=eq.1', { method: 'PATCH', body: { ultima_tentativa: new Date(agora).toISOString() }, prefer: 'return=minimal' });

  try {
    // Janela de insights: os últimos 3 dias (a Meta ainda ajusta) + o começo de
    // qualquer período que esteja valendo ou terminou há pouco. Teto de 62 dias.
    const periodos = await rest(`mkt_trafego_periodos?select=inicio,fim&ativo=is.true&fim=gte.${C.somarDias(hoje, -7)}`).catch(() => []);
    let desde = C.somarDias(hoje, -3);
    for (const p of periodos || []) if (p.inicio < desde) desde = p.inicio;
    if (desde < C.somarDias(hoje, -62)) desde = C.somarDias(hoje, -62);

    const [estrutura, insights, conta, campAntes, conjAntes] = await Promise.all([
      lerEstrutura(cfg, { fetchImpl, ateMs }),
      lerInsightsDiarios(cfg, { desde, ate: hoje, fetchImpl, ateMs }),
      lerConta(cfg, { fetchImpl }).catch(() => null),
      todas('mkt_trafego_campanhas?select=id,nome,daily_budget,effective_status,destino,destino_manual', 'id'),
      todas('mkt_trafego_conjuntos?select=id,nome,campanha_id,daily_budget', 'id'),
    ]);

    // Destinos conhecidos: a base + as Fontes que os leads usaram nos últimos 60 dias.
    const fontes = await rest(`rpc/mkt_trafego_funil`, { method: 'POST', body: { p_inicio: C.somarDias(hoje, -60), p_fim: hoje } }).catch(() => []);
    const conhecidos = C.destinosConhecidos((fontes || []).map((f) => f.segment));

    const antesPorId = new Map(campAntes.map((c) => [c.id, c]));
    const conjAntesPorId = new Map(conjAntes.map((j) => [j.id, j]));
    const agoraIso = new Date(agora).toISOString();

    const campanhas = estrutura.campanhas.map((c) => ({
      ...c, ...C.classificarCampanha(c.nome, conhecidos),
      daily_budget_antes: antesPorId.get(c.id)?.daily_budget ?? null, atualizado_em: agoraIso,
    }));
    // Campanha que gastou mas não veio na estrutura (arquivada/apagada): entra
    // só com nome, pra o gasto dela ter dono na tela.
    const vistas = new Set(campanhas.map((c) => c.id));
    for (const l of insights.linhas) {
      if (vistas.has(l.campanha_id) || antesPorId.has(l.campanha_id)) continue;
      vistas.add(l.campanha_id);
      campanhas.push({ id: l.campanha_id, nome: l.nome || l.campanha_id, effective_status: 'ARCHIVED', status: 'ARCHIVED', ...C.classificarCampanha(l.nome, conhecidos), atualizado_em: agoraIso });
    }
    const conjuntos = estrutura.conjuntos.map((j) => ({ ...j, daily_budget_antes: conjAntesPorId.get(j.id)?.daily_budget ?? null, atualizado_em: agoraIso }));

    // As campanhas novas da rodada precisam de TODAS as colunas iguais (PostgREST
    // exige o mesmo conjunto de chaves no lote).
    const colsCamp = ['id', 'nome', 'status', 'effective_status', 'objetivo', 'daily_budget', 'lifetime_budget', 'spend_cap',
      'inicio_meta', 'fim_meta', 'criada_meta', 'atualizada_meta', 'destino', 'tipo', 'daily_budget_antes', 'atualizado_em'];
    const uniforme = (linhas, cols) => linhas.map((l) => Object.fromEntries(cols.map((k) => [k, l[k] ?? null])));
    // Arquivada que já existe não é tocada (o upsert acima só traz as que vieram).
    await upsert('mkt_trafego_campanhas', uniforme(campanhas, colsCamp), 'id');
    await upsert('mkt_trafego_conjuntos', uniforme(conjuntos, ['id', 'campanha_id', 'nome', 'status', 'effective_status', 'daily_budget', 'lifetime_budget', 'daily_budget_antes', 'atualizado_em']), 'id');
    await upsert('mkt_trafego_anuncios', uniforme(estrutura.anuncios.map((a) => ({ ...a, atualizado_em: agoraIso })), ['id', 'conjunto_id', 'campanha_id', 'nome', 'status', 'effective_status', 'atualizado_em']), 'id');
    await upsert('mkt_trafego_insights_dia', insights.linhas.map((l) => ({
      data: l.data, campanha_id: l.campanha_id, gasto: l.gasto, impressoes: l.impressoes, cliques: l.cliques, leads: l.leads, atualizado_em: agoraIso,
    })), 'data,campanha_id');

    // Fotografia acumulada (só de quem gastou nos últimos dias) + faxina.
    const recentes = new Set(insights.linhas.filter((l) => l.data >= C.somarDias(hoje, -3) && l.gasto > 0).map((l) => l.campanha_id));
    const acum = await rest('rpc/mkt_trafego_acumulado', { method: 'POST', body: {} });
    const foto = (acum || []).filter((a) => recentes.has(a.campanha_id))
      .map((a) => ({ lido_em: agoraIso, campanha_id: a.campanha_id, gasto_acum: a.gasto_acum, leads_acum: a.leads_acum }));
    if (foto.length) await upsert('mkt_trafego_leituras', foto, 'lido_em,campanha_id');
    await rest(`mkt_trafego_leituras?lido_em=lt.${encodeURIComponent(new Date(agora - GUARDA_LEITURAS_H * HORA_MS).toISOString())}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => null);

    const periodoAtivo = await periodoDeHoje(hoje);
    const mudancas = C.mudancasDaLeitura({
      antes: campAntes,
      depois: campanhas.map((c) => ({ ...c, destino: antesPorId.get(c.id)?.destino_manual ?? c.destino })),
      conjAntes, conjDepois: conjuntos, periodo: periodoAtivo,
    });

    const completo = estrutura.completo && insights.completo;
    await rest('mkt_trafego_estado?id=eq.1', {
      method: 'PATCH', prefer: 'return=minimal',
      body: {
        ultima_sync_ok: agoraIso, ultimo_erro: completo ? null : 'Leitura parcial: o tempo da rodada acabou antes de ler tudo (a próxima completa).',
        ...(conta ? { conta_nome: conta.nome, conta_moeda: conta.moeda, conta_fuso: conta.fuso } : {}),
        resumo: { campanhas: campanhas.length, conjuntos: conjuntos.length, anuncios: estrutura.anuncios.length, linhasInsights: insights.linhas.length, desde, completo },
      },
    });
    return { ok: true, completo, desde, campanhas: campanhas.length, conjuntos: conjuntos.length, anuncios: estrutura.anuncios.length, insights: insights.linhas.length, mudancas };
  } catch (e) {
    await rest('mkt_trafego_estado?id=eq.1', { method: 'PATCH', prefer: 'return=minimal', body: { ultimo_erro: String(e?.message || e).slice(0, 500) } }).catch(() => null);
    throw e;
  }
}

async function periodoDeHoje(hoje) {
  const l = await rest(`mkt_trafego_periodos?select=*&ativo=is.true&inicio=lte.${hoje}&fim=gte.${hoje}&order=inicio.desc&limit=1`).catch(() => []);
  return l?.[0] ?? null;
}

// ── painel ──────────────────────────────────────────────────────────────────
/**
 * Tudo que a tela mostra. `periodoId` escolhe o período; sem ele, o de hoje
 * (ou o mais recente). Também é a base da avaliação do cron (agir).
 */
export async function montarPainel({ periodoId = null, agora = Date.now() } = {}) {
  const falta = faltaConfigurar();
  const hoje = C.diaSP(agora);
  let base;
  try {
    base = await Promise.all([
      rest('mkt_trafego_estado?select=*&id=eq.1').then((r) => r?.[0] ?? null),
      rest('mkt_trafego_periodos?select=*&order=inicio.desc&limit=50'),
      rest('mkt_trafego_regras?select=*&order=criado_em.asc'),
      rest('mkt_trafego_config?select=avisar_ids&id=eq.1').then((r) => r?.[0] ?? { avisar_ids: [] }),
      todas('mkt_trafego_campanhas?select=*', 'id'),
      todas('mkt_trafego_conjuntos?select=id,campanha_id,nome,status,effective_status,daily_budget,lifetime_budget', 'id'),
      rest('mkt_trafego_acoes?select=*&order=criado_em.desc&limit=150'),
    ]);
  } catch (e) {
    if (ehTabelaQueFalta(e)) return { configurado: false, faltaBanco: true, falta, pausaLigada: C.pausaLigada() };
    throw e;
  }
  const [estado, periodos, regras, config, campanhasDb, conjuntos, acoes] = base;

  const periodo = (periodoId && periodos.find((p) => p.id === periodoId))
    || periodos.find((p) => p.ativo && p.inicio <= hoje && p.fim >= hoje)
    || periodos.find((p) => p.ativo) || periodos[0] || null;

  const semDado = !estado?.ultima_sync_ok || agora - Date.parse(estado.ultima_sync_ok) > SEM_DADO_HORAS * HORA_MS;
  const saida = {
    configurado: falta.length === 0, falta, faltaBanco: false, pausaLigada: C.pausaLigada(), hoje,
    estado, periodos, periodo, config, metricas: C.METRICAS, semDado,
    acoes: acoes || [],
  };

  // Destino efetivo: o manual vence o do nome.
  const campanhas = campanhasDb.map((c) => ({ ...c, destino_auto: c.destino, destino: c.destino_manual ?? c.destino }));
  const ini = periodo?.inicio ?? C.somarDias(hoje, -6);
  const fim = periodo?.fim ?? hoje;

  const [insights, funilQs, acumulado, leituras] = await Promise.all([
    todas(`mkt_trafego_insights_dia?select=data,campanha_id,gasto,impressoes,cliques,leads&data=gte.${ini}&data=lte.${fim}`, 'data,campanha_id'),
    rest('rpc/mkt_trafego_funil', { method: 'POST', body: { p_inicio: ini, p_fim: fim } }),
    rest('rpc/mkt_trafego_acumulado', { method: 'POST', body: {} }).catch(() => []),
    todas(`mkt_trafego_leituras?select=lido_em,campanha_id,gasto_acum,leads_acum&lido_em=gte.${encodeURIComponent(new Date(agora - 73 * HORA_MS).toISOString())}`, 'lido_em,campanha_id').catch(() => []),
  ]);
  const conhecidos = C.destinosConhecidos((funilQs || []).map((f) => f.segment));
  saida.destinos = conhecidos.map((d) => ({ chave: d.chave, rotulo: d.rotulo }));

  // Somas por campanha no período e hoje.
  const soma = new Map();
  let gastoHoje = 0;
  for (const l of insights) {
    const s = soma.get(l.campanha_id) ?? { gasto: 0, leadsMeta: 0, impressoes: 0, cliques: 0, gastoHoje: 0 };
    s.gasto += Number(l.gasto); s.leadsMeta += Number(l.leads); s.impressoes += Number(l.impressoes); s.cliques += Number(l.cliques);
    if (l.data === hoje) { s.gastoHoje += Number(l.gasto); gastoHoje += Number(l.gasto); }
    soma.set(l.campanha_id, s);
  }
  const comGasto = campanhas.map((c) => ({ ...c, ...(soma.get(c.id) ?? { gasto: 0, leadsMeta: 0, impressoes: 0, cliques: 0, gastoHoje: 0 }) }));
  const funil = C.montarFunil(comGasto, funilQs || [], conhecidos);
  const orc = C.orcamentoDiarioAtivo(campanhas, conjuntos);
  const gastoTotal = comGasto.reduce((s, c) => s + c.gasto, 0);

  saida.funil = funil;
  saida.campanhas = comGasto
    .filter((c) => c.effective_status !== 'ARCHIVED' || c.gasto > 0)
    .map((c) => ({
      id: c.id, nome: c.nome, status: c.status, effective_status: c.effective_status, destino: c.destino, destino_auto: c.destino_auto,
      destino_manual: c.destino_manual, destinoRotulo: C.rotuloDe(c.destino, conhecidos), tipo: c.tipo,
      daily_budget: c.daily_budget, lifetime_budget: c.lifetime_budget, orcamentoDiario: orc.porCampanha.get(c.id) ?? 0,
      gasto: Math.round(c.gasto * 100) / 100, gastoHoje: Math.round(c.gastoHoje * 100) / 100, leadsMeta: c.leadsMeta,
      liberada_ate: c.liberada_ate, vista_em: c.vista_em,
    }))
    .sort((a, b) => (b.effective_status === 'ACTIVE') - (a.effective_status === 'ACTIVE') || b.gasto - a.gasto);
  saida.orcamento = { diario: orc.diario, vitalicias: orc.vitalicias };

  if (periodo) {
    saida.verba = C.calcularVerba({ inicio: periodo.inicio, fim: periodo.fim, valor: Number(periodo.valor), gasto: gastoTotal, gastoHoje, orcamentoDiario: orc.diario, agora });
    saida.cotas = (Array.isArray(periodo.cotas) ? periodo.cotas : []).map((q) => {
      const filtro = (c) => (q.tipo === 'campanha' ? c.id === q.alvo : c.destino === q.alvo);
      const doEscopo = comGasto.filter(filtro);
      const g = doEscopo.reduce((s, c) => s + c.gasto, 0);
      const gh = doEscopo.reduce((s, c) => s + c.gastoHoje, 0);
      const o = C.orcamentoDiarioAtivo(campanhas, conjuntos, filtro);
      return { ...q, verba: C.calcularVerba({ inicio: periodo.inicio, fim: periodo.fim, valor: Number(q.valor), gasto: g, gastoHoje: gh, orcamentoDiario: o.diario, agora }) };
    });
  }

  // Travas avaliadas agora (a tela mostra "como está"; o cron age em cima disso).
  const atual = new Map((acumulado || []).map((a) => [a.campanha_id, { gasto_acum: Number(a.gasto_acum), leads_acum: Number(a.leads_acum) }]));
  const porCampLeituras = new Map();
  for (const l of leituras || []) {
    const a = porCampLeituras.get(l.campanha_id) ?? [];
    a.push(l); porCampLeituras.set(l.campanha_id, a);
  }
  saida.regras = (regras || []).map((r) => {
    const doPeriodo = !r.periodo_id || (periodo && r.periodo_id === periodo.id);
    const medidas = doPeriodo ? medidasDaRegra(r, { periodo, funil, comGasto, gastoTotal, gastoHoje, atual, leituras: porCampLeituras, agora }) : null;
    const avaliacao = r.ativa && medidas ? C.avaliarRegra(r, medidas) : { situacao: r.ativa ? 'sem_dado' : 'desligada', valor: null, limite: Number(r.limite), texto: r.ativa ? 'trava de outro período' : 'desligada' };
    const alvos = C.campanhasDoEscopo(r, campanhas).filter((c) => c.effective_status === 'ACTIVE').map((c) => ({ id: c.id, nome: c.nome }));
    return { ...r, avaliacao, alvosAtivos: alvos, acaoAgora: r.ativa ? C.decidirAcao(r, avaliacao, { pausaLigada: saida.pausaLigada }) : 'nada' };
  });

  saida.alertas = alertasDoPainel(saida, periodo, agora);
  return saida;
}

/** As medidas de uma trava, no escopo dela. */
export function medidasDaRegra(r, { periodo, funil, comGasto, gastoTotal, gastoHoje, atual, leituras, agora }) {
  const ids = C.campanhasDoEscopo(r, comGasto).map((c) => c.id);
  const novas = new Set(comGasto.filter((c) => c.vista_em && Date.parse(c.vista_em) > agora - (r.horas ?? 0) * HORA_MS).map((c) => c.id));
  const jan = r.metrica === 'sem_lead' ? C.janelaDeGasto(atual, leituras, ids, r.horas, agora, novas) : { gasto: null, leads: null };
  const cotas = Array.isArray(periodo?.cotas) ? periodo.cotas : [];
  if (r.escopo === 'periodo') {
    const t = funil.total;
    return { gasto: gastoTotal, gastoHoje, leads: t.leads, agendamentos: t.agendamentos, realizadas: t.realizadas, vendas: t.vendas, verba: periodo ? Number(periodo.valor) : null, gastoJanela: jan.gasto, leadsJanela: jan.leads };
  }
  if (r.escopo === 'destino') {
    const linhas = funil.porDestino.filter((g) => g.destino === r.alvo);
    const s = (k) => linhas.reduce((acc, g) => acc + Number(g[k] || 0), 0);
    const doEscopo = comGasto.filter((c) => c.destino === r.alvo);
    const cota = cotas.find((q) => q.tipo === 'destino' && q.alvo === r.alvo);
    return {
      gasto: s('gasto'), gastoHoje: doEscopo.reduce((a, c) => a + c.gastoHoje, 0),
      leads: s('leads'), agendamentos: s('agendamentos'), realizadas: s('realizadas'), vendas: s('vendas'),
      verba: cota ? Number(cota.valor) : null, gastoJanela: jan.gasto, leadsJanela: jan.leads,
    };
  }
  const c = comGasto.find((x) => x.id === r.alvo);
  if (!c) return { gasto: null, gastoHoje: null, leads: null, agendamentos: null, realizadas: null, vendas: null, verba: null, gastoJanela: null, leadsJanela: null };
  const qs = funil.porCampanha.find((x) => x.id === c.id)?.qs ?? null;
  const cota = cotas.find((q) => q.tipo === 'campanha' && q.alvo === c.id);
  return {
    gasto: c.gasto, gastoHoje: c.gastoHoje,
    // Sem UTM no lead, o lead da campanha é o que a Meta conta; agendamento,
    // reunião e venda não dá pra saber → a trava fica "sem dado" (não pausa).
    leads: qs ? qs.leads : c.leadsMeta,
    agendamentos: qs ? qs.agendamentos : null, realizadas: qs ? qs.realizadas : null, vendas: qs ? qs.vendas : null,
    verba: cota ? Number(cota.valor) : null, gastoJanela: jan.gasto, leadsJanela: jan.leads,
  };
}

/** Os avisos que ficam no topo da tela (o cron transforma em aviso no sino). */
function alertasDoPainel(p, periodo, agora) {
  const a = [];
  if (!p.configurado) return a;
  if (p.semDado) {
    a.push({ chave: 'sem_dado', tom: 'erro', texto: `A Meta não é lida há mais de ${SEM_DADO_HORAS} h${p.estado?.ultimo_erro ? ` (${p.estado.ultimo_erro})` : ''}. Os números e as travas estão parados — confira o token (META_ADS_TOKEN).` });
  }
  const v = p.verba;
  if (periodo && v) {
    if (v.estouroProgramado > 0 && v.estouraNoDia) {
      a.push({ chave: 'programado', tom: 'erro', texto: `Do jeito que está programado na Meta (${C.brl(v.orcamentoDiario)}/dia), estoura ${C.brl(v.estouroProgramado)} no dia ${C.dataBr(v.estouraNoDia)}. Diária segura: ${C.brl(v.diariaSegura)}.` });
    }
    if (v.acabaNoDia && v.acabaNoDia < periodo.fim) {
      a.push({ chave: 'saldo', tom: 'aviso', texto: `No ritmo atual (${C.brl(v.mediaDiaria)}/dia), a verba acaba no dia ${C.dataBr(v.acabaNoDia)} — antes do fim do período (${C.dataBr(periodo.fim)}).` });
    }
    if (v.saldo <= 0 && v.diasRestantes > 0) a.push({ chave: 'zerou', tom: 'erro', texto: `A verba do período acabou (${C.brl(v.gasto)} de ${C.brl(Number(periodo.valor))}).` });
  }
  return a;
}

// ── agir (cron) ─────────────────────────────────────────────────────────────
export async function agir({ fetchImpl = fetch, agora = Date.now(), mudancas = [] } = {}) {
  const p = await montarPainel({ agora });
  if (!p.configurado || p.faltaBanco) return { pulado: true };
  const hoje = p.hoje;
  const feitos = [];
  const cfg = (() => { try { return metaConfig(); } catch { return null; } })();
  const campPorId = new Map((p.campanhas || []).map((c) => [c.id, c]));

  // 1) Mudanças vistas na leitura.
  for (const m of mudancas) {
    if (m.tipo === 'orcamento_subiu') {
      const t = `Orçamento subiu por fora do QS: ${m.nome}`;
      const x = `${m.nivel === 'conjunto' ? 'Conjunto' : 'Campanha'} passou de ${C.brl(m.de)} para ${C.brl(m.para)} por dia.`;
      const chave = `orc:${m.id}:${m.para}`;
      if (await registrar({ tipo: 'alerta', alvo_tipo: m.nivel, alvo_id: m.id, alvo_nome: m.nome, antes: { daily_budget: m.de }, depois: { daily_budget: m.para }, detalhe: x, chave })) {
        await avisar(t, x, chave); feitos.push(chave);
      }
    } else if (m.tipo === 'campanha_nova') {
      const t = m.foraDoPlano ? `Campanha nova FORA DO PLANO: ${m.nome}` : `Campanha nova no ar: ${m.nome}`;
      const x = m.foraDoPlano ? 'Ela não está em nenhuma cota do período de verba.' : 'Apareceu ativa na leitura da Meta.';
      const chave = `nova:${m.id}`;
      if (await registrar({ tipo: 'alerta', alvo_tipo: 'campanha', alvo_id: m.id, alvo_nome: m.nome, detalhe: x, chave })) {
        await avisar(t, x, chave); feitos.push(chave);
      }
    }
  }

  // 2) Alertas do painel (sem dado, programado estoura, saldo acabando). Um por dia (sem dado: um a cada 6 h).
  for (const a of p.alertas || []) {
    const bloco = a.chave === 'sem_dado' ? `${hoje}:${Math.floor(((agora / HORA_MS) - 3) % 24 / 6)}` : hoje;
    const chave = `alerta:${a.chave}:${p.periodo?.id ?? '-'}:${bloco}`;
    if (await registrar({ tipo: 'alerta', alvo_tipo: a.chave === 'sem_dado' ? 'conta' : 'periodo', alvo_id: p.periodo?.id ?? null, alvo_nome: p.periodo?.nome ?? null, detalhe: a.texto, chave })) {
      await avisar(a.chave === 'sem_dado' ? 'Meta Ads sem leitura' : `Verba: ${p.periodo?.nome ?? ''}`, a.texto, chave); feitos.push(chave);
    }
  }
  if (p.semDado) return { feitos, travas: 'puladas: dado velho' }; // não julga com número parado

  // 3) Travas.
  for (const r of p.regras || []) {
    if (!r.ativa || r.acaoAgora === 'nada') continue;
    const av = r.avaliacao;
    const base = {
      regra_id: r.id, regra_nome: r.nome, metrica: r.metrica, valor_medido: av.valor, limite: av.limite,
      alvo_tipo: r.escopo === 'campanha' ? 'campanha' : r.escopo, alvo_id: r.alvo ?? p.periodo?.id ?? null, alvo_nome: r.alvo_rotulo ?? p.periodo?.nome ?? null,
    };
    const titulo = `Trava "${r.nome}": ${av.texto}`;
    if (r.acaoAgora === 'avisar') {
      const chave = `aviso:${r.id}:${av.situacao}:${hoje}`;
      if (await registrar({ ...base, tipo: 'aviso', detalhe: av.texto, chave })) { await avisar(titulo, av.situacao === 'alerta' ? 'Passou de 80% do limite.' : 'Só aviso (a trava está em "só avisar").', chave); feitos.push(chave); }
      continue;
    }
    const alvos = r.alvosAtivos || [];
    if (r.acaoAgora === 'pausaria') {
      const chave = `pausaria:${r.id}:${hoje}`;
      const det = alvos.length ? `Pausaria ${alvos.length} campanha(s): ${alvos.map((a) => a.nome).join('; ')}` : 'Nada ativo no escopo pra pausar.';
      if (await registrar({ ...base, tipo: 'pausaria', antes: { campanhas: alvos.map((a) => ({ id: a.id, nome: a.nome, status: 'ACTIVE' })) }, detalhe: `${av.texto}. ${det} (simulação: MKT_TRAFEGO_PAUSA_LIGADA desligada)`, chave })) {
        await avisar(titulo, `${det}. É SIMULAÇÃO: a pausa de verdade está desligada no servidor.`, chave); feitos.push(chave);
      }
      continue;
    }
    // pausar de verdade
    if (!cfg) continue;
    const pausadas = [];
    for (const a of alvos) {
      const c = campPorId.get(a.id);
      if (c?.liberada_ate && Date.parse(c.liberada_ate) > agora) continue; // reativada pelo QS hoje: só avisa
      const chave = `pausa:${r.id}:${a.id}:${hoje}`;
      const linha = await registrar({ ...base, tipo: 'pausa', alvo_tipo: 'campanha', alvo_id: a.id, alvo_nome: a.nome, antes: { status: 'ACTIVE', effective_status: c?.effective_status ?? 'ACTIVE' }, detalhe: av.texto, chave });
      if (!linha) continue; // já pausou hoje por esta trava
      try {
        await mudarStatus(cfg, a.id, 'PAUSED', { fetchImpl });
        await rest(`mkt_trafego_acoes?id=eq.${linha.id}`, { method: 'PATCH', body: { depois: { status: 'PAUSED' } }, prefer: 'return=minimal' });
        await rest(`mkt_trafego_campanhas?id=eq.${encodeURIComponent(a.id)}`, { method: 'PATCH', body: { status: 'PAUSED', effective_status: 'PAUSED' }, prefer: 'return=minimal' });
        pausadas.push(a.nome);
      } catch (e) {
        await rest(`mkt_trafego_acoes?id=eq.${linha.id}`, { method: 'PATCH', body: { tipo: 'erro', detalhe: `Tentou pausar e a Meta recusou: ${String(e?.message || e).slice(0, 300)}` }, prefer: 'return=minimal' }).catch(() => null);
        await avisar(`Trava "${r.nome}" NÃO conseguiu pausar ${a.nome}`, String(e?.message || e).slice(0, 300), `erro:${chave}`);
      }
    }
    if (pausadas.length) {
      const chave = `pausou:${r.id}:${hoje}:${pausadas.length}`;
      await avisar(`Trava "${r.nome}" PAUSOU ${pausadas.length} campanha(s)`, `${av.texto}. Pausadas: ${pausadas.join('; ')}. Reativar só pelo histórico (com confirmação) ou na Meta.`, chave);
      feitos.push(chave);
    }
  }
  await rest('mkt_trafego_estado?id=eq.1', { method: 'PATCH', body: { ultima_avaliacao: new Date(agora).toISOString() }, prefer: 'return=minimal' }).catch(() => null);
  return { feitos };
}

// ── reativar (botão do histórico) ───────────────────────────────────────────
export async function reativar({ acaoId, quem, fetchImpl = fetch, agora = Date.now() }) {
  const cfg = metaConfig();
  const a = (await rest(`mkt_trafego_acoes?select=*&id=eq.${Number(acaoId)}&limit=1`))?.[0];
  if (!a || a.tipo !== 'pausa' || a.alvo_tipo !== 'campanha' || !a.alvo_id) {
    const e = new Error('Só dá pra reativar uma campanha que o QS pausou.'); e.status = 400; throw e;
  }
  await mudarStatus(cfg, a.alvo_id, 'ACTIVE', { fetchImpl });
  // Até o fim do dia as travas só AVISAM sobre ela (senão o próximo cron pausaria de novo).
  const fimDoDia = new Date(C.inicioDoDia(C.somarDias(C.diaSP(agora), 1))).toISOString();
  await rest(`mkt_trafego_campanhas?id=eq.${encodeURIComponent(a.alvo_id)}`, { method: 'PATCH', body: { status: 'ACTIVE', effective_status: 'ACTIVE', liberada_ate: fimDoDia }, prefer: 'return=minimal' });
  await registrar({
    tipo: 'reativacao', regra_id: a.regra_id, regra_nome: a.regra_nome, alvo_tipo: 'campanha', alvo_id: a.alvo_id, alvo_nome: a.alvo_nome,
    antes: { status: 'PAUSED' }, depois: { status: 'ACTIVE', travas_so_avisam_ate: fimDoDia }, quem,
    detalhe: `Reativada pelo QS (pausa #${a.id}).`, chave: `reativa:${a.id}:${agora}`,
  });
  return { ok: true, liberadaAte: fimDoDia };
}
