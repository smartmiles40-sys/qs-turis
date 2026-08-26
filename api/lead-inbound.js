// api/lead-inbound.js
// -----------------------------------------------------------------------------
// Webhook para RECEBER leads de fora (landing pages, formulários, n8n, Bitrix...).
// Cria o lead, distribui automaticamente para um SDR (round-robin por menor carga)
// e gera as tarefas da cadência. Chamada SERVIDOR-A-SERVIDOR (o segredo não pode
// ficar exposto no browser).
//
// Segurança: exige o header  x-lead-secret: <LEAD_INBOUND_SECRET>.
//
// Body (JSON) — campos aceitos (todos opcionais menos ter algum identificador):
//   full_name | first_name/last_name, email, phone, company_name (ou company),
//   segment, city, state, job_title, website, linkedin_url, source,
//   cadence_id (opcional), owner_id (opcional), estimated_value (opcional),
//   bitrix_id (opcional — ID do negócio no Bitrix; deduplica: o mesmo bitrix_id
//   nunca cria dois cards, e permite a volta QS→Bitrix mover a coluna certa)
//
// LISTAS (uma URL por cadência):
//   POST /api/lead-inbound                  → cadência padrão (a mais antiga
//                                             disponível), como sempre foi
//   POST /api/lead-inbound?lista=resgate    → cadência da lista "resgate"
//   Os apelidos ficam em qs_settings.webhook_listas. Apelido desconhecido
//   responde 400 — nunca cai na padrão em silêncio.
//
//   &duplicar=1 (o modo da carga de lista) → o lead entra como card PRÓPRIO na
//   cadência da lista, mesmo que já exista alguém com o mesmo telefone, e sem
//   abrir negócio no Bitrix. O card antigo não é tocado.
//
//   &mover=1 (alternativa) → em vez de criar card novo, MOVE o lead existente
//   para a cadência desta lista. NÃO move lead ganho, com reunião marcada ou
//   com atividade em aberto — nesses casos volta o motivo do bloqueio.
//
// Resposta: { success, lead_id, owner_id, cadence_id, tasks_created }
// -----------------------------------------------------------------------------
import { createInboundLead, moverLeadParaCadencia } from './_leads.js';
import { segredoConfere, rest } from './_supabaseAdmin.js';
import { entregarAGloria } from './_gloriaEntrada.js';

// UUID v4 (formato geral de UUID). cadence_id/owner_id inválidos antes iam
// direto pra querystring do PostgREST e o caller recebia o erro cru do banco.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── LISTAS: uma URL por cadência de destino ─────────────────────────────────
// Por que existe (Bruno, 18/08): "quero um webhook para leads novos e outro
// para os de resgate, assim não temos mais problema com divisões". Dava pra
// mandar cadence_id no corpo — a rota já aceita —, mas isso obriga a lembrar de
// um UUID em cada automação, e um payload montado errado joga lead de resgate
// no meio de quem está sendo trabalhado. Com apelido na URL, cada origem tem
// seu endereço fixo e o destino é conferido AQUI.
//
// O mapa mora em qs_settings.webhook_listas (jsonb), no formato
// { "resgate": "<uuid da cadência>", "black-friday": "<uuid>" }, então criar
// uma lista nova é cadastrar a cadência e acrescentar uma linha — sem deploy.
async function cadenciaDaLista(apelido) {
  const rows = await rest('qs_settings?select=value&key=eq.webhook_listas&limit=1');
  const mapa = Array.isArray(rows) && rows[0] ? rows[0].value : null;
  if (!mapa || typeof mapa !== 'object') return null;
  const id = mapa[apelido];
  return typeof id === 'string' && UUID_RE.test(id) ? id : null;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Health check público continua mudo. COM o segredo, devolve os apelidos de
    // lista configurados — é como conferir se a URL nova está de pé antes de
    // ligar a automação, sem precisar criar um lead de teste.
    const s = process.env.LEAD_INBOUND_SECRET;
    if (s && segredoConfere(req.headers['x-lead-secret'], s)) {
      try {
        const rows = await rest('qs_settings?select=value&key=eq.webhook_listas&limit=1');
        const mapa = Array.isArray(rows) && rows[0] && typeof rows[0].value === 'object' ? rows[0].value : {};
        return res.status(200).json({ ok: true, service: 'lead-inbound', listas: Object.keys(mapa) });
      } catch {
        return res.status(200).json({ ok: true, service: 'lead-inbound', listas: null });
      }
    }
    return res.status(200).json({ ok: true, service: 'lead-inbound' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Use POST' });
  }

  const secret = process.env.LEAD_INBOUND_SECRET;
  if (!secret) {
    return res.status(500).json({ success: false, error: 'LEAD_INBOUND_SECRET não configurado no servidor' });
  }
  if (!segredoConfere(req.headers['x-lead-secret'], secret)) {
    return res.status(401).json({ success: false, error: 'Não autorizado' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};

  // Log de diagnóstico SEM PII (LGPD): só as CHAVES do payload + bitrix_id.
  // (O log completo já cumpriu o papel de descobrir o campo da temperatura.)
  try { console.log('[lead-inbound] payload recebido (chaves):', Object.keys(body).join(', '), '| bitrix_id:', body.bitrix_id ?? '-'); } catch { /* ignora */ }

  // precisa de ao menos um identificador
  if (!body.email && !body.phone && !body.full_name && !body.first_name) {
    return res.status(400).json({ success: false, error: 'Informe ao menos email, phone ou nome do lead' });
  }

  // cadence_id/owner_id, quando presentes, precisam SER UUIDs — barra aqui com
  // 400 claro em vez de deixar o PostgREST estourar lá dentro.
  for (const field of ['cadence_id', 'owner_id']) {
    if (body[field] != null && body[field] !== '' && !UUID_RE.test(String(body[field]))) {
      return res.status(400).json({ success: false, error: `${field} inválido (esperado UUID)` });
    }
  }

  // ?lista=resgate manda o lead para a cadência daquela lista. Um apelido que
  // não existe é ERRO, nunca "cai na cadência padrão": um typo no n8n
  // despejaria a base de resgate na fila de quem está sendo trabalhado, que é
  // exatamente o problema que as listas vieram resolver. A URL vence o corpo —
  // quem configurou o endereço sabe para onde aquela origem manda.
  const lista = typeof req.query?.lista === 'string' ? req.query.lista.trim().toLowerCase() : '';
  // &mover=1 autoriza trazer um lead que JÁ existe para a cadência desta lista.
  // Fica desligado por padrão: mexer na cadência de um lead alheio é o tipo de
  // coisa que tem que ser pedida, nunca acontecer por acidente.
  const mover = /^(1|true|sim)$/i.test(String(req.query?.mover ?? ''));
  // &duplicar=1 — o modo da carga de lista. O lead entra como card PRÓPRIO na
  // cadência da lista, mesmo que já exista alguém com o mesmo telefone, e SEM
  // abrir negócio no Bitrix. O card antigo não é tocado: continua com o
  // histórico e a cadência dele. É o caminho mais seguro pra uma frente de
  // trabalho paralela, porque nada é sobrescrito.
  const duplicar = /^(1|true|sim)$/i.test(String(req.query?.duplicar ?? ''));
  if (lista) {
    let destino;
    try {
      destino = await cadenciaDaLista(lista);
    } catch (e) {
      console.error('[lead-inbound] falha ao ler webhook_listas:', e?.message || e);
      return res.status(500).json({ success: false, error: 'Não consegui resolver a lista' });
    }
    if (!destino) {
      return res.status(400).json({
        success: false,
        error: `Lista "${lista}" não configurada. Cadastre-a em qs_settings.webhook_listas com o id da cadência.`,
      });
    }
    body.cadence_id = destino;
  }

  try {
    // Com &mover=1 a busca por duplicado ignora a janela de 24h: numa carga de
    // resgate as pessoas estão no QS há meses, e sem isso todas duplicariam.
    const { lead, ownerId, cadenceId, tasks, deduped } = await createInboundLead(body, { buscarEmQualquerEpoca: mover, cardProprio: duplicar });

    // O lead JÁ existia e a URL pediu &mover=1: traz ele pra cadência da lista.
    // Sem isto, a lista de resgate não funciona na prática — a maioria dessas
    // pessoas está no QS há meses, então o dedupe respondia "já existia" e o
    // lead nunca saía do lugar. As travas ficam em moverLeadParaCadencia: lead
    // ganho, com reunião marcada ou com atividade em aberto NÃO é movido, e o
    // motivo volta na resposta pra aparecer no histórico do n8n.
    let movido = null;
    if (deduped && mover && !duplicar && lista && lead) {
      try {
        movido = await moverLeadParaCadencia(lead, body.cadence_id);
      } catch (e) {
        console.error('[lead-inbound] mover falhou:', e?.message || e);
        movido = { movido: false, motivo: 'erro-ao-mover' };
      }
    }

    // ── ATENDIMENTO POR IA ────────────────────────────────────────────────
    // A cadência de destino é a da Glória? Então o lead entra no pipeline dela
    // e ela puxa assunto — sem ninguém arrastar card. É isto que faz uma
    // campanha de tráfego cair na IA em vez de na fila do SDR.
    //
    // Nunca derruba a criação do lead: falhar aqui deixa um lead normal, que é
    // o comportamento de sempre. Lead pago perdido não tem desfazer.
    let ia;
    try {
      ia = await entregarAGloria({ lead, cadenceId, ownerId, deduped });
    } catch (e) {
      console.error('[lead-inbound] entrada na IA falhou:', e?.message || e);
      ia = { ok: false, motivo: 'erro', detalhe: e?.message };
    }

    return res.status(200).json({
      success: true,
      lead_id: lead.id,
      owner_id: ownerId,
      cadence_id: cadenceId,
      tasks_created: tasks,
      // true = o lead JÁ existia (dedupe) — o n8n usa isso pra não repetir a nota de origem
      deduped: Boolean(deduped),
      // Ecoa a lista usada: dá pra conferir no histórico do n8n que aquela
      // origem entregou na cadência certa, sem abrir o QS.
      lista: lista || null,
      // Só aparece quando &mover=1 foi pedido num lead que já existia.
      // { movido: true, tarefas: N } ou { movido: false, motivo: "..." }.
      movido: movido || undefined,
      cadence_id_final: movido?.movido ? body.cadence_id : cadenceId,
      // Só aparece quando a cadência de destino é a do atendimento por IA.
      // { entrou: true, abordagem: { ok, porta } } — o n8n registra isso no
      // histórico, então dá pra ver pelo lado de fora se ela falou ou não.
      ia: ia?.aplicavel ? ia : undefined,
    });
  } catch (err) {
    // Detalhe completo SÓ no log do servidor (Vercel). Pro caller vai mensagem
    // genérica — err.message podia carregar SQL/URL do PostgREST (fingerprinting).
    console.error('[lead-inbound]', err?.code || '', err?.message || err, err?.details || '');
    return res.status(500).json({
      success: false,
      error: 'Falha ao criar lead',
      // código curto e estável (ex.: CONFIG, TIMEOUT, 23505) — útil pro retry do
      // n8n sem expor a mensagem interna.
      code: typeof err?.code === 'string' || typeof err?.code === 'number' ? err.code : undefined,
    });
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
