// api/rel-disparos.js
// -----------------------------------------------------------------------------
// DISPAROS DO RELACIONAMENTO — Fase 4 (0103 + 0105, 09/10/2026).
//
//   POST { acao: 'publico', publico }            → prévia: quantos recebem + amostra
//   POST { acao: 'preparar', campanhaId }        → monta a fila (rel_envios) e começa
//   POST { acao: 'enviar_lote', campanhaId }     → manda até 20; a tela chama em loop
//   POST { acao: 'pausar' | 'retomar', campanhaId }
//   POST { acao: 'testar_automacao', automacaoId } → quem receberia HOJE (não envia)
//   POST { acao: 'rodar_automacoes' }            → roda agora (admin/gestor)
//   GET  (Vercel Cron, Bearer CRON_SECRET)       → roda as automações ativas (10h)
//
// Regras que não se negociam:
//   • SÓ modelo aprovado pela Meta, pelo número do RELACIONAMENTO;
//   • quem pediu pra parar (ficha OU conversa — rel_cliente_optout) não recebe;
//   • a mesma mensagem nunca sai duas vezes: cada envio tem uma `chave` única.
//
// A mensagem enviada vira bolha na conversa com origem 'automatica': aparece
// pro time, mas NÃO conta como resposta no prazo (SLA) — disparo não é
// atendimento.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { enviarTemplate, modelosAprovados } from './_meta.js';
import { gravarRel } from './_relEntrada.js';
import { quemChama, numeroDoRelacionamento, numeroConectado } from './_relWa.js';

const LOTE = 20;
const PAUSA_MS = 250;
const BASE = () => String(process.env.QS_URL_PUBLICA || 'https://qs.setuforeuvouviagens.com.br').replace(/\/+$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
const hojeBRT = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

// ── Modelo: resolve UMA vez por lote (a lista vem da Meta) ──────────────────

/**
 * Mesmo contrato de resolverModeloMeta (_waSaida), mas com a lista de modelos
 * já em mãos: num lote de 20 envios seriam 20 idas à Meta só pra reler a lista.
 */
export function preencherModelo(lista, { nome, idioma }, params) {
  const t = (lista || []).find((m) => m.nome === nome && (!idioma || m.idioma === idioma));
  if (!t) return { erro: 'Modelo não está aprovado no número do Relacionamento.' };
  if (t.precisaMidia) return { erro: 'Modelo com imagem/vídeo no topo ainda não é suportado no disparo.' };
  let faltando = null;
  const texto = t.corpo.replace(/{{\s*([^}]+?)\s*}}/g, (_, k) => {
    const v = params[k];
    if (v == null || String(v).trim() === '') { faltando = k; return ''; }
    return String(v).trim();
  });
  if (faltando) return { erro: `variável {{${faltando}}} ficou vazia` };
  return { nome: t.nome, idioma: t.idioma, texto, params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v).trim()])) };
}

// ── Variáveis: de onde vem cada {{n}} ───────────────────────────────────────

const cacheViagem = new Map();
async function viagem(id) {
  if (!id) return null;
  if (cacheViagem.has(id)) return cacheViagem.get(id);
  const v = (await rest(`rel_viagens?select=id,titulo,destino,data_embarque&id=eq.${id}&limit=1`).catch(() => null))?.[0] || null;
  cacheViagem.set(id, v);
  return v;
}

async function linkDocumentos(clienteId, viagemId) {
  // Reaproveita um link aberto e válido do mesmo cliente/viagem, senão cria.
  const filtroViagem = viagemId ? `viagem_id=eq.${viagemId}` : 'viagem_id=is.null';
  const aberto = (await rest(
    `rel_doc_pedidos?select=token&cliente_id=eq.${clienteId}&${filtroViagem}&concluido_em=is.null` +
    `&expira_em=gt.${encodeURIComponent(new Date(Date.now() + 7 * 86_400_000).toISOString())}&order=criado_em.desc&limit=1`
  ).catch(() => null))?.[0];
  if (aberto?.token) return `${BASE()}/documentos/${aberto.token}`;
  const novo = await rest('rel_doc_pedidos', {
    method: 'POST', prefer: 'return=representation',
    body: { cliente_id: clienteId, viagem_id: viagemId || null, tipos: ['passaporte'] },
  });
  return novo?.[0]?.token ? `${BASE()}/documentos/${novo[0].token}` : null;
}

async function linkPesquisa(clienteId, viagemId) {
  const filtroViagem = viagemId ? `viagem_id=eq.${viagemId}` : 'viagem_id=is.null';
  const ja = (await rest(`rel_pesquisas?select=token&cliente_id=eq.${clienteId}&${filtroViagem}&order=criado_em.desc&limit=1`).catch(() => null))?.[0];
  if (ja?.token) return `${BASE()}/pesquisa/${ja.token}`;
  const novo = await rest('rel_pesquisas', {
    method: 'POST', prefer: 'return=representation',
    body: { cliente_id: clienteId, viagem_id: viagemId || null },
  });
  return novo?.[0]?.token ? `${BASE()}/pesquisa/${novo[0].token}` : null;
}

/** `params` da campanha/automação → valores pra este destinatário. */
export async function valoresDasVariaveis(params, alvo) {
  const out = {};
  for (const [k, cfg] of Object.entries(params || {})) {
    const fonte = cfg?.fonte || 'texto';
    let v = '';
    if (fonte === 'nome') v = String(alvo.nome || '').trim().split(/\s+/)[0] || '';
    else if (fonte === 'texto') v = String(cfg?.valor || '');
    else if (fonte === 'destino') { const vg = await viagem(alvo.viagem_id); v = vg?.destino || vg?.titulo || ''; }
    else if (fonte === 'data_embarque') v = dataBR((await viagem(alvo.viagem_id))?.data_embarque);
    else if (fonte === 'link_documentos') v = (await linkDocumentos(alvo.cliente_id, alvo.viagem_id)) || '';
    else if (fonte === 'link_pesquisa') v = (await linkPesquisa(alvo.cliente_id, alvo.viagem_id)) || '';
    out[k] = v;
  }
  return out;
}

// ── Um envio ────────────────────────────────────────────────────────────────

/**
 * Manda UM envio já registrado em rel_envios. Confere o optout de novo na hora
 * (a pessoa pode ter pedido pra parar entre preparar e enviar). Devolve o
 * status final. Nunca lança.
 */
async function enviarUm({ envio, alvo, modelo, lista, params, numero, rotulo }) {
  const fim = (status, extra = {}) => rest(`rel_envios?id=eq.${envio.id}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status, enviado_em: new Date().toISOString(), ...extra },
  }).then(() => status).catch(() => status);

  try {
    if (!alvo.telefone) return fim('pulado', { motivo: 'sem telefone' });
    const optout = await rest('rpc/rel_cliente_optout', { method: 'POST', body: { p_cliente: alvo.cliente_id } }).catch(() => false);
    if (optout === true) return fim('pulado', { motivo: 'pediu para não receber' });

    const valores = await valoresDasVariaveis(params, alvo);
    const m = preencherModelo(lista, modelo, valores);
    if (m.erro) return fim(m.erro.startsWith('variável') ? 'pulado' : 'falhou', { motivo: m.erro });

    const env = await enviarTemplate({ para: alvo.telefone, nome: m.nome, idioma: m.idioma, params: m.params, phoneId: numero.phone_number_id });
    if (!env?.wamid) return fim('falhou', { motivo: String(env?.detalhe || env?.erro || 'a Meta recusou').slice(0, 300) });

    await gravarRel({
      phoneId: numero.phone_number_id, telefone: alvo.telefone, wamid: env.wamid,
      direcao: 'out', origem: 'automatica', texto: m.texto, autorNome: rotulo, status: 'sent',
    });
    return fim('enviado', { wamid: env.wamid, motivo: null });
  } catch (e) {
    return fim('falhou', { motivo: String(e?.message || 'erro').slice(0, 300) });
  }
}

// ── Campanhas ───────────────────────────────────────────────────────────────

async function publico(p) {
  const linhas = await rest('rpc/rel_disparo_publico', { method: 'POST', body: { p_publico: p || { tipo: 'todos' } } });
  return Array.isArray(linhas) ? linhas : [];
}

async function lerCampanha(id) {
  if (!UUID.test(String(id || ''))) return null;
  return (await rest(`rel_campanhas?select=*&id=eq.${id}&limit=1`).catch(() => null))?.[0] || null;
}

/** Recalcula os contadores da campanha a partir dos envios (fonte da verdade). */
async function recontar(campanhaId) {
  const envs = await rest(`rel_envios?select=status&campanha_id=eq.${campanhaId}`).catch(() => []);
  const c = { total: 0, enviados: 0, falhas: 0, pulados: 0, pendentes: 0 };
  for (const e of envs || []) {
    c.total++;
    if (e.status === 'enviado') c.enviados++;
    else if (e.status === 'falhou') c.falhas++;
    else if (e.status === 'pulado') c.pulados++;
    else c.pendentes++;
  }
  return c;
}

async function preparar(campanha) {
  if (campanha.status !== 'rascunho') return { erro: 'Esta campanha já foi preparada.' };
  const lista = await modelosAprovados((await numeroDoRelacionamento())?.phone_number_id);
  const t = lista.find((m) => m.nome === campanha.modelo_nome && m.idioma === campanha.modelo_idioma);
  if (!t) return { erro: 'O modelo escolhido não está aprovado no número do Relacionamento.' };
  const faltam = [...new Set([...t.corpo.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((x) => x[1]))].filter((k) => !campanha.params?.[k]);
  if (faltam.length) return { erro: `Falta dizer de onde vem a variável {{${faltam[0]}}}.` };

  const alvos = await publico(campanha.publico);
  const linhas = alvos.map((a) => ({
    campanha_id: campanha.id, cliente_id: a.cliente_id, viagem_id: a.viagem_id, telefone: a.telefone,
    chave: `camp:${campanha.id}:${a.cliente_id}`,
    status: !a.telefone || a.optout ? 'pulado' : 'pendente',
    motivo: !a.telefone ? 'sem telefone' : a.optout ? 'pediu para não receber' : null,
  }));
  for (let i = 0; i < linhas.length; i += 500) {
    await rest('rel_envios?on_conflict=chave', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: linhas.slice(i, i + 500) });
  }
  const c = await recontar(campanha.id);
  await rest(`rel_campanhas?id=eq.${campanha.id}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: { status: c.pendentes ? 'enviando' : 'concluida', total: c.total, pulados: c.pulados, iniciada_em: new Date().toISOString(), ...(c.pendentes ? {} : { concluida_em: new Date().toISOString() }) },
  });
  return { ok: true, ...c };
}

async function enviarLote(campanha, numero) {
  if (campanha.status !== 'enviando') return { erro: campanha.status === 'pausada' ? 'Campanha pausada.' : 'Campanha não está enviando.' };
  const lista = await modelosAprovados(numero.phone_number_id);
  // Pega a vez: marca enviado_em nos pendentes ANTES de mandar. Duas abas
  // apertando "enviar" ao mesmo tempo não mandam a mesma mensagem duas vezes.
  // (Pendente com enviado_em velho = envio que morreu no meio: volta pra fila.)
  const velho = new Date(Date.now() - 5 * 60_000).toISOString();
  const candidatos = await rest(
    `rel_envios?select=id&campanha_id=eq.${campanha.id}&status=eq.pendente` +
    `&or=(enviado_em.is.null,enviado_em.lt.${encodeURIComponent(velho)})&order=criado_em.asc&limit=${LOTE}`
  ).catch(() => []);
  let feitos = 0;
  for (const cand of candidatos || []) {
    const pego = await rest(
      `rel_envios?id=eq.${cand.id}&status=eq.pendente&or=(enviado_em.is.null,enviado_em.lt.${encodeURIComponent(velho)})`,
      { method: 'PATCH', prefer: 'return=representation', body: { enviado_em: new Date().toISOString() } }
    ).catch(() => null);
    const envio = pego?.[0];
    if (!envio) continue;
    const cli = (await rest(`rel_clientes?select=nome,telefone&id=eq.${envio.cliente_id}&limit=1`).catch(() => null))?.[0] || {};
    await enviarUm({
      envio,
      alvo: { cliente_id: envio.cliente_id, viagem_id: envio.viagem_id, nome: cli.nome, telefone: cli.telefone || envio.telefone },
      modelo: { nome: campanha.modelo_nome, idioma: campanha.modelo_idioma }, lista, params: campanha.params,
      numero, rotulo: `Disparo: ${campanha.nome}`,
    });
    feitos++;
    await esperar(PAUSA_MS);
    // Pausaram no meio? Para aqui.
    if (feitos % 5 === 0 && (await lerCampanha(campanha.id))?.status !== 'enviando') break;
  }
  const c = await recontar(campanha.id);
  const acabou = c.pendentes === 0;
  const atual = await lerCampanha(campanha.id);
  await rest(`rel_campanhas?id=eq.${campanha.id}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: {
      enviados: c.enviados, falhas: c.falhas, pulados: c.pulados, total: c.total,
      ...(acabou && atual?.status === 'enviando' ? { status: 'concluida', concluida_em: new Date().toISOString() } : {}),
    },
  });
  return { ok: true, ...c, acabou };
}

// ── Automações ──────────────────────────────────────────────────────────────

async function alvosDaAutomacao(automacaoId, dia = null) {
  const r = await rest('rpc/rel_automacao_alvos', { method: 'POST', body: { p_automacao: automacaoId, p_dia: dia } });
  return Array.isArray(r) ? r : [];
}

/** Roda as automações ativas de hoje. Devolve um resumo por automação. */
async function rodarAutomacoes({ limiteMs = 50_000 } = {}) {
  const inicio = Date.now();
  const numero = await numeroDoRelacionamento();
  if (!numeroConectado(numero)) return { erro: 'Número do Relacionamento não está conectado — nada enviado.' };
  const ativas = await rest('rel_automacoes?select=*&ativo=eq.true').catch(() => []);
  if (!ativas?.length) return { ok: true, automacoes: [] };
  const lista = await modelosAprovados(numero.phone_number_id);
  const hoje = hojeBRT();
  const resumo = [];

  for (const a of ativas) {
    const r = { id: a.id, nome: a.nome, novos: 0, enviados: 0, pulados: 0, falhas: 0 };
    const alvos = await alvosDaAutomacao(a.id).catch(() => []);
    for (const alvo of alvos) {
      if (Date.now() - inicio > limiteMs) { r.cortado = true; break; }
      const chave = `aut:${a.id}:${alvo.cliente_id}:${alvo.viagem_id || '-'}:${hoje}`;
      // Grava ANTES de mandar: a chave única é o que impede o mesmo envio
      // duas vezes se o cron rodar de novo (ou alguém clicar "rodar agora").
      const novo = await rest('rel_envios?on_conflict=chave', {
        method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
        body: { automacao_id: a.id, cliente_id: alvo.cliente_id, viagem_id: alvo.viagem_id, telefone: alvo.telefone, chave, enviado_em: new Date().toISOString() },
      }).catch(() => null);
      const envio = novo?.[0];
      if (!envio) continue; // já tratado hoje
      r.novos++;
      const st = await enviarUm({
        envio, alvo, modelo: { nome: a.modelo_nome, idioma: a.modelo_idioma }, lista, params: a.params,
        numero, rotulo: `Automação: ${a.nome}`,
      });
      if (st === 'enviado') r.enviados++; else if (st === 'pulado') r.pulados++; else r.falhas++;
      await esperar(PAUSA_MS);
    }
    await rest(`rel_automacoes?id=eq.${a.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ultima_execucao: new Date().toISOString() } }).catch(() => null);
    resumo.push(r);
  }
  return { ok: true, automacoes: resumo };
}

// ── Rota ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  cacheViagem.clear(); // destino/data podem ter mudado desde a última execução
  // Vercel Cron: GET com o Bearer do CRON_SECRET.
  if (req.method === 'GET') {
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || veio !== segredo) return res.status(401).json({ error: 'Não autorizado' });
    const r = await rodarAutomacoes().catch((e) => ({ erro: e?.message }));
    console.log('[rel-disparos] cron:', JSON.stringify(r).slice(0, 800));
    return res.status(r.erro ? 503 : 200).json(r);
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const u = await quemChama(req);
  if (!u) return res.status(401).json({ error: 'Sem acesso ao Relacionamento.' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(body.acao || '');

  try {
    if (acao === 'publico') {
      const alvos = await publico(body.publico);
      const recebem = alvos.filter((a) => a.telefone && !a.optout);
      return res.status(200).json({
        total: recebem.length,
        semTelefone: alvos.filter((a) => !a.telefone).length,
        optout: alvos.filter((a) => a.telefone && a.optout).length,
        amostra: recebem.slice(0, 8).map((a) => ({ nome: a.nome, telefone: a.telefone })),
      });
    }

    if (acao === 'testar_automacao') {
      if (!UUID.test(String(body.automacaoId || ''))) return res.status(400).json({ error: 'Automação inválida.' });
      const alvos = await alvosDaAutomacao(body.automacaoId);
      return res.status(200).json({
        alvos: alvos.map((a) => ({
          nome: a.nome, telefone: a.telefone,
          motivo: !a.telefone ? 'sem telefone' : a.optout ? 'pediu para não receber' : null,
        })),
      });
    }

    if (acao === 'rodar_automacoes') {
      if (!(u.role === 'admin' || u.role === 'gestor')) return res.status(403).json({ error: 'Só admin ou gestor roda as automações na mão.' });
      const r = await rodarAutomacoes({ limiteMs: 45_000 });
      return res.status(r.erro ? 409 : 200).json(r.erro ? { error: r.erro } : r);
    }

    const campanha = await lerCampanha(body.campanhaId);
    if (!campanha) return res.status(404).json({ error: 'Campanha não encontrada.' });

    if (acao === 'pausar') {
      if (campanha.status === 'enviando') await rest(`rel_campanhas?id=eq.${campanha.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'pausada' } });
      return res.status(200).json({ ok: true });
    }
    if (acao === 'retomar') {
      if (campanha.status === 'pausada') await rest(`rel_campanhas?id=eq.${campanha.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'enviando' } });
      return res.status(200).json({ ok: true });
    }

    const numero = await numeroDoRelacionamento();
    if (!numeroConectado(numero)) {
      return res.status(409).json({ error: 'O número do Relacionamento não está conectado. Conecte em Comercial → Configurações → WhatsApp (Meta).' });
    }

    if (acao === 'preparar') {
      const r = await preparar(campanha);
      return res.status(r.erro ? 400 : 200).json(r.erro ? { error: r.erro } : r);
    }
    if (acao === 'enviar_lote') {
      const r = await enviarLote(campanha, numero);
      return res.status(r.erro ? 409 : 200).json(r.erro ? { error: r.erro } : r);
    }
    return res.status(400).json({ error: 'Ação inválida.' });
  } catch (e) {
    console.error('[rel-disparos]', acao, e?.message);
    return res.status(500).json({ error: e?.message || 'Falhou.' });
  }
}
