// api/_agenda.js
// -----------------------------------------------------------------------------
// A AGENDA DO LADO DO SERVIDOR — o que a Glória precisa pra oferecer horário e
// pra marcar sozinha.
//
// Até aqui, agendar só existia no navegador (`src/lib/qs/closerAgenda.ts` e
// `src/lib/qs/meetings.ts`), com a sessão do SDR e a RLS dele por trás. A IA não
// tem sessão, não tem navegador e não tem RLS — então este arquivo refaz, em
// service_role, só o pedaço de que ela precisa. O que NÃO é dela continua onde
// estava: encaixe manual, remarcação, desfecho, SAL.
//
// TRÊS REGRAS QUE VALEM SÓ PRA ELA, e são de propósito mais apertadas que as do
// time (decisões do Bruno, 25/08):
//
//   1. Janela 11h–18h, de segunda a sexta. O time enxerga a grade inteira
//      (07h–22h) e continua enxergando; a IA não oferece 7h da manhã nem sábado.
//   2. Nada com menos de 3 horas de antecedência. Reunião marcada às 10h50 pras
//      11h vira no-show, e no-show custa mais caro que agenda vazia.
//   3. Sempre DUAS opções, nunca uma lista. É o funil que o time usa e que mais
//      agenda — e, como o horário sai daqui e volta por um id, ela não tem como
//      inventar um horário que não existe.
//
// FUSO: a função da Vercel roda em UTC. Toda a conta de "11h da manhã" é feita
// em horário de São Paulo com Intl, nunca com getHours() — que ali devolveria
// 8h. E o offset é DESCOBERTO, não escrito na mão: o Brasil pode voltar a ter
// horário de verão, e no dia em que voltar isto aqui continua certo.
// -----------------------------------------------------------------------------

import { rest, insert } from './_supabaseAdmin.js';

const TZ = 'America/Sao_Paulo';

/** A janela que a IA pode oferecer (hora cheia, em São Paulo). */
export const JANELA_IA = { primeira: 11, ultima: 17 };  // 17h é o último começo (termina 18h)
export const DURACAO_MIN = 60;
export const ANTECEDENCIA_MIN = 180;
/** Até onde ela procura horário livre. Duas semanas úteis é mais que suficiente. */
const DIAS_A_FRENTE = 14;

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// ─── Fuso ────────────────────────────────────────────────────────────────────

const PARTES = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});

/** Que horas são, em São Paulo, no instante `d`. */
export function emSP(d) {
  const p = {};
  for (const parte of PARTES.formatToParts(d)) {
    if (parte.type === 'weekday') continue;
    p[parte.type] = Number(parte.value);
  }
  // hour12:false devolve 24 pra meia-noite em algumas engines.
  if (p.hour === 24) p.hour = 0;
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour, min: p.minute, diaSemana: dow };
}

/** Quanto São Paulo está deslocado do UTC naquele instante (em ms, negativo). */
function deslocamento(d) {
  const p = emSP(d);
  return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.min, 0) - Math.floor(d.getTime() / 60_000) * 60_000;
}

/** O instante em que dá `hora:min` do dia `ano-mes-dia` em São Paulo. */
export function instanteEmSP(ano, mes, dia, hora, min = 0) {
  const palpite = new Date(Date.UTC(ano, mes - 1, dia, hora, min));
  // Duas passadas: a primeira corrige o grosso, a segunda cobre a virada do
  // horário de verão (quando existir), em que o offset do palpite é o do dia
  // anterior.
  let d = new Date(palpite.getTime() - deslocamento(palpite));
  d = new Date(palpite.getTime() - deslocamento(d));
  return d;
}

/** "quinta-feira, 27/08 às 14:00" — do jeito que ela vai falar. */
export function porExtenso(d) {
  const p = emSP(d);
  const dd = String(p.dia).padStart(2, '0');
  const mm = String(p.mes).padStart(2, '0');
  return `${DIAS_SEMANA[p.diaSemana]}, ${dd}/${mm} às ${String(p.hora).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
}

/** "hoje" / "amanhã" / "quinta-feira" — o jeito humano de dizer o dia. */
export function comoOTimeFala(d, agora = new Date()) {
  const a = emSP(agora), p = emSP(d);
  const dias = Math.round(
    (Date.UTC(p.ano, p.mes - 1, p.dia) - Date.UTC(a.ano, a.mes - 1, a.dia)) / 86_400_000
  );
  const hora = `${String(p.hora).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
  const data = `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}`;
  if (dias === 0) return `hoje (${data}) às ${hora}`;
  if (dias === 1) return `amanhã (${DIAS_SEMANA[p.diaSemana]}, ${data}) às ${hora}`;
  return `${DIAS_SEMANA[p.diaSemana]} (${data}) às ${hora}`;
}

// ─── Quem são os especialistas ───────────────────────────────────────────────

export async function closersAtivos() {
  const rows = await rest('qs_users?select=id,name,email&role=eq.closer&is_active=is.true&order=name');
  return Array.isArray(rows) ? rows : [];
}

/**
 * De quem é a vez.
 *
 * ALTERNÂNCIA FIXA (decisão do Bruno, 25/08): um agendamento pra cada, na
 * ordem. O último a receber fica guardado em `qs_settings.gloria_ultimo_closer`
 * — se ficasse só na memória do processo, cada função serverless nova começaria
 * a contagem do zero e o primeiro da lista levaria tudo.
 *
 * A vez é uma PREFERÊNCIA, não uma promessa: se o da vez não tem horário livre
 * no período que a pessoa pediu, quem tem leva. Agenda vazia por causa de
 * rodízio seria trocar o cliente pela planilha.
 */
export async function deQuemEAVez(closers) {
  if (closers.length <= 1) return closers[0] || null;
  let ultimo = null;
  try {
    const rows = await rest('qs_settings?select=value&key=eq.gloria_ultimo_closer&limit=1');
    ultimo = rows?.[0]?.value ?? null;
    if (ultimo && typeof ultimo === 'object') ultimo = ultimo.closer_id ?? null;
  } catch { /* sem registro ainda: começa pelo primeiro */ }
  const i = closers.findIndex((c) => c.id === ultimo);
  return closers[(i + 1) % closers.length];
}

async function anotarAVez(closerId) {
  await rest('qs_settings', {
    method: 'POST',
    body: { key: 'gloria_ultimo_closer', value: closerId, updated_at: new Date().toISOString() },
    prefer: 'resolution=merge-duplicates,return=minimal',
  }).catch((e) => console.warn('[agenda] não deu pra anotar a vez do closer:', e?.message));
}

// ─── O que ocupa a agenda ────────────────────────────────────────────────────

async function ocupacao(de, ate) {
  const [reunioes, bloqueios] = await Promise.all([
    rest(
      'qs_meetings?select=closer_id,scheduled_at,ends_at,duration_min&status=eq.agendada' +
      `&scheduled_at=gte.${de.toISOString()}&scheduled_at=lt.${ate.toISOString()}`
    ).catch(() => []),
    rest(
      'qs_closer_blocks?select=closer_id,starts_at,ends_at' +
      `&starts_at=lt.${ate.toISOString()}&ends_at=gt.${de.toISOString()}`
    ).catch(() => []),
  ]);

  const janelas = [];
  for (const m of Array.isArray(reunioes) ? reunioes : []) {
    const inicio = new Date(m.scheduled_at).getTime();
    const fim = m.ends_at ? new Date(m.ends_at).getTime() : inicio + (m.duration_min ?? 60) * 60_000;
    janelas.push({ closer_id: m.closer_id, inicio, fim });
  }
  for (const b of Array.isArray(bloqueios) ? bloqueios : []) {
    janelas.push({ closer_id: b.closer_id, inicio: new Date(b.starts_at).getTime(), fim: new Date(b.ends_at).getTime() });
  }
  return janelas;
}

function estaLivre(janelas, closerId, inicio, fim) {
  return !janelas.some((j) => j.closer_id === closerId && inicio < j.fim && j.inicio < fim);
}

/** manhã = até 12h; tarde = 12h em diante. Nulo aceita qualquer um. */
function doPeriodo(d, periodo) {
  if (!periodo) return true;
  const h = emSP(d).hora;
  if (periodo === 'manha') return h < 12;
  if (periodo === 'tarde') return h >= 12;
  return true;
}

/**
 * Os horários livres de um closer, em ordem, a partir de agora.
 *
 * `dia` (YYYY-MM-DD em São Paulo) prende num dia só — é o que responde "e na
 * quinta, tem ?". Sem ele, varre os próximos dias úteis.
 */
export async function horariosLivres({ closerId, periodo = null, dia = null, limite = 6, agora = new Date(), janelas = null } = {}) {
  const de = new Date(agora.getTime());
  const ate = new Date(agora.getTime() + (DIAS_A_FRENTE + 1) * 86_400_000);
  const ocupado = janelas || (await ocupacao(de, ate));

  const cedoDemais = agora.getTime() + ANTECEDENCIA_MIN * 60_000;
  const achados = [];
  const hoje = emSP(agora);

  for (let salto = 0; salto <= DIAS_A_FRENTE && achados.length < limite; salto++) {
    const base = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia) + salto * 86_400_000);
    const ano = base.getUTCFullYear(), mes = base.getUTCMonth() + 1, d = base.getUTCDate();
    const dow = base.getUTCDay();
    if (dow === 0 || dow === 6) continue;                    // fim de semana não
    if (dia && dia !== `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`) continue;

    for (let h = JANELA_IA.primeira; h <= JANELA_IA.ultima && achados.length < limite; h++) {
      const inicio = instanteEmSP(ano, mes, d, h, 0);
      const fim = new Date(inicio.getTime() + DURACAO_MIN * 60_000);
      if (inicio.getTime() < cedoDemais) continue;
      if (!doPeriodo(inicio, periodo)) continue;
      if (!estaLivre(ocupado, closerId, inicio.getTime(), fim.getTime())) continue;
      achados.push(inicio);
    }
  }
  return achados;
}

/**
 * As DUAS opções que ela oferece — e o especialista de cada uma.
 *
 * Devolve no máximo duas, sempre do MESMO closer (dois horários de agendas
 * diferentes fariam a pessoa escolher um horário e cair com outra pessoa).
 * O id de cada opção carrega closer + horário: é ele que volta no `agendar`,
 * então o modelo não tem como inventar horário nem trocar de especialista no
 * meio do caminho.
 */
export async function duasOpcoes({ periodo = null, dia = null, agora = new Date() } = {}) {
  const closers = await closersAtivos();
  if (!closers.length) return { ok: false, motivo: 'sem_closer', opcoes: [] };

  const janelas = await ocupacao(agora, new Date(agora.getTime() + (DIAS_A_FRENTE + 1) * 86_400_000));
  const daVez = await deQuemEAVez(closers);
  // O da vez primeiro; os outros são a rede de segurança de quando ele está cheio.
  const ordem = [daVez, ...closers.filter((c) => c.id !== daVez?.id)].filter(Boolean);

  for (const closer of ordem) {
    const livres = await horariosLivres({ closerId: closer.id, periodo, dia, limite: 2, agora, janelas });
    if (livres.length) {
      return {
        ok: true,
        closer: { id: closer.id, nome: closer.name, email: closer.email },
        opcoes: livres.map((d) => ({
          id: `${closer.id}|${d.toISOString()}`,
          quando: comoOTimeFala(d, agora),
          especialista: closer.name,
        })),
      };
    }
  }

  return { ok: false, motivo: 'sem_horario', opcoes: [] };
}

export function lerOpcao(id) {
  const [closerId, iso] = String(id || '').split('|');
  const quando = new Date(iso);
  if (!closerId || Number.isNaN(quando.getTime())) return null;
  return { closerId, quando };
}

// ─── Marcar ──────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailValido(e) {
  return EMAIL_RE.test(String(e || '').trim());
}

/**
 * Onde encaixar a cobrança de confirmar presença.
 *
 * Versão enxuta da conta que a tela faz: 24h antes, empurrada pra dentro do
 * expediente (`qs_settings.work_hours`) e nunca depois da própria reunião. Não
 * vale a pena reimplementar aqui o `nextWorkMoment` inteiro do front — o que
 * não pode acontecer é a tarefa nascer às 3h da manhã de um domingo.
 */
async function momentoDaConfirmacao(reuniaoEm, agora = new Date()) {
  let alvo = new Date(reuniaoEm.getTime() - 24 * 3_600_000);
  if (alvo.getTime() < agora.getTime()) alvo = new Date(agora.getTime());

  let expediente = null;
  try {
    const rows = await rest("qs_settings?select=value&key=eq.work_hours&limit=1");
    expediente = rows?.[0]?.value ?? null;
  } catch { /* sem config: cai no padrão de baixo */ }

  for (let i = 0; i < 7; i++) {
    const p = emSP(alvo);
    const dia = expediente?.[String(p.diaSemana)] ?? { start: '09:30', end: '19:30', enabled: p.diaSemana >= 1 && p.diaSemana <= 5 };
    if (dia.enabled !== false) {
      const [hi, mi] = String(dia.start || '09:30').split(':').map(Number);
      const [hf, mf] = String(dia.end || '19:30').split(':').map(Number);
      const abre = instanteEmSP(p.ano, p.mes, p.dia, hi, mi);
      const fecha = instanteEmSP(p.ano, p.mes, p.dia, hf, mf);
      if (alvo.getTime() < abre.getTime()) alvo = abre;
      if (alvo.getTime() <= fecha.getTime()) break;
    }
    // Dia fechado ou já passou do expediente: tenta a abertura do dia seguinte.
    const amanha = new Date(Date.UTC(p.ano, p.mes - 1, p.dia) + 86_400_000);
    alvo = instanteEmSP(amanha.getUTCFullYear(), amanha.getUTCMonth() + 1, amanha.getUTCDate(), 9, 30);
  }

  // Nunca depois da reunião: aí a cobrança não serve pra nada.
  if (alvo.getTime() >= reuniaoEm.getTime()) alvo = new Date(reuniaoEm.getTime() - 3_600_000);
  if (alvo.getTime() < agora.getTime()) alvo = new Date(agora.getTime());
  return alvo;
}

async function criarTarefa(row) {
  try {
    await insert('qs_tasks', row, { returning: false });
  } catch (e) {
    console.warn('[agenda] tarefa não criada:', e?.message);
  }
}

/**
 * Reunião marcada = prospecção encerrada.
 *
 * Mesma regra do agendamento pela tela (`encerrarProspeccao`): o lead vira
 * ganho e as atividades de cadência que sobraram são encerradas — MENOS as da
 * própria reunião (tag `meeting:<id>`), que são justamente o trabalho que ela
 * cria.
 */
async function encerrarProspeccao(leadId, meetingId) {
  try {
    await rest(
      `qs_leads?id=eq.${encodeURIComponent(leadId)}&status=not.in.(ganho,perdido)`,
      { method: 'PATCH', prefer: 'return=minimal', body: { status: 'ganho' } }
    );
  } catch (e) {
    console.warn('[agenda] lead não virou ganho:', e?.message);
  }
  try {
    const pendentes = await rest(
      `qs_tasks?select=id,tags&lead_id=eq.${encodeURIComponent(leadId)}&status=eq.pendente`
    );
    const daCadencia = (Array.isArray(pendentes) ? pendentes : [])
      .filter((t) => !(t.tags || []).some((g) => String(g).startsWith('meeting:')))
      .map((t) => t.id);
    for (const id of daCadencia) {
      await rest(`qs_tasks?id=eq.${id}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { status: 'ignorada', skip_reason: 'Reunião agendada pela Glória — cadência encerrada' },
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[agenda] atividades de prospecção seguem abertas:', e?.message);
  }
}

/**
 * O lead passa a ser do especialista.
 *
 * NÃO dá pra usar a `qs_transferir_lead` aqui, e isso custou uma prova pra
 * descobrir: a função é `security definer` mas começa com `auth.uid() is null
 * → 'Sessão inválida'`. Ela foi escrita pra tela, onde sempre existe alguém
 * logado. A Glória não tem sessão nenhuma, então a chamada volta 42501 e o
 * lead ficaria com o SDR mesmo depois da reunião marcada.
 *
 * Então aqui se faz, com service_role, exatamente as três coisas que ela faz —
 * dono, atividades em aberto e histórico. Se um dia ela mudar, este trecho
 * precisa mudar junto (é o preço de não ter uma versão de servidor dela).
 */
async function transferirProCloser(lead, closer) {
  if (lead.owner_id === closer.id) return true;
  try {
    await rest(`qs_leads?id=eq.${encodeURIComponent(lead.id)}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { owner_id: closer.id, updated_at: new Date().toISOString() },
    });
    // As atividades em aberto vão junto, senão o novo dono recebe um lead sem
    // nada pra fazer e o antigo fica com tarefa de lead que não é mais dele.
    await rest(
      `qs_tasks?lead_id=eq.${encodeURIComponent(lead.id)}&status=in.(pendente,atrasada)`,
      { method: 'PATCH', prefer: 'return=minimal', body: { owner_id: closer.id } }
    ).catch((e) => console.warn('[agenda] tarefas não seguiram o lead:', e?.message));
    await insert('qs_handovers', {
      lead_id: lead.id,
      from_user_id: lead.owner_id ?? closer.id,
      to_user_id: closer.id,
      briefing: `Reunião agendada pela Glória (IA) — atendimento passa pro especialista ${closer.name}`,
    }, { returning: false }).catch((e) => console.warn('[agenda] handover não registrado:', e?.message));
    return true;
  } catch (e) {
    console.warn('[agenda] transferência pro closer falhou:', e?.message);
    return false;
  }
}

/**
 * A sala do Meet, pelo mesmo caminho que a tela usa: o webhook da agenda no
 * n8n, que é quem tem a credencial do Google.
 *
 * Aqui NÃO passa por `/api/agenda-meet` de propósito: aquela rota exige o JWT
 * de um SDR logado, e a Glória não tem sessão nenhuma. Os dois nomes de header
 * vão juntos pelo mesmo motivo que lá — os webhooks do n8n dividem uma
 * credencial só e o nome dela muda conforme quem mexeu por último.
 */
async function criarSalaDoMeet(meeting, convidados) {
  const base = (process.env.N8N_AGENDA_URL || '').trim();
  const secret = (process.env.N8N_AGENDA_SECRET || '').trim();
  const alt = (process.env.N8N_SYNC_SECRET || '').trim();
  if (!base) return { ok: false, erro: 'agenda do Google não configurada (N8N_AGENDA_URL ausente)' };

  const inicio = new Date(meeting.scheduled_at);
  const fim = meeting.ends_at ? new Date(meeting.ends_at) : new Date(inicio.getTime() + (meeting.duration_min ?? 60) * 60_000);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret || alt ? { 'x-qs-agenda-secret': secret || alt, 'x-qs-sync-secret': alt || secret } : {}),
      },
      body: JSON.stringify({
        acao: 'criar',
        meeting_id: meeting.id,
        inicio: inicio.toISOString(),
        fim: fim.toISOString(),
        timezone: TZ,
        titulo: meeting.title || `Reunião · ${meeting.lead_name || 'cliente'}`,
        descricao: `Agendada pela Glória (IA) no WhatsApp.\nCliente ${meeting.lead_name || ''}`.trim(),
        convidados: convidados.filter(Boolean),
      }),
      signal: ctrl.signal,
    });
    const texto = await r.text();
    let resposta = null;
    try { resposta = texto ? JSON.parse(texto) : null; } catch { /* corpo ilegível */ }
    if (!r.ok) {
      // Junto do erro, o que foi mandado — tamanho e origem, nunca o valor.
      // "n8n HTTP 403" sozinho custou cinco dias na agenda do time.
      const usou = secret ? 'N8N_AGENDA_SECRET' : (alt ? 'N8N_SYNC_SECRET (fallback)' : 'NENHUM SEGREDO');
      return { ok: false, erro: `n8n HTTP ${r.status} · mandei x-qs-agenda-secret de ${usou} (${(secret || alt).length} caracteres)` };
    }
    if (!resposta || resposta.ok !== true) {
      return { ok: false, erro: `${resposta?.codigo ?? ''} ${resposta?.erro ?? ''}`.trim() || 'falha no Google' };
    }
    return { ok: true, link: resposta.meet_link || null, eventId: resposta.event_id || null, htmlLink: resposta.html_link || null };
  } catch (e) {
    return { ok: false, erro: e?.name === 'AbortError' ? 'n8n não respondeu a tempo' : (e?.message || 'falha ao falar com o n8n') };
  } finally {
    clearTimeout(timer);
  }
}

/** Avisa o Bitrix, best-effort. O QS é a fonte da verdade; o card é espelho. */
async function avisarBitrix(meeting, lead) {
  const base = (process.env.N8N_SYNC_BASE || '').trim().replace(/\/+$/, '');
  const secret = (process.env.N8N_SYNC_SECRET || '').trim();
  if (!base || !lead?.bitrix_id) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    try {
      await fetch(`${base}/qs-reuniao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-qs-sync-secret': secret, 'x-qs-agenda-secret': secret } : {}) },
        body: JSON.stringify({
          lead_id: meeting.lead_id,
          meeting_id: meeting.id,
          bitrix_id: lead.bitrix_id,
          full_name: meeting.lead_name,
          title: meeting.title,
          scheduled_at: meeting.scheduled_at,
          duration_min: meeting.duration_min,
          location: meeting.location,
          meeting_link: meeting.meeting_link,
          notes: meeting.notes,
          scheduled_by: meeting.scheduled_by,
          meeting_owner: meeting.meeting_owner,
          client_email: meeting.client_email,
          booking_date: meeting.booking_date,
        }),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
  } catch (e) {
    console.warn('[agenda] Bitrix não avisado:', e?.message);
  }
}

/**
 * Marca a reunião. É o único lugar do servidor que escreve em `qs_meetings`.
 *
 * ORDEM, e ela não é negociável: a linha no banco vem PRIMEIRO. O horário fica
 * reservado (a constraint EXCLUDE da 0027 é quem garante que dois não caem em
 * cima) mesmo que o Google, o Bitrix e as tarefas falhem depois. O contrário —
 * Google primeiro — produziria sala órfã sem reserva, e foi por isso que a tela
 * já faz nesta ordem.
 *
 * Tudo o que vem depois da reserva é best-effort e devolve AVISO, nunca erro:
 * uma reunião marcada sem link do Meet é um problema pequeno; um cliente que
 * escolheu horário e não foi marcado é o problema grande.
 */
export async function marcarReuniao({ lead, opcao, email = null, titulo = null, resumo = null }) {
  const closers = await closersAtivos();
  const closer = closers.find((c) => c.id === opcao.closerId);
  if (!closer) return { ok: false, motivo: 'closer_desconhecido' };

  const inicio = opcao.quando;
  const fim = new Date(inicio.getTime() + DURACAO_MIN * 60_000);
  const agora = new Date();

  if (inicio.getTime() < agora.getTime() + ANTECEDENCIA_MIN * 60_000) {
    return { ok: false, motivo: 'cedo_demais' };
  }

  // Última conferência antes de gravar. Não é a trava (a trava é a constraint),
  // é o que permite devolver "esse acabou de ser preenchido" em vez de um erro
  // de Postgres.
  const janelas = await ocupacao(new Date(inicio.getTime() - 3_600_000), new Date(fim.getTime() + 3_600_000));
  if (!estaLivre(janelas, closer.id, inicio.getTime(), fim.getTime())) {
    return { ok: false, motivo: 'horario_ocupado' };
  }

  const emailLimpo = emailValido(email) ? String(email).trim() : null;
  const nome = lead.full_name || lead.first_name || 'cliente';
  const row = {
    lead_id: lead.id,
    lead_name: nome,
    owner_id: closer.id,
    closer_id: closer.id,
    title: titulo || `Reunião · ${nome}`,
    scheduled_at: inicio.toISOString(),
    duration_min: DURACAO_MIN,
    location: 'Google Meet',
    status: 'agendada',
    scheduled_by: 'Glória (IA)',
    meeting_owner: closer.name,
    client_email: emailLimpo,
    booking_date: (() => { const p = emSP(agora); return `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`; })(),
    tipo: 'primeira',
    notes: [
      `Agendada pela Glória (IA) no WhatsApp · Especialista: ${closer.name}`,
      emailLimpo ? `E-mail: ${emailLimpo}` : 'SEM E-MAIL — o cliente não quis passar, o convite do Google não vai pra ele',
      resumo || null,
    ].filter(Boolean).join(' · ').slice(0, 2000),
  };

  let meeting;
  try {
    const criadas = await insert('qs_meetings', row);
    meeting = Array.isArray(criadas) ? criadas[0] : criadas;
  } catch (e) {
    const msg = String(e?.message || '');
    if (e?.status === 409 || /23P01|exclusion|no_overlap/i.test(msg)) {
      return { ok: false, motivo: 'horario_ocupado' };
    }
    console.error('[agenda] reunião NÃO gravada:', msg);
    return { ok: false, motivo: 'falha_ao_gravar', erro: msg };
  }
  if (!meeting?.id) return { ok: false, motivo: 'falha_ao_gravar' };

  // ── Daqui pra baixo o horário JÁ está reservado. Nada abaixo derruba isso. ──
  const avisos = [];

  if (emailLimpo) {
    await rest(`qs_leads?id=eq.${encodeURIComponent(lead.id)}`, {
      method: 'PATCH', prefer: 'return=minimal', body: { email: emailLimpo },
    }).catch((e) => console.warn('[agenda] e-mail não gravado no lead:', e?.message));
  } else {
    avisos.push('sem e-mail do cliente');
  }

  const tag = `meeting:${meeting.id}`;
  const quando = porExtenso(inicio);

  // CONFIRMAR PRESENÇA É DO SDR, não do closer (decisão do Bruno, 25/08).
  //
  // Quem conversou com a pessoa foi ele, e era o buraco do desenho anterior: a
  // Glória marcava, o lead passava pro closer e o SDR não ficava sabendo de
  // nada — o lead só sumia da fila dele. Pior, ela promete na conversa que
  // "ele vai te chamar por aqui", e não havia ninguém do outro lado dessa
  // promessa.
  //
  // Ele continua enxergando o lead depois da transferência: `qs_owns_lead`
  // (0050) inclui quem passou o lead adiante, e o handover é gravado logo
  // abaixo com ele como `from_user_id`.
  const sdr = lead.owner_id && lead.owner_id !== closer.id ? lead.owner_id : closer.id;
  await criarTarefa({
    lead_id: lead.id,
    owner_id: sdr,
    channel_type: 'whatsapp',
    priority: 'alta',
    scheduled_at: (await momentoDaConfirmacao(inicio, agora)).toISOString(),
    status: 'pendente',
    is_extra: true,
    notes:
      `A Glória agendou esta reunião: ${quando}, ${nome} com ${closer.name}. ` +
      `Confirme a presença com o cliente. Se ele não confirmar, remarque pela Agenda.`,
    tags: ['reuniao', 'confirmar', 'gloria', tag],
  });
  await criarTarefa({
    lead_id: lead.id,
    owner_id: closer.id,
    channel_type: 'pesquisa',
    priority: 'alta',
    scheduled_at: new Date(fim.getTime() + 5 * 60_000).toISOString(),
    status: 'pendente',
    is_extra: true,
    notes: `Registre o desfecho da reunião com ${nome} (${quando}): realizada, no-show ou reagendada — e o SAL. Abra Reuniões → o card da reunião.`,
    tags: ['reuniao', 'desfecho', tag],
  });

  await encerrarProspeccao(lead.id, meeting.id);

  // O lead passa a ser do especialista — mesma regra do agendamento pela tela.
  if (!(await transferirProCloser(lead, closer))) {
    avisos.push('o lead não passou pro especialista');
  }

  const sala = await criarSalaDoMeet(meeting, [closer.email, emailLimpo]);
  if (sala.ok) {
    const patch = { calendar_error: null, updated_at: new Date().toISOString() };
    if (sala.link) patch.meeting_link = sala.link;
    if (sala.eventId) patch.calendar_event_id = sala.eventId;
    if (sala.htmlLink) patch.calendar_html_link = sala.htmlLink;
    await rest(`qs_meetings?id=eq.${meeting.id}`, { method: 'PATCH', prefer: 'return=minimal', body: patch }).catch(() => {});
    meeting.meeting_link = sala.link || null;
  } else {
    avisos.push(`sem link do Meet (${sala.erro})`);
    await rest(`qs_meetings?id=eq.${meeting.id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { calendar_error: String(sala.erro).slice(0, 300) },
    }).catch(() => {});
  }

  await avisarBitrix(meeting, lead);
  await anotarAVez(closer.id);

  return {
    ok: true,
    meeting_id: meeting.id,
    quando: comoOTimeFala(inicio),
    quando_extenso: quando,
    especialista: closer.name,
    link: meeting.meeting_link || null,
    avisos,
  };
}
