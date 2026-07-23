// api/chatwoot-lookup.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET /api/chatwoot-lookup?phone=<numero>
// Dado o telefone de um lead, acha a CONVERSA de WhatsApp dele no Chatwoot
// self-hosted e devolve o id (o dock do QS navega o iframe direto pra ela).
//
// Por que serverless: o token do Chatwoot (de um usuário-agente dedicado) fica
// SÓ no servidor (env CHATWOOT_AGENT_TOKEN) — nunca no navegador.
//
// Auth: exige um usuário logado do QS (header Authorization: Bearer <jwt do
// Supabase Auth>), validado no /auth/v1/user. Sem isso → 401 (a rota consulta
// contatos; não pode ser pública).
//
// Envs (Vercel):
//   CHATWOOT_BASE_URL       (def. https://chat.setuforeuvouviagens.com.br)
//   CHATWOOT_ACCOUNT_ID     (def. 1)
//   CHATWOOT_AGENT_TOKEN    (obrigatório — Access Token de um agente com acesso
//                            a TODAS as inboxes de WhatsApp)
//   CHATWOOT_WA_INBOX_IDS   (opcional — csv dos ids das inboxes de WhatsApp; se
//                            vazio, considera conversas de qualquer inbox)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (validação do JWT)
//
// A busca por telefone usa POST /contacts/filter com equal_to (match E.164 EXATO,
// o FilterService normaliza o "+") e cai no /contacts/search (fuzzy) como fallback.
// Não CRIA conversa (evita encher o Chatwoot de conversas vazias): se o lead não
// tem conversa, devolve conversationId=null e o dock fica no inbox.
// -----------------------------------------------------------------------------

const BASE = (process.env.CHATWOOT_BASE_URL || 'https://chat.setuforeuvouviagens.com.br').replace(/\/+$/, '');
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '1';
const API = `${BASE}/api/v1/accounts/${ACCOUNT_ID}`;
const WA_INBOX_IDS = (process.env.CHATWOOT_WA_INBOX_IDS || '')
  .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));

function cwHeaders() {
  return { api_access_token: process.env.CHATWOOT_AGENT_TOKEN || '', 'Content-Type': 'application/json' };
}

// Normaliza pra E.164 BR. <=11 dígitos = sem DDI → prepõe 55 (trata DDD 55/RS
// certo, ao contrário de um startsWith('55')). >=12 = já tem país.
function toE164BR(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  return '+' + (d.length <= 11 ? '55' + d : d);
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

async function findContact(phoneE164) {
  // 1) match EXATO (o filter auto-normaliza o +)
  try {
    const r = await fetch(`${API}/contacts/filter`, {
      method: 'POST', headers: cwHeaders(),
      body: JSON.stringify({
        payload: [{ attribute_key: 'phone_number', filter_operator: 'equal_to', values: [phoneE164], query_operator: null }],
      }),
    });
    if (r.ok) {
      const { payload = [] } = await r.json();
      if (payload.length) return payload[0];
    }
  } catch (e) { console.warn('[chatwoot-lookup] filter falhou:', e?.message); }

  // 2) fallback fuzzy (número salvo sem DDI / formatado)
  try {
    const q = encodeURIComponent(phoneE164.replace('+', ''));
    const r = await fetch(`${API}/contacts/search?q=${q}`, { headers: cwHeaders() });
    if (r.ok) {
      const { payload = [] } = await r.json();
      return payload[0] || null;
    }
  } catch (e) { console.warn('[chatwoot-lookup] search falhou:', e?.message); }

  return null;
}

async function pickConversation(contactId) {
  const r = await fetch(`${API}/contacts/${contactId}/conversations`, { headers: cwHeaders() });
  if (!r.ok) return null;
  const { payload = [] } = await r.json();
  let convs = Array.isArray(payload) ? payload : [];
  if (WA_INBOX_IDS.length) convs = convs.filter((c) => WA_INBOX_IDS.includes(c.inbox_id));
  convs.sort((a, b) => (b.last_activity_at || 0) - (a.last_activity_at || 0));
  // prefere uma conversa ainda aberta; senão a mais recente
  return convs.find((c) => c.status && c.status !== 'resolved') || convs[0] || null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET' });
  }
  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  if (!process.env.CHATWOOT_AGENT_TOKEN) {
    // Config incompleta: não é erro do cliente — devolve "sem conversa" pro dock
    // só abrir o inbox, e grita no log da Vercel.
    console.warn('[chatwoot-lookup] CHATWOOT_AGENT_TOKEN ausente — configure na Vercel');
    return res.status(200).json({ conversationId: null, contactId: null, configured: false });
  }

  const phone = toE164BR(req.query.phone);
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });

  try {
    const contact = await findContact(phone);
    if (!contact) return res.status(200).json({ conversationId: null, contactId: null, phone });

    const conv = await pickConversation(contact.id);
    return res.status(200).json({
      contactId: contact.id,
      conversationId: conv ? conv.id : null,
      inboxId: conv ? conv.inbox_id : null,
      canReply: conv ? conv.can_reply : null,   // false => fora da janela de 24h
      openUrl: conv ? `${BASE}/app/accounts/${ACCOUNT_ID}/conversations/${conv.id}` : null,
    });
  } catch (e) {
    console.error('[chatwoot-lookup]', e?.message);
    return res.status(500).json({ error: 'Falha ao consultar o Chatwoot' });
  }
}
