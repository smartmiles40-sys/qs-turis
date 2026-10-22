// api/_contrato.js
// -----------------------------------------------------------------------------
// CONTRATO 100% EM CÓDIGO (0180, Bruno 22/10/2026: "eu não quero que seja nada
// via n8n"). Aqui mora tudo o que o n8n fazia, agora no servidor do QS:
//
//   1. GOOGLE (OAuth do próprio QS): o refresh token fica em qs_contrato_google
//      (só o service_role lê). A cada contrato o QS pega um access token novo.
//   2. MONTAR OS CAMPOS: venda consolidada (ficha) + proposta aprovada + ficha
//      do cliente (rel_clientes) + Bitrix (negócio e contato) + lead.
//   3. GERAR: copia o template (convertendo .docx → Google Doc) → troca as
//      {{tags}} (o MESMO mapa do n8n, com as variações antigas) → TRAVA: se
//      sobrou '{{' no texto, não envia → exporta PDF → arquiva o PDF na pasta
//      do Drive → apaga o Doc temporário.
//   4. ZAPSIGN: cria o documento (cliente + assinante fixo da agência) com
//      external_id = id do cartão no QS.
//
// Só fetch puro (sem googleapis/zapsign SDK) e timeout em toda chamada.
// Quem chama: api/closer.js (?acao=contrato-*, google-*, zapsign-webhook).
// -----------------------------------------------------------------------------

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { rest } from './_supabaseAdmin.js';
import { bx, bitrixConfigurado } from './_bitrixLead.js';

const env = (k) => String(process.env[k] || '').trim();

export const CONFIG_PADRAO = {
  template_pacote: '1vRh_zQHh-Q2rD8g0FsGIHRxAwqwtPY7X',
  template_expedicao: '1FbKqTW5ysiFbKQI_9eM0xDPJ123Zz0UG',
  pasta_contratos: '14sJB-IOUEBjcyq0R6JxF5ZO1AaY0exQ8',
  assinante_nome: 'Luís Antonio Caetano',
  assinante_email: 'contato@setuforeuvou.com',
  assinante_telefone: '5585987660748',
};

const ESCOPOS_GOOGLE = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/documents'];

// ── fetch com prazo ─────────────────────────────────────────────────────────
async function buscar(url, opts = {}, ms = 20_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`${new URL(url).host} não respondeu em ${Math.round(ms / 1000)} s.`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// ── Configuração ────────────────────────────────────────────────────────────
export async function lerConfig() {
  const r = await rest('qs_contrato_config?select=valor&chave=eq.geral&limit=1').catch(() => null);
  const v = r?.[0]?.valor || {};
  const out = { ...CONFIG_PADRAO };
  for (const k of Object.keys(CONFIG_PADRAO)) if (v[k]) out[k] = String(v[k]);
  return out;
}

export async function contaGoogle() {
  const r = await rest('qs_contrato_google?select=refresh_token,email,conectado_em,conectado_por,ultimo_erro,ultimo_erro_em&id=eq.1&limit=1').catch(() => null);
  return r?.[0] || null;
}

/** O que falta pra rodar sozinho. Vazio = modo automático. */
export function oQueFalta(cfg, google) {
  const falta = [];
  if (!env('GOOGLE_OAUTH_CLIENT_ID') || !env('GOOGLE_OAUTH_CLIENT_SECRET')) falta.push('Cadastrar GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET na Vercel.');
  else if (!google?.refresh_token) falta.push('Conectar a conta Google (Configurar contrato → "Conectar conta Google").');
  if (!env('ZAPSIGN_API_TOKEN')) falta.push('Cadastrar ZAPSIGN_API_TOKEN na Vercel.');
  if (!env('ZAPSIGN_WEBHOOK_SECRET')) falta.push('Cadastrar ZAPSIGN_WEBHOOK_SECRET na Vercel (e o mesmo valor no webhook do ZapSign).');
  if (!cfg.template_pacote || !cfg.template_expedicao) falta.push('Informar os IDs dos templates de contrato.');
  if (!cfg.pasta_contratos) falta.push('Informar a pasta dos contratos no Drive.');
  if (!cfg.assinante_email) falta.push('Informar o assinante da agência.');
  return falta;
}

// ── GOOGLE: OAuth ───────────────────────────────────────────────────────────
export function urlDeRetorno(req) {
  const fixa = env('QS_URL_PUBLICA');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const base = (fixa || `https://${host}`).replace(/\/+$/, '');
  return `${base}/api/closer?acao=google-callback`;
}
export function urlDoApp(req) {
  return urlDeRetorno(req).replace(/\/api\/closer\?acao=google-callback$/, '');
}

const b64url = (b) => Buffer.from(b).toString('base64url');

/** state = dados.assinatura (HMAC com o client secret) — sem tabela, vale 15 min. */
export function assinarEstado(userId) {
  const dados = b64url(JSON.stringify({ u: userId, t: Date.now() }));
  const sig = createHmac('sha256', env('GOOGLE_OAUTH_CLIENT_SECRET')).update(dados).digest('base64url');
  return `${dados}.${sig}`;
}
export function conferirEstado(state) {
  const [dados, sig] = String(state || '').split('.');
  if (!dados || !sig || !env('GOOGLE_OAUTH_CLIENT_SECRET')) return null;
  const esperado = createHmac('sha256', env('GOOGLE_OAUTH_CLIENT_SECRET')).update(dados).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const j = JSON.parse(Buffer.from(dados, 'base64url').toString('utf8'));
    if (!j?.u || Date.now() - Number(j.t) > 15 * 60_000) return null;
    return j;
  } catch {
    return null;
  }
}

export function urlDeConsentimento(req, userId) {
  const p = new URLSearchParams({
    client_id: env('GOOGLE_OAUTH_CLIENT_ID'),
    redirect_uri: urlDeRetorno(req),
    response_type: 'code',
    scope: ESCOPOS_GOOGLE.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: assinarEstado(userId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenGoogle(params) {
  const r = await buscar('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('GOOGLE_OAUTH_CLIENT_ID'), client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'), ...params }),
  }, 15_000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error_description || j.error || `Google HTTP ${r.status}`);
    err.codigo = j.error;
    throw err;
  }
  return j;
}

/** Troca o code do consentimento pelo refresh token e grava (só service_role). */
export async function conectarGoogle(req, code, userId) {
  const tk = await tokenGoogle({ code, grant_type: 'authorization_code', redirect_uri: urlDeRetorno(req) });
  if (!tk.refresh_token) throw new Error('O Google não devolveu o refresh token. Tire o acesso do app em myaccount.google.com/permissions e conecte de novo.');
  const faltando = ESCOPOS_GOOGLE.filter((s) => !String(tk.scope || '').includes(s));
  if (faltando.length) throw new Error('Marque as permissões do Drive e do Docs na tela do Google.');
  let email = null;
  try {
    const r = await buscar('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: `Bearer ${tk.access_token}` } }, 10_000);
    email = (await r.json())?.user?.emailAddress || null;
  } catch { /* só o rótulo da tela */ }
  await rest('qs_contrato_google?on_conflict=id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { id: 1, refresh_token: tk.refresh_token, email, escopos: tk.scope || null, conectado_por: userId, conectado_em: new Date().toISOString(), ultimo_erro: null, ultimo_erro_em: null },
  });
  return email;
}

export async function desconectarGoogle() {
  const g = await contaGoogle();
  if (g?.refresh_token) {
    await buscar(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(g.refresh_token)}`, { method: 'POST' }, 8_000).catch(() => null);
  }
  await rest('qs_contrato_google?id=eq.1', { method: 'DELETE', prefer: 'return=minimal' });
}

async function accessToken() {
  const g = await contaGoogle();
  if (!g?.refresh_token) throw new Error('A conta Google não está conectada.');
  try {
    const tk = await tokenGoogle({ refresh_token: g.refresh_token, grant_type: 'refresh_token' });
    return tk.access_token;
  } catch (e) {
    const msg = e.codigo === 'invalid_grant'
      ? 'O Google recusou a conexão (revogada ou expirada). Conecte a conta Google de novo em Configurar contrato.'
      : `Google: ${e.message}`;
    await rest('qs_contrato_google?id=eq.1', { method: 'PATCH', prefer: 'return=minimal', body: { ultimo_erro: msg, ultimo_erro_em: new Date().toISOString() } }).catch(() => null);
    throw new Error(msg);
  }
}

async function google(token, method, url, { json, body, headers = {}, binario = false, ms = 25_000 } = {}) {
  const r = await buscar(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : body,
  }, ms);
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    const m = j?.error?.message || `HTTP ${r.status}`;
    const err = new Error(r.status === 404 ? `Google: arquivo não encontrado ou sem acesso (${m}).` : `Google: ${m}`);
    err.status = r.status;
    throw err;
  }
  if (binario) return Buffer.from(await r.arrayBuffer());
  if (r.status === 204) return null;
  return r.json().catch(() => null);
}

// ── MAPA DE TAGS (o mesmo do n8n "Normalizar e Montar Contrato") ───────────
// A PRIMEIRA tag de cada linha é a do template atual; as outras são variações
// antigas mantidas por segurança (tag que não existe no doc é ignorada).
// matchCase: true — acento e maiúscula precisam bater.
const TAGS_COMUNS = [
  ['nome', ['{{Nome completo do Cliente (não colocar só ponto!)}}', '{{Contato: Nome}}']],
  ['cpf', ['{{Contato: CPF 2}}', '{{CPF}}']],
  ['rg', ['{{Contato: RG}}', '{{RG}}']],
  ['endereco', ['{{Contato: Endereço}}', '{{endereco}}']],
  ['email', ['{{Contato: E-mail}}', '{{email}}']],
  ['telefone', ['{{Contato: Telefone}}', '{{telefone}}']],
  ['ida', ['{{Ida - Prevista}}', '{{idaprevista}}']],
  ['volta', ['{{Volta - Prevista}}', '{{voltaprevista}}']],
  ['valor_total', ['{{Valor total (para todas as pessoas) não adicionar -> R$}}', '{{Valor_total}}']],
  ['forma_pagamento', ['{{Forma de pagamento confirmada:}}', '{{Forma_de_pagamento}}']],
  ['data_venda', ['{{Data da venda realizada}}', '{{data_atual}}']],
];
const TAGS_EXPEDICAO = [
  ['expedicao', ['{{Nome da expedição}}', '{{Expedição}}']],
  ['nascimento', ['{{Contato: Data de Nascimento}}', '{{nascimento}}']],
  ['passagem', ['{{Passagem Aérea}}', '{{Passagem aérea}}', '{{passagem_aerea}}']],
  ['seguro', ['{{Seguro Viagem}}', '{{Seguro viagem}}', '{{seguro_viagem}}']],
];
const TAGS_PACOTE = [
  ['destino', ['{{Destino}}']],
  ['tipo_pacote', ['{{Tipo de pacote}}']],
];
const VAZIO = '-';

/** O texto que entra no lugar de cada tag (CPF formatado, valor sem "R$"). */
function textoDoCampo(k, c) {
  const v = String(c[k] ?? '').trim();
  if (!v) return VAZIO;
  if (k === 'cpf') return formatarCpf(v);
  if (k === 'valor_total') return formatarValor(v);
  return v;
}

export function pedidosDeTroca(c) {
  const lista = [...TAGS_COMUNS, ...(c.tipo === 'expedicao' ? TAGS_EXPEDICAO : TAGS_PACOTE)];
  return lista.flatMap(([k, tags]) => tags.map((tag) => ({
    replaceAllText: { containsText: { text: tag, matchCase: true }, replaceText: textoDoCampo(k, c) },
  })));
}

// ── Formatação (igual ao n8n) ───────────────────────────────────────────────
/** 26990 → "26.990,00" (o template já tem o "R$" antes). Aceita "34990,00 (Entrada…)" e "34990|BRL". */
export function numeroDoValor(v) {
  if (typeof v === 'number') return v;
  // Só o começo: "34990,00 (Entrada de R$2.000…)" e "34990|BRL" valem 34990.
  let s = (String(v ?? '').split('|')[0].trim().match(/^[R$\s]*([\d.,]+)/) || [])[1] || '';
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');   // "26.990" = vinte e seis mil
  const n = Number(s);
  return s && Number.isFinite(n) ? n : NaN;
}
export function formatarValor(v) {
  const n = numeroDoValor(v);
  return Number.isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v ?? '');
}
const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');
export function formatarCpf(v) {
  const d = soDigitos(v);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(v);
}
export function cpfValido(v) {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
export function formatarTelefone(v) {
  let d = soDigitos(String(v ?? '').split(',')[0]);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(v ?? '').split(',')[0].trim();
}
/** ISO (2026-11-10 ou 2026-11-10T03:00:00+03:00) → 10/11/2026. Já em dd/mm/aaaa: fica. */
export function dataBr(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
export const hojeBr = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const FORMA = { pix: 'Pix', boleto: 'boleto', cartao: 'cartão de crédito', link: 'link de pagamento', transferencia: 'transferência', dinheiro: 'dinheiro', outro: 'outra forma' };

/** "Entrada de R$ 2.000,00 via Pix e 12 parcelas de R$ 2.749,16 no cartão de crédito" — do plano da ficha. */
export function textoDoPlano(plano) {
  if (!plano) return '';
  const partes = [];
  const ent = plano.entrada;
  if (ent && Number(ent.valor) > 0) partes.push(`Entrada de ${brl(ent.valor)} via ${FORMA[ent.forma] || ent.forma || 'Pix'}`);
  const pars = Array.isArray(plano.parcelas) ? plano.parcelas.filter((p) => Number(p.valor) > 0) : [];
  if (pars.length) {
    // Agrupa parcelas iguais (mesmo valor e forma).
    const grupos = [];
    for (const p of pars) {
      const g = grupos.find((x) => Math.abs(x.valor - Number(p.valor)) < 0.01 && x.forma === p.forma);
      if (g) g.n += 1; else grupos.push({ valor: Number(p.valor), forma: p.forma, n: 1, recorrente: !!p.recorrente });
    }
    for (const g of grupos) {
      partes.push(`${g.n} ${g.n === 1 ? 'parcela' : 'parcelas'} de ${brl(g.valor)} no ${FORMA[g.forma] || g.forma}${g.recorrente ? ' (recorrente)' : ''}`);
    }
  }
  return partes.join(' e ');
}

// ── BITRIX: lê o negócio e o contato e traduz listas/usuários/datas ────────
const BX_DEAL = {
  nome: 'UF_CRM_1761744211241',          // Nome completo do Cliente (não colocar só ponto!)
  cpf: 'UF_CRM_1762288761917',           // CPF do cliente
  email: 'UF_CRM_1762288786624',         // E-mail do cliente
  email2: 'UF_CRM_1756145690413',        // E-mail
  endereco: 'UF_CRM_1756145544358',      // Endereço
  nascimento: 'UF_CRM_1756148121396',    // Data de Nascimento
  expedicao: 'UF_CRM_1768941254969',     // Nome da expedição
  destino: 'UF_CRM_1746633298495',       // Destino
  tipo_pacote: 'UF_CRM_1771511032311',   // Tipo de pacote
  ida: 'UF_CRM_1770123693704',           // Ida - Prevista
  volta: 'UF_CRM_1770123722849',         // Volta - Prevista
  passagem: 'UF_CRM_1770124038221',      // Passagem Aérea
  seguro: 'UF_CRM_1771008352486',        // Seguro Viagem
  valor_total: 'UF_CRM_1770124224965',   // Valor total (para todas as pessoas)
  forma_pagamento: 'UF_CRM_1761744617281', // Forma de pagamento confirmada:
  vendedor: 'UF_CRM_1746633208073',      // Vendedor
};
const BX_CONTATO = {
  cpf2: 'UF_CRM_1752691408782',          // CPF 2 (a tag do template é "Contato: CPF 2")
  cpf: 'UF_CRM_1749757426655',           // CPF
  rg: 'UF_CRM_1768940114697',            // RG
};

const cacheCampos = {};
async function camposDe(entidade) {
  const c = cacheCampos[entidade];
  if (c && Date.now() - c.em < 10 * 60_000) return c.v;
  const v = await bx(`crm.${entidade}.fields`, {}, 8_000).catch(() => ({}));
  cacheCampos[entidade] = { v: v || {}, em: Date.now() };
  return v || {};
}
const cacheUsuario = new Map();
async function nomeDoUsuario(id) {
  if (cacheUsuario.has(id)) return cacheUsuario.get(id);
  const u = (await bx('user.get', { ID: id }, 6_000).catch(() => null))?.[0];
  const nome = u ? [u.NAME, u.LAST_NAME].filter(Boolean).join(' ').trim() : '';
  cacheUsuario.set(id, nome);
  return nome;
}
async function legivel(valor, def) {
  if (valor == null || valor === '' || valor === false) return '';
  const lista = Array.isArray(valor) ? valor : [valor];
  const out = [];
  for (const v of lista) {
    if (v == null || v === '') continue;
    const tipo = def?.type;
    if (tipo === 'enumeration' && Array.isArray(def.items)) {
      out.push(def.items.find((i) => String(i.ID) === String(v))?.VALUE || String(v));
    } else if (tipo === 'employee') {
      out.push((await nomeDoUsuario(v)) || String(v));
    } else if (tipo === 'date' || tipo === 'datetime') {
      out.push(dataBr(v));
    } else if (tipo === 'boolean') {
      out.push(String(v) === '1' || String(v) === 'Y' ? 'Sim' : 'Não');
    } else if (tipo === 'money') {
      out.push(String(v).split('|')[0]);
    } else if (typeof v === 'object') {
      out.push(String(v.VALUE ?? ''));
    } else {
      out.push(String(v));
    }
  }
  return out.filter(Boolean).join(', ').trim();
}
const naoSeAplica = (s) => /^\s*(n[aã]o\s+se\s+aplica|nenhuma?|-)\s*$/i.test(String(s || ''));

export async function dadosDoBitrix(dealId) {
  if (!bitrixConfigurado() || !dealId) return null;
  const deal = await bx('crm.deal.get', { id: Number(dealId) }, 8_000).catch(() => null);
  if (!deal) return null;
  const defs = await camposDe('deal');
  const d = {};
  for (const [k, campo] of Object.entries(BX_DEAL)) d[k] = await legivel(deal[campo], defs[campo]);
  d.categoria = deal.CATEGORY_ID;
  d.titulo = deal.TITLE || '';
  if (naoSeAplica(d.expedicao)) d.expedicao = '';
  const ct = {};
  const contatoId = Number(deal.CONTACT_ID || 0);
  if (contatoId > 0) {
    const c = await bx('crm.contact.get', { id: contatoId }, 8_000).catch(() => null);
    if (c) {
      const cdefs = await camposDe('contact');
      ct.nome = [c.NAME, c.SECOND_NAME, c.LAST_NAME].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      ct.sobrenome = String(c.LAST_NAME || '').trim();
      ct.primeiro = String(c.NAME || '').trim();
      ct.email = Array.isArray(c.EMAIL) ? (c.EMAIL[0]?.VALUE || '') : '';
      ct.telefone = Array.isArray(c.PHONE) ? (c.PHONE[0]?.VALUE || '') : '';
      ct.nascimento = dataBr(c.BIRTHDATE);
      ct.endereco = [c.ADDRESS, c.ADDRESS_2, c.ADDRESS_CITY, c.ADDRESS_PROVINCE, c.ADDRESS_POSTAL_CODE].filter((x) => String(x || '').trim()).join(', ');
      for (const [k, campo] of Object.entries(BX_CONTATO)) ct[k] = await legivel(c[campo], cdefs[campo]);
    }
  }
  return { deal: d, contato: ct };
}

/** Nome completo sem duplicar o sobrenome (mesma regra do n8n). */
function juntarNome(nome, sobrenome) {
  const a = String(nome || '').replace(/\s+/g, ' ').trim();
  const b = String(sobrenome || '').replace(/\s+/g, ' ').trim();
  if (!b) return a;
  if (!a) return b;
  return a.toLowerCase().endsWith(b.toLowerCase()) ? a : `${a} ${b}`;
}

// ── PRÉVIA: os campos que vão no contrato e de onde vieram ─────────────────
export const CAMPOS = ['tipo', 'nome', 'cpf', 'rg', 'nascimento', 'endereco', 'email', 'telefone', 'expedicao', 'destino', 'tipo_pacote',
  'ida', 'volta', 'passagem', 'seguro', 'valor_total', 'forma_pagamento', 'vendedor', 'data_venda'];
// Dados da PESSOA: a correção do closer no último envio vale de novo.
const DA_PESSOA = ['nome', 'cpf', 'rg', 'nascimento', 'endereco', 'email', 'telefone'];

export async function montarPrevia(negocio) {
  const campos = {};
  const origem = {};
  const por = (k, valor, de) => {
    const v = valor == null ? '' : String(valor).trim();
    if (!campos[k] && v) { campos[k] = v; origem[k] = de; }
  };

  const lead = (await rest(`qs_leads?select=id,full_name,first_name,last_name,email,phone,bitrix_id&id=eq.${negocio.lead_id}&limit=1`))?.[0] || {};
  const dealId = soDigitos(lead.bitrix_id);
  const ficha = negocio.ficha || null;

  // A correção do closer no último envio (só dados da pessoa).
  const ultimo = (await rest(`qs_contratos?select=campos&negocio_id=eq.${negocio.id}&order=criado_em.desc&limit=1`).catch(() => null))?.[0];
  if (ultimo?.campos) for (const k of DA_PESSOA) por(k, ultimo.campos[k], 'último envio');

  // Ficha do cliente no Relacionamento.
  let cliente = null;
  if (negocio.viagem_id) {
    const v = (await rest(`rel_viagens?select=cliente_id&id=eq.${negocio.viagem_id}&limit=1`).catch(() => null))?.[0];
    if (v?.cliente_id) cliente = (await rest(`rel_clientes?select=nome,cpf,nascimento,email,telefone&id=eq.${v.cliente_id}&limit=1`).catch(() => null))?.[0];
  }
  if (!cliente) {
    let fone = soDigitos(lead.phone);
    if (fone.length === 10 || fone.length === 11) fone = `55${fone}`;
    const filtros = [];
    if (fone) filtros.push(`telefone.eq.${fone}`);
    if (lead.email) filtros.push(`email.eq.${encodeURIComponent(String(lead.email).trim().toLowerCase())}`);
    if (filtros.length) {
      cliente = (await rest(`rel_clientes?select=nome,cpf,nascimento,email,telefone&mesclado_em_id=is.null&arquivado_em=is.null&or=(${filtros.join(',')})&order=criado_em.asc&limit=1`).catch(() => null))?.[0] || null;
    }
  }

  // Proposta aprovada (quando não tem ficha).
  let proposta = null;
  if (!ficha) {
    const sols = await rest(`qs_solicitacoes?select=id&lead_id=eq.${negocio.lead_id}`).catch(() => []);
    const ors = [`lead_id.eq.${negocio.lead_id}`];
    if (sols?.length) ors.push(`solicitacao_id.in.(${sols.map((s) => s.id).join(',')})`);
    proposta = (await rest(`qs_propostas?select=id,numero,destino,data_ida,data_volta,aprovada_opcao_id&status=eq.aprovada&or=(${ors.join(',')})&order=aprovada_em.desc&limit=1`).catch(() => null))?.[0] || null;
    if (proposta?.aprovada_opcao_id) {
      const op = (await rest(`qs_proposta_opcoes?select=desconto,itens:qs_proposta_itens(tipo,nome,descricao,valor_total)&id=eq.${proposta.aprovada_opcao_id}&limit=1`).catch(() => null))?.[0];
      if (op) {
        const sub = (op.itens || []).reduce((s, i) => s + (Number(i.valor_total) || 0), 0);
        proposta.total = Math.max(0, sub - Math.min(Number(op.desconto) || 0, sub));
        proposta.itens = op.itens || [];
      }
    }
  }

  let bxd = null;
  let avisoBitrix = null;
  try { bxd = await dadosDoBitrix(dealId); } catch (e) { avisoBitrix = `Bitrix não respondeu (${e.message}).`; }
  if (dealId && !bxd && !avisoBitrix) avisoBitrix = `Não consegui ler o negócio ${dealId} no Bitrix.`;
  const d = bxd?.deal || {};
  const ct = bxd?.contato || {};

  // ── Tipo: expedição × pacote ──
  const tipo = ficha?.servico === 'expedicao' || d.expedicao ? 'expedicao' : 'pacote';
  campos.tipo = tipo;
  origem.tipo = ficha?.servico ? 'venda consolidada' : d.expedicao ? 'Bitrix' : 'padrão';

  // ── Pessoa ──
  por('nome', d.nome && d.nome !== '.' ? d.nome : '', 'Bitrix (negócio)');
  por('nome', juntarNome(ct.primeiro, ct.sobrenome), 'Bitrix (contato)');
  por('nome', cliente?.nome, 'ficha do cliente');
  por('nome', lead.full_name || juntarNome(lead.first_name, lead.last_name), 'lead');
  por('cpf', cliente?.cpf, 'ficha do cliente');
  por('cpf', d.cpf, 'Bitrix (negócio)');
  por('cpf', ct.cpf2, 'Bitrix (contato)');
  por('cpf', ct.cpf, 'Bitrix (contato)');
  por('rg', ct.rg, 'Bitrix (contato)');
  por('nascimento', dataBr(cliente?.nascimento), 'ficha do cliente');
  por('nascimento', d.nascimento, 'Bitrix (negócio)');
  por('nascimento', ct.nascimento, 'Bitrix (contato)');
  por('endereco', d.endereco, 'Bitrix (negócio)');
  por('endereco', ct.endereco, 'Bitrix (contato)');
  por('email', d.email, 'Bitrix (negócio)');
  por('email', cliente?.email, 'ficha do cliente');
  por('email', lead.email, 'lead');
  por('email', ct.email, 'Bitrix (contato)');
  por('email', d.email2, 'Bitrix (negócio)');
  por('telefone', formatarTelefone(lead.phone), 'lead');
  por('telefone', formatarTelefone(cliente?.telefone), 'ficha do cliente');
  por('telefone', formatarTelefone(ct.telefone), 'Bitrix (contato)');

  // ── Venda: o QS manda (ficha → proposta → Bitrix) ──
  if (tipo === 'expedicao') {
    por('expedicao', d.expedicao, 'Bitrix (negócio)');
    por('expedicao', ficha?.destino, 'venda consolidada');
  }
  const itens = ficha?.itens?.length ? ficha.itens : proposta?.itens || [];
  const descItens = itens.map((i) => `${i.nome || i.tipo}${i.descricao ? ` (${String(i.descricao).replace(/\s+/g, ' ').slice(0, 200)})` : ''}`).join('; ');
  const destinoBase = ficha?.destino || proposta?.destino || '';
  if (destinoBase) por('destino', descItens ? `${destinoBase} — inclui: ${descItens}` : destinoBase, ficha ? 'venda consolidada' : 'proposta aprovada');
  por('destino', d.destino, 'Bitrix (negócio)');
  por('tipo_pacote', d.tipo_pacote, 'Bitrix (negócio)');
  if (tipo === 'pacote') por('tipo_pacote', 'Personalizado', 'padrão');
  por('ida', dataBr(ficha?.data_ida || proposta?.data_ida), ficha ? 'venda consolidada' : 'proposta aprovada');
  por('ida', d.ida, 'Bitrix (negócio)');
  por('volta', dataBr(ficha?.data_volta || proposta?.data_volta), ficha ? 'venda consolidada' : 'proposta aprovada');
  por('volta', d.volta, 'Bitrix (negócio)');
  const tiposItens = new Set(itens.map((i) => i.tipo));
  if (itens.length) {
    por('passagem', tiposItens.has('aereo') ? 'Inclusa' : '', ficha ? 'venda consolidada' : 'proposta aprovada');
    por('seguro', tiposItens.has('seguro') ? 'Incluso' : '', ficha ? 'venda consolidada' : 'proposta aprovada');
  }
  por('passagem', d.passagem, 'Bitrix (negócio)');
  por('seguro', d.seguro, 'Bitrix (negócio)');
  if (itens.length) por('passagem', 'Não inclusa', ficha ? 'venda consolidada' : 'proposta aprovada');
  por('valor_total', ficha?.valor_total ? formatarValor(Number(ficha.valor_total)) : '', 'venda consolidada');
  por('valor_total', proposta?.total ? formatarValor(Number(proposta.total)) : '', 'proposta aprovada');
  por('valor_total', d.valor_total ? formatarValor(d.valor_total) : '', 'Bitrix (negócio)');
  por('valor_total', negocio.valor_previsto ? formatarValor(Number(negocio.valor_previsto)) : '', 'valor previsto do cartão');
  por('forma_pagamento', textoDoPlano(ficha?.plano), 'venda consolidada');
  por('forma_pagamento', d.forma_pagamento, 'Bitrix (negócio)');
  if (negocio.closer_id) {
    const c = (await rest(`qs_users?select=name&id=eq.${negocio.closer_id}&limit=1`).catch(() => null))?.[0];
    por('vendedor', c?.name, 'closer do cartão');
  }
  por('vendedor', d.vendedor, 'Bitrix (negócio)');
  por('data_venda', hojeBr(), 'hoje');

  for (const k of CAMPOS) if (campos[k] == null) campos[k] = '';
  return { campos, origem, dealId: dealId || null, avisoBitrix };
}

// ── Validação (a mesma regra no front) ─────────────────────────────────────
export function normalizarCampos(entrada) {
  const c = {};
  for (const k of CAMPOS) c[k] = String(entrada?.[k] ?? '').replace(/\s+\n/g, '\n').trim().slice(0, k === 'destino' ? 3000 : 500);
  c.tipo = c.tipo === 'expedicao' ? 'expedicao' : 'pacote';
  c.email = c.email.toLowerCase();
  return c;
}
export function validarCampos(c) {
  const erros = [];
  const avisos = [];
  if (!c.nome || c.nome === '.') erros.push('Nome completo do cliente.');
  if (!cpfValido(c.cpf)) erros.push('CPF válido (11 números).');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) erros.push('E-mail válido do cliente (é por ele que o ZapSign manda o contrato).');
  if (soDigitos(c.telefone).length < 10) erros.push('Telefone com DDD.');
  if (!(numeroDoValor(c.valor_total) > 0)) erros.push('Valor total.');
  if (!c.forma_pagamento) erros.push('Forma de pagamento.');
  if (c.tipo === 'expedicao' && !c.expedicao) erros.push('Nome da expedição.');
  if (c.tipo === 'pacote' && !c.destino) erros.push('Destino / descrição do pacote.');
  if (!c.data_venda) erros.push('Data.');
  for (const [k, rot] of [['rg', 'RG'], ['endereco', 'Endereço'], ['ida', 'Ida prevista'], ['volta', 'Volta prevista']]) if (!c[k]) avisos.push(`${rot} vazio — sai "-" no contrato.`);
  if (c.tipo === 'expedicao' && !c.nascimento) avisos.push('Data de nascimento vazia — sai "-" no contrato.');
  return { erros, avisos };
}

// ── GERAR (Google) ──────────────────────────────────────────────────────────
function textoDoDocumento(doc) {
  const partes = [];
  const andar = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const x of o) andar(x); return; }
    if (o.textRun && typeof o.textRun.content === 'string') partes.push(o.textRun.content);
    for (const k of Object.keys(o)) if (k !== 'textRun') andar(o[k]);
  };
  andar(doc);
  return partes.join('');
}

export function nomesDoArquivo(c, dealId, negocioId) {
  const tipoLabel = c.tipo === 'expedicao' ? 'Expedição' : 'Pacote';
  const ref = c.tipo === 'expedicao' ? c.expedicao : (String(c.destino).split(' — ')[0] || c.tipo_pacote);
  const refCurta = String(ref || '').slice(0, 80);
  const id = dealId ? `D_${dealId}` : `QS-${String(negocioId).slice(0, 8)}`;
  return {
    arquivo: `Contrato de ${tipoLabel}${refCurta ? ` ${refCurta}` : ''} | ${c.nome} | ${id}`.replace(/[\\/]/g, '-'),
    zapsign: `Contrato de ${tipoLabel} - ${c.nome}${refCurta ? ` | ${refCurta}` : ''} - ${id}`,
  };
}

/**
 * Copia o template, troca as tags, confere, exporta PDF e arquiva no Drive.
 * Devolve { pdf: Buffer, driveId, driveUrl }. Erro com .sobraram = tags que ficaram.
 */
export async function gerarPdf(c, cfg, nomes) {
  const token = await accessToken();
  const template = c.tipo === 'expedicao' ? cfg.template_expedicao : cfg.template_pacote;
  const copia = await google(token, 'POST',
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(template)}/copy?supportsAllDrives=true&fields=id`,
    { json: { name: nomes.arquivo, parents: [cfg.pasta_contratos], mimeType: 'application/vnd.google-apps.document' } });
  const docId = copia?.id;
  if (!docId) throw new Error('O Google não devolveu a cópia do template.');
  try {
    await google(token, 'POST', `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, { json: { requests: pedidosDeTroca(c) } });
    // TRAVA: se ainda tem {{ no documento, não manda pro cliente.
    const doc = await google(token, 'GET', `https://docs.googleapis.com/v1/documents/${docId}?includeTabsContent=true`);
    const sobra = [...new Set(textoDoDocumento(doc).match(/\{\{[^}]{0,120}\}\}?/g) || [])];
    if (sobra.length || textoDoDocumento(doc).includes('{{')) {
      const err = new Error(`O template tem tags que o QS não conhece: ${sobra.join(', ') || '{{ sem fechar'}. Nada foi enviado ao cliente.`);
      err.sobraram = sobra;
      throw err;
    }
    const pdf = await google(token, 'GET', `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=application/pdf`, { binario: true, ms: 30_000 });
    const arq = await subirPdf(token, cfg.pasta_contratos, `${nomes.arquivo}.pdf`, pdf);
    return { pdf, driveId: arq.id, driveUrl: arq.webViewLink || `https://drive.google.com/file/d/${arq.id}/view` };
  } finally {
    // Apaga o Google Doc temporário (o PDF é o que fica).
    await google(token, 'DELETE', `https://www.googleapis.com/drive/v3/files/${docId}?supportsAllDrives=true`, { ms: 10_000 }).catch((e) => console.warn('[contrato] doc temporário não apagado', docId, e?.message));
  }
}

async function subirPdf(token, pasta, nome, buffer) {
  const fronteira = `qs${Date.now().toString(36)}`;
  const meta = JSON.stringify({ name: nome, parents: [pasta], mimeType: 'application/pdf' });
  const corpo = Buffer.concat([
    Buffer.from(`--${fronteira}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${fronteira}\r\nContent-Type: application/pdf\r\n\r\n`, 'utf8'),
    buffer,
    Buffer.from(`\r\n--${fronteira}--`, 'utf8'),
  ]);
  return google(token, 'POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', {
    body: corpo, headers: { 'Content-Type': `multipart/related; boundary=${fronteira}` }, ms: 30_000,
  });
}

/** Guarda a cópia ASSINADA no Drive (o link do ZapSign expira em minutos). */
export async function arquivarAssinado(urlAssinado, nome, cfg) {
  const r = await buscar(urlAssinado, {}, 20_000);
  if (!r.ok) throw new Error(`Não baixei o PDF assinado (HTTP ${r.status}).`);
  const buf = Buffer.from(await r.arrayBuffer());
  const token = await accessToken();
  const arq = await subirPdf(token, cfg.pasta_contratos, nome, buf);
  return arq.webViewLink || `https://drive.google.com/file/d/${arq.id}/view`;
}

// ── ZAPSIGN ─────────────────────────────────────────────────────────────────
const baseZapsign = () => (env('ZAPSIGN_API_URL') || 'https://api.zapsign.com.br').replace(/\/+$/, '');

async function zapsign(method, caminho, json) {
  const tk = env('ZAPSIGN_API_TOKEN');
  if (!tk) throw new Error('Falta ZAPSIGN_API_TOKEN na Vercel.');
  const r = await buscar(`${baseZapsign()}/api/v1/${caminho}`, {
    method,
    headers: { Authorization: `Bearer ${tk}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  }, 25_000);
  const txt = await r.text();
  let j = null;
  try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
  if (!r.ok) {
    const err = new Error(`ZapSign: ${j?.detail || j?.message || (typeof j === 'object' && j ? JSON.stringify(j).slice(0, 300) : txt.slice(0, 200)) || `HTTP ${r.status}`}`);
    err.status = r.status;
    throw err;
  }
  return j;
}

function telefoneDoAssinante(t) {
  let d = soDigitos(t);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 ? { phone_country: d.slice(0, 2), phone_number: d.slice(2) } : {};
}

export async function criarNoZapsign({ c, cfg, nomes, pdf, negocioId }) {
  const doc = await zapsign('POST', 'docs/', {
    name: nomes.zapsign.slice(0, 250),
    base64_pdf: pdf.toString('base64'),
    lang: 'pt-br',
    disable_signer_emails: false,
    signed_file_only_finished: false,
    external_id: negocioId,
    signers: [
      { name: c.nome, email: c.email, send_automatic_email: true, send_automatic_whatsapp: false },
      {
        name: cfg.assinante_nome, email: cfg.assinante_email, ...telefoneDoAssinante(cfg.assinante_telefone),
        send_automatic_email: true, send_automatic_whatsapp: false,
      },
    ],
  });
  const cliente = (doc?.signers || []).find((s) => String(s.email || '').toLowerCase() === c.email) || doc?.signers?.[0];
  return { token: doc?.token, openId: doc?.open_id != null ? String(doc.open_id) : null, link: cliente?.sign_url || null };
}

export const lerNoZapsign = (token) => zapsign('GET', `docs/${encodeURIComponent(token)}/`);
export const apagarNoZapsign = (token) => zapsign('DELETE', `docs/${encodeURIComponent(token)}/`);
export const testarZapsign = () => zapsign('GET', 'docs/?page=1');

/**
 * Status do contrato a partir do documento LIDO no ZapSign (fonte confiável).
 * O cartão vai para "assinado" quando o CLIENTE assina (o assinante da agência
 * assina depois, sem mexer no cartão).
 */
export function statusDoDocumento(doc, emailCliente) {
  if (!doc) return null;
  if (doc.deleted || doc.deleted_at) return { status: 'cancelado' };
  const signers = Array.isArray(doc.signers) ? doc.signers : [];
  const cli = signers.find((s) => String(s.email || '').toLowerCase() === String(emailCliente || '').toLowerCase()) || signers[0] || {};
  const viu = Number(cli.times_viewed || 0);
  const extra = { visualizacoes: viu, link_assinatura: cli.sign_url || undefined };
  if (doc.status === 'refused' || cli.status === 'refused') return { status: 'recusado', extra };
  if (doc.status === 'signed' || cli.status === 'signed') return { status: 'assinado', extra: { ...extra, quando: cli.signed_at || undefined }, arquivo: doc.signed_file || null };
  if (viu > 0 || cli.last_view_at) return { status: 'visualizado', extra: { ...extra, quando: cli.last_view_at || undefined } };
  return { status: 'enviado', extra };
}

export const hashDoCorpo = (corpo) => createHash('sha256').update(typeof corpo === 'string' ? corpo : JSON.stringify(corpo ?? {})).digest('hex');
