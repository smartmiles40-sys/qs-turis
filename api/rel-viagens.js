// api/rel-viagens.js
// -----------------------------------------------------------------------------
// VIAGENS DO RELACIONAMENTO NASCEM DA VENDA NO BITRIX (Fase 3, 0103).
//
//   GET  (Vercel Cron, a cada 30 min, Authorization: Bearer CRON_SECRET)
//        → sincroniza: lê os negócios do Comercial 1 (categoria 0) mexidos
//          desde a última rodada.
//   POST { acao: 'sincronizar' }          → o mesmo, pelo botão da tela
//   POST { acao: 'importar', dealId }     → traz UM negócio (qualquer etapa)
//
// Regras da sincronização:
//   • Venda = etapa "Em emissão" (UC_70BW8E) ou ganho (WON). É a mesma regra do
//     Dashboard: "Em emissão" já conta como venda (21/09/2026).
//   • Desistência (UC_NV92A7) ou perdido (LOSE) → a viagem que já existe vira
//     'cancelada'. As etapas Gerar Pagamento/Envio de contrato também são do
//     grupo "falha" no Bitrix (UC_IHT3PF, UC_FYJCD5) mas vêm ANTES da venda —
//     por isso o cancelamento olha a etapa, nunca o grupo.
//   • ID pai preenchido (≠ "0", ≠ o próprio ID): o negócio é de ACOMPANHANTE
//     (casal, família) — a pessoa entra como passageira na viagem do pai.
//   • O cliente é achado pela ficha única: CPF → contato do Bitrix → telefone.
//     Nunca apaga o que já está na ficha; só completa o que falta.
//   • Na viagem que já existe, campo que vier vazio do Bitrix NÃO apaga o que o
//     time editou à mão.
//
// O cursor fica em rel_config.bitrix_sync. A primeira rodada é um "backfill":
// vendas com Data de Ida a partir de 30 dias atrás OU vendidas desde 01/06/2026.
// Cada rodada tem ~50 s; o que não couber continua na próxima.
//
// FUNIS (13/10/2026, Bruno): venda é venda em 3 funis — Comercial 1 (categoria
// 0), Comercial 2 – Relacionamento e Operações. Os funis extras são achados pelo
// NOME no Bitrix, e a etapa de venda de cada um é a de sucesso (semântica S) ou
// a que se chama "Venda realizada"/"Ganho"/"Em emissão".
//
// HISTÓRICO: depois do backfill, o cursor.historico percorre os 3 funis desde o
// PRIMEIRO negócio (ID crescente), um pedaço por rodada, até acabar.
//
// MESMA VIAGEM EM DOIS FUNIS: se o cliente já tem viagem ativa com a mesma data
// de embarque e o mesmo destino/expedição, o negócio novo não cria outra — fica
// ligado à existente em rel_viagem_deals (0108) pra conferência.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { bx, bitrixConfigurado } from './_bitrixLead.js';
import { getSupabaseUserId } from './_wa.js';
import { baixarArquivos, enfileirarArquivos } from './_relBitrixArquivos.js';

const ORCAMENTO_MS = 50_000;
const ETAPAS_VENDA = new Set(['WON', 'UC_70BW8E']);
const ETAPAS_CANCELA = new Set(['UC_NV92A7', 'LOSE']);

// "Processo Pós Venda - Viagem" (Bruno, 13/10): TODO cliente que comprou passa
// por ele, e os bilhetes dos voos estão nos cards. Ali qualquer etapa que não
// seja de falha conta — e o card quase sempre é a mesma viagem da venda.
const POS_VENDA = /p[oó]s.?venda/i;

// Funis extras, achados pelo nome (Comercial 1 é sempre a categoria 0).
// "Vendas Realizadas" (funil antigo, fev–abr/2026) entrou a pedido do Bruno.
const FUNIS_EXTRAS = [/comercial/i, /relacionamento/i, /opera[cç][aãoõ]/i, /vendas?\s+realizadas?/i, POS_VENDA];
// Funis de lead (ainda não compraram) nunca viram cliente do Relacionamento.
const FUNIS_FORA = /pr[eé].?venda|live|tecnologia|marketing|recrut|teste/i;
const NOME_VENDA = /vendas?\s+realizadas?|ganh[oa]|em\s+emiss/i;
const NOME_CANCELA = /desist|perdid|cancel/i;

// Campos do negócio (Comercial 1). Mapeados em 09/10/2026 por crm.deal.fields.
const F = {
  destino: 'UF_CRM_1746633298495',
  ida: 'UF_CRM_1746633380991',
  volta: 'UF_CRM_1746633410333',
  nomeExpedicao: 'UF_CRM_1768941254969',      // enum ("Não se aplica" = não é expedição)
  selecioneExpedicao: 'UF_CRM_1746374883088', // enum (antigo)
  qualExpedicao: 'UF_CRM_1771970668975',      // enum (form de fechamento)
  tipoVenda: 'UF_CRM_1743296167520',          // enum
  tipoPacote: 'UF_CRM_1771511032311',         // enum
  cpf: 'UF_CRM_1762288761917',
  validadePassaporte: 'UF_CRM_DEAL_1771942313366',
  nascimento: 'UF_CRM_1756148121396',
  nascimento2: 'UF_CRM_DATADENASCIMENTO',
  pax: 'UF_CRM_1778773233483',
  pax2: 'UF_CRM_1756146545056',
  dataVenda: 'UF_CRM_1767827179708',
  obsRelacionamento: 'UF_CRM_1756147556245',
  necessidade: 'UF_CRM_1756147294051',
  idPai: 'UF_CRM_1790891281841',
};
// Campos do contato.
const C = {
  cpf: 'UF_CRM_1749757426655',
  cpf2: 'UF_CRM_1752691408782',
  passaporte: 'UF_CRM_1752523114589',
  passaporte2: 'UF_CRM_1783969513247',
  vencPassaporte: 'UF_CRM_1752523126895',
};

// Todos os campos (0109): a viagem guarda a cópia completa do negócio.
const SELECT_DEAL = ['*', 'UF_*'];

/** JSON com as chaves em ordem — pra comparar a cópia sem regravar à toa. */
const estavel = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));

// ── Pequenas utilidades ─────────────────────────────────────────────────────

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const vazio = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
const texto = (v) => (vazio(v) ? null : String(Array.isArray(v) ? v[0] : v).trim() || null);
/** "2026-11-09T03:00:00+03:00" → "2026-11-09" (o Bitrix guarda a data no fuso dele). */
const data = (v) => {
  const t = texto(v);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};
const numero = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Mesmo jeito do gatilho do banco: dígitos e, com DDD BR sem 55, põe o 55. */
function telefoneNormal(v) {
  let d = soDigitos(v);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

function cpfValido(v) {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  const calc = (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]) ? d : null;
}

function passaporteValido(v) {
  const p = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{5,12}$/.test(p) ? p : null;
}

function emailValido(v) {
  const e = String(v ?? '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

// ── Rótulos dos campos de lista (enum) ──────────────────────────────────────

let cacheCampos = null;
async function rotulos() {
  if (cacheCampos && Date.now() - cacheCampos.em < 30 * 60_000) return cacheCampos.v;
  const campos = await bx('crm.deal.fields', {}, 12_000);
  const v = {};
  for (const [k, def] of Object.entries(campos || {})) {
    if (Array.isArray(def?.items)) v[k] = new Map(def.items.map((i) => [String(i.ID), String(i.VALUE)]));
  }
  v.__defs = campos || {};
  cacheCampos = { v, em: Date.now() };
  return v;
}

let cacheCamposContato = null;
async function camposDoContato() {
  if (cacheCamposContato && Date.now() - cacheCamposContato.em < 30 * 60_000) return cacheCamposContato.v;
  let v = {};
  try { v = (await bx('crm.contact.fields', {}, 12_000)) || {}; } catch (e) { console.warn('[rel-viagens] campos do contato:', e?.message); }
  cacheCamposContato = { v, em: Date.now() };
  return v;
}

/**
 * Cópia de TODOS os campos preenchidos (0109): chave = nome do campo no Bitrix
 * (com o código entre colchetes), valor = o que está lá — opção de lista vira
 * o texto da opção. Telefones/e-mails viram lista de valores.
 */
const CAMPOS_TECNICOS = new Set(['ID', 'ORIGIN_ID', 'ORIGINATOR_ID', 'LEAD_ID', 'IS_RECURRING', 'IS_RETURN_CUSTOMER', 'IS_REPEATED_APPROACH', 'IS_MANUAL_OPPORTUNITY', 'MOVED_BY_ID', 'MOVED_TIME', 'LAST_ACTIVITY_BY', 'LAST_ACTIVITY_TIME', 'LAST_COMMUNICATION_TIME', 'PROBABILITY', 'TAX_VALUE', 'IS_NEW', 'HAS_PHONE', 'HAS_EMAIL', 'HAS_IMOL', 'EXPORT', 'IMS', 'WEB', 'FACE_ID', 'PHOTO']);
function dadosCompletos(obj, defs) {
  if (!obj) return null;
  const out = {};
  for (const [k, bruto] of Object.entries(obj)) {
    if (CAMPOS_TECNICOS.has(k) || vazio(bruto) || bruto === '0' || bruto === 'N' && !k.startsWith('UF_')) continue;
    const def = defs?.[k];
    const nome = String(def?.formLabel || def?.listLabel || def?.title || k).trim();
    let valor = bruto;
    if (Array.isArray(bruto) && bruto.length && typeof bruto[0] === 'object' && bruto[0] && 'VALUE' in bruto[0]) {
      valor = bruto.map((x) => x.VALUE).filter(Boolean);           // PHONE / EMAIL
    } else if (Array.isArray(def?.items)) {
      const mapa = new Map(def.items.map((i) => [String(i.ID), String(i.VALUE)]));
      valor = Array.isArray(bruto) ? bruto.map((x) => mapa.get(String(x)) || x) : (mapa.get(String(bruto)) || bruto);
    }
    if (vazio(valor)) continue;
    out[nome === k ? k : `${nome} [${k}]`] = valor;
  }
  return out;
}
function rotulo(mapa, campo, valor) {
  const id = texto(valor);
  if (!id) return null;
  return mapa[campo]?.get(id) || null;
}

// ── Funis que contam como venda ─────────────────────────────────────────────

let cacheFunis = null;
async function listarCategorias() {
  try {
    const r = await bx('crm.category.list', { entityTypeId: 2 }, 12_000);
    const lista = r?.categories || [];
    if (lista.length) return lista.map((c) => ({ id: String(c.id), nome: String(c.name || '') }));
  } catch { /* cai no método antigo */ }
  const r = await bx('crm.dealcategory.list', {}, 12_000);
  return (r || []).map((c) => ({ id: String(c.ID), nome: String(c.NAME || '') }));
}
async function funis() {
  if (cacheFunis && Date.now() - cacheFunis.em < 30 * 60_000) return cacheFunis.v;
  const lista = [{ id: '0', nome: 'Comercial 1', venda: new Set(ETAPAS_VENDA), cancela: new Set(ETAPAS_CANCELA) }];
  for (const c of await listarCategorias()) {
    if (c.id === '0' || !FUNIS_EXTRAS.some((r) => r.test(c.nome)) || FUNIS_FORA.test(c.nome)) continue;
    const etapas = await bx('crm.status.list', { filter: { ENTITY_ID: `DEAL_STAGE_${c.id}` } }, 12_000);
    const venda = new Set(), cancela = new Set();
    const posVenda = POS_VENDA.test(c.nome);
    // "Vendas Realizadas" (funil antigo): o funil INTEIRO é de venda — a etapa
    // "Vendas Operações" tinha 57 vendas que ficavam de fora (conferido com o
    // sistema de Expedições em 13/10). Toda etapa que não é de falha conta.
    // Operações também (Bruno, 13/10: "lá é quase só venda de relacionamento, e alguns clientes novos").
    const funilSoDeVenda = /vendas?\s+realizadas?|opera[cç][aãoõ]/i.test(c.nome);
    for (const e of etapas || []) {
      const sem = e?.EXTRA?.SEMANTICS || e?.SEMANTICS || null;
      const nome = String(e?.NAME || '');
      const sid = String(e?.STATUS_ID || '');
      const falha = sem === 'failure' || sem === 'F' || sid.endsWith(':LOSE');
      if (posVenda) { if (!falha) venda.add(sid); continue; }   // pós-venda nunca cancela viagem
      if (funilSoDeVenda) { if (!falha) venda.add(sid); else if (NOME_CANCELA.test(nome) || sid.endsWith(':LOSE')) cancela.add(sid); continue; }
      if (sem === 'success' || sem === 'S' || NOME_VENDA.test(nome)) venda.add(sid);
      else if (sid.endsWith(':LOSE') || ((sem === 'failure' || sem === 'F') && NOME_CANCELA.test(nome))) cancela.add(sid);
    }
    if (venda.size) lista.push({ id: c.id, nome: c.nome, venda, cancela, posVenda });
  }
  // Pós-venda por último: os cards dele se ligam às viagens que os funis de venda já criaram.
  lista.sort((a, b) => Number(!!a.posVenda) - Number(!!b.posVenda));
  cacheFunis = { v: lista, em: Date.now() };
  return lista;
}
const funilDe = (deal, fs) => fs.find((f) => f.id === String(deal?.CATEGORY_ID ?? '0'));
const ehVenda = (deal, fs) => !!funilDe(deal, fs)?.venda.has(String(deal?.STAGE_ID));
const ehCancela = (deal, fs) => !!funilDe(deal, fs)?.cancela.has(String(deal?.STAGE_ID));

/** Pra comparar destino/expedição: sem acento, minúsculo, só letras e números. */
const chaveLugar = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function mesmoLugar(a, b) {
  const ea = chaveLugar(a.expedicao), eb = chaveLugar(b.expedicao);
  if (ea && eb) return ea === eb;
  const da = chaveLugar(a.destino || a.expedicao), db = chaveLugar(b.destino || b.expedicao);
  if (!da || !db) return true; // um lado sem destino: mesma pessoa, mesmo dia de embarque — é a mesma viagem
  return da === db || da.includes(db) || db.includes(da);
}

// ── Cliente (ficha única) ───────────────────────────────────────────────────

/** Lê o contato do Bitrix (cache por rodada). */
async function contatoDoBitrix(id, cache) {
  const k = soDigitos(id);
  if (!k || k === '0') return null;
  if (cache.has(k)) return cache.get(k);
  let c = null;
  try { c = await bx('crm.contact.get', { id: k }); } catch (e) { console.warn('[rel-viagens] contato', k, e?.message); }
  cache.set(k, c);
  return c;
}

/** Os dados da pessoa, juntando negócio + contato. */
function dadosDaPessoa(deal, contato) {
  const nome = [texto(contato?.NAME), texto(contato?.LAST_NAME)].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    || null;
  const fone = Array.isArray(contato?.PHONE) ? contato.PHONE.map((p) => telefoneNormal(p?.VALUE)).find(Boolean) : null;
  const email = Array.isArray(contato?.EMAIL) ? contato.EMAIL.map((p) => emailValido(p?.VALUE)).find(Boolean) : null;
  return {
    nome,
    telefone: fone || null,
    email: email || null,
    cpf: cpfValido(deal?.[F.cpf]) || cpfValido(contato?.[C.cpf]) || cpfValido(contato?.[C.cpf2]),
    nascimento: data(deal?.[F.nascimento]) || data(deal?.[F.nascimento2]) || data(contato?.BIRTHDATE),
    passaporte: passaporteValido(contato?.[C.passaporte]) || passaporteValido(contato?.[C.passaporte2]),
    passaporte_validade: data(deal?.[F.validadePassaporte]) || data(contato?.[C.vencPassaporte]),
    bitrix_contato_id: texto(contato?.ID) || (soDigitos(deal?.CONTACT_ID) && deal.CONTACT_ID !== '0' ? String(deal.CONTACT_ID) : null),
  };
}

const VIVOS = 'mesclado_em_id=is.null';
async function procurar(filtro) {
  const r = await rest(`rel_clientes?select=*&${filtro}&${VIVOS}&limit=1`);
  return r?.[0] || null;
}

/** Acha (CPF → contato Bitrix → telefone) ou cria a ficha. Devolve o id ou null. */
async function garantirCliente(p) {
  if (!p.nome && !p.telefone && !p.cpf) return null;
  let atual = null;
  if (p.cpf) atual = await procurar(`cpf=eq.${p.cpf}`);
  if (!atual && p.bitrix_contato_id) atual = await procurar(`bitrix_contato_id=eq.${encodeURIComponent(p.bitrix_contato_id)}`);
  if (!atual && p.telefone) atual = await procurar(`telefone=eq.${p.telefone}`);

  if (atual) {
    // Só completa o que falta. Os campos únicos (CPF, passaporte, Bitrix) podem
    // colidir com outra ficha — aí tenta de novo sem eles.
    const patch = {};
    for (const k of ['telefone', 'email', 'cpf', 'nascimento', 'passaporte', 'passaporte_validade', 'bitrix_contato_id']) {
      if (vazio(atual[k]) && !vazio(p[k])) patch[k] = p[k];
    }
    // Cópia completa do contato só na ficha que É desse contato (não na do parente que divide o telefone).
    const doContato = p.bitrix_dados && p.bitrix_contato_id
      && (atual.bitrix_contato_id === p.bitrix_contato_id || patch.bitrix_contato_id === p.bitrix_contato_id);
    if (doContato && estavel(atual.bitrix_dados) !== estavel(p.bitrix_dados)) {
      patch.bitrix_dados = p.bitrix_dados;
      patch.bitrix_lido_em = new Date().toISOString();
    }
    if (Object.keys(patch).length) {
      try {
        await rest(`rel_clientes?id=eq.${atual.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
      } catch (e) {
        if (e?.status !== 409) throw e;
        delete patch.cpf; delete patch.passaporte; delete patch.bitrix_contato_id;
        if (Object.keys(patch).length) await rest(`rel_clientes?id=eq.${atual.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
      }
    }
    return atual.id;
  }

  const novo = {
    nome: p.nome || (p.telefone ? `Cliente ${p.telefone.slice(-4)}` : 'Cliente do Bitrix'),
    telefone: p.telefone, email: p.email, cpf: p.cpf, nascimento: p.nascimento,
    passaporte: p.passaporte, passaporte_validade: p.passaporte_validade, bitrix_contato_id: p.bitrix_contato_id,
    bitrix_dados: p.bitrix_dados || null, bitrix_lido_em: p.bitrix_dados ? new Date().toISOString() : null,
    observacoes: 'Ficha criada a partir da venda no Bitrix.',
  };
  try {
    const r = await rest('rel_clientes', { method: 'POST', body: novo, prefer: 'return=representation' });
    return r?.[0]?.id || null;
  } catch (e) {
    if (e?.status !== 409) throw e;
    // Alguém com o mesmo CPF/passaporte/contato já existe (talvez criado agora):
    // usa ele.
    const outro = (p.cpf && await procurar(`cpf=eq.${p.cpf}`))
      || (p.passaporte && await procurar(`passaporte=eq.${p.passaporte}`))
      || (p.bitrix_contato_id && await procurar(`bitrix_contato_id=eq.${encodeURIComponent(p.bitrix_contato_id)}`));
    return outro?.id || null;
  }
}

// ── Viagem ──────────────────────────────────────────────────────────────────

function camposDaViagem(deal, mapa) {
  const nomeExp = rotulo(mapa, F.nomeExpedicao, deal[F.nomeExpedicao]);
  const expedicao = (nomeExp && !/n[aã]o se aplica/i.test(nomeExp) ? nomeExp : null)
    || rotulo(mapa, F.qualExpedicao, deal[F.qualExpedicao])
    || rotulo(mapa, F.selecioneExpedicao, deal[F.selecioneExpedicao]);
  const tipoVenda = (rotulo(mapa, F.tipoVenda, deal[F.tipoVenda]) || '').toLowerCase();
  const tipoPacote = (rotulo(mapa, F.tipoPacote, deal[F.tipoPacote]) || '').toLowerCase();
  let tipo = 'outro';
  if (expedicao || tipoVenda.includes('expedi') || tipoPacote.includes('expedi')) tipo = 'expedicao';
  else if (tipoVenda.includes('pacote') || tipoPacote.includes('personaliz')) tipo = 'pacote';
  else if (tipoVenda.includes('aére') || tipoVenda.includes('aere') || tipoVenda.includes('passage')) tipo = 'aereo';
  else if (tipoVenda.includes('hosped')) tipo = 'hospedagem';

  const destino = texto(deal[F.destino]);
  const embarque = data(deal[F.ida]);
  let retorno = data(deal[F.volta]);
  if (retorno && embarque && retorno < embarque) retorno = null; // data trocada no Bitrix: não trava a gravação
  // Em "Em emissão" o card ainda não tem destino nem datas e o título é o
  // genérico "Negociação #id" — melhor dizer o que foi vendido.
  const tituloCard = texto(deal.TITLE);
  const generico = !tituloCard || /^negocia[cç][aã]o\s*#?\d*$/i.test(tituloCard);
  const rotuloVenda = rotulo(mapa, F.tipoVenda, deal[F.tipoVenda]);
  const reserva = `${rotuloVenda || 'Venda'} — #${deal.ID}`;
  const bom = (t) => (t && t.trim().length >= 2 ? t.trim() : null); // o banco exige 2+ letras
  const titulo = bom(expedicao) || bom(destino) || (generico ? reserva : bom(tituloCard)) || reserva;
  return {
    titulo: titulo.slice(0, 200),
    destino,
    expedicao,
    tipo,
    data_venda: data(deal[F.dataVenda]),
    data_embarque: embarque,
    data_retorno: retorno,
    valor: numero(deal.OPPORTUNITY),
    qtd_passageiros: Math.round(numero(deal[F.pax]) || numero(deal[F.pax2]) || 0) || null,
    observacoes: texto(deal[F.obsRelacionamento]),
    necessidades: texto(deal[F.necessidade]),
  };
}

async function viagemDoDeal(dealId) {
  const r = await rest(`rel_viagens?select=id,status,cliente_id,titulo,destino,expedicao,tipo,data_venda,data_embarque,data_retorno,valor,qtd_passageiros,observacoes,necessidades,bitrix_funil,bitrix_dados&bitrix_deal_id=eq.${encodeURIComponent(dealId)}&limit=1`);
  return r?.[0] || null;
}

/** Negócio de outro funil que foi ligado a uma viagem existente (0108). */
async function viagemLigada(dealId) {
  const r = await rest(`rel_viagem_deals?select=viagem_id&bitrix_deal_id=eq.${encodeURIComponent(dealId)}&limit=1`);
  const vid = r?.[0]?.viagem_id;
  if (!vid) return null;
  const v = await rest(`rel_viagens?select=id,status,cliente_id&id=eq.${vid}&limit=1`);
  return v?.[0] || null;
}

/** Viagem ativa do cliente (titular ou passageiro) com o mesmo embarque e o mesmo lugar. */
async function mesmaViagemDoCliente(clienteId, novos, { frouxo = false } = {}) {
  if (!clienteId || (!novos.data_embarque && !frouxo)) return null;
  const cols = 'id,destino,expedicao,data_embarque';
  const filtroData = !frouxo ? `&data_embarque=eq.${novos.data_embarque}` : '';
  const titular = (await rest(`rel_viagens?select=${cols}&cliente_id=eq.${clienteId}${filtroData}&status=eq.ativa&limit=50`)) || [];
  const pass = (await rest(`rel_viagem_passageiros?select=viagem_id&cliente_id=eq.${clienteId}&limit=200`)) || [];
  const ids = [...new Set(pass.map((p) => p.viagem_id))].filter((x) => !titular.some((t) => t.id === x));
  const comoPassageiro = ids.length
    ? (await rest(`rel_viagens?select=${cols}&id=in.(${ids.join(',')})${filtroData}&status=eq.ativa`)) || []
    : [];
  const todas = [...titular, ...comoPassageiro];
  if (!frouxo) return todas.find((v) => mesmoLugar(v, novos)) || null;
  // Pós-venda: o card pode vir sem data ou com a data um pouco diferente.
  const ms = (d) => (d ? new Date(d).getTime() : 0);
  const perto = (a, b) => !a || !b || Math.abs(ms(a) - ms(b)) <= 7 * 86_400_000;
  const casam = todas.filter((v) => mesmoLugar(v, novos) && perto(v.data_embarque, novos.data_embarque));
  if (casam.length) return casam.sort((a, b) => Math.abs(ms(a.data_embarque) - ms(novos.data_embarque)) - Math.abs(ms(b.data_embarque) - ms(novos.data_embarque)))[0];
  // Card sem destino e sem data, e o cliente tem UMA viagem só: é ela.
  if (!novos.destino && !novos.expedicao && !novos.data_embarque && todas.length === 1) return todas[0];
  return null;
}

/** ID pai válido = número, ≠ 0, ≠ o próprio negócio. */
function idPai(deal) {
  const p = soDigitos(deal?.[F.idPai]);
  return p && p !== '0' && p !== String(deal.ID) ? p : null;
}

/**
 * Importa um negócio. `ctx` carrega os caches e os contadores da rodada.
 * `profundidade` evita laço (pai que aponta pro filho).
 */
async function importarDeal(deal, ctx, profundidade = 0) {
  const r = await importarDealCore(deal, ctx, profundidade);
  // Arquivos do card (bilhetes, vouchers...) vão pra fila de download (0110).
  if (r?.viagemId || r?.clienteId) {
    try { ctx.conta.arquivos += await enfileirarArquivos(deal, ctx.mapa.__defs, r); }
    catch (e) { console.warn(`[rel-viagens] arquivos do negócio ${deal.ID}:`, e?.message); }
  }
}

async function importarDealCore(deal, ctx, profundidade = 0) {
  const id = String(deal.ID);
  const conta = ctx.conta;

  // ── Cancelamento ──
  if (ehCancela(deal, ctx.funis)) {
    const v = await viagemDoDeal(id);
    if (v && v.status !== 'cancelada') {
      await rest(`rel_viagens?id=eq.${v.id}`, { method: 'PATCH', body: { status: 'cancelada' }, prefer: 'return=minimal' });
      conta.cancelados++;
    }
    // Negócio só LIGADO a uma viagem de outro funil: desfaz a ligação, a viagem segue.
    if (!v) await rest(`rel_viagem_deals?bitrix_deal_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
    return null;
  }
  if (!ctx.qualquerEtapa && !ehVenda(deal, ctx.funis)) return null;
  const funil = funilDe(deal, ctx.funis);

  const contato = await contatoDoBitrix(deal.CONTACT_ID, ctx.contatos);
  const pessoa = dadosDaPessoa(deal, contato);
  pessoa.bitrix_dados = contato ? dadosCompletos(contato, await camposDoContato()) : null;
  const clienteId = await garantirCliente(pessoa);

  // ── Acompanhante: entra como passageiro na viagem do pai ──
  const pai = idPai(deal);
  if (pai && profundidade < 2) {
    let vPai = (await viagemDoDeal(pai)) || (await viagemLigada(pai));
    if (!vPai) {
      let dealPai = null;
      try { dealPai = await bx('crm.deal.get', { id: pai }); } catch { /* pai não existe */ }
      if (dealPai && (ehVenda(dealPai, ctx.funis) || ctx.qualquerEtapa)) {
        await importarDeal(dealPai, { ...ctx, qualquerEtapa: true }, profundidade + 1);
        vPai = (await viagemDoDeal(pai)) || (await viagemLigada(pai));
      }
    }
    if (vPai) {
      if (clienteId) {
        try {
          await rest('rel_viagem_passageiros?on_conflict=viagem_id,cliente_id', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=minimal',
            body: { viagem_id: vPai.id, cliente_id: clienteId, bitrix_deal_id: id },
          });
          conta.passageiros++;
        } catch (e) {
          // O mesmo card já é passageiro de outra viagem (o ID pai mudou): ignora.
          if (e?.status !== 409) throw e;
        }
      }
      return { viagemId: vPai.id, clienteId };
    }
    // Pai não é venda nem existe: segue como viagem própria.
  }

  // ── Viagem própria ──
  const novos = { ...camposDaViagem(deal, ctx.mapa), bitrix_funil: funil?.nome || null, bitrix_dados: dadosCompletos(deal, ctx.mapa.__defs) };
  const atual = await viagemDoDeal(id);
  if (!atual) {
    // Já ligado a uma viagem de outro funil: quem manda nos dados é o negócio principal.
    const ligada = await viagemLigada(id);
    const mesma = ligada || await mesmaViagemDoCliente(clienteId, novos, { frouxo: !!funil?.posVenda });
    if (mesma) {
      // Fica ligado, e a cópia dos campos do card (os voos, no pós-venda) fica guardada na ligação.
      await rest('rel_viagem_deals?on_conflict=bitrix_deal_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: {
          bitrix_deal_id: id, viagem_id: mesma.id, funil: funil?.nome || null,
          motivo: funil?.posVenda ? 'card do pós-venda da mesma viagem' : 'mesmo cliente, embarque e destino',
          bitrix_dados: novos.bitrix_dados, bitrix_lido_em: new Date().toISOString(),
        },
      });
      if (!ligada) conta.ligados++;
      return { viagemId: mesma.id, clienteId };
    }
    const criada = await rest('rel_viagens', {
      method: 'POST', prefer: 'return=representation',
      body: { ...novos, cliente_id: clienteId, bitrix_deal_id: id, origem: 'bitrix', status: 'ativa', bitrix_lido_em: new Date().toISOString() },
    });
    conta.criados++;
    return { viagemId: criada?.[0]?.id || null, clienteId };
  }
  // Atualiza só o que veio preenchido e mudou; reativa se tinha cancelado.
  const patch = {};
  // O título só acompanha o Bitrix enquanto é o que NÓS geramos; se o time
  // renomeou a viagem na tela, fica o nome dele.
  const tituloNosso = !atual.titulo || /— #\d+$/.test(atual.titulo)
    || atual.titulo === atual.destino || atual.titulo === atual.expedicao;
  for (const [k, v] of Object.entries(novos)) {
    if (v == null) continue;
    if (k === 'titulo' && !tituloNosso) continue;
    if (k === 'bitrix_dados') { if (estavel(atual.bitrix_dados) !== estavel(v)) { patch.bitrix_dados = v; patch.bitrix_lido_em = new Date().toISOString(); } continue; }
    if (String(atual[k] ?? '') !== String(v)) patch[k] = v;
  }
  if (!atual.cliente_id && clienteId) patch.cliente_id = clienteId;
  if (atual.status === 'cancelada') patch.status = 'ativa';
  if (Object.keys(patch).length) {
    await rest(`rel_viagens?id=eq.${atual.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
    conta.atualizados++;
  }
  return { viagemId: atual.id, clienteId: atual.cliente_id || clienteId };
}

// ── A rodada ────────────────────────────────────────────────────────────────

async function lerCursor() {
  const r = await rest('rel_config?select=valor&chave=eq.bitrix_sync&limit=1').catch(() => null);
  return r?.[0]?.valor || {};
}
async function gravarCursor(valor) {
  await rest('rel_config?on_conflict=chave', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { chave: 'bitrix_sync', valor, atualizado_em: new Date().toISOString() },
  });
}

/**
 * Traz de uma vez os contatos de uma página de negócios (1 chamada em vez de
 * 50). O backfill passa de 400 vendas: sem isto, cada rodada gastaria quase
 * todo o orçamento só lendo contato um por um.
 */
async function precarregarContatos(lista, cache) {
  const ids = [...new Set(lista.map((d) => soDigitos(d.CONTACT_ID)).filter((x) => x && x !== '0' && !cache.has(x)))];
  if (!ids.length) return;
  try {
    const cs = await bx('crm.contact.list', { filter: { ID: ids }, select: ['*', 'UF_*', 'PHONE', 'EMAIL'] }, 12_000);
    for (const c of cs || []) cache.set(String(c.ID), c);
  } catch (e) {
    console.warn('[rel-viagens] contatos em lote falharam (segue um por um):', e?.message);
  }
}

/** Uma página de crm.deal.list (devolve também o `next` do Bitrix). */
async function pagina(filtro, ordem, start) {
  const base = String(process.env.BITRIX_WEBHOOK_BASE || '').trim().replace(/\/+$/, '');
  const r = await fetch(`${base}/crm.deal.list.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filter: filtro, order: ordem, select: SELECT_DEAL, start }),
  });
  const j = await r.json().catch(() => null);
  if (!j || j.error) throw new Error(j?.error_description || j?.error || `Bitrix HTTP ${r.status}`);
  return { lista: j.result || [], next: j.next ?? null };
}

export async function sincronizar() {
  const inicio = Date.now();
  const conta = { lidos: 0, criados: 0, atualizados: 0, cancelados: 0, passageiros: 0, ligados: 0, arquivos: 0, baixados: 0, erros: 0, completo: true };
  const ctx = { conta, contatos: new Map(), mapa: await rotulos(), funis: await funis(), qualquerEtapa: false };
  const cursor = await lerCursor();
  const acabouTempo = () => Date.now() - inicio > ORCAMENTO_MS;

  async function processar(deal) {
    conta.lidos++;
    try { await importarDeal(deal, ctx); }
    catch (e) { conta.erros++; console.error(`[rel-viagens] negócio ${deal.ID}:`, e?.message); }
  }

  // ── 1ª vez: backfill por ID crescente (dá pra continuar de onde parou) ──
  if (!cursor.backfill_feito) {
    const corte = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const filtros = [
      { CATEGORY_ID: 0, STAGE_ID: [...ETAPAS_VENDA], [`>=${F.ida}`]: corte },
      { CATEGORY_ID: 0, STAGE_ID: [...ETAPAS_VENDA], [`>=${F.dataVenda}`]: '2026-06-01' },
    ];
    // A paginação é pelo próprio ID (">ID" + ordem crescente), não pelo `start`
    // do Bitrix: assim a rodada que estoura o tempo continua exatamente do
    // último negócio processado.
    const backfillInicio = cursor.backfill_inicio || new Date(inicio).toISOString();
    let etapa = Number(cursor.backfill_etapa || 0);
    let ultimoId = Number(cursor.backfill_id || 0);
    while (etapa < filtros.length) {
      if (acabouTempo()) {
        conta.completo = false;
        await gravarCursor({ backfill_inicio: backfillInicio, backfill_etapa: etapa, backfill_id: ultimoId });
        return conta;
      }
      const { lista } = await pagina({ ...filtros[etapa], '>ID': ultimoId }, { ID: 'ASC' }, 0);
      if (!lista.length) { etapa++; ultimoId = 0; continue; }
      await precarregarContatos(lista, ctx.contatos);
      for (const d of lista) {
        await processar(d);
        ultimoId = Math.max(ultimoId, Number(d.ID));
        if (acabouTempo()) break;
      }
    }
    // Daqui pra frente, só o que mudou desde o começo do backfill.
    await gravarCursor({ backfill_feito: true, ultimo: backfillInicio });
    return conta;
  }

  // ── Rodadas normais: tudo dos funis de venda mexido desde o cursor ──
  // Sem filtro de etapa: é assim que a desistência/perda aparece. Ordenado por
  // data de modificação, o cursor avança até o último processado. Enquanto o
  // histórico não termina, isto fica com metade do tempo da rodada.
  const h = cursor.historico || { idx: 0, ultimo_id: 0, inicio: new Date(inicio).toISOString() };
  const limiteDelta = () => (h.feito ? acabouTempo() : Date.now() - inicio > ORCAMENTO_MS / 2);
  const categorias = ctx.funis.map((f) => Number(f.id));
  let ultimo = cursor.ultimo || new Date(inicio - 86_400_000).toISOString();
  let start = 0;
  const desde = ultimo;
  for (;;) {
    if (limiteDelta()) { conta.completo = false; break; }
    // ">=": negócio com o mesmo horário do último processado não se perde
    // (processar de novo é inofensivo — tudo aqui é idempotente).
    const { lista, next } = await pagina({ CATEGORY_ID: categorias, '>=DATE_MODIFY': desde }, { DATE_MODIFY: 'ASC', ID: 'ASC' }, start);
    await precarregarContatos(lista.filter((d) => ehVenda(d, ctx.funis)), ctx.contatos);
    let parou = false;
    for (const d of lista) {
      if (ehVenda(d, ctx.funis) || ehCancela(d, ctx.funis)) await processar(d);
      if (d.DATE_MODIFY) ultimo = d.DATE_MODIFY;
      if (limiteDelta()) { parou = true; break; }
    }
    if (parou) { conta.completo = false; break; }
    if (next == null || !lista.length) break;
    start = next;
  }
  const novoCursor = { ...cursor, ultimo };

  // ── Histórico: os funis de venda desde o PRIMEIRO negócio, um pedaço por rodada ──
  // Cada funil é marcado em h.prontos quando termina; funil novo (ou a mudança
  // pra cópia completa dos dados, versão 2) faz o histórico voltar a rodar.
  const VERSAO_HISTORICO = 4; // 3: título curto · 4: arquivos dos cards (bilhetes) — 13/10
  if (h.versao !== VERSAO_HISTORICO) Object.assign(h, { versao: VERSAO_HISTORICO, prontos: [], atual: null, ultimo_id: 0, idx: 0, feito: false, contagem: {} });
  h.prontos = h.prontos || [];
  // Pronto = funil + etapas de venda: se aparecer etapa nova no funil, ele roda de novo.
  const marca = (f) => `${f.id}:${[...f.venda].sort().join("|")}`;
  const faltam = () => ctx.funis.filter((f) => !h.prontos.includes(marca(f)));
  if (faltam().length) h.feito = false;
  // O histórico para aos 35 s: o resto da rodada é dos arquivos dos cards.
  const acabouHist = () => Date.now() - inicio > ORCAMENTO_MS - 15_000;
  if (!h.feito) {
    const fs = ctx.funis;
    while (faltam().length && !acabouHist()) {
      const f = faltam()[0];
      if (h.atual !== marca(f)) { h.atual = marca(f); h.ultimo_id = 0; }
      const { lista } = await pagina({ CATEGORY_ID: Number(f.id), STAGE_ID: [...f.venda], '>ID': h.ultimo_id }, { ID: 'ASC' }, 0);
      if (!lista.length) { h.prontos.push(marca(f)); h.atual = null; h.ultimo_id = 0; continue; }
      await precarregarContatos(lista, ctx.contatos);
      for (const d of lista) {
        await processar(d);
        h.ultimo_id = Math.max(h.ultimo_id, Number(d.ID));
        if (acabouHist()) break;
      }
    }
    h.funis = fs.map((f) => `${f.id}=${f.nome} [${[...f.venda].join(',')}]`);
    if (!h.todos_funis) h.todos_funis = (await listarCategorias().catch(() => [])).map((c) => `${c.id}=${c.nome}`);
    if (!faltam().length) { h.feito = true; h.fim = new Date().toISOString(); }
    else {
      conta.completo = false;
      conta.historico = `${faltam()[0].nome}: até o negócio #${h.ultimo_id}`;
    }
    h.contagem = Object.fromEntries(['lidos', 'criados', 'atualizados', 'passageiros', 'ligados', 'arquivos', 'baixados', 'erros']
      .map((k) => [k, (h.contagem?.[k] || 0) + (conta[k] || 0)]));
    novoCursor.historico = h;
  }

  await gravarCursor(novoCursor);

  // Arquivos dos cards (bilhetes...): com o tempo que sobrar da rodada.
  try {
    const b = await baixarArquivos(() => Date.now() - inicio < ORCAMENTO_MS - 8_000);
    conta.baixados = b.baixados;
    if (b.falhas) conta.arquivos_falhas = b.falhas;
  } catch (e) { console.warn('[rel-viagens] baixar arquivos:', e?.message); }
  return conta;
}

// ── Rota ────────────────────────────────────────────────────────────────────

async function quemChama(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const u = (await rest(`qs_users?select=id,name,role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  if (!u?.is_active) return null;
  const ok = u.role === 'admin' || (Array.isArray(u.setores) && u.setores.includes('relacionamento'));
  return ok ? u : null;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

export default async function handler(req, res) {
  if (!bitrixConfigurado()) return res.status(503).json({ error: 'Falta BITRIX_WEBHOOK_BASE na Vercel.' });

  // Cron da Vercel
  if (req.method === 'GET') {
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Não autorizado' });
    // ?arquivos=1: rodada SÓ de download dos anexos dos cards (fila da 0110), 50 s inteiros.
    if (req.query?.arquivos) {
      const t0 = Date.now();
      const b = await baixarArquivos(() => Date.now() - t0 < ORCAMENTO_MS - 8_000, 40);
      console.log(`[rel-viagens] cron arquivos: ${JSON.stringify(b)}`);
      return res.status(200).json(b);
    }
    try {
      const r = await sincronizar();
      console.log(`[rel-viagens] cron: ${JSON.stringify(r)}`);
      return res.status(200).json(r);
    } catch (e) {
      console.error('[rel-viagens] cron falhou:', e?.message);
      return res.status(500).json({ error: e?.message || 'Falhou' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use POST' });
  }
  const u = await quemChama(req);
  if (!u) return res.status(401).json({ error: 'Sem acesso ao Relacionamento.' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});

  try {
    if (body.acao === 'sincronizar') {
      const r = await sincronizar();
      console.log(`[rel-viagens] manual (${u.name}): ${JSON.stringify(r)}`);
      return res.status(200).json(r);
    }
    if (body.acao === 'importar') {
      const dealId = soDigitos(body.dealId);
      if (!dealId) return res.status(400).json({ error: 'Informe o número do negócio no Bitrix.' });
      let deal = null;
      try { deal = await bx('crm.deal.get', { id: dealId }); } catch { /* segue */ }
      if (!deal) return res.status(404).json({ error: `Negócio ${dealId} não encontrado no Bitrix.` });
      const conta = { lidos: 1, criados: 0, atualizados: 0, cancelados: 0, passageiros: 0, ligados: 0, arquivos: 0, baixados: 0, erros: 0, completo: true };
      await importarDeal(deal, { conta, contatos: new Map(), mapa: await rotulos(), funis: await funis(), qualquerEtapa: true });
      const v = (await viagemDoDeal(idPai(deal) || dealId)) || (await viagemLigada(dealId));
      return res.status(200).json({ ...conta, viagemId: v?.id || null });
    }
    return res.status(400).json({ error: 'Ação inválida.' });
  } catch (e) {
    console.error('[rel-viagens]', e?.message);
    return res.status(500).json({ error: e?.message || 'Falhou.' });
  }
}

// Só para teste local (sem banco): as regras puras de leitura do Bitrix.
export const _regras = { camposDaViagem, dadosDaPessoa, idPai, rotulos, telefoneNormal, cpfValido };
