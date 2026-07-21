import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import type { Meeting, MeetingStatus, Lead } from "../types";
import { MEETING_STATUS_LABELS } from "../types";
import { googleCalendarUrl, downloadIcs, type CalendarEvent } from "@/lib/qs/calendar";
import { notifyBitrix } from "@/lib/qs/bitrixSync";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import AgendaPage from "../agenda/AgendaPage";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Converte a reunião no evento de agenda (Google/.ics). */
function meetingToEvent(m: Meeting): CalendarEvent {
  return {
    title: m.title || `Reunião — ${m.lead?.full_name ?? "cliente"}`,
    startsAt: m.scheduled_at,
    durationMin: m.duration_min,
    description: [m.lead?.full_name ? `Cliente: ${m.lead.full_name}` : null, m.notes].filter(Boolean).join("\n"),
    location: m.meeting_link || m.location || null,
  };
}

type FilterTab = "todas" | MeetingStatus;

const TABS: { key: FilterTab; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "agendada", label: "Agendadas" },
  { key: "realizada", label: "Realizadas" },
  { key: "no_show", label: "No-show" },
  { key: "cancelada", label: "Canceladas" },
];

// UUIDs válidos são exigidos por owner_id (uuid). O usuário "demo-skip" do
// bypass de login NÃO é um uuid, então nesse caso gravamos owner_id = null.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusBadgeClasses(status: MeetingStatus): string {
  switch (status) {
    case "agendada": return "bg-blue-50 text-blue-700";
    case "realizada": return "bg-green-50 text-green-700";
    case "no_show": return "bg-red-50 text-red-700";
    case "cancelada": return "bg-gray-100 text-gray-500";
  }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${mins}`;
}

// Converte um ISO (timestamptz) para o formato aceito por <input datetime-local>
// ("YYYY-MM-DDTHH:mm") no fuso local do navegador.
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function leadLabel(l: Lead): string {
  const name =
    l.full_name ||
    [l.first_name, l.last_name].filter(Boolean).join(" ") ||
    "Sem nome";
  return l.company_name ? `${name} — ${l.company_name}` : name;
}

// Espelha a mudança de status da reunião (realizada / no-show / cancelada) na
// timeline do negócio no Bitrix. O sync só conhece os eventos
// perdido|ganho|reuniao|nota (whitelist do /api/bitrix-sync e do n8n), então
// segue o padrão do handover na LeadDetailPage: evento "nota" vira comentário
// na timeline, sem mover coluna. Fire-and-forget — sem bitrix_id o notifyBitrix
// pula sozinho (lead que não veio do Bitrix).
function notifyMeetingStatusToBitrix(
  meeting: Pick<Meeting, "lead_id" | "scheduled_at" | "title"> & { lead?: Lead },
  status: MeetingStatus
): void {
  const phrases: Partial<Record<MeetingStatus, string>> = {
    realizada: "foi REALIZADA",
    no_show: "teve NO-SHOW (cliente não compareceu)",
    cancelada: "foi CANCELADA",
  };
  const phrase = phrases[status];
  if (!phrase) return; // "agendada" não tem nota própria — a criação já dispara o evento "reuniao"
  notifyBitrix("nota", {
    lead_id: meeting.lead_id,
    bitrix_id: meeting.lead?.bitrix_id,
    body: `Reunião de ${formatDateTime(meeting.scheduled_at)}${meeting.title ? ` (${meeting.title})` : ""} ${phrase} no QS.`,
  });
}

// ── Main Component ───────────────────────────────────────────────────────────

interface MeetingsPageProps {
  onOpenLead: (leadId: string) => void;
}

const inputClass =
  "w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF] transition-colors";
const labelClass = "block text-xs font-medium text-gray-700 mb-1";

export default function MeetingsPage({ onOpenLead }: MeetingsPageProps) {
  const { currentUser } = useQsAuth();

  // "Reuniões" (gestão/CRUD daqui) vs "Agenda" (a Google Agenda dos closers, que
  // antes era um item de menu próprio). Unificado numa aba só a pedido do Bruno.
  const [view, setView] = useState<"reunioes" | "agenda">("reunioes");

  const [activeTab, setActiveTab] = useState<FilterTab>("todas");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  // Ação (status/exclusão) gravando por reunião — trava os botões da linha p/ não
  // gravar duas vezes num duplo-clique.
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Modal (criar/editar) ──
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Form state ──
  const [fLeadId, setFLeadId] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [fWhen, setFWhen] = useState(""); // datetime-local
  const [fDuration, setFDuration] = useState("30");
  const [fLocation, setFLocation] = useState("");
  const [fLink, setFLink] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fStatus, setFStatus] = useState<MeetingStatus>("agendada");
  // Combobox de lead (item 5): texto digitado; fLeadId só é preenchido ao escolher.
  const [fLeadSearch, setFLeadSearch] = useState("");
  // Lista aberta só com o campo em foco — fecha ao clicar fora / tabular (senão a
  // lista de sugestões ficava flutuando por cima dos campos de baixo).
  const [leadListOpen, setLeadListOpen] = useState(false);

  const fetchMeetings = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_meetings")
      .select("*, lead:qs_leads(*), owner:qs_users(*)")
      .order("scheduled_at", { ascending: false });
    if (error) {
      setPageError(`Erro ao buscar reuniões: ${error.message}`);
    } else {
      setPageError(null);
      setMeetings((data as Meeting[]) ?? []);
    }
  }, []);

  const fetchLeads = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_leads")
      .select("id, full_name, first_name, last_name, company_name, phone, email, owner_id, bitrix_id")
      .order("full_name", { ascending: true });
    if (error) {
      setPageError(`Erro ao buscar leads: ${error.message}`);
    } else {
      setLeads((data as Lead[]) ?? []);
    }
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      await Promise.all([fetchMeetings(), fetchLeads()]);
      setLoading(false);
    }
    load();
  }, [fetchMeetings, fetchLeads]);

  // ── Modal openers ──
  function openCreate() {
    setEditingId(null);
    setFormError(null);
    setFLeadId("");
    setFLeadSearch("");
    setFTitle("");
    setFWhen("");
    setFDuration("30");
    setFLocation("");
    setFLink("");
    setFNotes("");
    setFStatus("agendada");
    setShowModal(true);
  }

  function openEdit(m: Meeting) {
    setEditingId(m.id);
    setFormError(null);
    setFLeadId(m.lead_id);
    // Preenche o combobox com o rótulo do lead atual (join m.lead) pra não abrir vazio.
    setFLeadSearch(m.lead ? leadLabel(m.lead) : "");
    setFTitle(m.title ?? "");
    setFWhen(m.scheduled_at ? isoToLocalInput(m.scheduled_at) : "");
    setFDuration(m.duration_min != null ? String(m.duration_min) : "30");
    setFLocation(m.location ?? "");
    setFLink(m.meeting_link ?? "");
    setFNotes(m.notes ?? "");
    setFStatus(m.status);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingId(null);
    setFormError(null);
  }

  // ── Save (INSERT / UPDATE) ──
  async function handleSave() {
    if (!fLeadId) {
      setFormError("Selecione um lead.");
      return;
    }
    if (!fWhen) {
      setFormError("Informe a data e a hora da reunião.");
      return;
    }
    const when = new Date(fWhen);
    if (isNaN(when.getTime())) {
      setFormError("Data/hora inválida.");
      return;
    }

    let duration: number | null = null;
    if (fDuration.trim() !== "") {
      const parsed = Number(fDuration);
      duration = isNaN(parsed) ? null : Math.round(parsed);
    }

    setSaving(true);
    setFormError(null);

    // Reunião sendo editada (estado anterior) — serve pra medir RLS, detectar
    // remarcação e comparar o status.
    const prev = editingId ? meetings.find((m) => m.id === editingId) : undefined;

    // Remarcação com rastro (item 3): reunião que estava AGENDADA e teve o horário
    // alterado ganha uma linha de auditoria no PRÓPRIO campo notes (sem migration),
    // preservando as anotações antigas.
    const rescheduled =
      !!prev &&
      prev.status === "agendada" &&
      new Date(prev.scheduled_at).getTime() !== when.getTime();

    let notesToSave = fNotes.trim();
    if (rescheduled && prev) {
      const now = new Date();
      const changeDay = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}`;
      const by = currentUser?.name ?? "alguém";
      const audit = `↻ Remarcada de ${formatDateTime(prev.scheduled_at)} para ${formatDateTime(when.toISOString())} (por ${by} em ${changeDay})`;
      notesToSave = notesToSave ? `${audit}\n${notesToSave}` : audit;
    }

    const base = {
      lead_id: fLeadId,
      title: fTitle.trim() || null,
      scheduled_at: when.toISOString(),
      duration_min: duration,
      location: fLocation.trim() || null,
      meeting_link: fLink.trim() || null,
      notes: notesToSave || null,
      status: fStatus,
    };

    const ownerId =
      currentUser && UUID_RE.test(currentUser.id) ? currentUser.id : null;

    // Na edição não sobrescrevemos owner_id (preserva o responsável original).
    // .select() MEDE o que o banco aceitou sob RLS: sem ele um write barrado volta
    // "sucesso" com 0 linhas e a tela mentiria pro usuário.
    const { data, error } = editingId
      ? await supabase
          .from("qs_meetings")
          .update({ ...base, updated_at: new Date().toISOString() })
          .eq("id", editingId)
          .select()
      : await supabase
          .from("qs_meetings")
          .insert({ ...base, owner_id: ownerId })
          .select();

    if (error) {
      setFormError(`Não foi possível salvar: ${error.message}`);
      setSaving(false);
      return;
    }
    if (!data || data.length === 0) {
      // Nenhuma linha retornada = RLS barrou (não é sua reunião) — não finge sucesso.
      setFormError("Você não tem permissão para salvar esta reunião.");
      setSaving(false);
      return;
    }

    // ── Espelho no Bitrix (fire-and-forget, mesmo padrão da LeadDetailPage) ──
    const selLead = leads.find((l) => l.id === fLeadId);
    if (editingId) {
      // Edição: se o status mudou pelo modal (ex.: marcada como realizada),
      // registra na timeline do Bitrix — mesmo efeito das ações rápidas.
      if (prev && prev.status !== fStatus) {
        notifyMeetingStatusToBitrix(
          { lead_id: fLeadId, scheduled_at: base.scheduled_at, title: base.title, lead: selLead ?? prev.lead },
          fStatus
        );
      }
      // Remarcação: conta a mudança de horário na timeline do Bitrix (nota, sem
      // mover coluna) e avisa o usuário que foi remarcada — não um "salvo" genérico.
      if (rescheduled && prev) {
        notifyBitrix("nota", {
          lead_id: fLeadId,
          bitrix_id: selLead?.bitrix_id ?? prev.lead?.bitrix_id,
          body: `Reunião remarcada de ${formatDateTime(prev.scheduled_at)} para ${formatDateTime(base.scheduled_at)} no QS.`,
        });
        notifySuccess("Reunião remarcada — novo horário salvo.");
      }
    } else {
      // Criação: preenche os campos da reunião no Bitrix e move o negócio pra
      // "Reunião agendada" — mesmo evento/payload do agendamento na página do lead.
      notifyBitrix("reuniao", {
        lead_id: fLeadId,
        bitrix_id: selLead?.bitrix_id,
        full_name: selLead?.full_name ?? null,
        title: base.title,
        scheduled_at: base.scheduled_at,
        duration_min: base.duration_min,
        location: base.location,
        meeting_link: base.meeting_link,
        notes: base.notes,
        scheduled_by: currentUser?.name ?? null,
        meeting_owner: currentUser?.name ?? null,
        client_email: selLead?.email ?? null,
        booking_date: new Date().toISOString().slice(0, 10),
      });
      // Criada já com desfecho (raro): registra o status também na timeline.
      if (fStatus !== "agendada") {
        notifyMeetingStatusToBitrix(
          { lead_id: fLeadId, scheduled_at: base.scheduled_at, title: base.title, lead: selLead },
          fStatus
        );
      }
    }

    setSaving(false);
    closeModal();
    await fetchMeetings();
  }

  // ── Status quick actions / cancel ──
  async function updateStatus(id: string, status: MeetingStatus) {
    const m = meetings.find((x) => x.id === id);
    // Cancelar é um clique num ícone — misclick não pode cancelar reunião de cliente.
    if (status === "cancelada") {
      const who = m?.lead?.full_name ? ` com ${m.lead.full_name}` : "";
      if (!window.confirm(`Cancelar a reunião${who}?`)) return;
    }
    setBusyId(id); // trava os botões da linha enquanto grava
    // .select() MEDE o que o banco aceitou sob RLS: update barrado volta data vazio,
    // então não recarregamos "como se tivesse dado certo".
    const { data, error } = await supabase
      .from("qs_meetings")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select();
    setBusyId(null);
    if (error) {
      console.warn("Erro ao atualizar status da reunião:", error);
      notifyError("Não foi possível atualizar a reunião — tente novamente.");
      return;
    }
    if (!data || data.length === 0) {
      notifyError("Você não tem permissão para alterar esta reunião.");
      return;
    }
    setPageError(null);
    // Espelha o desfecho na timeline do negócio no Bitrix (fire-and-forget).
    if (m) notifyMeetingStatusToBitrix(m, status);
    await fetchMeetings();
  }

  // ── Excluir reunião (REMOVE a linha) ──
  // Distinto de "Cancelar" (que mantém o registro com status cancelada). Serve pra
  // reuniões criadas por engano/duplicadas. Reuniões "realizada" têm valor histórico
  // (aconteceram de fato), então a exclusão só é oferecida em não-realizada.
  async function deleteMeeting(id: string) {
    const m = meetings.find((x) => x.id === id);
    const who = m?.lead?.full_name ? ` com ${m.lead.full_name}` : "";
    // window.confirm: misclick não pode apagar reunião de cliente.
    if (!window.confirm(`Excluir permanentemente a reunião${who}? Esta ação não pode ser desfeita.`)) return;
    setBusyId(id);
    // .select() MEDE o que o banco aceitou sob RLS (delete barrado volta data vazio).
    const { data, error } = await supabase
      .from("qs_meetings")
      .delete()
      .eq("id", id)
      .select();
    setBusyId(null);
    if (error) {
      notifyError(`Não foi possível excluir a reunião: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      notifyError("Você não tem permissão para excluir esta reunião.");
      return;
    }
    notifySuccess("Reunião excluída.");
    await fetchMeetings();
  }

  const filtered =
    activeTab === "todas"
      ? meetings
      : meetings.filter((m) => m.status === activeTab);

  const counts: Record<FilterTab, number> = {
    todas: meetings.length,
    agendada: meetings.filter((m) => m.status === "agendada").length,
    realizada: meetings.filter((m) => m.status === "realizada").length,
    no_show: meetings.filter((m) => m.status === "no_show").length,
    cancelada: meetings.filter((m) => m.status === "cancelada").length,
  };

  // Ordenação de EXIBIÇÃO (item 4): reuniões FUTURAS agendadas primeiro, em ordem
  // crescente (a PRÓXIMA no topo); depois todo o resto em ordem decrescente (mais
  // recente primeiro). Feito só aqui, na camada de exibição — as contagens das abas
  // continuam saindo de `meetings`, sem serem afetadas.
  const nowMs = Date.now();
  const isUpcoming = (m: Meeting) =>
    m.status === "agendada" && new Date(m.scheduled_at).getTime() >= nowMs;
  const sorted = [...filtered].sort((a, b) => {
    const au = isUpcoming(a);
    const bu = isUpcoming(b);
    if (au && bu) return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    if (au) return -1;
    if (bu) return 1;
    return new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime();
  });

  // Alternador Reuniões ⇄ Agenda — reaproveitado nas 3 saídas (agenda, loading,
  // conteúdo) pra ficar sempre visível, inclusive enquanto as reuniões carregam.
  const viewToggle = (
    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
      {([
        { id: "reunioes", label: "Reuniões" },
        { id: "agenda", label: "Agenda" },
      ] as const).map((v) => (
        <button
          key={v.id}
          onClick={() => setView(v.id)}
          className={`px-3.5 py-1.5 text-sm font-semibold rounded-md transition ${
            view === v.id ? "bg-[#0147FF] text-white" : "text-gray-600 hover:bg-gray-50"
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );

  // Aba "Agenda": só o embed da Google Agenda (AgendaPage traz o próprio título).
  if (view === "agenda") {
    return (
      <div className="space-y-4" style={{ fontFamily: "inherit" }}>
        {viewToggle}
        <AgendaPage />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4" style={{ fontFamily: "inherit" }}>
        {viewToggle}
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-gray-500">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ fontFamily: "inherit" }}>
      {viewToggle}
      {/* Header */}
      <div className="flex flex-wrap gap-y-2 items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Gestão de Reuniões
          </h1>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#0147FF] hover:bg-[#0139D6] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Agendar Reunião
        </button>
      </div>

      {/* Page error banner */}
      {pageError && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{pageError}</p>
          <button
            onClick={() => setPageError(null)}
            className="text-red-400 hover:text-red-600 transition-colors"
            title="Fechar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-1 gap-y-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-[#0147FF] text-white"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {tab.label}
            <span className={`ml-1.5 ${activeTab === tab.key ? "text-white/70" : "text-gray-400"}`}>
              {counts[tab.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Table or Empty State */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl shadow-none p-6 md:p-12 flex flex-col items-center justify-center text-center">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
          <p className="mt-4 text-sm text-gray-500">
            Nenhuma reunião encontrada para este filtro.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl shadow-none overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Data/Hora</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Lead</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Responsável</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((meeting) => (
                <tr
                  key={meeting.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50/40 transition-colors"
                >
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {formatDateTime(meeting.scheduled_at)}
                    {meeting.title && (
                      <span className="block text-xs text-gray-400">{meeting.title}</span>
                    )}
                    {meeting.location && (
                      <span className="inline-flex items-center gap-1 mt-0.5 text-[11px] font-semibold text-emerald-600">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                        {meeting.location}
                      </span>
                    )}
                    {/* Link da reunião clicável direto na lista (item 2) — atalho pra entrar. */}
                    {meeting.meeting_link && (
                      <span className="block mt-0.5">
                        <a
                          href={meeting.meeting_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0147FF] hover:underline"
                          title="Entrar na reunião"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                          Entrar
                        </a>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onOpenLead(meeting.lead_id)}
                      className="text-[#0147FF] hover:underline text-sm font-medium"
                    >
                      {meeting.lead?.full_name ?? "—"}
                    </button>
                    {meeting.lead?.company_name && (
                      <span className="block text-xs text-gray-400">
                        {meeting.lead.company_name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {(meeting as any).owner?.name ?? "—"}
                    {meeting.notes && (
                      <span className="block text-xs text-gray-400 truncate max-w-[260px]" title={meeting.notes}>
                        {meeting.notes}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusBadgeClasses(meeting.status)}`}
                    >
                      {MEETING_STATUS_LABELS[meeting.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      {meeting.status === "agendada" && (
                        <>
                          <button
                            onClick={() => updateStatus(meeting.id, "realizada")}
                            disabled={busyId === meeting.id}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Marcar como realizada"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                          <button
                            onClick={() => updateStatus(meeting.id, "no_show")}
                            disabled={busyId === meeting.id}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Marcar como no-show"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                              <line x1="17" y1="8" x2="23" y2="14" />
                              <line x1="23" y1="8" x2="17" y2="14" />
                            </svg>
                          </button>
                        </>
                      )}
                      {meeting.status === "agendada" && (
                        <>
                          <a
                            href={googleCalendarUrl(meetingToEvent(meeting))}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Adicionar ao Google Agenda"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                              <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                              <line x1="12" y1="14" x2="12" y2="18" /><line x1="10" y1="16" x2="14" y2="16" />
                            </svg>
                          </a>
                          <button
                            onClick={() => downloadIcs(meetingToEvent(meeting))}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title="Baixar convite (.ics) — Outlook/Apple"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => openEdit(meeting)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        title="Editar"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      {meeting.status !== "cancelada" && (
                        <button
                          onClick={() => updateStatus(meeting.id, "cancelada")}
                          disabled={busyId === meeting.id}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Cancelar (mantém o registro)"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      )}
                      {/* Excluir (lixeira) — remove o registro; escondido em realizada (histórico). */}
                      {meeting.status !== "realizada" && (
                        <button
                          onClick={() => deleteMeeting(meeting.id)}
                          disabled={busyId === meeting.id}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Excluir reunião (remove o registro)"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* ── Create / Edit Modal ─────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative bg-white rounded-xl border border-gray-100 shadow-none w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-gray-900">
                {editingId ? "Editar Reunião" : "Agendar Reunião"}
              </h2>
              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Lead: combobox com busca (item 5) — filtra por nome/empresa/telefone/
                  e-mail conforme digita; fLeadId só é fixado ao escolher um item. */}
              <div className="relative">
                <label className={labelClass}>Lead</label>
                <input
                  type="text"
                  value={fLeadSearch}
                  onChange={(e) => { setFLeadSearch(e.target.value); setFLeadId(""); setLeadListOpen(true); }}
                  onFocus={() => setLeadListOpen(true)}
                  // Atraso pra o clique num item registrar antes de fechar a lista.
                  onBlur={() => setTimeout(() => setLeadListOpen(false), 150)}
                  placeholder="Digite o nome, empresa ou telefone do lead..."
                  className={inputClass}
                  autoComplete="off"
                />
                {leadListOpen && fLeadSearch && !fLeadId && (() => {
                  const q = fLeadSearch.toLowerCase();
                  const matches = leads.filter((l) =>
                    l.full_name?.toLowerCase().includes(q) ||
                    l.company_name?.toLowerCase().includes(q) ||
                    l.email?.toLowerCase().includes(q) ||
                    l.phone?.includes(fLeadSearch)
                  );
                  return (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {matches.slice(0, 10).map((l) => (
                        <button
                          type="button"
                          key={l.id}
                          onClick={() => { setFLeadId(l.id); setFLeadSearch(leadLabel(l)); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                        >
                          <span className="font-medium text-gray-900">{l.full_name || "Sem nome"}</span>
                          {l.company_name && <span className="text-gray-400"> · {l.company_name}</span>}
                          {l.phone && <span className="text-gray-300 text-xs ml-2">{l.phone}</span>}
                        </button>
                      ))}
                      {matches.length === 0 && (
                        <p className="px-3 py-2 text-xs text-gray-400">Nenhum lead encontrado.</p>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className={labelClass}>Título</label>
                <input
                  type="text"
                  value={fTitle}
                  onChange={(e) => setFTitle(e.target.value)}
                  placeholder="Ex.: Apresentação da proposta"
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Data e hora</label>
                  <input
                    type="datetime-local"
                    value={fWhen}
                    onChange={(e) => setFWhen(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Duração (min)</label>
                  <input
                    type="number"
                    min={0}
                    step={5}
                    value={fDuration}
                    onChange={(e) => setFDuration(e.target.value)}
                    placeholder="30"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Local</label>
                <input
                  type="text"
                  value={fLocation}
                  onChange={(e) => setFLocation(e.target.value)}
                  placeholder="Ex.: Escritório, Google Meet, telefone..."
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Link da reunião</label>
                <input
                  type="text"
                  value={fLink}
                  onChange={(e) => setFLink(e.target.value)}
                  placeholder="https://..."
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Status</label>
                <select
                  value={fStatus}
                  onChange={(e) => setFStatus(e.target.value as MeetingStatus)}
                  className={inputClass}
                >
                  {(Object.keys(MEETING_STATUS_LABELS) as MeetingStatus[]).map((k) => (
                    <option key={k} value={k}>{MEETING_STATUS_LABELS[k]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>Anotações</label>
                <textarea
                  value={fNotes}
                  onChange={(e) => setFNotes(e.target.value)}
                  rows={3}
                  placeholder="Observações sobre a reunião..."
                  className={`${inputClass} resize-none`}
                />
              </div>

              {formError && (
                <p className="text-sm text-red-600">{formError}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={closeModal}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !fLeadId || !fWhen}
                className="px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-medium text-white hover:bg-[#0139D6] disabled:opacity-50 transition-colors"
              >
                {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Agendar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
