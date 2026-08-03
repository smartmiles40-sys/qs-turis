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

    const { data: existing } = await supabase
      .from("qs_tasks")
      .select("id")
      .contains("tags", [tag])
      .in("status", ["pendente", "atrasada"])
      .limit(1);

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
  }

  notifyBitrix("reuniao", {
    lead_id: input.lead_id,
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
  const { data, error } = await supabase
    .from("qs_meetings")
    .update({ status, updated_at: new Date().toISOString() })
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

  return { ok: true, meeting: data as Meeting };
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
  leadBitrixId?: string | null
): Promise<MeetingResult> {
  const { data, error } = await supabase
    .from("qs_meetings")
    .update({
      sal,
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
        error: "O campo SAL ainda não existe no banco. Cole a migration 0030 no Supabase (supabase/migrations/0030_reuniao_confirmada_reagendada_sal.sql).",
      };
    }
    return { ok: false, error: `Não foi possível salvar o SAL: ${error.message}` };
  }
  if (!data) return { ok: false, error: "Você não tem permissão para alterar esta reunião." };

  if (sal) {
    notifyBitrix("nota", {
      lead_id: meeting.lead_id,
      bitrix_id: leadBitrixId ?? meeting.lead?.bitrix_id,
      body: `Reunião de ${formatDateTime(meeting.scheduled_at)}: lead ${sal.toUpperCase()} pelo especialista (SAL).`,
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
