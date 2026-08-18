// api/_leads.js
// -----------------------------------------------------------------------------
// Lógica server-side de leads: criação/dedupe e geração das tarefas da cadência.
// Usada pelo webhook /api/lead-inbound. A DISTRIBUIÇÃO (quem fica com o lead) é
// do gatilho do banco — rodízio circular, migration 0028.
// Fala com o Supabase via PostgREST puro (ver _supabaseAdmin.js).
// -----------------------------------------------------------------------------
import { rest, insert } from './_supabaseAdmin.js';
import { resgatarConversaPerdida, findLeadByPhone } from './_wa.js';
import { vincularLeadAoBitrix } from './_bitrixLead.js';

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

// A ESCOLHA DO SDR NÃO MORA MAIS AQUI. Existia um pickNextSdr() por "menor carga
// em aberto" — código morto (ninguém chamava) e, pior, a regra ERRADA: ela dava
// todos os leads pra quem acabava de marcar perdido/ganho. Hoje quem distribui é
// o gatilho trg_qs_assign_owner no banco (migration 0028), em RODÍZIO CIRCULAR.
// Um algoritmo só, no mesmo lugar, valendo pro n8n e pro app.

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
        // Carimbo do DIA DO PLANO — mesma regra do createCadenceTasks (front):
        // o rótulo "FUP N" do Painel lê daqui em vez de derivar por data.
        tags: [`dia:${day.day_number ?? 1}`],
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
/**
 * Telefone normalizado — e aqui mora um bug que custou caro.
 *
 * O Bitrix manda telefone como LISTA, e o campo chega assim:
 *   " 5519993152056,  551993152056"   (o mesmo número com e sem o 9º dígito)
 *
 * O `replace(/\D/g,'')` direto GRUDAVA os dois num número de 25 dígitos. O lead
 * era gravado com esse monstro, e a partir daí toda mensagem de WhatsApp dele
 * era descartada em silêncio: a chave do telefone dava null e o webhook não
 * achava o lead. Medido em produção: 57 leads nessa situação.
 *
 * Agora pega o PRIMEIRO número plausível. Separador explícito quando existe;
 * quando os números vêm colados, corta nos tamanhos que fazem sentido no Brasil
 * (55+DDD+9, 55+DDD+8, DDD+9, DDD+8).
 */
function normPhone(v) {
  const bruto = String(v ?? '');
  if (!bruto.trim()) return null;

  const pedacos = bruto.split(/[,;/|\n\r]+/).map((p) => p.replace(/\D/g, '')).filter(Boolean);
  for (const d of pedacos) {
    if (d.length >= 10 && d.length <= 15) return d;   // já é um número sozinho
    if (d.length > 15) {
      for (const n of [13, 12, 11, 10]) {
        const corte = d.slice(0, n);
        if (corte.length === n) return corte;
      }
    }
  }
  // Nada plausível: devolve os dígitos como vieram, pra não perder o dado.
  const cru = bruto.replace(/\D/g, '');
  return cru || null;
}

/**
 * Valor pronto pra entrar num filtro do PostgREST.
 *
 * `encodeURIComponent` não basta: o PostgREST DECODIFICA a querystring antes de
 * parsear o `or=(…)`, então um `%2C` volta a ser vírgula e vira separador de
 * condição. Reproduzido contra o banco: `or=(email.eq.joao,silva@x.com)` responde
 * 400 "failed to parse logic tree" — o dedupe cai no catch e o lead entra
 * DUPLICADO, calado. Aspas duplas delimitam o valor; dentro delas só `"` e `\`
 * precisam de escape.
 */
function pgValor(v) {
  return encodeURIComponent(`"${String(v).replace(/["\\]/g, '\\$&')}"`);
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
 * CLASSIFICAÇÃO AUTOMÁTICA POR FONTE (sprint 2026-07-24) — roda só quando o
 * Bitrix NÃO mandou temperatura (o rótulo do Bitrix sempre vence). Regras
 * configuráveis pelo gestor em qs_settings, key `auto_classify_rules`:
 *   [ { "match": "indicac|resgate", "temperatura": "Quente" },
 *     { "match": "whatsapp|organico|orgânico", "temperatura": "Morno" } ]
 * `match` = regex case-insensitive aplicada à Fonte (coluna segment). Sem regra
 * que case → null (nada de temperatura inventada — regra da casa).
 */
async function autoClassifyBySource(segment) {
  const s = String(segment ?? '').trim();
  if (!s) return null;
  try {
    const rows = await rest('qs_settings?select=value&key=eq.auto_classify_rules&limit=1');
    const v = rows && rows[0] && rows[0].value;
    const list = Array.isArray(v) ? v : v && Array.isArray(v.rules) ? v.rules : [];
    for (const r of list) {
      if (!r || !r.match || !r.temperatura) continue;
      let re;
      try { re = new RegExp(String(r.match), 'i'); } catch { continue; }
      if (re.test(s)) return String(r.temperatura);
    }
  } catch (e) {
    console.warn('[leads] auto_classify_rules indisponível (segue sem):', e?.message);
  }
  return null;
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

    // 0a) Bitrix mandou um id NOVO, mas o telefone pode já ser um card do QS —
    //     o caso típico é o card que a API oficial criou quando o cliente
    //     escreveu ANTES de o negócio existir no Bitrix (wa-webhook). Sem isto,
    //     o mesmo cliente vira DOIS cards: o do WhatsApp (sem bitrix_id) e o do
    //     Bitrix. Aqui a gente ADOTA o card existente: gruda o bitrix_id nele e
    //     atualiza o contato. Só adota card que ainda não pertence a NENHUM
    //     negócio do Bitrix — card já vinculado a outro id é outro negócio.
    //     O casamento de telefone é o mesmo do webhook (waKey: ignora +55 e o
    //     9º dígito), não igualdade de string — senão o formato diferente entre
    //     Chatwoot e Bitrix recriaria o duplicado que estamos evitando.
    if (phone) {
      try {
        const achado = await findLeadByPhone(phone);
        // findLeadByPhone devolve poucas colunas — rebusca a linha inteira,
        // porque a decisão de adotar depende do bitrix_id atual do card.
        const cheio = achado
          ? await rest(`qs_leads?select=*&id=eq.${encodeURIComponent(achado.id)}&limit=1`)
          : null;
        const mesmo = cheio?.[0] ?? null;
        if (mesmo && !mesmo.bitrix_id) {
          const patch = { bitrix_id: bitrixId };
          if (email) patch.email = email;
          if (buildFullName(payload)) patch.full_name = buildFullName(payload);
          if (payload.segment) patch.segment = payload.segment;
          { const ls = pickLeadScore(payload); if (ls) patch.lead_score = ls; }
          await rest(`qs_leads?id=eq.${mesmo.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
          console.log(`[leads] bitrix ${bitrixId} adotou o card existente ${mesmo.id} (mesmo telefone)`);
          return { lead: { ...mesmo, ...patch }, ownerId: mesmo.owner_id, cadenceId: mesmo.cadence_id, tasks: 0, deduped: true };
        }
      } catch (e) {
        console.warn('[leads] adoção por telefone falhou (segue criando):', e?.message);
      }
    }
  }

  // 0b) Dedupe secundário SEM bitrix_id (form de LP, retry do n8n): mesmo e-mail
  //     ou telefone nas últimas 24h → devolve o existente em vez de duplicar
  //     card + tarefas da cadência.
  if (!bitrixId && (email || phone)) {
    try {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const ors = [];
      if (email) ors.push(`email.eq.${pgValor(email)}`);
      if (phone) ors.push(`phone.eq.${pgValor(phone)}`);
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
  //    (rodízio circular — ver migration 0028). Não escolhemos aqui pra ter UM
  //    algoritmo só e não divergir do que entra direto (n8n).
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

  // Temperatura: rótulo do Bitrix vence; sem rótulo, tenta a classificação
  // automática por Fonte (regras do gestor em qs_settings.auto_classify_rules).
  let leadScore = pickLeadScore(payload);
  const bitrixScore = leadScore; // rótulo cru que veio do Bitrix (usado na nota de origem)
  let autoClassified = false;
  if (!leadScore) {
    leadScore = await autoClassifyBySource(payload.segment);
    autoClassified = !!leadScore;
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
    lead_score: leadScore,
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

  // ── O LEAD TAMBÉM NASCE NO BITRIX (Bruno, 18/08) ──────────────────────────
  // Quem chega pelo WhatsApp não traz bitrix_id — e desde que a caixa oficial
  // passou a criar card sozinha, 20 leads (a "Paula" entre eles) existiam só no
  // QS: com dono e cadência aqui, invisíveis pro comercial lá. Agora o negócio
  // é criado no mesmo instante, no funil de Pré-Vendas, com o dono do QS como
  // responsável. Best-effort: Bitrix fora não impede o lead de entrar.
  if (lead && !bitrixId) {
    try {
      const novoId = await vincularLeadAoBitrix({ ...lead, owner_id: finalOwner });
      if (novoId) lead.bitrix_id = novoId;
    } catch (e) {
      console.warn('[leads] criação no Bitrix falhou (o lead entrou mesmo assim):', e?.message);
    }
  }

  // Nota de origem Bitrix (best-effort). Antes quem criava era o n8n, DEPOIS da
  // resposta — e todo reenvio do Bitrix empilhava mais uma cópia (135 leads com
  // nota repetida em produção). Aqui ela só roda quando o lead acabou de NASCER:
  // reenvio cai no dedupe lá em cima e nunca chega neste ponto.
  if (bitrixId && lead) {
    try {
      await insert('qs_notes', {
        lead_id: lead.id,
        author_id: null,
        body: `📥 Origem Bitrix\nFonte: ${payload.segment || '-'}\nTemperatura: ${bitrixScore || '-'}`,
        tags: ['bitrix', 'origem'],
      }, { returning: false });
    } catch (e) {
      console.warn('[leads] nota de origem falhou (segue):', e?.message);
    }
  }

  // Rastro da classificação automática (best-effort): o SDR vê no histórico que
  // a temperatura foi sugerida pela FONTE, não escolhida por alguém — e pode
  // ajustar no badge do card quando discordar.
  if (autoClassified && lead) {
    try {
      await insert('qs_notes', {
        lead_id: lead.id,
        author_id: null,
        body: `🤖 Temperatura "${leadScore}" sugerida automaticamente pela fonte (${payload.segment}). Ajuste no badge do lead se discordar.`,
        tags: ['cadencia', 'auto-classificacao'],
      }, { returning: false });
    } catch (e) {
      console.warn('[leads] nota de auto-classificação falhou (segue):', e?.message);
    }
  }

  // A mensagem que chegou ANTES deste lead existir (best-effort).
  //
  // Medido em 13/08: em 32 números o cliente respondeu no MESMO minuto em que o
  // Bitrix criou o negócio — a mensagem bateu no webhook segundos antes do lead
  // e foi descartada por não ter dono. Aqui o lead acabou de nascer, então a
  // corrida terminou: se havia algo esperando por este telefone, a conversa
  // entra agora, sem depender de alguém abrir o card.
  if (lead) {
    try {
      const r = await resgatarConversaPerdida(lead);
      if (r.resgatadas > 0) {
        console.log(`[leads] conversa resgatada: ${r.resgatadas} mensagem(ns) que chegaram antes do lead ${lead.id}`);
      }
    } catch (e) {
      console.warn('[leads] resgate da conversa falhou (segue):', e?.message);
    }
  }

  return { lead, ownerId: finalOwner, cadenceId, tasks };
}

/**
 * Move um lead que JÁ EXISTE para outra cadência (usado pelo `&mover=1` das
 * listas do webhook).
 *
 * POR QUE PRECISOU EXISTIR: a lista de resgate do Bruno vem do Bitrix, e a
 * maioria dessas pessoas já está no QS há meses — perdidas, sem atividade
 * nenhuma em aberto. O webhook, que deduplica por telefone/e-mail/bitrix_id,
 * respondia "já existia" e não fazia nada: o lead continuava parado na cadência
 * de trabalho e nunca aparecia na fila de resgate.
 *
 * AS TRAVAS SÃO O CORAÇÃO DISTO. O pedido original foi "que não dê nenhum
 * problema com os leads que realmente estão sendo trabalhados", então mover é a
 * exceção, não a regra: qualquer sinal de vida no lead cancela a mudança e
 * devolve o motivo. Nada é sobrescrito em silêncio.
 */
export async function moverLeadParaCadencia(lead, cadenceId) {
  if (!lead?.id || !cadenceId) return { movido: false, motivo: 'dados insuficientes' };
  if (lead.cadence_id === cadenceId) return { movido: false, motivo: 'ja-estava-nesta-cadencia' };

  // 1) Cliente fechado não volta pra fila de prospecção.
  if (lead.status === 'ganho') return { movido: false, motivo: 'lead-ganho' };

  // 2) Tem reunião marcada pra frente? Então está VIVO, com especialista
  //    esperando. Mover reiniciaria a cadência por baixo de uma reunião real.
  try {
    const agora = new Date().toISOString();
    const reunioes = await rest(
      `qs_meetings?lead_id=eq.${encodeURIComponent(lead.id)}&status=in.(agendada,confirmada)` +
      `&scheduled_at=gte.${encodeURIComponent(agora)}&select=id&limit=1`
    );
    if (Array.isArray(reunioes) && reunioes.length) {
      return { movido: false, motivo: 'tem-reuniao-marcada' };
    }
  } catch (e) {
    // Na dúvida, NÃO mexe: falha de leitura não pode virar autorização.
    console.warn('[leads] mover: não consegui conferir reuniões:', e?.message);
    return { movido: false, motivo: 'nao-consegui-conferir-reuniao' };
  }

  // 3) Tem atividade em aberto = alguém está trabalhando este lead AGORA.
  //    Esta é a trava que o Bruno pediu com todas as letras.
  let abertas = [];
  try {
    abertas = await rest(
      `qs_tasks?lead_id=eq.${encodeURIComponent(lead.id)}&status=in.(pendente,atrasada)&select=id,is_extra`
    );
  } catch (e) {
    console.warn('[leads] mover: não consegui conferir atividades:', e?.message);
    return { movido: false, motivo: 'nao-consegui-conferir-atividades' };
  }
  const daCadencia = (Array.isArray(abertas) ? abertas : []).filter((t) => !t.is_extra);
  if (daCadencia.length > 0) {
    return { movido: false, motivo: 'esta-sendo-trabalhado', atividades_abertas: daCadencia.length };
  }

  // 4) Liberado. A ORDEM importa: primeiro encerra o que sobrou (avulsos que o
  //    SDR criou à mão), depois troca a cadência, depois gera o plano novo. Se
  //    a geração falhar, o lead fica sem atividade — por isso ela vem por
  //    último e o resultado é devolvido pra quem chamou.
  const avulsas = (Array.isArray(abertas) ? abertas : []).filter((t) => t.is_extra);
  for (const t of avulsas) {
    try {
      await rest(`qs_tasks?id=eq.${encodeURIComponent(t.id)}`, {
        method: 'PATCH',
        body: { status: 'ignorada', skip_reason: 'Lead movido para outra cadência (resgate)' },
        prefer: 'return=minimal',
      });
    } catch { /* atividade avulsa que não fechou não impede o resgate */ }
  }

  const agoraIso = new Date().toISOString();
  await rest(`qs_leads?id=eq.${encodeURIComponent(lead.id)}`, {
    method: 'PATCH',
    body: { cadence_id: cadenceId, cadence_started_at: agoraIso, status: 'em_prospeccao', updated_at: agoraIso },
    prefer: 'return=minimal',
  });

  let tarefas = 0;
  try {
    tarefas = await generateCadenceTasks({ leadId: lead.id, cadenceId, ownerId: lead.owner_id ?? null });
  } catch (e) {
    console.error('[leads] mover: cadência trocada mas as atividades falharam:', e?.message);
  }

  return { movido: true, tarefas };
}
