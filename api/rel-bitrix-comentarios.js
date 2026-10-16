// api/rel-bitrix-comentarios.js
// -----------------------------------------------------------------------------
// COMENTÁRIOS DO BITRIX → QS (0140, 16/10/2026).
//
// Cron (GET com CRON_SECRET): pega negócios das viagens e contatos das fichas
// que ainda não tiveram os comentários lidos (ou que estão "velhos" e a viagem
// ainda vai acontecer) e lê em lote pelo `batch` do Bitrix — 50 chamadas por
// pedido. Cada comentário vira uma linha em rel_bitrix_comentarios, ligada à
// viagem e/ou à ficha.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { bx } from './_bitrixLead.js';

const ORCAMENTO_MS = 50_000;
const POR_BATCH = 50;
const RELER_HORAS = 6; // viagem que ainda vai acontecer: relê os comentários a cada 6h

const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** BB-code do Bitrix → texto simples. */
function limpar(t) {
  return String(t || '')
    .replace(/\[(\/?)(b|i|u|s|p|quote|code|list|\*|color[^\]]*|size[^\]]*|font[^\]]*|left|right|center|justify|table|tr|td|th)\]/gi, '')
    .replace(/\[url=([^\]]+)\]([^[]*)\[\/url\]/gi, '$2 ($1)')
    .replace(/\[(user|disk file id)=?[^\]]*\]([^[]*)(\[\/user\])?/gi, '$2')
    .replace(/\r/g, '').trim();
}

async function pendentes(limite) {
  const hoje = hojeSP();
  const lidos = new Map(((await rest('rel_bitrix_comentarios_lidos?select=entidade,entidade_id,lido_em&limit=20000').catch(() => [])) || [])
    .map((l) => [`${l.entidade}:${l.entidade_id}`, l.lido_em]));
  const velho = (k) => { const t = lidos.get(k); return !t || Date.now() - new Date(t).getTime() > RELER_HORAS * 3600_000; };

  // negócios: o da venda + os ligados (Pós-Venda, Operações…)
  const [vs, ligados, clientes] = await Promise.all([
    rest('rel_viagens?select=id,bitrix_deal_id,cliente_id,data_embarque,data_retorno&bitrix_deal_id=not.is.null&status=eq.ativa&limit=10000'),
    rest('rel_viagem_deals?select=viagem_id,bitrix_deal_id,rel_viagens!inner(cliente_id,data_embarque,data_retorno,status)&rel_viagens.status=eq.ativa&limit=20000').catch(() => []),
    rest('rel_clientes?select=id,bitrix_contato_id&bitrix_contato_id=not.is.null&mesclado_em_id=is.null&limit=20000'),
  ]);
  const itens = [];
  const vista = new Set();
  const push = (entidade, id, viagem_id, cliente_id, futura) => {
    const k = `${entidade}:${id}`;
    if (vista.has(k)) return;
    vista.add(k);
    if (!lidos.has(k)) itens.push({ entidade, id, viagem_id, cliente_id, prio: futura ? 0 : 1 });
    else if (futura && velho(k)) itens.push({ entidade, id, viagem_id, cliente_id, prio: 2 });
  };
  const futura = (v) => (v?.data_retorno || v?.data_embarque || '9999') >= hoje;
  for (const v of vs || []) push('deal', String(v.bitrix_deal_id), v.id, v.cliente_id, futura(v));
  for (const l of ligados || []) push('deal', String(l.bitrix_deal_id), l.viagem_id, l.rel_viagens?.cliente_id || null, futura(l.rel_viagens));
  const clienteFuturo = new Set((vs || []).filter(futura).map((v) => v.cliente_id));
  for (const c of clientes || []) push('contact', String(c.bitrix_contato_id), null, c.id, clienteFuturo.has(c.id));
  return itens.sort((a, b) => a.prio - b.prio).slice(0, limite);
}

async function lerLote(lote) {
  const cmd = {};
  lote.forEach((it, i) => {
    cmd[`c${i}`] = `crm.timeline.comment.list?filter[ENTITY_TYPE]=${it.entidade}&filter[ENTITY_ID]=${encodeURIComponent(it.id)}&select[]=ID&select[]=CREATED&select[]=AUTHOR_ID&select[]=COMMENT&select[]=FILES&order[ID]=asc`;
  });
  const r = await bx('batch', { halt: 0, cmd }, 25_000);
  const resultados = r?.result || {};
  const erros = r?.result_error || {};
  let comentarios = 0;
  const linhas = [];
  const lidos = [];
  lote.forEach((it, i) => {
    const lista = resultados[`c${i}`];
    const erro = erros[`c${i}`];
    if (erro && !lista) { lidos.push({ entidade: it.entidade, entidade_id: it.id, lido_em: new Date().toISOString(), total: 0, erro: String(erro.error_description || erro.error || erro).slice(0, 200) }); return; }
    for (const c of Array.isArray(lista) ? lista : []) {
      const arquivos = Object.values(c.FILES || {}).map((f) => ({ id: f.id ?? f.ID, nome: f.name ?? f.NAME, tamanho: f.size ?? f.SIZE })).filter((f) => f.id);
      linhas.push({
        id: String(c.ID), entidade: it.entidade, entidade_id: it.id, viagem_id: it.viagem_id, cliente_id: it.cliente_id,
        autor_id: c.AUTHOR_ID ? String(c.AUTHOR_ID) : null, criado_em: c.CREATED || null,
        texto: limpar(c.COMMENT), arquivos, importado_em: new Date().toISOString(),
      });
    }
    comentarios += Array.isArray(lista) ? lista.length : 0;
    lidos.push({ entidade: it.entidade, entidade_id: it.id, lido_em: new Date().toISOString(), total: Array.isArray(lista) ? lista.length : 0, erro: null });
  });
  for (let i = 0; i < linhas.length; i += 200) {
    await rest('rel_bitrix_comentarios?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: linhas.slice(i, i + 200) });
  }
  await rest('rel_bitrix_comentarios_lidos?on_conflict=entidade,entidade_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: lidos });
  return comentarios;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const segredo = String(process.env.CRON_SECRET || '').trim();
  const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!segredo || veio !== segredo) return res.status(401).json({ error: 'Não autorizado' });
  const prazo = Date.now() + ORCAMENTO_MS;
  const conta = { entidades: 0, comentarios: 0, erros: 0 };
  try {
    const fila = await pendentes(POR_BATCH * 12);
    for (let i = 0; i < fila.length && prazo - Date.now() > 12_000; i += POR_BATCH) {
      try { conta.comentarios += await lerLote(fila.slice(i, i + POR_BATCH)); conta.entidades += Math.min(POR_BATCH, fila.length - i); }
      catch (e) { conta.erros++; console.warn('[rel-bitrix-comentarios] lote:', String(e?.message || '').slice(0, 160)); }
    }
    conta.restam = Math.max(0, fila.length - conta.entidades);
    console.log(`[rel-bitrix-comentarios] ${JSON.stringify(conta)}`);
    return res.status(200).json(conta);
  } catch (e) {
    console.error('[rel-bitrix-comentarios] falhou:', String(e?.message || '').slice(0, 160));
    return res.status(500).json({ error: e?.message || 'Falhou' });
  }
}
