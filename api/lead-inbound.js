// api/lead-inbound.js
// -----------------------------------------------------------------------------
// Webhook para RECEBER leads de fora (landing pages, formulários, n8n, Bitrix...).
// Cria o lead, distribui automaticamente para um SDR (round-robin por menor carga)
// e gera as tarefas da cadência. Chamada SERVIDOR-A-SERVIDOR (o segredo não pode
// ficar exposto no browser).
//
// Segurança: exige o header  x-lead-secret: <LEAD_INBOUND_SECRET>.
//
// Body (JSON) — campos aceitos (todos opcionais menos ter algum identificador):
//   full_name | first_name/last_name, email, phone, company_name (ou company),
//   segment, city, state, job_title, website, linkedin_url, source,
//   cadence_id (opcional), owner_id (opcional), estimated_value (opcional)
//
// Resposta: { success, lead_id, owner_id, cadence_id, tasks_created }
// -----------------------------------------------------------------------------
import { createInboundLead } from './_leads.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // health check simples
    return res.status(200).json({ ok: true, service: 'lead-inbound' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Use POST' });
  }

  const secret = process.env.LEAD_INBOUND_SECRET;
  if (!secret) {
    return res.status(500).json({ success: false, error: 'LEAD_INBOUND_SECRET não configurado no servidor' });
  }
  if (req.headers['x-lead-secret'] !== secret) {
    return res.status(401).json({ success: false, error: 'Não autorizado' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};

  // precisa de ao menos um identificador
  if (!body.email && !body.phone && !body.full_name && !body.first_name) {
    return res.status(400).json({ success: false, error: 'Informe ao menos email, phone ou nome do lead' });
  }

  try {
    const { lead, ownerId, cadenceId, tasks } = await createInboundLead(body);
    return res.status(200).json({
      success: true,
      lead_id: lead.id,
      owner_id: ownerId,
      cadence_id: cadenceId,
      tasks_created: tasks,
    });
  } catch (err) {
    console.error('[lead-inbound]', err?.code || '', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'Falha ao criar lead', code: err?.code });
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
