// api/gloria-saude.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET  /api/gloria-saude          → o que dá pra saber de graça
//                           POST /api/gloria-saude          → bate na porta de cada integração
//
// AS PORTAS DA GLÓRIA, TODAS NUMA TELA.
//
// Por que isto existe, em números: entre 21 e 26 de agosto, CINCO DIAS foram
// gastos caçando três falhas que tinham o mesmo formato — uma porta fechada que
// não avisava.
//
//   • 21/08 e 24/08 — o n8n devolvia 403 no webhook dela. 403 no n8n não cria
//     execução nenhuma, então o sintoma era "não chega nada no n8n", que parece
//     "o QS não chamou". Causa: a credencial Header Auth não batia com o
//     GLORIA_SECRET da Vercel.
//   • 21→26/08 — o Meet vinha sem link, HTTP 403, por cinco dias. Causa: o campo
//     *Name* da credencial tinha `N8N_AGENDA_SECRET` (o nome da variável) em vez
//     de `x-qs-agenda-secret` (o nome do header).
//   • 25/08 — ela ficou muda. Causa: o *Value* da credencial tinha a string
//     literal `GLORIA_SECRET`.
//
// Três vezes o mesmo bug, e nas três a informação que teria resolvido em 30
// segundos já existia — só não tinha onde aparecer. É isso que esta rota é: o
// lugar onde aparece.
//
// ── POR QUE DUAS VERSÕES (GET e POST) ───────────────────────────────────────
//
// GET é de graça: lê variável de ambiente, banco e histórico. Pode rodar toda
// vez que a tela abre.
//
// POST BATE NA PORTA de verdade — e bater na porta tem custo: uma chamada ao
// n8n cria execução, uma ao Chatwoot consome API. Então é botão, não é
// automático. Só admin/gestor, porque o retorno diz quais integrações existem.
//
// ── O QUE ESTA ROTA NUNCA FAZ ───────────────────────────────────────────────
//
// Mostrar segredo. Nem pedaço, nem tamanho, nem os quatro primeiros caracteres.
// O diagnóstico útil é "configurado / não configurado / a porta recusou", e
// nenhum desses precisa do valor. Vazar segredo pra descobrir por que o segredo
// não funciona seria trocar um problema por um pior.
// -----------------------------------------------------------------------------

import { getSupabaseUserId } from './_wa.js';
import { rest } from './_supabaseAdmin.js';
import { saudeDaFila } from './_gloria.js';
import { CHAVE_TEMPLATE, CHAVE_TETO, abordagensDeHoje } from './_abordagem.js';

const TIMEOUT_MS = 6_000;

/** Um "sim/não" que não conta nada sobre o valor. */
const posto = (v) => !!String(v || '').trim();

/**
 * Um resultado de porta. `estado` é sempre um destes três, porque é o que muda
 * o que a pessoa faz a seguir:
 *   ok      — funciona, siga a vida
 * . atencao — funciona mas tem algo pra arrumar (só o Bruno decide se importa)
 *   erro    — está quebrado AGORA e alguém precisa mexer
 */
const porta = (nome, estado, resumo, extra = {}) => ({ nome, estado, resumo, ...extra });

async function comPrazo(fn, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); } finally { clearTimeout(t); }
}

// ── As portas ───────────────────────────────────────────────────────────────

/**
 * O n8n dela. É a porta que mais quebrou, e a única cujo 403 é invisível do
 * outro lado — por isso o texto do diagnóstico é tão específico: quem lê isto
 * às 22h de um sábado precisa saber exatamente qual campo abrir.
 */
async function bater_n8nGloria() {
  const url = String(process.env.GLORIA_WEBHOOK_URL || '').trim();
  const seg = String(process.env.GLORIA_SECRET || '').trim();
  if (!url) return porta('n8n — a Glória', 'erro', 'GLORIA_WEBHOOK_URL não está configurada na Vercel.');
  if (!seg) return porta('n8n — a Glória', 'erro', 'GLORIA_SECRET não está configurada na Vercel.');

  try {
    const r = await comPrazo((signal) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gloria-secret': seg },
      // `modo: ping` e lead nulo: se o workflow tiver o desvio de ping no topo,
      // ele responde e para. Se não tiver, a execução morre no primeiro nó por
      // falta de lead — feio no histórico do n8n, inofensivo pro cliente.
      body: JSON.stringify({ modo: 'ping', lead_id: null, origem: 'gloria-saude' }),
      signal,
    }));
    if (r.status === 403) {
      return porta('n8n — a Glória', 'erro',
        'O n8n RECUSOU (403): a credencial não bate com o GLORIA_SECRET da Vercel.',
        { conserto: 'n8n → credencial Header Auth do webhook dela. Name = x-gloria-secret. Value = o mesmo texto que está em GLORIA_SECRET na Vercel (sem aspas, sem o nome da variável).' });
    }
    if (r.status === 404) {
      return porta('n8n — a Glória', 'erro',
        'O n8n respondeu 404: o workflow está INATIVO ou a URL mudou.',
        { conserto: 'Abra o workflow no n8n e ligue o botão Active. Se estiver ativo, confira a GLORIA_WEBHOOK_URL (a de produção, não a de teste).' });
    }
    if (!r.ok) return porta('n8n — a Glória', 'atencao', `O n8n respondeu HTTP ${r.status}.`);
    return porta('n8n — a Glória', 'ok', 'A porta abriu e o segredo bate.');
  } catch (e) {
    return porta('n8n — a Glória', 'erro',
      e?.name === 'AbortError' ? 'O n8n não respondeu no prazo.' : `Não consegui alcançar o n8n: ${e?.message}`);
  }
}

/**
 * O n8n da agenda (Google Meet). Mesma família de erro, causa diferente: aqui o
 * que quebrou foi o NOME do header, não o valor.
 */
async function bater_n8nAgenda() {
  const url = String(process.env.N8N_AGENDA_URL || '').trim();
  const seg = String(process.env.N8N_AGENDA_SECRET || '').trim();
  if (!url) return porta('n8n — agenda / Meet', 'atencao', 'N8N_AGENDA_URL não configurada: a reunião é marcada, mas sem link do Meet.');
  if (!seg) return porta('n8n — agenda / Meet', 'erro', 'N8N_AGENDA_SECRET não está configurada na Vercel.');

  try {
    const r = await comPrazo((signal) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-qs-agenda-secret': seg },
      // Sem título e sem data: o objetivo é ver se a porta ABRE. Se abrir, o
      // workflow recusa por falta de dados — que é a resposta que queremos.
      body: JSON.stringify({ ping: true, origem: 'gloria-saude' }),
      signal,
    }));
    if (r.status === 403) {
      return porta('n8n — agenda / Meet', 'erro',
        'O n8n RECUSOU (403). Foi este 403 que segurou o Meet por cinco dias.',
        { conserto: 'n8n → credencial Header Auth da agenda. O campo Name é o NOME DO HEADER: x-qs-agenda-secret. Não é N8N_AGENDA_SECRET — esse é o nome da variável na Vercel, e ele vai no campo Value.' });
    }
    if (r.status === 404) return porta('n8n — agenda / Meet', 'erro', 'O n8n respondeu 404: workflow inativo ou URL errada.');
    return porta('n8n — agenda / Meet', 'ok', `A porta abriu (HTTP ${r.status}) e o segredo bate.`);
  } catch (e) {
    return porta('n8n — agenda / Meet', 'erro',
      e?.name === 'AbortError' ? 'O n8n não respondeu no prazo.' : `Não consegui alcançar: ${e?.message}`);
  }
}

/**
 * A transcrição de áudio. `GET /v1/models` não gasta nada e prova a chave —
 * inclusive prova o caso que dá mais dor de cabeça: chave certa no painel,
 * deploy antigo ainda rodando com a env velha.
 */
async function bater_openai() {
  const chave = String(process.env.OPENAI_API_KEY || '').trim();
  if (!chave) {
    return porta('OpenAI — ouvir áudio', 'atencao',
      'OPENAI_API_KEY não configurada: áudio do cliente entra sem transcrição e a Glória não responde a ele.',
      { conserto: 'Vercel → Settings → Environment Variables → OPENAI_API_KEY, e REDEPLOY (env nova não vale pro deploy que já está no ar).' });
  }
  try {
    const r = await comPrazo((signal) => fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${chave}` }, signal,
    }));
    if (r.status === 401) {
      return porta('OpenAI — ouvir áudio', 'erro', 'A OpenAI recusou a chave (401).',
        { conserto: 'Chave revogada/errada, ou o deploy no ar ainda está com a env antiga. Depois de trocar, faça Redeploy.' });
    }
    if (r.status === 429) return porta('OpenAI — ouvir áudio', 'atencao', 'A OpenAI respondeu 429: sem crédito ou no limite de uso.');
    if (!r.ok) return porta('OpenAI — ouvir áudio', 'atencao', `A OpenAI respondeu HTTP ${r.status}.`);
    return porta('OpenAI — ouvir áudio', 'ok', 'A chave funciona.');
  } catch (e) {
    return porta('OpenAI — ouvir áudio', 'erro',
      e?.name === 'AbortError' ? 'A OpenAI não respondeu no prazo.' : `Não consegui alcançar: ${e?.message}`);
  }
}

/**
 * O WhatsApp oficial, pelo Chatwoot — e, junto, o template do primeiro contato.
 *
 * Esta é a checagem que ninguém pensa em fazer e que morde na hora errada: a
 * Meta PAUSA template que recebe reclamação, e template pausado só aparece como
 * "a abordagem não saiu" no meio de uma campanha rodando.
 */
async function bater_chatwoot() {
  const { cwConfigured, cw } = await import('./_wa.js');
  if (!cwConfigured()) return porta('WhatsApp oficial (Chatwoot)', 'erro', 'As variáveis do Chatwoot não estão configuradas.');

  let inboxes;
  try {
    const d = await cw('/inboxes', { timeoutMs: TIMEOUT_MS });
    inboxes = Array.isArray(d?.payload) ? d.payload : [];
  } catch (e) {
    return porta('WhatsApp oficial (Chatwoot)', 'erro', `O Chatwoot não respondeu: ${e?.message}`);
  }

  const wa = inboxes.filter((i) => String(i.channel_type || '').includes('Channel::Whatsapp'));
  if (!wa.length) return porta('WhatsApp oficial (Chatwoot)', 'erro', 'Nenhuma caixa de WhatsApp encontrada no Chatwoot.');

  // O template escolhido ainda está aprovado?
  let modelo = null;
  try {
    const rows = await rest(`qs_settings?select=value&key=eq.${CHAVE_TEMPLATE}&limit=1`);
    modelo = rows?.[0]?.value || null;
  } catch { /* segue */ }

  if (!modelo?.nome) {
    return porta('WhatsApp oficial (Chatwoot)', 'atencao',
      `${wa.length} caixa(s) de WhatsApp respondendo. Falta escolher o modelo do primeiro contato.`,
      { conserto: 'Sem modelo aprovado ela não consegue puxar assunto com quem veio de formulário — só responde quem escrever primeiro.' });
  }

  const achado = wa
    .flatMap((i) => (Array.isArray(i.message_templates) ? i.message_templates : []))
    .find((t) => t.name === modelo.nome && (!modelo.idioma || t.language === modelo.idioma));

  if (!achado) {
    return porta('WhatsApp oficial (Chatwoot)', 'erro',
      `O modelo "${modelo.nome}" não existe mais nesta conta da Meta.`,
      { conserto: 'Escolha outro modelo aprovado em Atendimento IA → Primeiro contato.' });
  }
  const situacao = String(achado.status || '').toLowerCase();
  if (situacao !== 'approved') {
    return porta('WhatsApp oficial (Chatwoot)', 'erro',
      `O modelo "${modelo.nome}" está ${situacao.toUpperCase()} na Meta — nenhuma abordagem sai enquanto isso.`,
      { conserto: 'A Meta pausa modelo que recebe reclamação. Veja no Gerenciador do WhatsApp e escolha outro enquanto isso.' });
  }

  return porta('WhatsApp oficial (Chatwoot)', 'ok',
    `${wa.length} caixa(s) respondendo. Modelo "${modelo.nome}" aprovado.`);
}

/** O Bitrix, que recebe a reunião marcada. Falhar aqui não para a Glória. */
async function bater_bitrix() {
  const base = String(process.env.BITRIX_WEBHOOK_BASE || '').trim().replace(/\/+$/, '');
  if (!base) return porta('Bitrix', 'atencao', 'BITRIX_WEBHOOK_BASE não configurada: a reunião não vira atividade no card.');
  try {
    const r = await comPrazo((signal) => fetch(`${base}/profile.json`, { signal }));
    if (!r.ok) return porta('Bitrix', 'atencao', `O Bitrix respondeu HTTP ${r.status}.`);
    return porta('Bitrix', 'ok', 'Respondendo.');
  } catch (e) {
    return porta('Bitrix', 'atencao',
      e?.name === 'AbortError' ? 'O Bitrix não respondeu no prazo (ele oscila).' : `Não alcancei: ${e?.message}`);
  }
}

// ── O que dá pra saber sem bater em ninguém ─────────────────────────────────

async function retrato() {
  const chaves = [
    'gloria_ativa', 'gloria_so_pipeline', 'gloria_so_conversa_nova',
    'gloria_toque_inicio', 'gloria_toque_fim', CHAVE_TETO, CHAVE_TEMPLATE,
  ];
  let cfg = {};
  try {
    const rows = await rest(`qs_settings?select=key,value&key=in.(${chaves.join(',')})`);
    cfg = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
  } catch { /* segue */ }

  let cadencia = null;
  try {
    const rows = await rest('qs_cadences?select=id,name,status&execution_mode=eq.ia&limit=1');
    cadencia = rows?.[0] || null;
  } catch { /* segue */ }

  let fila = null;
  try { fila = await saudeDaFila(); } catch { /* segue */ }

  // O contador do dia e o teto: é o único número da tela que responde "posso
  // subir a verba hoje?".
  let hoje = null;
  try { hoje = await abordagensDeHoje(); } catch { /* segue */ }

  return {
    ligada: cfg.gloria_ativa === true,
    soPipeline: cfg.gloria_so_pipeline !== false,
    cadencia,
    janelaDeToques: { inicio: cfg.gloria_toque_inicio ?? null, fim: cfg.gloria_toque_fim ?? null },
    primeiroContato: {
      modelo: cfg[CHAVE_TEMPLATE]?.nome || null,
      idioma: cfg[CHAVE_TEMPLATE]?.idioma || null,
      teto: cfg[CHAVE_TETO] ?? null,
      hoje: hoje === Number.MAX_SAFE_INTEGER ? null : hoje,
    },
    fila,
    // Só a presença. Nunca o valor, nem o tamanho.
    variaveis: {
      GLORIA_WEBHOOK_URL: posto(process.env.GLORIA_WEBHOOK_URL),
      GLORIA_SECRET: posto(process.env.GLORIA_SECRET),
      N8N_AGENDA_URL: posto(process.env.N8N_AGENDA_URL),
      N8N_AGENDA_SECRET: posto(process.env.N8N_AGENDA_SECRET),
      OPENAI_API_KEY: posto(process.env.OPENAI_API_KEY),
      BITRIX_WEBHOOK_BASE: posto(process.env.BITRIX_WEBHOOK_BASE),
      CHATWOOT_API_TOKEN: posto(process.env.CHATWOOT_API_TOKEN),
    },
  };
}

/** As últimas falhas que ela própria registrou. Histórico vale mais que ping. */
async function ultimosTropecos() {
  try {
    const rows = await rest(
      "qs_gloria_log?select=lead_id,motivo,conteudo,criado_em&direcao=eq.erro&order=criado_em.desc&limit=5"
    );
    return rows || [];
  } catch {
    return [];
  }
}

// ── Rota ────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  let userId;
  try {
    userId = await getSupabaseUserId(req.headers.authorization);
  } catch {
    userId = null;
  }
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  let papel = null;
  try {
    const rows = await rest(`qs_users?select=role&id=eq.${encodeURIComponent(userId)}&limit=1`);
    papel = rows?.[0]?.role || null;
  } catch { /* segue */ }

  if (req.method === 'GET') {
    const [r, tropecos] = await Promise.all([retrato(), ultimosTropecos()]);
    return res.status(200).json({ ...r, tropecos });
  }

  if (req.method === 'POST') {
    if (!['admin', 'gestor'].includes(String(papel))) {
      return res.status(403).json({ error: 'Só administrador ou gestor testa as integrações.' });
    }
    // Em paralelo de propósito: seis portas em série passariam do prazo da
    // função, e a mais lenta (Bitrix) não pode segurar as outras cinco.
    const portas = await Promise.all([
      bater_n8nGloria(), bater_n8nAgenda(), bater_openai(), bater_chatwoot(), bater_bitrix(),
    ]);
    const pior = portas.some((p) => p.estado === 'erro') ? 'erro'
      : portas.some((p) => p.estado === 'atencao') ? 'atencao' : 'ok';
    return res.status(200).json({ estado: pior, portas, em: new Date().toISOString() });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Use GET ou POST' });
}
