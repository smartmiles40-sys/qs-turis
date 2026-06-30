import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Meeting, MeetingStatus } from "../types";
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

// ── Main Component ───────────────────────────────────────────────────────────

interface MeetingsPageProps {
  onOpenLead: (leadId: string) => void;
}

export default function MeetingsPage({ onOpenLead }: MeetingsPageProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>("todas");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMeetings = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_meetings")
      .select("*, lead:qs_leads(*), owner:qs_users(*)")
      .order("scheduled_at", { ascending: false });
    if (error) {
      console.warn("Erro ao buscar reuniões:", error);
    } else {
      setMeetings((data as Meeting[]) ?? []);
    }
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      await fetchMeetings();
      setLoading(false);
    }
    load();
  }, [fetchMeetings]);

  async function cancelMeeting(id: string) {
    const { error } = await supabase
      .from("qs_meetings")
      .update({ status: "cancelada" as MeetingStatus })
      .eq("id", id);
    if (error) console.warn("Erro ao cancelar reunião:", error);
    else await fetchMeetings();
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
      <div className="flex items-center justify-between">
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
        <button className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#F97316] hover:bg-[#EA6C0E] transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Agendar Reunião
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1">
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
        <div className="bg-white border border-gray-100 rounded-xl shadow-none p-12 flex flex-col items-center justify-center text-center">
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
          <table className="w-full text-sm">
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
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onOpenLead(meeting.lead_id)}
                      className="text-[#0147FF] hover:underline text-sm font-medium"
                    >
                      {meeting.lead?.full_name ?? "\u2014"}
                    </button>
                    {meeting.lead?.company_name && (
                      <span className="block text-xs text-gray-400">
                        {meeting.lead.company_name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {(meeting as any).owner?.name ?? "\u2014"}
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
                      <button className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Editar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => cancelMeeting(meeting.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Cancelar"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
