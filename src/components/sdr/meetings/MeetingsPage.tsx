import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import type { Meeting, MeetingStatus, Lead } from "../types";
import { MEETING_STATUS_LABELS } from "../types";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Main Component ───────────────────────────────────────────────────────────

interface MeetingsPageProps {
  onOpenLead: (leadId: string) => void;
}

const inputClass =
  "w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#F97316]/20 focus:border-[#F97316] transition-colors";
const labelClass = "block text-xs font-medium text-gray-700 mb-1";

export default function MeetingsPage({ onOpenLead }: MeetingsPageProps) {
  const { currentUser } = useQsAuth();

  const [activeTab, setActiveTab] = useState<FilterTab>("todas");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

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
      .select("id, full_name, first_name, last_name, company_name, phone, email, owner_id")
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

    const base = {
      lead_id: fLeadId,
      title: fTitle.trim() || null,
      scheduled_at: when.toISOString(),
      duration_min: duration,
      location: fLocation.trim() || null,
      meeting_link: fLink.trim() || null,
      notes: fNotes.trim() || null,
      status: fStatus,
    };

    const ownerId =
      currentUser && UUID_RE.test(currentUser.id) ? currentUser.id : null;

    // Na edição não sobrescrevemos owner_id (preserva o responsável original).
    const { error } = editingId
      ? await supabase
          .from("qs_meetings")
          .update({ ...base, updated_at: new Date().toISOString() })
          .eq("id", editingId)
      : await supabase
          .from("qs_meetings")
          .insert({ ...base, owner_id: ownerId });

    if (error) {
      setFormError(`Não foi possível salvar: ${error.message}`);
      setSaving(false);
      return;
    }

    setSaving(false);
    closeModal();
    await fetchMeetings();
  }

  // ── Status quick actions / cancel ──
  async function updateStatus(id: string, status: MeetingStatus) {
    const { error } = await supabase
      .from("qs_meetings")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setPageError(`Erro ao atualizar status: ${error.message}`);
    } else {
      setPageError(null);
      await fetchMeetings();
    }
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <p className="text-sm text-gray-500">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
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
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#F97316] hover:bg-[#EA6C0E] transition-colors"
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
                ? "bg-[#F97316] text-white"
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
              {filtered.map((meeting) => (
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
                            className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                            title="Marcar como realizada"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                          <button
                            onClick={() => updateStatus(meeting.id, "no_show")}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
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
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Cancelar"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
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
              <div>
                <label className={labelClass}>Lead</label>
                <select
                  value={fLeadId}
                  onChange={(e) => setFLeadId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Selecione um lead...</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>{leadLabel(l)}</option>
                  ))}
                </select>
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
                className="px-4 py-2 rounded-lg bg-[#F97316] text-sm font-medium text-white hover:bg-[#EA6C0E] disabled:opacity-50 transition-colors"
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
