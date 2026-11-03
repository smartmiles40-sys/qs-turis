// api/_googleAgenda.js
// -----------------------------------------------------------------------------
// GOOGLE CALENDAR + MEET DIRETO DO QS (03/11/2026) — o que era o workflow
// `n8n/qs-agenda-meet.COM-OCUPACAO.workflow.json`, nó por nó.
//
// O CONTRATO NÃO MUDOU, e é de propósito: `executarAcaoAgenda()` devolve
// EXATAMENTE o corpo que o webhook do n8n devolvia (ok, acao, meeting_id,
// codigo, erro, event_id, meet_link, html_link, sem_meet, duplicado,
// convidados_descartados, ja_estava_apagado, ocupado, avisos). Quem chamava o
// n8n (api/agenda-meet.js, criarSalaDoMeet e ocupacaoGoogle em _agenda.js) só
// troca o fetch por esta função; o front nem fica sabendo.
//
// E, como o webhook, NUNCA lança: falha vira `{ ok: false, codigo, erro }`.
//
// Mapa dos nós do n8n → funções daqui:
//   Validar entrada1         → validarEntrada()
//   Montar evento            → montarEvento()
//   Criar evento + 409 + GET → criar()
//   Responder criacao1       → respostaCriacao()
//   Montar atualizacao1      → montarPatchReagendar()
//   Atualizar + Responder    → reagendar() / respostaReagendar()
//   Cancelar + Responder     → cancelar() / respostaCancelamento()
//   Consultar freeBusy       → ocupacao() / corpoFreeBusy()
//   Responder ocupacao       → lerFreeBusy()
//   Responder payload inv.   → respostaInvalida()
//
// As funções de montar/ler são PURAS (sem rede) — é o que os testes cobrem
// (tests/agenda/googleAgenda.test.ts).
// -----------------------------------------------------------------------------

import { obterTokenGoogle, fetchComPrazo, ErroGoogle, _limparCacheToken } from './_google.js';

const API = 'https://www.googleapis.com/calendar/v3';
const TZ = 'America/Sao_Paulo';

/**
 * Agenda onde o evento nasce. 'primary' = a agenda da conta que organiza as
 * reuniões (a do GOOGLE_REFRESH_TOKEN), igual ao CALENDAR_PADRAO do n8n. Para
 * usar uma agenda dedicada (c_xxx@group.calendar.google.com), env
 * GOOGLE_CALENDAR_ID — opcional.
 */
export function calendarioPadrao(env = process.env) {
  return String(env.GOOGLE_CALENDAR_ID || '').trim() || 'primary';
}

const ACOES = ['criar', 'reagendar', 'cancelar', 'ocupacao'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Puras ───────────────────────────────────────────────────────────────────

/**
 * ID de evento determinístico: reenvio do mesmo meeting_id toma 409 em vez de
 * criar uma segunda reunião. O Google só aceita base32hex (a-v e 0-9).
 *
 * TEM QUE SER IDÊNTICO ao do n8n, caractere por caractere: as reuniões já
 * criadas pelo n8n têm este id, e o reparo/re-criação delas precisa cair no
 * mesmo 409 e devolver a MESMA sala.
 */
export function idEvento(seed) {
  const alfa = 'abcdefghijklmnopqrstuv0123456789';
  const s = 'qs-' + String(seed);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += alfa[c % 32] + alfa[(c >> 5) % 32];
  }
  return ('qs' + out).slice(0, 60);
}

/**
 * E-mail malformado faz o Google recusar o evento INTEIRO com 400. Melhor
 * descartar o convidado ruim e avisar do que perder a reunião. Também tira
 * repetido (closer que é o próprio organizador, e-mail duplicado).
 */
export function separarConvidados(lista) {
  const brutos = (Array.isArray(lista) ? lista : []).map((e) => String(e || '').trim()).filter(Boolean);
  const vistos = new Set();
  const convidados = [];
  for (const e of brutos) {
    if (!EMAIL.test(e)) continue;
    const k = e.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    convidados.push(e);
  }
  return { convidados, descartados: brutos.filter((e) => !EMAIL.test(e)) };
}

/** Validação + normalização. Mesmo formato que o nó "Validar entrada1" emitia. */
export function validarEntrada(b = {}, env = process.env) {
  b = b || {};
  const acao = String(b.acao || 'criar').toLowerCase().trim();
  const erros = [];

  // 'ocupacao' não escreve nada: é a única que dispensa meeting_id.
  if (acao !== 'ocupacao' && !b.meeting_id) erros.push('meeting_id ausente');
  if (!ACOES.includes(acao)) erros.push('acao invalida: ' + acao);

  if (acao === 'ocupacao') {
    if (!b.de) erros.push('de ausente');
    if (!b.ate) erros.push('ate ausente');
    if (b.de && b.ate && new Date(b.ate) <= new Date(b.de)) erros.push('ate menor ou igual a de');
    if (!Array.isArray(b.emails) || !b.emails.length) erros.push('emails ausente');
  }
  if (acao === 'criar' || acao === 'reagendar') {
    if (!b.inicio) erros.push('inicio ausente');
    if (!b.fim) erros.push('fim ausente');
    if (b.inicio && b.fim && new Date(b.fim) <= new Date(b.inicio)) erros.push('fim menor ou igual ao inicio');
  }
  if ((acao === 'reagendar' || acao === 'cancelar') && !b.event_id) erros.push('event_id ausente');

  const { convidados, descartados } = separarConvidados(b.convidados);

  return {
    acao: erros.length ? 'invalida' : acao,
    erros,
    meeting_id: b.meeting_id ?? null,
    calendar_id: b.calendar_id || calendarioPadrao(env),
    event_id: b.event_id || null,
    event_id_previsto: b.meeting_id ? idEvento(b.meeting_id) : null,
    inicio: b.inicio || null,
    fim: b.fim || null,
    timezone: b.timezone || TZ,
    titulo: b.titulo || 'Reuniao',
    descricao: b.descricao || '',
    convidados,
    convidados_descartados: descartados,
    de: b.de || null,
    ate: b.ate || null,
    // Um endereço torto faz o freeBusy inteiro voltar 400.
    emails: (Array.isArray(b.emails) ? b.emails : []).map((e) => String(e || '').trim()).filter((e) => EMAIL.test(e)),
  };
}

/**
 * Corpo do events.insert.
 *
 * conferenceData.createRequest é o que faz o Google GERAR a sala do Meet. Sem
 * conferenceDataVersion=1 na URL (ver criar()) o Google IGNORA este bloco em
 * silêncio: o evento nasce certinho, sem Meet nenhum.
 *
 * id determinístico + requestId estável = reenvio devolve 409 e a MESMA sala.
 */
export function montarEvento(d) {
  return {
    id: d.event_id_previsto,
    summary: d.titulo,
    description: d.descricao,
    start: { dateTime: d.inicio, timeZone: d.timezone },
    end: { dateTime: d.fim, timeZone: d.timezone },
    attendees: d.convidados.map((email) => ({ email })),
    conferenceData: {
      createRequest: {
        requestId: 'qs-' + String(d.meeting_id),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 30 }, { method: 'email', minutes: 60 }],
    },
  };
}

/** PATCH só com o que muda. Sem conferenceData: a sala do Meet é preservada. */
export function montarPatchReagendar(d) {
  return {
    summary: d.titulo,
    start: { dateTime: d.inicio, timeZone: d.timezone },
    end: { dateTime: d.fim, timeZone: d.timezone },
  };
}

export function urlInserir(calendarId) {
  return `${API}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`;
}
export function urlEvento(calendarId, eventId, { sendUpdates = false } = {}) {
  return `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${sendUpdates ? '?sendUpdates=all' : ''}`;
}

/** O motivo legível de uma resposta de erro do Google. */
export function motivo(body, st) {
  if (typeof body === 'string') return body.slice(0, 300);
  const e = body && body.error;
  if (typeof e === 'string') return e.slice(0, 300);
  if (e && (e.message || e.status)) return e.message || e.status;
  return 'HTTP ' + st;
}

/** O link do Meet de um Event (hangoutLink ou o entryPoint de vídeo). */
export function linkDoMeet(ev) {
  const pontos = (ev && ev.conferenceData && ev.conferenceData.entryPoints) || [];
  return (ev && ev.hangoutLink) || pontos.filter((p) => p.entryPointType === 'video').map((p) => p.uri)[0] || null;
}

/** Nó "Responder criacao1". `veioDo409`: o evento já existia (mesmo meeting_id). */
export function respostaCriacao(d, status, ev, veioDo409 = false) {
  ev = ev || {};
  if (status >= 400) {
    return { ok: false, acao: 'criar', meeting_id: d.meeting_id, codigo: status, erro: motivo(ev, status) };
  }
  // O Google guarda o id de evento apagado: 409 no POST + GET 200 com
  // status "cancelled" e o hangoutLink da sala MORTA. Não devolver essa sala.
  if (ev.status === 'cancelled') {
    return {
      ok: false, acao: 'criar', meeting_id: d.meeting_id, codigo: 'evento_cancelado',
      erro: 'o evento deste agendamento foi apagado no Google; refaça o agendamento no QS',
    };
  }
  const meet = linkDoMeet(ev);
  const r = {
    ok: true,
    acao: 'criar',
    meeting_id: d.meeting_id,
    calendar_id: d.calendar_id,
    event_id: ev.id || null,
    meet_link: meet,
    html_link: ev.htmlLink || null,
    sem_meet: !meet,
    convidados_descartados: d.convidados_descartados,
  };
  if (veioDo409) r.duplicado = true;
  return r;
}

/** Nó "Responder atualizacao1". 404/410 = sumiu do Google → o QS recria. */
export function respostaReagendar(d, status, ev) {
  ev = ev || {};
  if (status === 404 || status === 410) {
    return {
      ok: false, acao: 'reagendar', meeting_id: d.meeting_id, codigo: 'nao_encontrado',
      erro: 'evento não existe mais no Google; recrie com acao=criar',
    };
  }
  if (status >= 400) return { ok: false, acao: 'reagendar', meeting_id: d.meeting_id, codigo: status, erro: motivo(ev, status) };
  return {
    ok: true,
    acao: 'reagendar',
    meeting_id: d.meeting_id,
    calendar_id: d.calendar_id,
    event_id: ev.id || d.event_id,
    meet_link: linkDoMeet(ev),
    html_link: ev.htmlLink || null,
    inicio: d.inicio,
    fim: d.fim,
  };
}

/** Nó "Responder cancelamento1". Idempotente: já apagado = sucesso. */
export function respostaCancelamento(d, status, body) {
  const apagado = status === 204 || status === 200 || status === 404 || status === 410;
  if (!apagado) return { ok: false, acao: 'cancelar', meeting_id: d.meeting_id, codigo: status, erro: motivo(body, status) };
  const r = { ok: true, acao: 'cancelar', meeting_id: d.meeting_id, event_id: d.event_id };
  if (status === 404 || status === 410) r.ja_estava_apagado = true;
  return r;
}

export function respostaInvalida(d) {
  return {
    ok: false, acao: 'invalida', meeting_id: d.meeting_id, codigo: 'payload_invalido',
    erro: (d.erros || []).join('; ') || 'payload invalido',
  };
}

/** Corpo do freeBusy.query. */
export function corpoFreeBusy(d) {
  return { timeMin: d.de, timeMax: d.ate, timeZone: d.timezone, items: d.emails.map((e) => ({ id: e })) };
}

/**
 * Nó "Responder ocupacao": traduz o freeBusy pro formato do QS.
 *
 * FALHA ABERTA POR AGENDA: se o Google recusar UMA agenda (o closer não
 * compartilhou o livre/ocupado com a conta da operação), aquela pessoa sai da
 * resposta em vez de derrubar a consulta. O motivo vai em `avisos`.
 *
 * O Google às vezes devolve a chave do calendário com caixa diferente da que
 * mandamos; a busca cai pra comparação sem caixa antes de desistir.
 */
export function lerFreeBusy(d, status, body) {
  if (status < 200 || status >= 300) {
    const e = body && body.error;
    return { ok: false, acao: 'ocupacao', codigo: status, erro: (e && (e.message || e.status)) || ('HTTP ' + status) };
  }
  const calendarios = (body && body.calendars) || {};
  const porMinusculo = new Map(Object.keys(calendarios).map((k) => [k.toLowerCase(), calendarios[k]]));
  const ocupado = {};
  const avisos = [];
  for (const email of d.emails) {
    const c = calendarios[email] || porMinusculo.get(String(email).toLowerCase());
    if (!c) { avisos.push(email + ': o Google nao devolveu esta agenda'); continue; }
    if (Array.isArray(c.errors) && c.errors.length) {
      avisos.push(email + ': ' + c.errors.map((x) => x.reason).join(', '));
      continue;
    }
    ocupado[email] = (c.busy || []).map((b) => ({ inicio: b.start, fim: b.end }));
  }
  return { ok: true, acao: 'ocupacao', de: d.de, ate: d.ate, ocupado, avisos };
}

// ─── Rede ────────────────────────────────────────────────────────────────────

/**
 * Uma chamada à Calendar API, com o token. 401 = token velho (revogado entre
 * uma chamada e outra, ou o cache em memória sobreviveu à troca da env): limpa
 * o cache e tenta UMA vez de novo.
 */
async function chamarGoogle(url, init, { timeoutMs, signal }) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const token = await obterTokenGoogle({ signal });
    const r = await fetchComPrazo(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    }, { timeoutMs, signal });
    if (r.status === 401 && tentativa === 0) { _limparCacheToken(); continue; }
    const texto = await r.text().catch(() => '');
    let body = null;
    try { body = texto ? JSON.parse(texto) : null; } catch { body = texto; }
    return { status: r.status, body };
  }
  /* inalcançável */
  return { status: 401, body: null };
}

async function criar(d, op) {
  const ins = await chamarGoogle(urlInserir(d.calendar_id), { method: 'POST', body: JSON.stringify(montarEvento(d)) }, op);
  if (ins.status !== 409) return respostaCriacao(d, ins.status, ins.body, false);
  // Já existe (mesmo meeting_id): busca o evento e devolve a MESMA sala.
  const get = await chamarGoogle(urlEvento(d.calendar_id, d.event_id_previsto), { method: 'GET' }, op);
  return respostaCriacao(d, get.status, get.body, true);
}

async function reagendar(d, op) {
  const r = await chamarGoogle(
    urlEvento(d.calendar_id, d.event_id, { sendUpdates: true }),
    { method: 'PATCH', body: JSON.stringify(montarPatchReagendar(d)) }, op,
  );
  return respostaReagendar(d, r.status, r.body);
}

async function cancelar(d, op) {
  const r = await chamarGoogle(urlEvento(d.calendar_id, d.event_id, { sendUpdates: true }), { method: 'DELETE' }, op);
  return respostaCancelamento(d, r.status, r.body);
}

async function ocupacao(d, op) {
  const r = await chamarGoogle(`${API}/freeBusy`, { method: 'POST', body: JSON.stringify(corpoFreeBusy(d)) }, op);
  return lerFreeBusy(d, r.status, r.body);
}

/**
 * A porta única — o que era o webhook `qs-agenda-meet`. Nunca lança.
 *
 * `prazoMs` é o prazo TOTAL (token + todas as idas ao Google). Tem que ficar
 * abaixo do maxDuration da rota que chama, com folga pra auth e banco.
 * `timeoutMs` é o de cada chamada individual.
 */
export async function executarAcaoAgenda(body, { prazoMs = 18_000, timeoutMs = 10_000 } = {}) {
  const d = validarEntrada(body);
  if (d.acao === 'invalida') return respostaInvalida(d);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), prazoMs);
  const op = { timeoutMs: Math.min(timeoutMs, prazoMs), signal: ctrl.signal };
  try {
    if (d.acao === 'criar') return await criar(d, op);
    if (d.acao === 'reagendar') return await reagendar(d, op);
    if (d.acao === 'cancelar') return await cancelar(d, op);
    return await ocupacao(d, op);
  } catch (e) {
    const base = { ok: false, acao: d.acao, meeting_id: d.meeting_id };
    if (e instanceof ErroGoogle) return { ...base, codigo: e.codigo, erro: e.message };
    if (e?.name === 'AbortError') return { ...base, codigo: 'google_timeout', erro: 'o Google não respondeu a tempo' };
    return { ...base, codigo: 'google_rede', erro: `falha ao falar com o Google: ${e?.message || e}` };
  } finally {
    clearTimeout(timer);
  }
}
