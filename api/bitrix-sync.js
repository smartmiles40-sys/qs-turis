// api/bitrix-sync.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): POST /api/bitrix-sync
// PROXY autenticado do sync QS → Bitrix (webhooks do n8n).
//
// Por que existe: antes o navegador chamava o n8n DIRETO (VITE_N8N_SYNC_BASE no
// bundle + webhooks sem auth) — qualquer visitante podia extrair a URL e mover
// negócios no Bitrix. Agora a URL do n8n e o segredo ficam SÓ no servidor.
//
// Body (JSON): { "event": "perdido"|"ganho"|"reuniao"|"nota"|"primeiro-contato", "lead_id": uuid, ...payload }
//   → encaminhado para `${N8N_SYNC_BASE}/qs-<event>` com o header
//     x-qs-sync-secret = N8N_SYNC_SECRET (validar no nó Webhook do n8n).
//   O `bitrix_id` é resolvido AQUI a partir do lead_id (qs_leads via service
//   role) — o valor enviado pelo cliente é ignorado. Lead sem bitrix_id → skip
//   silencioso ({ success: true, code: "skipped_no_bitrix_id" }).
//
// Segurança (igual ao chatapp-send, fail-closed):
//   1. Servidor-a-servidor: header x-internal-secret = INTERNAL_API_SECRET.
//   2. Usuário logado no QS: Authorization: Bearer <access_token Supabase>.
//
// Env (Vercel): N8N_SYNC_BASE (sem barra final), N8N_SYNC_SECRET.
// Sem N8N_SYNC_BASE → responde { code: "not_configured" } e o front ignora.
// -----------------------------------------------------------------------------

import { rest, insert, segredoConfere } from './_supabaseAdmin.js';
import { bx, comentarNoNegocio, bitrixConfigurado } from './_bitrixLead.js';

// 'primeiro-contato' (2026-07-28): o SDR conclui a 1ª atividade no QS e o negócio
// anda sozinho de "Novo lead" para "Follow-up 1" no Bitrix. Quem decide se move é
// o n8n (só move o que ainda está em Novo lead) — aqui é só o repasse.
// 'reuniao-campos' (2026-08-14): desfecho da reunião preenche os CAMPOS do
// negócio direto no Bitrix (datas, flags, SAL) — sem passar pelo n8n.
const EVENTS = new Set(['perdido', 'ganho', 'reuniao', 'nota', 'primeiro-contato', 'reuniao-campos']);

// ─── Desfecho da reunião → campos do negócio ─────────────────────────────────
// Mapeamento confirmado com o Bruno em 14/08, campo a campo, lido do portal via
// crm.deal.fields (o rótulo mora no formLabel — o userfield.list vem sem rótulo).
// Se um campo for RECRIADO no Bitrix, o UF_CRM_* muda: atualizar AQUI.
//
// Vai DIRETO ao Bitrix (env BITRIX_WEBHOOK_BASE, ex.:
// https://xxx.bitrix24.com.br/rest/23/token) em vez de pelo n8n: atualizar
// campo é um crm.deal.update de uma chamada — sem workflow pra importar, sem
// header de credencial pra divergir (a lição das 4 quebras de 07/08).
const CAMPO = {
  realizada_data:  'UF_CRM_1767825384035', // date  "Data da reunião realizada/Proposta enviada"
  realizada_flag:  'UF_CRM_1762283634897', // enum  "Reunião realizada?"
  no_show_data:    'UF_CRM_1767828211464', // date  "Data de No Show"
  no_show_texto:   'UF_CRM_1761758153832', // string "No Show?"
  reagendamento:   'UF_CRM_1785277621436', // date  "Reagendamento"
  meet_datahora:   'UF_CRM_1773943863374', // datetime "Data e hora do agendamento (Google Meet)"
  sal:             'UF_CRM_1785533874395', // enum  "SAL"
  tipo_venda:      'UF_CRM_1743296167520', // enum  "Tipo de venda" (2119 negócios usam)
  valor:           'OPPORTUNITY',          // double — o "Total" do card, campo nativo
  produto:         'UF_CRM_1773954690276', // string "Produto (Descritivo da Reunião)" (443 usam)
};

// ⚠️ ENUM DO BITRIX É STRING (medido 17/08 nos 671 negócios que já têm o campo:
// vêm como "761"/"763"/"803"). Mandando número, o crm.deal.update aceita a
// chamada e IGNORA o campo em silêncio — era por isso que a data gravava e
// "Reunião realizada?" ficava vazio em todo desfecho lançado pelo QS.
const OPCAO = {
  realizada_sim: '761',   // "Reunião realizada?" → Sim
  realizada_nao: '763',   // "Reunião realizada?" → Não
  sal_aceito:    '1427',  // "SAL" → Aceito
  sal_recusado:  '1429',  // "SAL" → Recusado
};

// Etapas do funil do CLOSER (categoria 0 — "Negociação #NNNNN"), lidas do portal
// em 17/08. O lead do QS aponta pra ESTE negócio (bitrix_id), não pro do funil 25
// de pré-vendas. Se uma etapa for recriada no Bitrix, o código muda: atualizar aqui.
const ETAPA = {
  negociacao:    'UC_YGG9JY',  // "Em Negociação"  — para onde vai quem fez a reunião
  no_show:       'UC_3Y96XD',  // "No-Show"
  reagendamento: 'UC_ANBZSL',  // "Reagendamento"  — separado do no-show a pedido do Bruno
};

/**
 * Os campos que cada desfecho escreve. `d` = dados que o front mandou.
 *
 * Fluxo confirmado com o Bruno em 17/08, campo a campo contra o portal:
 *   realizada → data da reunião + valor + tipo da venda → etapa "Em Negociação"
 *   no_show   → data de no-show + valor + tipo da venda → etapa "No-Show"
 *   remarcada → data de reagendamento                    → etapa "Reagendamento"
 *   cancelada → NADA no Bitrix (só Google Agenda e QS)
 *
 * Valor e tipo só entram quando o closer preencheu — o filtro de vazios lá
 * embaixo tira o resto, pra nunca APAGAR um valor que já esteja no card.
 */
const CAMPOS_POR_DESFECHO = {
  realizada: (d) => ({
    [CAMPO.realizada_data]: d.data,
    [CAMPO.realizada_flag]: OPCAO.realizada_sim,
    [CAMPO.valor]: d.valor,
    [CAMPO.tipo_venda]: d.tipo_venda,
    STAGE_ID: ETAPA.negociacao,
  }),
  no_show: (d) => ({
    [CAMPO.no_show_data]: d.data,
    [CAMPO.no_show_texto]: 'Sim',
    [CAMPO.realizada_flag]: OPCAO.realizada_nao,
    [CAMPO.valor]: d.valor,
    [CAMPO.tipo_venda]: d.tipo_venda,
    STAGE_ID: ETAPA.no_show,
  }),
  remarcada: (d) => ({
    [CAMPO.reagendamento]: d.nova_data,
    [CAMPO.meet_datahora]: d.nova_data_hora,
    STAGE_ID: ETAPA.reagendamento,
  }),
  sal_aceito:   () => ({ [CAMPO.sal]: OPCAO.sal_aceito }),
  sal_recusado: () => ({ [CAMPO.sal]: OPCAO.sal_recusado }),
  // O QUE É A REUNIÃO ("Expedição Itália", "Pacote Japão/China/Coreia"). Sai no
  // AGENDAMENTO, não no desfecho: é a informação que o especialista precisa
  // ANTES de entrar na reunião. Não muda etapa nenhuma — só descreve o negócio.
  produto:      (d) => ({ [CAMPO.produto]: d.produto }),
};

/**
 * crm.deal.update direto no Bitrix. Timeout de 7s pela mesma regra do n8n
 * (fetch < maxDuration, senão a Vercel mata a função antes do abort).
 */
async function atualizarCamposBitrix(bitrixId, fields) {
  const base = (process.env.BITRIX_WEBHOOK_BASE || '').trim().replace(/\/+$/, '');
  if (!base) return { ok: false, code: 'not_configured' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7_000);
  try {
    const r = await fetch(`${base}/crm.deal.update.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bitrixId, fields }),
      signal: ctrl.signal,
    });
    const json = await r.json().catch(() => null);
    if (!r.ok || json?.error) {
      console.error('[bitrix-sync] crm.deal.update recusou:', r.status, json?.error_description || json?.error || '');
      return { ok: false, code: 'bitrix-recusou' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[bitrix-sync] crm.deal.update:', err?.name === 'AbortError' ? 'timeout 7s' : err?.message);
    return { ok: false, code: 'bitrix-inacessivel' };
  } finally {
    clearTimeout(timer);
  }
}

// ─── 1º CONTATO, NOTA e PERDIDO: direto no Bitrix, sem passar pelo n8n ───────
//
// POR QUE SAÍRAM DO n8n (medição de produção em 24/08). Em 17 dias, os logs da
// Vercel acumularam 227 × "n8n respondeu 403 para primeiro-contato" e 257 ×
// "403 para nota" — enquanto `reuniao`, que sai do MESMO código com os MESMOS
// headers, passava (71 reuniões sincronizadas no período). Header igual com
// resultado diferente só tem uma explicação: quem atendia esses endereços não
// era o workflow que a gente editava, e sim uma cópia antiga registrada no
// mesmo path, com outra credencial.
//
// Foi o TERCEIRO modo de falha do mesmo elo em três semanas — credencial
// trocada (07/08), endereço disputado por dois workflows (24/08), e o nó
// `Config Nota` que descartava o corpo do webhook e quebrava o comentário
// mesmo quando a chamada entrava.
//
// Mover o card é um `crm.deal.get` + um `crm.deal.update`. Comentar é uma
// chamada. Nada disso precisa de workflow — e sem workflow não existe header
// pra divergir nem path pra disputar. É a mesma decisão (e o mesmo caminho) que
// o `reuniao-campos` já usava desde 14/08.
//
// `ganho` e `reuniao` continuam no n8n de propósito: o ganho depende de uma
// coluna que ninguém decidiu ainda (STAGE_GANHO vazio no fluxo) e a reunião
// depende do catálogo de campos (0042), que é trabalho de workflow de verdade.
const PRE_VENDAS = {
  novo_lead:  'C25:PREPAYMENT_INVOIC',  // "Novo Lead - Aguardando resposta"
  follow_up1: 'C25:UC_271QUB',          // "Follow-up 1"
  perdido:    'C25:LOSE',               // "Leads perdidos"
  categoria:  '25',                     // funil "Pré-Vendas - Comercial"
};

const EVENTOS_DIRETOS = new Set(['primeiro-contato', 'nota', 'perdido']);

/** Lê o negócio no Bitrix. `null` = recusou ou não existe (nunca estoura). */
async function lerNegocio(bitrixId) {
  try {
    return (await bx('crm.deal.get', { id: Number(bitrixId) }, 6_000)) || null;
  } catch (err) {
    console.error('[bitrix-sync] crm.deal.get', bitrixId, ':', err?.message);
    return null;
  }
}

/**
 * O 1º contato move o card de "Novo Lead" para "Follow-up 1".
 *
 * A regra é a MESMA do n8n, copiada intacta: só anda quem AINDA está na
 * primeira coluna. Não existe contador nem flag — da 2ª atividade em diante o
 * evento chega, olha e não faz nada. É isso que torna o disparo idempotente e
 * impede o robô de puxar PRA TRÁS um negócio que já avançou (Reunião, Ganho,
 * Perdido).
 */
async function moverPrimeiroContato(bitrixId) {
  const deal = await lerNegocio(bitrixId);
  if (!deal) return { ok: false, code: 'bitrix-inacessivel' };
  if (String(deal.STAGE_ID || '') !== PRE_VENDAS.novo_lead) {
    return { ok: true, code: 'ja_saiu_de_novo_lead' };
  }
  try {
    await bx('crm.deal.update', {
      id: Number(bitrixId),
      fields: { STAGE_ID: PRE_VENDAS.follow_up1 },
      params: { REGISTER_SONET_EVENT: 'Y' },
    }, 6_000);
  } catch (err) {
    console.error('[bitrix-sync] mover pra Follow-up 1:', err?.message);
    return { ok: false, code: 'bitrix-recusou' };
  }
  return { ok: true, code: 'movido' };
}

/**
 * Perdido: manda o card pra "Leads perdidos" e diz por quê.
 *
 * A GUARDA DE FUNIL importa. `C25:LOSE` só existe dentro do funil 25. Mandar
 * essa etapa pra um negócio de OUTRO funil (o do closer, por exemplo) arrasta o
 * card pra fora do lugar onde o time trabalha — some do kanban de quem estava
 * cuidando dele. Fora do 25, a perda vira só um comentário na timeline, que é
 * informação sem estrago.
 */
async function moverParaPerdido(bitrixId, motivo) {
  const deal = await lerNegocio(bitrixId);
  if (!deal) return { ok: false, code: 'bitrix-inacessivel' };

  const noFunil25 = String(deal.CATEGORY_ID ?? '') === PRE_VENDAS.categoria;
  if (noFunil25 && String(deal.STAGE_ID || '') !== PRE_VENDAS.perdido) {
    try {
      await bx('crm.deal.update', {
        id: Number(bitrixId),
        fields: { STAGE_ID: PRE_VENDAS.perdido },
        params: { REGISTER_SONET_EVENT: 'Y' },
      }, 6_000);
    } catch (err) {
      console.error('[bitrix-sync] mover pra Perdido:', err?.message);
      return { ok: false, code: 'bitrix-recusou' };
    }
  }

  await comentarNoNegocio(bitrixId,
    `❌ Lead marcado como PERDIDO no QS.\nMotivo: ${motivo || 'não informado'}` +
    (noFunil25 ? '' : '\n(a coluna não foi alterada: este negócio não está no funil de Pré-Vendas)'),
    6_000);
  return { ok: true, code: noFunil25 ? 'movido' : 'so_comentario' };
}

/**
 * Carimba no lead o último evento de funil já espelhado no Bitrix.
 *
 * Reaproveita `qs_leads.bitrix_status_synced`, criada pela 0006 pro modelo
 * antigo de polling e sem uso desde que o sync virou por evento. Serve a duas
 * coisas: (1) o 1º contato de um lead já espelhado nem consulta o Bitrix, o que
 * mata a rajada da conclusão em lote — que dispara um evento POR TAREFA num
 * CRM que aceita ~2 req/s; (2) dá pra CONTAR quantos leads o robô moveu, que
 * era exatamente o que faltava: o caminho antigo não escrevia nada de volta, e
 * por isso ninguém percebeu 17 dias de 403.
 */
async function marcarFunilSincronizado(leadId, valor) {
  try {
    await rest(`qs_leads?id=eq.${encodeURIComponent(leadId)}`, {
      method: 'PATCH', body: { bitrix_status_synced: valor }, prefer: 'return=minimal',
    });
  } catch (err) {
    console.warn('[bitrix-sync] não deu pra marcar o lead', leadId, ':', err?.message);
  }
}

/** Deixa no histórico do lead o rastro de que o card andou (best-effort). */
async function anotarNoLead(leadId, corpo, tags) {
  try {
    await insert('qs_notes', { lead_id: leadId, author_id: null, body: corpo, tags }, { returning: false });
  } catch (err) {
    console.warn('[bitrix-sync] nota do movimento falhou (segue):', err?.message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Devolve o ID do usuário autenticado (ou null). Antes esta função devolvia um
 * BOOLEANO e a identidade era jogada fora — então qualquer pessoa logada movia
 * o negócio de QUALQUER lead no Bitrix, inclusive marcando como ganho/perdido o
 * lead de outro SDR. Precisamos do id para checar a posse mais abaixo.
 */
async function getSupabaseUserId(authHeader) {
  const jwt = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${jwt}` },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const user = await r.json();
    return (user && user.id) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Este usuário pode mexer neste lead? Mesma regra da RLS (0007/0022).
 *
 * Recebe o lead JÁ LIDO. Antes esta função buscava `qs_leads` por conta própria
 * e o handler buscava a MESMA linha logo depois pro `bitrix_id` — duas idas ao
 * PostgREST pro mesmo lead, numa rota que tinha 10s no total. O
 * "Task timed out after 10 seconds" apareceu 360 vezes em agosto, com esta rota
 * na lista.
 */
async function podeMexerNoLead(userId, lead) {
  const users = await rest(`qs_users?select=role,is_active&id=eq.${encodeURIComponent(userId)}&limit=1`);
  const user = (Array.isArray(users) && users[0]) || null;
  if (!user || user.is_active === false) return { ok: false, reason: 'usuario-invalido' };
  if (!lead) return { ok: false, reason: 'lead-inexistente' };
  if (user.role === 'admin' || user.role === 'gestor' || user.role === 'closer') return { ok: true };
  if (lead.owner_id === userId || lead.owner_id == null) return { ok: true };
  return { ok: false, reason: 'lead-de-outro-sdr' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Use POST' });
  }

  // Autorização SEMPRE exigida (fail-closed).
  const secret = process.env.INTERNAL_API_SECRET;
  const bySecret = segredoConfere(req.headers['x-internal-secret'], secret);
  const userId = bySecret ? null : await getSupabaseUserId(req.headers['authorization']);
  if (!bySecret && !userId) {
    return res.status(401).json({ success: false, error: 'Não autorizado' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const { event, ...payload } = body;
  if (!EVENTS.has(event)) {
    return res.status(400).json({ success: false, error: 'event inválido (perdido|ganho|reuniao|nota|primeiro-contato)' });
  }

  // bitrix_id NUNCA vem do cliente (auditoria 2026-07-14): qualquer usuário
  // logado podia apontar o evento pra um deal ARBITRÁRIO do Bitrix. Agora o
  // servidor resolve o bitrix_id a partir do lead_id, na fonte da verdade
  // (qs_leads, via service_role), e ignora o que veio no payload.
  const leadId = String(payload.lead_id || '').trim();
  if (!UUID_RE.test(leadId)) {
    return res.status(400).json({ success: false, error: 'lead_id inválido (esperado UUID)' });
  }

  // A correção de 14/07 fechou o bitrix_id (o servidor resolve), mas o lead_id
  // continuava livre: um SDR podia marcar como ganho/perdido no Bitrix o negócio
  // de um lead que não é dele — e forjar closed_value junto. Agora a posse é
  // conferida no banco, com a mesma regra da RLS. O caminho do segredo interno
  // (n8n) segue sem essa checagem, de propósito: lá não existe "usuário".
  // UMA leitura do lead atende os três usos: a posse, o bitrix_id e a marca do
  // funil. Eram duas antes, pro mesmo lead, na mesma requisição.
  let lead = null;
  try {
    const rows = await rest(
      `qs_leads?select=owner_id,bitrix_id,bitrix_status_synced&id=eq.${encodeURIComponent(leadId)}&limit=1`
    );
    lead = (rows && rows[0]) || null;
  } catch (err) {
    console.error('[bitrix-sync] falha ao ler o lead', leadId, ':', err?.message);
    return res.status(502).json({ success: false, error: 'Falha ao consultar o lead' });
  }

  if (userId) {
    let posse;
    try {
      posse = await podeMexerNoLead(userId, lead);
    } catch (err) {
      console.error('[bitrix-sync] falha ao checar posse do lead', leadId, ':', err?.message);
      return res.status(502).json({ success: false, error: 'Falha ao validar o lead' });
    }
    if (!posse.ok) {
      console.warn('[bitrix-sync] recusado:', userId, '→', leadId, `(${posse.reason})`);
      const status = posse.reason === 'lead-inexistente' ? 404 : 403;
      return res.status(status).json({ success: false, error: 'Sem acesso a este lead', motivo: posse.reason });
    }
  }

  const serverBitrixId = (lead && lead.bitrix_id) || null;
  if (!serverBitrixId) {
    // Lead sem vínculo com o Bitrix (não veio de lá) — mesmo comportamento de
    // sempre: pula sem erro (o front já pulava quando não tinha bitrix_id).
    return res.status(200).json({ success: true, code: 'skipped_no_bitrix_id' });
  }
  payload.bitrix_id = serverBitrixId; // sobrescreve qualquer valor do cliente

  // ── Desfecho de reunião → campos do negócio (caminho direto, sem n8n) ──────
  if (event === 'reuniao-campos') {
    const monta = CAMPOS_POR_DESFECHO[String(payload.desfecho || '')];
    if (!monta) {
      return res.status(400).json({ success: false, error: 'desfecho inválido (realizada|no_show|remarcada|sal_aceito|sal_recusado)' });
    }
    // Só entra no update o que veio preenchido — mandar undefined pro Bitrix
    // apagaria o valor que está lá.
    const fields = Object.fromEntries(
      Object.entries(monta(payload)).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    if (!Object.keys(fields).length) {
      return res.status(400).json({ success: false, error: 'nenhum campo a atualizar' });
    }
    const r = await atualizarCamposBitrix(serverBitrixId, fields);
    if (!r.ok && r.code === 'not_configured') {
      return res.status(200).json({ success: false, code: 'not_configured' });
    }
    return res.status(r.ok ? 200 : 502).json(r.ok ? { success: true } : { success: false, error: r.code });
  }

  // ── Caminho DIRETO ao Bitrix (sem n8n) ────────────────────────────────────
  // Só quando o Bitrix está configurado. Sem BITRIX_WEBHOOK_BASE, cai no n8n
  // como antes — nada regride num ambiente que ainda não tem a env.
  if (EVENTOS_DIRETOS.has(event) && bitrixConfigurado()) {
    if (event === 'nota') {
      const corpo = String(payload.body || '').trim();
      if (!corpo) return res.status(400).json({ success: false, error: 'nota sem corpo' });
      const id = await comentarNoNegocio(serverBitrixId, `📝 QS Turis: ${corpo}`, 6_000);
      return id
        ? res.status(200).json({ success: true, code: 'comentado' })
        : res.status(502).json({ success: false, error: 'bitrix-recusou' });
    }

    if (event === 'primeiro-contato') {
      // Lead já espelhado nem consulta o Bitrix: é o que segura a rajada da
      // conclusão em lote (um evento por tarefa) num CRM de ~2 req/s.
      if (lead.bitrix_status_synced) {
        return res.status(200).json({ success: true, code: 'ja_espelhado' });
      }
      const r = await moverPrimeiroContato(serverBitrixId);
      if (!r.ok) return res.status(502).json({ success: false, error: r.code });

      if (r.code === 'movido') {
        await comentarNoNegocio(serverBitrixId,
          '🤖 1º CONTATO FEITO (QS Turis) — negócio movido de "Novo Lead" para "Follow-up 1".' +
          `\nCanal: ${payload.canal || '-'}` +
          `\nDesfecho: ${payload.desfecho || '-'}` +
          `\nSDR: ${payload.sdr || '-'}`,
          6_000);
        await anotarNoLead(leadId,
          '🤖 Bitrix: card movido de "Novo Lead" para "Follow-up 1" (1º contato).',
          ['bitrix', 'primeiro-contato']);
      }
      // Carimba inclusive quando o card já tinha saído da coluna: a resposta do
      // Bitrix não muda, e perguntar de novo a cada atividade é desperdício.
      await marcarFunilSincronizado(leadId, 'primeiro-contato');
      return res.status(200).json({ success: true, code: r.code });
    }

    // perdido
    const r = await moverParaPerdido(serverBitrixId, payload.loss_reason);
    if (!r.ok) return res.status(502).json({ success: false, error: r.code });
    await marcarFunilSincronizado(leadId, 'perdido');
    return res.status(200).json({ success: true, code: r.code });
  }

  const base = (process.env.N8N_SYNC_BASE || '').trim().replace(/\/+$/, '');
  if (!base) {
    // Integração ainda não configurada — no-op declarado (o front não mostra erro).
    return res.status(200).json({ success: false, code: 'not_configured' });
  }

  // Manda os DOIS nomes de header, com o mesmo segredo.
  //
  // Por quê: o n8n valida NOME + valor. Como os sete webhooks dividem uma única
  // credencial de Header Auth, o nome dela vira uma variável global — e em 07/08
  // isso derrubou a integração quatro vezes seguidas, porque arrumar o
  // sincronismo quebrava a agenda e vice-versa, dependendo de qual nome estava
  // salvo naquele momento.
  //
  // Mandando os dois, o nome deixa de importar: qualquer que seja o configurado,
  // a requisição carrega. Sobra uma única coisa para acertar — o VALOR. Header a
  // mais é ignorado por quem não o espera, então não há custo.
  const headers = { 'Content-Type': 'application/json' };
  const sync = (process.env.N8N_SYNC_SECRET || '').trim();
  const agenda = (process.env.N8N_AGENDA_SECRET || '').trim();
  if (sync || agenda) {
    headers['x-qs-sync-secret'] = sync || agenda;
    headers['x-qs-agenda-secret'] = agenda || sync;
  }

  // Timeout: n8n lento não pode segurar a função até o limite da Vercel.
  // 7s, não 10s: o maxDuration da rota É 10s e a autenticação que roda antes
  // gasta até 5s — timeout igual ao teto significa que a Vercel mata a função
  // ANTES do abort disparar (a regra de _wa.js: o timeout do fetch tem que ser
  // MENOR que o maxDuration, senão ele nunca age).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7_000);
  try {
    const r = await fetch(`${base}/qs-${event}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event, ...payload }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.error('[bitrix-sync] n8n respondeu', r.status, 'para', event);
      return res.status(502).json({ success: false, error: `n8n HTTP ${r.status}` });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[bitrix-sync]', event, err?.name === 'AbortError' ? 'timeout 7s' : err?.message);
    return res.status(502).json({ success: false, error: 'Falha ao falar com o n8n' });
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
