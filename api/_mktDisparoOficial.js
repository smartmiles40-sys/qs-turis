// api/_mktDisparoOficial.js
// -----------------------------------------------------------------------------
// DISPARO OFICIAL DO MARKETING (0341, 09/11/2026) — a rodada que MANDA.
//
// O motor compartilhado (api/_disparo.js) continua sendo do Comercial e do Rel;
// a partir daqui as campanhas do Marketing têm a rodada DELAS:
//
//   rodadaMkt()            → cron /api/disparos?mkt=1: manda o próximo lote das
//                            campanhas 'enviando' do Marketing, no ritmo e no teto
//   sincronizarModelos()   → GET /{waba}/message_templates do número do Marketing
//   juntarModelosMkt()     → os modelos da Meta entram na lista da tela
//   acaoMktOficial()       → ações mkt_* novas da rota (estado, sincronizar, KPIs…)
//
// TRAVAS (todas precisam estar ligadas pro envio ser REAL — ver travasDoEnvio):
//   env MKT_DISPARO_ENVIO=1 · qs_settings.mkt_disparo_simulacao=false ·
//   número do Marketing cadastrado e com token · modelo APPROVED sincronizado.
// Com simulação ligada a fila anda e o funil mostra tudo, mas nada sai (wamid
// "sim:…"). Simulação desligada com alguma trava faltando = a fila PARA (nem
// simula, nem manda) e o motivo aparece na tela.
//
// Fala com a Meta só por api/_meta.js (credenciaisDaMeta + graph) — mesmas
// credenciais e o mesmo cliente HTTP do Comercial.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { credenciaisDaMeta, graph } from './_meta.js';
import { foneDestino, valoresDasVariaveis, preencher, enviarTemplate, naJanela, lerConfig } from './_disparo.js';
import { lerNumeroMkt } from './_mktDisparo.js';
import { variantesTelefone } from './_mktRegras.js';
import {
  travasDoEnvio, calcularFolga, pausaEntreEnvios, classificarErroMeta, modeloDaMeta, modeloParaTela,
  montarComponentes, pacoteDoEnvio, custoEstimado,
} from './_mktOficialRegras.js';

export const RITMO_MKT = {
  por_segundo: 5, por_dia: 1000, margem_tier: 0.8,
  inicio: '09:00', fim: '20:00', dias: [1, 2, 3, 4, 5, 6], tier_padrao: 'TIER_250',
};
const TRAVA_MS = 5 * 60_000;
const BRT = 3 * 3600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const lerSetting = async (key) =>
  (await rest(`qs_settings?select=value&key=eq.${key}&limit=1`).catch(() => null))?.[0]?.value;

/** A trava da Vercel. Só "1" liga — qualquer outra coisa (vazio, "true", "0") = desligada. */
export const envLigado = () => String(process.env.MKT_DISPARO_ENVIO || '').trim() === '1';

/** Interruptor, ritmo e preços do Marketing. Leitura falhou = simulação. */
export async function lerConfigMkt() {
  const [sim, ritmo, precos] = await Promise.all([
    lerSetting('mkt_disparo_simulacao'), lerSetting('mkt_disparo_ritmo'), lerSetting('mkt_disparo_precos'),
  ]);
  return {
    simulacao: sim !== false && sim !== 'false',
    envLigado: envLigado(),
    ritmo: { ...RITMO_MKT, ...(ritmo && typeof ritmo === 'object' ? ritmo : {}) },
    precos: precos && typeof precos === 'object' ? precos : { moeda: 'BRL' },
  };
}

// ── Banco: patch que sobrevive à 0341 ainda não aplicada ────────────────────

const COLUNAS_0341 = ['erro_codigo', 'cobranca_categoria', 'cobravel'];

/**
 * PATCH num envio. Se o banco recusar por coluna nova (0341 não aplicada),
 * tenta de novo sem elas — perder o "enviado" faria a fila mandar DE NOVO.
 */
export async function patchEnvioMkt(id, body, filtro = '') {
  try {
    await rest(`qs_disparo_envios?id=eq.${id}${filtro}`, { method: 'PATCH', prefer: 'return=minimal', body });
    return true;
  } catch {
    const basico = Object.fromEntries(Object.entries(body).filter(([k]) => !COLUNAS_0341.includes(k)));
    if (Object.keys(basico).length === Object.keys(body).length) return false;
    return rest(`qs_disparo_envios?id=eq.${id}${filtro}`, { method: 'PATCH', prefer: 'return=minimal', body: basico }).then(() => true, () => false);
  }
}

async function pausarCampanha(id, motivo) {
  await rest(`qs_disparo_campanhas?id=eq.${id}&status=eq.enviando`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'pausada', pausada_em: new Date().toISOString(), ultimo_erro: String(motivo).slice(0, 300) },
  }).catch(() => null);
}

async function evento(contatoId, tipo, dados) {
  if (!contatoId) return;
  await rest('mkt_contato_eventos', { method: 'POST', prefer: 'return=minimal', body: { contato_id: contatoId, tipo, dados } }).catch(() => null);
}

/** A pessoa desligou marketing (131050) ou pediu PARAR: guarda no contato. */
async function marcarOptout(contatoId, origem) {
  if (!contatoId) return;
  await rest(`mkt_contatos?id=eq.${contatoId}&optout_whatsapp_em=is.null`, {
    method: 'PATCH', prefer: 'return=minimal', body: { optout_whatsapp_em: new Date().toISOString() },
  }).catch(() => null);
  await evento(contatoId, 'optout_whatsapp', { origem });
}

// ── Modelos (sincronização com a WABA do Marketing) ─────────────────────────

/**
 * Lê TODOS os modelos da WABA do número do Marketing (com paginação) e grava
 * em mkt_wa_modelos. Modelo que sumiu da Meta sai da tabela. Só LEITURA na Meta.
 */
export async function sincronizarModelos() {
  const numero = await lerNumeroMkt();
  if (!numero) return { erro: 'O Marketing ainda não tem número cadastrado.' };
  const cr = await credenciaisDaMeta(numero.phone_number_id).catch(() => null);
  if (!cr?.token) return { erro: 'O QS não tem o token do número do Marketing (conecte pelo painel de WhatsApp).' };
  if (!cr.waba) return { erro: 'Não achei a WABA do número do Marketing.' };

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
    await rest('mkt_wa_modelos?on_conflict=nome,idioma', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: linhas.slice(i, i + 200), timeoutMs: 20_000,
    });
  }
  await rest(`mkt_wa_modelos?sincronizado_em=lt.${encodeURIComponent(inicio)}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => null);
  return { total: linhas.length, aprovados: linhas.filter((m) => m.status === 'APPROVED').length };
}

/** Linhas de mkt_wa_modelos (vazio se a 0341 não estiver aplicada). */
export async function lerModelosMeta() {
  return (await rest('mkt_wa_modelos?select=*&order=nome.asc').catch(() => [])) || [];
}

/**
 * A lista de modelos da tela do Marketing = os da Meta (sincronizados) + os
 * montados à mão em disparo_modelos que não têm par na Meta. O da Meta vence.
 */
export async function juntarModelosMkt(modelosCfg) {
  const meta = (await lerModelosMeta()).map(modeloParaTela);
  const k = (m) => `${m.nome}|${m.idioma || 'pt_BR'}`;
  const tem = new Set(meta.map(k));
  return [...meta, ...(modelosCfg || []).filter((m) => !tem.has(k(m)))];
}

// ── Saúde do número (tier e qualidade) ──────────────────────────────────────

/** { tier, qualidade, numero } do número na Meta (só leitura). null = não deu pra ler. */
export async function saudeDoNumero(phoneId, cr) {
  if (!cr?.token || !phoneId) return null;
  const ler = (campos) => graph(`/${phoneId}?fields=${campos}`, { token: cr.token }).catch(() => null);
  const j = (await ler('whatsapp_business_manager_messaging_limit,quality_rating,display_phone_number,verified_name,status'))
    || (await ler('messaging_limit_tier,quality_rating,display_phone_number,verified_name,status'));
  if (!j) return null;
  const lim = j.whatsapp_business_manager_messaging_limit;
  const tier = (typeof lim === 'string' ? lim : lim?.current_limit || lim?.tier) || j.messaging_limit_tier || null;
  return { tier, qualidade: j.quality_rating || null, numero: j.display_phone_number || null, nome: j.verified_name || null, status: j.status || null };
}

// ── A rodada ────────────────────────────────────────────────────────────────

const inicioDoDiaBRT = (agora) => {
  const w = new Date(agora.getTime() - BRT); w.setUTCHours(0, 0, 0, 0);
  return new Date(w.getTime() + BRT);
};

async function contar(phone, desde, simulado) {
  if (!phone) return 0;
  const n = await rest('rpc/mkt_disparo_contar', { method: 'POST', body: { p_phone: phone, p_desde: desde.toISOString(), p_simulado: simulado } }).catch(() => null);
  return typeof n === 'number' ? n : Infinity; // não deu pra contar = não manda
}

async function contexto(envios) {
  const segmentos = new Map(); const destinos = new Map(); const campos = new Map();
  const ids = (k) => [...new Set(envios.map((e) => e[k]).filter(Boolean))];
  const [ls, vs, cs] = [ids('lead_id'), ids('viagem_id'), ids('contato_id')];
  if (ls.length) for (const l of (await rest(`qs_leads?select=id,segment&id=in.(${ls.join(',')})`).catch(() => [])) || []) segmentos.set(l.id, l.segment);
  if (vs.length) for (const v of (await rest(`rel_viagens?select=id,destino,titulo&id=in.(${vs.join(',')})`).catch(() => [])) || []) destinos.set(v.id, v.destino || v.titulo);
  if (cs.length) for (const x of (await rest(`mkt_contatos?select=id,campos&id=in.(${cs.join(',')})`).catch(() => [])) || []) campos.set(x.id, x.campos || {});
  return { nomesSdr: new Map(), segmentos, destinos, campos, grupoLink: null };
}

/** O modelo da campanha: o da Meta (sincronizado) ou, em simulação, o montado à mão. */
async function modeloDaCampanha(c, modo, legados) {
  const r = await rest(`mkt_wa_modelos?select=*&nome=eq.${encodeURIComponent(c.modelo_nome)}&idioma=eq.${encodeURIComponent(c.modelo_idioma || 'pt_BR')}&limit=1`).catch(() => null);
  const meta = r?.[0] || null;
  if (meta) return meta.status === 'APPROVED' ? { modelo: meta } : { erro: `O modelo "${c.modelo_nome}" está ${meta.status || 'sem status'} na Meta — só APROVADO dispara.` };
  if (modo === 'real') return { erro: `O modelo "${c.modelo_nome}" não está na WABA do Marketing (clique em "Sincronizar modelos da Meta").` };
  const l = (legados || []).find((m) => m.nome === c.modelo_nome && (m.idioma || 'pt_BR') === (c.modelo_idioma || 'pt_BR'));
  const corpo = l?.corpo || c.modelo_corpo;
  if (!corpo) return { erro: 'Modelo não encontrado na configuração.' };
  return { modelo: { nome: c.modelo_nome, idioma: c.modelo_idioma || 'pt_BR', categoria: 'MARKETING', corpo, formato_parametros: 'POSITIONAL', cabecalho_formato: null, botoes: [] } };
}

/**
 * Confere de novo na hora e manda UM. Devolve:
 *   { feito: true }                → saiu (ou foi simulado), pulado ou erro só dele
 *   { acao: 'esperar', motivo }    → limite de velocidade: volta pra fila, para o número
 *   { acao: 'parar', motivo }      → problema da campanha: volta pra fila, pausa
 */
async function enviarUmMkt({ envio, c, modelo, modo, cr, ctx }) {
  const agora = () => new Date().toISOString();
  const pular = (motivo) => patchEnvioMkt(envio.id, { status: 'pulado', motivo }).then(() => ({ feito: true }));
  const devolver = (r) => patchEnvioMkt(envio.id, { pego_em: null }).then(() => r);
  try {
    const tel = foneDestino(envio.telefone);
    if (!tel) return pular('telefone inválido');
    const tels = variantesTelefone(tel).join(',');
    const o = await rest(`mkt_contatos?select=id&telefone=in.(${tels})&optout_whatsapp_em=not.is.null&limit=1`);
    if (o?.length) return pular('pediu PARAR ao número do Marketing');
    if (envio.lead_id) {
      const l = (await rest(`qs_leads?select=optout_whatsapp_em&id=eq.${envio.lead_id}&limit=1`))?.[0];
      if (l?.optout_whatsapp_em) return pular('pediu para não receber');
    }
    if (envio.cliente_id) {
      const ro = await rest('rpc/rel_cliente_optout', { method: 'POST', body: { p_cliente: envio.cliente_id } });
      if (ro === true) return pular('pediu para não receber');
    }

    const alvo = { nome: envio.nome, sdr_id: null, segment: ctx.segmentos.get(envio.lead_id), destino: ctx.destinos.get(envio.viagem_id), campos: ctx.campos.get(envio.contato_id) };
    const valores = valoresDasVariaveis(c.params, alvo, ctx);
    const extra = c.envio_extra && typeof c.envio_extra === 'object' ? c.envio_extra : {};
    const topo = extra.topo ? valoresDasVariaveis({ t: extra.topo }, alvo, ctx).t : null;
    const botoes = Object.fromEntries(Object.entries(extra.botoes || {}).map(([i, cfg]) => [i, valoresDasVariaveis({ b: cfg }, alvo, ctx).b]));
    const comp = montarComponentes({ modelo, corpo: valores, topo, midia: extra.midia || null, botoes });
    if (comp.erro) return comp.nivel === 'campanha' ? devolver({ acao: 'parar', motivo: comp.erro }) : pular(comp.erro);
    const texto = preencher(modelo.corpo, valores).texto || '';

    let r;
    if (modo === 'simulacao') {
      r = await enviarTemplate({ phoneNumberId: envio.phone_number_id, para: tel, modelo: modelo.nome, idioma: modelo.idioma, params: valores, simulacao: true });
    } else {
      try {
        const j = await graph(`/${cr.phoneId}/messages`, {
          method: 'POST', token: cr.token, timeoutMs: 20_000,
          body: pacoteDoEnvio({ para: tel, modelo, components: comp.components, marca: `mkt:${envio.id}` }),
        });
        r = { wamid: j?.messages?.[0]?.id || null };
        if (!r.wamid) r = { erro: 'a Meta não devolveu o id da mensagem' };
      } catch (e) {
        r = { erro: e?.message, codigo: e?.metaCode };
      }
    }

    if (!r.wamid) {
      const k = classificarErroMeta(r.codigo, r.erro);
      if (k.acao === 'esperar' || k.acao === 'parar') return devolver({ acao: k.acao, motivo: k.motivo });
      if (k.acao === 'optout') {
        await marcarOptout(envio.contato_id, 'meta_131050');
        await patchEnvioMkt(envio.id, { status: 'pulado', motivo: k.motivo, erro_codigo: k.codigo });
        return { feito: true };
      }
      // Erro só deste destinatário: NÃO tenta de novo (podia ter saído — melhor
      // um a menos do que a mesma mensagem duas vezes).
      await patchEnvioMkt(envio.id, { status: 'erro', motivo: k.motivo.slice(0, 300), erro_codigo: k.codigo, tentativas: (envio.tentativas || 0) + 1 });
      if (modo === 'real') await evento(envio.contato_id, 'disparo_erro', { campanha_id: c.id, codigo: k.codigo });
      return { feito: true };
    }

    await patchEnvioMkt(envio.id, {
      status: 'enviado', wamid: r.wamid, simulado: Boolean(r.simulado), enviado_em: agora(), tentativas: (envio.tentativas || 0) + 1,
      motivo: r.simulado ? 'simulação' : null,
      // Estimativa até o recibo da Meta trazer o `pricing` de verdade.
      cobranca_categoria: String(modelo.categoria || 'MARKETING').toLowerCase(),
    });
    if (!r.simulado) {
      await evento(envio.contato_id, 'disparo_enviado', { campanha_id: c.id, campanha: c.nome, modelo: modelo.nome, wamid: r.wamid, texto: texto.slice(0, 500) });
    }
    return { feito: true };
  } catch (e) {
    await patchEnvioMkt(envio.id, { status: 'erro', motivo: String(e?.message || 'erro').slice(0, 300), tentativas: (envio.tentativas || 0) + 1 });
    return { feito: true };
  }
}

/**
 * A rodada do Marketing (cron /api/disparos?mkt=1). Nunca lança.
 * `limiteMs` = tempo de envio desta execução (a função tem 60 s).
 */
export async function rodadaMkt({ limiteMs = 45_000, agora = new Date() } = {}) {
  const inicio = Date.now();
  const cfg = await lerConfigMkt();
  if (!naJanela(cfg.ritmo, agora)) return { parado: 'fora da janela de envio do Marketing' };
  const campanhas = (await rest('qs_disparo_campanhas?select=*&setor=eq.marketing&status=eq.enviando&order=iniciada_em.asc').catch(() => [])) || [];
  if (!campanhas.length) return { ok: true, campanhas: [] };

  const numero = await lerNumeroMkt();
  let modo = 'simulacao';
  let cr = null;
  let tier = cfg.ritmo.tier_padrao;
  if (!cfg.simulacao) {
    cr = numero ? await credenciaisDaMeta(numero.phone_number_id).catch(() => null) : null;
    const t = travasDoEnvio({ envLigado: cfg.envLigado, simulacao: cfg.simulacao, numero, temToken: Boolean(cr?.token) });
    if (!t.real) return { parado: `envio real travado: ${t.motivos.join('; ')}` };
    const saude = await saudeDoNumero(numero.phone_number_id, cr);
    if (String(saude?.qualidade || '').toUpperCase() === 'RED') return { parado: 'qualidade do número do Marketing está VERMELHA na Meta — nada sai até melhorar' };
    tier = saude?.tier || tier;
    modo = 'real';
  }

  const ph = numero?.phone_number_id || null;
  const sim = modo === 'simulacao';
  const [n24, nHoje] = await Promise.all([contar(ph, new Date(agora.getTime() - 86_400_000), sim), contar(ph, inicioDoDiaBRT(agora), sim)]);
  let folga = calcularFolga({
    tier, margem: cfg.ritmo.margem_tier, porDia: cfg.ritmo.por_dia, enviados24h: n24, enviadosHoje: nHoje,
    porSegundo: cfg.ritmo.por_segundo, segundos: limiteMs / 1000,
  });
  const pausa = pausaEntreEnvios(cfg.ritmo.por_segundo);
  const legados = sim ? (await lerConfig().catch(() => null))?.modelos : [];
  const velho = new Date(Date.now() - TRAVA_MS).toISOString();
  const resumo = [];
  let parouNumero = null;

  for (const c of campanhas) {
    if (folga <= 0 || parouNumero || Date.now() - inicio > limiteMs) break;
    const m = await modeloDaCampanha(c, modo, legados);
    if (m.erro) { await pausarCampanha(c.id, m.erro); resumo.push({ campanha: c.nome, pausada: m.erro }); continue; }

    const cands = (await rest(
      `qs_disparo_envios?select=id,pego_em&campanha_id=eq.${c.id}&status=eq.pendente` +
      `&or=(pego_em.is.null,pego_em.lt.${encodeURIComponent(velho)})&order=criado_em.asc&limit=${Math.min(folga, 500)}`
    ).catch(() => [])) || [];
    let feitos = 0;
    let pausou = null;
    for (const cand of cands) {
      if (folga <= 0 || Date.now() - inicio > limiteMs) break;
      // Pega a vez ANTES de mandar (duas rodadas juntas não mandam duas vezes).
      const pegou = (await rest(
        `qs_disparo_envios?id=eq.${cand.id}&status=eq.pendente&or=(pego_em.is.null,pego_em.lt.${encodeURIComponent(velho)})`,
        { method: 'PATCH', prefer: 'return=representation', body: { pego_em: new Date().toISOString() } }
      ).catch(() => null))?.[0];
      if (!pegou) continue;
      // Pego antes e não terminou (a função morreu no meio): no envio REAL pode
      // ter saído — não reenvia, marca pra conferência.
      if (cand.pego_em && modo === 'real') {
        await patchEnvioMkt(pegou.id, { status: 'erro', motivo: 'envio interrompido no meio — pode ter saído; não reenviado pra não duplicar' });
        continue;
      }
      const ctx = await contexto([pegou]);
      const r = await enviarUmMkt({ envio: pegou, c, modelo: m.modelo, modo, cr, ctx });
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

// ── KPIs ────────────────────────────────────────────────────────────────────

export async function kpisDaCampanha(campanhaId, precos) {
  const k = await rest('rpc/mkt_disparo_kpis', { method: 'POST', body: { p_campanha: campanhaId } }).catch(() => null);
  if (!k) return null;
  return { ...k, custo: custoEstimado(k.cobraveis || {}, precos) };
}

// ── Ações da tela (vêm por api/disparos.js, já com permissão conferida) ─────

const num = (v, min, max, d) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) ? Number(v) : d));
const hhmm = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : d);

export async function acaoMktOficial({ acao, body, u }) {
  if (acao === 'mkt_oficial_estado') {
    const cfg = await lerConfigMkt();
    const numero = await lerNumeroMkt();
    const cr = numero ? await credenciaisDaMeta(numero.phone_number_id).catch(() => null) : null;
    const travas = travasDoEnvio({ envLigado: cfg.envLigado, simulacao: cfg.simulacao, numero, temToken: Boolean(cr?.token) });
    const modelos = await lerModelosMeta();
    // Só LÊ a Meta quando a pessoa pede ("Conferir na Meta").
    const saude = body.conferir === true && cr ? await saudeDoNumero(numero.phone_number_id, cr) : null;
    return {
      status: 200,
      json: {
        simulacao: cfg.simulacao, envLigado: cfg.envLigado, real: travas.real, faltam: travas.motivos,
        temToken: Boolean(cr?.token), numero, ritmo: cfg.ritmo, precos: cfg.precos, saude,
        modelos: { total: modelos.length, aprovados: modelos.filter((m) => m.status === 'APPROVED').length, sincronizadoEm: modelos[0]?.sincronizado_em || null },
      },
    };
  }

  if (acao === 'mkt_sincronizar_modelos') {
    try {
      const r = await sincronizarModelos();
      return r.erro ? { status: 400, json: { error: r.erro } } : { status: 200, json: { ok: true, ...r } };
    } catch (e) {
      return { status: 502, json: { error: `A Meta respondeu: ${e?.message || 'falhou'}` } };
    }
  }

  if (acao === 'mkt_kpis') {
    if (!UUID.test(String(body.campanhaId || ''))) return { status: 400, json: { error: 'campanha inválida' } };
    const c = (await rest(`qs_disparo_campanhas?select=id,setor,status,ultimo_erro&id=eq.${body.campanhaId}&limit=1`).catch(() => null))?.[0];
    if (!c || c.setor !== 'marketing') return { status: 404, json: { error: 'Campanha do Marketing não encontrada.' } };
    const cfg = await lerConfigMkt();
    const [kpis, falhas] = await Promise.all([
      kpisDaCampanha(c.id, cfg.precos),
      rest(`qs_disparo_envios?select=nome,telefone,motivo,erro_codigo,status&campanha_id=eq.${c.id}&status=in.(erro,pulado)&order=criado_em.desc&limit=30`).catch(() => []),
    ]);
    return {
      status: 200,
      json: {
        status: c.status, ultimo_erro: c.ultimo_erro, kpis,
        falhas: (falhas || []).map((f) => ({ ...f, telefone: `…${String(f.telefone || '').slice(-4)}` })),
      },
    };
  }

  if (acao === 'mkt_salvar_ritmo_oficial') {
    if (u.role !== 'admin') return { status: 403, json: { error: 'Só admin muda o ritmo.' } };
    const r = body.ritmo || {};
    const ritmo = {
      por_segundo: num(r.por_segundo, 0.2, 80, 5), por_dia: Math.round(num(r.por_dia, 1, 100000, 1000)),
      margem_tier: num(r.margem_tier, 0.1, 1, 0.8), inicio: hhmm(r.inicio, '09:00'), fim: hhmm(r.fim, '20:00'),
      dias: Array.isArray(r.dias) ? [...new Set(r.dias.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : RITMO_MKT.dias,
      tier_padrao: /^TIER_[0-9A-Z]+$/.test(String(r.tier_padrao || '')) ? r.tier_padrao : 'TIER_250',
    };
    await rest('qs_settings?on_conflict=key', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { key: 'mkt_disparo_ritmo', value: ritmo } });
    return { status: 200, json: { ok: true, ritmo } };
  }

  if (acao === 'mkt_salvar_precos') {
    if (u.role !== 'admin') return { status: 403, json: { error: 'Só admin muda os preços.' } };
    const p = body.precos || {};
    const preco = (v) => (v === null || v === '' || v === undefined || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));
    const precos = { moeda: /^[A-Z]{3}$/.test(String(p.moeda || '')) ? p.moeda : 'BRL', marketing: preco(p.marketing), utility: preco(p.utility), authentication: preco(p.authentication) };
    await rest('qs_settings?on_conflict=key', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { key: 'mkt_disparo_precos', value: precos } });
    return { status: 200, json: { ok: true, precos } };
  }

  return null;
}
