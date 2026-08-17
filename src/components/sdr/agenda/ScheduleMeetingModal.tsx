// src/components/sdr/agenda/ScheduleMeetingModal.tsx
// -----------------------------------------------------------------------------
// O modal de agendar / remarcar. Casca em volta do SlotPicker: escolhe o lead,
// dá título e anotações, e grava pelo serviço central (lib/qs/meetings.ts) — que
// é quem cria a atividade de confirmação e avisa o Bitrix.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { notifySuccess, notifyError } from "@/lib/qs/notify";
import { createMeeting, reagendarReuniao, gerarSalaMeet, salvarEmailDoLead, avisarBitrixDaSala, transferirLeadProCloser } from "@/lib/qs/meetings";
import SlotPicker, { type SlotSelection } from "./SlotPicker";
import type { Lead, Meeting } from "../types";

/** Barra grosseiramente o que nem chega a parecer e-mail (o Google recusa o resto). */
function emailValido(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

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
  // E-mail pra onde vai o convite do Google. Vem do cadastro quando existe; o
  // SDR completa quando não — e o que ele digitar volta pro cadastro do lead.
  const [email, setEmail] = useState("");
  // Sala do Meet criada automaticamente. Desligar libera o campo de link manual
  // (reunião por Zoom/Teams, ou a sala fixa do especialista).
  const [gerarMeet, setGerarMeet] = useState(true);
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
    setEmail(lead?.email ?? "");
    setGerarMeet(true);
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

  // O link da sala do closer entra sozinho quando o SDR não digitou nada — mas
  // só no modo manual: com a sala automática ligada, quem manda é o Meet novo.
  useEffect(() => {
    if (!gerarMeet && pick?.link && !link.trim()) setLink(pick.link);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick, gerarMeet]);

  const selectedLead = lead ?? leads.find((l) => l.id === leadId) ?? null;

  // Escolheu o lead na lista: o e-mail do cadastro entra sozinho. Só preenche
  // campo vazio — não apaga o que o SDR já tiver digitado.
  useEffect(() => {
    if (selectedLead?.email && !email.trim()) setEmail(selectedLead.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLead?.id]);

  if (!open) return null;

  async function handleSave() {
    if (!pick) {
      setError("Escolha um horário livre na agenda do closer.");
      return;
    }
    setSaving(true);
    setError(null);

    if (remarcando && reschedule) {
      // Reagendar NÃO move mais a mesma linha: nasce uma reunião nova apontando
      // pra antiga (reagendado_de). É o que separa reagendamento de no-show na
      // métrica e o que permite contar quantas vezes o lead remarcou.
      const res = await reagendarReuniao({
        meeting: reschedule,
        scheduledAt: pick.start,
        durationMin: pick.durationMin,
        closerId: pick.closerId,
        closerNome: pick.closerName,
        por: currentUser?.name ?? null,
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      notifySuccess("Reunião reagendada — a antiga fica no histórico e o convite do Google mudou de horário.");
      onSaved(res.meeting);
      onClose();
      return;
    }

    if (!leadId) {
      setError("Selecione o lead da reunião.");
      setSaving(false);
      return;
    }

    const emailLimpo = email.trim();
    if (emailLimpo && !emailValido(emailLimpo)) {
      setError("O e-mail do lead não parece válido — o Google recusaria o convite.");
      setSaving(false);
      return;
    }

    const res = await createMeeting({
      lead_id: leadId,
      lead_name: selectedLead?.full_name ?? null,
      lead_bitrix_id: selectedLead?.bitrix_id ?? null,
      lead_email: emailLimpo || selectedLead?.email || null,
      cadence_id: selectedLead?.cadence_id ?? null,
      owner_id: currentUser?.id ?? null,
      owner_name: currentUser?.name ?? null,
      closer_id: pick.closerId,
      closer_name: pick.closerName,
      title: title || `Reunião — ${selectedLead?.full_name ?? "cliente"}`,
      scheduled_at: pick.start,
      duration_min: pick.durationMin,
      location: gerarMeet ? "Google Meet" : link.trim() ? "Online" : null,
      meeting_link: gerarMeet ? null : link,
      notes,
    });

    if (!res.ok) {
      setSaving(false);
      setError(res.error);
      if (res.conflict) setPick(null); // força escolher outro horário
      return;
    }

    // Daqui pra baixo a reunião JÁ está gravada: nada pode virar "não agendou".
    // O e-mail volta pro cadastro do lead pra vir pronto no próximo agendamento.
    if (emailLimpo && emailLimpo !== selectedLead?.email) {
      void salvarEmailDoLead(leadId, emailLimpo);
    }

    const sala = await gerarSalaMeet(res.meeting, { linkManual: gerarMeet ? null : link });
    setSaving(false);

    // O primeiro aviso ao Bitrix saiu antes de a sala existir; este completa o
    // card com o link.
    if (sala.link) {
      avisarBitrixDaSala(res.meeting, {
        bitrix_id: selectedLead?.bitrix_id,
        lead_name: selectedLead?.full_name,
        link: sala.link,
      });
    }

    if (sala.aviso) notifyError(sala.aviso);

    // Agendou → o lead (e a conversa de WhatsApp dele) passa pro especialista.
    // POR ÚLTIMO de propósito: depois da transferência o SDR perde a posse e a
    // RLS recusaria qualquer gravação dele neste lead.
    await transferirLeadProCloser(leadId, pick.closerId, pick.closerName);

    notifySuccess(
      sala.link
        ? `Reunião agendada com ${pick.closerName} e sala do Meet criada${emailLimpo ? " — convite enviado ao cliente" : ""}.`
        : `Reunião agendada com ${pick.closerName}. A atividade de confirmação já está na sua fila.`
    );
    onSaved(sala.link ? { ...res.meeting, meeting_link: sala.link } : res.meeting);
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

              {/* Confirmação de que o lead veio mesmo da base — e o que ela já
                  sabe sobre ele. Sem isto, digitar um nome parecido e não
                  selecionar da lista parecia ter funcionado. */}
              {selectedLead && (
                <div className="mt-1.5 flex items-start gap-2 rounded-lg bg-green-50 border border-green-100 px-2.5 py-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                       strokeLinecap="round" strokeLinejoin="round" className="text-green-600 mt-0.5 shrink-0">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <p className="text-[11px] text-green-800 leading-relaxed min-w-0">
                    Lead do QS
                    {selectedLead.phone && <> · {selectedLead.phone}</>}
                    {selectedLead.email
                      ? <> · e-mail no cadastro</>
                      : <> · <span className="font-semibold">sem e-mail cadastrado</span>, preencha abaixo</>}
                  </p>
                </div>
              )}
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
              {/* E-mail do cliente: é pra ELE que o Google manda o convite com o
                  link. Sem e-mail a reunião acontece igual, mas o cliente só
                  recebe o link se o SDR mandar no WhatsApp. */}
              <div>
                <label className={labelClass}>
                  E-mail do lead {selectedLead?.email && <span className="text-green-600 font-normal">· veio do cadastro</span>}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cliente@email.com"
                  className={inputClass}
                  autoComplete="off"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  {email.trim()
                    ? "O convite do Google com o link vai pra este e-mail (e fica salvo no lead)."
                    : "Sem e-mail o convite não é enviado — a sala é criada e o link fica aqui pra você mandar no WhatsApp."}
                </p>
              </div>

              <div>
                <label className={labelClass}>Produto — o que é a reunião</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Expedição Itália, Pacote Japão/China/Coreia…"
                  list="produtos-frequentes"
                  className={inputClass}
                />
                {/* Sugestões que espelham o que o comercial já escreve no campo
                    "Produto (Descritivo da Reunião)" do Bitrix. É datalist, não
                    select: o destino é texto livre e destino novo tem que caber. */}
                <datalist id="produtos-frequentes">
                  <option value="Expedição " />
                  <option value="Pacote " />
                  <option value="Personalizado " />
                  <option value="Passagem aérea " />
                  <option value="Concierge " />
                </datalist>
                <p className="text-[11px] text-gray-400 mt-1">
                  Vai pro card do Bitrix e pro convite do Google — é o que o especialista
                  lê pra saber do que se trata antes de entrar na reunião.
                </p>
              </div>

              {/* Sala do Meet */}
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={gerarMeet}
                    onChange={(e) => setGerarMeet(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-[#0147FF]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-800">Criar sala do Google Meet</span>
                    <span className="block text-[11px] text-gray-500 mt-0.5">
                      O link é gerado ao agendar e o convite vai pro especialista e pro cliente.
                    </span>
                  </span>
                </label>
              </div>

              {!gerarMeet && (
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
              )}
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
