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

// Todo id que entra em filtro do PostgREST PRECISA passar por aqui. Sem isto,
// `qs_users?id=eq.${user.id}` aceitava o ALVO escolhido pelo cliente: um id
// valendo "0&role=eq.sdr" virava o filtro `id=eq.0&role=eq.sdr` e o PATCH
// acertava TODOS os SDRs de uma vez (desativar/renomear o time inteiro numa
// requisição). Exige sessão de admin, mas "só admin" não é contenção: token
// roubado ou XSS na tela de usuários bastava. Formato de UUID é a fronteira.

// Vocabulário fechado de papéis. Sem isto, o endpoint aceita qualquer string
// e grava um papel que o app não conhece — o usuário loga e não vê tela nenhuma
// (o CHECK do banco barra, mas com erro cru; aqui a recusa é clara).
const PAPEIS = new Set(['admin', 'gestor', 'sdr', 'closer', 'marketing']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idValido(v) {
  return typeof v === 'string' && UUID_RE.test(v.trim());
}

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
  if (!callerId || !idValido(callerId)) return res.status(401).json({ success: false, error: 'Sessão inválida' });

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
      if (user.role && !PAPEIS.has(user.role)) {
        return res.status(400).json({ success: false, error: 'Papel inválido' });
      }
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
      let profile;
      try {
        profile = await rest('qs_users', {
          method: 'POST',
          prefer: 'return=representation',
          body: profileBody,
        });
      } catch (profileErr) {
        // ROLLBACK COMPENSATÓRIO: a conta de auth já existe mas o perfil falhou
        // (e-mail duplicado em qs_users, coluna faltando…). Sem isso sobrava uma
        // CREDENCIAL VÁLIDA sem perfil — logava mas o app não sabia quem era, e
        // recriar o usuário dava "email already registered".
        try {
          await authAdmin(`/${authUser.id}`, { method: 'DELETE' });
        } catch (rollbackErr) {
          console.error('[admin-user] rollback da conta auth FALHOU (conta órfã', authUser.id, '):', rollbackErr?.message);
        }
        throw profileErr;
      }
      return res.status(200).json({ success: true, user: Array.isArray(profile) ? profile[0] : profile });
    }

    if (action === 'update') {
      if (!idValido(user?.id)) return res.status(400).json({ success: false, error: 'Informe um id válido' });
      // A6: o chamador (admin verificado acima) não pode se desativar nem
      // rebaixar o próprio papel — ficaria trancado pra fora do sistema.
      if (user.id === callerId) {
        if (user.is_active === false) {
          return res.status(400).json({ success: false, error: 'Você não pode desativar a própria conta' });
        }
        if (user.role !== undefined && user.role !== 'admin') {
          return res.status(400).json({ success: false, error: 'Você não pode remover o próprio papel de admin' });
        }
      }
      // atualiza o perfil
      if (user.role !== undefined && !PAPEIS.has(user.role)) {
        return res.status(400).json({ success: false, error: 'Papel inválido' });
      }
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
      if (!idValido(user?.id)) return res.status(400).json({ success: false, error: 'Informe um id válido' });
      if (user.id === callerId) return res.status(400).json({ success: false, error: 'Você não pode excluir a si mesmo' });
      // ORDEM IMPORTA: a conta de AUTH sai PRIMEIRO. Na ordem antiga (perfil →
      // auth "best-effort"), se o delete do auth falhasse sobrava uma credencial
      // VÁLIDA sem perfil — a pessoa "excluída" continuava logando. Agora:
      //  1. auth primeiro (404 = já não existia, segue);
      //  2. perfil depois. Se o perfil falhar (ex.: FK de leads antigos), sobra
      //     um perfil SEM credencial — inofensivo (ninguém loga) e visível na UI.
      try {
        await authAdmin(`/${user.id}`, { method: 'DELETE' });
      } catch (authErr) {
        if (authErr?.status !== 404) throw authErr; // aborta: credencial ainda existe
      }
      await rest(`qs_users?id=eq.${user.id}`, { method: 'DELETE', prefer: 'return=minimal' });
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
