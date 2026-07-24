// api/chatwoot-assign.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/chatwoot-assign
// Body: { conversationId: number, ownerId: string (qs_users.id) }
//
// Atribui a CONVERSA do Chatwoot ao agente correspondente ao SDR dono do lead
// no QS — assim, quando o dock abre a conversa do lead, ela já cai na fila do
// SDR certo dentro do Chatwoot (pedido do Bruno, sprint 2026-07-24).
//
// O mapa "usuário do QS → agente do Chatwoot" vive em qs_settings, key
// `chatwoot_agent_map`, formato { "<qs_user_id>": <chatwoot_agent_id>, ... } —
// editável em Configurações → Atendimento (WhatsApp). Sem entrada no mapa, a
// rota NÃO atribui (200 assigned:false) — nunca é erro fatal do dock.
//
// Regras de convivência com o uso manual do Chatwoot:
//   • conversa JÁ atribuída a alguém → não rouba (a decisão humana vence);
//   • conversa sem dono → atribui ao agente mapeado.
//
// Auth: mesmo padrão do chatwoot-lookup — exige JWT válido do Supabase Auth.
// Envs: CHATWOOT_BASE_URL / CHATWOOT_ACCOUNT_ID / CHATWOOT_AGENT_TOKEN +
//       SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
// -----------------------------------------------------------------------------
import { rest } from './_supabaseAdmin.js';

const BASE = (process.env.CHATWOOT_BASE_URL || 'https://chat.setuforeuvouviagens.com.br').replace(/\/+$/, '');
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '1';
const API = `${BASE}/api/v1/accounts/${ACCOUNT_ID}`;

function cwHeaders() {
  return { api_access_token: process.env.CHATWOOT_AGENT_TOKEN || '', 'Content-Type': 'application/json' };
}

async function getSupabaseUserId(authHeader) {
  const jwt = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return null;
    const user = await r.json();
    return (user && user.id) || null;
  } catch {
    return null;
  }
}

async function loadAgentMap() {
  try {
    const rows = await rest('qs_settings?select=value&key=eq.chatwoot_agent_map&limit=1');
    const v = rows && rows[0] && rows[0].value;
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    console.warn('[chatwoot-assign] chatwoot_agent_map indisponível:', e?.message);
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }
  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  if (!process.env.CHATWOOT_AGENT_TOKEN) {
    console.warn('[chatwoot-assign] CHATWOOT_AGENT_TOKEN ausente — configure na Vercel');
    return res.status(200).json({ assigned: false, reason: 'nao-configurado' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const conversationId = Number(body.conversationId);
  const ownerId = String(body.ownerId || '').trim();
  if (!Number.isFinite(conversationId) || conversationId <= 0 || !ownerId) {
    return res.status(400).json({ error: 'conversationId e ownerId obrigatórios' });
  }

  try {
    const map = await loadAgentMap();
    const agentId = Number(map[ownerId]);
    if (!Number.isFinite(agentId) || agentId <= 0) {
      return res.status(200).json({ assigned: false, reason: 'sem-mapa' });
    }

    // Conversa já tem dono? Não rouba — a atribuição manual do time vence.
    const convRes = await fetch(`${API}/conversations/${conversationId}`, { headers: cwHeaders() });
    if (convRes.ok) {
      const conv = await convRes.json();
      const current = conv?.meta?.assignee?.id ?? conv?.assignee_id ?? null;
      if (current) {
        return res.status(200).json({ assigned: false, reason: 'ja-atribuida', assigneeId: current });
      }
    }

    const r = await fetch(`${API}/conversations/${conversationId}/assignments`, {
      method: 'POST',
      headers: cwHeaders(),
      body: JSON.stringify({ assignee_id: agentId }),
    });
    if (!r.ok) {
      console.warn('[chatwoot-assign] assignments falhou:', r.status);
      return res.status(200).json({ assigned: false, reason: 'chatwoot-recusou', status: r.status });
    }
    return res.status(200).json({ assigned: true, agentId });
  } catch (e) {
    console.error('[chatwoot-assign]', e?.message);
    return res.status(500).json({ error: 'Falha ao atribuir no Chatwoot' });
  }
}
