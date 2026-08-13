// src/lib/qs/meetings.ts
// -----------------------------------------------------------------------------
// O CICLO DE VIDA DA REUNIÃO, num lugar só.
//
// Antes disto, `insert into qs_meetings` aparecia em TRÊS telas (MeetingsPage,
// LeadDetailPage e o modal de Ganho do Painel), cada uma com suas regras e seu
// pedaço de Bitrix. Agendar por um caminho não gerava a mesma coisa que agendar
// por outro. Aqui a reunião nasce, remarca, muda de status e morre sempre igual:
//
//   agendar   → grava + cria a ATIVIDADE DE CONFIRMAÇÃO + avisa o Bitrix
//   remarcar  → grava + MOVE a atividade de confirmação + nota no Bitrix
//   desfecho  → grava + ENCERRA a atividade de confirmação + nota no Bitrix
//   excluir   → apaga + encerra a atividade de confirmação
//
// A "atividade de cobrar reunião" (decisão do Bruno) é a de CONFIRMAÇÃO: uma
// tarefa na fila do SDR, X horas antes, pra ele confirmar a presença do lead.
// Ela é amarrada à reunião pela tag `meeting:<id>` — é assim que remarcação e
// cancelamento acham a tarefa depois.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import { getSetting } from "@/lib/qsSettings";
import { notifyBitrix } from "@/lib/qs/bitrixSync";
import { notifyError } from "@/lib/qs/notify";
import { cancelarEvento, criarEvento, reagendarEvento } from "@/lib/qs/agendaMeet";
import { loadWorkHours, nextWorkMoment, clampToWorkWindow, type WorkHours } from "@/lib/workHours";
import type { ChannelType, Meeting, MeetingSal, MeetingStatus } from "@/components/sdr/types";

// ── Configuração da atividade de confirmação ────────────────────────────────

export const MEETING_CONFIRM_KEY = "meeting_confirm";

export interface MeetingConfirmConfig {
  enabled: boolean;
  /** Quantas horas antes da reunião a tarefa entra na fila do SDR. */
  hours_before: number;
  channel: ChannelType;
}

export const DEFAULT_MEETING_CONFIRM: MeetingConfirmConfig = {
  enabled: true,
  hours_before: 24,
  channel: "whatsapp",
};

export async function loadMeetingConfirmConfig(): Promise<MeetingConfirmConfig> {
  const saved = await getSetting<Partial<MeetingConfirmConfig>>(MEETING_CONFIRM_KEY);
  return { ...DEFAULT_MEETING_CONFIRM, ...(saved ?? {}) };
}

// Horário de trabalho é lido uma vez por sessão — a tarefa de confirmação nunca
// pode nascer às 3h da manhã ou num domingo.
let workHoursCache: WorkHours | null = null;
async function getWorkHours(): Promise<WorkHours> {
  if (!workHoursCache) workHoursCache = await loadWorkHours();
  return workHoursCache;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function meetingTag(meetingId: string): string {
  return `meeting:${meetingId}`;
}

export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Quando a tarefa de confirmação deve entrar na fila.
 *
 * Alvo = reunião − X horas. Aí passa pelo expediente: se cair de madrugada ou no
 * domingo, anda pro próximo momento útil. Se ESSE momento já for depois da
 * reunião (típico do "24h antes" de uma reunião de segunda de manhã, que cai no
 * domingo), recua pro último horário útil ANTES dela — confirmar depois da
 * reunião não confirma nada.
 *
 * Devolve null quando não faz sentido criar a tarefa (reunião já passou).
 */
export function confirmTaskMoment(
  wh: WorkHours,
  meetingAt: Date,
  hoursBefore: number,
  now: Date = new Date()
): Date | null {
  if (meetingAt.getTime() <= now.getTime()) return null;

  const target = new Date(meetingAt.getTime() - hoursBefore * 3_600_000);
  let at = target.getTime() < now.getTime() ? new Date(now) : target;
  at = nextWorkMoment(wh, at);

  if (at.getTime() >= meetingAt.getTime()) {
    // Recua: mesmo dia da reunião, 1h antes, encaixado na janela de expediente.
    const recuo = clampToWorkWindow(wh, new Date(meetingAt.getTime() - 3_600_000));
    at = recuo.getTime() < meetingAt.getTime() ? recuo : new Date(meetingAt.getTime() - 1_800_000);
    if (at.getTime() < now.getTime()) at = new Date(now);
  }
  // Última guarda: nunca depois da reunião.
  if (at.getTime() >= meetingAt.getTime()) return new Date(now);
  return at;
}

function confirmTaskNotes(m: { scheduled_at: string; lead_name?: string | null }, closerName?: string | null): string {
  const quem = closerName ? ` com ${closerName}` : "";
  return `Confirmar presença na reunião de ${formatDateTime(m.scheduled_at)}${quem}. Se o lead não confirmar, remarque pela Agenda.`;
}

// ── A atividade de confirmação ──────────────────────────────────────────────

interface ConfirmTaskInput {
  meetingId: string;
  leadId: string;
  ownerId: string | null;
  cadenceId?: string | null;
  scheduledAt: string;
  leadName?: string | null;
  closerName?: string | null;
}

/**
 * Cria (ou reposiciona) a tarefa de confirmação da reunião. Idempotente: se já
 * existe uma aberta com a tag da reunião, ela é MOVIDA em vez de duplicada.
 */
export async function ensureConfirmTask(input: ConfirmTaskInput): Promise<void> {
  try {
    const cfg = await loadMeetingConfirmConfig();
    if (!cfg.enabled) return;

    const wh = await getWorkHours();
    const when = confirmTaskMoment(wh, new Date(input.scheduledAt), cfg.hours_before);
    if (!when) return; // reunião no passado — não há o que confirmar

    const tag = meetingTag(input.meetingId);
    const notes = confirmTaskNotes({ scheduled_at: input.scheduledAt, lead_name: input.leadName }, input.closerName);

    // Mesma regra do desfecho (ver ensureOutcomeTask): erro na checagem NÃO pode
    // virar um INSERT às cegas.
    const { data: existing, error: erroExistente } = await supabase
      .from("qs_tasks")
      .select("id")
      .contains("tags", [tag])
      .in("status", ["pendente", "atrasada"])
      .limit(1);

    if (erroExistente) {
      console.warn("[meetings] não deu pra checar a atividade de confirmação; não vou duplicar:", erroExistente.message);
      return;
    }

    if (existing && existing.length > 0) {
      await supabase
        .from("qs_tasks")
        .update({ scheduled_at: when.toISOString(), status: "pendente", notes })
        .eq("id", existing[0].id);
      return;
    }

    const { error } = await supabase.from("qs_tasks").insert({
      lead_id: input.leadId,
      cadence_id: input.cadenceId ?? null,
      owner_id: input.ownerId,
      channel_type: cfg.channel,
      priority: "alta",
      scheduled_at: when.toISOString(),
      status: "pendente",
      is_extra: true,
      notes,
      tags: ["reuniao", "confirmar", tag],
    });
    if (error) console.warn("[meetings] atividade de confirmação não criada:", error.message);
  } catch (e) {
    // Nunca derruba o agendamento: a reunião é o que importa.
    console.warn("[meetings] falha ao preparar a atividade de confirmação:", e);
  }
}

// ── A atividade de DESFECHO ─────────────────────────────────────────────────
// A de confirmação cobra ANTES ("o cliente vem?"). Faltava a de DEPOIS: "no que
// deu?". É a lacuna que produz o número mais feio do sistema — reunião que
// acontece e nunca vira dado. Hoje a tela mostra o contador, mas só pra quem
// abre a tela; ninguém é cobrado.
//
// Ela nasce JUNTO com a reunião, agendada pro fim dela + 5 minutos. Sem cron:
// quando o horário chega, ela simplesmente aparece na fila. E não precisa ser
// concluída na mão — registrar o desfecho na Agenda já a encerra, porque o
// closeConfirmTask varre TODA tarefa com a tag desta reunião.
//
// Dono: o CLOSER, não o SDR. Quem sabe no que deu é quem esteve na reunião.
// Sem closer definido, cai pro SDR que agendou — melhor cobrar alguém do que
// ninguém.

interface OutcomeTaskInput {
  meetingId: string;
  leadId: string;
  closerId?: string | null;
  ownerId: string | null;
  scheduledAt: string;
  endsAt?: string | null;
  durationMin?: number | null;
  leadName?: string | null;
}

export async function ensureOutcomeTask(input: OutcomeTaskInput): Promise<void> {
  try {
    const fim = input.endsAt
      ? new Date(input.endsAt)
      : new Date(new Date(input.scheduledAt).getTime() + (input.durationMin ?? 60) * 60_000);
    const when = new Date(fim.getTime() + 5 * 60_000);

    const tag = meetingTag(input.meetingId);
    const dono = input.closerId ?? input.ownerId;
    if (!dono) return; // sem ninguém pra cobrar, não adianta criar

    const notes =
      `Registre o desfecho da reunião com ${input.leadName ?? "o lead"} ` +
      `(${formatDateTime(input.scheduledAt)}): realizada, no-show ou reagendada — e o SAL. ` +
      `Abra Reuniões → o card da reunião.`;

    // Já existe uma de desfecho aberta pra esta reunião? Move em vez de duplicar.
    //
    // O ERRO NÃO PODE SER IGNORADO. Ele era, e custou caro: em 07/08 havia 458
    // tarefas de desfecho abertas para 40 reuniões, uma delas com 27 cópias.
    // Esta checagem roda no navegador, sob RLS — leitura vazia por recusa da RLS
    // ou falha de rede era indistinguível de "não existe", e virava INSERT. Como
    // o `sweepOutcomeTasks` roda a cada abertura da Agenda, cada visita à tela
    // empilhava mais uma.
    //
    // Na dúvida agora NÃO cria: cobrança faltando é um problema menor do que a
    // fila do closer entupida. A garantia de verdade é o índice único da 0044.
    const { data: existing, error: erroExistente } = await supabase
      .from("qs_tasks")
      .select("id")
      .contains("tags", [tag, "desfecho"])
      .in("status", ["pendente", "atrasada"])
      .limit(1);

    if (erroExistente) {
      console.warn("[meetings] não deu pra checar se a cobrança já existe; não vou duplicar:", erroExistente.message);
      return;
    }

    if (existing && existing.length > 0) {
      await supabase
        .from("qs_tasks")
        .update({ scheduled_at: when.toISOString(), status: "pendente", notes, owner_id: dono })
        .eq("id", existing[0].id);
      return;
    }

    const { error } = await supabase.from("qs_tasks").insert({
      lead_id: input.leadId,
      owner_id: dono,
      channel_type: "pesquisa",   // não é contato com o cliente: é registro interno
      priority: "alta",
      scheduled_at: when.toISOString(),
      status: "pendente",
      is_extra: true,
      notes,
      tags: ["reuniao", "desfecho", tag],
    });
    if (error) console.warn("[meetings] atividade de desfecho não criada:", error.message);
  } catch (e) {
    // Nunca derruba o agendamento: a reunião é o que importa.
    console.warn("[meetings] falha ao preparar a atividade de desfecho:", e);
  }
}

/**
 * Cria as atividades de desfecho que faltam para reuniões que JÁ venceram sem
 * resposta. Serve pro passivo que existe hoje (as que aconteceram antes desta
 * função existir) — sem isto, a cobrança só valeria daqui pra frente.
 *
 * Chamada quando a Agenda carrega. É idempotente e barata: uma consulta e, na
 * imensa maioria das vezes, nenhuma escrita.
 */
export async function sweepOutcomeTasks(): Promise<void> {
  try {
    const { data: vencidas } = await supabase
      .from("qs_meetings")
      .select("id, lead_id, closer_id, owner_id, scheduled_at, ends_at, duration_min, lead_name")
      .in("status", ["agendada", "confirmada"])
      .lt("ends_at", new Date().toISOString())
      .limit(50);

    for (const m of vencidas ?? []) {
      await ensureOutcomeTask({
        meetingId: m.id,
        leadId: m.lead_id,
        closerId: m.closer_id,
        ownerId: m.owner_id,
        scheduledAt: m.scheduled_at,
        endsAt: m.ends_at,
        durationMin: m.duration_min,
        leadName: m.lead_name,
      });
      // Reunião que JÁ PASSOU não tem mais o que confirmar — a cobrança de
      // confirmação vencida só empilhava na fila (medido em 14/08: 11 abertas
      // de reuniões passadas). O que importa agora é o DESFECHO, garantido
      // logo acima. Idempotente: já encerrada, o update não acha linha.
      await closeConfirmTask(m.id, "Reunião já passou — confirmação perdeu o objeto");
    }
  } catch (e) {
    console.warn("[meetings] varredura de desfechos pendentes falhou:", e);
  }
}

/** Encerra a tarefa de confirmação (reunião cancelada, realizada, no-show ou excluída). */
export async function closeConfirmTask(meetingId: string, motivo: string): Promise<void> {
  try {
    await supabase
      .from("qs_tasks")
      .update({ status: "ignorada", skip_reason: motivo })
      .contains("tags", [meetingTag(meetingId)])
      .in("status", ["pendente", "atrasada"]);
  } catch (e) {
    console.warn("[meetings] falha ao encerrar a atividade de confirmação:", e);
  }
}

// ── Agendar ─────────────────────────────────────────────────────────────────

export interface CreateMeetingInput {
  lead_id: string;
  lead_name?: string | null;
  lead_bitrix_id?: string | null;
  lead_email?: string | null;
  cadence_id?: string | null;
  /** SDR que está agendando (dono da reunião e da tarefa de confirmação). */
  owner_id: string | null;
  owner_name?: string | null;
  closer_id: string | null;
  closer_name?: string | null;
  title?: string | null;
  scheduled_at: Date;
  /** null = usa o padrão do banco (a trigger da 0027 calcula ends_at com 30 min). */
  duration_min: number | null;
  location?: string | null;
  meeting_link?: string | null;
  notes?: string | null;
  /** Desfecho já conhecido (registro retroativo pela lista de Reuniões).
   *  Padrão "agendada" — e só nela nasce a atividade de confirmação. */
  status?: MeetingStatus;
  /** Dia em que o agendamento foi FEITO (o n8n leva pro Bitrix). Padrão: hoje. */
  booking_date?: string | null;
}

export type MeetingResult =
  | { ok: true; meeting: Meeting }
  | { ok: false; error: string; conflict?: boolean };

/** Erro 23P01 = a trava anti-choque do banco (constraint EXCLUDE da 0027). */
function isConflict(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "23P01" || /qs_meetings_closer_no_overlap|exclusion constraint/i.test(error?.message ?? "");
}

/**
 * A 0027 ainda não foi aplicada no banco? (coluna/tabela inexistente)
 *
 * O deploy do front e a migration não acontecem no mesmo segundo — o código sobe
 * pela Vercel no push, a migration é colada à mão no Supabase. Nesse intervalo,
 * gravar `closer_id`/`lead_name` daria erro e o SDR ficaria sem conseguir agendar.
 * Então detectamos e regravamos no formato antigo. É a mesma rede que o fluxo de
 * Ganho já usava para a 0006.
 */
function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  const code = error?.code ?? "";
  if (code === "42703" || code === "42P01" || code === "PGRST204" || code === "PGRST200") return true;
  return /column .*(closer_id|lead_name)|qs_closer_/i.test(error?.message ?? "");
}

export async function createMeeting(input: CreateMeetingInput): Promise<MeetingResult> {
  const status: MeetingStatus = input.status ?? "agendada";
  const row = {
    lead_id: input.lead_id,
    lead_name: input.lead_name ?? null,
    owner_id: input.owner_id,
    closer_id: input.closer_id,
    title: input.title?.trim() || null,
    scheduled_at: input.scheduled_at.toISOString(),
    duration_min: input.duration_min,
    location: input.location?.trim() || null,
    meeting_link: input.meeting_link?.trim() || null,
    notes: input.notes?.trim() || null,
    status,
    // Campos de texto do sync com o Bitrix (migration 0006) — o n8n lê daqui.
    scheduled_by: input.owner_name ?? null,
    meeting_owner: input.closer_name ?? null,
    client_email: input.lead_email ?? null,
    booking_date: input.booking_date ?? new Date().toISOString().slice(0, 10),
  };

  let { data, error } = await supabase.from("qs_meetings").insert(row).select().single();

  if (error && isMissingSchema(error)) {
    console.warn("[meetings] 0027 ainda não aplicada; gravando sem closer_id/lead_name:", error.message);
    const { closer_id: _closer, lead_name: _leadName, ...legacy } = row;
    ({ data, error } = await supabase.from("qs_meetings").insert(legacy).select().single());
  }

  if (error) {
    if (isConflict(error)) {
      return {
        ok: false,
        conflict: true,
        error: "Esse horário acabou de ser preenchido na agenda do closer. Escolha outro.",
      };
    }
    return { ok: false, error: `Não foi possível agendar: ${error.message}` };
  }
  if (!data) {
    return { ok: false, error: "Você não tem permissão para agendar esta reunião." };
  }

  const meeting = data as Meeting;

  // Reunião registrada já com desfecho (retroativa) não gera cobrança de confirmação.
  if (status === "agendada") {
    await ensureConfirmTask({
      meetingId: meeting.id,
      leadId: input.lead_id,
      ownerId: input.owner_id,
      cadenceId: input.cadence_id,
      scheduledAt: meeting.scheduled_at,
      leadName: input.lead_name,
      closerName: input.closer_name,
    });
    // E a cobrança do DEPOIS, que nasce junto: quando a reunião terminar, o
    // closer tem uma atividade esperando por ele pedindo o desfecho.
    await ensureOutcomeTask({
      meetingId: meeting.id,
      leadId: input.lead_id,
      closerId: meeting.closer_id ?? input.closer_id ?? null,
      ownerId: input.owner_id,
      scheduledAt: meeting.scheduled_at,
      endsAt: meeting.ends_at,
      durationMin: meeting.duration_min,
      leadName: input.lead_name,
    });
  }

  notifyBitrix("reuniao", {
    lead_id: input.lead_id,
    // O n8n grava o resultado de volta NESTA reunião (bitrix_synced / bitrix_error).
    // Sem o id ele teria que adivinhar a linha por lead + horário.
    meeting_id: meeting.id,
    bitrix_id: input.lead_bitrix_id,
    full_name: input.lead_name ?? null,
    title: row.title,
    scheduled_at: row.scheduled_at,
    duration_min: row.duration_min,
    location: row.location,
    meeting_link: row.meeting_link,
    notes: row.notes,
    scheduled_by: row.scheduled_by,
    meeting_owner: row.meeting_owner,
    client_email: row.client_email,
    booking_date: row.booking_date,
  });

  return { ok: true, meeting };
}

/**
 * Avisa o Bitrix DE NOVO, agora com o link da sala.
 *
 * Por que existe: a reunião é gravada antes de a sala do Meet ser criada — é
 * essa ordem que garante que o horário fica reservado mesmo se o Google falhar.
 * O efeito colateral é que o primeiro aviso ao Bitrix sai com o link vazio.
 *
 * O workflow do lado de lá é um `crm.deal.update` com os mesmos campos, então
 * repetir é inofensivo: o segundo disparo apenas preenche o que faltava.
 */
export function avisarBitrixDaSala(
  meeting: Meeting,
  extras: { bitrix_id?: string | null; lead_name?: string | null; link: string }
): void {
  if (!extras.bitrix_id || !extras.link) return;
  notifyBitrix("reuniao", {
    lead_id: meeting.lead_id,
    meeting_id: meeting.id,
    bitrix_id: extras.bitrix_id,
    full_name: extras.lead_name ?? meeting.lead_name ?? null,
    title: meeting.title,
    scheduled_at: meeting.scheduled_at,
    duration_min: meeting.duration_min,
    location: "Google Meet",
    meeting_link: extras.link,
    notes: meeting.notes,
    scheduled_by: meeting.scheduled_by,
    meeting_owner: meeting.meeting_owner,
    client_email: meeting.client_email,
    booking_date: meeting.booking_date,
  });
}

// ── A sala do Google Meet ───────────────────────────────────────────────────
// Antes disto, SÓ o fluxo de Ganho criava o evento no Google. Quem agendava por
// Reuniões ou pela Agenda gravava a reunião e ficava sem sala — e descobria na
// hora da reunião. Agora os três caminhos passam por aqui.
//
// Nada nesta função pode derrubar quem chamou: a reunião JÁ está gravada quando
// ela roda. Google fora do ar vira aviso, nunca exceção.

export interface SalaMeetResult {
  /** Link da sala, quando o Google devolveu um. */
  link: string | null;
  /** Frase pronta pra mostrar ao usuário quando algo não saiu como esperado. */
  aviso: string | null;
}

export async function gerarSalaMeet(
  meeting: Meeting,
  opts?: { linkManual?: string | null }
): Promise<SalaMeetResult> {
  // Link colado à mão manda: a reunião pode ser por Zoom, Teams ou pela sala
  // fixa do especialista. Criar um Meet por cima trocaria o link que o SDR
  // escolheu — e o cliente receberia o endereço errado.
  const manual = String(opts?.linkManual ?? "").trim();
  if (manual) return { link: manual, aviso: null };

  // Reunião registrada já com desfecho (lançamento retroativo) não precisa de
  // sala: ela já aconteceu.
  if (meeting.status !== "agendada") {
    return { link: meeting.meeting_link ?? null, aviso: null };
  }

  const r = await criarEvento({ meetingId: meeting.id });

  if (!r.ok) {
    const motivo = r.desligado ? "a agenda do Google está desligada" : (r.aviso ?? "motivo desconhecido");
    // Rede de segurança: quando a falha acontece no NAVEGADOR (sessão, rede), a
    // rota nem chega a ser chamada, e sem isto a reunião ficaria sem explicação
    // nenhuma no banco — "não funcionou" em vez de "não funcionou por isto".
    void supabase
      .from("qs_meetings")
      .update({ calendar_error: `[app] ${motivo}`.slice(0, 300) })
      .eq("id", meeting.id);
    return {
      link: null,
      aviso: `A reunião foi agendada, mas ficou SEM link do Meet (${motivo}) — mande o link na mão.`,
    };
  }

  if (r.semMeet) {
    return {
      link: r.meetLink ?? null,
      aviso: "O evento foi criado no Google, mas sem sala do Meet — mande o link na mão.",
    };
  }

  if (r.convidadosDescartados?.length) {
    // E-mail malformado faria o Google recusar o evento inteiro, então o n8n
    // descarta e segue. Quem agendou precisa saber quem NÃO foi convidado —
    // senão o cliente simplesmente não recebe e ninguém percebe.
    return {
      link: r.meetLink ?? null,
      aviso: `Sala criada, mas este e-mail é inválido e não foi convidado: ${r.convidadosDescartados.join(", ")}.`,
    };
  }

  return { link: r.meetLink ?? null, aviso: null };
}

/**
 * Guarda no lead o e-mail digitado no agendamento.
 *
 * É o que faz o campo vir preenchido sozinho da próxima vez: o e-mail do
 * cliente quase nunca está no cadastro (o Bitrix manda telefone, raramente
 * e-mail), e sem ele o Google não tem pra quem mandar o convite.
 */
export async function salvarEmailDoLead(leadId: string, email: string | null | undefined): Promise<boolean> {
  const limpo = String(email ?? "").trim();
  if (!limpo) return false;
  const { error } = await supabase.from("qs_leads").update({ email: limpo }).eq("id", leadId);
  if (error) {
    console.warn("[meetings] e-mail do lead não atualizado:", error.message);
    return false;
  }
  return true;
}

// ── Remarcar ────────────────────────────────────────────────────────────────

export interface RescheduleInput {
  meeting: Meeting;
  scheduled_at: Date;
  duration_min?: number;
  closer_id?: string | null;
  closer_name?: string | null;
  /** Quem está remarcando — vai no rastro gravado em `notes`. */
  by?: string | null;
  lead_bitrix_id?: string | null;
}

export async function rescheduleMeeting(input: RescheduleInput): Promise<MeetingResult> {
  const { meeting } = input;
  const antes = meeting.scheduled_at;

  // Rastro no próprio campo de anotações (mesmo padrão que a MeetingsPage já
  // usava): a remarcação fica visível pra quem abrir a reunião depois.
  const hoje = formatDateTime(new Date()).split(" ")[0];
  const audit = `↻ Remarcada de ${formatDateTime(antes)} para ${formatDateTime(input.scheduled_at)} (por ${input.by ?? "alguém"} em ${hoje})`;
  const notes = meeting.notes ? `${audit}\n${meeting.notes}` : audit;

  const patch: Record<string, unknown> = {
    scheduled_at: input.scheduled_at.toISOString(),
    notes,
    status: "agendada",
    updated_at: new Date().toISOString(),
  };
  if (input.duration_min != null) patch.duration_min = input.duration_min;
  if (input.closer_id !== undefined) {
    patch.closer_id = input.closer_id;
    patch.meeting_owner = input.closer_name ?? null;
  }

  let { data, error } = await supabase.from("qs_meetings").update(patch).eq("id", meeting.id).select().single();

  if (error && isMissingSchema(error)) {
    console.warn("[meetings] 0027 ainda não aplicada; remarcando sem closer_id:", error.message);
    const { closer_id: _closer, ...legacy } = patch;
    ({ data, error } = await supabase.from("qs_meetings").update(legacy).eq("id", meeting.id).select().single());
  }

  if (error) {
    if (isConflict(error)) {
      return { ok: false, conflict: true, error: "O closer já tem reunião nesse horário. Escolha outro." };
    }
    return { ok: false, error: `Não foi possível remarcar: ${error.message}` };
  }
  if (!data) return { ok: false, error: "Você não tem permissão para remarcar esta reunião." };

  const updated = data as Meeting;

  await ensureConfirmTask({
    meetingId: updated.id,
    leadId: updated.lead_id,
    ownerId: updated.owner_id,
    scheduledAt: updated.scheduled_at,
    leadName: updated.lead_name ?? meeting.lead_name,
    closerName: input.closer_name ?? meeting.closer?.name,
  });

  notifyBitrix("nota", {
    lead_id: updated.lead_id,
    bitrix_id: input.lead_bitrix_id ?? meeting.lead?.bitrix_id,
    body: `Reunião remarcada de ${formatDateTime(antes)} para ${formatDateTime(updated.scheduled_at)} no QS.`,
  });

  // Mesmos campos do reagendamento novo — este é o caminho antigo (sem a 0033).
  notifyBitrix("reuniao-campos", {
    lead_id: updated.lead_id,
    bitrix_id: input.lead_bitrix_id ?? meeting.lead?.bitrix_id,
    desfecho: "remarcada",
    nova_data: String(updated.scheduled_at).slice(0, 10),
    nova_data_hora: new Date(updated.scheduled_at).toISOString(),
  });

  return { ok: true, meeting: updated };
}

// ── Desfecho ────────────────────────────────────────────────────────────────

const STATUS_PHRASE: Partial<Record<MeetingStatus, string>> = {
  confirmada: "foi CONFIRMADA pelo cliente",
  realizada: "foi REALIZADA",
  no_show: "teve NO-SHOW (cliente não compareceu)",
  reagendada: "foi REAGENDADA",
  cancelada: "foi CANCELADA",
};

/** Status que só existem depois da migration 0028 (o CHECK antigo os recusa). */
const STATUS_0028: MeetingStatus[] = ["confirmada", "reagendada"];

/** Erro 23514 = CHECK do banco recusou o valor (status/sal que a 0028 ainda não liberou). */
function isCheckViolation(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "23514" || /violates check constraint/i.test(error?.message ?? "");
}

export async function setMeetingStatus(
  meeting: Meeting,
  status: MeetingStatus,
  leadBitrixId?: string | null
): Promise<MeetingResult> {
  // `realizada_em` carimba QUANDO a reunião de fato aconteceu. Existe desde a
  // 0032 e nunca era preenchido por ninguém — é ele que ancora o SAL no mês da
  // REUNIÃO, e não no mês em que alguém lembrou de registrar. Sem isso, um
  // desfecho lançado com duas semanas de atraso contaminava o mês errado.
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "realizada" && !meeting.realizada_em) {
    patch.realizada_em = meeting.scheduled_at;
  }

  const { data, error } = await supabase
    .from("qs_meetings")
    .update(patch)
    .eq("id", meeting.id)
    .select()
    .single();

  if (error) {
    if (isCheckViolation(error) && STATUS_0028.includes(status)) {
      return {
        ok: false,
        error: `O banco ainda não aceita o status "${status}". Cole a migration 0030 no Supabase (supabase/migrations/0030_reuniao_confirmada_reagendada_sal.sql).`,
      };
    }
    return { ok: false, error: `Não foi possível atualizar a reunião: ${error.message}` };
  }
  if (!data) return { ok: false, error: "Você não tem permissão para alterar esta reunião." };

  // "Confirmada" ainda vai acontecer: a atividade de confirmação já cumpriu o
  // papel dela (o SDR confirmou), então também encerra.
  if (status !== "agendada") {
    await closeConfirmTask(meeting.id, `Reunião ${status === "no_show" ? "com no-show" : status}`);
  }

  const phrase = STATUS_PHRASE[status];
  if (phrase) {
    notifyBitrix("nota", {
      lead_id: meeting.lead_id,
      bitrix_id: leadBitrixId ?? meeting.lead?.bitrix_id,
      body: `Reunião de ${formatDateTime(meeting.scheduled_at)}${meeting.title ? ` (${meeting.title})` : ""} ${phrase} no QS.`,
    });
  }

  // Campos do negócio no Bitrix (mapeamento confirmado com o Bruno em 14/08):
  // realizada → "Data da reunião realizada" + "Reunião realizada? = Sim";
  // no-show → "Data de No Show" + "No Show? = Sim" + "Reunião realizada? = Não".
  // A data é a DA REUNIÃO (realizada_em/scheduled_at), não a de quando alguém
  // lembrou de registrar — mesma âncora do SAL (0032).
  if (status === "realizada" || status === "no_show") {
    const quando = String((data as Meeting).realizada_em ?? meeting.scheduled_at).slice(0, 10);
    notifyBitrix("reuniao-campos", {
      lead_id: meeting.lead_id,
      bitrix_id: leadBitrixId ?? meeting.lead?.bitrix_id,
      desfecho: status,
      data: quando,
    });
  }

  // Reunião que não vai mais acontecer não pode continuar ocupando a agenda do
  // Google: o closer veria um compromisso fantasma e o cliente receberia o
  // lembrete de uma reunião cancelada. Fire-and-forget de propósito — o desfecho
  // no QS já está gravado, e o job de auditoria recolhe o que falhar aqui.
  if ((status === "cancelada" || status === "no_show") && meeting.calendar_event_id) {
    void cancelarEvento({ meetingId: meeting.id, eventId: meeting.calendar_event_id });
  }

  return { ok: true, meeting: data as Meeting };
}

// ── Reagendar ───────────────────────────────────────────────────────────────

/**
 * Reagenda pelo modelo do briefing: a reunião antiga vira `reagendada` e nasce
 * uma NOVA com `reagendado_de` apontando pra ela. É isso que separa
 * reagendamento (avisou antes) de no-show (sumiu) — e que permite contar quantas
 * vezes o mesmo lead remarcou.
 *
 * Os dois passos rodam numa transação só, dentro da função `qs_reagendar_reuniao`
 * (migration 0033): a linha antiga ocupa o próprio horário, então liberar e
 * inserir precisa valer junto — senão um conflito no meio deixaria a reunião sem
 * substituta.
 *
 * O evento do Google é MOVIDO, não recriado: o cliente que já tem o link
 * continua com o link certo e o Google reenvia o convite sozinho.
 */
export async function reagendarReuniao(input: {
  meeting: Meeting;
  scheduledAt: Date;
  durationMin?: number | null;
  closerId?: string | null;
  closerNome?: string | null;
  por?: string | null;
}): Promise<MeetingResult> {
  const { meeting } = input;
  const { data, error } = await supabase.rpc("qs_reagendar_reuniao", {
    p_meeting_id: meeting.id,
    p_scheduled_at: input.scheduledAt.toISOString(),
    p_duration_min: input.durationMin ?? meeting.duration_min ?? 60,
    p_closer_id: input.closerId ?? meeting.closer_id ?? null,
    p_closer_nome: input.closerNome ?? meeting.meeting_owner ?? null,
    p_por: input.por ?? null,
  });

  if (error) {
    if (isConflict(error)) {
      return { ok: false, conflict: true, error: "O especialista já tem reunião nesse horário — nada foi alterado." };
    }
    if (isMissingSchema(error) || /qs_reagendar_reuniao/i.test(error.message ?? "")) {
      // A 0033 ainda não foi colada. Em vez de deixar o SDR sem remarcar, cai no
      // jeito ANTIGO (move a própria linha) — que é exatamente o comportamento
      // de hoje, então nada regride — e avisa o que se perde: sem a migration a
      // remarcação não vira histórico e o número de reagendamentos não existe.
      notifyError("Reagendamento gravado do jeito antigo: cole a migration 0033 pra separar reagendamento de no-show na métrica.");
      return rescheduleMeeting({
        meeting,
        scheduled_at: input.scheduledAt,
        duration_min: input.durationMin ?? undefined,
        closer_id: input.closerId ?? undefined,
        closer_name: input.closerNome ?? undefined,
        by: input.por ?? null,
        lead_bitrix_id: meeting.lead?.bitrix_id,
      });
    }
    return { ok: false, error: `Não foi possível reagendar: ${error.message}` };
  }
  // A função devolve UMA linha; o PostgREST entrega objeto ou array de um.
  const nova = (Array.isArray(data) ? data[0] : data) as Meeting | null;
  if (!nova) return { ok: false, error: "Você não tem permissão para reagendar esta reunião." };

  // Move o evento no Google pro horário novo, agora em nome da linha NOVA.
  if (meeting.calendar_event_id) {
    const r = await reagendarEvento({
      meetingId: nova.id,
      eventId: meeting.calendar_event_id,
      inicio: nova.scheduled_at,
      fim: nova.ends_at ?? undefined,
    });
    if (!r.ok && !r.desligado) {
      notifyError(`Reunião remarcada, mas o convite do Google não mudou de horário (${r.aviso}) — avise o cliente.`);
    }
  }

  await ensureConfirmTask({
    meetingId: nova.id,
    leadId: nova.lead_id,
    ownerId: nova.owner_id,
    scheduledAt: nova.scheduled_at,
    leadName: nova.lead_name ?? meeting.lead_name,
  });
  await ensureOutcomeTask({
    meetingId: nova.id,
    leadId: nova.lead_id,
    closerId: nova.closer_id,
    ownerId: nova.owner_id,
    scheduledAt: nova.scheduled_at,
    endsAt: nova.ends_at,
    durationMin: nova.duration_min,
    leadName: nova.lead_name ?? meeting.lead_name,
  });

  notifyBitrix("nota", {
    lead_id: nova.lead_id,
    bitrix_id: meeting.lead?.bitrix_id,
    body: `Reunião REAGENDADA de ${formatDateTime(meeting.scheduled_at)} para ${formatDateTime(nova.scheduled_at)} no QS.`,
  });

  // Campos: "Reagendamento" (date) + "Data e hora do agendamento (Google Meet)".
  notifyBitrix("reuniao-campos", {
    lead_id: nova.lead_id,
    bitrix_id: meeting.lead?.bitrix_id,
    desfecho: "remarcada",
    nova_data: String(nova.scheduled_at).slice(0, 10),
    nova_data_hora: new Date(nova.scheduled_at).toISOString(),
  });

  return { ok: true, meeting: nova };
}

// ── SAL (Sales Accepted Lead) ───────────────────────────────────────────────

/**
 * O especialista aceitou ou recusou o lead na reunião. É o dado que fecha o
 * funil: "realizada" sozinha não distingue lead bom de lead ruim.
 *
 * Passar `null` desmarca. Exige a migration 0028 (coluna `sal`) — sem ela a
 * gravação falha com uma mensagem que diz exatamente isso, em vez de um erro
 * de Postgres cru na cara do usuário.
 */
export async function setMeetingSal(
  meeting: Meeting,
  sal: MeetingSal | null,
  by?: string | null,
  leadBitrixId?: string | null,
  /** Obrigatório quando `sal` é "recusado" — o banco recusa sem ele (0032). */
  motivo?: string | null
): Promise<MeetingResult> {
  // Barra antes de ir ao banco: a mensagem daqui explica o que fazer, a do
  // Postgres seria "violates check constraint qs_meetings_sal_motivo_check".
  if (sal === "recusado" && !String(motivo ?? "").trim()) {
    return { ok: false, error: "Escolha o motivo da recusa — sem motivo, o número de leads recusados não serve pra nada." };
  }

  const { data, error } = await supabase
    .from("qs_meetings")
    .update({
      sal,
      sal_motivo: sal === "recusado" ? String(motivo).trim() : null,
      sal_at: sal ? new Date().toISOString() : null,
      sal_by: sal ? (by ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", meeting.id)
    .select()
    .single();

  if (error) {
    if (isMissingSchema(error) || isCheckViolation(error) || /column .*sal/i.test(error.message ?? "")) {
      return {
        ok: false,
        error: "O campo SAL ainda não existe no banco. Cole as migrations 0030 e 0032 no Supabase.",
      };
    }
    return { ok: false, error: `Não foi possível salvar o SAL: ${error.message}` };
  }
  if (!data) return { ok: false, error: "Você não tem permissão para alterar esta reunião." };

  if (sal) {
    notifyBitrix("nota", {
      lead_id: meeting.lead_id,
      bitrix_id: leadBitrixId ?? meeting.lead?.bitrix_id,
      body: `Reunião de ${formatDateTime(meeting.scheduled_at)}: lead ${sal.toUpperCase()} pelo especialista (SAL)${
        sal === "recusado" && motivo ? ` — motivo: ${motivo}` : ""
      }.`,
    });
    // Campo enum "SAL" do negócio (Aceito/Recusado).
    notifyBitrix("reuniao-campos", {
      lead_id: meeting.lead_id,
      bitrix_id: leadBitrixId ?? meeting.lead?.bitrix_id,
      desfecho: sal === "aceito" ? "sal_aceito" : "sal_recusado",
    });
  }

  return { ok: true, meeting: data as Meeting };
}

// ── Excluir ─────────────────────────────────────────────────────────────────

export async function deleteMeeting(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.from("qs_meetings").delete().eq("id", id).select();
  if (error) return { ok: false, error: `Não foi possível excluir a reunião: ${error.message}` };
  if (!data || data.length === 0) {
    return { ok: false, error: "Você não tem permissão para excluir esta reunião." };
  }
  await closeConfirmTask(id, "Reunião excluída");
  return { ok: true };
}
