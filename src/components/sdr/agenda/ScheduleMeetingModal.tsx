// src/components/sdr/agenda/ScheduleMeetingModal.tsx
// -----------------------------------------------------------------------------
// O modal de agendar / remarcar. Casca em volta do SlotPicker: escolhe o lead,
// dá título e anotações, e grava pelo serviço central (lib/qs/meetings.ts) — que
// é quem cria a atividade de confirmação e avisa o Bitrix.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { notifySuccess } from "@/lib/qs/notify";
import { createMeeting, rescheduleMeeting } from "@/lib/qs/meetings";
import SlotPicker, { type SlotSelection } from "./SlotPicker";
import type { Lead, Meeting } from "../types";

const inputClass =
  "w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF] transition-colors";
const labelClass = "block text-xs font-medium text-gray-700 mb-1";

function leadLabel(l: Lead): string {
  const name = l.full_name || [l.first_name, l.last_name].filter(Boolean).join(" ") || "Sem nome";
  return l.company_name ? `${name} — ${l.company_name}` : name;
}

interface ScheduleMeetingModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (meeting: Meeting) => void;
  /** Lead já definido (fluxo vindo do lead / do Ganho). */
  lead?: Lead | null;
  /** Pré-seleção vinda do clique numa célula do calendário. */
  initialCloserId?: string | null;
  initialDate?: Date | null;
  /** Preenchido = modo REMARCAR. */
  reschedule?: Meeting | null;
}

export default function ScheduleMeetingModal({
  open,
  onClose,
  onSaved,
  lead,
  initialCloserId,
  initialDate,
  reschedule,
}: ScheduleMeetingModalProps) {
  const { currentUser } = useQsAuth();
  const isManager = currentUser?.role === "admin" || currentUser?.role === "gestor";
  const remarcando = !!reschedule;

  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadId, setLeadId] = useState<string>(lead?.id ?? reschedule?.lead_id ?? "");
  const [leadSearch, setLeadSearch] = useState<string>(lead ? leadLabel(lead) : "");
  const [leadListOpen, setLeadListOpen] = useState(false);

  const [pick, setPick] = useState<SlotSelection | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset a cada abertura: modal reaproveitado não pode herdar o lead anterior.
  useEffect(() => {
    if (!open) return;
    setLeadId(lead?.id ?? reschedule?.lead_id ?? "");
    setLeadSearch(lead ? leadLabel(lead) : "");
    setPick(null);
    setTitle(reschedule?.title ?? "");
    setNotes("");
    setLink(reschedule?.meeting_link ?? "");
    setError(null);
  }, [open, lead, reschedule]);

  // Lista de leads só é necessária quando o lead NÃO veio pronto.
  useEffect(() => {
    if (!open || lead || remarcando) return;
    void (async () => {
      const { data } = await supabase
        .from("qs_leads")
        .select("id, full_name, first_name, last_name, company_name, phone, email, bitrix_id, cadence_id")
        .order("full_name");
      setLeads((data as Lead[]) ?? []);
    })();
  }, [open, lead, remarcando]);

  // O link da sala do closer entra sozinho quando o SDR não digitou nada.
  useEffect(() => {
    if (pick?.link && !link.trim()) setLink(pick.link);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick]);

  if (!open) return null;

  const selectedLead = lead ?? leads.find((l) => l.id === leadId) ?? null;

  async function handleSave() {
    if (!pick) {
      setError("Escolha um horário livre na agenda do closer.");
      return;
    }
    setSaving(true);
    setError(null);

    if (remarcando && reschedule) {
      const res = await rescheduleMeeting({
        meeting: reschedule,
        scheduled_at: pick.start,
        duration_min: pick.durationMin,
        closer_id: pick.closerId,
        closer_name: pick.closerName,
        by: currentUser?.name ?? null,
        lead_bitrix_id: reschedule.lead?.bitrix_id,
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      notifySuccess("Reunião remarcada — a atividade de confirmação foi movida junto.");
      onSaved(res.meeting);
      onClose();
      return;
    }

    if (!leadId) {
      setError("Selecione o lead da reunião.");
      setSaving(false);
      return;
    }

    const res = await createMeeting({
      lead_id: leadId,
      lead_name: selectedLead?.full_name ?? null,
      lead_bitrix_id: selectedLead?.bitrix_id ?? null,
      lead_email: selectedLead?.email ?? null,
      cadence_id: selectedLead?.cadence_id ?? null,
      owner_id: currentUser?.id ?? null,
      owner_name: currentUser?.name ?? null,
      closer_id: pick.closerId,
      closer_name: pick.closerName,
      title: title || `Reunião — ${selectedLead?.full_name ?? "cliente"}`,
      scheduled_at: pick.start,
      duration_min: pick.durationMin,
      location: link.trim() ? "Online" : null,
      meeting_link: link,
      notes,
    });

    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      if (res.conflict) setPick(null); // força escolher outro horário
      return;
    }
    notifySuccess(`Reunião agendada com ${pick.closerName}. A atividade de confirmação já está na sua fila.`);
    onSaved(res.meeting);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !saving && onClose()} />
      <div className="relative bg-white rounded-xl border border-gray-100 w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              {remarcando ? "Remarcar reunião" : "Agendar reunião"}
            </h2>
            <p className="text-xs text-gray-500">
              {remarcando
                ? "O novo horário substitui o atual e a confirmação é reposicionada."
                : "Só aparecem horários realmente livres na agenda do closer."}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Lead */}
          {remarcando ? (
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
              <p className="text-xs text-gray-500">Lead</p>
              <p className="text-sm font-semibold text-gray-800">
                {reschedule?.lead_name ?? reschedule?.lead?.full_name ?? "—"}
              </p>
            </div>
          ) : lead ? (
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
              <p className="text-xs text-gray-500">Lead</p>
              <p className="text-sm font-semibold text-gray-800">{leadLabel(lead)}</p>
            </div>
          ) : (
            <div className="relative">
              <label className={labelClass}>Lead</label>
              <input
                type="text"
                value={leadSearch}
                onChange={(e) => { setLeadSearch(e.target.value); setLeadId(""); setLeadListOpen(true); }}
                onFocus={() => setLeadListOpen(true)}
                onBlur={() => setTimeout(() => setLeadListOpen(false), 150)}
                placeholder="Digite o nome, empresa ou telefone do lead..."
                className={inputClass}
                autoComplete="off"
              />
              {leadListOpen && leadSearch && !leadId && (() => {
                const q = leadSearch.toLowerCase();
                const matches = leads.filter(
                  (l) =>
                    l.full_name?.toLowerCase().includes(q) ||
                    l.company_name?.toLowerCase().includes(q) ||
                    l.email?.toLowerCase().includes(q) ||
                    l.phone?.includes(leadSearch)
                );
                return (
                  <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {matches.slice(0, 10).map((l) => (
                      <button
                        type="button"
                        key={l.id}
                        onClick={() => { setLeadId(l.id); setLeadSearch(leadLabel(l)); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                      >
                        <span className="font-medium text-gray-900">{l.full_name || "Sem nome"}</span>
                        {l.company_name && <span className="text-gray-400"> · {l.company_name}</span>}
                      </button>
                    ))}
                    {matches.length === 0 && (
                      <p className="px-3 py-2 text-xs text-gray-400">Nenhum lead encontrado.</p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Closer + horário */}
          <SlotPicker
            value={pick}
            onChange={setPick}
            ignoreMeetingId={reschedule?.id}
            initialCloserId={initialCloserId ?? reschedule?.closer_id ?? null}
            initialDate={initialDate ?? (reschedule ? new Date(reschedule.scheduled_at) : null)}
            allowManual={isManager}
          />

          {!remarcando && (
            <>
              <div>
                <label className={labelClass}>Título</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`Reunião — ${selectedLead?.full_name ?? "cliente"}`}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Link da reunião</label>
                <input
                  type="text"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://meet.google.com/..."
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Anotações</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Contexto pro closer: dor do cliente, orçamento, destino de interesse..."
                  className={`${inputClass} resize-none`}
                />
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !pick || (!remarcando && !leadId)}
            className="px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-semibold text-white hover:bg-[#0139D6] disabled:opacity-50"
          >
            {saving ? "Salvando..." : remarcando ? "Remarcar" : "Agendar"}
          </button>
        </div>
      </div>
    </div>
  );
}
