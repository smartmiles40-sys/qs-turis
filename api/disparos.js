// api/disparos.js
// -----------------------------------------------------------------------------
// DISPARO EM MASSA (0217, 28/10/2026) — rota única do Comercial e do Rel.
// A regra mora em api/_disparo.js; aqui é só porta, permissão e validação.
//
//   GET  (Vercel Cron, Bearer CRON_SECRET, a cada 5 min) → rodada + conciliar
//   POST { acao: 'config', setor }                 → interruptor, ritmo, modelos, números
//   POST { acao: 'previa', setor, publico }        → quantos recebem, quem sai e por quê
//   POST { acao: 'criar', setor, ... }             → campanha em rascunho
//   POST { acao: 'iniciar' | 'pausar' | 'retomar' | 'cancelar' | 'apagar', campanhaId }
//   POST { acao: 'painel', campanhaId }            → funil + respostas + erros
//   POST { acao: 'salvar_modelo', setor, modelo }  → guarda o modelo e devolve o pacote da Meta
//   POST { acao: 'salvar_ritmo', ritmo }           → teto/janela (só admin)
//
// MARKETING (0242) — setor 'marketing', pelo número NOVO do Marketing:
//   POST { acao: 'agendar', campanhaId, agendada_para } / 'desagendar'
//   POST { acao: 'mkt_salvar_numero' | 'mkt_conferir_numero' }        (admin)
//   POST { acao: 'mkt_recorrencia_salvar' | 'mkt_recorrencia_apagar' }
//   POST { acao: 'mkt_sequencia_salvar' | '_ativar' | '_apagar' | '_inscrever' }
//   POST { acao: 'mkt_inscricao_tirar', id }
//   A regra mora em api/_mktDisparo.js. O cron também acorda as agendadas,
//   as recorrências e as sequências antes da rodada.
//
// MARKETING OFICIAL (0341) — o envio das campanhas do Marketing tem rodada
// e travas PRÓPRIAS (api/_mktDisparoOficial.js):
//   GET  /api/disparos?mkt=1 (Vercel Cron, Bearer CRON_SECRET) → rodadaMkt
//   POST { acao: 'mkt_oficial_estado' | 'mkt_sincronizar_modelos' | 'mkt_kpis' |
//          'mkt_salvar_ritmo_oficial' | 'mkt_salvar_precos' }
//   A rodada do Comercial/Rel (rodada()) não pega mais campanha do Marketing.
//
// RELACIONAMENTO "IGUAL AO MANYCHAT" (0408) — envio oficial pelo número do Rel
// (api/_relDisparoOficial.js):
//   GET  /api/disparos?rel=1 (Vercel Cron) → rodadaRel
//   GET  /l/<envio>/<variável> → /api/disparos?l=…&k=… (público): conta o clique e segue
//   POST { acao: 'rel_oficial_estado' | 'rel_sincronizar_modelos' | 'rel_kpis' |
//          'rel_salvar_ritmo' | 'rel_teste' | 'rel_etiquetar' | 'rel_etiqueta_renomear' | 'rel_etiqueta_apagar' }
//   'agendar'/'desagendar' valem pro Rel também. O clique no botão é api/_relDisparoBotoes.js.
//
// Ler a lista de campanhas e de envios a tela faz direto no banco (RLS 0217).
// Escrever é SÓ aqui (service_role). O interruptor da simulação NÃO tem botão:
// desligar é uma decisão do Bruno, por SQL (ver docs/DISPARO-EM-MASSA.md).
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { getSupabaseUserId } from './_wa.js';
import { validarModelo } from './_meta.js';
import { numeroDoRelacionamento, numeroConectado } from './_relWa.js';
import {
  lerConfig, montarPublico, montarFila, numerosDosSdrs, rodada, conciliar, MOTIVOS, ENVIO_REAL_PLUGADO,
} from './_disparo.js';
import { acaoMarketing, acordarAgendadas, lerNumeroMkt, rodarRecorrencias, rodarSequencias } from './_mktDisparo.js';
import { acaoMktOficial, juntarModelosMkt, rodadaMkt } from './_mktDisparoOficial.js';
import { conferirExtra } from './_mktOficialRegras.js';
import { acaoRelOficial, estadoRel, juntarModelosRel, lerConfigRel, numeroDoDisparo, numerosTesteRel, registrarClique, registrarTeste, rodadaRel } from './_relDisparoOficial.js';
import { conferirRespostas, urlSegura } from './_relDisparoRegras.js';
import { rodadaFluxosRel, iniciarTesteRel, agendarDisparoFluxo, cancelarDisparoFluxo, modelosParaFluxo } from './_relFluxoMotor.js';
import { simularFluxo } from './_mktAutoRegras.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETORES = ['comercial', 'relacionamento', 'marketing'];
const FONTES = ['nome', 'sdr', 'destino', 'link_grupo', 'texto'];
// Marketing (0242): sem SDR; ganha o "campo" livre do contato.
const FONTES_MKT = ['nome', 'destino', 'texto', 'campo'];
// Relacionamento (0408): sem SDR; ganha o "link" rastreado (conta o clique).
const FONTES_REL = ['nome', 'destino', 'link_grupo', 'texto', 'link'];
const fontesDo = (setor) => (setor === 'marketing' ? FONTES_MKT : setor === 'relacionamento' ? FONTES_REL : FONTES);
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
const varsDoCorpo = (corpo) => [...new Set([...String(corpo || '').matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]))];

async function quem(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !UUID.test(id)) return null;
  const u = (await rest(`qs_users?select=id,name,role,setores,is_active,whatsapp_number&id=eq.${id}&limit=1`).catch(() => null))?.[0]
    || (await rest(`qs_users?select=id,name,role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0];
  return u?.is_active ? u : null;
}

/**
 * Pode disparar neste setor? Admin sempre; gestor do setor (gestor sem setor
 * marcado é do Comercial, igual setoresDe() na tela); senão, o cargo (0135).
 */
async function podeDisparar(u, setor) {
  if (u.role === 'admin') return true;
  const s = Array.isArray(u.setores) ? u.setores : [];
  // Marketing (0242): papel marketing, ou gestor com o setor marketing.
  if (setor === 'marketing') return u.role === 'marketing' || s.includes('marketing');
  if (u.role === 'gestor' && (s.includes(setor) || (setor === 'comercial' && s.length === 0))) return true;
  const r = await rest('rpc/qs_pode_de', { method: 'POST', body: { p_user: u.id, p: `${setor}.disparos` } }).catch(() => null);
  return r === true;
}

async function lerCampanha(id) {
  if (!UUID.test(String(id || ''))) return null;
  return (await rest(`qs_disparo_campanhas?select=*&id=eq.${id}&limit=1`).catch(() => null))?.[0] || null;
}
const mudarCampanha = (id, body, filtro = '') =>
  rest(`qs_disparo_campanhas?id=eq.${id}${filtro}`, { method: 'PATCH', prefer: 'return=minimal', body });

/** O pacote que a Meta espera em POST /{waba}/message_templates (não envia). */
function pacoteDaMeta(m) {
  const vars = varsDoCorpo(m.corpo).map(Number).sort((a, b) => a - b);
  const components = [];
  if (m.cabecalho?.trim()) components.push({ type: 'HEADER', format: 'TEXT', text: m.cabecalho.trim() });
  const body = { type: 'BODY', text: String(m.corpo).trim() };
  if (vars.length) body.example = { body_text: [vars.map((n) => String(m.exemplos?.[n] ?? m.exemplos?.[String(n)] ?? `exemplo ${n}`))] };
  components.push(body);
  if (m.rodape?.trim()) components.push({ type: 'FOOTER', text: m.rodape.trim() });
  // Botão "Parar de receber": a Meta mede bloqueio; dar a saída fácil protege
  // a qualidade do número (e o opt-out já é tratado pelo QS no "PARAR").
  if (m.botaoParar) components.push({ type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Parar de receber' }] });
  return { name: m.nome, category: m.categoria, language: m.idioma || 'pt_BR', components };
}

export default async function handler(req, res) {
  // ── Cron ──
  if (req.method === 'GET') {
    // Link rastreado do Rel (0408): público, sem login — só registra o 1º clique e segue.
    if (req.query?.l) {
      const destino = await registrarClique(String(req.query.l), String(req.query.k || '')).catch(() => null);
      if (destino && urlSegura(destino)) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Location', destino);
        return res.status(302).end();
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><p style="font-family:sans-serif;padding:24px">Este link não está mais disponível.</p>');
    }
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || veio !== segredo) return res.status(401).json({ error: 'Não autorizado' });
    // Relacionamento (0408): cron próprio, só a rodada do Rel.
    if (String(req.query?.rel || '') === '1') {
      // 0409: os fluxos primeiro (começam disparos, acordam esperas), depois os disparos simples.
      const f = await rodadaFluxosRel({ limiteMs: 25_000 }).catch((e) => ({ erro: e?.message }));
      const r = await rodadaRel({ limiteMs: 25_000 }).catch((e) => ({ erro: e?.message }));
      console.log('[disparos] cron rel:', JSON.stringify({ f, r }).slice(0, 800));
      return res.status(200).json({ fluxos: f, relacionamento: r });
    }
    // Marketing (0341): cron próprio, só a rodada do Marketing.
    if (String(req.query?.mkt || '') === '1') {
      const r = await rodadaMkt().catch((e) => ({ erro: e?.message }));
      console.log('[disparos] cron mkt:', JSON.stringify(r).slice(0, 800));
      return res.status(200).json({ marketingOficial: r });
    }
    // Marketing (0242): recorrência → campanha agendada → fila; sequência → fila.
    // Cada passo isolado: um erro aqui não para a rodada do Comercial/Rel.
    const cfgCron = await lerConfig().catch(() => null);
    const m = cfgCron ? {
      recorrencias: await rodarRecorrencias().catch((e) => ({ erro: e?.message })),
      agendadas: await acordarAgendadas({ cfg: cfgCron, montarPublico }).catch((e) => ({ erro: e?.message })),
      sequencias: await rodarSequencias({ cfg: cfgCron }).catch((e) => ({ erro: e?.message })),
    } : null;
    const r = await rodada().catch((e) => ({ erro: e?.message }));
    const c = await conciliar().catch((e) => ({ erro: e?.message }));
    console.log('[disparos] cron:', JSON.stringify({ m, r, c }).slice(0, 800));
    return res.status(200).json({ marketing: m, rodada: r, conciliar: c });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use POST' });
  }

  const u = await quem(req);
  if (!u) return res.status(401).json({ error: 'Sessão inválida.' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const acao = String(body.acao || '');

  try {
    // Ações sobre uma campanha: o setor vem DELA, não do navegador.
    let campanha = null;
    let setor = SETORES.includes(body.setor) ? body.setor : 'comercial';
    if (['iniciar', 'pausar', 'retomar', 'cancelar', 'apagar', 'painel', 'agendar', 'desagendar'].includes(acao)) {
      campanha = await lerCampanha(body.campanhaId);
      if (!campanha) return res.status(404).json({ error: 'Campanha não encontrada.' });
      setor = campanha.setor;
    }
    if (acao.startsWith('mkt_')) setor = 'marketing';
    if (acao.startsWith('rel_')) setor = 'relacionamento';
    if (!(await podeDisparar(u, setor))) return res.status(403).json({ error: 'Seu cargo não permite disparos.' });
    const cfg = await lerConfig();
    // Marketing (0341): os modelos sincronizados da WABA dele entram na lista.
    if (setor === 'marketing') cfg.modelos = await juntarModelosMkt(cfg.modelos);
    // Relacionamento (0408): os da WABA do Rel + ritmo próprio (intervalo entre disparos).
    if (setor === 'relacionamento') {
      cfg.modelos = await juntarModelosRel(cfg.modelos);
      cfg.ritmo = { ...cfg.ritmo, ...(await lerConfigRel()).ritmo };
    }

    // 0409: o criador de fluxos do Relacionamento.
    if (acao === 'rel_fluxo_simular') {
      let fluxo = null;
      if (body.grafo) fluxo = { id: body.fluxoId || '00000000-0000-0000-0000-000000000000', nome: 'rascunho', grafo: body.grafo };
      else if (body.fluxoId) fluxo = (await rest(`rel_fluxos?select=id,nome,grafo&id=eq.${encodeURIComponent(body.fluxoId)}&limit=1`))?.[0];
      if (!fluxo) return res.status(404).json({ error: 'Fluxo não encontrado.' });
      const pessoa = { nome: u.name, telefone: u.whatsapp_number || '', tags: [], campos: { destino: 'Japão' }, ...(body.pessoa || {}) };
      return res.status(200).json(simularFluxo(fluxo, { pessoa, janela: body.janela !== false, respostas: body.respostas || {} }));
    }
    if (acao === 'rel_fluxo_modelos') return res.status(200).json(await modelosParaFluxo());
    if (acao === 'rel_fluxo_testar' && body.paraTeste === true) {
      // Os números de teste configurados (aba Número e ritmo): o fluxo começa pra cada um.
      const lista = await numerosTesteRel();
      if (!lista.length) return res.status(400).json({ error: 'Nenhum número de teste configurado (aba Número e ritmo).' });
      const enviados = [], erros = [];
      for (const n of lista) {
        const r = await iniciarTesteRel({ fluxoId: String(body.fluxoId || ''), telefone: n.telefone, nome: n.nome });
        await registrarTeste({ u, origem: 'fluxo', telefone: n.telefone, modelo: body.fluxoNome || 'fluxo', r });
        if (r.erro) erros.push({ nome: n.nome, erro: r.erro }); else enviados.push(n.nome);
        if (r.erro && /travado|não encontrado|Template|Ligue/i.test(r.erro)) break; // problema do fluxo/trava: igual pra todos
      }
      if (!enviados.length) return res.status(422).json({ error: erros[0]?.erro || 'Não enviou.', erros });
      return res.status(200).json({ ok: true, enviados, erros });
    }
    if (acao === 'rel_fluxo_testar') {
      const telefone = body.telefone || u.whatsapp_number;
      if (!telefone) return res.status(400).json({ error: 'Informe o número pra testar (ou cadastre seu WhatsApp no perfil do QS).' });
      const r = await iniciarTesteRel({ fluxoId: String(body.fluxoId || ''), telefone, nome: u.name });
      await registrarTeste({ u, origem: 'fluxo', telefone, modelo: body.fluxoNome || 'fluxo', r });
      if (r.erro) return res.status(422).json({ error: r.erro });
      return res.status(200).json({ ok: true, ...r });
    }
    if (acao === 'rel_fluxo_disparar') {
      const r = await agendarDisparoFluxo({ fluxoId: String(body.fluxoId || ''), publico: body.publico, agendadoPara: body.agendadoPara || null, userId: u.id });
      if (r.erro) return res.status(422).json({ error: r.erro });
      return res.status(200).json(r);
    }
    if (acao === 'rel_fluxo_disparo_cancelar') return res.status(200).json(await cancelarDisparoFluxo(String(body.disparoId || '')));

    if (acao.startsWith('rel_')) {
      const r = await acaoRelOficial({ acao, body, u });
      if (r) return res.status(r.status).json(r.json);
      return res.status(400).json({ error: 'Ação inválida.' });
    }

    // Marketing (0242): agendar, número, recorrências e sequências.
    if (acao.startsWith('mkt_') || acao === 'agendar' || acao === 'desagendar') {
      const r = (await acaoMarketing({ acao, body: { ...body, _campanha: campanha }, u, cfg, fontes: FONTES_MKT }))
        || (await acaoMktOficial({ acao, body, u }));
      if (r) return res.status(r.status).json(r.json);
      return res.status(400).json({ error: 'Ação inválida.' });
    }

    if (acao === 'config') {
      const nums = await numerosDosSdrs();
      const nomes = new Map(((await rest('qs_users?select=id,name').catch(() => [])) || []).map((x) => [x.id, x.name]));
      const rel = await numeroDoRelacionamento();
      return res.status(200).json({
        simulacao: cfg.simulacao, envioRealPlugado: ENVIO_REAL_PLUGADO, ritmo: cfg.ritmo, modelos: cfg.modelos,
        numerosSdr: [...nums.values()].map((n) => ({ sdr_id: n.user_id, nome: nomes.get(n.user_id) || '—', numero: n.numero })),
        numeroRel: rel ? { numero: rel.numero, conectado: numeroConectado(rel) } : null,
        // Marketing (0242): o número dele (null = não envia).
        ...(setor === 'marketing' ? { numeroMkt: await lerNumeroMkt() } : {}),
        // Marketing (0341): simulação e travas são DELE (mkt_disparo_simulacao + env).
        // Relacionamento (0408): simulação e travas são DELE (rel_disparo_simulacao + env).
        ...(setor === 'relacionamento' ? await (async () => {
          const est = await estadoRel();
          return { simulacao: est.simulacao !== false, envioRealPlugado: true, relOficial: est };
        })() : {}),
        ...(setor === 'marketing' ? await (async () => {
          const est = (await acaoMktOficial({ acao: 'mkt_oficial_estado', body: {}, u }))?.json || {};
          return { simulacao: est.simulacao !== false, envioRealPlugado: true, mktOficial: est };
        })() : {}),
      });
    }

    if (acao === 'previa') {
      const p = await montarPublico({ setor, publico: body.publico, ritmo: cfg.ritmo });
      // Marketing: a amostra mostra a base de origem de cada um.
      const nomes = new Map(((await rest('qs_users?select=id,name').catch(() => [])) || []).map((x) => [x.id, x.name]));
      return res.status(200).json({
        total: p.recebem.length,
        excluidos: Object.entries(p.excluidos).map(([k, n]) => ({ motivo: MOTIVOS[k] || k, n })).sort((a, b) => b.n - a.n),
        porSdr: p.porSdr.map((x) => ({ ...x, nome: nomes.get(x.sdr_id) || '—' })).sort((a, b) => b.n - a.n),
        amostra: p.recebem.slice(0, 8).map((a) => ({ nome: a.nome, telefone: `…${a.telefone.slice(-4)}`, sdr: nomes.get(a.sdr_id) || null, destino: a.destino || null })),
        ...(setor === 'marketing' ? { lista: p.recebem.slice(0, 200).map((a) => ({ nome: a.nome, telefone: `…${a.telefone.slice(-4)}`, contato_id: a.contato_id || null })) } : {}),
        numeroOk: p.numeroOk,
      });
    }

    if (acao === 'criar') {
      const nome = String(body.nome || '').trim();
      if (nome.length < 2) return res.status(400).json({ error: 'Dê um nome à campanha.' });
      // 0411: o Rel escolhe o número (Rel, SDR ou Marketing); o modelo tem que ser da conta da Meta DELE.
      const numeroRel = setor === 'relacionamento' ? await numeroDoDisparo(body.phone_number_id || null) : null;
      if (setor === 'relacionamento' && !numeroRel) return res.status(400).json({ error: 'Escolha um número conectado pra mandar.' });
      const daConta = (m) => setor !== 'relacionamento' || (m.origem === 'meta' ? (m.waba || '') === (numeroRel.waba_id || '') : numeroRel.tipo === 'relacionamento');
      const modelo = cfg.modelos.find((m) => m.nome === body.modelo_nome && (m.idioma || 'pt_BR') === (body.modelo_idioma || 'pt_BR') && daConta(m));
      if (!modelo || modelo.status !== 'aprovado') return res.status(400).json({ error: 'Escolha um modelo APROVADO pela Meta.' });
      const params = body.params && typeof body.params === 'object' ? body.params : {};
      const falta = varsDoCorpo(modelo.corpo).find((k) => !params[k] || !fontesDo(setor).includes(params[k].fonte) || (['texto', 'campo'].includes(params[k].fonte) && !String(params[k].valor || '').trim()));
      if (falta) return res.status(400).json({ error: `Falta dizer de onde vem a variável {{${falta}}}.` });
      const linkRuim = Object.entries(params).find(([, x]) => x?.fonte === 'link' && !urlSegura(x.valor));
      if (linkRuim) return res.status(400).json({ error: `O link da variável {{${linkRuim[0]}}} precisa começar com https://` });
      if (setor === 'comercial' && !UUID.test(String(body.cadence_id || ''))) return res.status(400).json({ error: 'Escolha a cadência: o disparo é o passo 1 dela.' });
      if (Object.values(params).some((x) => x.fonte === 'link_grupo') && !/^https:\/\/chat\.whatsapp\.com\//.test(String(body.grupo_link || ''))) {
        return res.status(400).json({ error: 'Cole o link de convite do grupo (https://chat.whatsapp.com/…).' });
      }
      // Marketing (0341): modelo da Meta com mídia no topo, título variável ou
      // botão de link dinâmico precisa dos extras. Só entra no insert quando há.
      let extraMkt = null;
      if ((setor === 'marketing' || setor === 'relacionamento') && modelo.origem === 'meta') {
        const ex = conferirExtra(modelo, body.envio_extra);
        if (ex.erro) return res.status(400).json({ error: ex.erro });
        extraMkt = { modelo_categoria: modelo.categoriaMeta || modelo.categoria, envio_extra: ex.extra };
        // Relacionamento (0408): o que fazer quando tocarem em cada botão.
        if (setor === 'relacionamento') {
          const rs = conferirRespostas(modelo, body.envio_extra?.respostas);
          if (rs.erro) return res.status(400).json({ error: rs.erro });
          // Pelo número de SDR/Marketing só sai template: nada de resposta em texto no botão.
          if (numeroRel.tipo !== 'relacionamento' && Object.values(rs.respostas).some((x) => String(x?.texto || '').trim())) {
            return res.status(400).json({ error: 'Pelo número de SDR ou do Marketing só sai template aprovado: tire a resposta em texto dos botões (etiqueta e aviso continuam valendo).' });
          }
          if (Object.keys(rs.respostas).length) extraMkt.envio_extra = { ...ex.extra, respostas: rs.respostas };
        }
      }
      const nova = await rest('qs_disparo_campanhas', {
        method: 'POST', prefer: 'return=representation',
        body: {
          setor, nome, modelo_nome: modelo.nome, modelo_idioma: modelo.idioma || 'pt_BR', modelo_corpo: modelo.corpo,
          params, publico: body.publico || {}, cadence_id: setor === 'comercial' ? body.cadence_id : null,
          grupo_link: body.grupo_link || null, criado_por: u.id,
          ...(extraMkt || {}),
          ...(numeroRel && numeroRel.tipo !== 'relacionamento' ? { phone_number_id: numeroRel.phone_number_id } : {}),
        },
      });
      return res.status(200).json({ campanha: nova?.[0] });
    }

    if (acao === 'iniciar') {
      if (campanha.status !== 'rascunho') return res.status(409).json({ error: 'Esta campanha já foi iniciada.' });
      const p = await montarPublico({ setor, publico: campanha.publico, ritmo: cfg.ritmo });
      if (setor === 'relacionamento' && !(campanha.phone_number_id ? await numeroDoDisparo(campanha.phone_number_id) : p.numeroOk)) {
        return res.status(409).json({ error: campanha.phone_number_id ? 'O número escolhido pra este disparo não está conectado.' : 'O número do Relacionamento não está conectado na Meta.' });
      }
      if (setor === 'marketing' && !p.numeroOk) return res.status(409).json({ error: 'O Marketing ainda não tem número (aba Número). Sem número, não envia.' });
      if (!p.recebem.length) return res.status(400).json({ error: 'Ninguém recebe com esse filtro.' });
      const f = await montarFila({ campanha, recebem: p.recebem, de: 'rascunho' });
      const simIniciar = setor === 'relacionamento' ? (await lerConfigRel()).simulacao : cfg.simulacao;
      return res.status(200).json({ ok: true, total: f.total, simulacao: simIniciar });
    }

    if (acao === 'pausar') {
      if (campanha.status === 'enviando') await mudarCampanha(campanha.id, { status: 'pausada', pausada_em: new Date().toISOString() }, '&status=eq.enviando');
      return res.status(200).json({ ok: true });
    }
    if (acao === 'retomar') {
      if (campanha.status === 'pausada') await mudarCampanha(campanha.id, { status: 'enviando', ultimo_erro: null }, '&status=eq.pausada');
      return res.status(200).json({ ok: true });
    }
    if (acao === 'cancelar') {
      if (!['enviando', 'pausada', 'agendada'].includes(campanha.status)) return res.status(409).json({ error: 'Só dá pra cancelar campanha em andamento ou agendada.' });
      await mudarCampanha(campanha.id, { status: 'cancelada', cancelada_em: new Date().toISOString() });
      await rest(`qs_disparo_envios?campanha_id=eq.${campanha.id}&status=eq.pendente`, {
        method: 'PATCH', prefer: 'return=minimal', body: { status: 'cancelado', motivo: 'campanha cancelada' },
      });
      return res.status(200).json({ ok: true });
    }
    if (acao === 'apagar') {
      if (campanha.status !== 'rascunho') return res.status(409).json({ error: 'Só rascunho pode ser apagado.' });
      await rest(`qs_disparo_campanhas?id=eq.${campanha.id}&status=eq.rascunho`, { method: 'DELETE', prefer: 'return=minimal' });
      return res.status(200).json({ ok: true });
    }

    if (acao === 'painel') {
      const [resumo, todos, respostas, erros] = await Promise.all([
        rest('rpc/qs_disparo_resumo', { method: 'POST', body: { p_campanha: campanha.id } }),
        rest(`qs_disparo_envios?select=sdr_id,status&campanha_id=eq.${campanha.id}&limit=5000`).catch(() => []),
        rest(`qs_disparo_envios?select=nome,lead_id,cliente_id,sdr_id,respondeu_em&campanha_id=eq.${campanha.id}&status=eq.respondeu&order=respondeu_em.desc&limit=30`).catch(() => []),
        rest(`qs_disparo_envios?select=nome,motivo,status&campanha_id=eq.${campanha.id}&status=in.(erro,pulado)&order=criado_em.desc&limit=30`).catch(() => []),
      ]);
      const nomes = new Map(((await rest('qs_users?select=id,name').catch(() => [])) || []).map((x) => [x.id, x.name]));
      const porSdr = new Map();
      for (const e of todos || []) {
        if (!e.sdr_id) continue;
        const x = porSdr.get(e.sdr_id) || { sdr_id: e.sdr_id, nome: nomes.get(e.sdr_id) || '—', total: 0, enviados: 0, responderam: 0 };
        x.total++;
        if (['enviado', 'entregue', 'lido', 'respondeu'].includes(e.status)) x.enviados++;
        if (e.status === 'respondeu') x.responderam++;
        porSdr.set(e.sdr_id, x);
      }
      return res.status(200).json({
        resumo, porSdr: [...porSdr.values()],
        respostas: (respostas || []).map((r) => ({ ...r, sdr: nomes.get(r.sdr_id) || null })),
        erros: erros || [],
      });
    }

    if (acao === 'salvar_modelo') {
      // Marketing (0242): o papel marketing mexe nos modelos DELE.
      const doMkt = setor === 'marketing' && u.role === 'marketing';
      if (!(u.role === 'admin' || u.role === 'gestor' || doMkt)) return res.status(403).json({ error: 'Só admin ou gestor mexe nos modelos.' });
      const m = body.modelo || {};
      const modelo = {
        nome: String(m.nome || '').trim(), idioma: m.idioma || 'pt_BR', categoria: m.categoria || 'MARKETING',
        corpo: String(m.corpo || '').trim(), cabecalho: String(m.cabecalho || '').trim() || null,
        rodape: String(m.rodape || '').trim() || null, exemplos: m.exemplos || {}, botaoParar: m.botaoParar !== false,
        status: ['rascunho', 'enviado', 'aprovado', 'recusado'].includes(m.status) ? m.status : 'rascunho',
        setor: SETORES.includes(m.setor) ? m.setor : setor, atualizado_em: new Date().toISOString(), atualizado_por: u.name,
      };
      if (doMkt) {
        modelo.setor = 'marketing';
        const outro = cfg.modelos.find((x) => x.nome === modelo.nome && (x.idioma || 'pt_BR') === modelo.idioma && x.setor && x.setor !== 'marketing');
        if (outro) return res.status(409).json({ error: `Já existe um modelo "${modelo.nome}" do ${outro.setor}. Use outro nome.` });
      }
      const problema = validarModelo(modelo);
      if (problema) return res.status(400).json({ error: problema });
      if (modelo.cabecalho && modelo.cabecalho.length > 60) return res.status(400).json({ error: 'O título passa de 60 caracteres.' });
      if (modelo.rodape && modelo.rodape.length > 60) return res.status(400).json({ error: 'O rodapé passa de 60 caracteres.' });
      const lista = cfg.modelos.filter((x) => !(x.nome === modelo.nome && (x.idioma || 'pt_BR') === modelo.idioma));
      if (body.remover) {
        await rest('qs_settings?on_conflict=key', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { key: 'disparo_modelos', value: lista } });
        return res.status(200).json({ ok: true });
      }
      lista.push(modelo);
      await rest('qs_settings?on_conflict=key', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { key: 'disparo_modelos', value: lista } });
      return res.status(200).json({ ok: true, modelo, pacote: pacoteDaMeta(modelo) });
    }

    if (acao === 'salvar_ritmo') {
      if (u.role !== 'admin') return res.status(403).json({ error: 'Só admin muda o ritmo.' });
      const r = body.ritmo || {};
      const n = (v, min, max, d) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) ? Math.round(Number(v)) : d));
      const hhmm = (v, d) => (/^\d{2}:\d{2}$/.test(String(v)) ? String(v) : d);
      const ritmo = {
        por_hora: n(r.por_hora, 1, 500, 30), por_dia: n(r.por_dia, 1, 5000, 150),
        inicio: hhmm(r.inicio, '09:30'), fim: hhmm(r.fim, '18:30'),
        dias: Array.isArray(r.dias) ? r.dias.map(Number).filter((d) => d >= 0 && d <= 6) : [1, 2, 3, 4, 5],
        intervalo_dias: n(r.intervalo_dias, 0, 90, 7),
      };
      await rest('qs_settings?on_conflict=key', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { key: 'disparo_ritmo', value: ritmo } });
      return res.status(200).json({ ok: true, ritmo });
    }

    return res.status(400).json({ error: 'Ação inválida.' });
  } catch (e) {
    console.error('[disparos]', acao, e?.message);
    return res.status(500).json({ error: e?.message || 'Falhou.' });
  }
}
