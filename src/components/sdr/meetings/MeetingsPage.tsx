import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth, podeExecutar } from "@/contexts/QsAuthContext";
import type { Meeting, MeetingStatus, Lead, SdrUser } from "../types";
import { MEETING_STATUS_LABELS } from "../types";
import { notifyBitrix } from "@/lib/qs/bitrixSync";
import { fetchAllRows } from "@/lib/qs/queries";
import { notifySuccess, notifyError } from "@/lib/qs/notify";
import { createMeeting, gerarSalaMeet, salvarEmailDoLead, avisarBitrixDaSala } from "@/lib/qs/meetings";
import { fetchClosers } from "@/lib/qs/closerAgenda";
import AgendaMes from "../agenda/AgendaMes";
import AgendaDia from "../agenda/AgendaDia";

// ── Helpers ──────────────────────────────────────────────────────────────────

// UUIDs válidos são exigidos por owner_id (uuid). O usuário "demo-skip" do
// bypass de login NÃO é um uuid, então nesse caso gravamos owner_id = null.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${mins}`;
}

function leadLabel(l: Lead): string {
  const name =
    l.full_name ||
    [l.first_name, l.last_name].filter(Boolean).join(" ") ||
    "Sem nome";
  return l.company_name ? `${name} — ${l.company_name}` : name;
}

/** Barra grosseiramente o que nem chega a parecer e-mail (o Google recusa o resto). */
function emailValido(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
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
  // Espectador (marketing) vê tudo e não muda nada. O banco recusa de verdade
  // (gatilho da 0036); aqui só evitamos oferecer botão que vai falhar.
  const executa = podeExecutar(currentUser?.role);

  // Duas visões da mesma coisa, unificadas numa aba só a pedido do Bruno:
  //   reunioes — a lista/CRUD daqui (filtros, busca, formulário)
  //   agenda   — o MÊS inteiro, na grade da Google Agenda (o dia abre num painel
  //              dentro dela mesma)
  const [view, setView] = useState<"reunioes" | "agenda">("reunioes");

  // Dia que a aba Reuniões mostra. Nasce nulo (= hoje) e só muda quando o
  // usuário clica num dia na Agenda do mês.
  const [diaReunioes, setDiaReunioes] = useState<Date | null>(null);

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  // Closers ativos: sem eles a reunião nasce sem dono de horário e some do
  // calendário da aba "Agenda" (organizado por closer).
  const [closers, setClosers] = useState<SdrUser[]>([]);
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
  // E-mail pra onde vai o convite do Google (e que volta pro cadastro do lead).
  const [fEmail, setFEmail] = useState("");
  // Sala do Meet criada automaticamente ao agendar. Desligar libera o link manual.
  const [fGerarMeet, setFGerarMeet] = useState(true);
  const [fNotes, setFNotes] = useState("");
  const [fStatus, setFStatus] = useState<MeetingStatus>("agendada");
  const [fCloserId, setFCloserId] = useState("");
  // Combobox de lead (item 5): texto digitado; fLeadId só é preenchido ao escolher.
  const [fLeadSearch, setFLeadSearch] = useState("");
  // Lista aberta só com o campo em foco — fecha ao clicar fora / tabular (senão a
  // lista de sugestões ficava flutuando por cima dos campos de baixo).
  const [leadListOpen, setLeadListOpen] = useState(false);

  const fetchMeetings = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_meetings")
      // FK explícita: desde a 0027 a qs_meetings tem DOIS vínculos com qs_users
      // (owner_id e closer_id) e o embed curto vira ambíguo — PostgREST devolve
      // PGRST201 e a tela inteira fica vazia. Mesmo remédio do LEAD_SELECT.
      .select("*, lead:qs_leads(*), owner:qs_users!qs_meetings_owner_id_fkey(*), closer:qs_users!qs_meetings_closer_id_fkey(id,name)")
      .order("scheduled_at", { ascending: false });
    if (error) {
      setPageError(`Erro ao buscar reuniões: ${error.message}`);
    } else {
      setPageError(null);
      setMeetings((data as Meeting[]) ?? []);
    }
  }, []);

  const fetchLeads = useCallback(async () => {
    // Paginado (13/08): a base passou de 1.000 (teto do PostgREST) — sem o
    // range, o combobox de agendar reunião não achava lead cujo nome ordena
    // depois do corte.
    try {
      const rows = await fetchAllRows<Lead>((from, to) =>
        supabase
          .from("qs_leads")
          .select("id, full_name, first_name, last_name, company_name, phone, email, owner_id, bitrix_id")
          .order("full_name", { ascending: true })
          .order("id")
          .range(from, to) as unknown as PromiseLike<{ data: Lead[] | null; error: { message?: string } | null }>
      );
      setLeads(rows);
    } catch (error) {
      setPageError(`Erro ao buscar leads: ${(error as { message?: string }).message ?? "desconhecido"}`);
    }
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      await Promise.all([fetchMeetings(), fetchLeads()]);
      setLoading(false);
    }
    load();
    void fetchClosers().then(setClosers);
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
    setFEmail("");
    setFGerarMeet(true);
    setFNotes("");
    setFStatus("agendada");
    setFCloserId("");
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
    const emailLimpo = fEmail.trim();
    if (emailLimpo && !emailValido(emailLimpo)) {
      setFormError("O e-mail do lead não parece válido — o Google recusaria o convite.");
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

    const closerName = closers.find((c) => c.id === fCloserId)?.name ?? null;

    const base = {
      lead_id: fLeadId,
      title: fTitle.trim() || null,
      scheduled_at: when.toISOString(),
      duration_min: duration,
      location: fLocation.trim() || null,
      meeting_link: fLink.trim() || null,
      notes: notesToSave || null,
      status: fStatus,
      closer_id: fCloserId || null,
      meeting_owner: closerName,
    };

    const ownerId =
      currentUser && UUID_RE.test(currentUser.id) ? currentUser.id : null;

    // ── CRIAÇÃO: nasce pelo serviço central (lib/qs/meetings.ts) ──────────────
    // É ele quem cria a atividade de confirmação e avisa o Bitrix — antes esta
    // tela fazia a sua própria versão disso, e agendar por aqui não gerava a
    // mesma coisa que agendar pela agenda ou pela página do lead.
    if (!editingId) {
      const novoLead = leads.find((l) => l.id === fLeadId);
      // Sala automática só faz sentido pra reunião que ainda vai acontecer:
      // lançamento retroativo (já realizada / no-show) não ganha evento.
      const querMeet = fGerarMeet && fStatus === "agendada";
      const res = await createMeeting({
        lead_id: fLeadId,
        lead_name: novoLead?.full_name ?? null,
        lead_bitrix_id: novoLead?.bitrix_id ?? null,
        lead_email: emailLimpo || novoLead?.email || null,
        owner_id: ownerId,
        owner_name: currentUser?.name ?? null,
        closer_id: fCloserId || null,
        closer_name: closerName,
        title: fTitle.trim() || null,
        scheduled_at: when,
        duration_min: duration,
        location: querMeet ? "Google Meet" : fLocation.trim() || null,
        meeting_link: querMeet ? null : fLink.trim() || null,
        notes: notesToSave || null,
        status: fStatus,
      });
      if (!res.ok) {
        setSaving(false);
        setFormError(res.error);
        return;
      }

      // Daqui pra baixo a reunião JÁ está gravada: nada pode virar "não salvou".
      // O e-mail volta pro cadastro do lead pra vir pronto no próximo agendamento.
      if (emailLimpo && emailLimpo !== novoLead?.email) {
        void salvarEmailDoLead(fLeadId, emailLimpo);
      }

      const sala = await gerarSalaMeet(res.meeting, { linkManual: querMeet ? null : fLink });
      setSaving(false);

      // O primeiro aviso ao Bitrix saiu antes de a sala existir; este completa
      // o card com o link.
      if (sala.link) {
        avisarBitrixDaSala(res.meeting, {
          bitrix_id: novoLead?.bitrix_id,
          lead_name: novoLead?.full_name,
          link: sala.link,
        });
      }

      if (sala.aviso) notifyError(sala.aviso);
      else if (sala.link) {
        notifySuccess(`Reunião agendada e sala do Meet criada${emailLimpo ? " — convite enviado ao cliente" : ""}.`);
      }

      // Criada já com desfecho (raro): registra o status também na timeline.
      if (fStatus !== "agendada") {
        notifyMeetingStatusToBitrix(
          { lead_id: fLeadId, scheduled_at: base.scheduled_at, title: base.title, lead: novoLead },
          fStatus
        );
      }
      closeModal();
      await fetchMeetings();
      return;
    }

    // ── EDIÇÃO ────────────────────────────────────────────────────────────────
    // owner_id não é sobrescrito (preserva o responsável original).
    // .select() MEDE o que o banco aceitou sob RLS: sem ele um write barrado volta
    // "sucesso" com 0 linhas e a tela mentiria pro usuário.
    let { data, error } = await supabase
      .from("qs_meetings")
      .update({ ...base, updated_at: new Date().toISOString() })
      .eq("id", editingId)
      .select();

    // 0027 ainda não aplicada (o deploy vem antes da migration): regrava sem a
    // coluna nova em vez de deixar o usuário sem conseguir salvar.
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      const { closer_id: _closer, ...legacy } = base;
      ({ data, error } = await supabase
        .from("qs_meetings")
        .update({ ...legacy, updated_at: new Date().toISOString() })
        .eq("id", editingId)
        .select());
    }

    if (error) {
      // 23P01 = trava anti-choque da 0027: o closer já tem reunião nesse horário.
      const choque =
        error.code === "23P01" || /qs_meetings_closer_no_overlap/i.test(error.message ?? "");
      setFormError(
        choque
          ? "O closer já tem outra reunião nesse horário. Escolha outro horário ou outro closer."
          : `Não foi possível salvar: ${error.message}`
      );
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
    // Se o status mudou pelo modal (ex.: marcada como realizada), registra na
    // timeline do Bitrix — mesmo efeito das ações rápidas.
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

    setSaving(false);
    closeModal();
    await fetchMeetings();
  }

  // ── Status quick actions / cancel ──
  // ── Excluir reunião (REMOVE a linha) ──
  // Distinto de "Cancelar" (que mantém o registro com status cancelada). Serve pra
  // reuniões criadas por engano/duplicadas. Reuniões "realizada" têm valor histórico
  // (aconteceram de fato), então a exclusão só é oferecida em não-realizada.
  // Alternador Reuniões ⇄ Agenda — reaproveitado nas saídas (agenda, loading,
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

  // Aba "Agenda": o mês inteiro na grade da Google Agenda. Clicar num dia abre o
  // painel daquele dia dentro dela mesma.
  if (view === "agenda") {
    return (
      <div className="space-y-4" style={{ fontFamily: "inherit" }}>
        {viewToggle}
        <AgendaMes onOpenLead={onOpenLead} onAbrirDia={(d) => { setDiaReunioes(d); setView("reunioes"); }} />
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
        {executa && <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg bg-[#0147FF] hover:bg-[#0139D6] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Agendar Reunião
        </button>}
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

      {/* A aba Reuniões é O DIA, uma coluna por especialista — o que cada um
          tem HOJE, em vez de uma tabela com o histórico inteiro. A lista com
          filtro por status saiu a pedido do Bruno; quem quer o mês vai na aba
          Agenda. O botão "Agendar Reunião" acima CONTINUA aqui de propósito: o
          agendamento por slot depende de closer cadastrado, e hoje não há
          nenhum no banco — sem este formulário não haveria como criar reunião. */}
      <AgendaDia onOpenLead={onOpenLead} dataInicial={diaReunioes} />

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
                          onClick={() => {
                            setFLeadId(l.id);
                            setFLeadSearch(leadLabel(l));
                            // E-mail do cadastro entra sozinho; só preenche campo
                            // vazio pra não apagar o que o SDR já digitou.
                            if (l.email && !fEmail.trim()) setFEmail(l.email);
                          }}
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

                {/* Confirmação de que o lead veio mesmo da base — e o que ela já
                    sabe sobre ele. Sem isto, digitar um nome parecido e não
                    escolher da lista parecia ter funcionado. */}
                {(() => {
                  const sel = leads.find((l) => l.id === fLeadId);
                  if (!sel) return null;
                  return (
                    <div className="mt-1.5 flex items-start gap-2 rounded-lg bg-green-50 border border-green-100 px-2.5 py-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                           strokeLinecap="round" strokeLinejoin="round" className="text-green-600 mt-0.5 shrink-0">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <p className="text-[11px] text-green-800 leading-relaxed min-w-0">
                        Lead do QS
                        {sel.phone && <> · {sel.phone}</>}
                        {sel.email
                          ? <> · e-mail no cadastro</>
                          : <> · <span className="font-semibold">sem e-mail cadastrado</span>, preencha abaixo</>}
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* E-mail do cliente: é pra ELE que o Google manda o convite com o
                  link da sala. Sem e-mail a reunião acontece igual, mas o link
                  só chega se o SDR mandar no WhatsApp. */}
              <div>
                <label className={labelClass}>
                  E-mail do lead{" "}
                  {leads.find((l) => l.id === fLeadId)?.email && (
                    <span className="text-green-600 font-normal">· veio do cadastro</span>
                  )}
                </label>
                <input
                  type="email"
                  value={fEmail}
                  onChange={(e) => setFEmail(e.target.value)}
                  placeholder="cliente@email.com"
                  className={inputClass}
                  autoComplete="off"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  {fEmail.trim()
                    ? "O convite do Google com o link vai pra este e-mail (e fica salvo no lead)."
                    : "Sem e-mail o convite não é enviado — a sala é criada e o link fica na reunião pra você mandar."}
                </p>
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
                <p className="mt-1 text-[11px] text-gray-400">
                  É o nome que aparece no convite do Google e na agenda do especialista.
                </p>
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
                <label className={labelClass}>Closer responsável</label>
                <select
                  value={fCloserId}
                  onChange={(e) => setFCloserId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Sem closer definido</option>
                  {closers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-gray-400">
                  Sem closer, a reunião não aparece na agenda dele nem reserva o horário.
                  Para escolher entre os horários livres, use a aba <b>Agenda</b>.
                </p>
              </div>

              {/* Sala do Meet — só pra reunião que ainda vai acontecer.
                  Lançamento retroativo (já realizada) não cria evento. */}
              {fStatus === "agendada" && (
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fGerarMeet}
                      onChange={(e) => setFGerarMeet(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-[#0147FF]"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-800">Criar sala do Google Meet</span>
                      <span className="block text-[11px] text-gray-500 mt-0.5">
                        O link é gerado ao salvar e o convite vai pro especialista e pro cliente.
                      </span>
                    </span>
                  </label>
                </div>
              )}

              {!(fGerarMeet && fStatus === "agendada") && (
                <>
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
                </>
              )}

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
