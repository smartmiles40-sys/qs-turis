// api/bitrix-catalogo.js
// -----------------------------------------------------------------------------
// CATÁLOGO DE CAMPOS DO BITRIX, TODO DIA (03/11/2026 — corte do n8n).
//
// Era o robô n8n/qs-sync-catalogo-bitrix.workflow.json (cron 6h): lê
// crm.deal.userfield.list + crm.deal.fields e guarda em bitrix_fields /
// bitrix_field_options (migration 0042). É desse catálogo que a reunião tira
// o de-para apelido → UF_CRM_* e as opções de "Quem fez o agendamento?" /
// "Responsável pela reunião" (api/_bitrixSaida.js). Sem ele rodando, um campo
// recriado no Bitrix ou uma pessoa nova na lista nunca chega ao QS.
//
// Vercel Cron 1x por dia (GET com Bearer CRON_SECRET, igual aos outros).
// O `alias` (preenchido à mão) nunca é sobrescrito.
//
// Env: CRON_SECRET, BITRIX_WEBHOOK_BASE, SUPABASE_*.
// -----------------------------------------------------------------------------

import { segredoConfere } from './_supabaseAdmin.js';
import { sincronizarCatalogo } from './_bitrixSaida.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });
  const segredo = String(process.env.CRON_SECRET || '').trim();
  const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const r = await sincronizarCatalogo();
    console.log(`[bitrix-catalogo] ${JSON.stringify(r)}`);
    return res.status(r.ok || r.code === 'not_configured' ? 200 : 500).json(r);
  } catch (e) {
    console.error('[bitrix-catalogo] falhou:', e?.message);
    return res.status(500).json({ ok: false, erro: String(e?.message || 'falhou').slice(0, 300) });
  }
}
