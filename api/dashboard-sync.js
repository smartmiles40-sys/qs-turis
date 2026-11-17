// api/dashboard-sync.js
// -----------------------------------------------------------------------------
// O QS ALIMENTA O DASHBOARD (Bruno, 05/11): "começar a mandar tudo para o
// dashboard pelo QS". Primeiro passo: as reuniões, uma linha por reunião, na
// tabela reunioes_qs do Dashboard (migration 20261105_reunioes_qs.sql de lá).
// É de onde saem as taxas de remarcação, remarcação → no-show e desistência, e
// a temperatura do SDR — coisas que o espelho do Bitrix não consegue contar.
//
//   GET (Vercel Cron, a cada 5 min, Bearer CRON_SECRET)
//       → manda as reuniões mexidas nos últimos 30 min (sobreposição de folga).
//   GET ?desde=2026-01-01 (mesmo Bearer) → carga inicial / reenvio.
//
// Envs: DASHBOARD_SUPABASE_URL, DASHBOARD_SUPABASE_ANON_KEY (pública, a do
// bundle do Dashboard) e DASHBOARD_SYNC_SECRET (o segredo que a função
// qs_upsert_reunioes confere). Sem elas o cron responde "não configurado" e
// não faz nada.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { pulso } from './_rotinaPulso.js';

const JANELA_MIN = 30;
const LOTE = 500;

/** Uma reunião do QS → uma linha da reunioes_qs do Dashboard. */
export function linhaDaReuniao(m) {
  const lead = Array.isArray(m.lead) ? m.lead[0] : m.lead;
  return {
    id: m.id,
    lead_id: m.lead_id ?? null,
    bitrix_id: lead?.bitrix_id ? String(lead.bitrix_id).replace(/\D/g, '') || null : null,
    lead_nome: m.lead_name ?? lead?.full_name ?? null,
    status: m.status,
    tipo: m.tipo ?? 'primeira',
    reagendado_de: m.reagendado_de ?? null,
    agendada_para: m.scheduled_at ?? null,
    criada_em: m.created_at ?? null,
    data_agendamento: m.booking_date ?? null,
    sdr: m.scheduled_by ?? null,
    closer: m.meeting_owner ?? null,
    realizada_em: m.realizada_em ?? null,
    desistencia_motivo: m.desistencia_motivo ?? null,
    sal: m.sal ?? null,
    venda_valor: m.venda_valor ?? null,
    temperatura: lead?.lead_score ?? null,
    temperatura_sdr: m.temperatura_sdr ?? null,
    atualizada_em_qs: m.updated_at ?? null,
  };
}

function configuracao() {
  const url = String(process.env.DASHBOARD_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const chave = String(process.env.DASHBOARD_SUPABASE_ANON_KEY || '').trim();
  const segredo = String(process.env.DASHBOARD_SYNC_SECRET || '').trim();
  return url && chave && segredo ? { url, chave, segredo } : null;
}

async function enviar(cfg, linhas, rpc = 'qs_upsert_reunioes') {
  const r = await fetch(`${cfg.url}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: {
      apikey: cfg.chave,
      Authorization: `Bearer ${cfg.chave}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_segredo: cfg.segredo, p_linhas: linhas }),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`Dashboard ${r.status}: ${texto.slice(0, 200)}`);
  return Number(texto) || 0;
}

export async function sincronizar(desdeIso) {
  const cfg = configuracao();
  if (!cfg) return { ok: false, configurado: false, enviadas: 0 };

  // Pagina por updated_at + id (desempate), como manda o teto de 1000 do PostgREST.
  let enviadas = 0;
  let offset = 0;
  for (;;) {
    const rows = await rest(
      'qs_meetings?select=*,lead:qs_leads(bitrix_id,lead_score,full_name)' +
        `&updated_at=gte.${encodeURIComponent(desdeIso)}` +
        `&order=updated_at.asc,id.asc&limit=${LOTE}&offset=${offset}`,
    );
    const lista = Array.isArray(rows) ? rows : [];
    if (!lista.length) break;
    enviadas += await enviar(cfg, lista.map(linhaDaReuniao));
    if (lista.length < LOTE) break;
    offset += LOTE;
  }
  return { ok: true, configurado: true, enviadas };
}

/**
 * 17/11 (Bruno): "na aba de metas do dashboard, quantos leads cada SDR recebeu
 * no mês". Contagem por pessoa e mês (qs_leads_recebidos_por_mes, 0399, base
 * qs_lead_entradas) → leads_recebidos_qs do Dashboard, que troca os meses
 * enviados inteiros. Manda o ano corrente e o anterior (poucas dezenas de
 * linhas). Lista vazia não vai.
 */
export async function sincronizarRecebidos() {
  const cfg = configuracao();
  if (!cfg) return { configurado: false, linhas: 0 };
  const desde = `${new Date().getFullYear() - 1}-01-01`;
  const rows = await rest('rpc/qs_leads_recebidos_por_mes', { method: 'POST', body: { p_desde: desde } });
  const linhas = (Array.isArray(rows) ? rows : [])
    .filter((r) => r.owner_id && r.nome && r.mes)
    .map((r) => ({
      qs_user_id: r.owner_id,
      nome: r.nome,
      papel: r.papel ?? null,
      mes: r.mes,
      recebidos: Number(r.recebidos) || 0,
      novos: Number(r.novos) || 0,
    }));
  if (!linhas.length) return { configurado: true, linhas: 0 };
  return { configurado: true, linhas: await enviar(cfg, linhas, 'qs_upsert_leads_recebidos') };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET' });
  }
  const segredo = String(process.env.CRON_SECRET || '').trim();
  const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Não autorizado' });

  const desdeParam = String(req.query?.desde || '').trim();
  const desde = /^\d{4}-\d{2}-\d{2}/.test(desdeParam)
    ? new Date(`${desdeParam.slice(0, 10)}T00:00:00-03:00`).toISOString()
    : new Date(Date.now() - JANELA_MIN * 60_000).toISOString();

  try {
    const r = await sincronizar(desde);
    if (!r.configurado) {
      // 12/11: pulava calado — o pulso faz o qs-alertas cobrar.
      await pulso('dashboard-sync', { status: 'pulado', motivo: 'Faltam as envs DASHBOARD_* na Vercel.' }, { minIntervaloMs: 30 * 60_000 });
      return res.status(200).json({ ok: false, error: 'Dashboard não configurado (envs DASHBOARD_*).' });
    }
    // Os recebidos não derrubam as reuniões: se falhar, fica no log e segue.
    let recebidos = null;
    try {
      recebidos = (await sincronizarRecebidos()).linhas;
    } catch (e) {
      console.error('[dashboard-sync] recebidos', e?.message);
      recebidos = `erro: ${e?.message || 'falhou'}`;
    }
    await pulso('dashboard-sync', {}, { minIntervaloMs: 15 * 60_000 });
    return res.status(200).json({ ok: true, desde, enviadas: r.enviadas, recebidos });
  } catch (e) {
    console.error('[dashboard-sync]', e?.message);
    await pulso('dashboard-sync', { status: 'erro', motivo: e?.message || 'falhou' });
    return res.status(500).json({ error: e?.message });
  }
}
