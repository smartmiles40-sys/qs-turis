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
import { setMeetingStatus, setMeetingSal, deleteMeeting, type DesfechoCompleto } from "@/lib/qs/meetings";
import DesfechoVenda from "./DesfechoVenda";
import BriefingDoLead from "./BriefingDoLead";
import { googleCalendarUrl, downloadIcs, type CalendarEvent } from "@/lib/qs/calendar";
import { getSetting } from "@/lib/qsSettings";
import { MEETING_STATUS_LABELS, type Meeting, type MeetingSal, type MeetingStatus } from "../types";
import { hhmm, WEEKDAY_LONG, MONTH_LONG } from "@/lib/qs/calendarLayout";

// Lista fechada, definida pelo comercial em qs_settings (0032) — a MESMA que a
// AgendaDia usa. Trocar os motivos não exige deploy.
const MOTIVOS_SAL_PADRAO = [
  "Fora do perfil",
  "Sem orçamento",
  "Sem urgência (>6 meses)",
  "Já comprou com concorrente",
  "Dado incorreto / não era o decisor",
  "Curioso — sem intenção real",
];

function statusClasses(status: MeetingStatus): string {
  switch (status) {
    case "agendada": return "bg-blue-50 text-blue-700";
    case "confirmada": return "bg-cyan-50 text-cyan-700";
    case "realizada": return "bg-green-50 text-green-700";
    case "no_show": return "bg-red-50 text-red-700";
    case "reagendada": return "bg-amber-50 text-amber-700";
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
  // "Recusado" EXIGE motivo — o banco recusa sem ele (0032). Este modal chamava
  // setMeetingSal sem passar nada, então clicar em Recusado dava erro TODA vez.
  // Agora ele abre a lista antes de gravar, igual à AgendaDia.
  const [motivos, setMotivos] = useState<string[]>(MOTIVOS_SAL_PADRAO);
  const [pedindoMotivo, setPedindoMotivo] = useState(false);
  // Realizada e no-show levam VALOR e TIPO DA VENDA pro card do Bitrix (Bruno,
  // 17/08). Perguntamos aqui, na hora do desfecho, porque é o único momento em
  // que o closer tem os dois na cabeça — depois vira campo em branco pra sempre.
  const [fechando, setFechando] = useState<"realizada" | "no_show" | null>(null);

  useEffect(() => {
    void getSetting<string[]>("sal_motivos").then((lista) => {
      if (Array.isArray(lista) && lista.length) setMotivos(lista);
    });
  }, []);

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

  async function mudarStatus(status: MeetingStatus, desfecho?: DesfechoCompleto) {
    if (!meeting) return;
    if (status === "cancelada") {
      const quem = meeting.lead_name ? ` com ${meeting.lead_name}` : "";
      if (!window.confirm(`Cancelar a reunião${quem}? A atividade de confirmação também será encerrada.`)) return;
    }
    setBusy(true);
    // SAL junto com o desfecho (19/08): o mesmo caminho da agenda do dia.
    const { sal, ...venda } = desfecho ?? {};
    const res = await setMeetingStatus(
      meeting, status, meeting.lead?.bitrix_id, venda,
      sal ? { ...sal, by: currentUser?.id ?? null } : null
    );
    setBusy(false);
    if (!res.ok) {
      notifyError(res.error);
      return;
    }
    notifySuccess(`Reunião marcada como ${MEETING_STATUS_LABELS[status].toLowerCase()}.`);
    onChanged();
    onClose();
  }

  async function marcarSal(sal: MeetingSal, motivo?: string) {
    if (!meeting) return;
    // Clicar de novo no que já está marcado desmarca — é o único jeito de
    // desfazer um clique errado sem ter que reabrir a reunião de outro lugar.
    const alvo = meeting.sal === sal ? null : sal;

    // Recusar sem motivo não passa no banco: pergunta antes de tentar.
    if (alvo === "recusado" && !motivo) {
      setPedindoMotivo(true);
      return;
    }

    setBusy(true);
    const res = await setMeetingSal(meeting, alvo, currentUser?.id ?? null, meeting.lead?.bitrix_id, motivo ?? null);
    setBusy(false);
    setPedindoMotivo(false);
    if (!res.ok) {
      notifyError(res.error);
      return;
    }
    notifySuccess(alvo ? `Lead ${alvo} pelo especialista.` : "SAL desmarcado.");
    onChanged();
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
              {/* Retomada precisa ser visível: é o que explica por que esta
                  reunião não pede SAL e não entra no indicador do mês. */}
              {meeting.tipo === "retomada" && (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  Retomada
                </span>
              )}
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

        <div className="px-5 pb-3">
          <BriefingDoLead leadId={meeting.lead_id} />
        </div>

        {podeMexer ? (
          <div className="px-5 py-4 border-t border-gray-100 space-y-2">
            {/* "Confirmada" também é reunião que ainda vai acontecer: o desfecho
                tem que estar aqui, senão ela nunca fecha por esta tela. */}
            {(meeting.status === "agendada" || meeting.status === "confirmada") && !fechando && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setFechando("realizada")}
                  disabled={busy}
                  className="py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
                >
                  Realizada
                </button>
                <button
                  onClick={() => setFechando("no_show")}
                  disabled={busy}
                  className="py-2 rounded-lg border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 disabled:opacity-50"
                >
                  No-show
                </button>
              </div>
            )}

            {/* Valor e tipo da venda antes de fechar — mesmo formulário da
                agenda do dia (DesfechoVenda). Os dois vão pro card do Bitrix
                junto com a data e a mudança de etapa. */}
            {fechando && (
              <DesfechoVenda
                tipo={fechando}
                busy={busy}
                onVoltar={() => setFechando(null)}
                pedirSal={(meeting.tipo ?? "primeira") !== "retomada"}
                onConfirmar={(desfecho) => void mudarStatus(fechando, desfecho)}
              />
            )}

            {meeting.status === "agendada" && (
              <button
                onClick={() => mudarStatus("confirmada")}
                disabled={busy}
                className="w-full py-2 rounded-lg border border-cyan-200 bg-cyan-50 text-cyan-700 text-sm font-semibold hover:bg-cyan-100 disabled:opacity-50"
              >
                Cliente confirmou presença
              </button>
            )}

            {/* SAL: o funil só fecha quando o especialista diz se o lead prestava.
                Mesma pergunta da tela de Agendamento — quem clica na reunião pelo
                mês não deveria ter que trocar de aba pra responder. */}
            {meeting.status === "realizada" && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  Lead aceito (SAL)
                </p>
                <div className="mt-2 flex gap-2">
                  {([
                    { valor: "aceito" as const, rotulo: "Aceito", cor: "#059669" },
                    { valor: "recusado" as const, rotulo: "Recusado", cor: "#DC2626" },
                  ]).map((op) => {
                    const on = meeting.sal === op.valor;
                    return (
                      <button
                        key={op.valor}
                        onClick={() => marcarSal(op.valor)}
                        disabled={busy}
                        className="flex-1 rounded-lg border py-1.5 text-xs font-bold transition disabled:opacity-50"
                        style={{
                          borderColor: on ? op.cor : "#E5E7EB",
                          background: on ? `${op.cor}18` : "transparent",
                          color: on ? op.cor : "#6B7280",
                        }}
                      >
                        {op.rotulo}
                      </button>
                    );
                  })}
                </div>

                {/* Por que recusou. Lista fechada de propósito: motivo em texto
                    livre não vira relatório, e é o relatório que diz ao marketing
                    que tipo de lead parar de trazer. */}
                {pedindoMotivo && (
                  <div className="mt-3 border-t border-gray-200 pt-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                      Por que o lead foi recusado?
                    </p>
                    <div className="mt-2 flex flex-col gap-1">
                      {motivos.map((mot) => (
                        <button
                          key={mot}
                          onClick={() => marcarSal("recusado", mot)}
                          disabled={busy}
                          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-left text-xs font-medium text-gray-700 hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
                        >
                          {mot}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setPedindoMotivo(false)}
                      className="mt-2 text-[11px] font-semibold text-gray-400 hover:text-gray-600"
                    >
                      Cancelar
                    </button>
                  </div>
                )}

                {/* Já respondido: mostra o motivo em vez de esconder a decisão. */}
                {!pedindoMotivo && meeting.sal === "recusado" && meeting.sal_motivo && (
                  <p className="mt-2 text-[11.5px] text-gray-500">
                    Motivo: <b className="text-gray-700">{meeting.sal_motivo}</b>
                  </p>
                )}
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
