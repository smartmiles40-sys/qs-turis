// api/_metaAds.js
// -----------------------------------------------------------------------------
// CLIENTE DA META ADS (Graph API) — só LEITURA + PAUSAR/REATIVAR. 03/11/2026 (0265).
//
// Substitui, no QS, o que o n8n do Dashboard fazia (insights + anúncios +
// campanhas paginando `paging.next`). Nada aqui grava no banco: o motor
// (api/_mktTrafegoMotor.js) chama e grava.
//
// Env:
//   META_ADS_TOKEN       token de USUÁRIO DO SISTEMA (Business Manager) com
//                        ads_read (ler) e ads_management (pausar). Ver docs/TRAFEGO-META.md.
//   META_AD_ACCOUNT_ID   a conta de anúncio, "act_123…" (aceita sem o "act_").
//   META_GRAPH_VERSION   opcional (padrão v23.0, a mesma do WhatsApp no QS).
//
// Toda chamada tem prazo (padrão 15 s) e a paginação para quando o ORÇAMENTO
// de tempo da rodada acaba — a função da Vercel tem 60 s e não pode morrer no
// meio sem gravar nada. `fetch` vem por parâmetro pra testar sem rede.
// -----------------------------------------------------------------------------

const VERSAO_PADRAO = 'v23.0';
const PRAZO_CHAMADA_MS = 15_000;
const MAX_PAGINAS = 40;

export class ErroMeta extends Error {
  constructor(msg, { status = 0, codigo = null, tokenInvalido = false } = {}) {
    super(msg);
    this.status = status;
    this.codigo = codigo;
    this.tokenInvalido = tokenInvalido;
  }
}

/** O que falta configurar (lista vazia = pronto). */
export function faltaConfigurar(env = process.env) {
  const falta = [];
  if (!String(env.META_ADS_TOKEN || '').trim()) falta.push('META_ADS_TOKEN');
  if (!String(env.META_AD_ACCOUNT_ID || '').trim()) falta.push('META_AD_ACCOUNT_ID');
  return falta;
}

export function metaConfig(env = process.env) {
  const falta = faltaConfigurar(env);
  if (falta.length) {
    const e = new ErroMeta(`Falta configurar na Vercel: ${falta.join(', ')}`);
    e.code = 'CONFIG';
    throw e;
  }
  const conta = String(env.META_AD_ACCOUNT_ID).trim();
  return {
    token: String(env.META_ADS_TOKEN).trim(),
    conta: conta.startsWith('act_') ? conta : `act_${conta.replace(/\D/g, '')}`,
    base: `https://graph.facebook.com/${String(env.META_GRAPH_VERSION || VERSAO_PADRAO).trim()}`,
  };
}

/** Uma chamada à Graph API, com prazo e erro legível. */
export async function graph(url, { fetchImpl = fetch, method = 'GET', form = null, prazoMs = PRAZO_CHAMADA_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), prazoMs);
  let r;
  try {
    r = await fetchImpl(url, {
      method,
      signal: ctrl.signal,
      ...(form ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() } : {}),
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new ErroMeta(`A Meta não respondeu em ${Math.round(prazoMs / 1000)} s`);
    throw new ErroMeta(`Falha de rede com a Meta: ${e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
  const texto = await r.text();
  let j = null;
  try { j = texto ? JSON.parse(texto) : null; } catch { j = null; }
  if (!r.ok || j?.error) {
    const err = j?.error || {};
    // 190 = token inválido/vencido; 102 = sessão; 200/10 = sem permissão
    const tokenInvalido = err.code === 190 || err.code === 102;
    throw new ErroMeta(`Meta: ${err.message || `HTTP ${r.status}`}`, { status: r.status, codigo: err.code ?? null, tokenInvalido });
  }
  return j;
}

function montarUrl(base, caminho, params, token) {
  const u = new URL(`${base}/${caminho.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null) continue;
    u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  u.searchParams.set('access_token', token);
  return u.toString();
}

/**
 * Lê TODAS as páginas (segue `paging.next`). Para em MAX_PAGINAS ou quando
 * `ateMs` passa — e diz que parou (`completo: false`), pra quem chama não
 * tratar dado pela metade como inteiro.
 */
export async function paginar(urlInicial, { fetchImpl = fetch, ateMs = Infinity, maxPaginas = MAX_PAGINAS, prazoMs } = {}) {
  const itens = [];
  let url = urlInicial;
  let paginas = 0;
  while (url) {
    if (paginas >= maxPaginas || Date.now() > ateMs) return { itens, completo: false, paginas };
    const j = await graph(url, { fetchImpl, prazoMs });
    paginas++;
    if (Array.isArray(j?.data)) itens.push(...j.data);
    url = j?.paging?.next || null;
  }
  return { itens, completo: true, paginas };
}

// A Graph manda orçamento em CENTAVOS, como texto.
export const centavos = (v) => (v == null || v === '' ? null : Math.round(Number(v)) / 100);

// O que não está arquivado nem apagado (arquivada não gasta e só pesa a leitura).
const STATUS_VIVOS = ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES',
  'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO'];
const filtroVivos = (campo) => [{ field: campo, operator: 'IN', value: STATUS_VIVOS }];

/** Campanhas, conjuntos e anúncios (status, orçamentos). */
export async function lerEstrutura(cfg, { fetchImpl = fetch, ateMs = Infinity } = {}) {
  const { base, conta, token } = cfg;
  const [camp, conj, anun] = await Promise.all([
    paginar(montarUrl(base, `${conta}/campaigns`, {
      fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,spend_cap,start_time,stop_time,created_time,updated_time',
      filtering: filtroVivos('effective_status'), limit: 200,
    }, token), { fetchImpl, ateMs }),
    paginar(montarUrl(base, `${conta}/adsets`, {
      fields: 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget',
      filtering: filtroVivos('effective_status'), limit: 300,
    }, token), { fetchImpl, ateMs }),
    paginar(montarUrl(base, `${conta}/ads`, {
      fields: 'id,name,adset_id,campaign_id,status,effective_status',
      filtering: filtroVivos('effective_status'), limit: 500,
    }, token), { fetchImpl, ateMs }),
  ]);
  return {
    completo: camp.completo && conj.completo && anun.completo,
    campanhas: camp.itens.map((c) => ({
      id: String(c.id), nome: c.name || '(sem nome)', status: c.status ?? null, effective_status: c.effective_status ?? null,
      objetivo: c.objective ?? null, daily_budget: centavos(c.daily_budget), lifetime_budget: centavos(c.lifetime_budget),
      spend_cap: centavos(c.spend_cap), inicio_meta: c.start_time ?? null, fim_meta: c.stop_time ?? null,
      criada_meta: c.created_time ?? null, atualizada_meta: c.updated_time ?? null,
    })),
    conjuntos: conj.itens.map((j) => ({
      id: String(j.id), campanha_id: String(j.campaign_id), nome: j.name || '(sem nome)', status: j.status ?? null,
      effective_status: j.effective_status ?? null, daily_budget: centavos(j.daily_budget), lifetime_budget: centavos(j.lifetime_budget),
    })),
    anuncios: anun.itens.map((a) => ({
      id: String(a.id), conjunto_id: a.adset_id ? String(a.adset_id) : null, campanha_id: String(a.campaign_id),
      nome: a.name || '(sem nome)', status: a.status ?? null, effective_status: a.effective_status ?? null,
    })),
  };
}

// Qual "ação" é lead. A Meta já soma pixel + formulário em 'lead'; os outros
// são reserva pra conta que não tem o agregado.
const ACOES_LEAD = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'leadgen_grouped', 'onsite_web_lead'];
export function leadsDasAcoes(actions) {
  if (!Array.isArray(actions)) return 0;
  for (const tipo of ACOES_LEAD) {
    const a = actions.find((x) => x.action_type === tipo);
    if (a) return Math.round(Number(a.value) || 0);
  }
  return 0;
}

/** Insights DIÁRIOS por campanha entre `desde` e `ate` ('AAAA-MM-DD'). */
export async function lerInsightsDiarios(cfg, { desde, ate, fetchImpl = fetch, ateMs = Infinity } = {}) {
  const { base, conta, token } = cfg;
  const r = await paginar(montarUrl(base, `${conta}/insights`, {
    level: 'campaign', time_increment: 1, time_range: { since: desde, until: ate },
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,date_start',
    limit: 500,
  }, token), { fetchImpl, ateMs });
  return {
    completo: r.completo,
    linhas: r.itens.map((i) => ({
      data: i.date_start, campanha_id: String(i.campaign_id), nome: i.campaign_name ?? null,
      gasto: Math.round((Number(i.spend) || 0) * 100) / 100,
      impressoes: Math.round(Number(i.impressions) || 0), cliques: Math.round(Number(i.clicks) || 0),
      leads: leadsDasAcoes(i.actions),
    })),
  };
}

/** Nome, moeda e fuso da conta (aparece na tela). */
export async function lerConta(cfg, { fetchImpl = fetch } = {}) {
  const j = await graph(montarUrl(cfg.base, cfg.conta, { fields: 'name,currency,timezone_name,account_status' }, cfg.token), { fetchImpl });
  return { nome: j?.name ?? null, moeda: j?.currency ?? null, fuso: j?.timezone_name ?? null, status: j?.account_status ?? null };
}

/**
 * Muda o status de uma campanha/conjunto: PAUSED ou ACTIVE. É a ÚNICA escrita
 * na Meta que o QS faz — nunca mexe em orçamento, público ou criativo.
 */
export async function mudarStatus(cfg, id, status, { fetchImpl = fetch } = {}) {
  if (!/^\d{5,}$/.test(String(id))) throw new ErroMeta('Id inválido.');
  if (status !== 'PAUSED' && status !== 'ACTIVE') throw new ErroMeta('Status inválido.');
  const j = await graph(`${cfg.base}/${id}`, { fetchImpl, method: 'POST', form: { status, access_token: cfg.token } });
  if (j && j.success === false) throw new ErroMeta('A Meta recusou a mudança de status.');
  return true;
}
