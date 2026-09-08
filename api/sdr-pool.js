// api/sdr-pool.js
// -----------------------------------------------------------------------------
// A ROTA DA TELA "Números do WhatsApp" (Configurações → EMPRESA).
//
// Por que a tela não fala direto com o Supabase como as outras: as escritas aqui
// (queimar um chip, promover uma reserva) são SECURITY DEFINER e só respondem
// pra service_role. A anon key que vive no bundle do navegador não executa
// nenhuma delas — de propósito. Então a tela passa por aqui, e aqui a gente
// confere quem está pedindo antes de usar a chave forte.
//
// Body (JSON): { access_token, action: 'listar' | 'desativar' | 'trocar', sdr_id? }
//
// Só admin/gestor. Um SDR não troca o próprio número: trocar chip é decisão de
// operação (custo, aquecimento, risco de bloqueio), não de quem atende.
// -----------------------------------------------------------------------------
import { rest } from './_supabaseAdmin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AUTH_URL = () => `${(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/auth/v1`;
const SR = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

const DIAS_CONTADOR = 7;

/** Verifica o access_token da sessão e devolve o id do usuário. */
async function verifyCaller(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(`${AUTH_URL()}/user`, {
      headers: { apikey: SR(), Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return u?.id || null;
  } catch {
    return null;
  }
}

/**
 * Monta o retrato que a tela desenha: um card por SDR, as reservas na fila e a
 * contagem da semana.
 *
 * A LISTA DE SDRs vem de qs_users, não de sdr_pool. Assim um SDR que ficou sem
 * número (chip desativado, ninguém promoveu reserva ainda) APARECE na tela,
 * marcado como sem número. Se a lista viesse do pool, ele sumiria justamente na
 * hora em que você precisa vê-lo.
 */
async function listar() {
  const [sdrs, pool, contagens, ponteiro] = await Promise.all([
    rest('qs_users?select=id,name,email&role=eq.sdr&is_active=eq.true&order=created_at.asc'),
    rest('sdr_pool?select=id,sdr_id,sdr_nome,numero,status,created_at,updated_at&order=created_at.asc'),
    rest('rpc/qs_leads_por_sdr', { method: 'POST', body: { p_dias: DIAS_CONTADOR } }),
    rest('qs_assign_state?select=scope,last_owner_id,updated_at&scope=eq.fila%3Aforms&limit=1'),
  ]);

  const porSdr = new Map((contagens || []).map((c) => [c.sdr_id, c]));
  const ativos = new Map((pool || []).filter((p) => p.status === 'ativo').map((p) => [p.sdr_id, p]));

  const cards = (sdrs || []).map((u) => {
    const chip = ativos.get(u.id) || null;
    const c = porSdr.get(u.id) || {};
    return {
      sdr_id: u.id,
      nome: u.name,
      email: u.email,
      pool_id: chip?.id || null,
      numero: chip?.numero || null,
      // 'ativo' = tem chip no ar e está no rodízio.
      // 'sem-numero' = está ativo no QS mas fora do rodízio das LPs.
      status: chip ? 'ativo' : 'sem-numero',
      desde: chip?.updated_at || chip?.created_at || null,
      leads_7d: Number(c.leads || 0),
      reservas_7d: Number(c.reservas || 0),
    };
  });

  // Quem leva o PRÓXIMO lead. O ponteiro guarda quem levou o último; o próximo é
  // o seguinte na roda, considerando só quem tem chip. Mostrar isso na tela
  // transforma "confia que gira" em "olha lá, é a vez da Mariana".
  const fila = cards.filter((c) => c.status === 'ativo');
  const ultimo = ponteiro && ponteiro[0] ? ponteiro[0].last_owner_id : null;
  let proximo = null;
  if (fila.length) {
    const i = fila.findIndex((c) => c.sdr_id === ultimo);
    proximo = i >= 0 ? fila[(i + 1) % fila.length].sdr_id : null;
  }

  return {
    ok: true,
    dias: DIAS_CONTADOR,
    sdrs: cards,
    proximo_sdr_id: proximo,
    reservas: (pool || [])
      .filter((p) => p.status === 'reserva')
      .map((p) => ({ id: p.id, numero: p.numero, created_at: p.created_at })),
    // Os últimos chips que saíram de circulação. Serve pra conferir uma troca
    // recente sem abrir o SQL Editor.
    queimados: (pool || [])
      .filter((p) => p.status === 'queimado')
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, 10)
      .map((p) => ({ id: p.id, numero: p.numero, sdr_nome: p.sdr_nome, updated_at: p.updated_at })),
  };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Use POST' });
  }
  if (!SR() || !process.env.SUPABASE_URL) {
    return res.status(500).json({ ok: false, error: 'Supabase server env não configurado' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const { access_token, action, sdr_id } = body;

  // 1) Quem está pedindo?
  const callerId = await verifyCaller(access_token);
  if (!callerId || !UUID_RE.test(callerId)) {
    return res.status(401).json({ ok: false, error: 'Sessão expirada. Entre de novo.' });
  }

  // 2) Pode?
  try {
    const rows = await rest(`qs_users?select=role,is_active&id=eq.${callerId}&limit=1`);
    const eu = rows && rows[0];
    if (!eu || !eu.is_active || !['admin', 'gestor'].includes(eu.role)) {
      return res.status(403).json({ ok: false, error: 'Só admin ou gestor gerencia os números.' });
    }
  } catch {
    return res.status(500).json({ ok: false, error: 'Falha ao validar permissão' });
  }

  try {
    if (action === 'listar') {
      return res.status(200).json(await listar());
    }

    // Toda ação de escrita é sobre UM SDR. O id vem do cliente, então passa pelo
    // formato antes de virar filtro (a mesma armadilha que o admin-user.js
    // documenta: id malformado vira querystring e o filtro pega quem não devia).
    if (!UUID_RE.test(String(sdr_id || ''))) {
      return res.status(400).json({ ok: false, error: 'SDR inválido' });
    }

    if (action === 'desativar') {
      const r = await rest('rpc/qs_desativar_numero', { method: 'POST', body: { p_sdr_id: sdr_id } });
      const linha = Array.isArray(r) ? r[0] : r;
      console.log(`[sdr-pool] ${callerId} desativou o número do SDR ${sdr_id}`);
      return res.status(200).json({ ok: true, numero: linha?.numero || null, ...(await listar()) });
    }

    if (action === 'trocar') {
      const r = await rest('rpc/qs_promover_reserva', { method: 'POST', body: { p_sdr_id: sdr_id } });
      const linha = Array.isArray(r) ? r[0] : r;
      console.log(`[sdr-pool] ${callerId} trocou o número do SDR ${sdr_id}`);
      return res.status(200).json({
        ok: true,
        numero: linha?.numero || null,
        numero_anterior: linha?.numero_anterior || null,
        ...(await listar()),
      });
    }

    return res.status(400).json({ ok: false, error: 'Ação desconhecida' });
  } catch (err) {
    const msg = String(err?.details?.message || err?.message || '');
    // Erros que o time comercial precisa entender sem chamar ninguém.
    if (msg.includes('sem-reserva')) {
      return res.status(409).json({ ok: false, error: 'Não há número reserva disponível. Cadastre um chip novo antes de trocar.' });
    }
    if (msg.includes('sem-numero-ativo')) {
      return res.status(409).json({ ok: false, error: 'Esse SDR já está sem número ativo.' });
    }
    console.error('[sdr-pool]', err?.code || '', err?.message || err, err?.details || '');
    return res.status(500).json({ ok: false, error: 'Não consegui concluir. Tente de novo.' });
  }
}
