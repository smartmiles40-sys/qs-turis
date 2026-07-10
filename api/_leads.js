// api/_leads.js
// -----------------------------------------------------------------------------
// Lógica server-side de leads: distribuição automática (round-robin por menor
// carga) e geração das tarefas da cadência. Usada pelo webhook /api/lead-inbound.
// Fala com o Supabase via PostgREST puro (ver _supabaseAdmin.js).
// -----------------------------------------------------------------------------
import { rest, insert } from './_supabaseAdmin.js';

/**
 * Escolhe o próximo SDR pela MENOR carga de leads em aberto (distribui
 * equilibrando quem tem menos leads ativos). Retorna o id do SDR ou null.
 */
export async function pickNextSdr() {
  const sdrs = await rest('qs_users?select=id&role=eq.sdr&is_active=eq.true');
  if (!sdrs || sdrs.length === 0) return null;

  const openLeads = await rest(
    'qs_leads?select=owner_id&status=in.(nao_iniciado,em_prospeccao)&owner_id=not.is.null'
  );

  const load = new Map(sdrs.map((s) => [s.id, 0]));
  for (const l of openLeads || []) {
    if (load.has(l.owner_id)) load.set(l.owner_id, load.get(l.owner_id) + 1);
  }
  let best = sdrs[0].id;
  let bestLoad = load.get(best) ?? 0;
  for (const s of sdrs) {
    const c = load.get(s.id) ?? 0;
    if (c < bestLoad) { best = s.id; bestLoad = c; }
  }
  return best;
}

/** Escolhe uma cadência disponível (a mais antiga) quando nenhuma é indicada. */
export async function pickDefaultCadence() {
  const data = await rest('qs_cadences?select=id,priority&status=eq.disponivel&order=created_at.asc&limit=1');
  return data && data[0] ? data[0] : null;
}

/**
 * Gera as tarefas de uma cadência para um lead recém-atribuído.
 * Cada atividade vira uma qs_tasks agendada em (base + (day_number-1) dias),
 * no horário scheduled_time da atividade quando houver.
 */
export async function generateCadenceTasks({ leadId, cadenceId, ownerId, priority = 'media', baseDate }) {
  const days = await rest(
    `qs_cadence_days?select=id,day_number,qs_cadence_activities(channel_type,scheduled_time,order_index)&cadence_id=eq.${cadenceId}&order=day_number.asc`
  );
  if (!days || days.length === 0) return 0;

  const base = baseDate ? new Date(baseDate) : new Date();
  const rows = [];
  for (const day of days) {
    const acts = (day.qs_cadence_activities || []).slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    for (const act of acts) {
      const when = new Date(base);
      when.setDate(when.getDate() + Math.max(0, (day.day_number ?? 1) - 1));
      if (act.scheduled_time && /^\d{1,2}:\d{2}/.test(act.scheduled_time)) {
        const [h, m] = act.scheduled_time.split(':');
        when.setHours(Number(h), Number(m), 0, 0);
      } else {
        when.setHours(9, 0, 0, 0);
      }
      rows.push({
        lead_id: leadId,
        cadence_id: cadenceId,
        owner_id: ownerId,
        channel_type: act.channel_type,
        priority,
        scheduled_at: when.toISOString(),
        status: 'pendente',
        is_extra: false,
      });
    }
  }
  if (rows.length === 0) return 0;
  await insert('qs_tasks', rows, { returning: false });
  return rows.length;
}

function buildFullName(input) {
  if (input.full_name && String(input.full_name).trim()) return String(input.full_name).trim();
  const parts = [input.first_name, input.last_name].filter(Boolean);
  return parts.join(' ').trim() || null;
}

/**
 * Temperatura do lead vinda do Bitrix (rótulo). Aceita vários nomes de campo e
 * guarda o rótulo cru (a app normaliza pra quente/morno/frio na hora de exibir).
 * Sem valor → null (o card fica sem chip; nada de "Quente" inventado).
 */
function pickLeadScore(input) {
  const raw = input.lead_score ?? input.temperatura ?? input.leadScore ?? input.temperature ?? input.Temperatura ?? null;
  const s = raw == null ? '' : String(raw).trim();
  return s || null;
}

/**
 * Cria um lead a partir de um payload externo, aplicando distribuição automática
 * e gerando as tarefas da cadência. Retorna { lead, ownerId, cadenceId, tasks }.
 *
 * Dedupe por Bitrix: se vier payload.bitrix_id e JÁ existir um lead com esse id,
 * NÃO cria de novo — atualiza os dados de contato e devolve o existente (sem
 * regenerar tarefas). Assim o webhook do Bitrix pode disparar mais de uma vez
 * pro mesmo negócio sem duplicar card no QS.
 */
export async function createInboundLead(payload) {
  // 0) Dedupe por bitrix_id (defensivo: se a coluna ainda não existir no banco,
  //    o filtro falha e seguimos pro fluxo normal de criação).
  const bitrixId = payload.bitrix_id ? String(payload.bitrix_id).trim() : null;
  if (bitrixId) {
    try {
      const existing = await rest(`qs_leads?select=*&bitrix_id=eq.${encodeURIComponent(bitrixId)}&limit=1`);
      if (existing && existing[0]) {
        const patch = {};
        if (payload.email) patch.email = payload.email;
        if (payload.phone) patch.phone = payload.phone;
        if (buildFullName(payload)) patch.full_name = buildFullName(payload);
        if (payload.segment) patch.segment = payload.segment; // Fonte do Bitrix
        { const ls = pickLeadScore(payload); if (ls) patch.lead_score = ls; } // temperatura do Bitrix
        if (Object.keys(patch).length > 0) {
          await rest(`qs_leads?id=eq.${existing[0].id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
        }
        return { lead: existing[0], ownerId: existing[0].owner_id, cadenceId: existing[0].cadence_id, tasks: 0, deduped: true };
      }
    } catch (e) {
      console.warn('[leads] dedupe por bitrix_id indisponível (coluna existe?):', e?.message);
    }
  }

  // 1) Responsável: se o payload não trouxer, o GATILHO do banco decide
  //    (round-robin POR CADÊNCIA — ver migration 0008). Não escolhemos aqui pra
  //    ter UM algoritmo só e não divergir do que entra direto (n8n).
  const ownerId = payload.owner_id || null;

  // 2) Cadência: usa a informada ou uma disponível padrão.
  let cadenceId = payload.cadence_id || null;
  let priority = 'media';
  if (!cadenceId) {
    const c = await pickDefaultCadence();
    if (c) { cadenceId = c.id; priority = c.priority || 'media'; }
  } else {
    const c = await rest(`qs_cadences?select=priority&id=eq.${cadenceId}&limit=1`);
    if (c && c[0]) priority = c[0].priority || 'media';
  }

  const nowIso = new Date().toISOString();
  const leadRow = {
    first_name: payload.first_name || null,
    last_name: payload.last_name || null,
    full_name: buildFullName(payload),
    job_title: payload.job_title || null,
    company_name: payload.company_name || payload.company || null,
    segment: payload.segment || null,
    city: payload.city || null,
    state: payload.state || null,
    website: payload.website || null,
    phone: payload.phone || null,
    email: payload.email || null,
    linkedin_url: payload.linkedin_url || null,
    source: payload.source || 'integracao',
    status: 'nao_iniciado',
    location: payload.location || null,
    owner_id: ownerId,
    cadence_id: cadenceId,
    estimated_value: payload.estimated_value ?? null,
    lead_score: pickLeadScore(payload),
    cadence_started_at: cadenceId ? nowIso : null,
    arrived_at: nowIso,
  };

  // bitrix_id entra defensivamente: se a coluna ainda não existir no banco,
  // repetimos o insert sem ela (o vínculo fica de fora, mas o lead entra).
  let created;
  try {
    created = await insert('qs_leads', bitrixId ? { ...leadRow, bitrix_id: bitrixId } : leadRow);
  } catch (e) {
    if (bitrixId) {
      console.warn('[leads] insert com bitrix_id falhou; tentando sem (aplicar migration 0006):', e?.message);
      created = await insert('qs_leads', leadRow);
    } else {
      throw e;
    }
  }
  const lead = Array.isArray(created) ? created[0] : created;

  // O dono FINAL é o que o gatilho gravou (round-robin por cadência) — as tarefas
  // têm que ficar com o MESMO SDR do lead, senão o card não aparece pra ele.
  const finalOwner = (lead && lead.owner_id) || ownerId;

  let tasks = 0;
  if (cadenceId && lead) {
    tasks = await generateCadenceTasks({ leadId: lead.id, cadenceId, ownerId: finalOwner, priority, baseDate: nowIso });
  }

  return { lead, ownerId: finalOwner, cadenceId, tasks };
}
