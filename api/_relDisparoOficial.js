// api/_relDisparoOficial.js
// -----------------------------------------------------------------------------
// DISPARO DO RELACIONAMENTO "IGUAL AO MANYCHAT" (0408, 19/11/2026).
//
// O motor OFICIAL do Marketing (0341, api/_mktDisparoOficial.js) adaptado ao
// número do Relacionamento — mesma fila (qs_disparo_campanhas/qs_disparo_envios,
// setor 'relacionamento'), mesmas regras puras de envio (api/_mktOficialRegras.js):
//
//   rodadaRel()          → cron /api/disparos?rel=1: manda o próximo lote no
//                          ritmo, no teto do dia e no limite do tier
//   sincronizarModelosRel() → GET /{waba}/message_templates do número do Rel
//   juntarModelosRel()   → os modelos da Meta entram na lista da tela
//   enviarTeste()        → manda UMA vez pra um número (botão "Mandar teste")
//   registrarClique()    → o link rastreado /l/<envio>/<variável>
//   acaoRelOficial()     → ações rel_* da rota (estado, sincronizar, KPIs,
//                          ritmo, teste, etiquetas, públicos salvos)
//
// TRAVAS (todas pro envio ser REAL): env REL_DISPARO_ENVIO=1 ·
// qs_settings.rel_disparo_simulacao=false · número do Rel conectado com token.
// Com simulação a fila anda e o funil aparece, mas nada sai (wamid "sim:…").
//
// A mensagem que sai vira bolha na conversa do Atendimento (origem 'automatica':
// não conta no prazo/SLA) — é ela que recebe os recibos ✓✓ e alimenta o funil
// (api/_disparo.js conciliar()). O "clicou no botão" é api/_relDisparoBotoes.js.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { credenciaisDaMeta, graph } from './_meta.js';
import { foneDestino, valoresDasVariaveis, preencher, enviarTemplate, naJanela } from './_disparo.js';
import { numeroDoRelacionamento, numeroConectado } from './_relWa.js';
import { gravarRel } from './_relEntrada.js';
import { saudeDoNumero } from './_mktDisparoOficial.js';
import {
  calcularFolga, pausaEntreEnvios, classificarErroMeta, modeloDaMeta, modeloParaTela,
  montarComponentes, pacoteDoEnvio, custoEstimado,
} from './_mktOficialRegras.js';
import {
  RITMO_REL, travasDoEnvioRel, paramsComLinks, lerClique, urlSegura, normalizarEtiqueta,
  listaDeEtiquetas, lerPlanilhaEtiquetas, telefoneDaPlanilha,
} from './_relDisparoRegras.js';

const TRAVA_MS = 5 * 60_000;
const BRT = 3 * 3600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
export const BASE_PUBLICA = () => String(process.env.QS_URL_PUBLICA || 'https://qs.setuforeuvouviagens.com.br').replace(/\/+$/, '');

const lerSetting = async (key) =>
  (await rest(`qs_settings?select=value&key=eq.${key}&limit=1`).catch(() => null))?.[0]?.value;

/** A trava da Vercel. Só "1" liga. */
export const envLigadoRel = () => String(process.env.REL_DISPARO_ENVIO || '').trim() === '1';

/** Interruptor, ritmo e preços do Rel. Leitura falhou = simulação. */
export async function lerConfigRel() {
  const [sim, ritmo, precos] = await Promise.all([
    lerSetting('rel_disparo_simulacao'), lerSetting('rel_disparo_ritmo'), lerSetting('mkt_disparo_precos'),
  ]);
  return {
    simulacao: sim !== false && sim !== 'false',
    envLigado: envLigadoRel(),
    ritmo: { ...RITMO_REL, ...(ritmo && typeof ritmo === 'object' ? ritmo : {}) },
    precos: precos && typeof precos === 'object' ? precos : { moeda: 'BRL' },
  };
}

/** { phone_number_id, numero, rotulo } do Rel, só se conectado com token guardado. */
export async function lerNumeroRel() {
  const n = await numeroDoRelacionamento();
  if (!numeroConectado(n)) return n ? { ...n, conectado: false } : null;
  return { phone_number_id: n.phone_number_id, numero: n.numero, rotulo: n.nome_verificado || 'Relacionamento', conectado: true };
}

async function patchEnvio(id, body, filtro = '') {
  try {
    await rest(`qs_disparo_envios?id=eq.${id}${filtro}`, { method: 'PATCH', prefer: 'return=minimal', body });
    return true;
  } catch {
    // 0408/0341 não aplicadas: tenta sem as colunas novas (perder o "enviado" faria mandar DE NOVO).
    const novas = ['erro_codigo', 'cobranca_categoria', 'cobravel', 'clicou_em', 'botao'];
    const basico = Object.fromEntries(Object.entries(body).filter(([k]) => !novas.includes(k)));
    if (Object.keys(basico).length === Object.keys(body).length) return false;
    return rest(`qs_disparo_envios?id=eq.${id}${filtro}`, { method: 'PATCH', prefer: 'return=minimal', body: basico }).then(() => true, () => false);
  }
}

async function pausarCampanha(id, motivo) {
  await rest(`qs_disparo_campanhas?id=eq.${id}&status=eq.enviando`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'pausada', pausada_em: new Date().toISOString(), ultimo_erro: String(motivo).slice(0, 300) },
  }).catch(() => null);
}

/** A pessoa desligou marketing no WhatsApp (131050): vale como "pediu pra parar". */
async function marcarOptoutCliente(clienteId) {
  if (!clienteId) return;
  await rest(`rel_clientes?id=eq.${clienteId}&optout_em=is.null`, {
    method: 'PATCH', prefer: 'return=minimal', body: { optout_em: new Date().toISOString() },
  }).catch(() => null);
}

// ── Modelos (WABA do Relacionamento) ────────────────────────────────────────

export async function sincronizarModelosRel() {
  const numero = await lerNumeroRel();
  if (!numero?.phone_number_id) return { erro: 'O Relacionamento não tem número conectado.' };
  const cr = await credenciaisDaMeta(numero.phone_number_id).catch(() => null);
  if (!cr?.token) return { erro: 'O QS não tem o token do número do Relacionamento (conecte pelo painel de WhatsApp).' };
  if (!cr.waba) return { erro: 'Não achei a WABA do número do Relacionamento.' };

  const inicio = new Date().toISOString();
  const base = `/${cr.waba}/message_templates?fields=id,name,language,status,category,parameter_format,components,rejected_reason&limit=100`;
  const itens = [];
  let depois = null;
  for (let pagina = 0; pagina < 20; pagina++) {
    const j = await graph(depois ? `${base}&after=${encodeURIComponent(depois)}` : base, { token: cr.token, timeoutMs: 20_000 });
    itens.push(...(j?.data || []));
    depois = j?.paging?.cursors?.after || null;
    if (!j?.paging?.next || !depois) break;
  }
  const linhas = itens.map((t) => ({ ...modeloDaMeta(t, cr.waba), sincronizado_em: inicio })).filter((m) => m.nome);
  for (let i = 0; i < linhas.length; i += 200) {
    await rest('rel_wa_modelos?on_conflict=nome,idioma', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: linhas.slice(i, i + 200), timeoutMs: 20_000,
    });
  }
  await rest(`rel_wa_modelos?sincronizado_em=lt.${encodeURIComponent(inicio)}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => null);
  return { total: linhas.length, aprovados: linhas.filter((m) => m.status === 'APPROVED').length };
}

export async function lerModelosRel() {
  return (await rest('rel_wa_modelos?select=*&order=nome.asc').catch(() => [])) || [];
}

/** Modelo da Meta no formato da tela, marcado como do Relacionamento. */
export const modeloRelParaTela = (m) => ({ ...modeloParaTela(m), setor: 'relacionamento' });

/** Lista da tela do Rel = os da WABA do Rel + os montados à mão do Rel sem par na Meta. */
export async function juntarModelosRel(modelosCfg) {
  const meta = (await lerModelosRel()).map(modeloRelParaTela);
  const k = (m) => `${m.nome}|${m.idioma || 'pt_BR'}`;
  const tem = new Set(meta.map(k));
  return [...meta, ...(modelosCfg || []).filter((m) => (!m.setor || m.setor === 'relacionamento') && !tem.has(k(m)))];
}

async function modeloDaCampanha(c, modo) {
  const r = await rest(`rel_wa_modelos?select=*&nome=eq.${encodeURIComponent(c.modelo_nome)}&idioma=eq.${encodeURIComponent(c.modelo_idioma || 'pt_BR')}&limit=1`).catch(() => null);
  const meta = r?.[0] || null;
  if (meta) return meta.status === 'APPROVED' ? { modelo: meta } : { erro: `O modelo "${c.modelo_nome}" está ${meta.status || 'sem status'} na Meta — só APROVADO dispara.` };
  if (modo === 'real') return { erro: `O modelo "${c.modelo_nome}" não está na WABA do Relacionamento (clique em "Sincronizar modelos").` };
  // Simulação com modelo montado à mão: usa o corpo guardado na campanha.
  if (!c.modelo_corpo) return { erro: 'Modelo não encontrado.' };
  return { modelo: { nome: c.modelo_nome, idioma: c.modelo_idioma || 'pt_BR', categoria: 'MARKETING', corpo: c.modelo_corpo, formato_parametros: 'POSITIONAL', cabecalho_formato: null, botoes: [] } };
}

// ── Um envio ────────────────────────────────────────────────────────────────

async function destinoDaViagem(viagemId, cache) {
  if (!viagemId) return null;
  if (cache.has(viagemId)) return cache.get(viagemId);
  const v = (await rest(`rel_viagens?select=destino,titulo&id=eq.${viagemId}&limit=1`).catch(() => null))?.[0];
  const d = v?.destino || v?.titulo || null;
  cache.set(viagemId, d);
  return d;
}

/**
 * Monta e manda (ou simula) um modelo pra um destinatário. Não mexe na fila.
 * Devolve { wamid, simulado?, texto } ou { erro, codigo?, nivel? }.
 */
async function mandarModelo({ c, modelo, modo, cr, alvo, envioId }) {
  // Sem envio (o teste): o link vai direto, sem rastreio.
  const params = envioId
    ? paramsComLinks(c.params, BASE_PUBLICA(), envioId)
    : Object.fromEntries(Object.entries(c.params || {}).map(([k, x]) => [k, x?.fonte === 'link' ? { fonte: 'texto', valor: String(x.valor || '') } : x]));
  const ctx = { nomesSdr: new Map(), grupoLink: c.grupo_link || null };
  const valores = valoresDasVariaveis(params, alvo, ctx);
  const extra = c.envio_extra && typeof c.envio_extra === 'object' ? c.envio_extra : {};
  const topo = extra.topo ? valoresDasVariaveis({ t: extra.topo }, alvo, ctx).t : null;
  const botoes = Object.fromEntries(Object.entries(extra.botoes || {}).map(([i, cfg]) => [i, valoresDasVariaveis({ b: cfg }, alvo, ctx).b]));
  const comp = montarComponentes({ modelo, corpo: valores, topo, midia: extra.midia || null, botoes });
  if (comp.erro) return { erro: comp.erro, nivel: comp.nivel };
  const texto = preencher(modelo.corpo, valores).texto || '';

  if (modo === 'simulacao') {
    const r = await enviarTemplate({ phoneNumberId: cr?.phoneId || null, para: alvo.telefone, modelo: modelo.nome, idioma: modelo.idioma, params: valores, simulacao: true });
    return { ...r, texto };
  }
  try {
    const j = await graph(`/${cr.phoneId}/messages`, {
      method: 'POST', token: cr.token, timeoutMs: 20_000,
      body: pacoteDoEnvio({ para: alvo.telefone, modelo, components: comp.components, marca: envioId ? `rel:${envioId}` : 'rel:teste' }),
    });
    const wamid = j?.messages?.[0]?.id || null;
    return wamid ? { wamid, texto } : { erro: 'a Meta não devolveu o id da mensagem' };
  } catch (e) {
    return { erro: e?.message, codigo: e?.metaCode };
  }
}

/** A bolha na conversa do Atendimento (só envio real). */
async function bolhaNaConversa({ phoneId, telefone, wamid, texto, campanha }) {
  await gravarRel({
    phoneId, telefone, wamid, direcao: 'out', origem: 'automatica',
    texto: texto || `[modelo ${campanha?.modelo_nome || ''}]`, autorNome: `Disparo: ${String(campanha?.nome || '').slice(0, 60)}`, status: 'sent',
  }).catch((e) => console.warn('[rel-disparo] bolha não gravada:', e?.message));
}

/**
 * Confere de novo na hora e manda UM envio da fila. Devolve:
 *   { feito: true } | { acao: 'esperar', motivo } | { acao: 'parar', motivo }
 */
async function enviarUmRel({ envio, c, modelo, modo, cr, cache }) {
  const pular = (motivo) => patchEnvio(envio.id, { status: 'pulado', motivo }).then(() => ({ feito: true }));
  const devolver = (r) => patchEnvio(envio.id, { pego_em: null }).then(() => r);
  try {
    const tel = foneDestino(envio.telefone);
    if (!tel) return pular('telefone inválido');
    if (envio.cliente_id) {
      const ro = await rest('rpc/rel_cliente_optout', { method: 'POST', body: { p_cliente: envio.cliente_id } });
      if (ro === true) return pular('pediu para não receber');
    }
    const alvo = { nome: envio.nome, sdr_id: null, destino: await destinoDaViagem(envio.viagem_id, cache), telefone: tel };
    const r = await mandarModelo({ c, modelo, modo, cr, alvo, envioId: envio.id });

    if (r.nivel === 'campanha') return devolver({ acao: 'parar', motivo: r.erro });
    if (r.nivel === 'destinatario') return pular(r.erro);
    if (!r.wamid) {
      const k = classificarErroMeta(r.codigo, r.erro);
      if (k.acao === 'esperar' || k.acao === 'parar') return devolver({ acao: k.acao, motivo: k.motivo });
      if (k.acao === 'optout') {
        await marcarOptoutCliente(envio.cliente_id);
        await patchEnvio(envio.id, { status: 'pulado', motivo: k.motivo, erro_codigo: k.codigo });
        return { feito: true };
      }
      await patchEnvio(envio.id, { status: 'erro', motivo: k.motivo.slice(0, 300), erro_codigo: k.codigo, tentativas: (envio.tentativas || 0) + 1 });
      return { feito: true };
    }

    await patchEnvio(envio.id, {
      status: 'enviado', wamid: r.wamid, simulado: Boolean(r.simulado), enviado_em: new Date().toISOString(),
      tentativas: (envio.tentativas || 0) + 1, motivo: r.simulado ? 'simulação' : null,
      cobranca_categoria: String(modelo.categoria || 'MARKETING').toLowerCase(),
    });
    if (!r.simulado) await bolhaNaConversa({ phoneId: cr.phoneId, telefone: tel, wamid: r.wamid, texto: r.texto, campanha: c });
    return { feito: true };
  } catch (e) {
    await patchEnvio(envio.id, { status: 'erro', motivo: String(e?.message || 'erro').slice(0, 300), tentativas: (envio.tentativas || 0) + 1 });
    return { feito: true };
  }
}

// ── A rodada ────────────────────────────────────────────────────────────────

export const inicioDoDiaBRT = (agora) => {
  const w = new Date(agora.getTime() - BRT); w.setUTCHours(0, 0, 0, 0);
  return new Date(w.getTime() + BRT);
};

export async function contar(phone, desde, simulado) {
  if (!phone) return 0;
  const n = await rest('rpc/mkt_disparo_contar', { method: 'POST', body: { p_phone: phone, p_desde: desde.toISOString(), p_simulado: simulado } }).catch(() => null);
  return typeof n === 'number' ? n : Infinity;
}

/** Decide o modo (real/simulação) e as credenciais. { modo, cr, numero, tier } ou { parado }. */
export async function prepararModo(cfg) {
  const numero = await lerNumeroRel();
  if (cfg.simulacao) return { modo: 'simulacao', cr: numero?.phone_number_id ? { phoneId: numero.phone_number_id } : null, numero, tier: cfg.ritmo.tier_padrao };
  const cr = numero?.phone_number_id ? await credenciaisDaMeta(numero.phone_number_id).catch(() => null) : null;
  const t = travasDoEnvioRel({ envLigado: cfg.envLigado, simulacao: cfg.simulacao, numero, temToken: Boolean(cr?.token) });
  if (!t.real) return { parado: `envio real travado: ${t.motivos.join('; ')}` };
  const saude = await saudeDoNumero(numero.phone_number_id, cr);
  if (String(saude?.qualidade || '').toUpperCase() === 'RED') return { parado: 'a qualidade do número do Relacionamento está VERMELHA na Meta — nada sai até melhorar' };
  return { modo: 'real', cr: { ...cr, phoneId: cr.phoneId || numero.phone_number_id }, numero, tier: saude?.tier || cfg.ritmo.tier_padrao };
}

/** A rodada do Rel (cron /api/disparos?rel=1). Nunca lança. */
export async function rodadaRel({ limiteMs = 45_000, agora = new Date() } = {}) {
  const inicio = Date.now();
  const cfg = await lerConfigRel();
  if (!naJanela(cfg.ritmo, agora)) return { parado: 'fora da janela de envio do Relacionamento' };
  const campanhas = (await rest('qs_disparo_campanhas?select=*&setor=eq.relacionamento&status=eq.enviando&order=iniciada_em.asc').catch(() => [])) || [];
  if (!campanhas.length) return { ok: true, campanhas: [] };

  const m0 = await prepararModo(cfg);
  if (m0.parado) return { parado: m0.parado };
  const { modo, cr, numero, tier } = m0;
  const ph = numero?.phone_number_id || null;
  const sim = modo === 'simulacao';
  const [n24, nHoje] = await Promise.all([contar(ph, new Date(agora.getTime() - 86_400_000), sim), contar(ph, inicioDoDiaBRT(agora), sim)]);
  let folga = calcularFolga({
    tier, margem: cfg.ritmo.margem_tier, porDia: cfg.ritmo.por_dia, enviados24h: n24, enviadosHoje: nHoje,
    porSegundo: cfg.ritmo.por_segundo, segundos: limiteMs / 1000,
  });
  const pausa = pausaEntreEnvios(cfg.ritmo.por_segundo);
  const velho = new Date(Date.now() - TRAVA_MS).toISOString();
  const cache = new Map();
  const resumo = [];
  let parouNumero = null;

  for (const c of campanhas) {
    if (folga <= 0 || parouNumero || Date.now() - inicio > limiteMs) break;
    const m = await modeloDaCampanha(c, modo);
    if (m.erro) { await pausarCampanha(c.id, m.erro); resumo.push({ campanha: c.nome, pausada: m.erro }); continue; }

    const cands = (await rest(
      `qs_disparo_envios?select=id,pego_em&campanha_id=eq.${c.id}&status=eq.pendente` +
      `&or=(pego_em.is.null,pego_em.lt.${encodeURIComponent(velho)})&order=criado_em.asc&limit=${Math.min(folga, 500)}`
    ).catch(() => [])) || [];
    let feitos = 0;
    let pausou = null;
    for (const cand of cands) {
      if (folga <= 0 || Date.now() - inicio > limiteMs) break;
      const pegou = (await rest(
        `qs_disparo_envios?id=eq.${cand.id}&status=eq.pendente&or=(pego_em.is.null,pego_em.lt.${encodeURIComponent(velho)})`,
        { method: 'PATCH', prefer: 'return=representation', body: { pego_em: new Date().toISOString() } }
      ).catch(() => null))?.[0];
      if (!pegou) continue;
      if (cand.pego_em && modo === 'real') {
        await patchEnvio(pegou.id, { status: 'erro', motivo: 'envio interrompido no meio — pode ter saído; não reenviado pra não duplicar' });
        continue;
      }
      const r = await enviarUmRel({ envio: pegou, c, modelo: m.modelo, modo, cr, cache });
      if (r.acao === 'esperar') { parouNumero = r.motivo; break; }
      if (r.acao === 'parar') { pausou = r.motivo; break; }
      feitos++;
      folga--;
      if (pausa) await dormir(pausa);
    }
    if (pausou) await pausarCampanha(c.id, pausou);
    if (parouNumero) await rest(`qs_disparo_campanhas?id=eq.${c.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ultimo_erro: parouNumero.slice(0, 300) } }).catch(() => null);
    const resta = await rest(`qs_disparo_envios?select=id&campanha_id=eq.${c.id}&status=eq.pendente&limit=1`).catch(() => [1]);
    if (!pausou && Array.isArray(resta) && resta.length === 0) {
      await rest(`qs_disparo_campanhas?id=eq.${c.id}&status=eq.enviando`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'concluida', concluida_em: new Date().toISOString() } }).catch(() => null);
    }
    resumo.push({ campanha: c.nome, feitos, ...(pausou ? { pausada: pausou } : {}) });
  }
  return { ok: true, modo, tier, folgaRestante: folga, ...(parouNumero ? { esperando: parouNumero } : {}), campanhas: resumo };
}

// ── Teste: UMA mensagem pra um número ───────────────────────────────────────

/**
 * Manda o modelo da campanha (ou o rascunho da tela) pra um número só, AGORA.
 * Precisa da env REL_DISPARO_ENVIO=1 e do token (a simulação geral não vale
 * aqui: quem clica em "Mandar teste" quer ver a mensagem no celular).
 */
export async function enviarTeste({ telefone, campanha, nomeTeste }) {
  const tel = foneDestino(telefone);
  if (!tel) return { erro: 'Telefone inválido. Use DDD + número.' };
  if (!envLigadoRel()) return { erro: 'O envio real está travado na Vercel (REL_DISPARO_ENVIO=1). Sem ele nem o teste sai.' };
  const numero = await lerNumeroRel();
  if (!numero?.conectado) return { erro: 'O número do Relacionamento não está conectado.' };
  const cr = await credenciaisDaMeta(numero.phone_number_id).catch(() => null);
  if (!cr?.token) return { erro: 'O QS não tem o token do número do Relacionamento.' };
  const m = await modeloDaCampanha(campanha, 'real');
  if (m.erro) return { erro: m.erro };
  const r = await mandarModelo({
    c: campanha, modelo: m.modelo, modo: 'real', cr: { ...cr, phoneId: cr.phoneId || numero.phone_number_id },
    alvo: { nome: nomeTeste || 'Teste', telefone: tel, destino: campanha._destinoTeste || 'Japão', sdr_id: null },
    envioId: null,
  });
  if (!r.wamid) return { erro: r.erro ? classificarErroMeta(r.codigo, r.erro).motivo : 'A Meta recusou.' };
  await bolhaNaConversa({ phoneId: cr.phoneId || numero.phone_number_id, telefone: tel, wamid: r.wamid, texto: r.texto, campanha: { ...campanha, nome: `TESTE ${campanha.nome || ''}` } });
  return { ok: true, wamid: r.wamid };
}

// ── Clique no link rastreado ────────────────────────────────────────────────

/** /l/<envio>/<variável> → registra o 1º clique e devolve pra onde ir (ou null). */
export async function registrarClique(envioId, variavel) {
  const ok = lerClique(envioId, variavel);
  if (!ok) return null;
  const e = (await rest(`qs_disparo_envios?select=id,campanha_id,clicou_em&id=eq.${ok.envioId}&limit=1`).catch(() => null))?.[0];
  if (!e) return null;
  const c = (await rest(`qs_disparo_campanhas?select=params&id=eq.${e.campanha_id}&limit=1`).catch(() => null))?.[0];
  const cfg = c?.params?.[ok.variavel];
  const destino = cfg?.fonte === 'link' ? String(cfg.valor || '').trim() : '';
  if (!urlSegura(destino)) return null;
  if (!e.clicou_em) await patchEnvio(e.id, { clicou_em: new Date().toISOString(), botao: `link {{${ok.variavel}}}` }, '&clicou_em=is.null');
  return destino;
}

// ── KPIs ────────────────────────────────────────────────────────────────────

async function kpis(campanhaId, precos) {
  const k = await rest('rpc/mkt_disparo_kpis', { method: 'POST', body: { p_campanha: campanhaId } }).catch(() => null);
  if (!k) return null;
  return { ...k, clicaram: k.clicaram ?? 0, botoes: k.botoes ?? {}, custo: custoEstimado(k.cobraveis || {}, precos) };
}

// ── Etiquetas ───────────────────────────────────────────────────────────────

/** Acha os clientes (ids) de cada linha da planilha: telefone (55+DDD+8 finais), CPF ou e-mail. */
async function clientesDaPlanilha(linhas) {
  const ativos = '&mesclado_em_id=is.null&arquivado_em=is.null';
  const porTel = new Map(); const porCpf = new Map(); const porMail = new Map();
  const tels = [...new Set(linhas.map((l) => l.telefone).filter(Boolean))];
  const cpfs = [...new Set(linhas.map((l) => l.cpf).filter(Boolean))];
  const mails = [...new Set(linhas.map((l) => l.email).filter(Boolean))];
  // Telefone: a ficha guarda com máscara variada → compara pelos 8 finais e confere o DDD.
  for (let i = 0; i < tels.length; i += 60) {
    const bloco = tels.slice(i, i + 60);
    const ors = bloco.map((t) => `telefone.ilike.*${t.slice(-4)}`).join(',');
    const achados = (await rest(`rel_clientes?select=id,telefone&or=(${ors})${ativos}&limit=2000`).catch(() => [])) || [];
    for (const a of achados) {
      const d = telefoneDaPlanilha(a.telefone);
      if (!d) continue;
      for (const t of bloco) if (t.slice(2, 4) === d.slice(2, 4) && t.slice(-8) === d.slice(-8)) porTel.set(t, [...(porTel.get(t) || []), a.id]);
    }
  }
  for (let i = 0; i < cpfs.length; i += 100) {
    const achados = (await rest(`rel_clientes?select=id,cpf&cpf=not.is.null${ativos}&or=(${cpfs.slice(i, i + 100).map((c) => `cpf.ilike.*${c.slice(-6)}`).join(',')})&limit=2000`).catch(() => [])) || [];
    for (const a of achados) { const d = String(a.cpf || '').replace(/\D/g, ''); if (cpfs.includes(d)) porCpf.set(d, [...(porCpf.get(d) || []), a.id]); }
  }
  for (let i = 0; i < mails.length; i += 100) {
    const achados = (await rest(`rel_clientes?select=id,email&email=in.(${mails.slice(i, i + 100).map((m) => `"${m}"`).join(',')})${ativos}&limit=2000`).catch(() => [])) || [];
    for (const a of achados) { const d = String(a.email || '').toLowerCase(); porMail.set(d, [...(porMail.get(d) || []), a.id]); }
  }
  return linhas.map((l) => ({ ...l, ids: [...new Set([...(porTel.get(l.telefone) || []), ...(porCpf.get(l.cpf) || []), ...(porMail.get(l.email) || [])])] }));
}

/** Põe (ou tira) etiquetas em vários clientes. Idempotente. */
export async function etiquetar({ ids, etiquetas, tirar = false, origem = 'manual', userId = null }) {
  const lista = listaDeEtiquetas(etiquetas);
  const alvos = [...new Set((ids || []).filter((x) => UUID.test(String(x))))];
  if (!lista.length || !alvos.length) return { mudou: 0 };
  if (tirar) {
    for (let i = 0; i < alvos.length; i += 150) {
      await rest(`rel_cliente_etiquetas?cliente_id=in.(${alvos.slice(i, i + 150).join(',')})&etiqueta=in.(${lista.map((t) => `"${t.replace(/"/g, '')}"`).join(',')})`, { method: 'DELETE', prefer: 'return=minimal' });
    }
    return { mudou: alvos.length };
  }
  const linhas = alvos.flatMap((id) => lista.map((etiqueta) => ({ cliente_id: id, etiqueta, origem, criado_por: userId })));
  for (let i = 0; i < linhas.length; i += 500) {
    await rest('rel_cliente_etiquetas?on_conflict=cliente_id,etiqueta', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: linhas.slice(i, i + 500) });
  }
  return { mudou: alvos.length };
}

// ── Ações da tela (vêm por api/disparos.js, já com permissão conferida) ─────

const num = (v, min, max, d) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) ? Number(v) : d));
const hhmm = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : d);
const gestorOuAdmin = (u) => u.role === 'admin' || u.role === 'gestor';

export async function estadoRel({ conferir = false } = {}) {
  const cfg = await lerConfigRel();
  const numero = await lerNumeroRel();
  const cr = numero?.conectado ? await credenciaisDaMeta(numero.phone_number_id).catch(() => null) : null;
  const travas = travasDoEnvioRel({ envLigado: cfg.envLigado, simulacao: cfg.simulacao, numero: numero?.conectado ? numero : null, temToken: Boolean(cr?.token) });
  const modelos = await lerModelosRel();
  const saude = conferir && cr ? await saudeDoNumero(numero.phone_number_id, cr) : null;
  return {
    simulacao: cfg.simulacao, envLigado: cfg.envLigado, real: travas.real, faltam: travas.motivos,
    temToken: Boolean(cr?.token), numero, ritmo: cfg.ritmo, precos: cfg.precos, saude,
    modelos: { total: modelos.length, aprovados: modelos.filter((m) => m.status === 'APPROVED').length, sincronizadoEm: modelos[0]?.sincronizado_em || null },
  };
}

export async function acaoRelOficial({ acao, body, u }) {
  if (acao === 'rel_oficial_estado') return { status: 200, json: await estadoRel({ conferir: body.conferir === true }) };

  if (acao === 'rel_sincronizar_modelos') {
    try {
      const r = await sincronizarModelosRel();
      return r.erro ? { status: 400, json: { error: r.erro } } : { status: 200, json: { ok: true, ...r } };
    } catch (e) {
      return { status: 502, json: { error: `A Meta respondeu: ${e?.message || 'falhou'}` } };
    }
  }

  if (acao === 'rel_kpis') {
    if (!UUID.test(String(body.campanhaId || ''))) return { status: 400, json: { error: 'campanha inválida' } };
    const c = (await rest(`qs_disparo_campanhas?select=id,setor,status,ultimo_erro&id=eq.${body.campanhaId}&limit=1`).catch(() => null))?.[0];
    if (!c || c.setor !== 'relacionamento') return { status: 404, json: { error: 'Campanha do Relacionamento não encontrada.' } };
    const cfg = await lerConfigRel();
    const [k, falhas, interagiram] = await Promise.all([
      kpis(c.id, cfg.precos),
      rest(`qs_disparo_envios?select=nome,telefone,motivo,erro_codigo,status&campanha_id=eq.${c.id}&status=in.(erro,pulado)&order=criado_em.desc&limit=30`).catch(() => []),
      rest(`qs_disparo_envios?select=nome,cliente_id,botao,clicou_em,respondeu_em,status&campanha_id=eq.${c.id}&or=(clicou_em.not.is.null,respondeu_em.not.is.null)&order=respondeu_em.desc.nullslast&limit=50`).catch(() => []),
    ]);
    return {
      status: 200,
      json: {
        status: c.status, ultimo_erro: c.ultimo_erro, kpis: k,
        falhas: (falhas || []).map((f) => ({ ...f, telefone: `…${String(f.telefone || '').slice(-4)}` })),
        interagiram: interagiram || [],
      },
    };
  }

  if (acao === 'rel_salvar_ritmo') {
    if (u.role !== 'admin') return { status: 403, json: { error: 'Só admin muda o ritmo.' } };
    const r = body.ritmo || {};
    const ritmo = {
      por_segundo: num(r.por_segundo, 0.2, 20, 3), por_dia: Math.round(num(r.por_dia, 1, 20000, 400)),
      margem_tier: num(r.margem_tier, 0.1, 1, 0.6), inicio: hhmm(r.inicio, '09:00'), fim: hhmm(r.fim, '19:00'),
      dias: Array.isArray(r.dias) ? [...new Set(r.dias.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : RITMO_REL.dias,
      tier_padrao: /^TIER_[0-9A-Z]+$/.test(String(r.tier_padrao || '')) ? r.tier_padrao : 'TIER_250',
      intervalo_dias: Math.round(num(r.intervalo_dias, 0, 90, 7)),
    };
    await rest('qs_settings?on_conflict=key', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { key: 'rel_disparo_ritmo', value: ritmo } });
    return { status: 200, json: { ok: true, ritmo } };
  }

  if (acao === 'rel_teste') {
    const c = UUID.test(String(body.campanhaId || ''))
      ? (await rest(`qs_disparo_campanhas?select=*&id=eq.${body.campanhaId}&limit=1`).catch(() => null))?.[0]
      : body.rascunho && typeof body.rascunho === 'object'
        ? { nome: String(body.rascunho.nome || 'rascunho'), modelo_nome: body.rascunho.modelo_nome, modelo_idioma: body.rascunho.modelo_idioma || 'pt_BR', params: body.rascunho.params || {}, envio_extra: body.rascunho.envio_extra || {}, grupo_link: body.rascunho.grupo_link || null }
        : null;
    if (!c || (c.setor && c.setor !== 'relacionamento')) return { status: 400, json: { error: 'Escolha o modelo antes de testar.' } };
    const r = await enviarTeste({ telefone: body.telefone, campanha: c, nomeTeste: String(u.name || '').split(/\s+/)[0] });
    return r.erro ? { status: 400, json: { error: r.erro } } : { status: 200, json: r };
  }

  if (acao === 'rel_etiquetar') {
    const lista = listaDeEtiquetas(body.etiquetas);
    if (!lista.length) return { status: 400, json: { error: 'Diga qual etiqueta.' } };
    const tirar = body.tirar === true;
    let ids = Array.isArray(body.clientes) ? body.clientes : [];
    let semFicha = 0;
    let invalidas = 0;
    if (typeof body.planilha === 'string' && body.planilha.trim()) {
      // Planilha: cada linha traz as próprias etiquetas (+ as do campo da tela).
      const p = lerPlanilhaEtiquetas(body.planilha, lista);
      invalidas = p.invalidas;
      const achados = await clientesDaPlanilha(p.linhas);
      semFicha = achados.filter((a) => !a.ids.length).length;
      let mudou = 0;
      const porEtiquetas = new Map();
      for (const a of achados) for (const id of a.ids) {
        const k = a.etiquetas.join('|');
        porEtiquetas.set(k, [...(porEtiquetas.get(k) || []), id]);
      }
      for (const [k, grupo] of porEtiquetas) mudou += (await etiquetar({ ids: grupo, etiquetas: k.split('|'), tirar, origem: 'importacao', userId: u.id })).mudou;
      return { status: 200, json: { ok: true, clientes: mudou, sem_ficha: semFicha, linhas_invalidas: invalidas } };
    }
    if (body.publico && typeof body.publico === 'object') {
      // Todo mundo de um filtro (ex.: "quem foi pro Japão" → etiqueta "japão").
      const linhas = await rest('rpc/qs_disparo_publico_rel', { method: 'POST', body: { p_publico: body.publico }, timeoutMs: 25_000 });
      ids = (linhas || []).map((l) => l.cliente_id);
    }
    if (!ids.length) return { status: 400, json: { error: 'Ninguém pra etiquetar.' } };
    const r = await etiquetar({ ids, etiquetas: lista, tirar, origem: 'manual', userId: u.id });
    return { status: 200, json: { ok: true, clientes: r.mudou } };
  }

  if (acao === 'rel_etiqueta_renomear') {
    if (!gestorOuAdmin(u)) return { status: 403, json: { error: 'Só gestor ou admin renomeia etiqueta.' } };
    const de = normalizarEtiqueta(body.de);
    const para = normalizarEtiqueta(body.para);
    if (!de || !para || de === para) return { status: 400, json: { error: 'Nome inválido.' } };
    const donos = (await rest(`rel_cliente_etiquetas?select=cliente_id&etiqueta=eq.${encodeURIComponent(de)}&limit=10000`).catch(() => [])) || [];
    await etiquetar({ ids: donos.map((d) => d.cliente_id), etiquetas: [para], origem: 'manual', userId: u.id });
    await rest(`rel_cliente_etiquetas?etiqueta=eq.${encodeURIComponent(de)}`, { method: 'DELETE', prefer: 'return=minimal' });
    return { status: 200, json: { ok: true, clientes: donos.length } };
  }

  if (acao === 'rel_etiqueta_apagar') {
    if (!gestorOuAdmin(u)) return { status: 403, json: { error: 'Só gestor ou admin apaga etiqueta.' } };
    const de = normalizarEtiqueta(body.etiqueta);
    if (!de) return { status: 400, json: { error: 'Etiqueta inválida.' } };
    await rest(`rel_cliente_etiquetas?etiqueta=eq.${encodeURIComponent(de)}`, { method: 'DELETE', prefer: 'return=minimal' });
    return { status: 200, json: { ok: true } };
  }

  return null;
}
