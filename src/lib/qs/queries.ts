// src/lib/qs/queries.ts — Data access layer for the QS (Qualificacao SDR) system
import { supabase } from "@/lib/supabase";
import { notifyError } from "@/lib/qs/notify";
import type {
  SdrUser,
  Lead,
  LeadStatus,
  LeadSource,
  Task,
  TaskStatus,
  ChannelType,
  PriorityLevel,
  Cadence,
  CadenceStatus,
  CadenceDay,
  CadenceActivity,
  AcquisitionChannel,
  Meeting,
  MeetingStatus,
  Goal,
  GoalPeriod,
  Note,
  LossReason,
  ChannelConfig,
  CustomField,
  CustomFieldScope,
} from "@/components/sdr/types";

// ═══════════════════════════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════════════════════════

export async function fetchQsUsers(): Promise<SdrUser[]> {
  try {
    const { data, error } = await supabase
      .from("qs_users")
      .select("*")
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    return (data ?? []) as SdrUser[];
  } catch (err) {
    console.warn("[QS] fetchQsUsers failed:", err);
    return [];
  }
}

export async function fetchQsUser(id: string): Promise<SdrUser | null> {
  try {
    const { data, error } = await supabase
      .from("qs_users")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data as SdrUser;
  } catch (err) {
    console.warn("[QS] fetchQsUser failed:", err);
    return null;
  }
}

export async function createQsUser(
  data: Omit<SdrUser, "id" | "created_at">
): Promise<SdrUser | null> {
  try {
    const { data: row, error } = await supabase
      .from("qs_users")
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return row as SdrUser;
  } catch (err) {
    console.warn("[QS] createQsUser failed:", err);
    notifyError("Não foi possível criar o usuário — tente novamente.");
    return null;
  }
}

export async function updateQsUser(
  id: string,
  data: Partial<Omit<SdrUser, "id" | "created_at">>
): Promise<SdrUser | null> {
  try {
    const { data: row, error } = await supabase
      .from("qs_users")
      .update(data)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return row as SdrUser;
  } catch (err) {
    console.warn("[QS] updateQsUser failed:", err);
    notifyError("Não foi possível salvar o usuário — a alteração NÃO foi gravada.");
    return null;
  }
}

export async function deleteQsUser(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("qs_users")
      .update({ is_active: false })
      .eq("id", id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn("[QS] deleteQsUser (soft) failed:", err);
    notifyError("Não foi possível desativar o usuário.");
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEADS
// ═══════════════════════════════════════════════════════════════════════════════

export interface LeadFilters {
  status?: LeadStatus;
  source?: LeadSource;
  cadence_id?: string;
  owner_id?: string;
  search?: string;
}

export async function fetchQsLeads(filters?: LeadFilters): Promise<Lead[]> {
  try {
    let q = supabase
      .from("qs_leads")
      .select("*, owner:qs_users(*), loss_reason:qs_loss_reasons(*)")
      .order("created_at", { ascending: false });

    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.source) q = q.eq("source", filters.source);
    if (filters?.cadence_id) q = q.eq("cadence_id", filters.cadence_id);
    if (filters?.owner_id) q = q.eq("owner_id", filters.owner_id);
    if (filters?.search) {
      q = q.or(
        `full_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,company_name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%`
      );
    }

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as Lead[];
  } catch (err) {
    console.warn("[QS] fetchQsLeads failed:", err);
    return [];
  }
}

export async function fetchQsLead(id: string): Promise<Lead | null> {
  try {
    const { data, error } = await supabase
      .from("qs_leads")
      .select("*, owner:qs_users(*), loss_reason:qs_loss_reasons(*)")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data as Lead;
  } catch (err) {
    console.warn("[QS] fetchQsLead failed:", err);
    return null;
  }
}

export async function createQsLead(
  data: Omit<Lead, "id" | "created_at" | "updated_at" | "arrived_at" | "owner" | "loss_reason">
): Promise<Lead | null> {
  try {
    const { data: row, error } = await supabase
      .from("qs_leads")
      .insert({ ...data, arrived_at: new Date().toISOString() })
      .select("*, owner:qs_users(*), loss_reason:qs_loss_reasons(*)")
      .single();
    if (error) throw error;
    return row as Lead;
  } catch (err) {
    console.warn("[QS] createQsLead failed:", err);
    notifyError("Não foi possível criar o lead — tente novamente.");
    return null;
  }
}

export async function updateQsLead(
  id: string,
  data: Partial<Omit<Lead, "id" | "created_at" | "owner" | "loss_reason">>
): Promise<Lead | null> {
  try {
    const { data: row, error } = await supabase
      .from("qs_leads")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*, owner:qs_users(*), loss_reason:qs_loss_reasons(*)")
      .single();
    if (error) throw error;
    return row as Lead;
  } catch (err) {
    console.warn("[QS] updateQsLead failed:", err);
    notifyError("Não foi possível salvar o lead — a alteração NÃO foi gravada.");
    return null;
  }
}

export async function deleteQsLead(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("qs_leads")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn("[QS] deleteQsLead failed:", err);
    notifyError("Não foi possível excluir o lead.");
    return false;
  }
}

export async function markLeadGanho(id: string): Promise<Lead | null> {
  return updateQsLead(id, { status: "ganho" });
}

export async function markLeadPerdido(
  id: string,
  lossReasonId: string
): Promise<Lead | null> {
  return updateQsLead(id, { status: "perdido", loss_reason_id: lossReasonId });
}

export async function handoverLead(
  leadId: string,
  fromUserId: string,
  toUserId: string,
  briefing: string
): Promise<boolean> {
  try {
    const { error: handoverError } = await supabase
      .from("qs_handovers")
      .insert({
        lead_id: leadId,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        briefing,
      });
    if (handoverError) throw handoverError;

    // Só troca o dono — "qualificado" não é um status válido do CHECK do banco
    // (nao_iniciado | em_prospeccao | ganho | perdido); o status atual é mantido.
    const { error: leadError } = await supabase
      .from("qs_leads")
      .update({
        owner_id: toUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId);
    if (leadError) throw leadError;

    return true;
  } catch (err) {
    console.warn("[QS] handoverLead failed:", err);
    notifyError("Não foi possível fazer o handover — tente novamente.");
    return false;
  }
}

/**
 * Transfere UM lead de um SDR para outro (troca o dono e reatribui as tarefas
 * pendentes), SEM mexer no status do lead. Registra em qs_handovers pra histórico
 * e pra notificar o destinatário. Diferente de handoverLead (que qualifica p/ closer).
 */
export async function transferLead(
  leadId: string,
  fromUserId: string | null,
  toUserId: string,
  note?: string
): Promise<boolean> {
  try {
    const { error: hoError } = await supabase.from("qs_handovers").insert({
      lead_id: leadId,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      briefing: note?.trim() || "Lead transferido",
    });
    if (hoError) throw hoError;

    const { error: leadError } = await supabase
      .from("qs_leads")
      .update({ owner_id: toUserId, updated_at: new Date().toISOString() })
      .eq("id", leadId);
    if (leadError) throw leadError;

    // Reatribui as tarefas pendentes/atrasadas do lead ao novo dono. Se ISTO
    // falhar, o lead é do novo dono mas as tarefas ficam com o antigo (zumbi
    // pro novo SDR) — então avisamos em vez de fingir sucesso.
    const { error: taskError } = await supabase
      .from("qs_tasks")
      .update({ owner_id: toUserId })
      .eq("lead_id", leadId)
      .in("status", ["pendente", "atrasada"]);
    if (taskError) {
      notifyError("Lead transferido, mas as ATIVIDADES não foram — transfira de novo ou avise o gestor.");
      console.warn("[QS] transferLead: tarefas não reatribuídas:", taskError);
    }

    return true;
  } catch (err) {
    const msg = (err as { message?: string })?.message || "erro desconhecido";
    console.warn("[QS] transferLead failed:", err);
    notifyError(`Não foi possível transferir o lead: ${msg}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MÉTRICAS / METAS (placar real do Painel)
// ═══════════════════════════════════════════════════════════════════════════════

export interface ActivityCounts {
  doneToday: number;
  doneMonth: number;
}

/**
 * Conta as atividades CONCLUÍDAS hoje e no mês (placar real do Painel).
 * Se ownerId vier, conta só as do SDR; senão, do time inteiro.
 */
export async function fetchActivityCounts(ownerId?: string | null): Promise<ActivityCounts> {
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    let qDay = supabase.from("qs_tasks").select("id", { count: "exact", head: true })
      .eq("status", "concluida").gte("completed_at", dayStart.toISOString());
    let qMonth = supabase.from("qs_tasks").select("id", { count: "exact", head: true })
      .eq("status", "concluida").gte("completed_at", monthStart.toISOString());
    if (ownerId) { qDay = qDay.eq("owner_id", ownerId); qMonth = qMonth.eq("owner_id", ownerId); }
    const [d, m] = await Promise.all([qDay, qMonth]);
    return { doneToday: d.count ?? 0, doneMonth: m.count ?? 0 };
  } catch (err) {
    console.warn("[QS] fetchActivityCounts failed:", err);
    return { doneToday: 0, doneMonth: 0 };
  }
}

/**
 * Metas de ATIVIDADES vindas de qs_goals (period diario/mensal).
 * Com ownerId: prioriza a meta do próprio SDR; sem: soma as metas do time.
 * Retorna null quando não há meta cadastrada (o Painel usa o fallback).
 */
export async function fetchActivityGoals(ownerId?: string | null): Promise<{ daily: number | null; monthly: number | null }> {
  try {
    const { data, error } = await supabase.from("qs_goals").select("*").eq("type", "atividades");
    if (error || !data) return { daily: null, monthly: null };
    const goals = data as { owner_id: string | null; period: string; target_value: number }[];
    const pick = (period: string): number | null => {
      const list = goals.filter((g) => g.period === period);
      if (list.length === 0) return null;
      if (ownerId) {
        const own = list.find((g) => g.owner_id === ownerId);
        if (own) return own.target_value;
        const global = list.find((g) => !g.owner_id);
        return global ? global.target_value : null;
      }
      // visão do time: soma todas as metas do período
      return list.reduce((acc, g) => acc + (g.target_value || 0), 0) || null;
    };
    return { daily: pick("diario"), monthly: pick("mensal") };
  } catch (err) {
    console.warn("[QS] fetchActivityGoals failed:", err);
    return { daily: null, monthly: null };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════════════════════════

export interface TaskFilters {
  owner_id?: string;
  status?: TaskStatus;
  channel_type?: ChannelType;
  priority?: PriorityLevel;
  date_from?: string;
  date_to?: string;
  is_extra?: boolean;
}

export async function fetchQsTasks(filters?: TaskFilters): Promise<Task[]> {
  try {
    let q = supabase
      .from("qs_tasks")
      .select("*, lead:qs_leads(*), owner:qs_users(*)")
      .order("scheduled_at", { ascending: true });

    if (filters?.owner_id) q = q.eq("owner_id", filters.owner_id);
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.channel_type) q = q.eq("channel_type", filters.channel_type);
    if (filters?.priority) q = q.eq("priority", filters.priority);
    if (filters?.is_extra !== undefined) q = q.eq("is_extra", filters.is_extra);
    if (filters?.date_from) q = q.gte("scheduled_at", filters.date_from);
    if (filters?.date_to) q = q.lte("scheduled_at", filters.date_to);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as Task[];
  } catch (err) {
    console.warn("[QS] fetchQsTasks failed:", err);
    return [];
  }
}

export async function fetchQsTasksForToday(ownerId?: string): Promise<Task[]> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  return fetchQsTasks({
    owner_id: ownerId,
    date_from: todayStart.toISOString(),
    date_to: todayEnd.toISOString(),
  });
}

export async function completeTask(
  id: string,
  contactResult: string,
  notes?: string,
  tags?: string[]
): Promise<Task | null> {
  try {
    const updateData: Record<string, unknown> = {
      status: "concluida" as TaskStatus,
      completed_at: new Date().toISOString(),
      contact_result: contactResult,
    };
    if (notes !== undefined) updateData.notes = notes;
    if (tags !== undefined) updateData.tags = tags;

    // Só conclui se ainda estiver aberta: duplo clique / Enter+clique / dois SDRs
    // no mesmo lead não geram segunda conclusão (nem follow-up duplicado).
    const { data, error } = await supabase
      .from("qs_tasks")
      .update(updateData)
      .eq("id", id)
      .in("status", ["pendente", "atrasada"])
      .select("*, lead:qs_leads(*), owner:qs_users(*)");
    if (error) throw error;
    if (!data || data.length === 0) return null; // já concluída — no-op silencioso
    return data[0] as Task;
  } catch (err) {
    console.warn("[QS] completeTask failed:", err);
    notifyError("Não foi possível concluir a atividade — tente novamente.");
    return null;
  }
}

export async function skipTask(
  id: string,
  skipReason: string
): Promise<Task | null> {
  try {
    // Mesma guarda de idempotência do completeTask: só pula tarefa ainda aberta.
    const { data, error } = await supabase
      .from("qs_tasks")
      .update({
        status: "ignorada" as TaskStatus,
        skip_reason: skipReason,
      })
      .eq("id", id)
      .in("status", ["pendente", "atrasada"])
      .select("*, lead:qs_leads(*), owner:qs_users(*)");
    if (error) throw error;
    if (!data || data.length === 0) return null; // já encerrada — no-op silencioso
    return data[0] as Task;
  } catch (err) {
    console.warn("[QS] skipTask failed:", err);
    notifyError("Não foi possível pular a atividade — tente novamente.");
    return null;
  }
}

export async function createExtraTask(
  data: Omit<Task, "id" | "created_at" | "completed_at" | "lead" | "owner"> & { is_extra: true }
): Promise<Task | null> {
  try {
    const { data: row, error } = await supabase
      .from("qs_tasks")
      .insert({ ...data, is_extra: true })
      .select("*, lead:qs_leads(*), owner:qs_users(*)")
      .single();
    if (error) throw error;
    return row as Task;
  } catch (err) {
    console.warn("[QS] createExtraTask failed:", err);
    notifyError("Não foi possível criar a atividade extra.");
    return null;
  }
}

// Gera as tarefas de um lead a partir dos dias/atividades da cadência.
// Fonte ÚNICA usada por: cadastro de lead (TasksPanel), importação de CSV e
// vínculo em massa (LeadsPage) e Reativar Lead (LeadDetailPage) — antes eram
// 3 cópias divergentes (prioridade diferente em cada uma e uma coluna
// inexistente no Reativar, que fazia o insert inteiro falhar em silêncio).
export async function createCadenceTasks(
  leadId: string,
  cadenceId: string,
  ownerId: string | null
): Promise<Task[] | null> {
  try {
    // A prioridade de cada tarefa agora vem do PERÍODO da atividade (manhã/tarde/
    // dia todo), não mais da prioridade da cadência — então não buscamos mais ela.
    const { data: days, error: daysError } = await supabase
      .from("qs_cadence_days")
      .select("*, activities:qs_cadence_activities(*)")
      .eq("cadence_id", cadenceId)
      .order("day_number");
    if (daysError) throw daysError;
    if (!days || days.length === 0) return [];

    const base = new Date();
    const rows = (days as (CadenceDay & { activities: CadenceActivity[] })[]).flatMap((day) =>
      [...(day.activities ?? [])]
        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        .map((act) => {
          const scheduled = new Date(base);
          scheduled.setDate(scheduled.getDate() + Math.max(0, (day.day_number ?? 1) - 1));
          const [h, m] = (act.scheduled_time || "09:00").split(":").map(Number);
          scheduled.setHours(h || 9, m || 0, 0, 0);
          return {
            lead_id: leadId,
            cadence_id: cadenceId,
            owner_id: ownerId,
            channel_type: act.channel_type,
            // Prioridade vem do PERÍODO da atividade (pedido do Bruno): manhã = alta,
            // tarde (>= 12:30) = média, "dia todo" (sem horário) = baixa. O horário
            // acima ainda agenda (dia todo cai no default 09:00), mas a prioridade é baixa.
            priority: (!act.scheduled_time ? "baixa" : act.scheduled_time >= "12:30" ? "media" : "alta") as PriorityLevel,
            scheduled_at: scheduled.toISOString(),
            status: "pendente" as TaskStatus,
            is_extra: false,
          };
        })
    );
    if (rows.length === 0) return [];

    const { data: created, error } = await supabase.from("qs_tasks").insert(rows).select();
    if (error) throw error;
    return (created ?? []) as Task[];
  } catch (err) {
    console.warn("[QS] createCadenceTasks failed:", err);
    notifyError("O lead foi salvo, mas as atividades da cadência não foram criadas — tente vincular a cadência de novo.");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CADENCES
// ═══════════════════════════════════════════════════════════════════════════════

export interface CadenceFilters {
  status?: CadenceStatus;
  acquisition_channel?: AcquisitionChannel;
}

export async function fetchQsCadences(filters?: CadenceFilters): Promise<Cadence[]> {
  try {
    let q = supabase
      .from("qs_cadences")
      .select(
        "*, days:qs_cadence_days(*, activities:qs_cadence_activities(*)), owners:qs_cadence_owners(*, user:qs_users(*))"
      )
      .order("created_at", { ascending: false });

    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.acquisition_channel) q = q.eq("acquisition_channel", filters.acquisition_channel);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as Cadence[];
  } catch (err) {
    console.warn("[QS] fetchQsCadences failed:", err);
    return [];
  }
}

export async function fetchQsCadence(id: string): Promise<Cadence | null> {
  try {
    const { data, error } = await supabase
      .from("qs_cadences")
      .select(
        "*, days:qs_cadence_days(*, activities:qs_cadence_activities(*)), owners:qs_cadence_owners(*, user:qs_users(*))"
      )
      .eq("id", id)
      .single();
    if (error) throw error;
    return data as Cadence;
  } catch (err) {
    console.warn("[QS] fetchQsCadence failed:", err);
    return null;
  }
}

export interface CreateCadencePayload {
  cadence: Omit<Cadence, "id" | "created_at" | "days" | "owners" | "_leads_count" | "_active_leads_count">;
  days: {
    day_number: number;
    activities: Omit<CadenceActivity, "id" | "cadence_day_id">[];
  }[];
  owner_ids: string[];
}

export async function createQsCadence(
  payload: CreateCadencePayload
): Promise<Cadence | null> {
  try {
    // 1. Create cadence
    const { data: cadence, error: cadenceError } = await supabase
      .from("qs_cadences")
      .insert(payload.cadence)
      .select()
      .single();
    if (cadenceError) throw cadenceError;

    const cadenceId = (cadence as Cadence).id;

    // 2. Create days
    if (payload.days.length > 0) {
      const daysToInsert = payload.days.map((d) => ({
        cadence_id: cadenceId,
        day_number: d.day_number,
      }));

      const { data: days, error: daysError } = await supabase
        .from("qs_cadence_days")
        .insert(daysToInsert)
        .select();
      if (daysError) throw daysError;

      // 3. Create activities for each day
      const activitiesToInsert: Omit<CadenceActivity, "id">[] = [];
      (days as CadenceDay[]).forEach((day, idx) => {
        const sourceDay = payload.days[idx];
        sourceDay.activities.forEach((act) => {
          activitiesToInsert.push({
            cadence_day_id: day.id,
            channel_type: act.channel_type,
            scheduled_time: act.scheduled_time,
            order_index: act.order_index,
          });
        });
      });

      if (activitiesToInsert.length > 0) {
        const { error: actError } = await supabase
          .from("qs_cadence_activities")
          .insert(activitiesToInsert);
        if (actError) throw actError;
      }
    }

    // 4. Create owners
    if (payload.owner_ids.length > 0) {
      const ownersToInsert = payload.owner_ids.map((userId) => ({
        cadence_id: cadenceId,
        user_id: userId,
        rr_pointer: false,
      }));

      const { error: ownersError } = await supabase
        .from("qs_cadence_owners")
        .insert(ownersToInsert);
      if (ownersError) throw ownersError;
    }

    // Return the full cadence
    return fetchQsCadence(cadenceId);
  } catch (err) {
    console.warn("[QS] createQsCadence failed:", err);
    notifyError("Não foi possível criar a cadência — tente novamente.");
    return null;
  }
}

export async function updateQsCadence(
  id: string,
  data: Partial<Omit<Cadence, "id" | "created_at" | "days" | "owners" | "_leads_count" | "_active_leads_count">>
): Promise<Cadence | null> {
  try {
    const { error } = await supabase
      .from("qs_cadences")
      .update(data)
      .eq("id", id);
    if (error) throw error;
    return fetchQsCadence(id);
  } catch (err) {
    console.warn("[QS] updateQsCadence failed:", err);
    notifyError("Não foi possível salvar a cadência.");
    return null;
  }
}

export async function deleteQsCadence(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("qs_cadences")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn("[QS] deleteQsCadence failed:", err);
    notifyError("Não foi possível excluir a cadência.");
    return false;
  }
}

export async function freezeCadence(id: string): Promise<Cadence | null> {
  return updateQsCadence(id, { status: "congelada" });
}

export async function unfreezeCadence(id: string): Promise<Cadence | null> {
  return updateQsCadence(id, { status: "disponivel" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEETINGS
// ═══════════════════════════════════════════════════════════════════════════════

export interface MeetingFilters {
  status?: MeetingStatus;
}

export async function fetchQsMeetings(filters?: MeetingFilters): Promise<Meeting[]> {
  try {
    let q = supabase
      .from("qs_meetings")
      .select("*, lead:qs_leads(*), owner:qs_users(*)")
      .order("scheduled_at", { ascending: true });

    if (filters?.status) q = q.eq("status", filters.status);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as Meeting[];
  } catch (err) {
    console.warn("[QS] fetchQsMeetings failed:", err);
    return [];
  }
}

export async function createQsMeeting(
  data: Omit<Meeting, "id" | "created_at" | "lead" | "owner">
): Promise<Meeting | null> {
  try {
    const { data: row, error } = await supabase
      .from("qs_meetings")
      .insert(data)
      .select("*, lead:qs_leads(*), owner:qs_users(*)")
      .single();
    if (error) throw error;
    return row as Meeting;
  } catch (err) {
    console.warn("[QS] createQsMeeting failed:", err);
    notifyError("Não foi possível agendar a reunião — tente novamente.");
    return null;
  }
}

export async function updateQsMeeting(
  id: string,
  data: Partial<Omit<Meeting, "id" | "created_at" | "lead" | "owner">>
): Promise<Meeting | null> {
  try {
    const { data: row, error } = await supabase
      .from("qs_meetings")
      .update(data)
      .eq("id", id)
      .select("*, lead:qs_leads(*), owner:qs_users(*)")
      .single();
    if (error) throw error;
    return row as Meeting;
  } catch (err) {
    console.warn("[QS] updateQsMeeting failed:", err);
    notifyError("Não foi possível salvar a reunião — a alteração NÃO foi gravada.");
    return null;
  }
}

export async function cancelMeeting(id: string): Promise<Meeting | null> {
  return updateQsMeeting(id, { status: "cancelada" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// GOALS
// ═══════════════════════════════════════════════════════════════════════════════

export async function fetchQsGoals(
  ownerId?: string,
  period?: GoalPeriod
): Promise<Goal[]> {
  try {
    let q = supabase
      .from("qs_goals")
      .select("*")
      .order("period_start", { ascending: false });

    if (ownerId) q = q.eq("owner_id", ownerId);
    if (period) q = q.eq("period", period);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as Goal[];
  } catch (err) {
    console.warn("[QS] fetchQsGoals failed:", err);
    return [];
  }
}

export async function createQsGoal(
  data: Omit<Goal, "id">
): Promise<Goal | null> {
  try {
    const { data: row, error } = await supabase
      .from("qs_goals")
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return row as Goal;
  } catch (err) {
    console.warn("[QS] createQsGoal failed:", err);
    notifyError("Não foi possível criar a meta.");
    return null;
  }
}

export async function updateQsGoal(
  id: string,
  data: Partial<Omit<Goal, "id">>
): Promise<Goal | null> {
  try {
    const { data: row, error } = await supabase
      .from("qs_goals")
      .update(data)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return row as Goal;
  } catch (err) {
    console.warn("[QS] updateQsGoal failed:", err);
    notifyError("Não foi possível salvar a meta.");
    return null;
  }
}

export async function deleteQsGoal(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("qs_goals")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn("[QS] deleteQsGoal failed:", err);
    notifyError("Não foi possível excluir a meta.");
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOTES
// ═══════════════════════════════════════════════════════════════════════════════

export async function fetchQsNotes(leadId: string): Promise<Note[]> {
  try {
    const { data, error } = await supabase
      .from("qs_notes")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as Note[];
  } catch (err) {
    console.warn("[QS] fetchQsNotes failed:", err);
    return [];
  }
}

export async function createQsNote(
  leadId: string,
  authorId: string,
  body: string,
  tags?: string[]
): Promise<Note | null> {
  try {
    const insertData: Record<string, unknown> = {
      lead_id: leadId,
      author_id: authorId,
      body,
    };
    if (tags !== undefined) insertData.tags = tags;

    const { data, error } = await supabase
      .from("qs_notes")
      .insert(insertData)
      .select()
      .single();
    if (error) throw error;
    return data as Note;
  } catch (err) {
    console.warn("[QS] createQsNote failed:", err);
    notifyError("Não foi possível salvar a observação — tente novamente.");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS — Loss Reasons
// ═══════════════════════════════════════════════════════════════════════════════

export async function fetchLossReasons(): Promise<LossReason[]> {
  try {
    const { data, error } = await supabase
      .from("qs_loss_reasons")
      .select("*")
      .eq("is_archived", false)
      .order("label");
    if (error) throw error;
    return (data ?? []) as LossReason[];
  } catch (err) {
    console.warn("[QS] fetchLossReasons failed:", err);
    return [];
  }
}

export async function createLossReason(label: string): Promise<LossReason | null> {
  try {
    const { data, error } = await supabase
      .from("qs_loss_reasons")
      .insert({ label, is_predefined: false, is_archived: false })
      .select()
      .single();
    if (error) throw error;
    return data as LossReason;
  } catch (err) {
    console.warn("[QS] createLossReason failed:", err);
    notifyError("Não foi possível criar o motivo de perda.");
    return null;
  }
}

export async function archiveLossReason(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("qs_loss_reasons")
      .update({ is_archived: true })
      .eq("id", id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn("[QS] archiveLossReason failed:", err);
    notifyError("Não foi possível arquivar o motivo de perda.");
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS — Channel Config
// ═══════════════════════════════════════════════════════════════════════════════

export async function fetchChannelConfig(): Promise<ChannelConfig[]> {
  try {
    const { data, error } = await supabase
      .from("qs_channel_config")
      .select("*")
      .order("type");
    if (error) throw error;
    return (data ?? []) as ChannelConfig[];
  } catch (err) {
    console.warn("[QS] fetchChannelConfig failed:", err);
    return [];
  }
}

export async function toggleChannel(
  channelType: ChannelType,
  enabled: boolean
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("qs_channel_config")
      .update({ enabled })
      .eq("type", channelType);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn("[QS] toggleChannel failed:", err);
    notifyError("Não foi possível alterar o canal.");
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS — Custom Fields
// ═══════════════════════════════════════════════════════════════════════════════

export async function fetchCustomFields(
  scope?: CustomFieldScope
): Promise<CustomField[]> {
  try {
    let q = supabase
      .from("qs_custom_fields")
      .select("*")
      .eq("is_archived", false)
      .order("label");

    if (scope) q = q.eq("scope", scope);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as CustomField[];
  } catch (err) {
    console.warn("[QS] fetchCustomFields failed:", err);
    return [];
  }
}

export async function createCustomField(
  data: Omit<CustomField, "id" | "is_system" | "is_archived">
): Promise<CustomField | null> {
  try {
    const { data: row, error } = await supabase
      .from("qs_custom_fields")
      .insert({ ...data, is_system: false, is_archived: false })
      .select()
      .single();
    if (error) throw error;
    return row as CustomField;
  } catch (err) {
    console.warn("[QS] createCustomField failed:", err);
    notifyError("Não foi possível criar o campo personalizado.");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD / STATS
// ═══════════════════════════════════════════════════════════════════════════════

// Coluna da DATA DE FECHAMENTO do lead. `closed_at` (migration 0012) só muda na
// transição pra ganho/perdido — updated_at muda em QUALQUER edição e fazia ganhos
// antigos "reaparecerem" no período atual. Fallback pra updated_at enquanto a
// migration não foi aplicada (sondagem 1x por sessão).
let closedAtCol: "closed_at" | "updated_at" | null = null;
export async function getClosedAtColumn(): Promise<"closed_at" | "updated_at"> {
  if (closedAtCol) return closedAtCol;
  const { error } = await supabase.from("qs_leads").select("closed_at").limit(1);
  closedAtCol = error ? "updated_at" : "closed_at";
  if (error) console.warn("[QS] qs_leads.closed_at não existe — aplique a migration 0012 (usando updated_at).");
  return closedAtCol;
}

export interface DashboardStats {
  ganhos: number;
  leadsFinalizados: number;
  atividadesRealizadas: number;
  taxaConversao: number;
}

export async function fetchDashboardStats(
  ownerId?: string,
  dateFrom?: string,
  dateTo?: string
): Promise<DashboardStats> {
  try {
    const closedCol = await getClosedAtColumn();

    // Leads ganhos
    let qGanhos = supabase
      .from("qs_leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "ganho");
    if (ownerId) qGanhos = qGanhos.eq("owner_id", ownerId);
    if (dateFrom) qGanhos = qGanhos.gte(closedCol, dateFrom);
    if (dateTo) qGanhos = qGanhos.lte(closedCol, dateTo);

    // Leads finalizados (ganho + perdido)
    let qFinalizados = supabase
      .from("qs_leads")
      .select("id", { count: "exact", head: true })
      .in("status", ["ganho", "perdido"]);
    if (ownerId) qFinalizados = qFinalizados.eq("owner_id", ownerId);
    if (dateFrom) qFinalizados = qFinalizados.gte(closedCol, dateFrom);
    if (dateTo) qFinalizados = qFinalizados.lte(closedCol, dateTo);

    // Atividades realizadas
    let qAtividades = supabase
      .from("qs_tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "concluida");
    if (ownerId) qAtividades = qAtividades.eq("owner_id", ownerId);
    if (dateFrom) qAtividades = qAtividades.gte("completed_at", dateFrom);
    if (dateTo) qAtividades = qAtividades.lte("completed_at", dateTo);

    const [ganhosRes, finalizadosRes, atividadesRes] = await Promise.all([
      qGanhos,
      qFinalizados,
      qAtividades,
    ]);

    if (ganhosRes.error) throw ganhosRes.error;
    if (finalizadosRes.error) throw finalizadosRes.error;
    if (atividadesRes.error) throw atividadesRes.error;

    const ganhos = ganhosRes.count ?? 0;
    const leadsFinalizados = finalizadosRes.count ?? 0;
    const atividadesRealizadas = atividadesRes.count ?? 0;
    const taxaConversao = leadsFinalizados > 0 ? (ganhos / leadsFinalizados) * 100 : 0;

    return {
      ganhos,
      leadsFinalizados,
      atividadesRealizadas,
      taxaConversao: Math.round(taxaConversao * 100) / 100,
    };
  } catch (err) {
    console.warn("[QS] fetchDashboardStats failed:", err);
    return { ganhos: 0, leadsFinalizados: 0, atividadesRealizadas: 0, taxaConversao: 0 };
  }
}

export interface LossReasonStat {
  reason: string;
  count: number;
}

export async function fetchLossReasonsStats(): Promise<LossReasonStat[]> {
  try {
    const { data, error } = await supabase
      .from("qs_leads")
      .select("loss_reason:qs_loss_reasons(label)")
      .eq("status", "perdido")
      .not("loss_reason_id", "is", null);
    if (error) throw error;

    // Aggregate counts by reason label.
    // O embed do Supabase pode vir como objeto (FK to-one) ou array — normalizamos.
    const counts = new Map<string, number>();
    const rows = (data ?? []) as unknown as {
      loss_reason: { label: string } | { label: string }[] | null;
    }[];
    rows.forEach((row) => {
      const lr = Array.isArray(row.loss_reason) ? row.loss_reason[0] : row.loss_reason;
      const label = lr?.label ?? "Sem motivo";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  } catch (err) {
    console.warn("[QS] fetchLossReasonsStats failed:", err);
    return [];
  }
}

export interface LeadsCoverage {
  leadsWithoutContact: number;
  totalLeads: number;
  coveragePercent: number;
}

export async function fetchLeadsCoverage(): Promise<LeadsCoverage> {
  try {
    // Total active leads (not ganho/perdido)
    const { count: totalLeads, error: totalError } = await supabase
      .from("qs_leads")
      .select("id", { count: "exact", head: true })
      .in("status", ["nao_iniciado", "em_prospeccao"]);
    if (totalError) throw totalError;

    // Leads without any completed task (no contact)
    const { data: leadsWithTasks, error: tasksError } = await supabase
      .from("qs_tasks")
      .select("lead_id")
      .eq("status", "concluida");
    if (tasksError) throw tasksError;

    const contactedLeadIds = new Set(
      (leadsWithTasks ?? []).map((t: { lead_id: string }) => t.lead_id)
    );

    const { data: activeLeads, error: activeError } = await supabase
      .from("qs_leads")
      .select("id")
      .in("status", ["nao_iniciado", "em_prospeccao"]);
    if (activeError) throw activeError;

    const leadsWithoutContact = (activeLeads ?? []).filter(
      (l: { id: string }) => !contactedLeadIds.has(l.id)
    ).length;

    const total = totalLeads ?? 0;
    const coveragePercent = total > 0
      ? Math.round(((total - leadsWithoutContact) / total) * 100 * 100) / 100
      : 0;

    return {
      leadsWithoutContact,
      totalLeads: total,
      coveragePercent,
    };
  } catch (err) {
    console.warn("[QS] fetchLeadsCoverage failed:", err);
    return { leadsWithoutContact: 0, totalLeads: 0, coveragePercent: 0 };
  }
}
