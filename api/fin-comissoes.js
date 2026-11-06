// api/fin-comissoes.js
// -----------------------------------------------------------------------------
// COMISSÕES (06/11/2026): copia do Dashboard pro QS os cards comerciais do
// Bitrix (vendas e reuniões realizadas) do mês passado pra cá, na tabela
// fin_com_vendas (0327). A conta da comissão é no front (src/fin/comissoes/
// calculo.ts); aqui só chega o dado.
//
//   GET  (Vercel Cron, a cada 30 min, Bearer CRON_SECRET)
//        → cards com venda/R.R/atualização desde o 1º dia do mês passado.
//   GET  ?desde=2026-08-01 (mesmo Bearer) → recarga de um período maior.
//   POST (botão "Atualizar agora" do Financeiro, Bearer = token do login;
//        só quem tem o setor Financeiro ou é admin).
//
// O Dashboard só deixa ler `negocios` com login; o QS usa a função
// qs_comissoes_negocios de lá (supabase/dashboard/20261106_qs_comissoes_
// negocios.sql), que confere um segredo e devolve só as colunas da comissão.
//
// Envs: DASHBOARD_SUPABASE_URL, DASHBOARD_SUPABASE_ANON_KEY (a pública do
// Dashboard), DASHBOARD_COMISSOES_SECRET (= integracao_segredos 'qs_comissoes'
// do Dashboard), CRON_SECRET, SUPABASE_*. Sem as do Dashboard: "não configurado".
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { getSupabaseUserId } from './_wa.js';

const LOTE = 500;

function configuracao() {
  const url = String(process.env.DASHBOARD_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const chave = String(process.env.DASHBOARD_SUPABASE_ANON_KEY || '').trim();
  const segredo = String(process.env.DASHBOARD_COMISSOES_SECRET || '').trim();
  return url && chave && segredo ? { url, chave, segredo } : null;
}

/** 1º dia do mês passado, no fuso de Brasília. */
export function inicioDoMesPassado(agora = new Date()) {
  const br = new Date(agora.getTime() - 3 * 3600_000);
  const d = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 10);
}

/** Linha da função do Dashboard → linha da fin_com_vendas. */
export function linhaDoCard(n) {
  const txt = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
  return {
    bitrix_id: String(n.bitrix_id).trim(),
    nome: txt(n.nome),
    pipeline: txt(n.pipeline),
    fase: txt(n.fase),
    tipo_venda: txt(n.tipo_venda),
    nome_expedicao: txt(n.nome_expedicao),
    total: n.total == null ? null : Number(n.total),
    data_venda: n.data_venda || null,
    sdr: txt(n.sdr),
    responsavel_reuniao: txt(n.responsavel_reuniao),
    vendedor: txt(n.vendedor),
    data_reuniao_realizada: n.data_reuniao_realizada || null,
    no_show: n.no_show ?? null,
    reuniao_realizada: n.reuniao_realizada ?? null,
    atualizado_no_bitrix: n.atualizado_no_bitrix || null,
    sincronizado_em: new Date().toISOString(),
  };
}

async function buscarNoDashboard(cfg, desde) {
  const r = await fetch(`${cfg.url}/rest/v1/rpc/qs_comissoes_negocios`, {
    method: 'POST',
    headers: { apikey: cfg.chave, Authorization: `Bearer ${cfg.chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_segredo: cfg.segredo, p_desde: desde }),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`Dashboard ${r.status}: ${texto.slice(0, 200)}`);
  const lista = JSON.parse(texto || '[]');
  return Array.isArray(lista) ? lista : [];
}

export async function sincronizar(desde) {
  const cfg = configuracao();
  if (!cfg) return { ok: false, configurado: false, cards: 0 };
  const cards = (await buscarNoDashboard(cfg, desde)).filter((n) => n?.bitrix_id).map(linhaDoCard);
  for (let i = 0; i < cards.length; i += LOTE) {
    await rest('fin_com_vendas?on_conflict=bitrix_id', {
      method: 'POST',
      body: cards.slice(i, i + LOTE),
      prefer: 'resolution=merge-duplicates,return=minimal',
      timeoutMs: 20_000,
    });
  }
  return { ok: true, configurado: true, cards: cards.length };
}

async function registrar(estado) {
  await rest('fin_com_sync?id=eq.1', { method: 'PATCH', body: { rodou_em: new Date().toISOString(), ...estado }, prefer: 'return=minimal' })
    .catch(() => null);
}

async function podeAtualizar(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  const u = (await rest(`qs_users?select=role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  return !!u?.is_active && (u.role === 'admin' || (Array.isArray(u.setores) && u.setores.includes('financeiro')));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET ou POST' });
  }
  if (req.method === 'GET') {
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Não autorizado' });
  } else if (!(await podeAtualizar(req))) {
    return res.status(403).json({ error: 'Só o Financeiro atualiza as comissões.' });
  }

  const desdeParam = String(req.query?.desde || '').trim();
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(desdeParam) ? desdeParam : inicioDoMesPassado();

  try {
    const r = await sincronizar(desde);
    if (!r.configurado) {
      return res.status(200).json({ ok: false, error: 'Dashboard não configurado (envs DASHBOARD_SUPABASE_URL, DASHBOARD_SUPABASE_ANON_KEY e DASHBOARD_COMISSOES_SECRET).' });
    }
    await registrar({ cards: r.cards, erro: null });
    return res.status(200).json({ ok: true, desde, cards: r.cards });
  } catch (e) {
    console.error('[fin-comissoes]', e?.message);
    await registrar({ erro: String(e?.message || 'falhou').slice(0, 300) });
    return res.status(500).json({ ok: false, error: e?.message });
  }
}
