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
//   cadence_id (opcional), owner_id (opcional), estimated_value (opcional),
//   bitrix_id (opcional — ID do negócio no Bitrix; deduplica: o mesmo bitrix_id
//   nunca cria dois cards, e permite a volta QS→Bitrix mover a coluna certa)
//
// Resposta: { success, lead_id, owner_id, cadence_id, tasks_created }
// -----------------------------------------------------------------------------
import { createInboundLead } from './_leads.js';

// UUID v4 (formato geral de UUID). cadence_id/owner_id inválidos antes iam
// direto pra querystring do PostgREST e o caller recebia o erro cru do banco.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Log de diagnóstico SEM PII (LGPD): só as CHAVES do payload + bitrix_id.
  // (O log completo já cumpriu o papel de descobrir o campo da temperatura.)
  try { console.log('[lead-inbound] payload recebido (chaves):', Object.keys(body).join(', '), '| bitrix_id:', body.bitrix_id ?? '-'); } catch { /* ignora */ }

  // precisa de ao menos um identificador
  if (!body.email && !body.phone && !body.full_name && !body.first_name) {
    return res.status(400).json({ success: false, error: 'Informe ao menos email, phone ou nome do lead' });
  }

  // cadence_id/owner_id, quando presentes, precisam SER UUIDs — barra aqui com
  // 400 claro em vez de deixar o PostgREST estourar lá dentro.
  for (const field of ['cadence_id', 'owner_id']) {
    if (body[field] != null && body[field] !== '' && !UUID_RE.test(String(body[field]))) {
      return res.status(400).json({ success: false, error: `${field} inválido (esperado UUID)` });
    }
  }

  try {
    const { lead, ownerId, cadenceId, tasks, deduped } = await createInboundLead(body);
    return res.status(200).json({
      success: true,
      lead_id: lead.id,
      owner_id: ownerId,
      cadence_id: cadenceId,
      tasks_created: tasks,
      // true = o lead JÁ existia (dedupe) — o n8n usa isso pra não repetir a nota de origem
      deduped: Boolean(deduped),
    });
  } catch (err) {
    // Detalhe completo SÓ no log do servidor (Vercel). Pro caller vai mensagem
    // genérica — err.message podia carregar SQL/URL do PostgREST (fingerprinting).
    console.error('[lead-inbound]', err?.code || '', err?.message || err, err?.details || '');
    return res.status(500).json({
      success: false,
      error: 'Falha ao criar lead',
      // código curto e estável (ex.: CONFIG, TIMEOUT, 23505) — útil pro retry do
      // n8n sem expor a mensagem interna.
      code: typeof err?.code === 'string' || typeof err?.code === 'number' ? err.code : undefined,
    });
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
