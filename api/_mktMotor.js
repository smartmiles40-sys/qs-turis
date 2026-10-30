// api/_mktMotor.js
// -----------------------------------------------------------------------------
// O MOTOR DAS AUTOMAÇÕES DO MARKETING — quem ANDA pelo fluxo (30/10/2026).
// Porte do SendFlow (src/lib/automacao/motor.ts) para o QS: PostgREST puro
// (api/_supabaseAdmin.js) no lugar do supabase-js, tabelas mkt_* (0244) e a
// base de contatos única do Marketing (mkt_contatos, 0242).
//
// Três portas, um caminho só:
//   • receberMensagem  ← webhook da Meta (via api/_mktAutoEntrada.js)
//   • rodarAutomacoes  ← cron do QS (/api/mkt-automacoes, a cada minuto)
//   • iniciarFluxo     ← tela (testar, iniciar na conversa) e webhook da LP
//
// Todas terminam em `avancar`, que pergunta ao PLANO (api/_mktAutoRegras.js) o que
// fazer em cada bloco e executa: manda, grava, espera. Quando precisa esperar
// (resposta ou tempo), o estado vai para mkt_fluxo_execucoes e a função acaba.
//
// Regras do arquivo inteiro:
//   1. Nunca lança pra quem chamou: erro vira estado 'erro' na execução + evento.
//   2. Janela de 24 h conferida ANTES de texto livre (o plano já faz). Fora
//      dela, só template — o fluxo segue pela saída "janela fechada".
//   3. Nada roda pra quem pediu para sair, com o robô pausado na conversa ou
//      com o robô DESLIGADO (mkt_auto_config.robo.ligado = false).
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { credenciaisDaMeta, graph } from './_meta.js';
import { ehPedidoDeParada } from './_waOptout.js';
import {
  MAX_PASSOS_RODADA, MAX_PASSOS_TOTAL, MAX_PROFUNDIDADE,
  aplicarAcaoNaPessoa, escolherGatilho, janelaAberta, lerEntrada, lerIdDeResposta,
  montarTemplate, normalizarGrafo, personalizar, planoDoNo, prefixoDeResposta, previaDoCorpo,
  proximoNo, roboPausado, saidaLigada, saidasDoNo, telefoneCanonico, tipoDoCorpo,
  validarResposta, variantesTelefone, pausaPorRespostaManual, podeSairForaDaJanela,
} from './_mktAutoRegras.js';

const enc = encodeURIComponent;
const agoraIso = () => new Date().toISOString();

// ── Banco (pequeno adaptador sobre o PostgREST) ─────────────────────────────
async function um(path) {
  const r = await rest(path);
  return Array.isArray(r) ? r[0] || null : null;
}
async function inserir(tabela, linha) {
  const r = await rest(tabela, { method: 'POST', body: linha, prefer: 'return=representation' });
  return Array.isArray(r) ? r[0] || null : null;
}
async function mudar(tabelaEFiltro, patch) {
  await rest(tabelaEFiltro, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
}
const rpc = (nome, body) => rest(`rpc/${nome}`, { method: 'POST', body });
const quieto = (p) => Promise.resolve(p).catch((e) => console.warn('[mkt-motor]', e?.message));

// ── Configuração ────────────────────────────────────────────────────────────
let cacheCfg = { em: 0, v: null };
export async function configRobo() {
  if (cacheCfg.v && Date.now() - cacheCfg.em < 60_000) return cacheCfg.v;
  let v = { ligado: true, pausa_manual_horas: 12 };
  try {
    const r = await um('mkt_auto_config?select=valor&chave=eq.robo&limit=1');
    if (r?.valor && typeof r.valor === 'object') v = { ...v, ...r.valor };
  } catch { /* sem config = padrão */ }
  cacheCfg = { em: Date.now(), v };
  return v;
}

// ── Meta: mandar ────────────────────────────────────────────────────────────

/** Um corpo qualquer da Cloud API (texto, mídia, interativa, template). */
export async function enviarCorpo(phoneId, para, corpo) {
  const cr = await credenciaisDaMeta(phoneId);
  if (!cr) return { erro: 'O número do Marketing não está conectado na Meta (sem token).' };
  try {
    const j = await graph(`/${cr.phoneId}/messages`, {
      method: 'POST', token: cr.token, timeoutMs: 20_000,
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(para), ...corpo },
    });
    return { wamid: j?.messages?.[0]?.id || null };
  } catch (e) {
    if (e?.metaCode === 131047) return { erro: 'Janela de 24 h fechada (a Meta recusou o texto livre).' };
    return { erro: e?.message || 'A Meta recusou.' };
  }
}

async function digitando(phoneId, wamid) {
  const cr = await credenciaisDaMeta(phoneId).catch(() => null);
  if (!cr || !wamid) return;
  await graph(`/${cr.phoneId}/messages`, {
    method: 'POST', token: cr.token, timeoutMs: 6000,
    body: { messaging_product: 'whatsapp', status: 'read', message_id: String(wamid), typing_indicator: { type: 'text' } },
  }).catch(() => null);
}

/** O corpo `template` da Meta, com variáveis e o payload de cada botão de resposta. */
export function corpoDeTemplate(t, botoesPayload = []) {
  const components = [];
  if (t.cabecalhoUrl) {
    const ext = String(t.cabecalhoUrl).split('?')[0].toLowerCase();
    const tipo = /\.(mp4|3gp)$/.test(ext) ? 'video' : /\.pdf$/.test(ext) ? 'document' : 'image';
    components.push({ type: 'header', parameters: [{ type: tipo, [tipo]: { link: t.cabecalhoUrl } }] });
  }
  const ordem = Object.keys(t.params || {}).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b));
  if (ordem.length) components.push({ type: 'body', parameters: ordem.map((k) => ({ type: 'text', text: String(t.params[k] ?? '') })) });
  for (const b of botoesPayload) {
    components.push({ type: 'button', sub_type: 'quick_reply', index: String(b.indice), parameters: [{ type: 'payload', payload: b.payload }] });
  }
  return { type: 'template', template: { name: t.nome, language: { code: t.idioma || 'pt_BR' }, ...(components.length ? { components } : {}) } };
}

/** Quantos {{n}} o corpo do modelo tem e onde estão os botões de resposta rápida. */
async function lerModelo(phoneId, nome, idioma) {
  try {
    const cr = await credenciaisDaMeta(phoneId);
    if (!cr?.waba) return null;
    const j = await graph(`/${cr.waba}/message_templates?name=${enc(nome)}&fields=name,language,components,status&limit=20`, { token: cr.token, timeoutMs: 8000 });
    const t = (j?.data || []).find((x) => x.name === nome && (!idioma || x.language === idioma)) || null;
    if (!t) return null;
    const corpo = (t.components || []).find((c) => c.type === 'BODY')?.text || '';
    const nums = [...corpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    const botoes = (t.components || []).find((c) => c.type === 'BUTTONS')?.buttons || [];
    return { nVariaveis: nums.length ? Math.max(...nums) : 0, corpo, botoes };
  } catch { return null; }
}

// ── Conversa e contato ──────────────────────────────────────────────────────

export async function garantirContato(waId, nome) {
  const tel = telefoneCanonico(waId);
  const vars = variantesTelefone(tel);
  let c = await um(`mkt_contatos?select=id,nome,email,telefone,tags,campos,optout_whatsapp_em&telefone=in.(${vars.join(',')})&limit=1`);
  if (!c) {
    try {
      c = await inserir('mkt_contatos', { telefone: tel, nome: nome || null, origem: 'whatsapp_mkt', tags: [], campos: {} });
    } catch {
      // corrida: outra requisição criou no meio
      c = await um(`mkt_contatos?select=id,nome,email,telefone,tags,campos,optout_whatsapp_em&telefone=in.(${vars.join(',')})&limit=1`);
    }
  } else if (nome && !c.nome) {
    await quieto(mudar(`mkt_contatos?id=eq.${c.id}`, { nome }));
    c.nome = nome;
  }
  return c;
}

export async function garantirConversa(phoneId, waId, nomePerfil, daMeta = false) {
  const vars = variantesTelefone(waId);
  const sel = 'mkt_wa_conversas?select=*';
  let c = await um(`${sel}&phone_number_id=eq.${enc(phoneId)}&wa_id=in.(${vars.join(',')})&limit=1`);
  let nova = false;
  if (c) {
    const patch = {};
    // O número que veio da Meta é o wa_id verdadeiro: é pra ele que se responde.
    if (daMeta && c.wa_id !== waId) patch.wa_id = waId;
    if (nomePerfil && nomePerfil !== c.nome_perfil) patch.nome_perfil = nomePerfil;
    if (Object.keys(patch).length) { await quieto(mudar(`mkt_wa_conversas?id=eq.${c.id}`, patch)); Object.assign(c, patch); }
  } else {
    try {
      c = await inserir('mkt_wa_conversas', { phone_number_id: phoneId, wa_id: waId, nome_perfil: nomePerfil || null });
      nova = true;
    } catch {
      c = await um(`${sel}&phone_number_id=eq.${enc(phoneId)}&wa_id=eq.${enc(waId)}&limit=1`);
    }
  }
  if (c && !c.contato_id) {
    const ct = await garantirContato(waId, nomePerfil).catch(() => null);
    if (ct?.id) { c.contato_id = ct.id; await quieto(mudar(`mkt_wa_conversas?id=eq.${c.id}`, { contato_id: ct.id })); }
  }
  return { conversa: c, nova };
}

async function montarContexto(conversa, wamid = null) {
  const ctx = { conversa, contato: null, ultimaEntradaWamid: wamid, profundidade: 0, fluxos: new Map() };
  await recarregarContato(ctx);
  return ctx;
}

async function recarregarContato(ctx) {
  if (!ctx.conversa.contato_id) return;
  ctx.contato = await um(`mkt_contatos?select=id,nome,email,telefone,tags,campos,optout_whatsapp_em&id=eq.${ctx.conversa.contato_id}&limit=1`).catch(() => null);
}

function pessoaDe(ctx) {
  const c = ctx.contato;
  return {
    nome: c?.nome || ctx.conversa.nome_perfil || null, email: c?.email ?? null, telefone: c?.telefone ?? ctx.conversa.wa_id,
    tags: c?.tags ?? [], campos: c?.campos ?? {},
  };
}
const descadastrado = (ctx) => Boolean(ctx.contato?.optout_whatsapp_em);
const pausada = (ctx) => roboPausado(ctx.conversa.automacao_pausada_ate);

async function registrarEventoContato(ctx, tipo, dados) {
  if (!ctx.contato?.id) return;
  await quieto(rest('mkt_contato_eventos', { method: 'POST', prefer: 'return=minimal', body: { contato_id: ctx.contato.id, tipo, dados } }));
}

// ── Registro do fluxo ───────────────────────────────────────────────────────

async function carregarFluxo(ctx, id) {
  if (ctx.fluxos.has(id)) return ctx.fluxos.get(id);
  const f = await um(`mkt_fluxos?select=*&id=eq.${enc(id)}&limit=1`).catch(() => null);
  if (!f) return null;
  f.grafo = normalizarGrafo(f.grafo);
  ctx.fluxos.set(id, f);
  return f;
}

async function evento(fluxoId, execId, noId, tipo, saida = null, detalhe = null) {
  await quieto(rest('mkt_fluxo_eventos', {
    method: 'POST', prefer: 'return=minimal',
    body: { fluxo_id: fluxoId, execucao_id: execId, no_id: noId, tipo, saida, detalhe: detalhe ? String(detalhe).slice(0, 500) : null },
  }));
}

const atualizarExecucao = (id, patch) => mudar(`mkt_fluxo_execucoes?id=eq.${id}`, { ...patch, atualizada_em: agoraIso() });

async function concluir(exec, estado, erro = null) {
  await quieto(atualizarExecucao(exec.id, { estado, acordar_em: null, aguardando: null, travada_ate: null, erro, concluida_em: agoraIso() }));
  if (estado === 'concluida') await quieto(rpc('mkt_auto_contar_conclusao', { p_fluxo: exec.fluxo_id }));
}

/** Manda um corpo e guarda na conversa. Devolve a frase do erro ou null. */
async function mandar(ctx, corpo, origem = {}) {
  const c = ctx.conversa;
  // Trava final da regra das 24 h: nada de texto livre fora da janela, venha de onde vier.
  if (!podeSairForaDaJanela(corpo) && !janelaAberta(c.ultima_entrada_em)) return 'Janela de 24 h fechada: só modelo (template) pode sair.';
  const r = await enviarCorpo(c.phone_number_id, c.wa_id, corpo);
  const previa = previaDoCorpo(corpo);
  await quieto(rest('mkt_wa_mensagens', {
    method: 'POST', prefer: 'return=minimal',
    body: {
      conversa_id: c.id, direcao: 'out', tipo: tipoDoCorpo(corpo), texto: previa.slice(0, 4000), payload: corpo,
      wamid: r.wamid || null, status: r.erro ? 'falha' : 'enviado', erro: r.erro || null,
      origem: origem.tipo || 'fluxo', fluxo_id: origem.fluxoId || null, no_id: origem.noId || null, autor_id: origem.autorId || null,
    },
  }));
  await quieto(mudar(`mkt_wa_conversas?id=eq.${c.id}`, { ultima_mensagem_em: agoraIso(), ultima_previa: previa.slice(0, 200) }));
  return r.erro || null;
}

// ── Ações ───────────────────────────────────────────────────────────────────

async function salvarPessoa(ctx, antes, depois) {
  if (!ctx.contato) return;
  const patch = {};
  if (JSON.stringify(antes.tags) !== JSON.stringify(depois.tags)) patch.tags = depois.tags;
  if (JSON.stringify(antes.campos) !== JSON.stringify(depois.campos)) patch.campos = depois.campos;
  if (antes.nome !== depois.nome) patch.nome = depois.nome;
  if (antes.email !== depois.email) patch.email = depois.email ? String(depois.email).toLowerCase() : null;
  if (!Object.keys(patch).length) return;
  try { await mudar(`mkt_contatos?id=eq.${ctx.contato.id}`, patch); }
  catch (e) {
    // e-mail repetido com outro contato derrubaria o resto: tenta sem ele
    if (patch.email !== undefined) { delete patch.email; await quieto(mudar(`mkt_contatos?id=eq.${ctx.contato.id}`, patch)); }
    else throw e;
  }
  Object.assign(ctx.contato, patch);
}

async function executarAcao(ctx, a, fluxo, exec) {
  const c = ctx.conversa;
  switch (a?.tipo) {
    case 'adicionar_tag': case 'remover_tag': case 'adicionar_lista': case 'remover_lista':
    case 'definir_campo': case 'limpar_campo': {
      if (!ctx.contato) return 'sem contato';
      const antes = pessoaDe(ctx);
      const depois = aplicarAcaoNaPessoa(antes, a);
      await salvarPessoa(ctx, antes, depois);
      if (a.tipo === 'adicionar_tag') {
        const tag = personalizar(a.tag, antes).trim();
        if (tag && !antes.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
          await registrarEventoContato(ctx, 'tag_adicionada', { tag, fluxo_id: fluxo.id, origem: 'automacao' });
          await dispararPorTag(ctx, tag);
        }
      }
      return null;
    }
    case 'descadastrar':
      if (!ctx.contato) return 'sem contato';
      await mudar(`mkt_contatos?id=eq.${ctx.contato.id}`, { optout_whatsapp_em: agoraIso() });
      ctx.contato.optout_whatsapp_em = agoraIso();
      await registrarEventoContato(ctx, 'optout_whatsapp', { origem: 'automacao', fluxo_id: fluxo.id });
      return null;
    case 'reinscrever':
      if (!ctx.contato) return 'sem contato';
      await mudar(`mkt_contatos?id=eq.${ctx.contato.id}`, { optout_whatsapp_em: null });
      ctx.contato.optout_whatsapp_em = null;
      return null;
    case 'pausar_automacao': {
      const ate = pausaPorRespostaManual(Math.max(1, Number(a.horas) || 24));
      await mudar(`mkt_wa_conversas?id=eq.${c.id}`, { automacao_pausada_ate: ate });
      c.automacao_pausada_ate = ate;
      return null;
    }
    case 'avisar_humano': {
      // Passa pra uma pessoa: pausa o robô, marca a conversa e avisa no sininho do QS.
      const ate = pausaPorRespostaManual(Math.max(1, Number(a.horas) || 24));
      await mudar(`mkt_wa_conversas?id=eq.${c.id}`, { automacao_pausada_ate: ate, precisa_humano_em: agoraIso() });
      c.automacao_pausada_ate = ate;
      const p = pessoaDe(ctx);
      const texto = `${personalizar(a.mensagem || 'Um contato pediu atendimento.', p)} · ${p.nome || '+' + c.wa_id} · fluxo "${fluxo.nome}"`;
      for (const uid of (Array.isArray(a.usuarios) ? a.usuarios : []).slice(0, 10)) {
        await quieto(rest('qs_avisos?on_conflict=user_id,chave', {
          method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
          body: {
            user_id: uid, tipo: 'mkt_humano', area: null, titulo: 'Marketing: conversa pede atendimento', texto: texto.slice(0, 300),
            link: `#mkt/conversas?c=${c.id}`, origem: 'mkt_automacao', origem_id: c.id, chave: `mkt-humano:${c.id}:${agoraIso().slice(0, 13)}`,
          },
        }));
      }
      return null;
    }
    case 'parar_outros_fluxos':
      await mudar(`mkt_fluxo_execucoes?conversa_id=eq.${c.id}&id=neq.${exec.id}&estado=in.(rodando,aguardando_resposta,aguardando_tempo)`,
        { estado: 'cancelada', acordar_em: null, concluida_em: agoraIso(), erro: 'Parado por outro fluxo.' });
      return null;
    case 'webhook': {
      if (!/^https:\/\//i.test(String(a.url || ''))) return 'webhook precisa de https';
      const p = pessoaDe(ctx);
      try {
        const r = await fetch(a.url, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000),
          body: JSON.stringify({ evento: 'qs.mkt.fluxo', fluxo: { id: fluxo.id, nome: fluxo.nome }, contato: { id: ctx.contato?.id ?? null, nome: p.nome, telefone: c.wa_id, email: p.email, tags: p.tags, campos: p.campos }, quando: agoraIso() }),
        });
        return r.ok ? null : `webhook respondeu ${r.status}`;
      } catch { return 'webhook não respondeu'; }
    }
    default:
      return `ação desconhecida: ${a?.tipo}`;
  }
}

/** "Tag adicionada" como gatilho: outra automação pode começar por causa da tag. */
async function dispararPorTag(ctx, tag) {
  if (ctx.profundidade >= MAX_PROFUNDIDADE) return;
  const gs = await gatilhosAtivos(['tag_adicionada']);
  for (const g of gs) {
    if (String(g.config?.tag ?? '').trim().toLowerCase() !== tag.toLowerCase()) continue;
    await iniciarNoContexto({ ...ctx, profundidade: ctx.profundidade + 1 }, g.fluxo_id, g.id);
  }
}

// ── Andar pelo grafo ────────────────────────────────────────────────────────

async function avancar(ctx, exec, noId) {
  const fluxo = await carregarFluxo(ctx, exec.fluxo_id);
  if (!fluxo) return concluir(exec, 'erro', 'O fluxo foi apagado.');
  let atual = noId;
  for (let passo = 0; passo < MAX_PASSOS_RODADA; passo++) {
    if (!atual) return concluir(exec, 'concluida');
    if (exec.passos >= MAX_PASSOS_TOTAL) return concluir(exec, 'erro', `O fluxo passou de ${MAX_PASSOS_TOTAL} passos — provável laço sem fim.`);
    if (descadastrado(ctx)) return concluir(exec, 'cancelada', 'O contato pediu para sair.');
    if (pausada(ctx)) return concluir(exec, 'cancelada', 'Robô pausado para atendimento humano.');
    const no = fluxo.grafo.nos.find((n) => n.id === atual);
    if (!no) return concluir(exec, 'concluida');
    exec.passos += 1;
    exec.no_atual = no.id;
    await evento(fluxo.id, exec.id, no.id, 'entrou');

    const r = await executarNo(ctx, fluxo, exec, no);
    if (r.tipo === 'encerrada') return;
    if (r.tipo === 'esperar') {
      await quieto(atualizarExecucao(exec.id, { no_atual: no.id, estado: r.estado, acordar_em: r.acordarEm, aguardando: r.aguardando, passos: exec.passos, travada_ate: null }));
      return;
    }
    if (r.tipo === 'fim') {
      await quieto(atualizarExecucao(exec.id, { passos: exec.passos, no_atual: no.id }));
      return concluir(exec, r.erro ? 'erro' : 'concluida', r.erro || null);
    }
    await evento(fluxo.id, exec.id, no.id, 'saida', r.saida);
    atual = proximoNo(fluxo.grafo, no.id, r.saida);
  }
  // Teto da rodada: segue no próximo minuto, sem perder o lugar.
  await quieto(atualizarExecucao(exec.id, { no_atual: atual, estado: 'aguardando_tempo', acordar_em: agoraIso(), aguardando: { tipo: 'continuar' }, passos: exec.passos, travada_ate: null }));
}

async function executarNo(ctx, fluxo, exec, no) {
  const janela = janelaAberta(ctx.conversa.ultima_entrada_em);
  const plano = planoDoNo(no, fluxo, { pessoa: pessoaDe(ctx), janela, inscrito: !descadastrado(ctx) });
  const origem = { fluxoId: fluxo.id, noId: no.id, tipo: exec.teste ? 'teste' : 'fluxo' };
  if (plano.aviso) await evento(fluxo.id, exec.id, no.id, 'erro', null, plano.aviso);

  if (plano.tipo === 'template') return executarTemplate(ctx, fluxo, exec, no, plano.dados, origem);
  if (plano.tipo === 'ir_para') {
    if (ctx.profundidade >= MAX_PROFUNDIDADE) return { tipo: 'fim', erro: 'Muitos "ir para" encadeados.' };
    await quieto(atualizarExecucao(exec.id, { passos: exec.passos, no_atual: no.id }));
    await concluir(exec, 'concluida');
    await iniciarNoContexto({ ...ctx, profundidade: ctx.profundidade + 1 }, plano.fluxoId, null);
    return { tipo: 'encerrada' };
  }
  if (plano.tipo === 'fim') {
    if (plano.erro) await evento(fluxo.id, exec.id, no.id, 'erro', null, plano.erro);
    return plano;
  }
  if (plano.enviar?.length) {
    for (let i = 0; i < plano.enviar.length; i++) {
      if (i === 0 && no.dados?.digitando && ctx.ultimaEntradaWamid) await digitando(ctx.conversa.phone_number_id, ctx.ultimaEntradaWamid);
      const erro = await mandar(ctx, plano.enviar[i], origem);
      if (erro) {
        await evento(fluxo.id, exec.id, no.id, 'erro', null, erro);
        return { tipo: 'fim', erro };
      }
    }
    await evento(fluxo.id, exec.id, no.id, 'enviou');
  }
  for (const a of plano.acoes || []) {
    const erro = await executarAcao(ctx, a, fluxo, exec).catch((e) => String(e?.message || e));
    if (erro) await evento(fluxo.id, exec.id, no.id, 'erro', null, `${a.tipo}: ${erro}`);
  }
  return plano;
}

async function executarTemplate(ctx, fluxo, exec, no, d, origem) {
  const c = ctx.conversa;
  if (!d?.nome) return { tipo: 'fim', erro: 'Bloco Template sem modelo escolhido.' };
  const modelo = await lerModelo(c.phone_number_id, d.nome, d.idioma);
  const t = montarTemplate(d, pessoaDe(ctx), { nVariaveis: modelo?.nVariaveis ?? null });
  // O payload de cada botão de resposta rápida leva o endereço da seta. O índice
  // é a posição do botão NO MODELO (pode ter botão de link no meio).
  const botoesPayload = (d.botoes ?? []).map((texto, i) => ({
    indice: (modelo?.botoes || []).findIndex((b) => String(b.type).toUpperCase() === 'QUICK_REPLY' && b.text === texto),
    payload: `${prefixoDeResposta(fluxo.id, no.id)}botao_${i}`,
  })).filter((b) => b.indice >= 0);
  const corpo = corpoDeTemplate(t, botoesPayload);
  const r = await enviarCorpo(c.phone_number_id, c.wa_id, corpo);
  const texto = String(modelo?.corpo || '').replace(/\{\{(\d+)\}\}/g, (_, n) => t.params[n] ?? '') || `[modelo ${d.nome}]`;
  await quieto(rest('mkt_wa_mensagens', {
    method: 'POST', prefer: 'return=minimal',
    body: { conversa_id: c.id, direcao: 'out', tipo: 'template', texto: texto.slice(0, 4000), payload: corpo, wamid: r.wamid || null,
      status: r.erro ? 'falha' : 'enviado', erro: r.erro || null, origem: origem.tipo, fluxo_id: fluxo.id, no_id: no.id },
  }));
  await quieto(mudar(`mkt_wa_conversas?id=eq.${c.id}`, { ultima_mensagem_em: agoraIso(), ultima_previa: texto.slice(0, 200) }));
  if (r.erro) {
    await evento(fluxo.id, exec.id, no.id, 'erro', null, r.erro);
    return saidaLigada(fluxo.grafo, no.id, 'falha') ? { tipo: 'seguir', saida: 'falha' } : { tipo: 'fim', erro: r.erro };
  }
  await evento(fluxo.id, exec.id, no.id, 'enviou');
  const botoesLigados = (d.botoes ?? []).some((_, i) => saidaLigada(fluxo.grafo, no.id, `botao_${i}`));
  if (botoesLigados) return { tipo: 'esperar', estado: 'aguardando_resposta', acordarEm: null, aguardando: { tipo: 'template' } };
  return { tipo: 'seguir', saida: 'proximo' };
}

// ── Retomar quem esperava ───────────────────────────────────────────────────

async function retomarComResposta(ctx, exec, entrada) {
  const fluxo = await carregarFluxo(ctx, exec.fluxo_id);
  const no = fluxo?.grafo.nos.find((n) => n.id === exec.no_atual);
  if (!fluxo || !no) { await concluir(exec, 'cancelada', 'O bloco em espera não existe mais.'); return false; }
  const tipoEspera = String(exec.aguardando?.tipo ?? '');

  if (no.tipo === 'pergunta') {
    const valor = validarResposta(no.dados.tipoResposta, entrada.texto);
    if (valor !== null) {
      if (no.dados.salvarEm && ctx.contato) {
        const antes = pessoaDe(ctx);
        await salvarPessoa(ctx, antes, aplicarAcaoNaPessoa(antes, { tipo: 'definir_campo', chave: no.dados.salvarEm, valor }));
      }
      await evento(fluxo.id, exec.id, no.id, 'saida', 'respondeu');
      await avancar(ctx, exec, proximoNo(fluxo.grafo, no.id, 'respondeu'));
      return true;
    }
    const tentativas = Number(exec.aguardando?.tentativas ?? 0) + 1;
    if (tentativas < Math.max(1, no.dados.tentativas ?? 2)) {
      await mandar(ctx, { type: 'text', text: { body: no.dados.mensagemErro || 'Não entendi. Pode mandar de novo?' } }, { fluxoId: fluxo.id, noId: no.id });
      await quieto(atualizarExecucao(exec.id, { aguardando: { tipo: 'pergunta', tentativas } }));
      return true;
    }
    await evento(fluxo.id, exec.id, no.id, 'saida', 'nao_respondeu');
    await avancar(ctx, exec, proximoNo(fluxo.grafo, no.id, 'nao_respondeu'));
    return true;
  }
  if (tipoEspera === 'botoes' || tipoEspera === 'template') {
    if (saidaLigada(fluxo.grafo, no.id, 'texto_livre')) {
      await evento(fluxo.id, exec.id, no.id, 'saida', 'texto_livre');
      await avancar(ctx, exec, proximoNo(fluxo.grafo, no.id, 'texto_livre'));
      return true;
    }
    // Sem caminho pra texto livre: a espera acaba e a mensagem vai pros gatilhos.
    await concluir(exec, 'concluida');
    return false;
  }
  await concluir(exec, 'cancelada');
  return false;
}

/** Clique num botão de fluxo (`f:<fluxo>:<bloco>:<saída>`): segue aquela seta. */
async function rotearClique(ctx, alvo) {
  const fluxo = await carregarFluxo(ctx, alvo.fluxoId);
  const no = fluxo?.grafo.nos.find((n) => n.id === alvo.noId);
  if (!fluxo || !no) return false;
  // Sugestão de PERGUNTA (_s0) não é saída: é resposta, vai pro retomar normal.
  if (!saidasDoNo(no).some((s) => s.id === alvo.saida)) return false;
  let exec = await um(`mkt_fluxo_execucoes?select=*&conversa_id=eq.${ctx.conversa.id}&fluxo_id=eq.${fluxo.id}&no_atual=eq.${enc(no.id)}&estado=eq.aguardando_resposta&order=iniciada_em.desc&limit=1`).catch(() => null);
  // Botão antigo de fluxo desligado não reabre nada (mas o teste que espera, segue).
  if (!exec && fluxo.status !== 'ativo') return false;
  if (!exec) {
    exec = await inserir('mkt_fluxo_execucoes', { fluxo_id: fluxo.id, conversa_id: ctx.conversa.id, contato_id: ctx.conversa.contato_id, no_atual: no.id, estado: 'rodando' }).catch(() => null);
    if (!exec) return false;
  }
  await evento(fluxo.id, exec.id, no.id, 'saida', alvo.saida);
  await avancar(ctx, exec, proximoNo(fluxo.grafo, no.id, alvo.saida));
  return true;
}

// ── Gatilhos ────────────────────────────────────────────────────────────────

async function gatilhosAtivos(tipos) {
  const r = await rest(`mkt_fluxo_gatilhos?select=*,mkt_fluxos!inner(status)&tipo=in.(${tipos.join(',')})&ativo=eq.true&mkt_fluxos.status=eq.ativo&order=prioridade.desc,criado_em.asc`).catch(() => []);
  return Array.isArray(r) ? r : [];
}

/** Abre uma execução e anda. Quem esperava RESPOSTA nesta conversa perde a vez. */
async function iniciarNoContexto(ctx, fluxoId, gatilhoId, { teste = false } = {}) {
  const fluxo = await carregarFluxo(ctx, fluxoId);
  const inicio = fluxo?.grafo.nos.find((n) => n.tipo === 'inicio');
  if (!inicio) return null;
  await quieto(mudar(`mkt_fluxo_execucoes?conversa_id=eq.${ctx.conversa.id}&estado=eq.aguardando_resposta`,
    { estado: 'cancelada', acordar_em: null, concluida_em: agoraIso(), erro: 'Outro fluxo começou.' }));
  const exec = await inserir('mkt_fluxo_execucoes', {
    fluxo_id: fluxo.id, conversa_id: ctx.conversa.id, contato_id: ctx.conversa.contato_id, gatilho_id: gatilhoId, no_atual: inicio.id, estado: 'rodando', teste,
  }).catch(() => null);
  if (!exec) return null;
  await quieto(rpc('mkt_auto_contar_disparo', { p_gatilho: gatilhoId, p_fluxo: fluxo.id }));
  await registrarEventoContato(ctx, 'fluxo_iniciado', { fluxo_id: fluxo.id, fluxo: fluxo.nome, gatilho_id: gatilhoId, teste });
  await avancar(ctx, exec, inicio.id);
  return exec.id;
}

async function tomarConversa(id) {
  for (let i = 0; i < 4; i++) {
    if ((await rpc('mkt_auto_tomar_conversa', { p_conversa: id, p_segundos: 25 }).catch(() => false)) === true) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

// ── Porta 1: chegou mensagem ────────────────────────────────────────────────

/**
 * A pessoa mandou algo pro número do Marketing. Grava e decide quem responde:
 *   1. clique num botão de fluxo   2. resposta esperada (pergunta/botões)
 *   3. link de referência          4. anúncio click-to-WhatsApp
 *   5. palavra-chave               6. boas-vindas   7. resposta padrão
 * Lança SÓ quando não conseguiu gravar (banco fora) — aí a Meta reenvia.
 */
export async function receberMensagem(phoneId, msg, nomePerfil) {
  const waId = String(msg?.from ?? '').replace(/\D/g, '');
  const res = { duplicada: false, gravada: false, consumida: false, fluxoIniciado: null, motivo: null };
  if (!waId || !msg?.id) return { ...res, motivo: 'sem-remetente' };

  const entrada = lerEntrada(msg);
  const { conversa, nova } = await garantirConversa(phoneId, waId, nomePerfil, true);
  if (!conversa) throw new Error('conversa não criada');
  const quando = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : agoraIso();

  try {
    await rest('mkt_wa_mensagens', {
      method: 'POST', prefer: 'return=minimal',
      body: { conversa_id: conversa.id, direcao: 'in', tipo: entrada.tipo, texto: entrada.texto || entrada.previa, payload: msg, wamid: String(msg.id), origem: 'cliente', criado_em: quando },
    });
  } catch (e) {
    if (e?.status === 409) return { ...res, duplicada: true, motivo: 'wamid-repetido' };
    throw e;
  }
  res.gravada = true;
  if (entrada.tipo === 'reacao') return { ...res, motivo: 'reacao' };

  await rpc('mkt_wa_registrar_entrada', { p_conversa: conversa.id, p_quando: quando, p_previa: entrada.previa });
  conversa.ultima_entrada_em = quando;

  const ctx = await montarContexto(conversa, String(msg.id));
  if (nova) await registrarEventoContato(ctx, 'whatsapp_mkt_primeira', { phone_number_id: phoneId, anuncio: entrada.anuncioId, ctwa_clid: entrada.ctwaClid });

  // "PARAR" vale a partir de agora: cancela tudo e não responde.
  if (entrada.texto && ehPedidoDeParada(entrada.texto) && ctx.contato && !ctx.contato.optout_whatsapp_em) {
    await quieto(mudar(`mkt_contatos?id=eq.${ctx.contato.id}`, { optout_whatsapp_em: agoraIso() }));
    await quieto(mudar(`mkt_fluxo_execucoes?conversa_id=eq.${conversa.id}&estado=in.(rodando,aguardando_resposta,aguardando_tempo)`,
      { estado: 'cancelada', acordar_em: null, concluida_em: agoraIso(), erro: 'O contato pediu para sair.' }));
    await registrarEventoContato(ctx, 'optout_whatsapp', { texto: entrada.texto.slice(0, 120), origem: 'whatsapp_mkt' });
    return { ...res, motivo: 'optout' };
  }
  if (descadastrado(ctx)) return { ...res, motivo: 'descadastrado' };
  if (pausada(ctx)) return { ...res, motivo: 'robo-pausado' };
  if (!(await configRobo()).ligado) return { ...res, motivo: 'robo-desligado' };
  if (!(await tomarConversa(conversa.id))) return { ...res, motivo: 'conversa-ocupada' };

  try {
    const alvo = lerIdDeResposta(entrada.idResposta);
    if (alvo && (await rotearClique(ctx, alvo))) return { ...res, consumida: true, motivo: 'clique' };

    const esperando = await um(`mkt_fluxo_execucoes?select=*&conversa_id=eq.${conversa.id}&estado=eq.aguardando_resposta&order=atualizada_em.desc&limit=1`).catch(() => null);
    if (esperando && (await retomarComResposta(ctx, esperando, entrada))) return { ...res, consumida: true, motivo: 'resposta-esperada' };

    const gatilhos = await gatilhosAtivos(['link_ref', 'anuncio', 'palavra_chave', 'boas_vindas', 'padrao']);
    const g = escolherGatilho(gatilhos, entrada, { nova, respostaPadraoEm: conversa.resposta_padrao_em });
    if (g) {
      if (g.tipo === 'padrao') await quieto(mudar(`mkt_wa_conversas?id=eq.${conversa.id}`, { resposta_padrao_em: agoraIso() }));
      res.fluxoIniciado = await iniciarNoContexto(ctx, g.fluxo_id, g.id);
      return { ...res, motivo: `gatilho:${g.tipo}` };
    }
    return { ...res, motivo: 'nenhum-gatilho' };
  } catch (e) {
    console.error('[mkt-motor] falhou ao tratar mensagem:', e?.message);
    return { ...res, motivo: 'erro' };
  } finally {
    await quieto(rpc('mkt_auto_soltar_conversa', { p_conversa: conversa.id }));
  }
}

// ── Porta 2: o cron ─────────────────────────────────────────────────────────

/** Acorda quem chegou a hora: fim de "Aguardar", prazo de resposta, teto de passos. */
export async function rodarAutomacoes(prazoMs) {
  const out = { acordadas: 0, erros: 0, adiadas: 0 };
  if (!(await configRobo()).ligado) return { ...out, desligado: true };
  const execs = await rpc('mkt_auto_reivindicar', { p_limite: 50 }).catch(() => []);
  for (const exec of Array.isArray(execs) ? execs : []) {
    if (Date.now() > prazoMs) { await quieto(atualizarExecucao(exec.id, { travada_ate: null })); continue; }
    try {
      const conversa = await um(`mkt_wa_conversas?select=*&id=eq.${exec.conversa_id}&limit=1`);
      if (!conversa) { await concluir(exec, 'cancelada', 'conversa apagada'); continue; }
      const cr = await credenciaisDaMeta(conversa.phone_number_id).catch(() => null);
      if (!cr) {
        // Número caído: adia 10 min em vez de queimar o passo.
        await quieto(atualizarExecucao(exec.id, { acordar_em: new Date(Date.now() + 600_000).toISOString(), travada_ate: null }));
        out.adiadas++;
        continue;
      }
      await acordar(await montarContexto(conversa), exec);
      out.acordadas++;
    } catch (e) {
      out.erros++;
      console.error('[mkt-motor] cron falhou na execução', exec.id, e?.message);
      await quieto(atualizarExecucao(exec.id, { estado: 'erro', erro: String(e?.message || e).slice(0, 400), travada_ate: null, acordar_em: null }));
    }
  }
  return out;
}

async function acordar(ctx, exec) {
  const fluxo = await carregarFluxo(ctx, exec.fluxo_id);
  if (!fluxo) return concluir(exec, 'erro', 'O fluxo foi apagado.');
  // Fluxo PAUSADO no meio: quem esperava fica parado até reativarem (o teste de rascunho segue).
  if (fluxo.status === 'pausado') {
    await quieto(atualizarExecucao(exec.id, { acordar_em: new Date(Date.now() + 3_600_000).toISOString(), travada_ate: null }));
    return;
  }
  const tipo = String(exec.aguardando?.tipo ?? '');
  const noId = exec.no_atual;
  if (!noId) return concluir(exec, 'concluida');
  if (tipo === 'continuar') return avancar(ctx, exec, noId);
  if (tipo === 'tempo') {
    await evento(fluxo.id, exec.id, noId, 'saida', 'proximo');
    return avancar(ctx, exec, proximoNo(fluxo.grafo, noId, 'proximo'));
  }
  const no = fluxo.grafo.nos.find((n) => n.id === noId);
  const saida = no?.tipo === 'pergunta' ? 'nao_respondeu' : 'sem_resposta';
  if (!saidaLigada(fluxo.grafo, noId, saida)) return concluir(exec, 'concluida');
  await evento(fluxo.id, exec.id, noId, 'saida', saida);
  return avancar(ctx, exec, proximoNo(fluxo.grafo, noId, saida));
}

// ── Porta 3: iniciar de fora ────────────────────────────────────────────────

/**
 * Começa um fluxo para um telefone — pela tela (testar no meu WhatsApp, iniciar
 * na conversa) ou pela LP. Fora da janela de 24 h o fluxo precisa começar por
 * um Template (o motor segue pela saída "janela fechada" das mensagens).
 */
export async function iniciarFluxo({ phoneId, fluxoId, telefone, nome = null, gatilhoId = null, dados = null, teste = false }) {
  const waId = telefoneCanonico(telefone);
  if (waId.length < 12) return { execucaoId: null, erro: 'Telefone inválido.' };
  if (!(await configRobo()).ligado && !teste) return { execucaoId: null, erro: 'O robô do Marketing está desligado.' };
  const { conversa } = await garantirConversa(phoneId, waId, nome);
  if (!conversa) return { execucaoId: null, erro: 'Não consegui abrir a conversa.' };
  const ctx = await montarContexto(conversa);
  if (ctx.contato && dados) {
    const antes = pessoaDe(ctx);
    const depois = { ...antes, tags: [...antes.tags], campos: { ...antes.campos, ...(dados.campos || {}) } };
    if (nome && !ctx.contato.nome) depois.nome = nome;
    if (dados.email && !ctx.contato.email) depois.email = String(dados.email).toLowerCase().trim();
    for (const t of dados.tags || []) if (t && !depois.tags.includes(t)) depois.tags.push(String(t).trim());
    await salvarPessoa(ctx, antes, depois).catch(() => null);
    await recarregarContato(ctx);
  }
  if (descadastrado(ctx)) return { execucaoId: null, erro: 'Este contato pediu para não receber WhatsApp.' };
  const execucaoId = await iniciarNoContexto(ctx, fluxoId, gatilhoId, { teste });
  return execucaoId ? { execucaoId, conversaId: conversa.id } : { execucaoId: null, erro: 'O fluxo não tem bloco Início.' };
}

/** Resposta à mão pela caixa de Conversas. Texto livre só na janela; pausa o robô. */
export async function responderManual({ conversaId, texto = null, modelo = null, autorId, pausarHoras = null }) {
  const conversa = await um(`mkt_wa_conversas?select=*&id=eq.${enc(conversaId)}&limit=1`);
  if (!conversa) return { erro: 'Conversa não encontrada.' };
  const ctx = await montarContexto(conversa);
  let corpo;
  if (modelo?.nome) {
    const m = await lerModelo(conversa.phone_number_id, modelo.nome, modelo.idioma);
    corpo = corpoDeTemplate(montarTemplate({ nome: modelo.nome, idioma: modelo.idioma || 'pt_BR', variaveis: modelo.variaveis || {} }, pessoaDe(ctx), { nVariaveis: m?.nVariaveis ?? null }));
  } else {
    const t = String(texto || '').trim();
    if (!t) return { erro: 'Escreva a mensagem.' };
    if (!janelaAberta(conversa.ultima_entrada_em)) return { erro: 'A janela de 24 h está fechada. Só dá para mandar um modelo aprovado.' };
    corpo = { type: 'text', text: { body: t.slice(0, 4096), preview_url: /https?:\/\//.test(t) } };
  }
  const erro = await mandar(ctx, corpo, { tipo: 'manual', autorId });
  if (erro) return { erro };
  const horas = pausarHoras ?? (await configRobo()).pausa_manual_horas ?? 12;
  const ate = pausaPorRespostaManual(horas);
  await quieto(mudar(`mkt_wa_conversas?id=eq.${conversa.id}`, { automacao_pausada_ate: ate, atendente_id: autorId || null, nao_lidas: 0, precisa_humano_em: null }));
  return { ok: true, pausadoAte: ate };
}

/** O eco do celular (Coexistência): alguém respondeu pelo app — grava e pausa o robô. */
export async function registrarEco(phoneId, m) {
  const waId = String(m?.to ?? '').replace(/\D/g, '');
  if (!waId || !m?.id) return false;
  const { conversa } = await garantirConversa(phoneId, waId, null, true);
  if (!conversa) return false;
  const e = lerEntrada(m);
  try {
    await rest('mkt_wa_mensagens', { method: 'POST', prefer: 'return=minimal', body: { conversa_id: conversa.id, direcao: 'out', tipo: e.tipo, texto: e.texto || e.previa, payload: m, wamid: String(m.id), origem: 'eco', status: 'enviado' } });
  } catch (err) {
    if (err?.status === 409) return false; // o QS mandou e já gravou
    throw err;
  }
  const horas = (await configRobo()).pausa_manual_horas ?? 12;
  await quieto(mudar(`mkt_wa_conversas?id=eq.${conversa.id}`, { automacao_pausada_ate: pausaPorRespostaManual(horas), ultima_mensagem_em: agoraIso(), ultima_previa: (e.texto || e.previa).slice(0, 200) }));
  return true;
}

const STATUS = { sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falha' };
/** Recibo ✓ ✓✓ de uma mensagem que o número do Marketing mandou. */
export async function registrarRecibo(st) {
  const s = STATUS[String(st?.status || '').toLowerCase()];
  if (!s || !st?.id) return false;
  const patch = { status: s };
  if (s === 'falha') patch.erro = String(st.errors?.[0]?.title || st.errors?.[0]?.message || 'falhou na Meta').slice(0, 300);
  // não rebaixa "lido" pra "entregue" quando os recibos chegam fora de ordem
  const filtro = s === 'entregue' ? '&status=in.(enviado)' : s === 'enviado' ? '&status=is.null' : '';
  await rest(`mkt_wa_mensagens?wamid=eq.${enc(String(st.id))}${filtro}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
  return true;
}

// ── O número e os modelos do Marketing ──────────────────────────────────────

/** O número do Marketing (setor 'marketing', o mais recente conectado). */
export async function numeroDoMarketing() {
  const r = await rest('qs_wa_numeros_meta?select=phone_number_id,numero,nome_verificado,status,segredo_id,conectado_em' +
    '&setor=eq.marketing&order=conectado_em.desc.nullslast&limit=1').catch(() => null);
  const n = r?.[0] || null;
  return n ? { ...n, conectado: n.status === 'conectado' && Boolean(n.segredo_id) } : null;
}

/** Modelos APROVADOS da conta do número do Marketing, com os botões de resposta rápida. */
export async function modelosDoMarketing(phoneId) {
  const cr = await credenciaisDaMeta(phoneId).catch(() => null);
  if (!cr?.waba) return { erro: 'O número do Marketing não está conectado (ou sem conta WABA).' };
  try {
    const j = await graph(`/${cr.waba}/message_templates?fields=name,language,status,category,components&limit=200`, { token: cr.token });
    const modelos = (j?.data || []).filter((t) => String(t.status).toUpperCase() === 'APPROVED').map((t) => {
      const comp = t.components || [];
      const corpo = comp.find((c) => c.type === 'BODY')?.text || '';
      const nums = [...corpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      return {
        nome: t.name, idioma: t.language, categoria: t.category, corpo,
        variaveis: nums.length ? Math.max(...nums) : 0,
        cabecalho: comp.find((c) => c.type === 'HEADER')?.format || null,
        botoes: (comp.find((c) => c.type === 'BUTTONS')?.buttons || []).filter((b) => b.type === 'QUICK_REPLY').map((b) => b.text),
      };
    });
    return { modelos };
  } catch (e) {
    return { erro: e?.message || 'A Meta recusou.' };
  }
}
