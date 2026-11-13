// api/mkt-agencia.js — PORTAL DA AGÊNCIA (0395, 13/11/2026)
// -----------------------------------------------------------------------------
// A agência (hoje a Disrupt) NÃO é usuário do Supabase: o login dela é daqui
// (mkt_agencia_login, senha bcrypt, sessão opaca de 12 h, só o sha256 no banco)
// e esta rota é o ÚNICO caminho dela pro banco, com service_role, tocando só:
//   • mkt_planejamentos/_itens/_obs com origem = 'agencia' da agência dela;
//   • mkt_cards com da_agencia = true (link de produção + mandar pra aprovação).
// Motivo (auditado em 13/11): várias policies do QS liberam qualquer
// `authenticated`; um usuário Supabase da agência leria reuniões e equipe.
//
//   POST ?acao=login            { email, senha }            → { token, nome, agencia }
//   POST ?acao=sair
//   GET  ?acao=eu | perfis | planejamentos | planejamento&id= | producao
//   POST ?acao=criar            { periodicidade, titulo, periodo_inicio, periodo_fim, pdf_base64?, nome_arquivo?, link? }
//                               → IA lê o documento e preenche os conteúdos (rascunho)
//   POST ?acao=salvar           { id, titulo?, itens: [...] }
//   POST ?acao=enviar           { id } → faltou algo? volta com a lista (não envia).
//                               Completo? IA revisa (avisos) e vai pros supervisores.
//   POST ?acao=responder        { id, item_id?, texto }     → resposta da agência numa obs
//   POST ?acao=producao_enviar  { card_id, link, comentario? } → link do Canva, vai pra aprovação
// -----------------------------------------------------------------------------
import { rest } from './_supabaseAdmin.js';
import {
  FORMATOS, faltasDoPlanejamento, textoDasFaltas, periodoValido, exportarGoogleDocs, normalizarItemIa,
} from './_mktPlanRegras.js';

// Upload direto vai no corpo da requisição (a Vercel corta em ~4,5 MB; base64 = +33%).
const MAX_PDF_UPLOAD = 3 * 1024 * 1024;
const MAX_PDF = 8 * 1024 * 1024;
const enc = encodeURIComponent;

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

function corpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

async function rpc(nome, args) {
  return rest(`rpc/${nome}`, { method: 'POST', body: args });
}

async function contaDaSessao(req) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const r = await rpc('mkt_agencia_sessao', { p_token: token }).catch(() => null);
  return Array.isArray(r) && r[0] ? { ...r[0], token } : null;
}

/** Ids das contas da MESMA agência (duas pessoas da Disrupt veem o mesmo trabalho). */
async function contasDaAgencia(conta) {
  const r = await rest(`mkt_agencia_contas?select=id&agencia=eq.${enc(conta.agencia)}`);
  return (r || []).map((x) => x.id);
}

async function planejamentoDaAgencia(id, conta) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const ids = await contasDaAgencia(conta);
  const r = await rest(`mkt_planejamentos?select=*&id=eq.${id}&origem=eq.agencia&agencia_conta_id=in.(${ids.join(',')})`);
  return r?.[0] || null;
}

async function perfisAtivos() {
  return (await rest('mkt_perfis?select=id,nome,rede,dono&ativo=eq.true&order=ordem')) || [];
}

// ── IA ──────────────────────────────────────────────────────────────────────

const ESQUEMA_EXTRACAO = {
  type: 'object', additionalProperties: false,
  required: ['itens', 'avisos'],
  properties: {
    avisos: { type: 'array', items: { type: 'string' } },
    itens: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['titulo', 'formato', 'referencias', 'adaptacao', 'perfis', 'data_postagem', 'horario'],
        properties: {
          titulo: { type: 'string' },
          formato: { type: ['string', 'null'], enum: [...FORMATOS, null] },
          referencias: { type: 'array', items: { type: 'string' } },
          adaptacao: { type: ['string', 'null'] },
          perfis: { type: 'array', items: { type: 'string' } },
          data_postagem: { type: ['string', 'null'] },
          horario: { type: ['string', 'null'] },
        },
      },
    },
  },
};

function instrucaoExtracao(plan, perfis) {
  return [
    'Você transforma o cronograma de conteúdo que uma agência de marketing mandou (PDF) em itens padronizados para a agência de viagens "Se Tu For, Eu Vou" (STFV).',
    `O planejamento é ${plan.periodicidade.toUpperCase()}, de ${plan.periodo_inicio} a ${plan.periodo_fim}.`,
    'Para CADA conteúdo do documento devolva: titulo (o gancho/título do conteúdo), formato (reels | carrossel | estatico | story | video_longo | outro; "Carrossel/Estático" sem mais detalhe = carrossel), referencias (TODOS os links de referência do conteúdo, completos), adaptacao (a "abordagem": como o conteúdo vai ser feito/adaptado para a marca, com as palavras do documento), perfis, data_postagem (AAAA-MM-DD) e horario (HH:MM).',
    `perfis: só os nomes desta lista, e SÓ se o documento disser onde vai ser postado: ${perfis.map((p) => p.nome).join(', ')}. Se o documento só disser "LinkedIn" use o perfil de LinkedIn da lista. Se não disser, devolva [].`,
    'data_postagem: só se o documento trouxer a data, OU o dia da semana (ex.: "SEGUNDA") dentro do período informado — aí converta para a data daquele dia no período. Se não houver nada, null. NUNCA invente data.',
    'horario: só se estiver escrito no documento. Se não estiver, null. NUNCA invente horário.',
    'Se o documento tiver seções de períodos diferentes, pegue só os conteúdos do período informado e diga nos avisos quais seções você ignorou.',
    'avisos: frases curtas em português sobre o que está confuso ou faltando no documento (ex.: "nenhum conteúdo diz em qual rede será postado"). Não repita o conteúdo.',
  ].join('\n');
}

async function chamarOpenAi({ instrucao, conteudo, esquema, nome, timeoutMs = 50_000 }) {
  const chave = process.env.OPENAI_API_KEY;
  if (!chave) throw new Error('Falta OPENAI_API_KEY na Vercel.');
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      messages: [{ role: 'system', content: instrucao }, { role: 'user', content: conteudo }],
      response_format: { type: 'json_schema', json_schema: { name: nome, strict: true, schema: esquema } },
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(r.status === 401 ? 'A chave da OpenAI foi recusada.' : `OpenAI: ${String(j?.error?.message || r.status).slice(0, 160)}`);
  try { return JSON.parse(j?.choices?.[0]?.message?.content || ''); } catch { throw new Error('A IA não devolveu os conteúdos.'); }
}

async function extrairDoPdf(base64, nomeArquivo, plan, perfis) {
  const lido = await chamarOpenAi({
    nome: 'planejamento',
    esquema: ESQUEMA_EXTRACAO,
    instrucao: instrucaoExtracao(plan, perfis),
    conteudo: [
      { type: 'text', text: 'Documento da agência em anexo.' },
      { type: 'file', file: { filename: nomeArquivo || 'planejamento.pdf', file_data: `data:application/pdf;base64,${base64}` } },
    ],
  });
  const itens = (Array.isArray(lido?.itens) ? lido.itens : []).slice(0, 80).map((x) => normalizarItemIa(x, perfis));
  const avisos = (Array.isArray(lido?.avisos) ? lido.avisos : []).map((a) => String(a).slice(0, 300)).slice(0, 15);
  return { itens, avisos };
}

const ESQUEMA_REVISAO = {
  type: 'object', additionalProperties: false, required: ['resumo', 'avisos'],
  properties: {
    resumo: { type: 'string' },
    avisos: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['conteudo', 'aviso'],
        properties: { conteudo: { type: ['integer', 'null'] }, aviso: { type: 'string' } },
      },
    },
  },
};

/** Revisão de QUALIDADE (não trava: os campos obrigatórios o banco já conferiu). */
async function revisarComIa(plan, itens, perfis) {
  const nomePerfil = new Map(perfis.map((p) => [p.id, p.nome]));
  const lista = itens.map((i, n) => ({
    conteudo: n + 1, titulo: i.titulo, formato: i.formato, referencias: i.referencias, adaptacao: i.adaptacao,
    perfis: (i.perfil_ids || []).map((x) => nomePerfil.get(x) || x), data: i.data_postagem, horario: String(i.horario || '').slice(0, 5),
  }));
  const r = await chamarOpenAi({
    nome: 'revisao',
    esquema: ESQUEMA_REVISAO,
    timeoutMs: 30_000,
    instrucao: [
      'Você revisa um planejamento de conteúdo de redes sociais de uma agência de viagens (Se Tu For, Eu Vou) antes de ir para os supervisores.',
      'Aponte SÓ problemas concretos, em português, curtos: formato que não bate com o link de referência (link /reel/ com formato carrossel, /p/ com reels), adaptação vaga demais para produzir, conteúdo de LinkedIn em perfil que não é LinkedIn, dois conteúdos no mesmo perfil no mesmo horário, horário de madrugada, conteúdos repetidos.',
      'resumo: uma frase sobre o planejamento. Se estiver tudo certo, avisos = [].',
    ].join('\n'),
    conteudo: JSON.stringify({ periodicidade: plan.periodicidade, periodo: [plan.periodo_inicio, plan.periodo_fim], conteudos: lista }),
  });
  return {
    resumo: String(r?.resumo || '').slice(0, 400),
    avisos: (Array.isArray(r?.avisos) ? r.avisos : []).slice(0, 30)
      .map((a) => ({ conteudo: Number.isInteger(a?.conteudo) ? a.conteudo : null, aviso: String(a?.aviso || '').slice(0, 300) }))
      .filter((a) => a.aviso),
  };
}

// ── Storage ─────────────────────────────────────────────────────────────────

async function guardarPdf(caminho, bytes) {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${url}/storage/v1/object/mkt-planejamentos/${caminho}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
    body: bytes,
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Não consegui guardar o PDF (${r.status}).`);
}

async function baixarGoogleDocs(link) {
  const url = exportarGoogleDocs(link);
  if (!url) throw new Error('Link do Google Docs inválido (precisa ser docs.google.com/document/d/…).');
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  const tipo = r.headers.get('content-type') || '';
  if (!r.ok || !tipo.includes('application/pdf')) {
    throw new Error('Não consegui abrir o Google Docs. Deixe o documento como "Qualquer pessoa com o link pode ver" ou envie o PDF.');
  }
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_PDF) throw new Error('Documento grande demais (máx. 8 MB).');
  return buf;
}

// ── Itens ───────────────────────────────────────────────────────────────────

function limparItem(x, n) {
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const uuid = (v) => (/^[0-9a-f-]{36}$/i.test(String(v || '')) ? String(v) : null);
  return {
    id: uuid(x?.id),
    ordem: n,
    titulo: s(x?.titulo, 200),
    formato: FORMATOS.includes(x?.formato) ? x.formato : null,
    referencias: (Array.isArray(x?.referencias) ? x.referencias : []).map((r) => s(r, 500)).filter(Boolean).slice(0, 5),
    adaptacao: s(x?.adaptacao, 4000) || null,
    perfil_ids: (Array.isArray(x?.perfil_ids) ? x.perfil_ids : []).map(uuid).filter(Boolean).slice(0, 10),
    data_postagem: /^\d{4}-\d{2}-\d{2}$/.test(String(x?.data_postagem || '')) ? x.data_postagem : null,
    horario: /^([01]\d|2[0-3]):[0-5]\d/.test(String(x?.horario || '')) ? String(x.horario).slice(0, 5) : null,
  };
}

async function gravarItens(planId, itens) {
  const atuais = (await rest(`mkt_planejamento_itens?select=id&planejamento_id=eq.${planId}`)) || [];
  const manter = new Set(itens.map((i) => i.id).filter(Boolean));
  const apagar = atuais.map((a) => a.id).filter((id) => !manter.has(id));
  if (apagar.length) await rest(`mkt_planejamento_itens?id=in.(${apagar.join(',')})&planejamento_id=eq.${planId}`, { method: 'DELETE' });
  const existentes = new Set(atuais.map((a) => a.id));
  for (const i of itens) {
    const { id, ...campos } = i;
    if (id && existentes.has(id)) {
      await rest(`mkt_planejamento_itens?id=eq.${id}&planejamento_id=eq.${planId}`, { method: 'PATCH', body: campos, prefer: 'return=minimal' });
    } else {
      await rest('mkt_planejamento_itens', { method: 'POST', body: { ...campos, planejamento_id: planId }, prefer: 'return=minimal' });
    }
  }
}

async function lerPlanejamento(plan) {
  const [itens, obs] = await Promise.all([
    rest(`mkt_planejamento_itens?select=*&planejamento_id=eq.${plan.id}&order=ordem`),
    rest(`mkt_planejamento_obs?select=id,item_id,texto,time,rodada,resolvida,criado_em,autor_agencia,autor:qs_users!mkt_planejamento_obs_autor_id_fkey(name)&planejamento_id=eq.${plan.id}&order=criado_em`),
  ]);
  return {
    ...plan,
    itens: itens || [],
    obs: (obs || []).map((o) => ({ ...o, autor: o.autor?.name || (o.autor_agencia ? 'Agência' : '—') })),
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const acao = String(req.query?.acao || '');
  try {
    if (acao === 'login') {
      if (req.method !== 'POST') return json(res, 405, { erro: 'Use POST.' });
      const b = corpo(req);
      const r = await rpc('mkt_agencia_login', { p_email: String(b.email || '').slice(0, 200), p_senha: String(b.senha || '').slice(0, 200) });
      const x = r?.[0];
      if (!x?.token) return json(res, 401, { erro: x?.erro || 'E-mail ou senha inválidos.' });
      return json(res, 200, { token: x.token, nome: x.nome, agencia: x.agencia });
    }

    const conta = await contaDaSessao(req);
    if (!conta) return json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });

    if (acao === 'sair') { await rpc('mkt_agencia_sair', { p_token: conta.token }); return json(res, 200, { ok: true }); }
    if (acao === 'eu') return json(res, 200, { nome: conta.nome, agencia: conta.agencia, email: conta.email });
    if (acao === 'perfis') return json(res, 200, { perfis: await perfisAtivos() });

    if (acao === 'planejamentos') {
      const ids = await contasDaAgencia(conta);
      const r = await rest(`mkt_planejamentos?select=id,titulo,periodicidade,periodo_inicio,periodo_fim,status,rodada,enviado_em,decidido_em,criado_em&origem=eq.agencia&agencia_conta_id=in.(${ids.join(',')})&order=periodo_inicio.desc&limit=100`);
      return json(res, 200, { planejamentos: r || [] });
    }

    if (acao === 'planejamento') {
      const plan = await planejamentoDaAgencia(req.query.id, conta);
      if (!plan) return json(res, 404, { erro: 'Planejamento não encontrado.' });
      return json(res, 200, { planejamento: await lerPlanejamento(plan) });
    }

    if (req.method !== 'POST' && acao !== 'producao') return json(res, 405, { erro: 'Use POST.' });
    const b = corpo(req);

    if (acao === 'criar') {
      const periodicidade = String(b.periodicidade || '');
      if (!['semanal', 'mensal'].includes(periodicidade)) return json(res, 400, { erro: 'Diga se o planejamento é SEMANAL ou MENSAL.' });
      const erroPeriodo = periodoValido(periodicidade, b.periodo_inicio, b.periodo_fim);
      if (erroPeriodo) return json(res, 400, { erro: erroPeriodo });
      const titulo = String(b.titulo || '').trim().slice(0, 200);
      if (titulo.length < 3) return json(res, 400, { erro: 'Dê um nome ao planejamento.' });

      let bytes = null; let nomeArquivo = null; let link = null;
      if (b.pdf_base64) {
        bytes = Buffer.from(String(b.pdf_base64), 'base64');
        if (bytes.length > MAX_PDF_UPLOAD) return json(res, 413, { erro: 'PDF grande demais para enviar (máx. 3 MB). Mande o link do Google Docs.' });
        if (bytes.subarray(0, 5).toString() !== '%PDF-') return json(res, 400, { erro: 'O arquivo não é um PDF.' });
        nomeArquivo = String(b.nome_arquivo || 'planejamento.pdf').replace(/[^\w.\- ]+/g, '').slice(0, 120) || 'planejamento.pdf';
      } else if (b.link) {
        link = String(b.link).trim();
        bytes = await baixarGoogleDocs(link);
        nomeArquivo = 'google-docs.pdf';
      }

      const [criado] = await rest('mkt_planejamentos', {
        method: 'POST', prefer: 'return=representation',
        body: {
          origem: 'agencia', periodicidade, time: 'organico', titulo,
          periodo_inicio: b.periodo_inicio, periodo_fim: b.periodo_fim,
          agencia_conta_id: conta.conta_id, documento_nome: nomeArquivo, documento_link: link,
        },
      });

      let avisos = [];
      const perfis = await perfisAtivos();
      if (bytes) {
        const caminho = `${criado.id}/${Date.now()}.pdf`;
        await guardarPdf(caminho, bytes);
        await rest(`mkt_planejamentos?id=eq.${criado.id}`, { method: 'PATCH', body: { documento_path: caminho }, prefer: 'return=minimal' });
        try {
          const lido = await extrairDoPdf(bytes.toString('base64'), nomeArquivo, criado, perfis);
          avisos = lido.avisos;
          await gravarItens(criado.id, lido.itens.map((x, n) => limparItem(x, n)));
        } catch (e) {
          avisos = [`A IA não conseguiu ler o documento (${e.message}). Preencha os conteúdos à mão.`];
        }
      }
      const pendencias = faltasDoPlanejamento(criado, (await rest(`mkt_planejamento_itens?select=*&planejamento_id=eq.${criado.id}&order=ordem`)) || [], perfis.map((p) => p.id));
      await rest(`mkt_planejamentos?id=eq.${criado.id}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { ia_revisao: { etapa: 'leitura', avisos, pendencias: textoDasFaltas(pendencias), em: new Date().toISOString() } },
      });
      return json(res, 200, { id: criado.id });
    }

    if (acao === 'salvar' || acao === 'enviar' || acao === 'responder') {
      const plan = await planejamentoDaAgencia(b.id, conta);
      if (!plan) return json(res, 404, { erro: 'Planejamento não encontrado.' });

      if (acao === 'responder') {
        const texto = String(b.texto || '').trim().slice(0, 4000);
        if (!texto) return json(res, 400, { erro: 'Escreva a resposta.' });
        const itemId = /^[0-9a-f-]{36}$/i.test(String(b.item_id || '')) ? b.item_id : null;
        if (itemId) {
          const ok = await rest(`mkt_planejamento_itens?select=id&id=eq.${itemId}&planejamento_id=eq.${plan.id}`);
          if (!ok?.length) return json(res, 400, { erro: 'Esse conteúdo não é desse planejamento.' });
        }
        await rest('mkt_planejamento_obs', {
          method: 'POST', prefer: 'return=minimal',
          body: { planejamento_id: plan.id, item_id: itemId, autor_agencia: conta.conta_id, texto, rodada: plan.rodada },
        });
        return json(res, 200, { ok: true });
      }

      if (!['rascunho', 'devolvido'].includes(plan.status)) {
        return json(res, 409, { erro: 'Esse planejamento já foi enviado — espere a revisão dos supervisores.' });
      }

      if (acao === 'salvar') {
        const patch = {};
        if (typeof b.titulo === 'string' && b.titulo.trim().length >= 3) patch.titulo = b.titulo.trim().slice(0, 200);
        if (Object.keys(patch).length) await rest(`mkt_planejamentos?id=eq.${plan.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
        if (Array.isArray(b.itens)) await gravarItens(plan.id, b.itens.slice(0, 80).map((x, n) => limparItem(x, n)));
        return json(res, 200, { ok: true });
      }

      // ENVIAR: primeiro o que é obrigatório (o banco é a trava); faltou → volta pra agência.
      const faltas = await rpc('mkt_plan_faltas', { p_id: plan.id });
      if (Array.isArray(faltas) && faltas.length) {
        const textos = textoDasFaltas(faltas);
        await rest(`mkt_planejamentos?id=eq.${plan.id}`, {
          method: 'PATCH', prefer: 'return=minimal',
          body: { ia_revisao: { ...(plan.ia_revisao || {}), etapa: 'faltas', pendencias: textos, em: new Date().toISOString() } },
        });
        return json(res, 200, { ok: false, faltas: textos });
      }
      const [itens, perfis] = await Promise.all([
        rest(`mkt_planejamento_itens?select=*&planejamento_id=eq.${plan.id}&order=ordem`),
        perfisAtivos(),
      ]);
      let revisao;
      try { revisao = await revisarComIa(plan, itens || [], perfis); }
      catch (e) { revisao = { resumo: '', avisos: [], erro: `Revisão da IA indisponível: ${e.message}` }; }
      const ia = { etapa: 'revisao', ...revisao, avisos_leitura: plan.ia_revisao?.avisos || [], em: new Date().toISOString() };
      const r = await rpc('mkt_plan_enviar', { p_id: plan.id, p_ia: ia });
      if (!r?.ok) return json(res, 200, { ok: false, faltas: textoDasFaltas(r?.faltas || []) });
      return json(res, 200, { ok: true, revisao });
    }

    if (acao === 'producao') {
      const r = await rest('mkt_cards?select=id,titulo,descricao,tipo,data_publicacao,horario,perfil_ids,link_producao,status_aprovacao,rodada,atualizado_em,coluna:mkt_colunas(tipo,nome),comentarios:mkt_comentarios(texto,tipo,criado_em)&da_agencia=eq.true&arquivado=eq.false&order=data_publicacao.asc.nullslast&limit=200');
      return json(res, 200, { cards: (r || []).map((c) => ({ ...c, comentarios: (c.comentarios || []).filter((x) => x.tipo === 'devolucao').sort((a, z) => z.criado_em.localeCompare(a.criado_em)) })) });
    }

    if (acao === 'producao_enviar') {
      const cardId = String(b.card_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(cardId)) return json(res, 400, { erro: 'Card inválido.' });
      const link = String(b.link || '').trim();
      if (!/^https:\/\/\S+$/i.test(link) || link.length > 1000) return json(res, 400, { erro: 'Cole o link do Canva (começa com https://).' });
      const [card] = (await rest(`mkt_cards?select=id,coluna:mkt_colunas(tipo)&id=eq.${cardId}&da_agencia=eq.true&arquivado=eq.false`)) || [];
      if (!card) return json(res, 404, { erro: 'Conteúdo não encontrado.' });
      if (['aprovacao', 'aprovado', 'publicado'].includes(card.coluna?.tipo)) {
        return json(res, 409, { erro: card.coluna?.tipo === 'aprovacao' ? 'Já está em aprovação.' : 'Esse conteúdo já foi aprovado.' });
      }
      const [col] = (await rest('mkt_colunas?select=id&tipo=eq.aprovacao')) || [];
      const comentario = String(b.comentario || '').trim().slice(0, 2000);
      await rest(`mkt_cards?id=eq.${cardId}`, { method: 'PATCH', body: { link_producao: link }, prefer: 'return=minimal' });
      await rest('mkt_anexos', { method: 'POST', prefer: 'return=minimal', body: { card_id: cardId, nome: 'Produção da agência (Canva)', url: link } });
      if (comentario) {
        await rest('mkt_comentarios', { method: 'POST', prefer: 'return=minimal', body: { card_id: cardId, autor_agencia: conta.conta_id, texto: `[Agência · ${conta.nome}] ${comentario}`, tipo: 'comentario' } });
      }
      await rest(`mkt_cards?id=eq.${cardId}`, { method: 'PATCH', body: { coluna_id: col.id }, prefer: 'return=minimal' });
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { erro: 'Ação desconhecida.' });
  } catch (e) {
    console.error('[mkt-agencia]', acao, e?.message);
    return json(res, e?.status && e.status < 500 ? e.status : 500, { erro: String(e?.message || 'Erro').slice(0, 300) });
  }
}
