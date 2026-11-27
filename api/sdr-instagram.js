// api/sdr-instagram.js
// -----------------------------------------------------------------------------
// INSTAGRAM DO TRABALHO DE CADA SDR (Bruno, 27/11/2026).
//
// Cada SDR conecta o PRÓPRIO Instagram profissional (mkt_ig_contas.dono_id,
// 0431). As DMs dessa conta entram pelo mesmo webhook (/api/mkt-instagram),
// são amarradas ao lead pelo @ (0430) e só a dona + a gestão enxergam.
//
//   POST { acao: 'link' }                → URL de login do Instagram (OAuth)
//   GET  ?code=…&state=…                 → volta do Instagram: guarda o token
//                                          (longo, 60 dias) e assina o webhook
//   POST { acao: 'desconectar' }         → a SDR desliga a conta dela
//   POST { leadId | conversaId, texto }  → responde a DM
//   POST { leadId | conversaId, acao: 'lida' } → zera o "não lidas" (só a dona)
//
// Regra da Meta: só dá pra responder até 24 h depois da última mensagem do
// cliente (`motivo: 'janela-fechada'`), e não dá pra puxar conversa.
//
// Vercel: MKT_IG_APP_ID + MKT_IG_APP_SECRET (o app do Instagram na Meta), e o
// endereço https://<domínio>/api/sdr-instagram cadastrado como "redirect URI".
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import { assertCanAccessLead, getSupabaseUserId } from './_wa.js';
import { rest } from './_supabaseAdmin.js';
import { enviarDm, montarMensagemIg, janelaIg, ig, trocarPorTokenLongo, IG_GRAPH } from './_mktInstagram.js';
import { pausaPorRespostaManual } from './_mktAutoRegras.js';
import { comSentry } from './_sentry.js';

const enc = encodeURIComponent;
const ESCOPOS = 'instagram_business_basic,instagram_business_manage_messages';
const STATE_VALIDADE_MS = 15 * 60_000;

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
const appId = () => String(process.env.MKT_IG_APP_ID || '').trim();
const appSecret = () => String(process.env.MKT_IG_APP_SECRET || '').trim();
function host(req) { return String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim(); }
const redirectUri = (req) => `https://${host(req)}/api/sdr-instagram`;

// state = userId.ts.assinatura — o navegador volta do Instagram sem o Bearer do QS.
export function assinarState(userId, ts, segredo) {
  return crypto.createHmac('sha256', segredo).update(`${userId}.${ts}`).digest('hex').slice(0, 32);
}
export function lerState(state, segredo, agora = Date.now()) {
  const [userId, ts, sig] = String(state || '').split('.');
  if (!userId || !ts || !sig || !segredo) return null;
  const esperado = assinarState(userId, ts, segredo);
  if (esperado.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(sig))) return null;
  if (!(agora - Number(ts) < STATE_VALIDADE_MS)) return null;
  return userId;
}

function voltarPraTela(res, req, status, msg = '') {
  const q = status === 'ok' ? 'ig=ok' : `ig=erro&ig_msg=${enc(String(msg).slice(0, 200))}`;
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: `https://${host(req)}/?${q}#comercial/painel` });
  return res.end();
}

async function usuario(id) {
  return (await rest(`qs_users?select=id,name,role,is_active&id=eq.${enc(id)}&limit=1`).catch(() => null))?.[0] ?? null;
}

// ── Volta do Instagram (OAuth) ──────────────────────────────────────────────
async function callback(req, res) {
  const q = req.query || {};
  if (q.error) return voltarPraTela(res, req, 'erro', q.error_description || 'Você cancelou a conexão.');
  const userId = lerState(q.state, appSecret());
  if (!userId) return voltarPraTela(res, req, 'erro', 'O link de conexão venceu. Clique em Conectar de novo.');
  const u = await usuario(userId);
  if (!u || u.is_active === false) return voltarPraTela(res, req, 'erro', 'Usuário inválido.');

  // 1) code → token curto (1 h)
  const form = new URLSearchParams({ client_id: appId(), client_secret: appSecret(), grant_type: 'authorization_code', redirect_uri: redirectUri(req), code: String(q.code || '').replace(/#_$/, '') });
  const r = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => ({}));
  const dado = Array.isArray(j?.data) ? j.data[0] : j;
  if (!r.ok || !dado?.access_token) {
    return voltarPraTela(res, req, 'erro', `O Instagram recusou: ${j?.error_message || j?.error?.message || r.status}`);
  }
  // 2) curto → longo (60 dias; o cron renova sozinho)
  const longo = await trocarPorTokenLongo(dado.access_token);
  const token = longo?.token || dado.access_token;
  // 3) quem é a conta
  let me;
  try { me = await ig('/me?fields=user_id,username,name,account_type', { token }); }
  catch (e) { return voltarPraTela(res, req, 'erro', `Não consegui ler a conta: ${e.message}`); }
  const igUserId = String(me?.user_id || dado.user_id || '').replace(/\D/g, '');
  if (!igUserId) return voltarPraTela(res, req, 'erro', 'Não consegui ler o ID da conta.');

  // Conta já usada pela agência ou por outra SDR? Não rouba.
  const ja = (await rest(`mkt_ig_contas?select=id,dono_id&ig_user_id=eq.${enc(igUserId)}&limit=1`).catch(() => null))?.[0];
  if (ja && ja.dono_id !== userId) {
    return voltarPraTela(res, req, 'erro', ja.dono_id ? 'Este Instagram já está conectado por outra pessoa do time.' : 'Este é o Instagram da agência (Marketing) — conecte o seu do trabalho.');
  }
  // Uma conta por SDR: a anterior dela (outro @) sai.
  await rest(`mkt_ig_contas?dono_id=eq.${enc(userId)}&ig_user_id=neq.${enc(igUserId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'desconectada', dono_id: null, ultimo_erro: 'Trocada por outra conta da SDR' } }).catch(() => null);

  const agora = new Date().toISOString();
  const conta = (await rest('mkt_ig_contas?on_conflict=ig_user_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
    body: { ig_user_id: igUserId, username: me?.username || null, nome: me?.name || u.name || null, status: 'conectada', ultimo_erro: null, dono_id: userId },
  }))?.[0];
  await rest('rpc/mkt_ig_guardar_token', { method: 'POST', body: { p_conta: conta.id, p_token: token } });
  await rest(`mkt_ig_contas?id=eq.${conta.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { token_expira_em: longo?.expiraEm ?? null, token_renovado_em: agora, token_tentativa_em: null } }).catch(() => null);

  // 4) assina o webhook de mensagens nesta conta (Instagram Login exige por conta)
  try {
    const s = await fetch(`${IG_GRAPH}/me/subscribed_apps?subscribed_fields=messages&access_token=${enc(token)}`, { method: 'POST', signal: AbortSignal.timeout(15_000) });
    const sj = await s.json().catch(() => ({}));
    if (!s.ok || sj?.success === false) throw new Error(sj?.error?.message || `erro ${s.status}`);
  } catch (e) {
    await rest(`mkt_ig_contas?id=eq.${conta.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ultimo_erro: `Assinar mensagens: ${String(e?.message).slice(0, 200)}` } }).catch(() => null);
    return voltarPraTela(res, req, 'erro', `Conectou, mas o Instagram não liberou as mensagens: ${e?.message}`);
  }
  return voltarPraTela(res, req, 'ok');
}

// ── Conversa que a pessoa quer abrir/responder ───────────────────────────────
async function acharConversa(userId, { leadId, conversaId }) {
  const sel = 'id,igsid,conta_id,lead_id,ultima_entrada_em';
  const u = await usuario(userId);
  if (!u || u.is_active === false) return { erro: 401, msg: 'Não autorizado' };
  const gestao = u.role === 'admin' || u.role === 'gestor';
  if (conversaId) {
    const c = (await rest(`mkt_ig_conversas?select=${sel}&id=eq.${enc(conversaId)}&limit=1`).catch(() => null))?.[0];
    if (!c) return { erro: 404, msg: 'Conversa não encontrada' };
    const conta = (await rest(`mkt_ig_contas?select=id,ig_user_id,username,status,dono_id&id=eq.${c.conta_id}&limit=1`).catch(() => null))?.[0];
    const minha = conta?.dono_id && (conta.dono_id === userId || gestao);
    if (!minha) {
      if (!c.lead_id) return { erro: 403, msg: 'Sem acesso a esta conversa' };
      const a = await assertCanAccessLead(userId, c.lead_id).catch(() => null);
      if (!a?.ok) return { erro: 403, msg: 'Sem acesso a esta conversa' };
    }
    return { conv: c, conta, dono: conta?.dono_id === userId };
  }
  const a = await assertCanAccessLead(userId, leadId).catch(() => null);
  if (!a) return { erro: 500, msg: 'Falha ao validar o lead' };
  if (!a.ok) return { erro: a.reason === 'lead-de-outro-sdr' ? 403 : 404, msg: 'Sem acesso a este lead' };
  const lista = (await rest(`mkt_ig_conversas?select=${sel}&lead_id=eq.${enc(leadId)}&order=ultima_mensagem_em.desc.nullslast&limit=10`).catch(() => null)) || [];
  if (!lista.length) return { erro: 404, msg: 'Este lead ainda não mandou DM', motivo: 'sem-conversa' };
  const contas = (await rest(`mkt_ig_contas?select=id,ig_user_id,username,status,dono_id&id=in.(${[...new Set(lista.map((c) => c.conta_id))].join(',')})`).catch(() => null)) || [];
  // A conversa do Instagram DA PRÓPRIA pessoa vem primeiro; depois a mais recente.
  const doUsuario = lista.find((c) => contas.find((k) => k.id === c.conta_id)?.dono_id === userId);
  const conv = doUsuario || lista[0];
  const conta = contas.find((k) => k.id === conv.conta_id) ?? null;
  return { conv, conta, dono: conta?.dono_id === userId || (!conta?.dono_id && a.lead?.owner_id === userId) };
}

async function handler(req, res) {
  if (req.method === 'GET' && (req.query?.code || req.query?.error)) return callback(req, res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST' });
  }
  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(body.acao || '').toLowerCase();

  if (acao === 'link') {
    if (!appId() || !appSecret()) return res.status(503).json({ error: 'Falta configurar o app do Instagram na Vercel (MKT_IG_APP_ID e MKT_IG_APP_SECRET). Avise o Bruno.' });
    const ts = String(Date.now());
    const state = `${userId}.${ts}.${assinarState(userId, ts, appSecret())}`;
    const url = `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id=${enc(appId())}` +
      `&redirect_uri=${enc(redirectUri(req))}&response_type=code&scope=${enc(ESCOPOS)}&state=${enc(state)}`;
    return res.status(200).json({ ok: true, url });
  }

  if (acao === 'desconectar') {
    await rest(`mkt_ig_contas?dono_id=eq.${enc(userId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'desconectada', ultimo_erro: 'Desconectada pela SDR' } });
    return res.status(200).json({ ok: true });
  }

  const leadId = String(body.leadId || '').trim();
  const conversaId = String(body.conversaId || '').trim();
  const texto = String(body.texto ?? '').trim();
  if (!leadId && !conversaId) return res.status(400).json({ error: 'leadId ou conversaId obrigatório' });
  if (acao !== 'lida' && !texto) return res.status(400).json({ error: 'Escreva a mensagem' });
  if (texto.length > 1000) return res.status(400).json({ error: 'Mensagem longa demais (máx. 1000 caracteres no Instagram)' });

  const achado = await acharConversa(userId, { leadId, conversaId });
  if (achado.erro) return res.status(achado.erro).json({ error: achado.msg, motivo: achado.motivo });
  const { conv, conta, dono } = achado;

  if (acao === 'lida') {
    // Só quem é dona dá baixa: gestão olhando não some com o aviso da SDR.
    if (!dono) return res.status(200).json({ ok: true, marcada: false });
    await rest(`mkt_ig_conversas?id=eq.${conv.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { nao_lidas: 0 } }).catch(() => null);
    return res.status(200).json({ ok: true, marcada: true });
  }

  if (!janelaIg(conv.ultima_entrada_em)) {
    return res.status(409).json({
      error: 'Passou de 24 h desde a última mensagem do cliente: a Meta não deixa responder por aqui. Responda pelo app do Instagram — quando o cliente escrever de novo, a conversa volta a abrir no QS.',
      motivo: 'janela-fechada',
    });
  }
  if (!conta || conta.status !== 'conectada') return res.status(409).json({ error: 'Este Instagram está desconectado — conecte de novo em Configurações.', motivo: 'conta-desconectada' });

  try {
    const mid = await enviarDm(conta, conv.id, { id: conv.igsid }, montarMensagemIg(texto), 'manual', null);
    await rest(`mkt_ig_conversas?id=eq.${conv.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { automacao_pausada_ate: pausaPorRespostaManual(12), ...(dono ? { nao_lidas: 0 } : {}) } }).catch(() => null);
    return res.status(200).json({ ok: true, mid });
  } catch (e) {
    return res.status(502).json({ error: `O Instagram recusou: ${String(e?.message || e).slice(0, 200)}` });
  }
}

export default comSentry(handler);
