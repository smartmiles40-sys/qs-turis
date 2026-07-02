// api/admin-user.js
// -----------------------------------------------------------------------------
// Gestão de usuários (server-side): mantém em sincronia a conta de AUTENTICAÇÃO
// (Supabase Auth) e o PERFIL (qs_users), vinculados pelo mesmo id.
//
// Só um ADMIN autenticado pode chamar: o front envia o access_token da sessão,
// que é verificado aqui; depois conferimos que o perfil dele tem role='admin'.
//
// Body (JSON): { access_token, action: 'create'|'update'|'delete', user: {...} }
// -----------------------------------------------------------------------------
import { rest } from './_supabaseAdmin.js';

const AUTH_URL = () => `${(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/auth/v1`;
const SR = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

// Chama a Admin API do GoTrue (criar/editar/apagar usuário de auth).
async function authAdmin(path, { method = 'POST', body } = {}) {
  const res = await fetch(`${AUTH_URL()}/admin/users${path}`, {
    method,
    headers: {
      apikey: SR(),
      Authorization: `Bearer ${SR()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const err = new Error((json && (json.msg || json.error_description || json.message)) || `Auth admin HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// Verifica o access_token do chamador e devolve o id do usuário de auth.
async function verifyCaller(accessToken) {
  if (!accessToken) return null;
  const res = await fetch(`${AUTH_URL()}/user`, {
    headers: { apikey: SR(), Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const u = await res.json();
  return u?.id || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Use POST' });
  }
  if (!SR() || !process.env.SUPABASE_URL) {
    return res.status(500).json({ success: false, error: 'Supabase server env não configurado' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const { access_token, action, user } = body;

  // 1) Autenticação do chamador
  const callerId = await verifyCaller(access_token);
  if (!callerId) return res.status(401).json({ success: false, error: 'Sessão inválida' });

  // 2) Autorização: precisa ser admin
  try {
    const rows = await rest(`qs_users?select=role&id=eq.${callerId}&limit=1`);
    if (!rows || !rows[0] || rows[0].role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Apenas administradores' });
    }
  } catch {
    return res.status(500).json({ success: false, error: 'Falha ao validar permissão' });
  }

  try {
    if (action === 'create') {
      if (!user?.email || !user?.password) {
        return res.status(400).json({ success: false, error: 'Informe email e senha' });
      }
      // cria a conta de auth
      const authUser = await authAdmin('', {
        method: 'POST',
        body: { email: String(user.email).toLowerCase().trim(), password: user.password, email_confirm: true },
      });
      // cria o perfil com o MESMO id
      const profileBody = {
        id: authUser.id,
        name: user.name || user.email,
        email: String(user.email).toLowerCase().trim(),
        role: user.role || 'sdr',
        is_active: user.is_active ?? true,
      };
      // só inclui whatsapp_number se veio preenchido (a coluna pode ainda não existir)
      if (user.whatsapp_number) profileBody.whatsapp_number = user.whatsapp_number;
      const profile = await rest('qs_users', {
        method: 'POST',
        prefer: 'return=representation',
        body: profileBody,
      });
      return res.status(200).json({ success: true, user: Array.isArray(profile) ? profile[0] : profile });
    }

    if (action === 'update') {
      if (!user?.id) return res.status(400).json({ success: false, error: 'Informe o id' });
      // atualiza o perfil
      const fields = {};
      for (const k of ['name', 'role', 'whatsapp_number', 'is_active']) {
        if (user[k] !== undefined) fields[k] = user[k];
      }
      if (Object.keys(fields).length) {
        await rest(`qs_users?id=eq.${user.id}`, { method: 'PATCH', body: fields, prefer: 'return=minimal' });
      }
      // troca de senha/email na conta de auth (opcional)
      const authPatch = {};
      if (user.password) authPatch.password = user.password;
      if (user.email) authPatch.email = String(user.email).toLowerCase().trim();
      if (Object.keys(authPatch).length) {
        await authAdmin(`/${user.id}`, { method: 'PUT', body: authPatch });
        if (authPatch.email) await rest(`qs_users?id=eq.${user.id}`, { method: 'PATCH', body: { email: authPatch.email }, prefer: 'return=minimal' });
      }
      return res.status(200).json({ success: true });
    }

    if (action === 'delete') {
      if (!user?.id) return res.status(400).json({ success: false, error: 'Informe o id' });
      if (user.id === callerId) return res.status(400).json({ success: false, error: 'Você não pode excluir a si mesmo' });
      await rest(`qs_users?id=eq.${user.id}`, { method: 'DELETE', prefer: 'return=minimal' });
      try { await authAdmin(`/${user.id}`, { method: 'DELETE' }); } catch { /* conta de auth pode já não existir */ }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ success: false, error: 'Ação inválida' });
  } catch (err) {
    console.error('[admin-user]', err?.status || '', err?.message || err);
    return res.status(err?.status || 500).json({ success: false, error: err?.message || 'Falha na operação' });
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
