// api/admin-user.js
// -----------------------------------------------------------------------------
// Gestão de usuários (server-side): mantém em sincronia a conta de AUTENTICAÇÃO
// (Supabase Auth) e o PERFIL (qs_users), vinculados pelo mesmo id.
//
// Só um ADMIN autenticado pode chamar: o front envia o access_token da sessão,
// que é verificado aqui; depois conferimos que o perfil dele tem role='admin'.
//
// GESTORA DO RELACIONAMENTO (13/10/2026, Bruno: "a Tainara poder adicionar
// outros funcionários"): gestor ativo com setores = só ['relacionamento'] também
// chama, mas PRESO ao time do Relacionamento — só cria/edita gente que fica com
// setores ['relacionamento'] e papel 'relacionamento' (atendente) ou 'gestor';
// nunca mexe em admin nem em quem tem o Comercial; não exclui (desativa).
//
// 14/10/2026 (0126): a mesma regra vale pro gestor do FINANCEIRO e de OPERAÇÕES.
// "Gestor de área" = gestor ativo SEM o Comercial; as áreas dele são os setores
// que ele tem. Ele só cadastra/edita gente da área dele (papel = o da área, ou
// gestor), e a pessoa fica só com aquela área.
//
// Body (JSON): { access_token, action: 'create'|'update'|'delete'|'listar_equipe', user: {...}, setor? }
//   + Expedições (21/10): action 'exp_usuarios' / 'exp_inscricao_bitrix' — ver o fim do arquivo.
//   setor: de qual área — padrão: a primeira do gestor (admin: 'relacionamento',
//   que é o que a tela de Equipe do Rel sempre pediu).
// -----------------------------------------------------------------------------
import { randomBytes } from 'node:crypto';
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
const PAPEIS = new Set(['admin', 'gestor', 'sdr', 'closer', 'marketing', 'relacionamento', 'financeiro', 'operacional']);

// Áreas do QS (0100 / 0126). O banco ainda acerta pelo papel (admin = todas,
// papel de área = só a dele); aqui só filtra o que não é setor conhecido.
const SETORES = new Set(['comercial', 'relacionamento', 'financeiro', 'operacional']);
// Áreas que têm "gestor de área" (tudo menos o Comercial) — o papel do atendente
// tem o MESMO nome da área.
const AREAS = new Set(['relacionamento', 'financeiro', 'operacional']);
function setoresValidos(v) {
  if (!Array.isArray(v)) return undefined;
  const s = [...new Set(v.filter((x) => SETORES.has(x)))];
  return s.length ? s : undefined;
}

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
  const setorPedido = AREAS.has(body.setor) ? body.setor : null;

  // 1) Autenticação do chamador
  const callerId = await verifyCaller(access_token);
  if (!callerId || !idValido(callerId)) return res.status(401).json({ success: false, error: 'Sessão inválida' });

  // Expedições (21/10/2026): ações próprias, com a permissão DAS EXPEDIÇÕES
  // (admin do app antigo também vale) — por isso vêm antes da trava do QS abaixo.
  if (action === 'exp_usuarios') return expUsuarios(req, res, body, callerId);
  if (action === 'exp_inscricao_bitrix') return expInscricaoBitrix(res, body, access_token);

  // 2) Autorização: admin, ou gestora do Relacionamento (escopo travado abaixo)
  let caller;
  try {
    const rows = await rest(`qs_users?select=role,setores,is_active&id=eq.${callerId}&limit=1`);
    caller = rows?.[0] || null;
  } catch {
    return res.status(500).json({ success: false, error: 'Falha ao validar permissão' });
  }
  const ehAdmin = caller?.role === 'admin' && caller?.is_active !== false;
  const areasDoGestor = ehAdmin ? [] : areasDeGestor(caller);
  const ehGestorArea = areasDoGestor.length > 0;
  if (!ehAdmin && !ehGestorArea) {
    return res.status(403).json({ success: false, error: 'Apenas administradores' });
  }
  if (!ehAdmin && setorPedido && !areasDoGestor.includes(setorPedido)) {
    return res.status(403).json({ success: false, error: 'Essa área não é sua.' });
  }
  // A área em jogo: a pedida, senão a primeira do gestor; admin sem pedido =
  // Relacionamento (o que a tela de Equipe do Rel sempre listou).
  const area = setorPedido || (ehAdmin ? 'relacionamento' : areasDoGestor[0]);

  // Lista do time da área, com o último acesso (vem da conta de auth).
  if (action === 'listar_equipe') {
    try {
      const time = await rest(`qs_users?select=id,name,email,role,setores,is_active,whatsapp_number,cargo_id&role=neq.admin&setores=cs.{${area}}&order=name.asc`);
      const lista = await Promise.all((time || []).map(async (u) => {
        let ultimo = null;
        try { ultimo = (await authAdmin(`/${u.id}`, { method: 'GET' }))?.last_sign_in_at || null; } catch { /* sem conta de auth */ }
        return { ...u, ultimo_acesso: ultimo, so_relacionamento: soRelacionamento(u), so_area: soDaArea(u, area) };
      }));
      return res.status(200).json({ success: true, equipe: lista });
    } catch (err) {
      console.error('[admin-user] listar_equipe', err?.message);
      return res.status(500).json({ success: false, error: 'Não consegui listar o time.' });
    }
  }

  // Trava do gestor de área: confere o pedido ANTES de qualquer escrita.
  if (ehGestorArea) {
    const recusa = await recusaDoGestorDeArea({ action, user, callerId, area });
    if (recusa) return res.status(403).json({ success: false, error: recusa });
    // o resultado é sempre "só a área dele"
    if (user && (action === 'create' || user.role !== undefined || user.setores !== undefined)) user.setores = [area];
  }

  // Cargo (0122): tem que existir, estar ativo e — pra gestora — ser do
  // Relacionamento ou do Financeiro. null/'' tira o cargo.
  // Só valida quando o cargo MUDA: editar o nome de quem tem um cargo que foi
  // desativado (ou que o admin deu, fora da alçada da gestora) não pode travar.
  let cargoAtual;
  if (user && user.cargo_id && action === 'update' && idValido(user?.id)) {
    cargoAtual = (await rest(`qs_users?select=cargo_id&id=eq.${user.id}&limit=1`).catch(() => null))?.[0]?.cargo_id ?? null;
  }
  if (user && user.cargo_id !== undefined && (action === 'create' || action === 'update')) {
    if (!user.cargo_id) user.cargo_id = null;
    else if (action === 'update' && cargoAtual === user.cargo_id) { /* não mudou: não revalida */ }
    else {
      if (!idValido(user.cargo_id)) return res.status(400).json({ success: false, error: 'Cargo inválido' });
      const cg = (await rest(`qs_cargos?select=setor,ativo&id=eq.${user.cargo_id}&limit=1`).catch(() => null))?.[0];
      if (!cg || !cg.ativo) return res.status(400).json({ success: false, error: 'Cargo não encontrado ou desativado' });
      // Gestor de área: cargos das áreas dele (a gestora do Rel também dá os
      // do Financeiro, regra da 0122).
      const alcada = new Set([...areasDoGestor, ...(areasDoGestor.includes('relacionamento') ? ['financeiro'] : [])]);
      if (ehGestorArea && !alcada.has(cg.setor)) {
        return res.status(403).json({ success: false, error: 'Você só atribui cargos da sua área.' });
      }
    }
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
      if (user.cargo_id) profileBody.cargo_id = user.cargo_id;
      const setoresNovos = setoresValidos(user.setores);
      if (setoresNovos) profileBody.setores = setoresNovos;
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
        if (user.role !== undefined && user.role !== caller.role) {
          return res.status(400).json({ success: false, error: ehAdmin ? 'Você não pode remover o próprio papel de admin' : 'Você não pode mudar o próprio papel' });
        }
      }
      // atualiza o perfil
      if (user.role !== undefined && !PAPEIS.has(user.role)) {
        return res.status(400).json({ success: false, error: 'Papel inválido' });
      }
      const fields = {};
      for (const k of ['name', 'role', 'whatsapp_number', 'is_active', 'cargo_id']) {
        if (user[k] !== undefined) fields[k] = user[k];
      }
      const setoresEditados = setoresValidos(user.setores);
      if (setoresEditados) fields.setores = setoresEditados;
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

const NOME_AREA = { relacionamento: 'Relacionamento', financeiro: 'Financeiro', operacional: 'Operações' };

/**
 * Áreas que um gestor gerencia: gestor ativo SEM o Comercial → as áreas dele
 * (13/10 a gestora do Rel; 14/10 Financeiro e Operações). Senão, nenhuma.
 */
function areasDeGestor(u) {
  if (!u || u.is_active === false || u.role !== 'gestor') return [];
  const s = Array.isArray(u.setores) ? u.setores : [];
  if (s.includes('comercial')) return [];
  return s.filter((x) => AREAS.has(x));
}
function soRelacionamento(u) {
  return soDaArea(u, 'relacionamento');
}
/** A pessoa é SÓ desta área (sem o Comercial e sem outra área). */
function soDaArea(u, area) {
  const s = Array.isArray(u?.setores) ? u.setores : [];
  return s.length === 1 && s[0] === area;
}

/**
 * O que o gestor de área NÃO pode fazer. Devolve a frase da recusa, ou null se
 * pode. Alvo = só gente daquela área (sem Comercial, nunca admin); papel final =
 * atendente da área (papel com o nome dela) ou 'gestor'.
 */
async function recusaDoGestorDeArea({ action, user, callerId, area }) {
  const PAPEIS_DELA = new Set([area, 'gestor']);
  const nome = NOME_AREA[area] || area;
  if (action === 'delete') return 'Pra tirar alguém do time, desative a conta (só o admin exclui).';
  if (action === 'create') {
    if (!PAPEIS_DELA.has(user?.role || area)) return `Você só cadastra atendente ou gestor(a) do ${nome}.`;
    if (!user.role) user.role = area;
    return null;
  }
  if (action === 'update') {
    if (!idValido(user?.id)) return null; // o fluxo abaixo responde 400
    if (user.role !== undefined && !PAPEIS_DELA.has(user.role)) return `Você só dá o papel de atendente ou gestor(a) do ${nome}.`;
    if (Array.isArray(user.setores) && user.setores.some((x) => x !== area)) return 'Você só dá acesso à sua área.';
    if (user.id === callerId) return null;
    const alvo = (await rest(`qs_users?select=role,setores&id=eq.${user.id}&limit=1`))?.[0];
    if (!alvo) return 'Usuário não encontrado.';
    if (alvo.role === 'admin' || !PAPEIS_DELA.has(alvo.role) || !soDaArea(alvo, area)) {
      return `Esse usuário não é do time do ${nome} — só o admin mexe nele.`;
    }
    return null;
  }
  return 'Ação inválida.';
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

// =============================================================================
// EXPEDIÇÕES (21/10/2026) — telas que no app antigo usavam service role.
// Tudo aqui é ADICIONAL: não mexe nas ações acima.
//
// action 'exp_usuarios' (tela Usuários das Expedições). Quem pode: admin das
// Expedições = admin do QS OU papel 'admin' na tabela `usuarios` (app antigo) —
// a mesma regra de exp_eh_admin() no banco.
//   op 'resetar_senha' { usuario_id } → senha nova FORTE (no antigo era "Setur@"+4
//      dígitos). A conta de login é a MESMA do QS: a senha nova vale nos dois.
//      Quem é admin só das Expedições não reseta admin/gestor do QS (senão viraria
//      dono do QS trocando a senha de um admin).
//   op 'criar' { email, nome, papel } → login novo (auth) + perfil do QS + linha
//      em `usuarios`. Papel nas Expedições: admin | operacional | relacionamento | leitura.
//      No QS a pessoa entra em Operações (operacional) ou Relacionamento.
//
// action 'exp_inscricao_bitrix' { passageiro_id } → avisa o Bitrix (via n8n) que a
//   inscrição foi aprovada — igual ao app antigo, melhor esforço. Precisa das envs
//   EXP_N8N_BITRIX_OUTBOUND_URL e EXP_WEBHOOK_SECRET (as mesmas N8N_BITRIX_OUTBOUND_URL
//   / WEBHOOK_SECRET do projeto antigo); sem elas responde enviado:false.
// =============================================================================
const EXP_PAPEIS = new Set(['admin', 'operacional', 'relacionamento', 'leitura']);
const ALFA_SENHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Senha forte e fácil de ditar: 3 blocos de 4 (ex.: Xk7p-Rm2q-Tz9w), ~69 bits. */
function senhaForte() {
  const n = ALFA_SENHA.length;
  const lim = 256 - (256 % n);
  let s = '';
  while (s.length < 12) {
    for (const b of randomBytes(32)) {
      if (s.length >= 12) break;
      if (b < lim) s += ALFA_SENHA[b % n];
    }
  }
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

async function expUsuarios(req, res, body, callerId) {
  const op = body.op;
  let qsCaller, expCaller;
  try {
    qsCaller = (await rest(`qs_users?select=role,is_active&id=eq.${callerId}&limit=1`))?.[0] || null;
    expCaller = (await rest(`usuarios?select=papel&id=eq.${callerId}&limit=1`))?.[0] || null;
  } catch {
    return res.status(500).json({ success: false, error: 'Falha ao validar permissão' });
  }
  const adminQs = qsCaller?.role === 'admin' && qsCaller?.is_active !== false;
  const adminExp = adminQs || expCaller?.papel === 'admin';
  if (!adminExp) return res.status(403).json({ success: false, error: 'Apenas admins das Expedições.' });

  try {
    if (op === 'resetar_senha') {
      const alvoId = body.usuario_id;
      if (!idValido(alvoId)) return res.status(400).json({ success: false, error: 'Usuário inválido' });
      if (alvoId === callerId) return res.status(400).json({ success: false, error: 'Pra trocar a sua própria senha, use o seu perfil.' });
      const alvo = (await rest(`usuarios?select=id,nome&id=eq.${alvoId}&limit=1`))?.[0];
      if (!alvo) return res.status(404).json({ success: false, error: 'Usuário não encontrado nas Expedições.' });
      const alvoQs = (await rest(`qs_users?select=role&id=eq.${alvoId}&limit=1`))?.[0];
      if (!adminQs && alvoQs && ['admin', 'gestor'].includes(alvoQs.role)) {
        return res.status(403).json({ success: false, error: 'Essa pessoa é admin/gestor no QS — só um admin do QS reseta a senha dela.' });
      }
      const senha = senhaForte();
      try {
        await authAdmin(`/${alvoId}`, { method: 'PUT', body: { password: senha } });
      } catch (e) {
        if (e?.status === 404) return res.status(404).json({ success: false, error: 'Essa pessoa ainda não tem login no QS — crie o login primeiro.' });
        throw e;
      }
      await rest(`usuarios?id=eq.${alvoId}`, { method: 'PATCH', body: { senha_provisoria: true }, prefer: 'return=minimal' });
      return res.status(200).json({ success: true, senha });
    }

    if (op === 'criar') {
      const email = String(body.email || '').toLowerCase().trim();
      const nome = String(body.nome || '').trim() || email.split('@')[0];
      const papel = body.papel;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, error: 'E-mail inválido' });
      if (!EXP_PAPEIS.has(papel)) return res.status(400).json({ success: false, error: 'Papel inválido' });
      const emailQ = encodeURIComponent(email);
      const jaQs = (await rest(`qs_users?select=id&email=ilike.${emailQ}&limit=1`))?.[0];
      if (jaQs) return res.status(409).json({ success: false, error: 'Essa pessoa já tem login no QS — use "Dar acesso a quem já usa o QS".' });
      const jaExp = (await rest(`usuarios?select=id&email=ilike.${emailQ}&limit=1`))?.[0];
      if (jaExp) return res.status(409).json({ success: false, error: 'Já existe um usuário das Expedições com esse e-mail.' });

      const setor = papel === 'relacionamento' ? 'relacionamento' : 'operacional';
      const senha = senhaForte();
      const authUser = await authAdmin('', { method: 'POST', body: { email, password: senha, email_confirm: true } });
      try {
        await rest('qs_users', { method: 'POST', prefer: 'return=minimal', body: { id: authUser.id, name: nome, email, role: setor, setores: [setor], is_active: true } });
        await rest('usuarios', { method: 'POST', prefer: 'return=minimal', body: { id: authUser.id, email, nome, papel, senha_provisoria: true } });
      } catch (e) {
        // desfaz: sem isso sobrava login válido sem perfil
        try { await rest(`qs_users?id=eq.${authUser.id}`, { method: 'DELETE', prefer: 'return=minimal' }); } catch { /* nada a desfazer */ }
        try { await authAdmin(`/${authUser.id}`, { method: 'DELETE' }); } catch (r) { console.error('[admin-user] exp criar: rollback falhou', authUser.id, r?.message); }
        throw e;
      }
      return res.status(200).json({ success: true, id: authUser.id, senha });
    }

    return res.status(400).json({ success: false, error: 'Operação inválida' });
  } catch (err) {
    console.error('[admin-user] exp_usuarios', op, err?.status || '', err?.message || err);
    const st = Number(err?.status) >= 400 && Number(err?.status) < 600 ? Number(err.status) : 500;
    return res.status(st).json({ success: false, error: err?.message || 'Falha na operação' });
  }
}

async function expInscricaoBitrix(res, body, accessToken) {
  const paxId = body.passageiro_id;
  if (!idValido(paxId)) return res.status(400).json({ success: false, error: 'Passageiro inválido' });
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  // Permissão: a MESMA do banco (quem decide inscrições), perguntada com o token de quem chama.
  try {
    const r = await fetch(`${base}/rest/v1/rpc/exp_pode_decidir_inscricao`, {
      method: 'POST',
      headers: { apikey: SR(), Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok || (await r.json()) !== true) return res.status(403).json({ success: false, error: 'Sem permissão para decidir inscrições.' });
  } catch {
    return res.status(500).json({ success: false, error: 'Falha ao validar permissão' });
  }
  const url = process.env.EXP_N8N_BITRIX_OUTBOUND_URL;
  if (!url) return res.status(200).json({ success: true, enviado: false, motivo: 'EXP_N8N_BITRIX_OUTBOUND_URL não configurada' });
  try {
    const p = (await rest(`passageiros?select=*&id=eq.${paxId}&limit=1`))?.[0];
    if (!p) return res.status(404).json({ success: false, error: 'Passageiro não encontrado' });
    const exp = idValido(p.expedicao_id) ? (await rest(`expedicoes?select=codigo,nome&id=eq.${p.expedicao_id}&limit=1`))?.[0] : null;
    // expedições anteriores (não canceladas) da pessoa pelo CPF, sem contar a atual
    const cpf = String(p.cpf || '').replace(/\D/g, '');
    let anteriores = 0;
    if (cpf.length === 11) {
      const fmt = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
      const linhas = await rest(`passageiros?select=expedicao_id,status_reserva&cpf=in.(${cpf},${encodeURIComponent(`"${fmt}"`)})`);
      anteriores = new Set((linhas || [])
        .filter((l) => l.expedicao_id && l.expedicao_id !== p.expedicao_id && l.status_reserva !== 'Cancelado')
        .map((l) => l.expedicao_id)).size;
    }
    let passaporte_arquivo_url = null;
    let passaporte_arquivo_nome = null;
    if (idValido(p.passaporte_arquivo_id)) {
      const a = (await rest(`arquivos?select=storage_path,nome&id=eq.${p.passaporte_arquivo_id}&limit=1`))?.[0];
      if (a?.storage_path) {
        const caminho = a.storage_path.split('/').map(encodeURIComponent).join('/');
        const s = await fetch(`${base}/storage/v1/object/sign/arquivos-expedicoes/${caminho}`, {
          method: 'POST',
          headers: { apikey: SR(), Authorization: `Bearer ${SR()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 3600 }),
        });
        const sj = s.ok ? await s.json() : null;
        if (sj?.signedURL) { passaporte_arquivo_url = `${base}/storage/v1${sj.signedURL}`; passaporte_arquivo_nome = a.nome; }
      }
    }
    const payload = {
      evento: 'inscricao_aprovada',
      bitrix_deal_id: p.bitrix_deal_id, bitrix_contact_id: p.bitrix_contact_id,
      expedicao_codigo: exp?.codigo ?? null, expedicao_nome: exp?.nome ?? null, expedicoes_anteriores: anteriores,
      nome_completo: p.nome_completo, cpf: p.cpf, email: p.email, telefone: p.telefone, data_nascimento: p.data_nascimento,
      passaporte: p.passaporte, validade_passaporte: p.validade_passaporte, status_reserva: p.status_reserva, observacoes: p.observacoes,
      endereco: { cep: p.endereco_cep, rua: p.endereco_rua, numero: p.endereco_numero, complemento: p.endereco_complemento, bairro: p.endereco_bairro, cidade: p.endereco_cidade, estado: p.endereco_estado },
      contato_emergencia_nome: p.contato_emergencia_nome, contato_emergencia_vinculo: p.contato_emergencia_vinculo, contato_emergencia_fone: p.contato_emergencia_fone,
      pref_marcar_assento: p.pref_marcar_assento, pref_upgrade_classe: p.pref_upgrade_classe,
      ja_viajou_internacional: p.ja_viajou_internacional, paises_visitados: p.paises_visitados,
      saude: p.saude ?? null, passaporte_arquivo_url, passaporte_arquivo_nome,
    };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-secret': process.env.EXP_WEBHOOK_SECRET || '' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(t); }
    return res.status(200).json({ success: true, enviado: r.ok, motivo: r.ok ? undefined : `n8n status ${r.status}` });
  } catch (err) {
    console.error('[admin-user] exp_inscricao_bitrix', err?.message || err);
    return res.status(200).json({ success: true, enviado: false, motivo: 'erro ao enviar' });
  }
}
