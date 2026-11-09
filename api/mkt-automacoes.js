// api/mkt-automacoes.js
// -----------------------------------------------------------------------------
// AUTOMAÇÕES DO MARKETING — a rota do servidor (0244, 30/10/2026).
//
//   GET  ?cron=1          (Vercel Cron, Bearer CRON_SECRET, a cada minuto)
//                         → acorda as esperas (Aguardar, prazo de resposta)
//                         + renova o token do Instagram quando precisa (0343)
//   GET  ?e=<código>[&q=1] (PÚBLICO) → link de entrada /e/<código> (vercel.json):
//                         conta o clique e redireciona pro wa.me (link_ref) ou
//                         ig.me (ig_ref). Robô de pré-visualização não conta.
//   GET  ?estado=1        (logado) → número do Marketing + config do robô/Instagram
//   POST ?lp=<token>      (PÚBLICO, o token é a senha) → webhook da LP / n8n:
//                         { telefone, nome?, email?, tags?, campos? } inicia o fluxo
//   POST { acao }         (logado, admin/marketing/gestor do Comercial):
//        simular    { fluxoId | grafo, pessoa?, janela?, respostas? }  — NÃO manda nada
//        testar     { fluxoId, telefone? } — manda DE VERDADE pro WhatsApp de quem testa
//        iniciar    { fluxoId, conversaId }
//        responder  { conversaId, texto | modelo }  — pausa o robô (12 h padrão)
//        pausar     { conversaId, horas }  (0 = devolve pro robô)
//        tags       { conversaId, adicionar?:[], remover?:[] }
//        lida       { conversaId }
//        modelos    {}  — modelos aprovados da conta do número do Marketing
//        ig-conectar { igUserId?, token } — troca o token curto pelo longo (60 dias) quando dá
//        ig-renovar { contaId } — renova o token agora · ig-responder { conversaId, texto }
//        ig-iniciar { conversaId, fluxoId } — começa um fluxo do Instagram na DM (janela aberta)
//
// O que é só CRUD (fluxos, gatilhos, campos, config, automações do Instagram) a
// tela grava direto no banco com RLS (mkt_auto_acesso, 0244).
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import { rest } from './_supabaseAdmin.js';
import { getSupabaseUserId } from './_wa.js';
import {
  iniciarFluxo, iniciarFluxoIg, modelosDoMarketing, numeroDoMarketing, responderManual, rodarAutomacoes, configRobo,
} from './_mktMotor.js';
import { simularFluxo, telefoneCanonico, pausaPorRespostaManual } from './_mktAutoRegras.js';
import { ig, enviarDm, montarMensagemIg, janelaIg, instagramLigado, renovarTokensIg, trocarPorTokenLongo } from './_mktInstagram.js';
import { codigoDoRef, destinoDaEntrada, ehRobo } from './_mktIgRegras.js';

const enc = encodeURIComponent;

async function quem(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id) return null;
  const u = (await rest(`qs_users?select=id,name,role,setores,is_active,whatsapp_number&id=eq.${enc(id)}&limit=1`).catch(() => null))?.[0];
  if (!u || u.is_active === false) return null;
  const s = Array.isArray(u.setores) ? u.setores : [];
  const pode = u.role === 'admin' || u.role === 'marketing' || s.includes('marketing');
  return pode ? u : null;
}

function corpoJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); } catch { return {}; }
}

export default async function handler(req, res) {
  const q = req.query || {};

  // ── Cron ──
  if (req.method === 'GET' && q.cron) {
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || veio !== segredo) return res.status(401).json({ error: 'Não autorizado' });
    const r = await rodarAutomacoes(Date.now() + 40_000).catch((e) => ({ erro: e?.message }));
    const tk = await renovarTokensIg().catch((e) => ({ erro: e?.message }));
    if (r?.acordadas || r?.erros || tk?.renovadas || tk?.falhas) console.log('[mkt-automacoes] cron:', JSON.stringify({ ...r, token: tk }));
    return res.status(200).json({ ...r, token: tk });
  }

  // ── Link de entrada (público): /e/<código> → conta o clique → wa.me / ig.me ──
  if (req.method === 'GET' && q.e) {
    res.setHeader('Cache-Control', 'no-store');
    const codigo = codigoDoRef(String(q.e));
    if (!codigo) return res.status(404).send('Link não encontrado.');
    const robo = ehRobo(req.headers['user-agent']);
    // Robô de pré-visualização: só descobre o destino (p_origem null = não conta).
    const g = (await rest('rpc/mkt_entrada_clique', { method: 'POST', body: { p_codigo: codigo, p_origem: robo ? null : q.q ? 'qr' : 'link' } }).catch(() => null))?.[0];
    if (!g) return res.status(404).send('Link não encontrado.');
    let destino = null;
    if (g.tipo === 'link_ref') {
      const n = await numeroDoMarketing().catch(() => null);
      destino = destinoDaEntrada(g, { numero: n?.numero || null });
    } else {
      const c = (await rest('mkt_ig_contas?select=username&status=eq.conectada&username=not.is.null&order=criado_em.asc&limit=1').catch(() => null))?.[0];
      destino = destinoDaEntrada(g, { usuarioIg: c?.username || null });
    }
    if (!destino) return res.status(503).send('Este link ainda não está pronto (falta conectar o número ou a conta).');
    res.setHeader('Location', destino);
    return res.status(302).end();
  }

  // ── Webhook da LP / n8n (público; o token é a senha) ──
  if (req.method === 'POST' && q.lp) {
    const token = String(q.lp);
    if (!/^[a-f0-9]{24,64}$/.test(token)) return res.status(404).json({ error: 'Webhook não encontrado.' });
    const g = (await rest(`mkt_fluxo_gatilhos?select=id,fluxo_id,ativo,mkt_fluxos!inner(status)&tipo=eq.webhook&config->>token=eq.${enc(token)}&limit=1`).catch(() => null))?.[0];
    if (!g) return res.status(404).json({ error: 'Webhook não encontrado.' });
    if (!g.ativo || g.mkt_fluxos?.status !== 'ativo') return res.status(409).json({ error: 'O fluxo deste webhook não está ativo.' });
    const n = await numeroDoMarketing();
    if (!n?.conectado) return res.status(503).json({ error: 'O número do Marketing não está conectado.' });
    const b = corpoJson(req);
    const telefone = telefoneCanonico(b.telefone || b.phone || b.whatsapp || '');
    if (telefone.length < 12) return res.status(400).json({ error: 'Telefone inválido.' });
    const campos = b.campos && typeof b.campos === 'object' ? Object.fromEntries(Object.entries(b.campos).filter(([k]) => /^[a-z][a-z0-9_]{0,39}$/.test(k)).slice(0, 30).map(([k, v]) => [k, String(v ?? '').slice(0, 500)])) : {};
    const tags = (Array.isArray(b.tags) ? b.tags : []).map((t) => String(t).trim().slice(0, 60)).filter(Boolean).slice(0, 10);
    const r = await iniciarFluxo({
      phoneId: n.phone_number_id, fluxoId: g.fluxo_id, telefone, nome: b.nome ? String(b.nome).slice(0, 120) : null, gatilhoId: g.id,
      dados: { email: b.email ? String(b.email).slice(0, 200) : null, tags, campos },
    }).catch((e) => ({ erro: e?.message }));
    if (r.erro) return res.status(422).json({ error: r.erro });
    return res.status(200).json({ ok: true, execucao: r.execucaoId });
  }

  const u = await quem(req);
  if (!u) return res.status(401).json({ error: 'Sem acesso às automações do Marketing.' });

  if (req.method === 'GET') {
    const [numero, robo, igLigado] = await Promise.all([numeroDoMarketing(), configRobo(), instagramLigado()]);
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return res.status(200).json({
      numero: numero ? { phoneId: numero.phone_number_id, numero: numero.numero, nome: numero.nome_verificado, conectado: numero.conectado } : null,
      robo, instagram: { ligado: igLigado, webhook: host ? `https://${host}/api/mkt-instagram` : null, verifyToken: Boolean(process.env.MKT_IG_VERIFY_TOKEN) },
      lpBase: host ? `https://${host}/api/mkt-automacoes?lp=` : null,
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET ou POST' });
  }

  const b = corpoJson(req);
  const acao = String(b.acao || '');
  try {
    if (acao === 'simular') {
      let fluxo = null;
      if (b.grafo) fluxo = { id: b.fluxoId || '00000000-0000-0000-0000-000000000000', nome: 'rascunho', grafo: b.grafo };
      else if (b.fluxoId) fluxo = (await rest(`mkt_fluxos?select=id,nome,grafo&id=eq.${enc(b.fluxoId)}&limit=1`))?.[0];
      if (!fluxo) return res.status(404).json({ error: 'Fluxo não encontrado.' });
      const pessoa = { nome: u.name, telefone: u.whatsapp_number || '', tags: [], campos: {}, ...(b.pessoa || {}) };
      return res.status(200).json(simularFluxo(fluxo, { pessoa, janela: b.janela !== false, respostas: b.respostas || {} }));
    }

    if (acao === 'modelos') {
      const n = await numeroDoMarketing();
      if (!n) return res.status(200).json({ modelos: [], aviso: 'Nenhum número com setor Marketing conectado.' });
      return res.status(200).json(await modelosDoMarketing(n.phone_number_id));
    }

    if (acao === 'testar' || acao === 'iniciar') {
      const n = await numeroDoMarketing();
      if (!n?.conectado) return res.status(503).json({ error: 'O número do Marketing não está conectado na Meta.' });
      let telefone = b.telefone || u.whatsapp_number;
      let nome = u.name;
      if (acao === 'iniciar') {
        const c = (await rest(`mkt_wa_conversas?select=wa_id,nome_perfil&id=eq.${enc(b.conversaId)}&limit=1`))?.[0];
        if (!c) return res.status(404).json({ error: 'Conversa não encontrada.' });
        telefone = c.wa_id; nome = c.nome_perfil;
      }
      if (!telefone) return res.status(400).json({ error: 'Cadastre seu WhatsApp no seu perfil do QS para testar.' });
      const r = await iniciarFluxo({ phoneId: n.phone_number_id, fluxoId: String(b.fluxoId || ''), telefone, nome, teste: acao === 'testar' });
      if (r.erro) return res.status(422).json({ error: r.erro });
      return res.status(200).json({ ok: true, ...r });
    }

    if (acao === 'responder') {
      const r = await responderManual({ conversaId: String(b.conversaId || ''), texto: b.texto, modelo: b.modelo, autorId: u.id });
      if (r.erro) return res.status(422).json({ error: r.erro });
      return res.status(200).json(r);
    }

    if (acao === 'pausar') {
      const horas = Number(b.horas);
      const ate = horas > 0 ? pausaPorRespostaManual(horas) : null;
      await rest(`mkt_wa_conversas?id=eq.${enc(b.conversaId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { automacao_pausada_ate: ate, ...(ate ? {} : { precisa_humano_em: null }) } });
      return res.status(200).json({ ok: true, pausadoAte: ate });
    }

    if (acao === 'lida') {
      await rest(`mkt_wa_conversas?id=eq.${enc(b.conversaId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { nao_lidas: 0 } });
      return res.status(200).json({ ok: true });
    }

    if (acao === 'tags') {
      const c = (await rest(`mkt_wa_conversas?select=contato_id&id=eq.${enc(b.conversaId)}&limit=1`))?.[0];
      if (!c?.contato_id) return res.status(404).json({ error: 'Conversa sem contato.' });
      const ct = (await rest(`mkt_contatos?select=id,tags&id=eq.${c.contato_id}&limit=1`))?.[0];
      const limpa = (l) => (Array.isArray(l) ? l : []).map((t) => String(t).trim().slice(0, 60)).filter(Boolean);
      const tirar = new Set(limpa(b.remover).map((t) => t.toLowerCase()));
      const tags = [...new Set([...(ct?.tags || []).filter((t) => !tirar.has(String(t).toLowerCase())), ...limpa(b.adicionar)])].slice(0, 50);
      await rest(`mkt_contatos?id=eq.${c.contato_id}`, { method: 'PATCH', prefer: 'return=minimal', body: { tags } });
      for (const t of limpa(b.adicionar)) {
        await rest('mkt_contato_eventos', { method: 'POST', prefer: 'return=minimal', body: { contato_id: c.contato_id, tipo: 'tag_adicionada', dados: { tag: t, origem: 'conversas', por: u.id } } }).catch(() => null);
      }
      return res.status(200).json({ ok: true, tags });
    }

    if (acao === 'ig-conectar') {
      const igUserId = String(b.igUserId || '').replace(/\D/g, '');
      const token = String(b.token || '').trim();
      if (token.length < 20) return res.status(400).json({ error: 'Cole o token da conta.' });
      let me;
      try { me = await ig('/me?fields=user_id,username,name', { token }); }
      catch (e) { return res.status(400).json({ error: `O Instagram recusou o token: ${e.message}` }); }
      const idDaConta = String(me?.user_id || '').replace(/\D/g, '') || igUserId;
      if (!idDaConta) return res.status(400).json({ error: 'Não consegui ler o ID da conta — informe o ID.' });
      if (igUserId && me?.user_id && igUserId !== idDaConta) return res.status(400).json({ error: `Este token é da conta ${idDaConta}, não da ${igUserId}.` });
      // Token curto (1 h) vira longo (60 dias) quando o segredo do app está na Vercel.
      const longo = await trocarPorTokenLongo(token);
      const agora = new Date().toISOString();
      const conta = (await rest('mkt_ig_contas?on_conflict=ig_user_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
        body: { ig_user_id: idDaConta, username: me?.username || null, nome: me?.name || null, status: 'conectada', ultimo_erro: null },
      }))?.[0];
      await rest('rpc/mkt_ig_guardar_token', { method: 'POST', body: { p_conta: conta.id, p_token: longo?.token || token } });
      // Colunas da 0343: sem ela, segue (o token já está no cofre).
      await rest(`mkt_ig_contas?id=eq.${conta.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { token_expira_em: longo?.expiraEm ?? null, token_renovado_em: agora, token_tentativa_em: null } }).catch(() => null);
      return res.status(200).json({
        ok: true, username: me?.username || null, longo: Boolean(longo),
        aviso: longo ? null : 'Não deu pra saber a validade do token: o QS tenta renovar sozinho daqui a 24 h. Se ele for de curta duração (1 h), cadastre MKT_IG_APP_SECRET na Vercel e conecte de novo.',
      });
    }

    if (acao === 'ig-renovar') {
      const r = await renovarTokensIg({ forcar: true, contaId: String(b.contaId || '') || null });
      if (!r.renovadas) {
        const c = (await rest(`mkt_ig_contas?select=ultimo_erro&id=eq.${enc(b.contaId)}&limit=1`).catch(() => null))?.[0];
        return res.status(422).json({ error: c?.ultimo_erro || 'Não renovou (o token precisa ter mais de 24 h de vida).' });
      }
      return res.status(200).json({ ok: true });
    }

    if (acao === 'ig-iniciar') {
      const r = await iniciarFluxoIg({ conversaId: String(b.conversaId || ''), fluxoId: String(b.fluxoId || '') });
      if (r.erro) return res.status(422).json({ error: r.erro });
      return res.status(200).json({ ok: true, ...r });
    }

    if (acao === 'ig-responder') {
      const conv = (await rest(`mkt_ig_conversas?select=id,igsid,ultima_entrada_em,conta_id&id=eq.${enc(b.conversaId)}&limit=1`))?.[0];
      if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
      if (!janelaIg(conv.ultima_entrada_em)) return res.status(422).json({ error: 'Fora da janela de 24 h do Instagram.' });
      const conta = (await rest(`mkt_ig_contas?select=id,ig_user_id,username&id=eq.${conv.conta_id}&limit=1`))?.[0];
      const texto = String(b.texto || '').trim();
      if (!texto) return res.status(400).json({ error: 'Escreva a mensagem.' });
      await enviarDm(conta, conv.id, { id: conv.igsid }, montarMensagemIg(texto), 'manual');
      await rest(`mkt_ig_conversas?id=eq.${conv.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { automacao_pausada_ate: pausaPorRespostaManual(12), nao_lidas: 0 } });
      return res.status(200).json({ ok: true });
    }

    if (acao === 'novo-token') return res.status(200).json({ token: crypto.randomBytes(16).toString('hex') });

    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (e) {
    console.error(`[mkt-automacoes] ${acao}:`, e?.message);
    return res.status(500).json({ error: e?.message || 'Falhou.' });
  }
}
