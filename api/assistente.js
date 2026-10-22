// api/assistente.js
// -----------------------------------------------------------------------------
// "PERGUNTAR" DA BOLINHA DO QS (Bruno 22/10/2026): um assistente que responde
// perguntas curtas sobre o QS — "quando a Maria embarca?", "o que tenho pra
// hoje?", "quais solicitações estão comigo?".
//
//   POST { pergunta, historico?: [{ de: 'eu'|'qs', texto }] }
//   Authorization: Bearer <token do Supabase da pessoa>
//   → { resposta: string, links?: [{ rotulo, hash }] }
//
// SEGURANÇA: toda consulta roda COM O TOKEN DA PESSOA (chave anon + Bearer do
// usuário) — a RLS do banco decide o que ela enxerga, exatamente como na tela.
// NUNCA usa a service_role aqui. As ferramentas da IA só LEEM.
// (PostgREST por fetch, sem o supabase-js: no servidor ele sobe o Realtime e
// quebra em Node < 22 — ver _supabaseAdmin.js.)
//
// A IA (OpenAI, function calling) só responde com o que as ferramentas
// devolvem; no máximo 4 rodadas de ferramenta. Limite leve: 20 perguntas por
// minuto por pessoa (memória da instância).
// -----------------------------------------------------------------------------

const MODELO = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_RODADAS = 4;
const ORCAMENTO_MS = 25_000; // maxDuration 30s no vercel.json
const MAX_PAYLOAD = 6_000;   // caracteres de cada resultado de ferramenta mandados à IA
const LIMITE_POR_MINUTO = 20;

const SETORES = ['comercial', 'relacionamento', 'financeiro', 'operacional'];
const PREFIXO = { comercial: 'comercial', relacionamento: 'rel', financeiro: 'fin', operacional: 'ops' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const diaDaSemana = (iso) => new Date(`${iso}T12:00:00-03:00`).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
const BR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : null);
const horaSP = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null);
const limpar = (t) => String(t || '').replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const soDigitos = (t) => String(t || '').replace(/\D/g, '');

// ── Limite por pessoa (memória da instância) ───────────────────────────────

const uso = new Map();
function estourou(userId) {
  const agora = Date.now();
  const lista = (uso.get(userId) || []).filter((t) => agora - t < 60_000);
  if (lista.length >= LIMITE_POR_MINUTO) { uso.set(userId, lista); return true; }
  lista.push(agora);
  uso.set(userId, lista);
  if (uso.size > 500) for (const [k, v] of uso) if (!v.some((t) => agora - t < 60_000)) uso.delete(k);
  return false;
}

// ── Supabase COMO A PESSOA ─────────────────────────────────────────────────

function cfg() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  // a chave PÚBLICA (anon): quem decide o acesso é o token da pessoa + a RLS
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  return { url, anon };
}

function clienteDaPessoa(token) {
  const { url, anon } = cfg();
  async function q(path, { method = 'GET', body } = {}) {
    const headers = { apikey: anon, Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(`${url}/rest/v1/${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8_000),
    });
    const texto = await r.text();
    const j = texto ? (() => { try { return JSON.parse(texto); } catch { return null; } })() : null;
    if (!r.ok) throw new Error(String(j?.message || `HTTP ${r.status}`).slice(0, 160));
    return j;
  }
  return { q, rpc: (fn, args) => q(`rpc/${fn}`, { method: 'POST', body: args || {} }) };
}

async function usuarioDoToken(token) {
  const { url, anon } = cfg();
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id || null;
  } catch { return null; }
}

/** Mesma regra do setoresDe() do front (QsAuthContext). */
function setoresDe(u) {
  if (!u) return [];
  if (u.role === 'admin') return [...SETORES];
  if (['relacionamento', 'financeiro', 'operacional'].includes(u.role)) return [u.role];
  const validos = (Array.isArray(u.setores) ? u.setores : []).filter((x) => SETORES.includes(x));
  if (u.role === 'gestor') return validos.length ? SETORES.filter((x) => validos.includes(x)) : ['comercial'];
  return SETORES.filter((x) => x === 'comercial' || validos.includes(x));
}

// ── Endereços do QS (iguais aos de src/bolinha/lib.ts) ─────────────────────

function rotas(eu) {
  const com = eu.role === 'closer' ? 'closer' : 'comercial';
  const temRel = eu.setores.includes('relacionamento');
  return {
    lead: (id) => `#${com}/lead/${id}`,
    cliente: (id) => (temRel ? `#rel/cliente/${id}` : null),
    viagem: (id) => (temRel ? `#rel/viagem/${id}` : null),
    agenda: () => (eu.role === 'closer' ? '#closer/agenda' : '#comercial/minha-agenda'),
    solicitacao: (s) => {
      const setor = s.criado_por === eu.id && s.responsavel_id !== eu.id && eu.setores.includes(s.de_setor) ? s.de_setor
        : eu.setores.includes(s.para_setor) ? s.para_setor : eu.setores.includes(s.de_setor) ? s.de_setor : s.para_setor;
      const p = setor === 'comercial' ? com : PREFIXO[setor] || 'comercial';
      return `#${p}/solicitacoes/${s.id}`;
    },
  };
}

// ── Ferramentas (só leitura) ───────────────────────────────────────────────

const FERRAMENTAS = [
  {
    type: 'function',
    function: {
      name: 'buscar_pessoas',
      description: 'Procura clientes (fichas do Relacionamento) e leads (Comercial) por nome, telefone, CPF ou e-mail.',
      parameters: { type: 'object', properties: { texto: { type: 'string', description: 'Nome, telefone, CPF ou e-mail (pode ser parte).' } }, required: ['texto'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'viagens_do_cliente',
      description: 'Viagens/vendas de um cliente (como comprador ou passageiro): título, destino, embarque, retorno, situação e quem cuida.',
      parameters: { type: 'object', properties: { cliente_id: { type: 'string', description: 'id do cliente vindo de buscar_pessoas' } }, required: ['cliente_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'solicitacoes',
      description: 'Solicitações entre setores que estão abertas. "minhas" = comigo ou que eu pedi; "do_meu_setor" = que chegaram pros meus setores; "abertas" = todas as abertas que posso ver.',
      parameters: { type: 'object', properties: { filtro: { type: 'string', enum: ['minhas', 'do_meu_setor', 'abertas'] } }, required: ['filtro'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agenda',
      description: 'Minhas reuniões de um dia e quantas atividades (tarefas) tenho pra esse dia e atrasadas.',
      parameters: { type: 'object', properties: { dia: { type: 'string', description: 'Data AAAA-MM-DD (horário de São Paulo).' } }, required: ['dia'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detalhes_lead',
      description: 'Detalhes de um lead do Comercial: contato, status, origem, dono e reuniões.',
      parameters: { type: 'object', properties: { lead_id: { type: 'string', description: 'id do lead vindo de buscar_pessoas' } }, required: ['lead_id'] },
    },
  },
];

function ferramentas(sb, eu, links) {
  const r = rotas(eu);
  const guardar = (rotulo, hash) => { if (hash && rotulo && !links.has(hash)) links.set(hash, String(rotulo).slice(0, 60)); };

  return {
    async buscar_pessoas({ texto }) {
      const t = limpar(texto);
      if (t.length < 2) return { erro: 'Texto curto demais para buscar.' };
      const d = soDigitos(t);
      const soNumero = d.length >= 4 && d.length === t.replace(/[\s.\-/()+]/g, '').length;
      const [clientes, leads] = await Promise.all([
        sb.rpc('qs_sol_buscar_clientes', { p_termo: t }).catch(() => []),
        eu.setores.includes('comercial')
          ? sb.q(`qs_leads?select=id,full_name,phone,status,updated_at&order=updated_at.desc&limit=8&${soNumero
            ? `phone=ilike.${encodeURIComponent(`*${d.slice(-8)}*`)}`
            : `or=${encodeURIComponent(`(full_name.ilike.*${t}*,email.ilike.*${t}*)`)}`}`).catch(() => [])
          : [],
      ]);
      const cs = (clientes || []).slice(0, 8).map((c) => {
        guardar(c.nome, r.cliente(c.id));
        return { tipo: 'cliente', id: c.id, nome: c.nome, telefone_final: c.telefone_fim, email: c.email_mascarado, vendas: c.vendas };
      });
      const ls = (leads || []).map((l) => {
        guardar(l.full_name, r.lead(l.id));
        return { tipo: 'lead', id: l.id, nome: l.full_name, telefone_final: soDigitos(l.phone).slice(-4) || null, status: l.status };
      });
      return { clientes: cs, leads: ls, obs: eu.setores.includes('comercial') ? undefined : 'Leads não buscados: a pessoa não é do Comercial.' };
    },

    async viagens_do_cliente({ cliente_id }) {
      if (!UUID.test(String(cliente_id || ''))) return { erro: 'cliente_id inválido — use o id que veio de buscar_pessoas.' };
      const vendas = (await sb.rpc('qs_sol_vendas_do_cliente', { p_cliente: cliente_id }).catch(() => [])) || [];
      const ids = vendas.map((v) => v.id).slice(0, 15);
      // Quem é do Relacionamento enxerga mais (retorno, quem cuida); os outros só o resumo.
      let mais = new Map();
      if (ids.length && eu.setores.includes('relacionamento')) {
        const vs = await sb.q(`rel_viagens_v?select=id,data_retorno,responsavel_nome,cliente_nome,expedicao&id=in.(${ids.join(',')})`).catch(() => []);
        mais = new Map((vs || []).map((v) => [v.id, v]));
      }
      return {
        viagens: vendas.slice(0, 15).map((v) => {
          const x = mais.get(v.id) || {};
          guardar(v.titulo, r.viagem(v.id));
          return {
            id: v.id, titulo: v.titulo, destino: v.destino, servico: v.servico,
            embarque: BR(v.data_embarque), retorno: BR(x.data_retorno), fase: v.fase, status: v.status,
            responsavel: x.responsavel_nome ?? undefined, comprador: v.comprador, bitrix: v.bitrix_deal_id || undefined,
          };
        }),
      };
    },

    async solicitacoes({ filtro }) {
      const campos = 'id,numero,titulo,sobre_nome,status,prioridade,prazo,vencida,de_setor,para_setor,responsavel_id,responsavel_nome,criado_por,criado_por_nome,tipo_rotulo';
      let f = 'aberta=eq.true';
      if (filtro === 'minhas') f += `&or=${encodeURIComponent(`(responsavel_id.eq.${eu.id},criado_por.eq.${eu.id})`)}`;
      else if (filtro === 'do_meu_setor') f += `&para_setor=in.(${eu.setores.join(',')})`;
      const lista = await sb.q(`qs_solicitacoes_v?select=${campos}&${f}&order=prazo.asc.nullslast&limit=15`);
      return {
        solicitacoes: (lista || []).map((s) => {
          guardar(`#${s.numero}`, r.solicitacao(s));
          return {
            numero: s.numero, titulo: s.titulo, sobre: s.sobre_nome, tipo: s.tipo_rotulo, status: s.status, prioridade: s.prioridade,
            prazo: horaSP(s.prazo), vencida: s.vencida, de: s.de_setor, para: s.para_setor,
            com: s.responsavel_nome || 'ninguém assumiu', pediu: s.criado_por_nome,
            comigo: s.responsavel_id === eu.id, eu_pedi: s.criado_por === eu.id,
          };
        }),
      };
    },

    async agenda({ dia }) {
      const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dia || '')) ? dia : hojeSP();
      const inicio = new Date(`${d}T00:00:00-03:00`);
      const fim = new Date(inicio.getTime() + 86_400_000);
      const out = { dia: BR(d) };
      if (!eu.setores.includes('comercial')) {
        out.obs = 'Reuniões e atividades são do Comercial; esta pessoa não é do Comercial.';
        return out;
      }
      const intervalo = `scheduled_at=gte.${encodeURIComponent(inicio.toISOString())}&scheduled_at=lt.${encodeURIComponent(fim.toISOString())}`;
      const [reunioes, tarefasDia, atrasadas] = await Promise.all([
        sb.q(`qs_meetings?select=id,title,lead_name,lead_id,scheduled_at,status&or=${encodeURIComponent(`(owner_id.eq.${eu.id},closer_id.eq.${eu.id})`)}&${intervalo}&status=in.(agendada,confirmada,realizada)&order=scheduled_at&limit=20`).catch(() => []),
        sb.q(`qs_tasks?select=id&owner_id=eq.${eu.id}&status=in.(pendente,atrasada)&${intervalo}&limit=500`).catch(() => []),
        sb.q(`qs_tasks?select=id&owner_id=eq.${eu.id}&status=in.(pendente,atrasada)&scheduled_at=lt.${encodeURIComponent(new Date(`${hojeSP()}T00:00:00-03:00`).toISOString())}&limit=500`).catch(() => []),
      ]);
      out.reunioes = (reunioes || []).map((m) => {
        const nome = m.lead_name || m.title || 'Reunião';
        guardar(nome, m.lead_id && eu.role !== 'closer' ? r.lead(m.lead_id) : r.agenda());
        return { hora: horaSP(m.scheduled_at), com: nome, status: m.status };
      });
      out.atividades_do_dia = (tarefasDia || []).length;
      out.atividades_atrasadas_ate_hoje = (atrasadas || []).length;
      return out;
    },

    async detalhes_lead({ lead_id }) {
      if (!UUID.test(String(lead_id || ''))) return { erro: 'lead_id inválido — use o id que veio de buscar_pessoas.' };
      const l = (await sb.q(`qs_leads?select=id,full_name,phone,email,status,source,city,state,created_at,updated_at,owner_id,lead_score&id=eq.${lead_id}&limit=1`))?.[0];
      if (!l) return { erro: 'Lead não encontrado (ou a pessoa não tem acesso a ele).' };
      const [dono, reunioes] = await Promise.all([
        l.owner_id ? sb.q(`qs_users?select=name&id=eq.${l.owner_id}&limit=1`).catch(() => []) : [],
        sb.q(`qs_meetings?select=scheduled_at,status,title&lead_id=eq.${lead_id}&order=scheduled_at.desc&limit=3`).catch(() => []),
      ]);
      guardar(l.full_name, r.lead(l.id));
      return {
        nome: l.full_name, telefone: l.phone, email: l.email, status: l.status, origem: l.source,
        cidade: [l.city, l.state].filter(Boolean).join('/') || null, pontuacao: l.lead_score,
        chegou_em: BR(l.created_at), atualizado_em: BR(l.updated_at), dono: dono?.[0]?.name || null,
        reunioes: (reunioes || []).map((m) => ({ quando: horaSP(m.scheduled_at), status: m.status, titulo: m.title })),
      };
    },
  };
}

// ── A conversa com a IA ────────────────────────────────────────────────────

function instrucao(eu) {
  const hoje = hojeSP();
  return [
    'Você é o assistente da "Bolinha do QS", o sistema interno da agência de viagens Se Tu For, Eu Vou.',
    `Quem pergunta: ${eu.name} (papel: ${eu.role}; áreas: ${eu.setores.join(', ') || 'nenhuma'}).`,
    `Hoje é ${diaDaSemana(hoje)}, ${BR(hoje)} (horário de São Paulo).`,
    'Regras:',
    '- Responda em português do Brasil, curto e prático (no máximo 5 linhas ou uma lista curta). Linguagem simples.',
    '- Use SOMENTE os dados que as ferramentas devolverem. Nunca invente nomes, datas, valores ou status.',
    '- Se não achar, diga claramente que não encontrou (e sugira buscar por outro nome/telefone).',
    '- Para falar de uma pessoa, primeiro use buscar_pessoas; para viagens de um cliente, use viagens_do_cliente com o id dele.',
    '- Se houver mais de uma pessoa com o nome, liste as opções e pergunte qual.',
    '- Escreva os nomes das pessoas exatamente como vieram das ferramentas (o app transforma em links).',
    '- Não mostre ids nem links/URLs na resposta. Você só consulta: não consegue mudar nada no sistema.',
  ].join('\n');
}

async function chamarIa(messages, comFerramentas, prazo) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(Math.max(2_000, Math.min(15_000, prazo - Date.now() - 1_000))),
    body: JSON.stringify({
      model: MODELO(),
      temperature: 0.2,
      max_tokens: 500,
      messages,
      ...(comFerramentas ? { tools: FERRAMENTAS, tool_choice: 'auto' } : {}),
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(r.status === 401 ? 'chave da OpenAI recusada' : `OpenAI HTTP ${r.status}: ${String(j?.error?.message || '').slice(0, 120)}`);
    e.status = r.status;
    throw e;
  }
  return j?.choices?.[0]?.message || null;
}

/** Só devolve os links das pessoas/itens que a resposta cita (no máximo 5). */
function linksCitados(resposta, links) {
  const txt = String(resposta || '').toLowerCase();
  const todos = [...links.entries()].map(([hash, rotulo]) => ({ rotulo, hash }));
  const citados = todos.filter(({ rotulo }) => {
    const r = String(rotulo).toLowerCase().trim();
    if (!r) return false;
    if (txt.includes(r)) return true;
    const doisNomes = r.split(/\s+/).slice(0, 2).join(' ');
    return doisNomes.length >= 5 && txt.includes(doisNomes);
  });
  return (citados.length ? citados : todos.length <= 3 ? todos : []).slice(0, 5);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const { url, anon } = cfg();
  if (!url || !anon) return res.status(503).json({ error: 'O assistente ainda não foi configurado (falta a chave pública do Supabase na Vercel).' });
  if (!String(process.env.OPENAI_API_KEY || '').trim()) return res.status(503).json({ error: 'O assistente ainda não foi configurado (falta a chave da OpenAI na Vercel).' });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const userId = token ? await usuarioDoToken(token) : null;
  if (!userId) return res.status(401).json({ error: 'Sua sessão expirou. Feche e entre de novo na bolinha.' });

  const sb = clienteDaPessoa(token);
  let perfil;
  try { perfil = (await sb.q(`qs_users?select=id,name,role,setores,is_active&id=eq.${userId}&limit=1`))?.[0]; }
  catch { return res.status(502).json({ error: 'Não consegui falar com o banco agora. Tente de novo em instantes.' }); }
  if (!perfil?.is_active) return res.status(403).json({ error: 'Sua conta não está ativa no QS.' });
  const eu = { id: perfil.id, name: perfil.name || 'colega', role: perfil.role, setores: setoresDe(perfil) };

  if (estourou(eu.id)) return res.status(429).json({ error: 'Muitas perguntas seguidas. Espere um minutinho e pergunte de novo.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const pergunta = String(body?.pergunta || '').trim().slice(0, 500);
  if (!pergunta) return res.status(400).json({ error: 'Escreva a pergunta.' });
  const historico = (Array.isArray(body?.historico) ? body.historico : []).slice(-6)
    .filter((m) => m && typeof m.texto === 'string' && m.texto.trim())
    .map((m) => ({ role: m.de === 'eu' ? 'user' : 'assistant', content: m.texto.slice(0, 1500) }));

  const prazo = Date.now() + ORCAMENTO_MS;
  const links = new Map();
  const ferr = ferramentas(sb, eu, links);
  const messages = [{ role: 'system', content: instrucao(eu) }, ...historico, { role: 'user', content: pergunta }];

  try {
    let resposta = null;
    for (let rodada = 0; rodada <= MAX_RODADAS; rodada++) {
      // Última rodada (ou sem tempo): a IA tem que responder com o que já tem.
      const podeFerramenta = rodada < MAX_RODADAS && prazo - Date.now() > 8_000;
      const msg = await chamarIa(messages, podeFerramenta, prazo);
      if (!msg) break;
      const chamadas = podeFerramenta && Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      if (!chamadas.length) { resposta = String(msg.content || '').trim(); break; }
      messages.push({ role: 'assistant', content: msg.content || null, tool_calls: chamadas });
      const resultados = await Promise.all(chamadas.slice(0, 4).map(async (c) => {
        let saida;
        try {
          const fn = ferr[c.function?.name];
          const args = (() => { try { return JSON.parse(c.function?.arguments || '{}'); } catch { return {}; } })();
          saida = fn ? await fn(args) : { erro: 'Ferramenta desconhecida.' };
        } catch (e) {
          saida = { erro: `Não consegui consultar: ${String(e?.message || 'erro').slice(0, 100)}` };
        }
        return { role: 'tool', tool_call_id: c.id, content: JSON.stringify(saida).slice(0, MAX_PAYLOAD) };
      }));
      // toda tool_call precisa de resposta (as que passaram de 4 recebem um aviso)
      for (const c of chamadas.slice(4)) resultados.push({ role: 'tool', tool_call_id: c.id, content: '{"erro":"Muitas consultas de uma vez."}' });
      messages.push(...resultados);
    }
    if (!resposta) resposta = 'Não consegui montar a resposta agora. Tente perguntar de um jeito mais direto (ex.: "viagens da Maria Souza").';
    return res.status(200).json({ resposta, links: linksCitados(resposta, links) });
  } catch (e) {
    console.error('[assistente] falhou:', String(e?.message || '').slice(0, 200));
    const txt = e?.status === 429 ? 'O assistente está muito ocupado agora. Tente de novo em um minuto.'
      : e?.status === 401 ? 'O assistente está sem acesso à IA (chave recusada). Avise o Bruno.'
      : e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'Demorou demais pra responder. Tente uma pergunta mais curta.'
      : 'Não consegui responder agora. Tente de novo em instantes.';
    return res.status(502).json({ error: txt });
  }
}
