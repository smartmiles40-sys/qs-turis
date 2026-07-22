// src/lib/qs/queries.ts — Data access layer for the QS (Qualificacao SDR) system
import { supabase } from "@/lib/supabase";
import { notifyError } from "@/lib/qs/notify";
import { planCadenceDates, loadWorkHours, scheduleWeekdays, nextWorkMoment, clampToWorkWindow } from "@/lib/workHours";
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
  Contact,
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
    // MEDE o que o banco aceitou: o `.select('id')` devolve as linhas realmente
    // apagadas. Sem isso, a RLS (leads_delete = só gestor/admin) recusa em
    // SILÊNCIO (0 linhas, sem erro) e a função dizia "excluído" sem excluir.
    const { data, error } = await supabase
      .from("qs_leads")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      console.warn("[QS] deleteQsLead: banco recusou (RLS/0 linhas) o lead", id);
      notifyError("Exclusão recusada pelo banco — apenas gestor/admin podem excluir leads.");
      return false;
    }
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
  note?: string,
  // `notify: false` = uso em LOTE (LeadsPage): quem chama agrega o resultado
  // num toast só, em vez de N toasts individuais. Padrão true (fluxo individual).
  opts?: { notify?: boolean }
): Promise<boolean> {
  const notify = opts?.notify !== false;
  try {
    // 1. Troca o dono e MEDE o efeito: o `.select('id')` devolve as linhas que
    //    o banco realmente alterou. Sem isso, a RLS recusa em SILÊNCIO (sem
    //    erro, 0 linhas) e a função dizia "transferido" mesmo sem transferir.
    const { data: updated, error: leadError } = await supabase
      .from("qs_leads")
      .update({ owner_id: toUserId, updated_at: new Date().toISOString() })
      .eq("id", leadId)
      .select("id");
    if (leadError) throw leadError;
    if (!updated || updated.length === 0) {
      console.warn("[QS] transferLead: banco recusou (RLS/0 linhas) o lead", leadId);
      if (notify) notifyError("Transferência recusada pelo banco — você não tem permissão sobre este lead.");
      return false;
    }

    // 2. Histórico DEPOIS que a troca aconteceu de verdade — antes o handover
    //    era gravado primeiro e ficava registrado mesmo quando a RLS recusava
    //    a transferência (auditoria mentirosa). Falha aqui não desfaz a troca:
    //    avisa em vez de fingir que nada aconteceu.
    const { error: hoError } = await supabase.from("qs_handovers").insert({
      lead_id: leadId,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      briefing: note?.trim() || "Lead transferido",
    });
    if (hoError) {
      console.warn("[QS] transferLead: handover não registrado:", hoError);
      if (notify) notifyError("Lead transferido, mas o HISTÓRICO do handover não foi registrado — avise o gestor.");
    }

    // 3. Reatribui as tarefas pendentes/atrasadas do lead ao novo dono. Se ISTO
    //    falhar, o lead é do novo dono mas as tarefas ficam com o antigo (zumbi
    //    pro novo SDR) — então avisamos em vez de fingir sucesso.
    const { error: taskError } = await supabase
      .from("qs_tasks")
      .update({ owner_id: toUserId })
      .eq("lead_id", leadId)
      .in("status", ["pendente", "atrasada"]);
    if (taskError) {
      console.warn("[QS] transferLead: tarefas não reatribuídas:", taskError);
      if (notify) notifyError("Lead transferido, mas as ATIVIDADES não foram — transfira de novo ou avise o gestor.");
    }

    return true;
  } catch (err) {
    const msg = (err as { message?: string })?.message || "erro desconhecido";
    console.warn("[QS] transferLead failed:", err);
    if (notify) notifyError(`Não foi possível transferir o lead: ${msg}`);
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
      // Visão do admin SEM unidade selecionada: usa a meta GLOBAL (sem dono).
      // NUNCA soma as metas individuais do time — a meta exibida é sempre a da
      // unidade (pedido do Bruno: "selecionada na unidade, não no time todo").
      const global = list.find((g) => !g.owner_id);
      return global ? global.target_value : null;
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

// ── Fila do Painel (pendente + atrasada) — SEM o teto de 1000 ────────────────
// O Painel derivava "N em FUP", "N atrasadas" e a própria lista de um único
// SELECT sem paginação: o PostgREST corta em 1000 linhas e a contagem TRAVAVA em
// 1000 assim que o time cruzava esse volume (bug relatado). Aqui varremos TODAS
// as páginas (fetchAllRows) com ordem estável (scheduled_at + id) e escopo por
// dono: o SDR recebe só a fila DELE (bounded); admin/gestor recebe a de todos
// (número real do time). Erro nunca vira lista vazia — fetchAllRows relança.
export async function fetchQueueTasks(ownerId?: string | null): Promise<Task[]> {
  return fetchAllRows<Task>((from, to) => {
    let q = supabase
      .from("qs_tasks")
      .select("*")
      .in("status", ["pendente", "atrasada"])
      .order("scheduled_at", { ascending: true })
      .order("id", { ascending: true });
    if (ownerId) q = q.eq("owner_id", ownerId);
    return q.range(from, to);
  });
}

// Leads do Painel (para o mapa lead↔tarefa). Também paginado: com >1000 leads o
// leadsMap ficava incompleto e as tarefas dos leads "extras" renderizavam sem
// nome/telefone. RLS já restringe o SDR aos leads dele; o admin recebe todos.
export async function fetchQueueLeads(ownerId?: string | null): Promise<Lead[]> {
  return fetchAllRows<Lead>((from, to) => {
    let q = supabase.from("qs_leads").select("*").order("id", { ascending: true });
    if (ownerId) q = q.eq("owner_id", ownerId);
    return q.range(from, to);
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

/**
 * DESFAZ a conclusão de uma atividade (botão "Desfazer" do toast): volta pra
 * 'pendente' e limpa completed_at/contact_result. Só age se a tarefa estiver
 * 'concluida' AGORA (idempotente) e MEDE o que o banco aceitou (.select) — em
 * update sob RLS a recusa é silenciosa (0 linhas, sem erro).
 */
export async function undoCompleteTask(id: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("qs_tasks")
      .update({
        status: "pendente" as TaskStatus,
        completed_at: null,
        contact_result: null,
      })
      .eq("id", id)
      .eq("status", "concluida")
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      notifyError("Não deu pra desfazer — a atividade não está mais concluída ou o banco recusou.");
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[QS] undoCompleteTask failed:", err);
    notifyError("Não foi possível desfazer a conclusão — tente novamente.");
    return false;
  }
}

/**
 * Edita uma tarefa AINDA ABERTA (adiar/reagendar data, trocar canal, notas).
 * Guarda de idempotência igual ao completeTask (.in status) + gravação MEDIDA:
 * 0 linhas = tarefa já encerrada ou RLS recusou — avisa em vez de fingir.
 */
export async function updateOpenTask(
  id: string,
  patch: Partial<Pick<Task, "scheduled_at" | "channel_type" | "notes" | "priority">>
): Promise<Task | null> {
  try {
    const { data, error } = await supabase
      .from("qs_tasks")
      .update(patch)
      .eq("id", id)
      .in("status", ["pendente", "atrasada"])
      .select("*");
    if (error) throw error;
    if (!data || data.length === 0) {
      notifyError("A atividade não foi alterada — ela já foi concluída/encerrada ou o banco recusou.");
      return null;
    }
    return data[0] as Task;
  } catch (err) {
    console.warn("[QS] updateOpenTask failed:", err);
    notifyError("Não foi possível salvar a alteração da atividade — nada mudou.");
    return null;
  }
}

/**
 * Exclui uma atividade EXTRA criada por engano. Só extras (is_extra=true) podem
 * sumir do histórico — tarefa de cadência se conclui/pula, nunca é apagada.
 * O delete é MEDIDO (.select): 0 linhas = não era extra ou o banco recusou.
 */
export async function deleteExtraTask(id: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("qs_tasks")
      .delete()
      .eq("id", id)
      .eq("is_extra", true)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      notifyError("A atividade não foi excluída — só atividades EXTRAS podem ser apagadas.");
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[QS] deleteExtraTask failed:", err);
    notifyError("Não foi possível excluir a atividade extra.");
    return false;
  }
}

/**
 * Roteiros (script_text) escritos pelo gestor nas atividades da cadência —
 * antes eram gravados e NUNCA lidos (auditoria 2026-07-14). O Painel usa pra
 * mostrar o roteiro no card e pré-preencher o WhatsApp. A tabela é pequena;
 * buscamos todos os que têm texto (best-effort: erro = sem roteiros, sem travar).
 */
export interface CadenceScriptRow {
  cadence_id: string;
  day_number: number;
  channel_type: ChannelType;
  scheduled_time: string | null;
  script_text: string;
}

export async function fetchCadenceScripts(): Promise<CadenceScriptRow[]> {
  try {
    const { data, error } = await supabase
      .from("qs_cadence_activities")
      .select("channel_type, scheduled_time, script_text, day:qs_cadence_days!inner(cadence_id, day_number)")
      .not("script_text", "is", null);
    if (error) throw error;
    const rows = (data ?? []) as unknown as {
      channel_type: ChannelType;
      scheduled_time: string | null;
      script_text: string | null;
      day: { cadence_id: string; day_number: number } | { cadence_id: string; day_number: number }[] | null;
    }[];
    return rows.flatMap((r) => {
      const d = Array.isArray(r.day) ? r.day[0] : r.day;
      const script = (r.script_text ?? "").trim();
      if (!d || !script) return [];
      return [{
        cadence_id: d.cadence_id,
        day_number: d.day_number,
        channel_type: r.channel_type,
        scheduled_time: r.scheduled_time,
        script_text: script,
      }];
    });
  } catch (err) {
    console.warn("[QS] fetchCadenceScripts failed:", err);
    return [];
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

    // Dias de execução da cadência: a data inicial de cada "Dia N" não pode cair
    // em dia sem execução (antes, lead de sexta ganhava o "Dia 2" no sábado — o
    // follow-up já respeitava dia útil, a geração inicial não). Mesmo helper de
    // calendário do plano (planCadenceDates / nextExecutionDay em workHours.ts).
    const { data: cadRow } = await supabase
      .from("qs_cadences")
      .select("execution_weekdays, offday_policy")
      .eq("id", cadenceId)
      .maybeSingle();
    const cadPlan = cadRow as { execution_weekdays: number[] | null; offday_policy: string | null } | null;

    // HORÁRIO DE TRABALHO = verdade absoluta. Os dias em que a cadência pode
    // agendar são o expediente (work_hours.enabled) ∩ execution_weekdays — assim
    // uma cadência que inclua sábado NÃO agenda no sábado se a empresa não abre,
    // e um dia desabilitado nas Configurações nunca recebe atividade.
    const wh = await loadWorkHours();
    const allowedWeekdays = scheduleWeekdays(wh, cadPlan?.execution_weekdays ?? null);

    const dayList = days as (CadenceDay & { activities: CadenceActivity[] })[];
    const dateByDay = planCadenceDates(
      dayList.map((d) => d.day_number ?? 1),
      allowedWeekdays,
      cadPlan?.offday_policy ?? null
    );

    // 1º dia da cadência (menor day_number, que cairia HOJE na chegada do lead).
    const firstDayNumber = Math.min(...dayList.map((d) => d.day_number ?? 1));
    const nowMs = Date.now();

    const rows = dayList.flatMap((day) =>
      [...(day.activities ?? [])]
        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        .map((act) => {
          const scheduled = new Date(dateByDay.get(day.day_number ?? 1) ?? new Date());
          const [h, m] = (act.scheduled_time || "09:00").split(":").map(Number);
          scheduled.setHours(h || 9, m || 0, 0, 0);
          // NADA nasce fora do expediente. 1º dia: parte do horário planejado ou
          // de AGORA (o que for maior — lead da tarde não ganha atividade no
          // passado) e cai no próximo MOMENTO de trabalho — lead das 19:31 ou de
          // sábado só aparece no próximo dia útil, no início, nunca "atrasado".
          // Dias futuros: mantém o dia (já é útil) e encaixa a hora na janela.
          const isFirst = (day.day_number ?? 1) === firstDayNumber;
          const when = isFirst
            ? nextWorkMoment(wh, new Date(Math.max(scheduled.getTime(), nowMs)))
            : clampToWorkWindow(wh, scheduled);
          const scheduledMs = when.getTime();
          return {
            lead_id: leadId,
            cadence_id: cadenceId,
            owner_id: ownerId,
            channel_type: act.channel_type,
            // Prioridade vem do PERÍODO da atividade (pedido do Bruno): manhã = alta,
            // tarde (>= 12:30) = média, "dia todo" (sem horário) = baixa. O horário
            // acima ainda agenda (dia todo cai no default 09:00), mas a prioridade é baixa.
            priority: (!act.scheduled_time ? "baixa" : act.scheduled_time >= "12:30" ? "media" : "alta") as PriorityLevel,
            scheduled_at: new Date(scheduledMs).toISOString(),
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

// Encerra as tarefas de cadência ainda ABERTAS de um lead (pendente/atrasada,
// não-extra) antes de vincular um plano novo. Sem isso, trocar o lead de
// cadência DUPLICA a carga: as sequências antiga e nova convivem na fila e o
// SDR contata o mesmo lead em dobro. Mesmo padrão de encerramento do restante
// do app (skipTask / "Lead perdido" / "Handover para closer"): status
// "ignorada" + skip_reason. As atividades EXTRAS (manuais) são preservadas.
// Retorna false se o encerramento falhar — o chamador decide se prossegue.
export async function closeOpenCadenceTasks(
  leadId: string,
  reason = "Lead movido de cadência — plano anterior encerrado"
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("qs_tasks")
      .update({ status: "ignorada" as TaskStatus, skip_reason: reason })
      .eq("lead_id", leadId)
      .eq("is_extra", false)
      .in("status", ["pendente", "atrasada"]);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn("[QS] closeOpenCadenceTasks failed:", err);
    return false;
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

// Cadências que podem receber NOVOS vínculos de leads: apenas as "disponíveis".
// Congelada NÃO aparece aqui — congelar bloqueia vínculos novos e pausa o fim
// automático (redirecionamento/perda do cadenceSweep), mas as tarefas já
// criadas CONTINUAM na fila dos SDRs (semântica documentada no botão Congelar
// do card). Rascunho também fica de fora (ainda não publicada).
// USAR ESTA FUNÇÃO em TODO dropdown/fluxo que vincula lead a cadência
// (cadastro de lead, importação de CSV, vínculo em massa, reativação).
export async function fetchAvailableCadences(): Promise<Cadence[]> {
  return fetchQsCadences({ status: "disponivel" });
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

export interface DeleteCadenceResult {
  ok: boolean;
  /** true = cadência excluída, mas alguma tarefa aberta pode NÃO ter sido encerrada. */
  tasksWarning: boolean;
}

// Exclui a cadência COM o efeito colateral coerente (decisão Sprint 4):
//   • Leads vinculados ficam com cadence_id NULL (ON DELETE SET NULL do schema
//     0001) — continuam vivos e prontos pra receber outra cadência.
//   • As tarefas ABERTAS da cadência (pendente/atrasada, não-extra) são
//     encerradas como "ignorada" + skip_reason — mesmo padrão do
//     closeOpenCadenceTasks. Sem isso, o ON DELETE SET NULL de qs_tasks
//     deixaria tarefas órfãs (sem cadência) vivas na fila dos SDRs.
// ORDEM importa: captura os ids das tarefas ANTES do delete (depois dele o
// cadence_id delas vira NULL e não dá mais pra achá-las), exclui a cadência
// MEDIDO (.select — RLS que recusa em silêncio devolve 0 linhas → falha) e só
// então encerra as tarefas. Se o encerramento falhar/for parcial, a exclusão
// já valeu — devolvemos o aviso pro chamador mostrar.
export async function deleteQsCadence(
  id: string,
  cadenceName?: string
): Promise<DeleteCadenceResult> {
  try {
    const { data: openTasks, error: fetchErr } = await supabase
      .from("qs_tasks")
      .select("id")
      .eq("cadence_id", id)
      .eq("is_extra", false)
      .in("status", ["pendente", "atrasada"]);
    if (fetchErr) throw fetchErr;
    const taskIds = ((openTasks ?? []) as { id: string }[]).map((t) => t.id);

    const { data: deleted, error } = await supabase
      .from("qs_cadences")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!deleted || deleted.length === 0) {
      notifyError("O banco recusou a exclusão da cadência — você não tem permissão sobre ela.");
      return { ok: false, tasksWarning: false };
    }

    let tasksWarning = false;
    if (taskIds.length > 0) {
      const reason = cadenceName
        ? `Cadência "${cadenceName}" excluída — plano encerrado`
        : "Cadência excluída — plano encerrado";
      const { data: closed, error: closeErr } = await supabase
        .from("qs_tasks")
        .update({ status: "ignorada" as TaskStatus, skip_reason: reason })
        .in("id", taskIds)
        .in("status", ["pendente", "atrasada"]) // idempotência: outra sessão pode ter encerrado antes
        .select("id");
      // RLS: um SDR só encerra as PRÓPRIAS tarefas — as dos colegas ficariam
      // órfãs na fila deles. Medimos e avisamos em vez de fingir sucesso.
      if (closeErr || (closed ?? []).length < taskIds.length) {
        console.warn("[QS] deleteQsCadence: tarefas abertas não encerradas por completo:", closeErr);
        tasksWarning = true;
      }
    }
    return { ok: true, tasksWarning };
  } catch (err) {
    console.warn("[QS] deleteQsCadence failed:", err);
    notifyError("Não foi possível excluir a cadência.");
    return { ok: false, tasksWarning: false };
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

// Edita o TEXTO de uma anotação. RLS (0007: notes_update) permite autor ou
// gestor — pra qualquer outro usuário o banco recusa em SILÊNCIO (0 linhas),
// então MEDIMOS o efeito com `.select()` em vez de assumir sucesso.
export async function updateQsNote(id: string, body: string): Promise<Note | null> {
  try {
    const { data, error } = await supabase
      .from("qs_notes")
      .update({ body })
      .eq("id", id)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      console.warn("[QS] updateQsNote: banco recusou (RLS/0 linhas) a nota", id);
      notifyError("Edição recusada pelo banco — só o autor da anotação (ou um gestor) pode editá-la.");
      return null;
    }
    return data[0] as Note;
  } catch (err) {
    console.warn("[QS] updateQsNote failed:", err);
    notifyError("Não foi possível salvar a anotação — a alteração NÃO foi gravada.");
    return null;
  }
}

// Exclui uma anotação (RLS: autor ou gestor). Mesma medição do update.
export async function deleteQsNote(id: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("qs_notes")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      console.warn("[QS] deleteQsNote: banco recusou (RLS/0 linhas) a nota", id);
      notifyError("Exclusão recusada pelo banco — só o autor da anotação (ou um gestor) pode excluí-la.");
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[QS] deleteQsNote failed:", err);
    notifyError("Não foi possível excluir a anotação.");
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTACTS (qs_contacts — multi telefone/e-mail/WhatsApp/LinkedIn do lead)
// Primeiro caminho de ESCRITA da tabela no app (antes a aba Contatos era
// somente-leitura de uma tabela que nada preenchia). Schema real (0001):
// type + value + is_primary — não há colunas de nome/cargo.
// ═══════════════════════════════════════════════════════════════════════════════

export async function fetchQsContacts(leadId: string): Promise<Contact[]> {
  try {
    const { data, error } = await supabase
      .from("qs_contacts")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Contact[];
  } catch (err) {
    console.warn("[QS] fetchQsContacts failed:", err);
    return [];
  }
}

export async function createQsContact(
  data: Omit<Contact, "id" | "created_at">
): Promise<Contact | null> {
  try {
    const { data: row, error } = await supabase
      .from("qs_contacts")
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return row as Contact;
  } catch (err) {
    console.warn("[QS] createQsContact failed:", err);
    notifyError("Não foi possível adicionar o contato — tente novamente.");
    return null;
  }
}

export async function updateQsContact(
  id: string,
  data: Partial<Omit<Contact, "id" | "lead_id" | "created_at">>
): Promise<Contact | null> {
  try {
    const { data: rows, error } = await supabase
      .from("qs_contacts")
      .update(data)
      .eq("id", id)
      .select();
    if (error) throw error;
    if (!rows || rows.length === 0) {
      console.warn("[QS] updateQsContact: banco recusou (RLS/0 linhas) o contato", id);
      notifyError("Edição recusada pelo banco — a alteração NÃO foi gravada.");
      return null;
    }
    return rows[0] as Contact;
  } catch (err) {
    console.warn("[QS] updateQsContact failed:", err);
    notifyError("Não foi possível salvar o contato — a alteração NÃO foi gravada.");
    return null;
  }
}

export async function deleteQsContact(id: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("qs_contacts")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      console.warn("[QS] deleteQsContact: banco recusou (RLS/0 linhas) o contato", id);
      notifyError("Exclusão recusada pelo banco — o contato NÃO foi excluído.");
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[QS] deleteQsContact failed:", err);
    notifyError("Não foi possível excluir o contato.");
    return false;
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

// ── Cap de 1000 linhas do PostgREST ──────────────────────────────────────────
// O Supabase devolve NO MÁXIMO 1000 linhas por request (max-rows do PostgREST).
// Qualquer agregação client-side sem paginação passa a MENTIR em silêncio assim
// que a tabela cruza esse teto (funil, heatmap, motivos de perda etc. paravam
// de contar no lead nº 1001). Este helper varre TODAS as páginas e devolve o
// total — e LANÇA se qualquer página falhar (erro nunca vira lista vazia).
// A query construída pela factory DEVE ter um .order() estável (ex.: "id"),
// senão o banco pode repetir/pular linhas entre páginas.
export const POSTGREST_PAGE_SIZE = 1000;
export async function fetchAllRows<T>(
  buildQuery: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; ; page++) {
    const from = page * POSTGREST_PAGE_SIZE;
    const { data, error } = await buildQuery(from, from + POSTGREST_PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < POSTGREST_PAGE_SIZE) break;
  }
  return all;
}

// ── Vigência de metas (decisão de produto, Sprint 4) ─────────────────────────
// Meta mensal é RECORRENTE: `period_start` marca o mês em que ela PASSOU a
// valer — sem uma meta mais nova, ela continua valendo nos meses seguintes
// (meta de maio sem substituta ainda é a meta de julho). Meta ancorada num mês
// FUTURO ainda não vigora. "Vigente" = a meta mais recente por (owner, tipo)
// cujo mês do period_start já começou. O dashboard (SdrDashboard) e a página
// Metas (GoalsPage) usam esta MESMA regra — se mudar aqui, mude lá o texto.
export function isGoalEffective(periodStart: string | null | undefined): boolean {
  if (!periodStart) return true;
  const anchor = new Date(`${periodStart}T00:00:00`);
  if (isNaN(anchor.getTime())) return true;
  const now = new Date();
  return (
    anchor.getFullYear() < now.getFullYear() ||
    (anchor.getFullYear() === now.getFullYear() && anchor.getMonth() <= now.getMonth())
  );
}

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
    // PADRÃO DA CASA: erro NUNCA vira zero silencioso. Este catch devolvia tudo
    // zerado e o dashboard exibia "0 ganhos" como se fosse dado real. Agora
    // propaga — o chamador (SdrDashboard) mostra banner com "Tentar de novo".
    console.warn("[QS] fetchDashboardStats failed:", err);
    throw err;
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
