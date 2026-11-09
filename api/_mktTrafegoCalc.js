// api/_mktTrafegoCalc.js
// -----------------------------------------------------------------------------
// TRÁFEGO › META ADS — a parte PURA (sem banco, sem rede). 03/11/2026 (0265).
//
// Tudo que vira NÚMERO na tela ou DECISÃO de trava mora aqui:
//   • datas no fuso de São Paulo (UTC−3 fixo: o Brasil não tem horário de verão
//     desde 2019; a conta de anúncio da agência também está em São Paulo);
//   • destino a partir do nome da campanha e da Fonte (segment) do lead;
//   • verba do período: ritmo ideal, projeção, diária segura, orçamento programado;
//   • funil por destino e por campanha (safra do lead);
//   • avaliação das travas (gasto mínimo, simulação de pausa).
//
// O motor (api/_mktTrafegoMotor.js) só busca os dados, chama estas funções e
// grava/executa o resultado. A tela recebe o painel PRONTO pela
// /api/mkt-trafego (o QS não compartilha código entre api/ e src/), então não
// existe uma segunda cópia destas contas no front.
// -----------------------------------------------------------------------------

const DIA_MS = 86_400_000;
const FUSO_MS = 3 * 3_600_000; // UTC−3

// ── Datas (São Paulo) ───────────────────────────────────────────────────────
/** 'AAAA-MM-DD' do instante `ms` em São Paulo. */
export function diaSP(ms) {
  return new Date(ms - FUSO_MS).toISOString().slice(0, 10);
}
/** Meia-noite de São Paulo do dia, em ms UTC. */
export function inicioDoDia(dia) {
  return Date.parse(`${dia}T03:00:00Z`);
}
export function somarDias(dia, n) {
  return new Date(Date.parse(`${dia}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
}
/** Quantos dias de `a` até `b`, contando os dois (a=b → 1; b<a → 0). */
export function diasEntre(a, b) {
  const n = Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA_MS) + 1;
  return Math.max(0, n);
}
const minDia = (a, b) => (a < b ? a : b);
const maxDia = (a, b) => (a > b ? a : b);
const r2 = (n) => Math.round(n * 100) / 100;

// ── Nomes e destinos ────────────────────────────────────────────────────────
// Mesma ideia do Dashboard (src/lib/utmMatch.ts): sem emoji, sem acento, sem
// pontuação, minúsculo, espaço simples. A bandeira some, o espaço duplo some,
// "[JAPÃO+CHINA]" vira "japao china".
const EMOJI = new RegExp('[\\uD800-\\uDFFF]|\\uFE0F|\\u200D', 'g');
export function normalizarNome(valor) {
  return String(valor ?? '')
    .replace(EMOJI, '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Destinos que o QS reconhece no nome. `termos` são as formas que aparecem nos
 * nomes de campanha e nas Fontes dos leads (já normalizadas). Os mais longos
 * ganham ("pacote japao" antes de "japao", "turquia e grecia" antes de tudo).
 * Destino que não está aqui mas aparece como "[X] - Canal" na Fonte de algum
 * lead entra sozinho (ver `destinosConhecidos`).
 */
export const DESTINOS_BASE = [
  { chave: 'tailandia', rotulo: 'Tailândia', termos: ['tailandia', 'thailand'] },
  { chave: 'japao', rotulo: 'Japão', termos: ['japao'] },
  { chave: 'china', rotulo: 'China', termos: ['china'] },
  { chave: 'italia', rotulo: 'Itália', termos: ['italia', 'costa amalfitana', 'amalfitana', 'amalfi'] },
  { chave: 'egito', rotulo: 'Egito', termos: ['egito'] },
  { chave: 'peru', rotulo: 'Peru', termos: ['peru'] },
  { chave: 'islandia', rotulo: 'Islândia', termos: ['islandia'] },
  { chave: 'turquia e grecia', rotulo: 'Turquia e Grécia', termos: ['turquia e grecia', 'turquia grecia', 'turquia'] },
  { chave: 'pacote japao', rotulo: 'Pacote Japão', termos: ['pacote japao'] },
  { chave: 'amazonia', rotulo: 'Amazônia', termos: ['amazonia'] },
  { chave: 'atacama', rotulo: 'Atacama', termos: ['atacama'] },
  { chave: 'cancun', rotulo: 'Cancún', termos: ['cancun', 'xcaret'] },
  { chave: 'lisboa', rotulo: 'Lisboa', termos: ['lisboa'] },
];

/** "[Tailândia] - Tráfego" → { bruto: 'Tailândia', canal: 'trafego' }. */
export function lerSegmento(segment) {
  const m = String(segment ?? '').match(/^\s*\[([^\]]+)\]\s*-\s*(.+?)\s*$/);
  if (!m) return { bruto: null, canal: canalDe(segment) };
  return { bruto: m[1].trim(), canal: canalDe(m[2]) };
}
function canalDe(txt) {
  const n = normalizarNome(txt);
  if (/\btrafego\b/.test(n)) return 'trafego';
  if (/\blive\b/.test(n)) return 'live';
  if (/\bgoogle\b/.test(n)) return 'google';
  if (/\borganico\b/.test(n)) return 'organico';
  return 'outro';
}
/** Canais que a Meta paga: lead que veio por eles entra no funil do tráfego. */
export const CANAIS_META = ['trafego', 'live'];
export const NOME_CANAL = { trafego: 'Tráfego', live: 'Live', google: 'Google Ads', organico: 'Orgânico', outro: 'Outro' };

/** A lista final: base + o que só aparece nas Fontes dos leads. */
export function destinosConhecidos(segmentos = []) {
  const lista = DESTINOS_BASE.map((d) => ({ ...d, termos: [...d.termos] }));
  for (const s of segmentos) {
    const { bruto } = lerSegmento(s);
    if (!bruto) continue;
    if (extrairDestinos(bruto, lista).length) continue;
    const n = normalizarNome(bruto);
    if (!n || lista.some((d) => d.chave === n)) continue;
    lista.push({ chave: n, rotulo: bruto, termos: [n] });
  }
  return lista;
}

/**
 * Chaves de destino que aparecem no texto, sem repetir, em ordem alfabética.
 * Casa palavra inteira; o termo mais longo vence e "apaga" o trecho (assim
 * "pacote japao" não conta também como "japao").
 */
export function extrairDestinos(texto, conhecidos = DESTINOS_BASE) {
  let n = ` ${normalizarNome(texto)} `;
  const termos = [];
  for (const d of conhecidos) for (const t of d.termos) termos.push({ t, chave: d.chave });
  termos.sort((a, b) => b.t.length - a.t.length);
  const achadas = new Set();
  for (const { t, chave } of termos) {
    const alvo = ` ${t} `;
    if (n.includes(alvo)) {
      achadas.add(chave);
      n = n.split(alvo).join(' # ');
    }
  }
  return [...achadas].sort();
}
/** Destino manual "vários destinos": gasto rateado pelos leads do canal. */
export const RATEIO = '*';
export const chaveDe = (lista) => (lista.length ? lista.join('+') : null);
export function rotuloDe(chave, conhecidos = DESTINOS_BASE) {
  if (!chave) return 'Sem destino';
  if (chave === RATEIO) return 'Vários (rateio)';
  return chave.split('+').map((c) => conhecidos.find((d) => d.chave === c)?.rotulo ?? c).join(' + ');
}

/** Live (inscrição pra live) ou tráfego direto pra expedição. */
export function tipoDaCampanha(nome) {
  const n = normalizarNome(nome);
  return /\blive\b|\binscricao\b/.test(n) ? 'live' : 'trafego';
}

/** O que o servidor grava na campanha: destino (chave) e tipo. */
export function classificarCampanha(nome, conhecidos = DESTINOS_BASE) {
  return { destino: chaveDe(extrairDestinos(nome, conhecidos)), tipo: tipoDaCampanha(nome) };
}

/**
 * utm_campaign do lead → id da campanha da Meta. Igual ao acharChaveMeta do
 * Dashboard: igual depois de normalizar; senão, um é prefixo do outro (campanha
 * renomeada com sufixo), com no mínimo 12 letras; senão, null (nunca chuta).
 * Também aceita o próprio id da campanha (o macro {{campaign.id}} na URL).
 */
export function acharCampanhaDaUtm(utm, campanhas) {
  const bruto = String(utm ?? '').trim();
  if (!bruto) return null;
  if (/^\d{6,}$/.test(bruto)) return campanhas.find((c) => c.id === bruto)?.id ?? null;
  const alvo = normalizarNome(bruto);
  if (!alvo) return null;
  const nomes = campanhas.map((c) => ({ id: c.id, k: normalizarNome(c.nome) }));
  const igual = nomes.find((c) => c.k === alvo);
  if (igual) return igual.id;
  if (alvo.length < 12) return null;
  const cand = nomes.filter((c) => c.k.length >= 12 && (c.k.startsWith(alvo) || alvo.startsWith(c.k)));
  if (!cand.length) return null;
  cand.sort((a, b) => Math.abs(a.k.length - alvo.length) - Math.abs(b.k.length - alvo.length));
  return cand[0].id;
}

// ── Orçamento programado ────────────────────────────────────────────────────
const ATIVO = 'ACTIVE';
/**
 * Soma dos orçamentos DIÁRIOS que estão valendo agora. CBO: o da campanha.
 * ABO: o dos conjuntos ativos da campanha ativa. Orçamento vitalício não entra
 * na soma (é contado à parte pra tela avisar que existe).
 * `filtro(campanha)` restringe o escopo (destino, campanha).
 */
export function orcamentoDiarioAtivo(campanhas, conjuntos, filtro = () => true) {
  let diario = 0;
  let vitalicias = 0;
  const porCampanha = new Map();
  for (const c of campanhas) {
    if (c.effective_status !== ATIVO || !filtro(c)) continue;
    let v = 0;
    if (Number(c.daily_budget) > 0) v = Number(c.daily_budget);
    else if (Number(c.lifetime_budget) > 0) vitalicias++;
    else {
      for (const j of conjuntos) {
        if (j.campanha_id !== c.id || j.effective_status !== ATIVO) continue;
        if (Number(j.daily_budget) > 0) v += Number(j.daily_budget);
        else if (Number(j.lifetime_budget) > 0) vitalicias++;
      }
    }
    if (v > 0) porCampanha.set(c.id, v);
    diario += v;
  }
  return { diario: r2(diario), vitalicias, porCampanha };
}

// ── Verba do período ────────────────────────────────────────────────────────
/**
 * @param p.inicio,p.fim  'AAAA-MM-DD' (inclusive)
 * @param p.valor         verba total do período (R$)
 * @param p.gasto         gasto no período até agora
 * @param p.gastoHoje     gasto de hoje (já incluso em gasto)
 * @param p.orcamentoDiario soma dos diários ativos (orcamentoDiarioAtivo)
 * @param p.agora         ms
 */
export function calcularVerba({ inicio, fim, valor, gasto, gastoHoje = 0, orcamentoDiario = 0, agora }) {
  const hoje = diaSP(agora);
  const iniMs = inicioDoDia(inicio);
  const fimMs = inicioDoDia(fim) + DIA_MS;
  const pctTempo = Math.min(1, Math.max(0, (agora - iniMs) / (fimMs - iniMs)));
  const pctVerba = valor > 0 ? gasto / valor : 0;
  const ritmoIdeal = valor * pctTempo;
  const saldo = valor - gasto;
  const dentro = hoje >= inicio && hoje <= fim;
  const antes = hoje < inicio;
  // Dias que ainda dá pra gastar, contando HOJE inteiro.
  const diasRestantes = hoje > fim ? 0 : diasEntre(maxDia(hoje, inicio), fim);
  const diariaSegura = diasRestantes > 0 ? Math.max(0, saldo) / diasRestantes : 0;

  // Ritmo atual: média dos dias COMPLETOS (o dia de hoje está pela metade e
  // a Meta não gasta reto ao longo do dia). Sem dia completo ainda, usa a
  // fração decorrida.
  const diasCompletos = dentro ? diasEntre(inicio, hoje) - 1 : (antes ? 0 : diasEntre(inicio, fim));
  let mediaDiaria = 0;
  if (diasCompletos >= 1) mediaDiaria = Math.max(0, gasto - (dentro ? gastoHoje : 0)) / diasCompletos;
  else if (dentro) {
    const frac = (agora - inicioDoDia(hoje)) / DIA_MS;
    mediaDiaria = frac > 0.05 ? gastoHoje / frac : 0;
  }
  const diasDepoisDeHoje = dentro ? diasRestantes - 1 : (antes ? diasRestantes : 0);
  const restoDeHojeRitmo = dentro ? Math.max(0, mediaDiaria - gastoHoje) : 0;
  const projecao = gasto + restoDeHojeRitmo + mediaDiaria * diasDepoisDeHoje;

  // Com o ritmo atual, em que dia o dinheiro acaba?
  let acabaNoDia = null;
  if (projecao > valor && mediaDiaria > 0) {
    if (saldo <= 0) acabaNoDia = minDia(hoje, fim);
    else {
      let acum = restoDeHojeRitmo;
      let d = dentro ? hoje : inicio;
      if (!dentro) acum = mediaDiaria;
      while (acum < saldo && d < fim) { d = somarDias(d, 1); acum += mediaDiaria; }
      acabaNoDia = d;
    }
  }

  // Orçamento PROGRAMADO: do jeito que está configurado na Meta agora.
  const restoDeHojeProg = dentro ? Math.max(0, orcamentoDiario - gastoHoje) : 0;
  const programado = restoDeHojeProg + orcamentoDiario * diasDepoisDeHoje;
  const estouroProgramado = programado - Math.max(0, saldo);
  let estouraNoDia = null;
  if (estouroProgramado > 0.009 && (dentro || antes)) {
    let acum = dentro ? restoDeHojeProg : orcamentoDiario;
    let d = dentro ? hoje : inicio;
    while (acum <= Math.max(0, saldo) && d < fim) { d = somarDias(d, 1); acum += orcamentoDiario; }
    estouraNoDia = d;
  }

  return {
    hoje,
    diasTotais: diasEntre(inicio, fim),
    diasRestantes,
    pctTempo: r2(pctTempo * 100),
    pctVerba: r2(pctVerba * 100),
    gasto: r2(gasto),
    gastoHoje: r2(gastoHoje),
    saldo: r2(saldo),
    ritmoIdeal: r2(ritmoIdeal),
    acimaDoRitmo: r2(gasto - ritmoIdeal),
    mediaDiaria: r2(mediaDiaria),
    projecao: r2(projecao),
    sobraOuFaltaNaProjecao: r2(valor - projecao),
    acabaNoDia,
    diariaSegura: r2(diariaSegura),
    orcamentoDiario: r2(orcamentoDiario),
    programado: r2(programado),
    estouroProgramado: estouroProgramado > 0.009 ? r2(estouroProgramado) : 0,
    estouraNoDia,
  };
}

// ── Funil ───────────────────────────────────────────────────────────────────
/** Custo por unidade. 0 unidades com gasto = Infinity (a trava entende); sem gasto = null. */
export function custoPor(gasto, n) {
  if (n > 0) return gasto / n;
  return gasto > 0 ? Infinity : null;
}
/** Pra mandar pra tela: Infinity vira null + o motivo vai no "semNenhum". */
const paraTela = (v) => (v == null || !Number.isFinite(v) ? null : r2(v));

function zerado() {
  return { gasto: 0, leadsMeta: 0, impressoes: 0, cliques: 0, leads: 0, agendamentos: 0, realizadas: 0, vendas: 0, faturamento: 0 };
}
const NUMERICOS = ['gasto', 'leadsMeta', 'impressoes', 'cliques', 'leads', 'agendamentos', 'realizadas', 'vendas', 'faturamento'];
/** Soma em `a` só os campos numéricos que `a` tem (os de texto ficam intactos). */
function somar(a, b) {
  for (const k of NUMERICOS) if (k in a) a[k] += Number(b[k] || 0);
  return a;
}
/** Os indicadores derivados de uma linha somada. */
export function indicadores(l) {
  return {
    ...l,
    gasto: r2(l.gasto),
    faturamento: r2(l.faturamento),
    cpl: paraTela(custoPor(l.gasto, l.leads)),
    custoAgendamento: paraTela(custoPor(l.gasto, l.agendamentos)),
    custoReuniao: paraTela(custoPor(l.gasto, l.realizadas)),
    cac: paraTela(custoPor(l.gasto, l.vendas)),
    roas: l.gasto > 0 ? r2(l.faturamento / l.gasto) : null,
  };
}

/**
 * Junta Meta (gasto por campanha no período) com o QS (leads da safra por
 * Fonte e utm_campaign).
 *
 * @param campanhas  [{ id, nome, destino, tipo, gasto, leadsMeta, impressoes, cliques, effective_status }]
 * @param linhasQs   [{ segment, utm_campaign, leads, agendamentos, realizadas, vendas, faturamento }]
 * @param conhecidos destinosConhecidos(...)
 *
 * Por DESTINO: chave = destino + canal (Tailândia · Tráfego, Tailândia · Live).
 * A campanha de live ("[LIVE] [INSCRIÇÃO]") paga o lead "[X] - Live"; a de
 * tráfego paga o "[X] - Tráfego". Lead orgânico/Google não entra.
 * Por CAMPANHA: só dá funil do QS quando o lead trouxe utm_campaign; senão a
 * linha mostra o que a Meta conta (gasto, leads da Meta, CPL da Meta).
 */
export function montarFunil(campanhas, linhasQs, conhecidos = DESTINOS_BASE) {
  const grupos = new Map();
  const grupo = (destino, canal) => {
    const k = `${destino}|${canal}`;
    let g = grupos.get(k);
    if (!g) {
      g = { chave: k, destino, canal, rotulo: `${rotuloDe(destino, conhecidos)} · ${NOME_CANAL[canal] ?? canal}`, campanhas: [], ...zerado() };
      grupos.set(k, g);
    }
    return g;
  };

  const semDestino = [];
  const rateio = new Map(); // canal → { gasto, leadsMeta, campanhas }
  let gastoTotal = 0;
  for (const c of campanhas) {
    gastoTotal += Number(c.gasto || 0);
    if (c.destino === RATEIO) {
      const canal = c.tipo === 'live' ? 'live' : 'trafego';
      const r = rateio.get(canal) ?? { gasto: 0, leadsMeta: 0, campanhas: [] };
      r.gasto += Number(c.gasto || 0); r.leadsMeta += Number(c.leadsMeta || 0); r.campanhas.push(c.id);
      rateio.set(canal, r);
      continue;
    }
    if (!c.destino) {
      if (Number(c.gasto) > 0) semDestino.push({ id: c.id, nome: c.nome, gasto: r2(Number(c.gasto)) });
      continue;
    }
    const g = grupo(c.destino, c.tipo === 'live' ? 'live' : 'trafego');
    g.campanhas.push(c.id);
    g.gasto += Number(c.gasto || 0);
    g.leadsMeta += Number(c.leadsMeta || 0);
    g.impressoes += Number(c.impressoes || 0);
    g.cliques += Number(c.cliques || 0);
  }

  // Leads do QS por destino+canal (e por campanha, quando há UTM).
  const porCampanhaQs = new Map();
  const leadsSemCampanha = new Map();
  let leadsPagos = 0;
  let leadsComUtm = 0;
  for (const l of linhasQs) {
    const { bruto, canal } = lerSegmento(l.segment);
    if (!CANAIS_META.includes(canal)) continue;
    const n = { leads: +l.leads || 0, agendamentos: +l.agendamentos || 0, realizadas: +l.realizadas || 0, vendas: +l.vendas || 0, faturamento: +l.faturamento || 0 };
    leadsPagos += n.leads;
    const id = l.utm_campaign ? acharCampanhaDaUtm(l.utm_campaign, campanhas) : null;
    if (id) {
      leadsComUtm += n.leads;
      porCampanhaQs.set(id, somar(porCampanhaQs.get(id) ?? { leads: 0, agendamentos: 0, realizadas: 0, vendas: 0, faturamento: 0 }, n));
    }
    const destino = bruto ? chaveDe(extrairDestinos(bruto, conhecidos)) : null;
    if (!destino) {
      const rot = `${l.segment || 'Sem Fonte'}`;
      leadsSemCampanha.set(rot, (leadsSemCampanha.get(rot) ?? 0) + n.leads);
      continue;
    }
    somar(grupo(destino, canal), n);
  }

  // Campanha de "vários destinos" ('*'): o gasto vai pros destinos do mesmo
  // canal na proporção dos leads de cada um. É estimativa — a tela marca.
  let gastoRateado = 0;
  for (const [canal, r] of rateio) {
    const alvos = [...grupos.values()].filter((g) => g.canal === canal && g.leads > 0);
    const totalLeads = alvos.reduce((s, g) => s + g.leads, 0);
    if (!totalLeads) {
      semDestino.push(...r.campanhas.map((id) => campanhas.find((c) => c.id === id)).filter((c) => Number(c.gasto) > 0)
        .map((c) => ({ id: c.id, nome: c.nome, gasto: r2(Number(c.gasto)), motivo: 'rateio sem leads no canal' })));
      continue;
    }
    for (const g of alvos) {
      const parte = r.gasto * (g.leads / totalLeads);
      g.gasto += parte;
      g.gastoRateado = (g.gastoRateado ?? 0) + parte;
      g.leadsMeta += r.leadsMeta * (g.leads / totalLeads);
    }
    gastoRateado += r.gasto;
  }
  for (const g of grupos.values()) {
    if (g.leads > 0 && g.gasto <= 0) leadsSemCampanha.set(g.rotulo, (leadsSemCampanha.get(g.rotulo) ?? 0) + g.leads);
  }

  const porDestino = [...grupos.values()]
    .map((g) => ({ ...indicadores(g), leadsMeta: Math.round(g.leadsMeta), campanhas: g.campanhas, gastoRateado: r2(g.gastoRateado ?? 0) }))
    .sort((a, b) => b.gasto - a.gasto || b.leads - a.leads);

  const porCampanha = campanhas
    .filter((c) => Number(c.gasto) > 0 || c.effective_status === ATIVO)
    .map((c) => {
      const qs = porCampanhaQs.get(c.id);
      const gasto = Number(c.gasto || 0);
      return {
        id: c.id, nome: c.nome, destino: c.destino, destinoRotulo: rotuloDe(c.destino, conhecidos), tipo: c.tipo,
        effective_status: c.effective_status ?? null,
        gasto: r2(gasto), leadsMeta: +c.leadsMeta || 0, impressoes: +c.impressoes || 0, cliques: +c.cliques || 0,
        cplMeta: paraTela(custoPor(gasto, +c.leadsMeta || 0)),
        qs: qs ? indicadores({ ...zerado(), ...qs, gasto }) : null,
      };
    })
    .sort((a, b) => b.gasto - a.gasto);

  const total = porDestino.reduce((acc, g) => somar(acc, g), zerado());
  // O total do funil conta TODO o gasto (inclusive o sem destino) e todos os leads pagos.
  const totalGeral = indicadores({ ...total, gasto: gastoTotal, leadsMeta: campanhas.reduce((s, c) => s + (+c.leadsMeta || 0), 0) });
  const gastoSemDestino = semDestino.reduce((s, c) => s + c.gasto, 0);
  return {
    porDestino,
    porCampanha,
    total: totalGeral,
    semCasar: {
      gastoSemDestino: r2(gastoSemDestino),
      pctGastoCasado: gastoTotal > 0 ? r2(((gastoTotal - gastoSemDestino) / gastoTotal) * 100) : null,
      gastoRateado: r2(gastoRateado),
      campanhasSemDestino: semDestino.sort((a, b) => b.gasto - a.gasto),
      leadsSemCampanha: [...leadsSemCampanha.entries()].map(([rotulo, leads]) => ({ rotulo, leads })).sort((a, b) => b.leads - a.leads),
      leadsPagos,
      leadsComUtm,
    },
  };
}

// ── Travas ──────────────────────────────────────────────────────────────────
export const METRICAS = {
  verba_pct: { rotulo: '% da verba gasta', unidade: '%' },
  gasto_periodo: { rotulo: 'Gasto no período', unidade: 'R$' },
  gasto_dia: { rotulo: 'Gasto de hoje', unidade: 'R$' },
  cpl: { rotulo: 'Custo por lead', unidade: 'R$' },
  custo_agendamento: { rotulo: 'Custo por agendamento', unidade: 'R$' },
  custo_reuniao: { rotulo: 'Custo por reunião realizada', unidade: 'R$' },
  cac: { rotulo: 'CAC (custo por venda)', unidade: 'R$' },
  sem_lead: { rotulo: 'Gastou sem nenhum lead', unidade: 'R$' },
};
/** A trava de verba avisa antes: em 80% do limite. */
export const AVISO_PREVIO_VERBA = 0.8;

/**
 * Avalia UMA trava com as medidas do escopo dela.
 *
 * medidas: { gasto, gastoHoje, leads, agendamentos, realizadas, vendas, verba,
 *            gastoJanela, leadsJanela }  — null em qualquer uma = não dá pra medir.
 *
 * situacao:
 *   'ok'              dentro do limite
 *   'alerta'          verba passou de 80% do limite (só avisa)
 *   'disparou'        passou do limite
 *   'amostra_pequena' gastou menos que o gasto mínimo: não julga ainda
 *   'sem_dado'        a medida não existe pra esse escopo (ex.: campanha sem UTM)
 */
export function avaliarRegra(regra, medidas) {
  const m = medidas || {};
  const limite = Number(regra.limite);
  const minimo = Number(regra.gasto_minimo || 0);
  const res = (situacao, valor, texto) => ({ situacao, valor: valor == null ? null : (Number.isFinite(valor) ? r2(valor) : null), infinito: valor === Infinity, limite, texto });

  const custo = (n) => {
    if (m.gasto == null || n == null) return res('sem_dado', null, 'sem dado pra esse escopo');
    if (m.gasto < minimo) return res('amostra_pequena', custoPor(m.gasto, n), `gastou ${brl(m.gasto)} de ${brl(minimo)} antes de julgar`);
    const v = custoPor(m.gasto, n);
    if (v == null) return res('ok', null, 'sem gasto');
    return v > limite ? res('disparou', v, Number.isFinite(v) ? `${brl(v)} > ${brl(limite)}` : `${brl(m.gasto)} gastos e nenhum ainda`) : res('ok', v, `${brl(v)} ≤ ${brl(limite)}`);
  };

  switch (regra.metrica) {
    case 'verba_pct': {
      if (m.gasto == null || !(m.verba > 0)) return res('sem_dado', null, 'sem verba definida pra esse escopo');
      const pct = (m.gasto / m.verba) * 100;
      if (pct >= limite) return res('disparou', pct, `${r2(pct)}% da verba (${brl(m.gasto)} de ${brl(m.verba)})`);
      if (pct >= limite * AVISO_PREVIO_VERBA) return res('alerta', pct, `${r2(pct)}% da verba (${brl(m.gasto)} de ${brl(m.verba)})`);
      return res('ok', pct, `${r2(pct)}% da verba`);
    }
    case 'gasto_periodo':
      if (m.gasto == null) return res('sem_dado', null, 'sem dado');
      return m.gasto > limite ? res('disparou', m.gasto, `${brl(m.gasto)} > ${brl(limite)}`) : res('ok', m.gasto, `${brl(m.gasto)} ≤ ${brl(limite)}`);
    case 'gasto_dia':
      if (m.gastoHoje == null) return res('sem_dado', null, 'sem dado');
      return m.gastoHoje > limite ? res('disparou', m.gastoHoje, `${brl(m.gastoHoje)} hoje > ${brl(limite)}`) : res('ok', m.gastoHoje, `${brl(m.gastoHoje)} hoje`);
    case 'cpl': return custo(m.leads);
    case 'custo_agendamento': return custo(m.agendamentos);
    case 'custo_reuniao': return custo(m.realizadas);
    case 'cac': return custo(m.vendas);
    case 'sem_lead': {
      if (m.gastoJanela == null || m.leadsJanela == null) return res('sem_dado', null, `ainda sem leitura de ${regra.horas} h atrás`);
      if (m.leadsJanela > 0) return res('ok', m.gastoJanela, `${m.leadsJanela} lead(s) nas últimas ${regra.horas} h`);
      return m.gastoJanela >= limite
        ? res('disparou', m.gastoJanela, `${brl(m.gastoJanela)} em ${regra.horas} h sem nenhum lead`)
        : res('ok', m.gastoJanela, `${brl(m.gastoJanela)} em ${regra.horas} h, ainda sem lead`);
    }
    default:
      return res('sem_dado', null, 'métrica desconhecida');
  }
}

/**
 * O que fazer com o resultado. Pausa só com a regra em 'pausar' E a chave
 * geral ligada; senão é "pausaria" (simulação, vai pro histórico).
 */
export function decidirAcao(regra, avaliacao, { pausaLigada = false } = {}) {
  if (avaliacao.situacao === 'alerta') return 'avisar';
  if (avaliacao.situacao !== 'disparou') return 'nada';
  if (regra.acao !== 'pausar') return 'avisar';
  return pausaLigada ? 'pausar' : 'pausaria';
}

/** A chave geral MKT_TRAFEGO_PAUSA_LIGADA: só '1', 'true', 'sim' ligam. */
export function pausaLigada(env = process.env) {
  return /^(1|true|sim|yes|on)$/i.test(String(env.MKT_TRAFEGO_PAUSA_LIGADA ?? '').trim());
}

/** Quais campanhas uma trava alcança. */
export function campanhasDoEscopo(regra, campanhas) {
  if (regra.escopo === 'campanha') return campanhas.filter((c) => c.id === regra.alvo);
  if (regra.escopo === 'destino') return campanhas.filter((c) => c.destino === regra.alvo);
  return campanhas;
}

/** Gasto e leads (da Meta) nas últimas N horas, pela fotografia acumulada. */
/**
 * `novas`: campanhas que o QS viu pela primeira vez DEPOIS do corte — pra elas
 * a base é zero (tudo que gastaram está dentro da janela). Campanha antiga sem
 * fotografia antes do corte = não dá pra medir ainda (sem_dado).
 */
export function janelaDeGasto(atual, leituras, ids, horas, agora, novas = new Set()) {
  const corte = agora - horas * 3_600_000;
  // O QS ainda não tem fotografia de N horas atrás (acabou de ligar): não mede.
  let maisAntiga = Infinity;
  for (const ls of leituras.values()) for (const l of ls) maisAntiga = Math.min(maisAntiga, Date.parse(l.lido_em));
  if (!(maisAntiga <= corte)) return { gasto: null, leads: null };
  let gasto = 0;
  let leads = 0;
  for (const id of ids) {
    const a = atual.get(id);
    if (!a) continue;
    const minhas = [...(leituras.get(id) ?? [])].sort((x, y) => Date.parse(x.lido_em) - Date.parse(y.lido_em));
    // Sem fotografia nenhuma = não gastou nos últimos dias (só fotografa quem gastou).
    if (!minhas.length) continue;
    // A mais recente ATÉ o corte; se a campanha só começou a gastar depois,
    // a primeira que existe (perde no máximo uma leitura, ~30 min).
    const antes = minhas.filter((l) => Date.parse(l.lido_em) <= corte).pop();
    const base = antes ?? (novas.has(id) ? { gasto_acum: 0, leads_acum: 0 } : minhas[0]);
    gasto += Math.max(0, a.gasto_acum - Number(base.gasto_acum));
    leads += Math.max(0, a.leads_acum - Number(base.leads_acum));
  }
  return { gasto: r2(gasto), leads };
}

// ── Alertas extras ──────────────────────────────────────────────────────────
/**
 * Compara a leitura nova com a anterior da Meta.
 *  - orçamento diário SUBIU (campanha ou conjunto) → alguém mexeu fora do QS
 *  - campanha nova ATIVA que o QS nunca viu; "fora do plano" quando o período
 *    tem divisão por destino/campanha e ela não está em nenhuma cota
 */
export function mudancasDaLeitura({ antes, depois, conjAntes = [], conjDepois = [], periodo = null }) {
  const alertas = [];
  const velhas = new Map(antes.map((c) => [c.id, c]));
  const cotas = Array.isArray(periodo?.cotas) ? periodo.cotas : [];
  for (const c of depois) {
    const v = velhas.get(c.id);
    if (!v) {
      if (c.effective_status === ATIVO && antes.length > 0) {
        const noPlano = !cotas.length || cotas.some((q) => (q.tipo === 'campanha' && q.alvo === c.id) || (q.tipo === 'destino' && q.alvo === c.destino));
        alertas.push({ tipo: 'campanha_nova', id: c.id, nome: c.nome, foraDoPlano: !noPlano });
      }
      continue;
    }
    const a = Number(v.daily_budget || 0);
    const d = Number(c.daily_budget || 0);
    if (d > a + 0.009 && a > 0) alertas.push({ tipo: 'orcamento_subiu', nivel: 'campanha', id: c.id, nome: c.nome, de: a, para: d });
  }
  const conjVelhos = new Map(conjAntes.map((j) => [j.id, j]));
  for (const j of conjDepois) {
    const v = conjVelhos.get(j.id);
    if (!v) continue;
    const a = Number(v.daily_budget || 0);
    const d = Number(j.daily_budget || 0);
    if (d > a + 0.009 && a > 0) alertas.push({ tipo: 'orcamento_subiu', nivel: 'conjunto', id: j.id, nome: j.nome, campanha_id: j.campanha_id, de: a, para: d });
  }
  return alertas;
}

export function brl(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
export const dataBr = (dia) => (dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : '');
