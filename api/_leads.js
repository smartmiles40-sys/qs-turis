// api/_leads.js
// -----------------------------------------------------------------------------
// Lógica server-side de leads: distribuição automática (round-robin por menor
// carga) e geração das tarefas da cadência. Usada pelo webhook /api/lead-inbound.
// Fala com o Supabase via PostgREST puro (ver _supabaseAdmin.js).
// -----------------------------------------------------------------------------
import { rest, insert } from './_supabaseAdmin.js';

// ─── HORÁRIO DE TRABALHO (verdade absoluta do agendamento) ───────────────────
// Espelho do src/lib/workHours.ts — o mesmo runtime não deixa importar TS aqui.
// O QS NUNCA traz um lead pra fora do expediente: lead das 19:31 ou de sábado só
// nasce no próximo dia útil, no horário de início (nada "atrasado"). Todo o
// cálculo abaixo é feito no RELÓGIO DE BRASÍLIA (UTC-3): representamos o "wall
// clock" BRT num ms cujos campos UTC (getUTCDay/Hours/Minutes) já são os de BRT,
// e só no fim somamos +3h pra gravar o instante real em UTC.
const BRT_OFFSET_H = 3;
const DEFAULT_WORK_HOURS = {
  0: { enabled: false, start: '09:00', end: '18:00' },
  1: { enabled: true, start: '09:30', end: '19:30' },
  2: { enabled: true, start: '09:30', end: '19:30' },
  3: { enabled: true, start: '09:30', end: '19:30' },
  4: { enabled: true, start: '09:30', end: '19:30' },
  5: { enabled: true, start: '10:00', end: '19:00' },
  6: { enabled: false, start: '09:00', end: '13:00' },
};

async function loadWorkHours() {
  try {
    const rows = await rest('qs_settings?select=value&key=eq.work_hours&limit=1');
    const v = rows && rows[0] && rows[0].value;
    if (v && typeof v === 'object') return { ...DEFAULT_WORK_HOURS, ...v };
  } catch (e) {
    console.warn('[leads] work_hours indisponível, usando default:', e?.message);
  }
  return DEFAULT_WORK_HOURS;
}

function hmToMin(hm) {
  const [h, m] = String(hm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function brtMidnight(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
// Dias habilitados no expediente ∩ dias de execução da cadência (nunca vazio).
function scheduleWeekdays(wh, cadenceWeekdays) {
  const enabled = [];
  for (let d = 0; d < 7; d++) if (wh[d] && wh[d].enabled) enabled.push(d);
  if (!enabled.length) return [1, 2, 3, 4, 5];
  if (Array.isArray(cadenceWeekdays) && cadenceWeekdays.length) {
    const inter = cadenceWeekdays.filter((d) => enabled.includes(d));
    return inter.length ? inter : enabled;
  }
  return enabled;
}
// Próximo MOMENTO de trabalho ≥ brtWallMs (campos UTC = relógio BRT).
function nextWorkMomentBrt(wh, brtWallMs) {
  let ms = brtWallMs;
  for (let i = 0; i < 15; i++) {
    const dt = new Date(ms);
    const cfg = wh[dt.getUTCDay()];
    if (cfg && cfg.enabled) {
      const cur = dt.getUTCHours() * 60 + dt.getUTCMinutes();
      const startMin = hmToMin(cfg.start);
      const endMin = hmToMin(cfg.end);
      const mid = brtMidnight(ms);
      if (cur < startMin) return mid + startMin * 60_000;
      if (cur <= endMin) return ms;
    }
    ms = brtMidnight(ms) + 86_400_000; // próximo dia 00:00 BRT
  }
  return ms;
}
// Mantém o DIA e encaixa só a HORA na janela do expediente (dia já é útil).
function clampWindowBrt(wh, brtWallMs) {
  const dt = new Date(brtWallMs);
  const cfg = wh[dt.getUTCDay()];
  if (!cfg || !cfg.enabled) return brtWallMs;
  const cur = dt.getUTCHours() * 60 + dt.getUTCMinutes();
  const startMin = hmToMin(cfg.start);
  const endMin = hmToMin(cfg.end);
  const mid = brtMidnight(brtWallMs);
  if (cur < startMin) return mid + startMin * 60_000;
  if (cur > endMin) return mid + endMin * 60_000;
  return brtWallMs;
}

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
    `qs_cadence_days?select=id,day_number,qs_cadence_activities(channel_type,scheduled_time,order_index)&cadence_id=eq.${encodeURIComponent(cadenceId)}&order=day_number.asc`
  );
  if (!days || days.length === 0) return 0;

  // DIAS DE EXECUÇÃO: o "Dia N" não pode cair em dia sem execução (lead que
  // entra na sexta ganhava o "Dia 2" no sábado). Espelha a regra do front
  // (planCadenceDates em src/lib/workHours.ts — mesmo runtime não dá pra
  // importar TS aqui): cada dia pula pro próximo permitido; dias distintos não
  // colapsam. offday_policy "iniciar_imediato" perde o efeito na PRÁTICA quando
  // a chegada é fora do expediente — o Horário de Trabalho é a verdade absoluta.
  let execWeekdays = null;
  try {
    const cad = await rest(
      `qs_cadences?select=execution_weekdays&id=eq.${encodeURIComponent(cadenceId)}&limit=1`
    );
    if (cad && cad[0]) {
      if (Array.isArray(cad[0].execution_weekdays) && cad[0].execution_weekdays.length > 0) {
        execWeekdays = cad[0].execution_weekdays;
      }
    }
  } catch (e) {
    console.warn('[leads] execution_weekdays indisponível, usando seg–sex:', e?.message);
  }

  // HORÁRIO DE TRABALHO = verdade absoluta: dias permitidos = expediente ∩ cadência.
  const wh = await loadWorkHours();
  const allowedWeekdays = scheduleWeekdays(wh, execWeekdays);

  const DAY_MS = 86_400_000;
  // Avança `d` (meia-noite UTC = dia no calendário BRT) até um dia permitido (máx. 14).
  const nextAllowed = (d) => {
    let out = d;
    for (let i = 0; i < 14 && !allowedWeekdays.includes(out.getUTCDay()); i++) out = new Date(out.getTime() + DAY_MS);
    return out;
  };

  // FUSO: este código roda na Vercel (relógio UTC). Os horários da cadência
  // ("09:00") são de BRASÍLIA (UTC-3, sem horário de verão desde 2019). Fazemos
  // toda a conta no relógio BRT (campos UTC de um ms deslocado) e gravamos o
  // instante real somando +3h no fim.
  const baseMs = baseDate ? new Date(baseDate).getTime() : Date.now();
  const brtBase = new Date(baseMs - BRT_OFFSET_H * 3600_000); // "agora" em Brasília, lido pelos campos UTC
  const brtNowMs = Date.now() - BRT_OFFSET_H * 3600_000;      // "agora" BRT em wall-clock ms
  const rows = [];
  let prevDayUtc = null; // meia-noite UTC do último dia agendado (guarda anti-colapso)
  for (const day of days) {
    // Dia-base do "Dia N" (meia-noite UTC representando o dia no calendário BRT).
    let dayUtc = new Date(Date.UTC(
      brtBase.getUTCFullYear(),
      brtBase.getUTCMonth(),
      brtBase.getUTCDate() + Math.max(0, (day.day_number ?? 1) - 1)
    ));
    const isFirst = prevDayUtc === null;
    dayUtc = nextAllowed(dayUtc);
    if (prevDayUtc && dayUtc.getTime() <= prevDayUtc.getTime()) {
      dayUtc = nextAllowed(new Date(prevDayUtc.getTime() + DAY_MS));
    }
    prevDayUtc = dayUtc;

    const acts = (day.qs_cadence_activities || []).slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    for (const act of acts) {
      let h = 9, m = 0;
      if (act.scheduled_time && /^\d{1,2}:\d{2}/.test(act.scheduled_time)) {
        const [hh, mm] = act.scheduled_time.split(':');
        h = Number(hh) || 9; m = Number(mm) || 0;
      }
      // Horário PLANEJADO em wall-clock BRT (campos UTC = BRT).
      const plannedBrt = dayUtc.getTime() + h * 3600_000 + m * 60_000;
      // NADA nasce fora do expediente. 1º dia: parte do maior entre o planejado e
      // AGORA (lead da tarde não ganha atividade no passado) e cai no próximo
      // MOMENTO de trabalho — lead das 19:31 ou de sábado só aparece no próximo
      // dia útil, no início. Dias futuros: mantém o dia (já é útil) e encaixa a
      // hora na janela. A PRIORIDADE abaixo NÃO muda — segue do scheduled_time.
      const brtWhen = isFirst
        ? nextWorkMomentBrt(wh, Math.max(plannedBrt, brtNowMs))
        : clampWindowBrt(wh, plannedBrt);
      const when = new Date(brtWhen + BRT_OFFSET_H * 3600_000); // volta pro instante real (UTC)
      rows.push({
        lead_id: leadId,
        cadence_id: cadenceId,
        owner_id: ownerId,
        channel_type: act.channel_type,
        // Prioridade vem do PERÍODO da atividade: manhã = alta, tarde (>= 12:30) =
        // média, "dia todo" (sem horário) = baixa. Mesma regra do createCadenceTasks
        // (front) — assim o lead do Bitrix/serverless também respeita a prioridade.
        priority: (!act.scheduled_time ? 'baixa' : act.scheduled_time >= '12:30' ? 'media' : 'alta'),
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

// ─── Normalização de contato (dedupe à prova de retry) ───────────────────────
// O dedupe secundário compara email em lowercase e telefone "cru", mas antes a
// GRAVAÇÃO ia sem normalizar — um retry do n8n com "João@X.com" / "+55 (11) 9..."
// não batia com o card gravado como "joao@x.com" / "5511 9..." e DUPLICAVA.
// Regra: normalizar UMA vez, na entrada, e comparar/gravar sempre normalizado.
// (qs_leads não tem coluna separada de "telefone exibível" — o app já exibe e
// disca por dígitos, então gravar só dígitos não perde nada.)
function normEmail(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s || null;
}
function normPhone(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d || null;
}

// Vocabulário fechado de temperatura (PT + EN). Usado pra achar o score PELO
// VALOR, sem depender do nome do campo que o Bitrix mandou.
const TEMP_WORD = /^(quente|morno|frio|hot|warm|cold)$/i;

// Nomes de campo que NUNCA são o score (evita falso-positivo no scan por valor).
const NON_SCORE_KEYS = new Set([
  'source', 'segment', 'full_name', 'first_name', 'last_name', 'email', 'phone',
  'company', 'company_name', 'city', 'state', 'website', 'linkedin_url',
  'job_title', 'bitrix_id', 'id', 'cadence_id', 'owner_id', 'location',
]);

/**
 * Temperatura do lead vinda do Bitrix (rótulo). Estratégia à prova de nome de
 * campo, porque o Bitrix pode mandar sob qualquer rótulo:
 *   1) campos com nome conhecido (lead_score/temperatura/score/pontuacao/…);
 *   2) fallback: varre TODO o payload (inclui _raw) atrás de um VALOR que seja
 *      uma temperatura (Quente/Morno/Frio) — assim funciona mesmo que o campo
 *      no Bitrix se chame "Grau", "Classificação" ou um código UF_CRM_*.
 * Guarda o rótulo cru; a app normaliza pra quente/morno/frio ao exibir.
 * Sem valor → null (card sem chip; nada de "Quente" inventado).
 */
function pickLeadScore(input) {
  // 1) por nome de campo conhecido
  const named = input.lead_score ?? input.temperatura ?? input.Temperatura ?? input.leadScore ??
    input.temperature ?? input.score ?? input.pontuacao ?? input.Pontuacao ?? input.classificacao ?? null;
  const s = named == null ? '' : String(named).trim();
  if (s) return s;

  // 2) fallback: procura um valor de temperatura em qualquer campo (menos os que
  //    sabemos que não são score). Inclui um objeto _raw, se o n8n repassar.
  const seen = new Set();
  const scan = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 3 || seen.has(obj)) return null;
    seen.add(obj);
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object') { const hit = scan(v, depth + 1); if (hit) return hit; continue; }
      if (NON_SCORE_KEYS.has(String(k).toLowerCase())) continue;
      const val = v == null ? '' : String(v).trim();
      if (TEMP_WORD.test(val)) return val;
    }
    return null;
  };
  return scan(input, 0) || null;
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
// A coluna qs_leads.source tem CHECK no banco: só aceita
// 'manual'|'api'|'integracao'|'importacao'. Se o caller (ex.: n8n mandando o
// CANAL cru "WhatsApp - ..." em source) enviar outro valor, o INSERT estoura
// 23514 e — com o nó do n8n em continueRegularOutput — o lead SUMIA em silêncio.
// Sanitiza: valor fora da lista cai em 'integracao'. O canal/fonte real continua
// preservado em `segment` e na nota de origem.
const ALLOWED_SOURCE = new Set(['manual', 'api', 'integracao', 'importacao']);
function normSource(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return ALLOWED_SOURCE.has(s) ? s : 'integracao';
}

export async function createInboundLead(payload) {
  // Contato normalizado UMA vez — usado no dedupe, no patch e na gravação.
  const email = normEmail(payload.email);
  const phone = normPhone(payload.phone);

  // 0) Dedupe por bitrix_id (defensivo: se a coluna ainda não existir no banco,
  //    o filtro falha e seguimos pro fluxo normal de criação).
  const bitrixId = payload.bitrix_id ? String(payload.bitrix_id).trim() : null;
  if (bitrixId) {
    try {
      const existing = await rest(`qs_leads?select=*&bitrix_id=eq.${encodeURIComponent(bitrixId)}&limit=1`);
      if (existing && existing[0]) {
        const patch = {};
        if (email) patch.email = email;
        if (phone) patch.phone = phone;
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

  // 0b) Dedupe secundário SEM bitrix_id (form de LP, retry do n8n): mesmo e-mail
  //     ou telefone nas últimas 24h → devolve o existente em vez de duplicar
  //     card + tarefas da cadência.
  if (!bitrixId && (email || phone)) {
    try {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const ors = [];
      if (email) ors.push(`email.eq.${encodeURIComponent(email)}`);
      if (phone) ors.push(`phone.eq.${encodeURIComponent(phone)}`);
      const dup = await rest(
        `qs_leads?select=*&or=(${ors.join(',')})&created_at=gte.${encodeURIComponent(since)}&limit=1`
      );
      if (dup && dup[0]) {
        return { lead: dup[0], ownerId: dup[0].owner_id, cadenceId: dup[0].cadence_id, tasks: 0, deduped: true };
      }
    } catch (e) {
      console.warn('[leads] dedupe por email/telefone falhou (segue criando):', e?.message);
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
    const c = await rest(`qs_cadences?select=priority&id=eq.${encodeURIComponent(cadenceId)}&limit=1`);
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
    phone,
    email,
    linkedin_url: payload.linkedin_url || null,
    source: normSource(payload.source),
    // Lead que JÁ entra vinculado a uma cadência (com tarefas geradas logo
    // abaixo) nasce "em_prospeccao" — mesma regra do front ao vincular cadência
    // (LeadsPage/TasksPanel). Antes nascia "nao_iniciado" pra sempre e nada o
    // promovia: métricas e filtros ignoravam o canal principal de entrada.
    status: cadenceId ? 'em_prospeccao' : 'nao_iniciado',
    location: payload.location || null,
    owner_id: ownerId,
    cadence_id: cadenceId,
    estimated_value: payload.estimated_value ?? null,
    lead_score: pickLeadScore(payload),
    cadence_started_at: cadenceId ? nowIso : null,
    arrived_at: nowIso,
  };

  // bitrix_id entra defensivamente, mas o catch agora DIFERENCIA o erro:
  //  • coluna inexistente (42703/PGRST204) → repete sem bitrix_id (migration 0006 pendente);
  //  • violação do índice único (23505) → outro webhook criou o lead no meio do
  //    caminho (corrida do check-then-insert) → busca e devolve o EXISTENTE.
  //    Antes esse caso caía no retry sem bitrix_id = card DUPLICADO e sem vínculo.
  let created;
  try {
    created = await insert('qs_leads', bitrixId ? { ...leadRow, bitrix_id: bitrixId } : leadRow);
  } catch (e) {
    const code = e?.details?.code || e?.code || '';
    if (bitrixId && code === '23505') {
      const existing = await rest(`qs_leads?select=*&bitrix_id=eq.${encodeURIComponent(bitrixId)}&limit=1`);
      if (existing && existing[0]) {
        return { lead: existing[0], ownerId: existing[0].owner_id, cadenceId: existing[0].cadence_id, tasks: 0, deduped: true };
      }
      throw e;
    }
    if (bitrixId && (code === '42703' || code === 'PGRST204')) {
      console.warn('[leads] coluna bitrix_id não existe; inserindo sem (aplicar migration 0006):', e?.message);
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
