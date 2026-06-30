import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type {
  Lead,
  LeadStatus,
  SdrUser,
  Cadence,
  CadenceDay,
  CadenceActivity,
  Note,
  Contact,
  Meeting,
  Task,
} from "../types";
import {
  STATUS_LABELS,
  SOURCE_LABELS,
  CHANNEL_LABELS,
  MEETING_STATUS_LABELS,
} from "../types";

// ── Props ────────────────────────────────────────────────────────────────────

interface LeadDetailPageProps {
  leadId: string;
  onBack: () => void;
}

// ── Types ────────────────────────────────────────────────────────────────────

type TabKey =
  | "visao_geral"
  | "informacoes_pessoais"
  | "empresa"
  | "anotacoes"
  | "contatos"
  | "reunioes"
  | "prospeccao"
  | "campos_personalizados";

interface TabItem {
  key: TabKey;
  label: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<LeadStatus, { bg: string; text: string; dot: string }> = {
  nao_iniciado: { bg: "bg-gray-100", text: "text-gray-700", dot: "bg-gray-400" },
  em_prospeccao: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  ganho: { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500" },
  perdido: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
};

const MEETING_COLORS: Record<string, { bg: string; text: string }> = {
  agendada: { bg: "bg-blue-50", text: "text-blue-700" },
  realizada: { bg: "bg-green-50", text: "text-green-700" },
  no_show: { bg: "bg-orange-50", text: "text-orange-700" },
  cancelada: { bg: "bg-red-50", text: "text-red-700" },
};

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  pesquisa: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  email: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  ligacao: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  ),
  whatsapp: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  linkedin: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2zM4 6a2 2 0 100-4 2 2 0 000 4z" />
    </svg>
  ),
};

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ── Tabs Definition ──────────────────────────────────────────────────────────

const TABS: TabItem[] = [
  { key: "visao_geral", label: "Visão Geral" },
  { key: "informacoes_pessoais", label: "Informações Pessoais" },
  { key: "empresa", label: "Empresa" },
  { key: "anotacoes", label: "Anotações" },
  { key: "contatos", label: "Contatos" },
  { key: "reunioes", label: "Reuniões" },
  { key: "prospeccao", label: "Prospecção" },
  { key: "campos_personalizados", label: "Campos Personalizados" },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function LeadDetailPage({ leadId, onBack }: LeadDetailPageProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("visao_geral");
  const [newNote, setNewNote] = useState("");
  const [showHandoverModal, setShowHandoverModal] = useState(false);
  const [selectedCloser, setSelectedCloser] = useState("");
  const [handoverSuccess, setHandoverSuccess] = useState(false);
  const [showReEngagement, setShowReEngagement] = useState(false);
  const [reEngagementScheduled, setReEngagementScheduled] = useState(false);
  const [lossReasons, setLossReasons] = useState<{ id: string; label: string }[]>([]);
  const [selectedLossReason, setSelectedLossReason] = useState("");

  // ── Data state ──
  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cadence, setCadence] = useState<Cadence | null>(null);
  const [cadenceDays, setCadenceDays] = useState<CadenceDay[]>([]);
  const [closers, setClosers] = useState<SdrUser[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Fetch lead and related data ──
  const fetchLead = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_leads")
      .select("*, owner:qs_users(*), loss_reason:qs_loss_reasons(*)")
      .eq("id", leadId)
      .single();
    if (error) {
      console.warn("Erro ao buscar lead:", error);
      return null;
    }
    setLead(data as Lead);
    return data as Lead;
  }, [leadId]);

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      const leadData = await fetchLead();

      const [notesRes, contactsRes, meetingsRes, tasksRes, closersRes] = await Promise.all([
        supabase.from("qs_notes").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
        supabase.from("qs_contacts").select("*").eq("lead_id", leadId),
        supabase.from("qs_meetings").select("*, lead:qs_leads(*)").eq("lead_id", leadId).order("scheduled_at", { ascending: false }),
        supabase.from("qs_tasks").select("*").eq("lead_id", leadId).order("scheduled_at", { ascending: true }),
        supabase.from("qs_users").select("*").eq("role", "closer"),
      ]);

      if (notesRes.error) console.warn("Erro ao buscar notes:", notesRes.error);
      else setNotes((notesRes.data as Note[]) ?? []);

      if (contactsRes.error) console.warn("Erro ao buscar contacts:", contactsRes.error);
      else setContacts((contactsRes.data as Contact[]) ?? []);

      if (meetingsRes.error) console.warn("Erro ao buscar meetings:", meetingsRes.error);
      else setMeetings((meetingsRes.data as Meeting[]) ?? []);

      if (tasksRes.error) console.warn("Erro ao buscar tasks:", tasksRes.error);
      else setTasks((tasksRes.data as Task[]) ?? []);

      if (closersRes.error) console.warn("Erro ao buscar closers:", closersRes.error);
      else {
        const closersList = (closersRes.data as SdrUser[]) ?? [];
        setClosers(closersList);
        if (closersList.length > 0) setSelectedCloser(closersList[0].id);
      }

      // Fetch loss reasons for re-engagement (Change 16)
      const { data: lrData } = await supabase
        .from("qs_loss_reasons")
        .select("id, label")
        .eq("is_archived", false);
      if (lrData) setLossReasons(lrData as any[]);

      // Fetch cadence if lead has one
      if (leadData?.cadence_id) {
        const { data: cadData, error: cadErr } = await supabase
          .from("qs_cadences")
          .select("*")
          .eq("id", leadData.cadence_id)
          .single();
        if (cadErr) console.warn("Erro ao buscar cadence:", cadErr);
        else setCadence(cadData as Cadence);

        const { data: daysData, error: daysErr } = await supabase
          .from("qs_cadence_days")
          .select("*, activities:qs_cadence_activities(*)")
          .eq("cadence_id", leadData.cadence_id)
          .order("day_number", { ascending: true });
        if (daysErr) console.warn("Erro ao buscar cadence days:", daysErr);
        else setCadenceDays((daysData as CadenceDay[]) ?? []);
      }

      setLoading(false);
    }
    loadAll();
  }, [leadId, fetchLead]);

  // ── Add note ──
  async function addNote() {
    if (!newNote.trim() || !lead) return;
    const { data, error } = await supabase
      .from("qs_notes")
      .insert({ lead_id: lead.id, author_id: lead.owner_id, body: newNote.trim() })
      .select()
      .single();
    if (error) {
      console.warn("Erro ao adicionar nota:", error);
      return;
    }
    setNotes([data as Note, ...notes]);
    setNewNote("");
  }

  // ── Mark as won ──
  async function markAsWon() {
    if (!lead) return;
    const { error } = await supabase
      .from("qs_leads")
      .update({ status: "ganho" as LeadStatus })
      .eq("id", lead.id);
    if (error) console.warn("Erro ao marcar como ganho:", error);
    else await fetchLead();
  }

  // ── Mark as lost (with re-engagement check — Change 16) ──
  async function markAsLost(lossReasonId?: string) {
    if (!lead) return;
    const updateData: Record<string, unknown> = { status: "perdido" as LeadStatus };
    if (lossReasonId) updateData.loss_reason_id = lossReasonId;

    const { error } = await supabase
      .from("qs_leads")
      .update(updateData)
      .eq("id", lead.id);
    if (error) {
      console.warn("Erro ao marcar como perdido:", error);
      return;
    }

    // Check if loss reason suggests re-engagement
    if (lossReasonId) {
      const reason = lossReasons.find((r) => r.id === lossReasonId);
      const label = reason?.label?.toLowerCase() || "";
      if (label.includes("retorno") || label.includes("budget") || label.includes("timing") || label.includes("momento") || label.includes("orçamento")) {
        setShowReEngagement(true);
        await fetchLead();
        return;
      }
    }

    await fetchLead();
  }

  // ── Schedule re-engagement (Change 16) ──
  async function scheduleReEngagement(days: number) {
    if (!lead) return;
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + days);

    const { error } = await supabase.from("qs_tasks").insert({
      lead_id: lead.id,
      owner_id: lead.owner_id,
      channel_type: "ligacao",
      status: "pendente",
      priority: "media",
      scheduled_at: scheduledAt.toISOString(),
      is_extra: true,
      notes: `Re-contato agendado (${days} dias) - Lead marcado como perdido`,
    });

    if (error) {
      console.warn("Erro ao agendar re-contato:", error);
    } else {
      setReEngagementScheduled(true);
      setTimeout(() => {
        setReEngagementScheduled(false);
        setShowReEngagement(false);
      }, 2000);
    }
  }

  // ── Handover to closer ──
  async function handleHandover() {
    if (!lead || !selectedCloser) return;
    const { error: hoError } = await supabase
      .from("qs_handovers")
      .insert({ lead_id: lead.id, from_user_id: lead.owner_id, to_user_id: selectedCloser });
    if (hoError) {
      console.warn("Erro ao criar handover:", hoError);
      return;
    }
    const { error: upError } = await supabase
      .from("qs_leads")
      .update({ status: "ganho" as LeadStatus, owner_id: selectedCloser })
      .eq("id", lead.id);
    if (upError) console.warn("Erro ao atualizar lead após handover:", upError);

    setShowHandoverModal(false);
    setHandoverSuccess(true);
    setTimeout(() => setHandoverSuccess(false), 3000);
    await fetchLead();
  }

  // ── Loading / Not found ──
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] px-6 py-6 flex items-center justify-center" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <p className="text-sm text-gray-500">Carregando...</p>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] px-6 py-6 flex flex-col items-center justify-center" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <p className="text-sm text-gray-500 mb-4">Lead não encontrado.</p>
        <button onClick={onBack} className="text-sm text-[#F97316] hover:underline">Voltar para Leads</button>
      </div>
    );
  }

  const statusColor = STATUS_COLORS[lead.status];

  // ── Info Row helper ──
  function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
    return (
      <div className="flex items-start justify-between py-3 border-b border-gray-100 last:border-0">
        <span className="text-sm text-gray-500">{label}</span>
        <span className="text-sm font-medium text-gray-900 text-right max-w-[60%]">{value || "\u2014"}</span>
      </div>
    );
  }

  // ── Tab Content ────────────────────────────────────────────────────────────

  function renderTabContent() {
    switch (activeTab) {
      // ── Visão Geral ──
      case "visao_geral":
        return (
          <div className="space-y-6">
            {/* Status Card */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Status do Lead</h3>
              <div className="flex items-center gap-3 mb-4">
                <span className={`w-2.5 h-2.5 rounded-full ${statusColor.dot}`} />
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusColor.bg} ${statusColor.text}`}>
                  {STATUS_LABELS[lead.status]}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-[#F8F9FA]">
                  <p className="text-xs text-gray-500 mb-1">Criado em</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(lead.created_at)}</p>
                </div>
                <div className="p-3 rounded-lg bg-[#F8F9FA]">
                  <p className="text-xs text-gray-500 mb-1">Última atualização</p>
                  <p className="text-sm font-medium text-gray-900">{formatDate(lead.updated_at)}</p>
                </div>
              </div>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Cadência</h3>
                <p className="text-sm text-gray-700">{cadence?.name ?? "\u2014"}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Iniciada em {lead.cadence_started_at ? formatDate(lead.cadence_started_at) : "\u2014"}
                </p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Responsável</h3>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#F97316]/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-[#F97316]">
                      {lead.owner?.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2) ?? "?"}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{lead.owner?.name ?? "Não atribuído"}</p>
                    <p className="text-xs text-gray-400">{lead.owner?.email ?? ""}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Contact / Function / Location / Source */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Informações Resumidas</h3>
              <InfoRow label="Contato Principal" value={lead.phone} />
              <InfoRow label="E-mail" value={lead.email} />
              <InfoRow label="Função" value={lead.job_title} />
              <InfoRow label="Localização" value={lead.location} />
              <InfoRow label="Origem" value={SOURCE_LABELS[lead.source]} />
            </div>

            {/* Prospection History Summary */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Histórico de Prospecção</h3>
              <div className="space-y-3">
                {cadenceDays.length === 0 && (
                  <p className="text-sm text-gray-400">Nenhuma cadência vinculada.</p>
                )}
                {cadenceDays.slice(0, 3).map((day) => (
                  <div key={day.id} className="flex items-center gap-3 p-3 rounded-lg bg-[#F8F9FA]">
                    <div className="w-8 h-8 rounded-full bg-[#F97316]/10 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-[#F97316]">D{day.day_number}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {day.activities?.map((act) => (
                        <span
                          key={act.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-gray-200 text-xs text-gray-600"
                          title={CHANNEL_LABELS[act.channel_type]}
                        >
                          {CHANNEL_ICONS[act.channel_type]}
                          {CHANNEL_LABELS[act.channel_type]}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {cadenceDays.length > 0 && (
                  <button
                    onClick={() => setActiveTab("prospeccao")}
                    className="text-sm font-medium text-[#0147FF] hover:underline transition-colors"
                  >
                    Ver histórico completo
                  </button>
                )}
              </div>
            </div>
          </div>
        );

      // ── Informações Pessoais ──
      case "informacoes_pessoais":
        return (
          <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Informações Pessoais</h3>
            <InfoRow label="Nome" value={lead.first_name} />
            <InfoRow label="Sobrenome" value={lead.last_name} />
            <InfoRow label="Nome completo" value={lead.full_name} />
            <InfoRow label="Cargo" value={lead.job_title} />
            <InfoRow label="Departamento" value={lead.department} />
            <InfoRow label="LinkedIn" value={lead.linkedin_url} />
            <InfoRow label="E-mail" value={lead.email} />
            <InfoRow label="Telefone" value={lead.phone} />
            <InfoRow label="Cidade" value={lead.city} />
            <InfoRow label="Estado" value={lead.state} />
          </div>
        );

      // ── Empresa ──
      case "empresa":
        return (
          <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Dados da Empresa</h3>
            <InfoRow label="Nome da Empresa" value={lead.company_name} />
            <InfoRow label="Segmento" value={lead.segment} />
            <InfoRow label="Porte" value={lead.company_size} />
            <InfoRow label="Website" value={lead.website} />
            <InfoRow label="LinkedIn da Empresa" value={lead.company_linkedin} />
            <InfoRow label="Cidade" value={lead.city} />
            <InfoRow label="Estado" value={lead.state} />
          </div>
        );

      // ── Anotações ──
      case "anotacoes":
        return (
          <div className="space-y-4">
            {/* Add Note */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Nova Anotação</h3>
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={3}
                placeholder="Escreva sua anotação..."
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#F97316]/20 focus:border-[#F97316] resize-none"
              />
              <div className="flex justify-end mt-3">
                <button
                  onClick={addNote}
                  disabled={!newNote.trim()}
                  className="px-4 py-2 rounded-lg bg-[#F97316] text-sm font-medium text-white hover:bg-[#EA6C0E] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Adicionar Anotação
                </button>
              </div>
            </div>

            {/* Notes List */}
            <div className="space-y-3">
              {notes.map((note) => (
                <div key={note.id} className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[#F97316]/10 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-[#F97316]">
                          {lead.owner?.name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2) ?? "?"}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-gray-900">{lead.owner?.name ?? "Autor"}</span>
                    </div>
                    <span className="text-xs text-gray-400">{formatDateTime(note.created_at)}</span>
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{note.body}</p>
                </div>
              ))}
              {notes.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-sm text-gray-400">Nenhuma anotação registrada.</p>
                </div>
              )}
            </div>
          </div>
        );

      // ── Contatos ──
      case "contatos":
        return (
          <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Contatos do Lead</h3>
            {contacts.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">Nenhum contato cadastrado.</p>
            )}
            <div className="space-y-3">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-[#F8F9FA]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center">
                      {contact.type === "phone" && CHANNEL_ICONS.ligacao}
                      {contact.type === "email" && CHANNEL_ICONS.email}
                      {contact.type === "whatsapp" && CHANNEL_ICONS.whatsapp}
                      {contact.type === "linkedin" && CHANNEL_ICONS.linkedin}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{contact.value}</p>
                      <p className="text-xs text-gray-400 capitalize">{contact.type}</p>
                    </div>
                  </div>
                  {contact.is_primary && (
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium bg-[#F97316]/10 text-[#F97316]">
                      Principal
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );

      // ── Reuniões ──
      case "reunioes":
        return (
          <div className="space-y-3">
            {meetings.map((meeting) => {
              const mColor = MEETING_COLORS[meeting.status] ?? MEETING_COLORS.agendada;
              return (
                <div key={meeting.id} className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${mColor.bg} ${mColor.text}`}>
                      {MEETING_STATUS_LABELS[meeting.status]}
                    </span>
                    <span className="text-xs text-gray-400">{formatDateTime(meeting.scheduled_at)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm text-gray-700">{formatDateTime(meeting.scheduled_at)}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    Criada em {formatDateTime(meeting.created_at)}
                  </p>
                </div>
              );
            })}
            {meetings.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm text-gray-400">Nenhuma reunião agendada.</p>
              </div>
            )}
          </div>
        );

      // ── Prospecção (Timeline) ──
      case "prospeccao":
        return (
          <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Timeline de Prospecção</h3>
            <p className="text-xs text-gray-500 mb-6">
              Cadência: {cadence?.name ?? "\u2014"}
              {lead.cadence_started_at && ` | Início: ${formatDate(lead.cadence_started_at)}`}
            </p>

            {cadenceDays.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">Nenhuma cadência vinculada.</p>
            )}

            <div className="relative">
              {/* Timeline line */}
              {cadenceDays.length > 0 && (
                <div className="absolute left-[19px] top-4 bottom-4 w-px bg-gray-200" />
              )}

              <div className="space-y-6">
                {cadenceDays.map((day) => {
                  const startDate = lead.cadence_started_at ? new Date(lead.cadence_started_at) : new Date();
                  const estimatedDate = new Date(startDate);
                  estimatedDate.setDate(estimatedDate.getDate() + day.day_number - 1);
                  const isPast = estimatedDate < new Date();

                  return (
                    <div key={day.id} className="relative flex gap-4">
                      {/* Day circle */}
                      <div
                        className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 ${
                          isPast
                            ? "bg-[#F97316] border-[#F97316] text-white"
                            : "bg-white border-gray-200 text-gray-500"
                        }`}
                      >
                        <span className="text-xs font-bold">D{day.day_number}</span>
                      </div>

                      {/* Day content */}
                      <div className="flex-1 pb-2">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold text-gray-900">Dia {day.day_number}</h4>
                          <span className="text-xs text-gray-400">
                            {formatDate(estimatedDate.toISOString())}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {day.activities?.map((act) => (
                            <div
                              key={act.id}
                              className={`flex items-center gap-3 p-3 rounded-lg border ${
                                isPast
                                  ? "bg-green-50/50 border-green-100"
                                  : "bg-[#F8F9FA] border-gray-100"
                              }`}
                            >
                              <div
                                className={`w-7 h-7 rounded-full flex items-center justify-center ${
                                  isPast
                                    ? "bg-green-100 text-green-600"
                                    : "bg-gray-100 text-gray-500"
                                }`}
                              >
                                {CHANNEL_ICONS[act.channel_type]}
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">
                                  {CHANNEL_LABELS[act.channel_type]}
                                </p>
                                {act.scheduled_time && (
                                  <p className="text-xs text-gray-400">Horário: {act.scheduled_time}</p>
                                )}
                              </div>
                              {isPast && (
                                <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );

      // ── Campos Personalizados ──
      case "campos_personalizados":
        return (
          <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Campos Personalizados</h3>
            <div className="text-center py-6">
              <p className="text-sm text-gray-400">Nenhum campo personalizado preenchido.</p>
            </div>
          </div>
        );

      default:
        return null;
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#F8F9FA] px-6 py-6" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Back Button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Voltar para Leads
      </button>

      {/* Lead Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#F97316]/10 flex items-center justify-center">
            <span className="text-base font-bold text-[#F97316]">
              {lead.first_name?.[0]}{lead.last_name?.[0]}
            </span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">{lead.full_name}</h1>
            <p className="text-sm text-gray-500">
              {lead.job_title} {lead.company_name ? `na ${lead.company_name}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowHandoverModal(true)}
            className="px-4 py-2 rounded-lg bg-[#2563EB] text-sm font-semibold text-white hover:bg-[#1D4ED8] transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            Enviar para Closer
          </button>
          <button
            onClick={markAsWon}
            className="px-4 py-2 rounded-lg bg-green-600 text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            Ganho
          </button>
          <div className="relative inline-block">
            <select
              value={selectedLossReason}
              onChange={(e) => {
                setSelectedLossReason(e.target.value);
                if (e.target.value) {
                  markAsLost(e.target.value);
                } else {
                  markAsLost();
                }
              }}
              className="px-4 py-2 rounded-lg bg-red-600 text-sm font-medium text-white hover:bg-red-700 transition-colors appearance-none cursor-pointer pr-8"
              style={{ backgroundImage: "none" }}
            >
              <option value="">Perdido</option>
              {lossReasons.map((lr) => (
                <option key={lr.id} value={lr.id}>{lr.label}</option>
              ))}
            </select>
          </div>
          <button className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Agendar Reunião
          </button>
          {(lead.status === "ganho" || lead.status === "perdido") && (
            <button
              onClick={async () => {
                // Reativar lead
                await supabase.from("qs_leads").update({
                  status: "em_prospeccao",
                  loss_reason_id: null,
                  cadence_started_at: new Date().toISOString(),
                  arrived_at: new Date().toISOString(),
                }).eq("id", lead.id);

                // Criar tasks baseado na cadência vinculada
                if (lead.cadence_id) {
                  const { data: days } = await supabase
                    .from("qs_cadence_days")
                    .select("*, activities:qs_cadence_activities(*)")
                    .eq("cadence_id", lead.cadence_id)
                    .order("day_number");

                  if (days && days.length > 0) {
                    const now = new Date();
                    const tasksToCreate = days.flatMap((day: any) =>
                      (day.activities || []).map((act: any) => {
                        const scheduled = new Date(now);
                        scheduled.setDate(scheduled.getDate() + (day.day_number - 1));
                        if (act.scheduled_time) {
                          const [h, m] = act.scheduled_time.split(":").map(Number);
                          scheduled.setHours(h, m, 0, 0);
                        } else {
                          scheduled.setHours(9, 0, 0, 0);
                        }
                        return {
                          lead_id: lead.id,
                          cadence_id: lead.cadence_id,
                          owner_id: lead.owner_id,
                          channel_type: act.channel_type,
                          priority: "media",
                          scheduled_at: scheduled.toISOString(),
                          status: "pendente",
                          contact_attempts: 0,
                        };
                      })
                    );
                    if (tasksToCreate.length > 0) {
                      await supabase.from("qs_tasks").insert(tasksToCreate);
                    }
                  }
                }

                setLead({ ...lead, status: "em_prospeccao" as any, loss_reason_id: null });
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
              style={{ background: "#0147FF" }}
            >
              ↩ Reativar Lead
            </button>
          )}
        </div>
      </div>

      {/* Tabs (clean underline style) */}
      <div className="border-b border-gray-100 mb-6">
        <div className="flex gap-0 -mb-px overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                activeTab === tab.key
                  ? "border-[#F97316] text-[#F97316]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div>{renderTabContent()}</div>

      {/* Success Toast */}
      {handoverSuccess && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl bg-green-600 text-white shadow-lg animate-pulse">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="text-sm font-semibold">Handover realizado com sucesso!</span>
        </div>
      )}

      {/* Re-engagement Modal (Change 16) */}
      {showReEngagement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Agendar Re-contato</h2>
            <p className="text-sm text-gray-500 mb-6">
              Este lead foi perdido por um motivo que pode ser temporário. Deseja agendar um re-contato futuro?
            </p>
            {reEngagementScheduled ? (
              <div className="text-center py-4">
                <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-green-700">Re-contato agendado!</p>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => scheduleReEngagement(30)}
                  className="flex-1 px-4 py-3 rounded-lg border-2 border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:border-[#F97316] hover:bg-[#F97316]/5 transition-all"
                >
                  30 dias
                </button>
                <button
                  onClick={() => scheduleReEngagement(60)}
                  className="flex-1 px-4 py-3 rounded-lg border-2 border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:border-[#F97316] hover:bg-[#F97316]/5 transition-all"
                >
                  60 dias
                </button>
                <button
                  onClick={() => scheduleReEngagement(90)}
                  className="flex-1 px-4 py-3 rounded-lg border-2 border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:border-[#F97316] hover:bg-[#F97316]/5 transition-all"
                >
                  90 dias
                </button>
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowReEngagement(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
              >
                Pular
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Handover Modal */}
      {showHandoverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#2563EB]/10 flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Handover SDR → Closer</h2>
                  <p className="text-xs text-gray-500">Transferir lead para o especialista de vendas</p>
                </div>
              </div>
              <button
                onClick={() => setShowHandoverModal(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Lead Summary */}
              <div className="bg-[#F8F9FA] rounded-xl p-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Resumo do Lead</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase">Nome</span>
                    <p className="text-sm font-semibold text-gray-900">{lead.full_name}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase">Empresa</span>
                    <p className="text-sm font-semibold text-gray-900">{lead.company_name || "--"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase">Canal de Origem</span>
                    <p className="text-sm text-gray-700">{SOURCE_LABELS[lead.source]}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase">Segmento</span>
                    <p className="text-sm text-gray-700">{lead.segment || "--"}</p>
                  </div>
                </div>
              </div>

              {/* Histórico de contatos */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Histórico de Contatos</h3>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {cadenceDays.slice(0, 3).map((day) => (
                    <div key={day.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-[#F8F9FA]">
                      <div className="w-6 h-6 rounded-full bg-[#F97316]/10 flex items-center justify-center shrink-0">
                        <span className="text-[9px] font-bold text-[#F97316]">D{day.day_number}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {day.activities?.map((act) => (
                          <span
                            key={act.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-gray-200 text-[10px] text-gray-600"
                          >
                            {CHANNEL_ICONS[act.channel_type]}
                            {CHANNEL_LABELS[act.channel_type]}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {cadenceDays.length === 0 && (
                    <p className="text-xs text-gray-400">Nenhuma cadência vinculada.</p>
                  )}
                </div>
              </div>

              {/* Anotações do SDR */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Anotações do SDR</h3>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {notes.slice(0, 3).map((note) => (
                    <div key={note.id} className="p-2.5 rounded-lg bg-[#F8F9FA]">
                      <p className="text-xs text-gray-600 leading-relaxed">{note.body}</p>
                      <span className="text-[10px] text-gray-400 mt-1 block">{formatDateTime(note.created_at)}</span>
                    </div>
                  ))}
                  {notes.length === 0 && (
                    <p className="text-xs text-gray-400">Nenhuma anotação registrada.</p>
                  )}
                </div>
              </div>

              {/* Closer Selection */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Selecionar Closer</h3>
                <select
                  value={selectedCloser}
                  onChange={(e) => setSelectedCloser(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                >
                  {closers.length === 0 && <option value="">Nenhum closer disponível</option>}
                  {closers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} - Closer</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button
                onClick={() => setShowHandoverModal(false)}
                className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleHandover}
                disabled={!selectedCloser}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Confirmar Handover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
