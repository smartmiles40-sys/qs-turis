// api/_relFluxoMotor.js
// -----------------------------------------------------------------------------
// O MOTOR DOS FLUXOS DO RELACIONAMENTO (0409, 19/11/2026) — "igual ao ManyChat".
//
// Mesmo grafo e mesmas regras puras do motor do Marketing (api/_mktAutoRegras.js:
// planoDoNo, proximoNo, saídas, personalizar, janela de 24 h, simulador), mas
// rodando no NÚMERO DO REL, nos clientes do Rel (rel_clientes) e nas etiquetas
// da 0408 (rel_cliente_etiquetas). Tabelas próprias: rel_fluxos,
// rel_fluxo_disparos, rel_fluxo_execucoes, rel_fluxo_eventos.
//
// Três portas, um caminho só (todas terminam em `avancar`):
//   • rodadaFluxosRel()    ← cron /api/disparos?rel=1: começa os disparos
//                            agendados, acorda quem terminou um "Aguardar" ou o
//                            prazo de resposta — no ritmo e no teto do número
//   • receberNoFluxoRel()  ← webhook do número do Rel (api/_relEntrada.js):
//                            clique num botão do fluxo / resposta esperada
//   • iniciarTesteRel()    ← "Testar no meu WhatsApp" do editor
//
// Regras:
//   1. Nunca lança pra quem chamou: erro vira estado 'erro' + evento.
//   2. Texto livre só com a janela de 24 h aberta (o cliente escreveu). Fora
//      dela, só bloco Template (modelo aprovado) — o fluxo de disparo começa
//      SEMPRE por um Template.
//   3. Mesmas travas do disparo: REL_DISPARO_ENVIO=1 + rel_disparo_simulacao
//      =false. Em simulação o fluxo anda e conta, mas nada sai (o teste do
//      editor sai de verdade se a env estiver ligada).
//   4. Quem pediu pra parar (PARAR / "Parar de receber") sai de tudo.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { graph } from './_meta.js';
import { foneDestino, naJanela } from './_disparo.js';
import { lerConfigRel, prepararModo, contar, inicioDoDiaBRT, BASE_PUBLICA } from './_relDisparoOficial.js';
import { calcularFolga, pausaEntreEnvios, montarComponentes } from './_mktOficialRegras.js';
import { normalizarEtiqueta, linkDoFluxo, lerCliqueFluxo, rastrearLinkDoCorpo, urlSegura } from './_relDisparoRegras.js';
import { ehPedidoDeParada } from './_waOptout.js';
import {
  MAX_PASSOS_RODADA, MAX_PASSOS_TOTAL, MAX_PROFUNDIDADE,
  janelaAberta, lerEntrada, lerIdDeResposta, montarTemplate, normalizarGrafo, personalizar, planoDoNo,
  prefixoDeResposta, previaDoCorpo, proximoNo, saidaLigada, saidasDoNo, validarResposta, variantesTelefone,
  podeSairForaDaJanela, saidaPorTexto, acoesDaSaida, pulouPorTexto,
} from './_mktAutoRegras.js';

const enc = encodeURIComponent;
const agoraIso = () => new Date().toISOString();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const quieto = (p) => Promise.resolve(p).catch((e) => console.warn('[rel-fluxo]', e?.message));
const ATIVOS = '(rodando,aguardando_resposta,aguardando_tempo)';

async function um(path) {
  const r = await rest(path);
  return Array.isArray(r) ? r[0] || null : null;
}
const mudar = (tabelaEFiltro, patch) => rest(tabelaEFiltro, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
const rpc = (nome, body) => rest(`rpc/${nome}`, { method: 'POST', body });
const atualizarExecucao = (id, patch) => mudar(`rel_fluxo_execucoes?id=eq.${id}`, { ...patch, atualizada_em: agoraIso() });

// ── Contexto: quem é a pessoa ───────────────────────────────────────────────

async function lerConversa(phoneId, telefone, conversaId = null) {
  if (conversaId) return um(`rel_wa_conversas?select=id,phone_number_id,telefone,cliente_id,atendente_id,ultima_entrada_em,optout_em&id=eq.${conversaId}&limit=1`).catch(() => null);
  const vars = variantesTelefone(telefone);
  return um(`rel_wa_conversas?select=id,phone_number_id,telefone,cliente_id,atendente_id,ultima_entrada_em,optout_em&phone_number_id=eq.${enc(phoneId)}&telefone=in.(${vars.join(',')})&limit=1`).catch(() => null);
}

async function lerCliente(clienteId, telefone) {
  if (clienteId) {
    const c = await um(`rel_clientes?select=id,nome,optout_em&id=eq.${clienteId}&limit=1`).catch(() => null);
    if (c) return c;
  }
  const d = String(telefone || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  const local = d.startsWith('55') ? d.slice(2) : d;
  const vars = [...new Set([d, local, ...variantesTelefone(d), ...variantesTelefone(local)])].filter(Boolean);
  return um(`rel_clientes?select=id,nome,optout_em&telefone=in.(${vars.join(',')})&mesclado_em_id=is.null&limit=1`).catch(() => null);
}

async function lerEtiquetas(clienteId) {
  if (!clienteId) return [];
  const r = await rest(`rel_cliente_etiquetas?select=etiqueta&cliente_id=eq.${clienteId}`).catch(() => []);
  return (r || []).map((x) => x.etiqueta);
}

async function destinoDaViagem(viagemId) {
  if (!viagemId) return null;
  const v = await um(`rel_viagens?select=destino,titulo&id=eq.${viagemId}&limit=1`).catch(() => null);
  return v?.destino || v?.titulo || null;
}

/**
 * ctx = { phoneId, telefone, conversa, cliente, tags, destino, modo, cr,
 *         fluxos, profundidade, modelosEnviados, pausa }
 */
async function montarContexto({ phoneId, telefone, conversaId = null, clienteId = null, nome = null, viagemId = null, modo, cr, pausa = 0 }) {
  const conversa = await lerConversa(phoneId, telefone, conversaId);
  const cliente = await lerCliente(clienteId || conversa?.cliente_id || null, telefone);
  return {
    phoneId, telefone: foneDestino(telefone) || String(telefone), conversa, cliente,
    nome: cliente?.nome || nome || null,
    tags: await lerEtiquetas(cliente?.id), destino: await destinoDaViagem(viagemId),
    modo, cr, fluxos: new Map(), profundidade: 0, modelosEnviados: 0, pausa,
  };
}

function pessoaDe(ctx) {
  return { nome: ctx.nome, email: null, telefone: ctx.telefone, tags: ctx.tags, campos: { destino: ctx.destino || '' } };
}
const descadastrado = (ctx) => Boolean(ctx.cliente?.optout_em || ctx.conversa?.optout_em);
const janelaDe = (ctx) => janelaAberta(ctx.conversa?.ultima_entrada_em);

// ── Registro ────────────────────────────────────────────────────────────────

async function carregarFluxo(ctx, id) {
  if (ctx.fluxos.has(id)) return ctx.fluxos.get(id);
  const f = await um(`rel_fluxos?select=*&id=eq.${enc(id)}&limit=1`).catch(() => null);
  if (!f) return null;
  f.grafo = normalizarGrafo(f.grafo);
  ctx.fluxos.set(id, f);
  return f;
}

async function evento(ctx, fluxoId, execId, noId, tipo, saida = null, detalhe = null, wamid = null) {
  await quieto(rest('rel_fluxo_eventos', {
    method: 'POST', prefer: 'return=minimal',
    // 0414: wamid = a mensagem que saiu (o recibo da Meta dá entregue/lida no funil).
    body: { fluxo_id: fluxoId, execucao_id: execId, no_id: noId, tipo, saida, detalhe: detalhe ? String(detalhe).slice(0, 500) : null, simulado: ctx.modo === 'simulacao', ...(wamid ? { wamid } : {}) },
  }));
}

async function concluir(exec, estado, erro = null) {
  await quieto(atualizarExecucao(exec.id, { estado, acordar_em: null, aguardando: null, travada_ate: null, erro, concluida_em: agoraIso() }));
  if (estado === 'concluida') await quieto(rpc('rel_fluxo_contar', { p_fluxo: exec.fluxo_id, p_concluiu: true }));
}

// ── Meta: mandar ────────────────────────────────────────────────────────────

async function postar(ctx, corpo) {
  try {
    const j = await graph(`/${ctx.cr.phoneId}/messages`, {
      method: 'POST', token: ctx.cr.token, timeoutMs: 20_000,
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: ctx.telefone, ...corpo },
    });
    return { wamid: j?.messages?.[0]?.id || null };
  } catch (e) {
    if (e?.metaCode === 131047) return { erro: 'Janela de 24 h fechada (a Meta recusou o texto livre).' };
    return { erro: e?.message || 'A Meta recusou.', codigo: e?.metaCode };
  }
}

/** A bolha na conversa do Atendimento — e a conversa passa a existir (1º modelo). */
async function bolha(ctx, wamid, texto, fluxo) {
  const { gravarRel } = await import('./_relEntrada.js');
  const r = await gravarRel({
    phoneId: ctx.phoneId, telefone: ctx.telefone, wamid, direcao: 'out', origem: 'automatica',
    texto, autorNome: `Fluxo: ${String(fluxo?.nome || '').slice(0, 60)}`, status: 'sent',
  }).catch(() => null);
  if (r?.conversa && !ctx.conversa) ctx.conversa = await lerConversa(ctx.phoneId, ctx.telefone, r.conversa);
}

/** Manda um corpo (texto/mídia/interativa). Devolve a frase do erro ou null. */
async function mandar(ctx, corpo, fluxo) {
  if (!podeSairForaDaJanela(corpo) && !janelaDe(ctx)) return 'Janela de 24 h fechada: só modelo (template) pode sair.';
  if (ctx.modo === 'simulacao') return null;
  const r = await postar(ctx, corpo);
  if (r.erro || !r.wamid) return r.erro || 'a Meta não devolveu o id da mensagem';
  ctx.ultimoWamid = r.wamid;
  await bolha(ctx, r.wamid, previaDoCorpo(corpo).slice(0, 4000), fluxo);
  return null;
}

async function lerModeloRel(nome, idioma) {
  return um(`rel_wa_modelos?select=*&nome=eq.${enc(nome)}&idioma=eq.${enc(idioma || 'pt_BR')}&limit=1`).catch(() => null);
}

const varsDoCorpo = (corpo) => {
  const nums = [...String(corpo || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
};

async function executarTemplate(ctx, fluxo, exec, no, d) {
  if (!d?.nome) return { tipo: 'fim', erro: 'Bloco Template sem modelo escolhido.' };
  const modelo = await lerModeloRel(d.nome, d.idioma);
  if (ctx.modo === 'real' && modelo?.status !== 'APPROVED') {
    const erro = modelo ? `O modelo "${d.nome}" está ${modelo.status || 'sem status'} na Meta — só APROVADO sai.` : `O modelo "${d.nome}" não está no número do Relacionamento (Sincronizar modelos).`;
    await evento(ctx, fluxo.id, exec.id, no.id, 'erro', null, erro);
    return saidaLigada(fluxo.grafo, no.id, 'falha') ? { tipo: 'seguir', saida: 'falha' } : { tipo: 'fim', erro };
  }
  const t = montarTemplate(d, pessoaDe(ctx), { nVariaveis: modelo ? varsDoCorpo(modelo.corpo) : null });
  const texto = String(modelo?.corpo || '').replace(/\{\{(\d+)\}\}/g, (_, n) => t.params[n] ?? '') || `[modelo ${d.nome}]`;

  let erro = null;
  let wamid = null;
  if (ctx.modo === 'real') {
    const comp = montarComponentes({ modelo, corpo: t.params, midia: t.cabecalhoUrl ? { link: t.cabecalhoUrl } : null });
    if (comp.erro) erro = comp.erro;
    else {
      // Cada botão de resposta rápida leva o endereço da seta (o índice é a posição NO MODELO).
      const qr = (modelo.botoes || []).filter((b) => String(b.tipo).toUpperCase() === 'QUICK_REPLY');
      (d.botoes ?? []).forEach((textoBotao, i) => {
        const b = qr.find((x) => x.texto === textoBotao);
        if (b) comp.components.push({ type: 'button', sub_type: 'quick_reply', index: String(b.indice), parameters: [{ type: 'payload', payload: `${prefixoDeResposta(fluxo.id, no.id)}botao_${i}` }] });
      });
      const r = await postar(ctx, { type: 'template', template: { name: modelo.nome, language: { code: modelo.idioma || 'pt_BR' }, components: comp.components } });
      if (r.erro || !r.wamid) {
        erro = r.erro || 'a Meta não devolveu o id da mensagem';
        if (r.codigo === 131050 && ctx.cliente?.id) {
          await quieto(mudar(`rel_clientes?id=eq.${ctx.cliente.id}&optout_em=is.null`, { optout_em: agoraIso() }));
        }
      } else {
        wamid = r.wamid;
        await bolha(ctx, r.wamid, texto.slice(0, 4000), fluxo);
      }
    }
  }
  if (erro) {
    await evento(ctx, fluxo.id, exec.id, no.id, 'erro', null, erro);
    return saidaLigada(fluxo.grafo, no.id, 'falha') ? { tipo: 'seguir', saida: 'falha' } : { tipo: 'fim', erro };
  }
  ctx.modelosEnviados++;
  await evento(ctx, fluxo.id, exec.id, no.id, 'enviou_modelo', null, ctx.modo === 'simulacao' ? 'simulação' : null, wamid);
  await evento(ctx, fluxo.id, exec.id, no.id, 'enviou');
  if (ctx.pausa) await dormir(ctx.pausa);
  return esperaDoTemplate(fluxo, no, d);
}

/** Depois do template: espera o clique (com prazo "não respondeu", se tiver) ou segue. */
export function esperaDoTemplate(fluxo, no, d, agora = Date.now()) {
  const botoesLigados = (d.botoes ?? []).some((_, i) => saidaLigada(fluxo.grafo, no.id, `botao_${i}`));
  const min = Number(d.esperarMinutos ?? 0);
  const prazo = min > 0 && (d.botoes ?? []).length > 0 && saidaLigada(fluxo.grafo, no.id, 'sem_resposta');
  if (botoesLigados || prazo) {
    return { tipo: 'esperar', estado: 'aguardando_resposta', acordarEm: prazo ? new Date(agora + min * 60_000).toISOString() : null, aguardando: { tipo: 'template' } };
  }
  return { tipo: 'seguir', saida: 'proximo' };
}

// ── Ações (o que existe no Relacionamento) ──────────────────────────────────

async function avisarEquipe(ctx, a, fluxo, exec) {
  let quem = Array.isArray(a.usuarios) ? a.usuarios.filter(Boolean) : [];
  if (!quem.length && ctx.conversa?.atendente_id) quem = [ctx.conversa.atendente_id];
  if (!quem.length) {
    const g = (await rest('qs_users?select=id&is_active=eq.true&role=eq.gestor&setores=cs.{relacionamento}').catch(() => [])) || [];
    quem = g.map((x) => x.id);
  }
  const p = pessoaDe(ctx);
  for (const id of quem) {
    await quieto(rest('qs_avisos?on_conflict=user_id,chave', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: {
        user_id: id, tipo: 'tarefa', area: 'relacionamento',
        titulo: `${String(p.nome || 'Cliente').split(/\s+/)[0]} — fluxo "${fluxo.nome}"`.slice(0, 200),
        texto: (personalizar(a.mensagem || '', p) || 'Precisa de atendimento. Responda pelo WhatsApp do Relacionamento.').slice(0, 400),
        link: '#rel/whatsapp', origem: 'rel_fluxo', origem_id: exec.id, chave: `rel-fluxo:${exec.id}:${id}`,
      },
    }));
  }
  return null;
}

async function executarAcao(ctx, a, fluxo, exec) {
  switch (a?.tipo) {
    case 'adicionar_tag': case 'remover_tag': {
      if (!ctx.cliente?.id) return 'sem ficha de cliente no QS (etiqueta não gravada)';
      const tag = normalizarEtiqueta(personalizar(a.tag, pessoaDe(ctx)));
      if (!tag) return 'etiqueta vazia';
      if (ctx.modo === 'simulacao' && !exec.teste) {
        // Simulação: não mexe na ficha de verdade, só na memória (as condições seguintes enxergam).
      } else if (a.tipo === 'adicionar_tag') {
        await rest('rel_cliente_etiquetas?on_conflict=cliente_id,etiqueta', {
          method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: { cliente_id: ctx.cliente.id, etiqueta: tag, origem: 'fluxo' },
        });
      } else {
        await rest(`rel_cliente_etiquetas?cliente_id=eq.${ctx.cliente.id}&etiqueta=eq.${enc(tag)}`, { method: 'DELETE', prefer: 'return=minimal' });
      }
      ctx.tags = a.tipo === 'adicionar_tag' ? [...new Set([...ctx.tags, tag])] : ctx.tags.filter((t) => t !== tag);
      return null;
    }
    case 'descadastrar':
      if (ctx.cliente?.id) await mudar(`rel_clientes?id=eq.${ctx.cliente.id}`, { optout_em: agoraIso() });
      if (ctx.conversa?.id) await mudar(`rel_wa_conversas?id=eq.${ctx.conversa.id}`, { optout_em: agoraIso() });
      if (ctx.cliente) ctx.cliente.optout_em = agoraIso();
      return null;
    case 'reinscrever':
      if (ctx.cliente?.id) await mudar(`rel_clientes?id=eq.${ctx.cliente.id}`, { optout_em: null });
      if (ctx.conversa?.id) await mudar(`rel_wa_conversas?id=eq.${ctx.conversa.id}`, { optout_em: null });
      if (ctx.cliente) ctx.cliente.optout_em = null;
      if (ctx.conversa) ctx.conversa.optout_em = null;
      return null;
    case 'avisar_humano':
      return avisarEquipe(ctx, a, fluxo, exec);
    case 'parar_outros_fluxos':
      await mudar(`rel_fluxo_execucoes?telefone=eq.${enc(ctx.telefone)}&id=neq.${exec.id}&estado=in.${ATIVOS}`,
        { estado: 'cancelada', acordar_em: null, concluida_em: agoraIso(), erro: 'Outro fluxo mandou parar.' });
      return null;
    default:
      return `a ação "${a?.tipo}" não existe no Relacionamento`;
  }
}

// ── Andar pelo grafo ────────────────────────────────────────────────────────

async function executarNo(ctx, fluxo, exec, no) {
  const plano = planoDoNo(no, fluxo, { pessoa: pessoaDe(ctx), janela: janelaDe(ctx), inscrito: !descadastrado(ctx) });
  if (plano.aviso) await evento(ctx, fluxo.id, exec.id, no.id, 'erro', null, plano.aviso);
  if (plano.tipo === 'template') return executarTemplate(ctx, fluxo, exec, no, plano.dados);
  if (plano.tipo === 'ir_para') {
    if (ctx.profundidade >= MAX_PROFUNDIDADE) return { tipo: 'fim', erro: 'Muitos "ir para" encadeados.' };
    await quieto(atualizarExecucao(exec.id, { passos: exec.passos, no_atual: no.id }));
    await concluir(exec, 'concluida');
    ctx.profundidade++;
    await iniciarExecucao(ctx, plano.fluxoId, { teste: exec.teste });
    return { tipo: 'encerrada' };
  }
  if (plano.tipo === 'fim') {
    if (plano.erro) await evento(ctx, fluxo.id, exec.id, no.id, 'erro', null, plano.erro);
    return plano;
  }
  if (plano.enviar?.length) {
    ctx.ultimoWamid = null;
    // 0414: o botão "link" passa pelo QS pra contar o clique.
    const urlLink = no.tipo === 'mensagem' && no.dados?.interacao?.tipo === 'link' ? String(no.dados.interacao.url || '') : '';
    const rastreado = urlLink ? linkDoFluxo(BASE_PUBLICA(), exec.id, no.id) : '';
    for (const corpoOriginal of plano.enviar) {
      const corpo = rastreado ? rastrearLinkDoCorpo(corpoOriginal, urlLink, rastreado) : corpoOriginal;
      const erro = await mandar(ctx, corpo, fluxo);
      if (erro) {
        await evento(ctx, fluxo.id, exec.id, no.id, 'erro', null, erro);
        return { tipo: 'fim', erro };
      }
    }
    await evento(ctx, fluxo.id, exec.id, no.id, 'enviou', null, null, ctx.ultimoWamid);
  }
  await aplicarAcoes(ctx, fluxo, exec, no, plano.acoes || []);
  return plano;
}

async function aplicarAcoes(ctx, fluxo, exec, no, acoes) {
  for (const a of acoes) {
    const erro = await executarAcao(ctx, a, fluxo, exec).catch((e) => String(e?.message || e));
    if (erro) await evento(ctx, fluxo.id, exec.id, no.id, 'erro', null, `${a.tipo}: ${erro}`);
    else if (a.tipo === 'adicionar_tag') await evento(ctx, fluxo.id, exec.id, no.id, 'acao', null, `tag:${normalizarEtiqueta(personalizar(a.tag, pessoaDe(ctx)))}`);
  }
}

/** Sai do bloco por `saida`: conta, roda as ações do clique (igual ManyChat) e anda. */
async function seguir(ctx, fluxo, exec, no, saida) {
  await evento(ctx, fluxo.id, exec.id, no.id, 'saida', saida);
  await aplicarAcoes(ctx, fluxo, exec, no, acoesDaSaida(no, saida));
  await avancar(ctx, exec, proximoNo(fluxo.grafo, no.id, saida));
}

async function avancar(ctx, exec, noId) {
  const fluxo = await carregarFluxo(ctx, exec.fluxo_id);
  if (!fluxo) return concluir(exec, 'erro', 'O fluxo foi apagado.');
  let atual = noId;
  for (let passo = 0; passo < MAX_PASSOS_RODADA; passo++) {
    if (!atual) return concluir(exec, 'concluida');
    if (exec.passos >= MAX_PASSOS_TOTAL) return concluir(exec, 'erro', `O fluxo passou de ${MAX_PASSOS_TOTAL} passos — provável laço sem fim.`);
    if (descadastrado(ctx)) return concluir(exec, 'cancelada', 'O cliente pediu para não receber.');
    const no = fluxo.grafo.nos.find((n) => n.id === atual);
    if (!no) return concluir(exec, 'concluida');
    exec.passos = (exec.passos || 0) + 1;
    exec.no_atual = no.id;
    await evento(ctx, fluxo.id, exec.id, no.id, 'entrou');

    const r = await executarNo(ctx, fluxo, exec, no);
    if (r.tipo === 'encerrada') return;
    if (r.tipo === 'esperar') {
      await quieto(atualizarExecucao(exec.id, {
        no_atual: no.id, estado: r.estado, acordar_em: r.acordarEm, aguardando: r.aguardando, passos: exec.passos, travada_ate: null,
        ...(ctx.conversa?.id ? { conversa_id: ctx.conversa.id } : {}),
      }));
      return;
    }
    if (r.tipo === 'fim') {
      await quieto(atualizarExecucao(exec.id, { passos: exec.passos, no_atual: no.id }));
      return concluir(exec, r.erro ? 'erro' : 'concluida', r.erro || null);
    }
    await evento(ctx, fluxo.id, exec.id, no.id, 'saida', r.saida);
    await aplicarAcoes(ctx, fluxo, exec, no, acoesDaSaida(no, r.saida));
    atual = proximoNo(fluxo.grafo, no.id, r.saida);
  }
  await quieto(atualizarExecucao(exec.id, { no_atual: atual, estado: 'aguardando_tempo', acordar_em: agoraIso(), aguardando: { tipo: 'continuar' }, passos: exec.passos, travada_ate: null }));
}

/** Abre uma execução no Início do fluxo e anda (teste e "ir para"). */
async function iniciarExecucao(ctx, fluxoId, { teste = false } = {}) {
  const fluxo = await carregarFluxo(ctx, fluxoId);
  const inicio = fluxo?.grafo.nos.find((n) => n.tipo === 'inicio');
  if (!inicio) return { erro: 'O fluxo não tem bloco Início.' };
  // Quem esperava resposta noutro fluxo perde a vez (a próxima resposta é deste).
  await quieto(mudar(`rel_fluxo_execucoes?telefone=eq.${enc(ctx.telefone)}&estado=eq.aguardando_resposta`,
    { estado: 'cancelada', acordar_em: null, concluida_em: agoraIso(), erro: 'Outro fluxo começou.' }));
  const exec = (await rest('rel_fluxo_execucoes', {
    method: 'POST', prefer: 'return=representation',
    body: { fluxo_id: fluxo.id, cliente_id: ctx.cliente?.id || null, conversa_id: ctx.conversa?.id || null, telefone: ctx.telefone, nome: ctx.nome, no_atual: inicio.id, estado: 'rodando', teste },
  }))?.[0];
  if (!exec) return { erro: 'Não consegui abrir a execução.' };
  await quieto(rpc('rel_fluxo_contar', { p_fluxo: fluxo.id, p_concluiu: false }));
  await avancar(ctx, exec, inicio.id);
  return { execucaoId: exec.id };
}

// ── Retomar quem esperava ───────────────────────────────────────────────────

async function retomarComResposta(ctx, exec, entrada) {
  const fluxo = await carregarFluxo(ctx, exec.fluxo_id);
  const no = fluxo?.grafo.nos.find((n) => n.id === exec.no_atual);
  if (!fluxo || !no) { await concluir(exec, 'cancelada', 'O bloco em espera não existe mais.'); return false; }
  const tipoEspera = String(exec.aguardando?.tipo ?? '');

  if (no.tipo === 'pergunta') {
    if (pulouPorTexto(no, entrada.texto)) { await seguir(ctx, fluxo, exec, no, 'pulou'); return true; }
    const valor = validarResposta(no.dados.tipoResposta, entrada.texto);
    if (valor !== null) {
      await evento(ctx, fluxo.id, exec.id, no.id, 'acao', null, `resposta:${String(valor).slice(0, 200)}`);
      await seguir(ctx, fluxo, exec, no, 'respondeu');
      return true;
    }
    const tentativas = Number(exec.aguardando?.tentativas ?? 0) + 1;
    if (tentativas < Math.max(1, no.dados.tentativas ?? 2)) {
      await mandar(ctx, { type: 'text', text: { body: no.dados.mensagemErro || 'Não entendi. Pode mandar de novo?' } }, fluxo);
      await quieto(atualizarExecucao(exec.id, { aguardando: { tipo: 'pergunta', tentativas }, travada_ate: null }));
      return true;
    }
    await seguir(ctx, fluxo, exec, no, 'nao_respondeu');
    return true;
  }
  if (tipoEspera === 'botoes' || tipoEspera === 'template') {
    const porTexto = tipoEspera === 'botoes' ? saidaPorTexto(no, entrada.texto) : null;
    if (porTexto) { await seguir(ctx, fluxo, exec, no, porTexto); return true; }
    if (saidaLigada(fluxo.grafo, no.id, 'texto_livre')) { await seguir(ctx, fluxo, exec, no, 'texto_livre'); return true; }
    // Sem caminho pra texto livre: a conversa segue com o atendente; a espera acaba.
    await concluir(exec, 'concluida');
    return false;
  }
  await concluir(exec, 'cancelada');
  return false;
}

/** Clique num botão do fluxo (`f:<fluxo>:<bloco>:<saída>`): segue aquela seta. */
async function rotearClique(ctx, alvo) {
  const fluxo = await carregarFluxo(ctx, alvo.fluxoId);
  const no = fluxo?.grafo.nos.find((n) => n.id === alvo.noId);
  if (!fluxo || !no) return false;
  if (!saidasDoNo(no).some((s) => s.id === alvo.saida)) return false;
  const vars = variantesTelefone(ctx.telefone);
  let exec = await um(`rel_fluxo_execucoes?select=*&telefone=in.(${vars.join(',')})&fluxo_id=eq.${fluxo.id}&no_atual=eq.${enc(no.id)}&estado=eq.aguardando_resposta&order=iniciada_em.desc&limit=1`).catch(() => null);
  if (exec) {
    // Toma a execução (dois cliques ao mesmo tempo não andam duas vezes).
    const tomada = (await rest(`rel_fluxo_execucoes?id=eq.${exec.id}&estado=eq.aguardando_resposta`, {
      method: 'PATCH', prefer: 'return=representation', body: { estado: 'rodando', atualizada_em: agoraIso() },
    }).catch(() => null))?.[0];
    if (!tomada) return true;
    exec = tomada;
  } else {
    // Clique numa mensagem antiga (já tinha seguido em frente): reabre só com fluxo ativo.
    if (fluxo.status !== 'ativo') return false;
    exec = (await rest('rel_fluxo_execucoes', {
      method: 'POST', prefer: 'return=representation',
      body: { fluxo_id: fluxo.id, cliente_id: ctx.cliente?.id || null, conversa_id: ctx.conversa?.id || null, telefone: ctx.telefone, nome: ctx.nome, no_atual: no.id, estado: 'rodando' },
    }).catch(() => null))?.[0];
    if (!exec) return false;
  }
  await seguir(ctx, fluxo, exec, no, alvo.saida);
  return true;
}

// ── Porta 1: chegou mensagem no número do Rel ───────────────────────────────

/** O modo de quem RESPONDE (já há conversa aberta): simulação geral vale também aqui. */
async function modoAtual({ forcarReal = false } = {}) {
  const cfg = await lerConfigRel();
  const m = await prepararModo(forcarReal ? { ...cfg, simulacao: false } : cfg);
  return { cfg, ...m };
}

/**
 * Mensagem NOVA do cliente no número do Rel (api/_relEntrada.js). Se for clique
 * num botão de fluxo ou a resposta que um fluxo esperava, anda o fluxo.
 * Nunca lança.
 */
export async function receberNoFluxoRel({ phoneId, telefone, m, conversaId }) {
  try {
    const entrada = lerEntrada(m);
    if (entrada.tipo === 'reacao') return null;
    const vars = variantesTelefone(String(telefone || '').replace(/\D/g, ''));
    if (!vars.length) return null;

    if (entrada.texto && ehPedidoDeParada(entrada.texto)) {
      await quieto(mudar(`rel_fluxo_execucoes?telefone=in.(${vars.join(',')})&estado=in.${ATIVOS}`,
        { estado: 'cancelada', acordar_em: null, concluida_em: agoraIso(), erro: 'O cliente pediu para não receber.' }));
      return { motivo: 'optout' };
    }
    // Clique que não é saída (sugestão de pergunta `_s0`) vale como resposta digitada.
    const lido = lerIdDeResposta(entrada.idResposta);
    const alvoFluxo = lido ? await um(`rel_fluxos?select=grafo&id=eq.${enc(lido.fluxoId)}&limit=1`).catch(() => null) : null;
    const noAlvo = alvoFluxo ? normalizarGrafo(alvoFluxo.grafo).nos.find((n) => n.id === lido.noId) : null;
    const alvo = lido && noAlvo && saidasDoNo(noAlvo).some((s) => s.id === lido.saida) ? lido : null;
    const esperando = alvo ? null : await um(`rel_fluxo_execucoes?select=*&telefone=in.(${vars.join(',')})&estado=eq.aguardando_resposta&order=atualizada_em.desc&limit=1`).catch(() => null);
    if (!alvo && !esperando) return null;
    // 23/11: no CLIQUE de botão a execução que espera também decide o modo — antes
    // só a resposta digitada olhava `teste`, e o clique de um teste caía na
    // simulação geral (a 2ª mensagem "andava" no fluxo mas não saía).
    const doClique = alvo ? await um(`rel_fluxo_execucoes?select=*&telefone=in.(${vars.join(',')})&fluxo_id=eq.${enc(alvo.fluxoId)}&no_atual=eq.${enc(alvo.noId)}&estado=eq.aguardando_resposta&order=iniciada_em.desc&limit=1`).catch(() => null) : null;
    const base = esperando || doClique;

    // Teste do editor sai de verdade (env ligada); o resto segue a simulação geral.
    const forcarReal = Boolean(base?.teste);
    const md = await modoAtual({ forcarReal });
    if (md.parado) return { motivo: md.parado };
    const ctx = await montarContexto({ phoneId, telefone, conversaId, clienteId: base?.cliente_id, nome: base?.nome, viagemId: base?.viagem_id, modo: md.modo, cr: md.cr });

    if (alvo) return (await rotearClique(ctx, alvo)) ? { motivo: 'clique' } : null;
    const tomada = (await rest(`rel_fluxo_execucoes?id=eq.${esperando.id}&estado=eq.aguardando_resposta`, {
      method: 'PATCH', prefer: 'return=representation', body: { estado: 'rodando', atualizada_em: agoraIso() },
    }).catch(() => null))?.[0];
    if (!tomada) return null;
    return (await retomarComResposta(ctx, { ...tomada, aguardando: esperando.aguardando }, entrada)) ? { motivo: 'resposta' } : null;
  } catch (e) {
    console.warn('[rel-fluxo] mensagem não tratada:', e?.message);
    return null;
  }
}

// ── Porta 2: o cron ─────────────────────────────────────────────────────────

/** Disparos agendados que chegou a hora: cada cliente do público vira uma execução. */
async function comecarDisparos(agora) {
  const prontos = (await rest(`rel_fluxo_disparos?select=*&status=eq.agendado&agendado_para=lte.${enc(agora.toISOString())}&order=agendado_para.asc&limit=5`).catch(() => [])) || [];
  const out = [];
  for (const d of prontos) {
    const pegou = (await rest(`rel_fluxo_disparos?id=eq.${d.id}&status=eq.agendado`, { method: 'PATCH', prefer: 'return=representation', body: { status: 'rodando', iniciado_em: agoraIso() } }).catch(() => null))?.[0];
    if (!pegou) continue;
    const fluxo = await um(`rel_fluxos?select=id,nome,status,grafo&id=eq.${d.fluxo_id}&limit=1`).catch(() => null);
    const inicio = normalizarGrafo(fluxo?.grafo).nos.find((n) => n.tipo === 'inicio');
    if (!fluxo || !inicio) {
      await quieto(mudar(`rel_fluxo_disparos?id=eq.${d.id}`, { status: 'cancelado', concluido_em: agoraIso(), excluidos: [{ motivo: 'fluxo apagado ou sem Início', n: 0 }] }));
      continue;
    }
    const linhas = (await rest('rpc/qs_disparo_publico_rel', { method: 'POST', body: { p_publico: d.publico || {} }, timeoutMs: 25_000 }).catch(() => [])) || [];
    let optout = 0; let invalido = 0;
    const vistos = new Set();
    const execs = [];
    for (const l of linhas) {
      if (l.optout) { optout++; continue; }
      const tel = foneDestino(l.telefone);
      if (!tel) { invalido++; continue; }
      if (vistos.has(tel)) continue;
      vistos.add(tel);
      execs.push({
        fluxo_id: fluxo.id, disparo_id: d.id, cliente_id: l.cliente_id || null, telefone: tel, nome: l.nome || null, viagem_id: l.viagem_id || null,
        no_atual: inicio.id, estado: 'aguardando_tempo', acordar_em: agora.toISOString(), aguardando: { tipo: 'continuar' },
      });
    }
    for (let i = 0; i < execs.length; i += 500) {
      await quieto(rest('rel_fluxo_execucoes?on_conflict=disparo_id,telefone', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: execs.slice(i, i + 500) }));
    }
    const excluidos = [optout && { motivo: 'pediu para não receber', n: optout }, invalido && { motivo: 'telefone inválido', n: invalido }].filter(Boolean);
    await quieto(mudar(`rel_fluxo_disparos?id=eq.${d.id}`, { total: execs.length, excluidos }));
    if (execs.length) {
      const f = await um(`rel_fluxos?select=execucoes_total&id=eq.${fluxo.id}&limit=1`).catch(() => null);
      await quieto(mudar(`rel_fluxos?id=eq.${fluxo.id}`, { execucoes_total: (f?.execucoes_total || 0) + execs.length }));
    }
    out.push({ disparo: d.id, total: execs.length });
  }
  return out;
}

/** Disparo "rodando" sem ninguém mais pra começar = concluído (os cliques podem chegar depois). */
async function fecharDisparos() {
  const rodando = (await rest('rel_fluxo_disparos?select=id&status=eq.rodando').catch(() => [])) || [];
  for (const d of rodando) {
    const resta = await rest(`rel_fluxo_execucoes?select=id&disparo_id=eq.${d.id}&estado=in.(rodando,aguardando_tempo)&aguardando->>tipo=eq.continuar&limit=1`).catch(() => [1]);
    if (Array.isArray(resta) && !resta.length) await quieto(mudar(`rel_fluxo_disparos?id=eq.${d.id}&status=eq.rodando`, { status: 'concluido', concluido_em: agoraIso() }));
  }
}

async function acordar(ctx, exec) {
  const fluxo = await carregarFluxo(ctx, exec.fluxo_id);
  if (!fluxo) return concluir(exec, 'erro', 'O fluxo foi apagado.');
  if (fluxo.status === 'pausado') {
    await quieto(atualizarExecucao(exec.id, { acordar_em: new Date(Date.now() + 3_600_000).toISOString(), travada_ate: null }));
    return;
  }
  const tipo = String(exec.aguardando?.tipo ?? '');
  const noId = exec.no_atual;
  if (!noId) return concluir(exec, 'concluida');
  await quieto(atualizarExecucao(exec.id, { estado: 'rodando' }));
  if (tipo === 'continuar') return avancar(ctx, exec, noId);
  if (tipo === 'tempo') {
    await evento(ctx, fluxo.id, exec.id, noId, 'saida', 'proximo');
    return avancar(ctx, exec, proximoNo(fluxo.grafo, noId, 'proximo'));
  }
  const no = fluxo.grafo.nos.find((n) => n.id === noId);
  const saida = no?.tipo === 'pergunta' ? 'nao_respondeu' : 'sem_resposta';
  if (!saidaLigada(fluxo.grafo, noId, saida)) return concluir(exec, 'concluida');
  return seguir(ctx, fluxo, exec, no, saida);
}

/**
 * A rodada dos fluxos do Rel (cron /api/disparos?rel=1, antes da rodada dos
 * disparos simples). Começa disparos, acorda quem chegou a hora. Os MODELOS que
 * saem contam no mesmo teto do dia do número. Nunca lança.
 */
export async function rodadaFluxosRel({ limiteMs = 40_000, agora = new Date() } = {}) {
  const inicio = Date.now();
  try {
    const cfg = await lerConfigRel();
    if (!naJanela(cfg.ritmo, agora)) return { parado: 'fora da janela de envio do Relacionamento' };
    const disparos = await comecarDisparos(agora);

    const m0 = await prepararModo(cfg);
    if (m0.parado) return { parado: m0.parado, disparos };
    const { modo, cr, numero, tier } = m0;
    const ph = numero?.phone_number_id || null;
    const sim = modo === 'simulacao';
    const desde24 = new Date(agora.getTime() - 86_400_000);
    const desdeHoje = inicioDoDiaBRT(agora);
    const [d24, dHoje, f24, fHoje] = await Promise.all([
      contar(ph, desde24, sim), contar(ph, desdeHoje, sim),
      rpc('rel_fluxo_contar_modelos', { p_desde: desde24.toISOString(), p_simulado: sim }).catch(() => 0),
      rpc('rel_fluxo_contar_modelos', { p_desde: desdeHoje.toISOString(), p_simulado: sim }).catch(() => 0),
    ]);
    let folga = calcularFolga({
      tier, margem: cfg.ritmo.margem_tier, porDia: cfg.ritmo.por_dia,
      enviados24h: d24 + (Number(f24) || 0), enviadosHoje: dHoje + (Number(fHoje) || 0),
      porSegundo: cfg.ritmo.por_segundo, segundos: limiteMs / 1000,
    });
    const pausa = pausaEntreEnvios(cfg.ritmo.por_segundo);
    const out = { modo, folga, acordadas: 0, erros: 0, devolvidas: 0, disparos };
    if (folga <= 0) { await fecharDisparos(); return { ...out, esperando: 'teto do dia/limite da Meta' }; }

    const execs = (await rpc('rel_fluxo_reivindicar', { p_limite: Math.min(folga, 300) }).catch(() => [])) || [];
    for (const exec of execs) {
      if (folga <= 0 || Date.now() - inicio > limiteMs) {
        await quieto(atualizarExecucao(exec.id, { travada_ate: null }));
        out.devolvidas++;
        continue;
      }
      try {
        const ctx = await montarContexto({
          phoneId: ph, telefone: exec.telefone, conversaId: exec.conversa_id, clienteId: exec.cliente_id, nome: exec.nome, viagemId: exec.viagem_id,
          modo: exec.teste ? 'real' : modo, cr, pausa,
        });
        if (exec.teste && modo !== 'real') {
          await concluir(exec, 'cancelada', 'teste: envio real desligado');
          continue;
        }
        await acordar(ctx, exec);
        folga -= ctx.modelosEnviados;
        out.acordadas++;
      } catch (e) {
        out.erros++;
        await quieto(atualizarExecucao(exec.id, { estado: 'erro', erro: String(e?.message || e).slice(0, 400), travada_ate: null, acordar_em: null }));
      }
    }
    await fecharDisparos();
    return { ...out, folgaRestante: folga };
  } catch (e) {
    console.error('[rel-fluxo] rodada falhou:', e?.message);
    return { erro: e?.message };
  }
}

// ── Porta 3: tela ───────────────────────────────────────────────────────────

/** "Testar no meu WhatsApp": roda o fluxo DE VERDADE pra um número (precisa da env). */
export async function iniciarTesteRel({ fluxoId, telefone, nome }) {
  const tel = foneDestino(telefone);
  if (!tel) return { erro: 'Telefone inválido. Use DDD + número.' };
  const md = await modoAtual({ forcarReal: true });
  if (md.parado) return { erro: `O teste manda de verdade e o envio está travado: ${md.parado}` };
  const ctx = await montarContexto({ phoneId: md.numero?.phone_number_id, telefone: tel, nome, modo: 'real', cr: md.cr });
  return iniciarExecucao(ctx, fluxoId, { teste: true });
}

/** "Disparar este fluxo": agenda (ou começa no próximo minuto) pra um público. */
export async function agendarDisparoFluxo({ fluxoId, publico, agendadoPara = null, userId }) {
  const fluxo = await um(`rel_fluxos?select=id,status,grafo&id=eq.${enc(fluxoId)}&limit=1`).catch(() => null);
  if (!fluxo) return { erro: 'Fluxo não encontrado.' };
  const g = normalizarGrafo(fluxo.grafo);
  const inicio = g.nos.find((n) => n.tipo === 'inicio');
  const primeiro = inicio ? g.nos.find((n) => n.id === proximoNo(g, inicio.id, 'proximo')) : null;
  if (!primeiro) return { erro: 'Ligue o bloco Início ao primeiro bloco antes de disparar.' };
  if (primeiro.tipo !== 'template') return { erro: 'Disparo pra quem não falou com a gente precisa começar por um bloco Template (modelo aprovado pela Meta). Ligue o Início a um Template.' };
  if (fluxo.status !== 'ativo') return { erro: 'Ative o fluxo antes de disparar (botão "Ativar" no editor).' };
  const quando = agendadoPara ? new Date(agendadoPara) : new Date();
  if (Number.isNaN(quando.getTime())) return { erro: 'Data inválida.' };
  const d = (await rest('rel_fluxo_disparos', {
    method: 'POST', prefer: 'return=representation',
    body: { fluxo_id: fluxo.id, publico: publico && typeof publico === 'object' ? publico : {}, agendado_para: quando.toISOString(), criado_por: userId || null },
  }))?.[0];
  return { disparo: d };
}

export async function cancelarDisparoFluxo(disparoId) {
  await mudar(`rel_fluxo_disparos?id=eq.${enc(disparoId)}&status=in.(agendado,rodando)`, { status: 'cancelado', concluido_em: agoraIso() });
  await mudar(`rel_fluxo_execucoes?disparo_id=eq.${enc(disparoId)}&estado=in.${ATIVOS}`, { estado: 'cancelada', acordar_em: null, concluida_em: agoraIso(), erro: 'Disparo cancelado.' });
  return { ok: true };
}

/** Os modelos do Rel no formato do editor de fluxos (ModeloMkt). */
export async function modelosParaFluxo() {
  const r = (await rest('rel_wa_modelos?select=*&order=nome.asc').catch(() => [])) || [];
  const modelos = r.filter((m) => m.status === 'APPROVED').map((m) => ({
    nome: m.nome, idioma: m.idioma || 'pt_BR', categoria: m.categoria || 'MARKETING', corpo: m.corpo || '',
    variaveis: varsDoCorpo(m.corpo), cabecalho: m.cabecalho_formato && m.cabecalho_formato !== 'TEXT' ? m.cabecalho_formato : (m.cabecalho_texto || null),
    botoes: (m.botoes || []).filter((b) => String(b.tipo).toUpperCase() === 'QUICK_REPLY').map((b) => b.texto),
  }));
  return { modelos, ...(modelos.length ? {} : { aviso: 'Nenhum modelo APROVADO no número do Relacionamento. Aprove na Meta e clique em "Sincronizar modelos" (Disparos › Número e ritmo).' }) };
}

// ── 0414: clique no link de um bloco Mensagem (/l/f/<execução>/<bloco>) ─────

/** Registra o 1º clique daquela pessoa naquele bloco e devolve o destino (ou null). */
export async function registrarCliqueFluxo(execId, noId) {
  const ok = lerCliqueFluxo(execId, noId);
  if (!ok) return null;
  const exec = await um(`rel_fluxo_execucoes?select=id,fluxo_id,teste&id=eq.${ok.execId}&limit=1`).catch(() => null);
  if (!exec) return null;
  const fluxo = await um(`rel_fluxos?select=grafo&id=eq.${exec.fluxo_id}&limit=1`).catch(() => null);
  const no = fluxo ? normalizarGrafo(fluxo.grafo).nos.find((n) => n.id === ok.noId) : null;
  const destino = no?.tipo === 'mensagem' && no.dados?.interacao?.tipo === 'link' ? String(no.dados.interacao.url || '').trim() : '';
  if (!urlSegura(destino)) return null;
  const ja = await um(`rel_fluxo_eventos?select=id&execucao_id=eq.${exec.id}&no_id=eq.${enc(ok.noId)}&tipo=eq.clicou_link&limit=1`).catch(() => null);
  if (!ja) {
    await quieto(rest('rel_fluxo_eventos', {
      method: 'POST', prefer: 'return=minimal',
      body: { fluxo_id: exec.fluxo_id, execucao_id: exec.id, no_id: ok.noId, tipo: 'clicou_link', simulado: false },
    }));
  }
  return destino;
}
