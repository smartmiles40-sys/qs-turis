// src/components/sdr/agenda/MeetingDetailModal.tsx
// -----------------------------------------------------------------------------
// O que abre ao clicar numa reunião do calendário: os dados e o desfecho
// (realizada / no-show / remarcar / cancelar).
//
// Detalhe de permissão: o time inteiro VÊ a agenda toda, mas continua vendo só
// os PRÓPRIOS leads. Por isso o botão "Abrir lead" é conferido de verdade contra
// o banco antes de aparecer — em vez de levar o usuário a uma tela de acesso
// negado.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { setMeetingStatus, deleteMeeting } from "@/lib/qs/meetings";
import { googleCalendarUrl, downloadIcs, type CalendarEvent } from "@/lib/qs/calendar";
import { MEETING_STATUS_LABELS, type Meeting, type MeetingStatus } from "../types";
import { hhmm, WEEKDAY_LONG, MONTH_LONG } from "@/lib/qs/calendarLayout";

function statusClasses(status: MeetingStatus): string {
  switch (status) {
    case "agendada": return "bg-blue-50 text-blue-700";
    case "realizada": return "bg-green-50 text-green-700";
    case "no_show": return "bg-red-50 text-red-700";
    case "cancelada": return "bg-gray-100 text-gray-500";
  }
}

function toCalendarEvent(m: Meeting): CalendarEvent {
  return {
    title: m.title || `Reunião — ${m.lead_name ?? "cliente"}`,
    startsAt: m.scheduled_at,
    durationMin: m.duration_min,
    description: [m.lead_name ? `Cliente: ${m.lead_name}` : null, m.notes].filter(Boolean).join("\n"),
    location: m.meeting_link || m.location || null,
  };
}

interface MeetingDetailModalProps {
  meeting: Meeting | null;
  onClose: () => void;
  onChanged: () => void;
  onReschedule: (meeting: Meeting) => void;
  onOpenLead?: (leadId: string) => void;
}

export default function MeetingDetailModal({
  meeting,
  onClose,
  onChanged,
  onReschedule,
  onOpenLead,
}: MeetingDetailModalProps) {
  const { currentUser } = useQsAuth();
  const [busy, setBusy] = useState(false);
  const [leadVisible, setLeadVisible] = useState(false);

  useEffect(() => {
    if (!meeting) return;
    setLeadVisible(false);
    void (async () => {
      const { data } = await supabase.from("qs_leads").select("id").eq("id", meeting.lead_id).maybeSingle();
      setLeadVisible(!!data);
    })();
  }, [meeting]);

  if (!meeting) return null;

  const isManager = currentUser?.role === "admin" || currentUser?.role === "gestor";
  const podeMexer =
    isManager || meeting.owner_id === currentUser?.id || meeting.closer_id === currentUser?.id;

  const start = new Date(meeting.scheduled_at);
  const end = new Date(start.getTime() + (meeting.duration_min ?? 30) * 60_000);

  async function mudarStatus(status: MeetingStatus) {
    if (!meeting) return;
    if (status === "cancelada") {
      const quem = meeting.lead_name ? ` com ${meeting.lead_name}` : "";
      if (!window.confirm(`Cancelar a reunião${quem}? A atividade de confirmação também será encerrada.`)) return;
    }
    setBusy(true);
    const res = await setMeetingStatus(meeting, status, meeting.lead?.bitrix_id);
    setBusy(false);
    if (!res.ok) {
      notifyError(res.error);
      return;
    }
    notifySuccess(`Reunião marcada como ${MEETING_STATUS_LABELS[status].toLowerCase()}.`);
    onChanged();
    onClose();
  }

  async function excluir() {
    if (!meeting) return;
    if (!window.confirm("Excluir permanentemente esta reunião? Esta ação não pode ser desfeita.")) return;
    setBusy(true);
    const res = await deleteMeeting(meeting.id);
    setBusy(false);
    if (!res.ok) {
      notifyError(res.error ?? "Não foi possível excluir.");
      return;
    }
    notifySuccess("Reunião excluída.");
    onChanged();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div className="relative bg-white rounded-xl border border-gray-100 w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusClasses(meeting.status)}`}>
                {MEETING_STATUS_LABELS[meeting.status]}
              </span>
              <h2 className="mt-1.5 text-base font-bold text-gray-900 truncate">
                {meeting.lead_name ?? meeting.lead?.full_name ?? "Reunião"}
              </h2>
              {meeting.title && <p className="text-xs text-gray-500 truncate">{meeting.title}</p>}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 shrink-0" aria-label="Fechar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-3 text-sm">
          <div className="flex items-start gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 mt-0.5 shrink-0">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <div>
              <p className="font-semibold text-gray-800">
                {WEEKDAY_LONG[start.getDay()]}, {start.getDate()} de {MONTH_LONG[start.getMonth()]}
              </p>
              <p className="text-gray-500">
                {hhmm(start)} – {hhmm(end)} · {meeting.duration_min ?? 30} min
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 shrink-0">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
            <p className="text-gray-700">
              Closer: <b>{meeting.closer?.name ?? meeting.meeting_owner ?? "não definido"}</b>
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 shrink-0">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <p className="text-gray-700">
              Agendada por: <b>{meeting.owner?.name ?? meeting.scheduled_by ?? "—"}</b>
            </p>
          </div>

          {meeting.meeting_link && (
            <a
              href={meeting.meeting_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 text-[#0147FF] font-semibold hover:underline"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
              </svg>
              Entrar na reunião
            </a>
          )}

          {meeting.notes && (
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
              <p className="text-xs whitespace-pre-wrap text-gray-600">{meeting.notes}</p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <a
              href={googleCalendarUrl(toCalendarEvent(meeting))}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-semibold text-gray-500 hover:text-[#0147FF]"
            >
              Exportar p/ Google
            </a>
            <span className="text-gray-300">·</span>
            <button
              onClick={() => downloadIcs(toCalendarEvent(meeting))}
              className="text-[11px] font-semibold text-gray-500 hover:text-[#0147FF]"
            >
              Baixar .ics
            </button>
            {leadVisible && onOpenLead && (
              <>
                <span className="text-gray-300">·</span>
                <button
                  onClick={() => { onOpenLead(meeting.lead_id); onClose(); }}
                  className="text-[11px] font-semibold text-gray-500 hover:text-[#0147FF]"
                >
                  Abrir lead
                </button>
              </>
            )}
          </div>
        </div>

        {podeMexer ? (
          <div className="px-5 py-4 border-t border-gray-100 space-y-2">
            {meeting.status === "agendada" && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => mudarStatus("realizada")}
                  disabled={busy}
                  className="py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
                >
                  Realizada
                </button>
                <button
                  onClick={() => mudarStatus("no_show")}
                  disabled={busy}
                  className="py-2 rounded-lg border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 disabled:opacity-50"
                >
                  No-show
                </button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { onReschedule(meeting); onClose(); }}
                disabled={busy || meeting.status === "realizada"}
                className="py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
              >
                Remarcar
              </button>
              {meeting.status !== "cancelada" ? (
                <button
                  onClick={() => mudarStatus("cancelada")}
                  disabled={busy}
                  className="py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
                >
                  Cancelar reunião
                </button>
              ) : (
                <button
                  onClick={excluir}
                  disabled={busy}
                  className="py-2 rounded-lg border border-gray-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-40"
                >
                  Excluir
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="px-5 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              Só o SDR que agendou, o closer da reunião ou a gestão podem alterar esta reunião.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
