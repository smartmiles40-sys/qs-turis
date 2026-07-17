import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { notifyBitrix } from "@/lib/qs/bitrixSync";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import {
  createCadenceTasks,
  closeOpenCadenceTasks,
  updateQsLead,
  deleteQsLead,
  updateQsNote,
  deleteQsNote,
  createQsContact,
  updateQsContact,
  deleteQsContact,
  updateQsMeeting,
} from "@/lib/qs/queries";
import { getLeadScore } from "@/lib/leadScore";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import WhatsAppModal from "@/components/sdr/whatsapp/WhatsAppModal";
import type {
  Lead,
  LeadStatus,
  LeadSource,
  SdrUser,
  Cadence,
  CadenceDay,
  Note,
  Contact,
  Meeting,
  MeetingStatus,
  Task,
  CustomField,
  CustomFieldScope,
  LeadCustomValue,
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
  | "historico"
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
  ligacao_whatsapp: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z" />
      <path d="M14.7 13.4c-.25-.13-1.02-.5-1.18-.56-.16-.06-.27-.09-.39.09-.11.17-.44.55-.54.66-.1.12-.2.13-.37.05-.17-.09-.72-.27-1.37-.85-.5-.45-.85-1.01-.95-1.18-.1-.17-.01-.26.08-.35.08-.08.17-.2.26-.3.09-.11.11-.18.17-.3.06-.11.03-.21-.01-.3-.05-.09-.39-.93-.53-1.28-.14-.33-.28-.29-.39-.29h-.33c-.11 0-.3.04-.45.21-.16.17-.6.58-.6 1.42s.61 1.65.7 1.76c.09.12 1.2 1.84 2.92 2.58.41.18.72.28.97.36.41.13.78.11 1.07.07.33-.05 1.02-.42 1.16-.82.14-.4.14-.74.1-.82-.04-.07-.15-.11-.32-.19z" fill="currentColor" stroke="none" />
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

// ── Contatos (qs_contacts: type + value + is_primary) ───────────────────────

const CONTACT_TYPE_LABELS: Record<string, string> = {
  phone: "Telefone",
  email: "E-mail",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
};

// ── Temperatura (lead_score editável pelo SDR) ──────────────────────────────
// Gravamos o rótulo PT cru — o mesmo formato que vem do Bitrix; getLeadScore
// (normalizeTemperature) entende os dois lados.

const TEMPERATURE_OPTIONS: { label: string; color: string }[] = [
  { label: "Quente", color: "#E5484D" },
  { label: "Morno", color: "#E8920B" },
  { label: "Frio", color: "#2563EB" },
];

// ── Espelho do desfecho da reunião no Bitrix ─────────────────────────────────
// Mesma lógica do helper da MeetingsPage: o sync só conhece os eventos
// perdido|ganho|reuniao|nota (whitelist do /api/bitrix-sync e do n8n), então o
// desfecho (realizada/no-show/cancelada) vira comentário "nota" na timeline,
// sem mover coluna. Fire-and-forget — sem bitrix_id o notifyBitrix pula sozinho.
function notifyMeetingStatusToBitrix(
  meeting: Pick<Meeting, "lead_id" | "scheduled_at" | "title">,
  bitrixId: string | null | undefined,
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
    bitrix_id: bitrixId,
    body: `Reunião de ${formatDateTime(meeting.scheduled_at)}${meeting.title ? ` (${meeting.title})` : ""} ${phrase} no QS.`,
  });
}

// ── Editar lead (modal do header) ────────────────────────────────────────────

interface LeadEditForm {
  full_name: string;
  phone: string;
  email: string;
  company_name: string;
  job_title: string;
  department: string;
  source: LeadSource;
  city: string;
  state: string;
  estimated_value: string;
  company_linkedin: string;
  company_size: string;
}

function leadToEditForm(lead: Lead): LeadEditForm {
  return {
    full_name: lead.full_name ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    company_name: lead.company_name ?? "",
    job_title: lead.job_title ?? "",
    department: lead.department ?? "",
    source: lead.source,
    city: lead.city ?? "",
    state: lead.state ?? "",
    estimated_value: lead.estimated_value != null ? String(lead.estimated_value) : "",
    company_linkedin: lead.company_linkedin ?? "",
    company_size: lead.company_size ?? "",
  };
}

// Aceita "1.500,50", "1500.50" e "1500" — devolve null pra vazio e NaN pra inválido.
function parseMoney(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const normalized = s.replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  return Number(normalized);
}

// ── Meeting form (Agendar Reunião) ───────────────────────────────────────────

interface MeetingForm {
  title: string;
  scheduled_at: string; // datetime-local value
  duration_min: string;
  location: string;
  meeting_link: string;
  notes: string;
}

const EMPTY_MEETING_FORM: MeetingForm = {
  title: "",
  scheduled_at: "",
  duration_min: "30",
  location: "",
  meeting_link: "",
  notes: "",
};

// ── Custom fields ────────────────────────────────────────────────────────────

const SCOPE_LABELS: Record<CustomFieldScope, string> = {
  pessoal: "Pessoal",
  empresa: "Empresa",
  contato: "Contato",
};

const SCOPE_ORDER: CustomFieldScope[] = ["pessoal", "empresa", "contato"];

// ── Tabs Definition ──────────────────────────────────────────────────────────

const TABS: TabItem[] = [
  { key: "historico", label: "Histórico" },
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
  const { currentUser } = useQsAuth();
  const [activeTab, setActiveTab] = useState<TabKey>("historico");
  const [newNote, setNewNote] = useState("");
  const [showHandoverModal, setShowHandoverModal] = useState(false);
  const [selectedCloser, setSelectedCloser] = useState("");
  const [handoverSuccess, setHandoverSuccess] = useState(false);
  const [showReEngagement, setShowReEngagement] = useState(false);
  const [reEngagementScheduled, setReEngagementScheduled] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [lossReasons, setLossReasons] = useState<{ id: string; label: string }[]>([]);
  const [selectedLossReason, setSelectedLossReason] = useState("");

  // ── Agendar Reunião (Task 1) ──
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [meetingForm, setMeetingForm] = useState<MeetingForm>(EMPTY_MEETING_FORM);
  const [savingMeeting, setSavingMeeting] = useState(false);
  const [meetingError, setMeetingError] = useState<string | null>(null);

  // ── Campos Personalizados (Task 2) ──
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [savingCustom, setSavingCustom] = useState(false);
  const [customSaved, setCustomSaved] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  // ── WhatsApp (Task 3) ──
  const [showWhatsApp, setShowWhatsApp] = useState(false);

  // ── Sprint 4 (A1): editar/excluir lead, notas, contatos, reuniões etc. ──
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [savingNote, setSavingNote] = useState(false);
  const [savingHandover, setSavingHandover] = useState(false);
  const [schedulingReContact, setSchedulingReContact] = useState(false);
  const [bitrixCopied, setBitrixCopied] = useState(false);
  const [showScoreMenu, setShowScoreMenu] = useState(false);
  const [savingScore, setSavingScore] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<LeadEditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingLead, setDeletingLead] = useState(false);
  const [showWonModal, setShowWonModal] = useState(false);
  const [wonValue, setWonValue] = useState("");
  const [wonError, setWonError] = useState<string | null>(null);
  const [savingWon, setSavingWon] = useState(false);
  const [removingCadence, setRemovingCadence] = useState(false);
  const [noteMenuId, setNoteMenuId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteBody, setEditingNoteBody] = useState("");
  const [savingNoteEdit, setSavingNoteEdit] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactEditingId, setContactEditingId] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState({ type: "phone", value: "", is_primary: false });
  const [savingContact, setSavingContact] = useState(false);
  const [updatingMeetingId, setUpdatingMeetingId] = useState<string | null>(null);

  // ── Data state ──
  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cadence, setCadence] = useState<Cadence | null>(null);
  const [cadenceDays, setCadenceDays] = useState<CadenceDay[]>([]);
  const [closers, setClosers] = useState<SdrUser[]>([]);
  const [allUsers, setAllUsers] = useState<SdrUser[]>([]);
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
      // PGRST116 = zero linhas no .single() → o lead realmente não existe (ou a
      // RLS escondeu). Qualquer OUTRO erro é falha de rede/servidor e não pode
      // virar "Lead não encontrado" — vira estado de erro com "Tentar de novo".
      if ((error as { code?: string }).code !== "PGRST116") {
        setLoadError(error.message || "Falha de conexão ao buscar o lead.");
      }
      return null;
    }
    setLead(data as Lead);
    return data as Lead;
  }, [leadId]);

  // ── Reload tasks (Sprint 4: "Próximas atividades" precisa refletir remoções) ──
  const reloadTasks = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_tasks")
      .select("*")
      .eq("lead_id", leadId)
      .order("scheduled_at", { ascending: true });
    if (error) {
      console.warn("Erro ao recarregar tasks:", error);
      return;
    }
    setTasks((data as Task[]) ?? []);
  }, [leadId]);

  // ── Reload meetings (Task 1) ──
  const reloadMeetings = useCallback(async () => {
    const { data, error } = await supabase
      .from("qs_meetings")
      .select("*, lead:qs_leads(*)")
      .eq("lead_id", leadId)
      .order("scheduled_at", { ascending: false });
    if (error) {
      console.warn("Erro ao recarregar reuniões:", error);
      return;
    }
    setMeetings((data as Meeting[]) ?? []);
  }, [leadId]);

  // ── Reload custom fields + values (Task 2) ──
  const reloadCustomFields = useCallback(async () => {
    const [fieldsRes, valuesRes] = await Promise.all([
      supabase.from("qs_custom_fields").select("*").eq("is_archived", false),
      supabase.from("qs_lead_custom_values").select("*").eq("lead_id", leadId),
    ]);

    if (fieldsRes.error) console.warn("Erro ao buscar campos personalizados:", fieldsRes.error);
    else setCustomFields((fieldsRes.data as CustomField[]) ?? []);

    if (valuesRes.error) console.warn("Erro ao buscar valores personalizados:", valuesRes.error);
    else {
      const map: Record<string, string> = {};
      for (const v of (valuesRes.data as LeadCustomValue[]) ?? []) {
        map[v.custom_field_id] = v.value ?? "";
      }
      setCustomValues(map);
    }
  }, [leadId]);

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      setLoadError(null);
      const leadData = await fetchLead();
      await reloadCustomFields();

      const [notesRes, contactsRes, meetingsRes, tasksRes, closersRes] = await Promise.all([
        supabase.from("qs_notes").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
        supabase.from("qs_contacts").select("*").eq("lead_id", leadId),
        supabase.from("qs_meetings").select("*, lead:qs_leads(*)").eq("lead_id", leadId).order("scheduled_at", { ascending: false }),
        supabase.from("qs_tasks").select("*").eq("lead_id", leadId).order("scheduled_at", { ascending: true }),
        supabase.from("qs_users").select("*"),
      ]);

      if (notesRes.error) console.warn("Erro ao buscar notes:", notesRes.error);
      else setNotes((notesRes.data as Note[]) ?? []);

      if (contactsRes.error) console.warn("Erro ao buscar contacts:", contactsRes.error);
      else setContacts((contactsRes.data as Contact[]) ?? []);

      if (meetingsRes.error) console.warn("Erro ao buscar meetings:", meetingsRes.error);
      else setMeetings((meetingsRes.data as Meeting[]) ?? []);

      if (tasksRes.error) console.warn("Erro ao buscar tasks:", tasksRes.error);
      else setTasks((tasksRes.data as Task[]) ?? []);

      if (closersRes.error) console.warn("Erro ao buscar usuários:", closersRes.error);
      else {
        const usersList = (closersRes.data as SdrUser[]) ?? [];
        setAllUsers(usersList); // usado pra exibir o autor real das anotações
        const closersList = usersList.filter((u) => u.role === "closer" && u.is_active);
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
  }, [leadId, fetchLead, reloadCustomFields, retryTick]);

  // ── Add note ──
  async function addNote() {
    // Guarda de duplo clique/Enter+clique: sem ela, dois inserts iguais entravam.
    if (!newNote.trim() || !lead || savingNote) return;
    setSavingNote(true);
    try {
      const { data, error } = await supabase
        .from("qs_notes")
        .insert({ lead_id: lead.id, author_id: currentUser?.id ?? lead.owner_id, body: newNote.trim() })
        .select()
        .single();
      if (error) {
        console.warn("Erro ao adicionar nota:", error);
        notifyError("Não foi possível salvar a anotação — tente novamente.");
        return;
      }
      // Espelha a nota como comentário na timeline do negócio no Bitrix.
      notifyBitrix("nota", {
        lead_id: lead.id,
        bitrix_id: lead.bitrix_id,
        body: newNote.trim(),
      });
      setNotes([data as Note, ...notes]);
      setNewNote("");
    } finally {
      setSavingNote(false);
    }
  }

  // ── Edit/delete note (Sprint 4) ──
  function startEditNote(note: Note) {
    setEditingNoteId(note.id);
    setEditingNoteBody(note.body);
  }

  async function saveNoteEdit() {
    if (!editingNoteId || !editingNoteBody.trim() || savingNoteEdit) return;
    setSavingNoteEdit(true);
    try {
      const updated = await updateQsNote(editingNoteId, editingNoteBody.trim());
      if (!updated) return; // updateQsNote já avisou por toast
      setNotes(notes.map((n) => (n.id === updated.id ? updated : n)));
      setEditingNoteId(null);
      setEditingNoteBody("");
    } finally {
      setSavingNoteEdit(false);
    }
  }

  async function handleDeleteNote(note: Note) {
    if (!window.confirm("Excluir esta anotação? Ela sai do histórico do lead e não dá pra desfazer.")) return;
    const ok = await deleteQsNote(note.id);
    if (!ok) return; // deleteQsNote já avisou por toast
    setNotes(notes.filter((n) => n.id !== note.id));
    if (editingNoteId === note.id) {
      setEditingNoteId(null);
      setEditingNoteBody("");
    }
  }

  // ── Contacts CRUD (Sprint 4 — primeiro caminho de escrita de qs_contacts) ──
  function openContactCreate() {
    setContactEditingId(null);
    setContactForm({ type: "phone", value: "", is_primary: false });
    setShowContactForm(true);
  }

  function openContactEdit(contact: Contact) {
    setContactEditingId(contact.id);
    setContactForm({ type: contact.type, value: contact.value, is_primary: contact.is_primary });
    setShowContactForm(true);
  }

  async function saveContact() {
    if (!lead || savingContact) return;
    if (!contactForm.value.trim()) {
      notifyError("Informe o telefone/e-mail/perfil do contato.");
      return;
    }
    setSavingContact(true);
    try {
      if (contactEditingId) {
        const updated = await updateQsContact(contactEditingId, {
          type: contactForm.type,
          value: contactForm.value.trim(),
          is_primary: contactForm.is_primary,
        });
        if (!updated) return; // camada já avisou
        setContacts(contacts.map((c) => (c.id === updated.id ? updated : c)));
      } else {
        const created = await createQsContact({
          lead_id: lead.id,
          type: contactForm.type,
          value: contactForm.value.trim(),
          is_primary: contactForm.is_primary,
        });
        if (!created) return; // camada já avisou
        setContacts([...contacts, created]);
      }
      setShowContactForm(false);
      setContactEditingId(null);
      setContactForm({ type: "phone", value: "", is_primary: false });
    } finally {
      setSavingContact(false);
    }
  }

  async function handleDeleteContact(contact: Contact) {
    if (!window.confirm(`Excluir o contato ${contact.value}?`)) return;
    const ok = await deleteQsContact(contact.id);
    if (!ok) return; // camada já avisou
    setContacts(contacts.filter((c) => c.id !== contact.id));
    if (contactEditingId === contact.id) {
      setShowContactForm(false);
      setContactEditingId(null);
    }
  }

  // ── Temperatura editável (Sprint 4) ──
  // O badge deixa de ser só reflexo do Bitrix: o SDR classifica Quente/Morno/Frio.
  async function setTemperature(label: string | null) {
    if (!lead || savingScore) return;
    setSavingScore(true);
    try {
      const updated = await updateQsLead(lead.id, { lead_score: label });
      if (!updated) return; // updateQsLead já avisou por toast
      setLead(updated);
      notifySuccess(label ? `Temperatura atualizada: ${label}.` : "Temperatura removida.");
      setShowScoreMenu(false);
    } finally {
      setSavingScore(false);
    }
  }

  // ── Editar lead (Sprint 4 — o maior buraco do app) ──
  function openEditModal() {
    if (!lead) return;
    setEditForm(leadToEditForm(lead));
    setEditError(null);
    setShowEditModal(true);
  }

  async function saveLeadEdit() {
    if (!lead || !editForm || savingEdit) return;
    const fullName = editForm.full_name.trim();
    if (!fullName) {
      setEditError("O nome do lead não pode ficar vazio.");
      return;
    }
    const estimated = parseMoney(editForm.estimated_value);
    if (estimated !== null && (Number.isNaN(estimated) || estimated < 0)) {
      setEditError("Valor estimado inválido — use números (ex.: 1500 ou 1.500,50).");
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    try {
      const payload: Partial<Lead> = {
        full_name: fullName,
        phone: editForm.phone.trim() || null,
        email: editForm.email.trim() || null,
        company_name: editForm.company_name.trim() || null,
        job_title: editForm.job_title.trim() || null,
        department: editForm.department.trim() || null,
        source: editForm.source,
        city: editForm.city.trim() || null,
        state: editForm.state.trim() || null,
        estimated_value: estimated,
        company_linkedin: editForm.company_linkedin.trim() || null,
        company_size: editForm.company_size.trim() || null,
      };
      // Mantém first/last coerentes com o nome exibido (iniciais do avatar) —
      // só quando o nome realmente mudou, pra não sobrescrever dados do Bitrix.
      if (fullName !== (lead.full_name ?? "")) {
        const parts = fullName.split(/\s+/);
        payload.first_name = parts[0] ?? null;
        payload.last_name = parts.length > 1 ? parts.slice(1).join(" ") : null;
      }
      const updated = await updateQsLead(lead.id, payload);
      if (!updated) return; // updateQsLead já avisou por toast (e mediu o efeito)
      setLead(updated);
      setShowEditModal(false);
      notifySuccess("Lead atualizado.");
    } finally {
      setSavingEdit(false);
    }
  }

  // ── Excluir lead no detalhe (Sprint 4 — só gestor/admin, cascade forte) ──
  async function handleDeleteLead() {
    if (!lead || deletingLead) return;
    const ok = window.confirm(
      `EXCLUIR o lead ${lead.full_name ?? "sem nome"}?\n\n` +
        "Isso apaga DEFINITIVAMENTE o lead e, em cascata, todo o histórico: " +
        "anotações, atividades, reuniões, contatos e handovers. Não dá pra desfazer.\n\n" +
        "Se a intenção é só tirar da fila, prefira marcar como Perdido."
    );
    if (!ok) return;
    setDeletingLead(true);
    try {
      const deleted = await deleteQsLead(lead.id); // camada mede RLS e avisa em falha
      if (!deleted) return;
      notifySuccess("Lead excluído.");
      onBack();
    } finally {
      setDeletingLead(false);
    }
  }

  // ── Remover da cadência (Sprint 4) ──
  async function removeFromCadence() {
    if (!lead || !lead.cadence_id || removingCadence) return;
    const ok = window.confirm(
      `Remover ${lead.full_name ?? "este lead"} da cadência${cadence?.name ? ` "${cadence.name}"` : ""}?\n\n` +
        "As atividades ABERTAS do plano serão encerradas (as extras e as já concluídas ficam)."
    );
    if (!ok) return;
    setRemovingCadence(true);
    try {
      const updated = await updateQsLead(lead.id, { cadence_id: null, cadence_started_at: null });
      if (!updated) return; // updateQsLead já avisou por toast
      const closed = await closeOpenCadenceTasks(lead.id, "Lead removido da cadência");
      if (!closed) {
        notifyError("O lead saiu da cadência, mas as atividades abertas do plano NÃO foram encerradas — encerre-as no Painel.");
      }
      setLead(updated);
      setCadence(null);
      setCadenceDays([]);
      await reloadTasks();
      notifySuccess("Lead removido da cadência.");
    } finally {
      setRemovingCadence(false);
    }
  }

  // ── Mark as won (Sprint 4: modal pede o VALOR FECHADO — closed_value nunca
  // era escrito e a "receita ganha" do dashboard vivia em R$ 0) ──
  function openWonModal() {
    if (!lead) return;
    // Incentiva sem obrigar: pré-preenche com a estimativa quando existir.
    setWonValue(lead.estimated_value != null ? String(lead.estimated_value) : "");
    setWonError(null);
    setShowWonModal(true);
  }

  async function confirmWon() {
    if (!lead || savingWon) return;
    const value = parseMoney(wonValue);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      setWonError("Valor inválido — use números (ex.: 1500 ou 1.500,50). Deixe vazio pra não informar.");
      return;
    }
    setSavingWon(true);
    setWonError(null);
    try {
      // updateQsLead MEDE o que o banco aceitou (erro OU .single() sem linha) e
      // avisa por toast em falha — nada de sucesso otimista.
      const updated = await updateQsLead(lead.id, {
        status: "ganho" as LeadStatus,
        closed_value: value,
      });
      if (!updated) return;
      // Encerra as atividades ainda abertas do lead (mesmo comportamento do Painel);
      // sem isso elas ficam "pendente" pra sempre e inflam contadores e a taxa de atraso.
      const { error: tasksError } = await supabase
        .from("qs_tasks")
        .update({ status: "ignorada", skip_reason: "Lead ganho" })
        .eq("lead_id", lead.id)
        .in("status", ["pendente", "atrasada"]);
      if (tasksError) {
        console.warn("Erro ao encerrar atividades do lead ganho:", tasksError);
        notifyError("Lead ganho, mas as atividades abertas não foram encerradas — encerre-as no Painel.");
      }
      // Move o negócio pra coluna de Ganho no Bitrix. O evento continua "ganho"
      // (whitelist); closed_value vai como campo extra — o n8n usa se souber.
      notifyBitrix("ganho", {
        lead_id: lead.id,
        bitrix_id: lead.bitrix_id,
        full_name: lead.full_name,
        closed_value: value,
      });
      setLead(updated);
      setShowWonModal(false);
      await reloadTasks();
      notifySuccess("Lead marcado como GANHO.");
    } finally {
      setSavingWon(false);
    }
  }

  // ── Mark as lost (with re-engagement check — Change 16) ──
  async function markAsLost(lossReasonId?: string) {
    if (!lead) return;
    // Confirmação: o "Perdido" é um select — um toque errado não pode encerrar o lead.
    const reasonLabel = lossReasonId ? lossReasons.find((r) => r.id === lossReasonId)?.label : null;
    if (!window.confirm(`Marcar ${lead.full_name ?? "este lead"} como PERDIDO${reasonLabel ? ` (${reasonLabel})` : ""}?`)) {
      setSelectedLossReason("");
      return;
    }
    const updateData: Record<string, unknown> = { status: "perdido" as LeadStatus };
    if (lossReasonId) updateData.loss_reason_id = lossReasonId;

    const { error } = await supabase
      .from("qs_leads")
      .update(updateData)
      .eq("id", lead.id);
    if (error) {
      console.warn("Erro ao marcar como perdido:", error);
      notifyError("Não foi possível marcar como perdido — tente novamente.");
      setSelectedLossReason("");
      return;
    }

    // Encerra as atividades ainda abertas do lead (mesmo comportamento do Painel).
    await supabase
      .from("qs_tasks")
      .update({ status: "ignorada", skip_reason: "Lead perdido" })
      .eq("lead_id", lead.id)
      .in("status", ["pendente", "atrasada"]);
    setSelectedLossReason("");
    await reloadTasks();

    // Move o negócio pra coluna de Perdido no Bitrix (com o motivo).
    notifyBitrix("perdido", {
      lead_id: lead.id,
      bitrix_id: lead.bitrix_id,
      full_name: lead.full_name,
      loss_reason: lossReasonId ? lossReasons.find((r) => r.id === lossReasonId)?.label ?? null : null,
    });

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
    // Guarda de duplo clique: dois toques em "30 dias" criavam DUAS tarefas.
    if (!lead || schedulingReContact) return;
    setSchedulingReContact(true);
    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + days);

    // A tag "re_contato" faz o Painel exibir esta tarefa mesmo com o lead perdido
    // (o filtro padrão esconde tarefas de leads ganhos/perdidos).
    const { error } = await supabase.from("qs_tasks").insert({
      lead_id: lead.id,
      owner_id: lead.owner_id,
      channel_type: "ligacao",
      status: "pendente",
      priority: "media",
      scheduled_at: scheduledAt.toISOString(),
      is_extra: true,
      tags: ["re_contato"],
      notes: `Re-contato agendado (${days} dias) - Lead marcado como perdido`,
    });

    if (error) {
      console.warn("Erro ao agendar re-contato:", error);
      notifyError("Não foi possível agendar o re-contato.");
      setSchedulingReContact(false);
    } else {
      setReEngagementScheduled(true);
      await reloadTasks();
      setTimeout(() => {
        setReEngagementScheduled(false);
        setShowReEngagement(false);
        setSchedulingReContact(false);
      }, 2000);
    }
  }

  // ── Handover to closer ──
  // Handover NÃO é ganho: só troca o dono e encerra as atividades de prospecção.
  // (Antes marcava status "ganho", inflando o placar/ranking sem venda — o ganho
  // de verdade continua sendo dado pelo fluxo de desfecho, com reunião.)
  async function handleHandover() {
    // Guarda de duplo clique: sem ela, dois handovers idênticos eram registrados.
    if (!lead || !selectedCloser || savingHandover) return;
    setSavingHandover(true);
    try {
    const { error: hoError } = await supabase
      .from("qs_handovers")
      .insert({ lead_id: lead.id, from_user_id: lead.owner_id, to_user_id: selectedCloser });
    if (hoError) {
      console.warn("Erro ao criar handover:", hoError);
      notifyError("Não foi possível fazer o handover — tente novamente.");
      return;
    }
    const { error: upError } = await supabase
      .from("qs_leads")
      .update({ owner_id: selectedCloser })
      .eq("id", lead.id);
    if (upError) {
      console.warn("Erro ao atualizar lead após handover:", upError);
      notifyError("O handover foi registrado, mas o dono do lead não mudou — tente novamente.");
      return;
    }

    // A prospecção acabou: encerra as atividades abertas pra não ficarem na fila do SDR antigo.
    await supabase
      .from("qs_tasks")
      .update({ status: "ignorada", skip_reason: "Handover para closer" })
      .eq("lead_id", lead.id)
      .in("status", ["pendente", "atrasada"]);

    // Registra o handover na timeline do Bitrix (sem mover coluna).
    const closerName = closers.find((c) => c.id === selectedCloser)?.name ?? "closer";
    notifyBitrix("nota", {
      lead_id: lead.id,
      bitrix_id: lead.bitrix_id,
      body: `Lead enviado para o closer ${closerName} (handover no QS).`,
    });

    setShowHandoverModal(false);
    setHandoverSuccess(true);
    setTimeout(() => setHandoverSuccess(false), 3000);
    await fetchLead();
    await reloadTasks();
    } finally {
      setSavingHandover(false);
    }
  }

  // ── Save meeting (Task 1) ──
  async function saveMeeting() {
    if (!lead || savingMeeting) return;
    if (!meetingForm.scheduled_at) {
      setMeetingError("Informe a data e o horário da reunião.");
      return;
    }
    const when = new Date(meetingForm.scheduled_at);
    if (isNaN(when.getTime())) {
      setMeetingError("Data/hora inválida.");
      return;
    }
    // Reunião no passado é quase sempre erro de digitação no datetime-local
    // (ano/mês errado) — bloqueia com 1 min de tolerância pra "agora".
    if (when.getTime() < Date.now() - 60_000) {
      setMeetingError("A data da reunião está no passado — confira o dia e o horário.");
      return;
    }
    setSavingMeeting(true);
    setMeetingError(null);

    const durationParsed = parseInt(meetingForm.duration_min, 10);

    const { error } = await supabase.from("qs_meetings").insert({
      lead_id: lead.id,
      owner_id: currentUser?.id ?? lead.owner_id ?? null,
      title: meetingForm.title.trim() || null,
      scheduled_at: new Date(meetingForm.scheduled_at).toISOString(),
      duration_min: Number.isFinite(durationParsed) && durationParsed > 0 ? durationParsed : 30,
      location: meetingForm.location.trim() || null,
      meeting_link: meetingForm.meeting_link.trim() || null,
      notes: meetingForm.notes.trim() || null,
      status: "agendada",
    });

    setSavingMeeting(false);

    if (error) {
      console.warn("Erro ao agendar reunião:", error);
      setMeetingError("Não foi possível agendar a reunião: " + error.message);
      return;
    }

    // Preenche os campos da reunião no Bitrix e move o negócio pra "Reunião agendada".
    notifyBitrix("reuniao", {
      lead_id: lead.id,
      bitrix_id: lead.bitrix_id,
      full_name: lead.full_name,
      title: meetingForm.title.trim() || null,
      scheduled_at: new Date(meetingForm.scheduled_at).toISOString(),
      duration_min: Number.isFinite(durationParsed) && durationParsed > 0 ? durationParsed : 30,
      location: meetingForm.location.trim() || null,
      meeting_link: meetingForm.meeting_link.trim() || null,
      notes: meetingForm.notes.trim() || null,
      scheduled_by: currentUser?.name ?? null,
      meeting_owner: currentUser?.name ?? null,
      client_email: lead.email ?? null,
      booking_date: new Date().toISOString().slice(0, 10),
    });

    await reloadMeetings();
    setShowMeetingModal(false);
    setMeetingForm(EMPTY_MEETING_FORM);
    setActiveTab("reunioes");
  }

  // ── Meeting status quick actions (Sprint 4 — realizada / no-show / cancelar) ──
  async function changeMeetingStatus(meeting: Meeting, status: MeetingStatus) {
    if (!lead || updatingMeetingId) return;
    // Cancelar é 1 clique — misclick não pode cancelar reunião de cliente.
    if (status === "cancelada" && !window.confirm(`Cancelar a reunião de ${formatDateTime(meeting.scheduled_at)}?`)) return;
    setUpdatingMeetingId(meeting.id);
    try {
      // updateQsMeeting MEDE a gravação (.single() falha com 0 linhas sob RLS)
      // e avisa por toast quando o banco recusa.
      const updated = await updateQsMeeting(meeting.id, {
        status,
        updated_at: new Date().toISOString(),
      });
      if (!updated) return;
      // Espelha o desfecho na timeline do negócio no Bitrix (evento "nota").
      notifyMeetingStatusToBitrix(meeting, lead.bitrix_id, status);
      await reloadMeetings();
      notifySuccess(`Reunião marcada como ${MEETING_STATUS_LABELS[status].toLowerCase()}.`);
    } finally {
      setUpdatingMeetingId(null);
    }
  }

  // ── Save custom fields (Task 2) ──
  async function saveCustomFields() {
    if (!lead || customFields.length === 0) return;
    setSavingCustom(true);
    setCustomError(null);

    const rows = customFields.map((field) => ({
      lead_id: lead.id,
      custom_field_id: field.id,
      value: customValues[field.id]?.trim() ? customValues[field.id].trim() : null,
    }));

    const { error } = await supabase
      .from("qs_lead_custom_values")
      .upsert(rows, { onConflict: "lead_id,custom_field_id" });

    setSavingCustom(false);

    if (error) {
      console.warn("Erro ao salvar campos personalizados:", error);
      setCustomError("Não foi possível salvar os campos: " + error.message);
      return;
    }

    await reloadCustomFields();
    setCustomSaved(true);
    setTimeout(() => setCustomSaved(false), 2000);
  }

  // ── Loading / Not found ──
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] px-4 md:px-6 py-6 flex items-center justify-center" style={{ fontFamily: "inherit" }}>
        <p className="text-sm text-gray-500">Carregando...</p>
      </div>
    );
  }

  // Falha de rede/servidor NÃO é "Lead não encontrado" — oferece tentar de novo.
  if (!lead && loadError) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] px-4 md:px-6 py-6 flex flex-col items-center justify-center" style={{ fontFamily: "inherit" }}>
        <p className="text-sm font-medium text-gray-700 mb-1">Não foi possível carregar o lead.</p>
        <p className="text-xs text-gray-400 mb-4 max-w-sm text-center">{loadError}</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRetryTick((t) => t + 1)}
            className="px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-medium text-white hover:bg-[#0139D6] transition-colors"
          >
            Tentar de novo
          </button>
          <button onClick={onBack} className="text-sm text-[#0147FF] hover:underline">Voltar para Leads</button>
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] px-4 md:px-6 py-6 flex flex-col items-center justify-center" style={{ fontFamily: "inherit" }}>
        <p className="text-sm text-gray-500 mb-4">Lead não encontrado.</p>
        <button onClick={onBack} className="text-sm text-[#0147FF] hover:underline">Voltar para Leads</button>
      </div>
    );
  }

  // ── Isolamento por dono ──────────────────────────────────────────────────────
  // SDR/closer só abrem o PRÓPRIO lead (esta tela abre por ID direto — via busca
  // global, link ou URL — sem passar pelo filtro da lista). Gestor/admin veem tudo.
  // Backstop de tela: a garantia REAL é a RLS 0007/0008 no banco.
  const canView =
    !!currentUser &&
    (canSeeAllData(currentUser.role) || lead.owner_id === currentUser.id);
  if (!canView) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] px-4 md:px-6 py-6 flex flex-col items-center justify-center" style={{ fontFamily: "inherit" }}>
        <p className="text-sm text-gray-700 font-medium mb-1">Este lead é de outro SDR.</p>
        <p className="text-sm text-gray-500 mb-4">Você só tem acesso aos seus próprios leads.</p>
        <button onClick={onBack} className="text-sm text-[#0147FF] hover:underline">Voltar para Leads</button>
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

  // ── Próximas atividades (Sprint 4) ───────────────────────────────────────────
  // As tasks pendentes eram buscadas mas NUNCA exibidas — só as concluídas
  // apareciam. O selo "Atrasada" é DERIVADO da data (regra da casa: status
  // 'atrasada' nunca é gravado), por cima do que estiver no banco.
  function renderUpcomingTasksBox() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const openTasks = tasks
      .filter((t) => t.status === "pendente" || t.status === "atrasada")
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    if (openTasks.length === 0) return null;
    return (
      <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-[#0147FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h4 className="text-xs font-semibold text-blue-800">Próximas atividades ({openTasks.length})</h4>
        </div>
        <div className="space-y-2">
          {openTasks.map((t) => {
            const isLate = new Date(t.scheduled_at).getTime() < todayStart.getTime();
            return (
              <div key={t.id} className="flex items-center gap-2 flex-wrap">
                <span className="w-6 h-6 rounded-full bg-blue-100 text-[#0147FF] flex items-center justify-center shrink-0">
                  {CHANNEL_ICONS[t.channel_type]}
                </span>
                <span className="text-sm font-medium text-gray-800">{CHANNEL_LABELS[t.channel_type]}</span>
                <span className="text-xs text-gray-400">{formatDateTime(t.scheduled_at)}</span>
                {t.is_extra && <span className="text-[10px] font-medium text-gray-400 uppercase">extra</span>}
                {isLate && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-700">
                    Atrasada
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Tab Content ────────────────────────────────────────────────────────────

  function renderTabContent(lead: Lead) {
    switch (activeTab) {
      // ── Histórico (timeline unificada) ──
      case "historico": {
        type Ev = { ts: string; icon: string; color: string; title: string; body?: string };
        const outcomeLabels: Record<string, string> = {
          ganho: "Ganho / Agendou", concluida: "Concluída", sem_interesse: "Perdido", atendeu: "Atendeu (pediu retorno)",
          nao_atendeu: "Não atendeu", caixa_postal: "Caixa postal", numero_errado: "Nº errado", desligou: "Desligou",
        };
        const meetingLabels: Record<string, string> = { agendada: "agendada", realizada: "realizada", no_show: "no-show", cancelada: "cancelada" };
        const events: Ev[] = [];

        // Chegada do lead
        const chegada = lead.arrived_at || lead.created_at;
        if (chegada) events.push({ ts: chegada, icon: "📥", color: "#0147FF", title: "Lead entrou no sistema", body: `Origem: ${SOURCE_LABELS[lead.source] ?? lead.source}${lead.segment ? ` · ${lead.segment}` : ""}` });

        // Anotações
        notes.forEach((n) => events.push({ ts: n.created_at, icon: "📝", color: "#6D3BEB", title: "Anotação", body: n.body }));

        // Atividades concluídas (com desfecho)
        tasks.filter((t) => t.status === "concluida" && t.completed_at).forEach((t) => {
          const res = (t as unknown as { contact_result?: string }).contact_result;
          events.push({
            ts: t.completed_at!, icon: "✅", color: "#12A18A",
            title: `${CHANNEL_LABELS[t.channel_type] ?? t.channel_type} — ${res ? (outcomeLabels[res] ?? res) : "concluída"}`,
            body: t.notes || undefined,
          });
        });

        // Reuniões
        meetings.forEach((m) => events.push({
          ts: m.created_at, icon: "📅", color: "#E8920B",
          title: `Reunião ${meetingLabels[m.status] ?? m.status} — ${formatDateTime(m.scheduled_at)}`,
          body: [m.title, m.location].filter(Boolean).join(" · ") || undefined,
        }));

        // Desfecho do lead
        // closed_at não "anda" com edições posteriores (updated_at andava)
        if (lead.status === "ganho") events.push({ ts: lead.closed_at ?? lead.updated_at, icon: "🏆", color: "#12A18A", title: "Lead GANHO" });
        if (lead.status === "perdido") events.push({ ts: lead.closed_at ?? lead.updated_at, icon: "🚫", color: "#E5484D", title: "Lead perdido", body: lead.loss_reason?.label ? `Motivo: ${lead.loss_reason.label}` : undefined });

        events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

        return (
          <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Linha do tempo</h3>
            <p className="text-xs text-gray-400 mb-5">Tudo que aconteceu com este cliente, do mais recente ao mais antigo.</p>
            {events.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Nenhum evento ainda.</p>
            ) : (
              <div className="relative pl-6">
                <span className="absolute left-[9px] top-2 bottom-2 w-px bg-gray-200" aria-hidden />
                <div className="flex flex-col gap-4">
                  {events.map((ev, i) => (
                    <div key={i} className="relative">
                      <span className="absolute -left-6 top-0.5 w-[19px] h-[19px] rounded-full flex items-center justify-center text-[10px] bg-white border" style={{ borderColor: ev.color }}>
                        {ev.icon}
                      </span>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-[13.5px] font-semibold text-gray-900">{ev.title}</span>
                        <span className="text-[11px] text-gray-400 tabular-nums">{formatDateTime(ev.ts)}</span>
                      </div>
                      {ev.body && <p className="text-[12.5px] text-gray-500 mt-0.5 whitespace-pre-wrap max-w-[70ch]">{ev.body}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }

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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Cadência</h3>
                  {lead.cadence_id && (
                    <button
                      onClick={removeFromCadence}
                      disabled={removingCadence}
                      className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Limpa o vínculo com a cadência e encerra as atividades abertas do plano"
                    >
                      {removingCadence ? "Removendo..." : "Remover da cadência"}
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-700">{cadence?.name ?? "\u2014"}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Iniciada em {lead.cadence_started_at ? formatDate(lead.cadence_started_at) : "\u2014"}
                </p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Responsável</h3>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#0147FF]/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-[#0147FF]">
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

            {/* Próximas atividades (Sprint 4) */}
            {renderUpcomingTasksBox()}

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
                    <div className="w-8 h-8 rounded-full bg-[#0147FF]/10 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-[#0147FF]">D{day.day_number}</span>
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
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF] resize-none"
              />
              <div className="flex justify-end mt-3">
                <button
                  onClick={addNote}
                  disabled={!newNote.trim() || savingNote}
                  className="px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-medium text-white hover:bg-[#0139D6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {savingNote ? "Salvando..." : "Adicionar Anotação"}
                </button>
              </div>
            </div>

            {/* Notes List */}
            <div className="space-y-3">
              {notes.map((note) => {
                // Autor REAL da nota (antes exibia sempre o dono do lead — num
                // handover, as notas antigas "mudavam" de autor).
                const authorName = allUsers.find((u) => u.id === note.author_id)?.name ?? lead.owner?.name ?? "Autor";
                // A RLS (0007: notes_update/delete) só aceita autor ou gestor —
                // o menu segue a mesma regra pra não oferecer ação que o banco recusa.
                const canManageNote =
                  !!currentUser && (canSeeAllData(currentUser.role) || note.author_id === currentUser.id);
                const isEditingThis = editingNoteId === note.id;
                return (
                <div key={note.id} className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[#0147FF]/10 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-[#0147FF]">
                          {authorName.split(" ").map((n: string) => n[0]).join("").slice(0, 2) || "?"}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-gray-900">{authorName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{formatDateTime(note.created_at)}</span>
                      {canManageNote && (
                        <div className="relative">
                          <button
                            onClick={() => setNoteMenuId(noteMenuId === note.id ? null : note.id)}
                            className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                            title="Ações da anotação"
                            aria-label="Ações da anotação"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                              <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                            </svg>
                          </button>
                          {noteMenuId === note.id && (
                            <>
                              {/* backdrop transparente: clique fora fecha o menu */}
                              <div className="fixed inset-0 z-10" onClick={() => setNoteMenuId(null)} />
                              <div className="absolute right-0 top-7 z-20 w-32 rounded-lg border border-gray-100 bg-white shadow-lg py-1">
                                <button
                                  onClick={() => {
                                    setNoteMenuId(null);
                                    startEditNote(note);
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => {
                                    setNoteMenuId(null);
                                    handleDeleteNote(note);
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                                >
                                  Excluir
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {isEditingThis ? (
                    <div>
                      <textarea
                        value={editingNoteBody}
                        onChange={(e) => setEditingNoteBody(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF] resize-none"
                      />
                      <div className="flex items-center justify-end gap-2 mt-2">
                        <button
                          onClick={() => {
                            setEditingNoteId(null);
                            setEditingNoteBody("");
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={saveNoteEdit}
                          disabled={!editingNoteBody.trim() || savingNoteEdit}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-[#0147FF] hover:bg-[#0139D6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {savingNoteEdit ? "Salvando..." : "Salvar"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-700 leading-relaxed">{note.body}</p>
                  )}
                </div>
                );
              })}
              {notes.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-sm text-gray-400">Nenhuma anotação registrada.</p>
                </div>
              )}
            </div>
          </div>
        );

      // ── Contatos (Sprint 4: primeiro caminho de escrita de qs_contacts) ──
      case "contatos":
        return (
          <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">Contatos do Lead</h3>
              {!showContactForm && (
                <button
                  onClick={openContactCreate}
                  className="px-3 py-1.5 rounded-lg bg-[#0147FF] text-xs font-medium text-white hover:bg-[#0139D6] transition-colors"
                >
                  + Adicionar contato
                </button>
              )}
            </div>

            {/* Form de criar/editar contato */}
            {showContactForm && (
              <div className="mb-4 p-4 rounded-lg border border-gray-200 bg-[#F8F9FA]">
                <p className="text-xs font-semibold text-gray-700 mb-3">
                  {contactEditingId ? "Editar contato" : "Novo contato"}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Tipo</label>
                    <select
                      value={contactForm.type}
                      onChange={(e) => setContactForm((prev) => ({ ...prev, type: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                    >
                      {Object.entries(CONTACT_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">
                      {contactForm.type === "email" ? "E-mail" : contactForm.type === "linkedin" ? "Perfil/URL" : "Número"}
                    </label>
                    <input
                      type={contactForm.type === "email" ? "email" : "text"}
                      value={contactForm.value}
                      onChange={(e) => setContactForm((prev) => ({ ...prev, value: e.target.value }))}
                      placeholder={contactForm.type === "email" ? "nome@empresa.com" : contactForm.type === "linkedin" ? "linkedin.com/in/..." : "(11) 99999-9999"}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 mb-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={contactForm.is_primary}
                    onChange={(e) => setContactForm((prev) => ({ ...prev, is_primary: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  Contato principal
                </label>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => {
                      setShowContactForm(false);
                      setContactEditingId(null);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={saveContact}
                    disabled={!contactForm.value.trim() || savingContact}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-[#0147FF] hover:bg-[#0139D6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {savingContact ? "Salvando..." : contactEditingId ? "Salvar" : "Adicionar"}
                  </button>
                </div>
              </div>
            )}

            {contacts.length === 0 && !showContactForm && (
              <p className="text-sm text-gray-400 text-center py-6">
                Nenhum contato cadastrado. Use "+ Adicionar contato" pra registrar telefones e e-mails extras deste lead.
              </p>
            )}
            <div className="space-y-3">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-[#F8F9FA]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0">
                      {contact.type === "phone" && CHANNEL_ICONS.ligacao}
                      {contact.type === "email" && CHANNEL_ICONS.email}
                      {contact.type === "whatsapp" && CHANNEL_ICONS.whatsapp}
                      {contact.type === "linkedin" && CHANNEL_ICONS.linkedin}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{contact.value}</p>
                      <p className="text-xs text-gray-400">{CONTACT_TYPE_LABELS[contact.type] ?? contact.type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {contact.is_primary && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium bg-[#0147FF]/10 text-[#0147FF]">
                        Principal
                      </span>
                    )}
                    <button
                      onClick={() => openContactEdit(contact)}
                      className="p-1.5 rounded-md hover:bg-white text-gray-400 hover:text-gray-600 transition-colors"
                      title="Editar contato"
                      aria-label="Editar contato"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteContact(contact)}
                      className="p-1.5 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                      title="Excluir contato"
                      aria-label="Excluir contato"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      // ── Reuniões (Sprint 4: mostra o que foi coletado + ações de desfecho) ──
      case "reunioes":
        return (
          <div className="space-y-3">
            {meetings.map((meeting) => {
              const mColor = MEETING_COLORS[meeting.status] ?? MEETING_COLORS.agendada;
              const busy = updatingMeetingId === meeting.id;
              return (
                <div key={meeting.id} className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
                  <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${mColor.bg} ${mColor.text}`}>
                        {MEETING_STATUS_LABELS[meeting.status]}
                      </span>
                      {meeting.title && (
                        <span className="text-sm font-semibold text-gray-900 truncate">{meeting.title}</span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">Criada em {formatDateTime(meeting.created_at)}</span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-sm text-gray-700">
                        {formatDateTime(meeting.scheduled_at)}
                        {meeting.duration_min ? ` · ${meeting.duration_min} min` : ""}
                      </span>
                    </div>
                    {meeting.location && (
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-sm text-gray-700">{meeting.location}</span>
                      </div>
                    )}
                    {meeting.meeting_link && (
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m7.328-7.328a4 4 0 015.656 5.656l-1.5 1.5" />
                        </svg>
                        <a
                          href={meeting.meeting_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-[#0147FF] hover:underline truncate"
                          title="Abrir link da reunião"
                        >
                          {meeting.meeting_link}
                        </a>
                      </div>
                    )}
                    {meeting.notes && (
                      <p className="text-[12.5px] text-gray-500 whitespace-pre-wrap pt-1">{meeting.notes}</p>
                    )}
                  </div>

                  {/* Ações de desfecho — só pra reunião ainda agendada */}
                  {meeting.status === "agendada" && (
                    <div className="flex items-center gap-2 flex-wrap mt-4 pt-3 border-t border-gray-100">
                      <button
                        onClick={() => changeMeetingStatus(meeting, "realizada")}
                        disabled={busy || !!updatingMeetingId}
                        className="px-3 py-1.5 rounded-lg bg-green-50 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {busy ? "Salvando..." : "✓ Realizada"}
                      </button>
                      <button
                        onClick={() => changeMeetingStatus(meeting, "no_show")}
                        disabled={busy || !!updatingMeetingId}
                        className="px-3 py-1.5 rounded-lg bg-orange-50 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        No-show
                      </button>
                      <button
                        onClick={() => changeMeetingStatus(meeting, "cancelada")}
                        disabled={busy || !!updatingMeetingId}
                        className="px-3 py-1.5 rounded-lg bg-red-50 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
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

            {/* Próximas atividades (Sprint 4: pendentes/futuras, antes invisíveis) */}
            {(() => {
              const box = renderUpcomingTasksBox();
              return box ? <div className="mb-6">{box}</div> : null;
            })()}

            {/* Atividades realizadas (dados reais das tasks concluídas) */}
            {(() => {
              const doneTasks = tasks.filter((t) => t.status === "concluida");
              if (doneTasks.length === 0) return null;
              return (
                <div className="mb-6 rounded-lg border border-green-100 bg-green-50/60 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h4 className="text-xs font-semibold text-green-800">
                      Atividades realizadas ({doneTasks.length})
                    </h4>
                  </div>
                  <div className="space-y-2">
                    {doneTasks.map((t) => (
                      <div key={t.id} className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center shrink-0">
                          {CHANNEL_ICONS[t.channel_type]}
                        </span>
                        <span className="text-sm font-medium text-gray-800">{CHANNEL_LABELS[t.channel_type]}</span>
                        <span className="text-xs text-gray-400">
                          {formatDateTime(t.completed_at ?? t.scheduled_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

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
                            ? "bg-[#0147FF] border-[#0147FF] text-white"
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
      case "campos_personalizados": {
        if (customFields.length === 0) {
          return (
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Campos Personalizados</h3>
              <div className="text-center py-6">
                <p className="text-sm text-gray-400">Nenhum campo personalizado cadastrado.</p>
              </div>
            </div>
          );
        }

        return (
          <div className="space-y-6">
            {SCOPE_ORDER.map((scope) => {
              const fieldsInScope = customFields.filter((f) => f.scope === scope);
              if (fieldsInScope.length === 0) return null;
              return (
                <div key={scope} className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4">{SCOPE_LABELS[scope]}</h3>
                  <div className="space-y-4">
                    {fieldsInScope.map((field) => {
                      const value = customValues[field.id] ?? "";
                      const onChange = (v: string) =>
                        setCustomValues((prev) => ({ ...prev, [field.id]: v }));
                      const inputClass =
                        "w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]";
                      return (
                        <div key={field.id}>
                          <label className="block text-xs font-medium text-gray-500 mb-1.5">
                            {field.label}
                          </label>
                          {field.field_type === "textarea" || field.field_type === "text_long" ? (
                            <textarea
                              value={value}
                              onChange={(e) => onChange(e.target.value)}
                              rows={3}
                              className={`${inputClass} resize-none`}
                            />
                          ) : (
                            <input
                              type={
                                field.field_type === "number"
                                  ? "number"
                                  : field.field_type === "date"
                                  ? "date"
                                  : field.field_type === "email"
                                  ? "email"
                                  : field.field_type === "url"
                                  ? "url"
                                  : "text"
                              }
                              value={value}
                              onChange={(e) => onChange(e.target.value)}
                              className={inputClass}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {customError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {customError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              {customSaved && (
                <span className="text-sm font-medium text-green-600">Campos salvos!</span>
              )}
              <button
                onClick={saveCustomFields}
                disabled={savingCustom}
                className="px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-medium text-white hover:bg-[#0139D6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {savingCustom ? "Salvando..." : "Salvar Campos"}
              </button>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#F8F9FA] px-4 md:px-6 py-6" style={{ fontFamily: "inherit" }}>
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#0147FF]/10 flex items-center justify-center">
            <span className="text-base font-bold text-[#0147FF]">
              {lead.first_name?.[0]}{lead.last_name?.[0]}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-gray-900">{lead.full_name}</h1>
              {/* Temperatura EDITÁVEL (Sprint 4): o badge deixou de ser só reflexo
                  do Bitrix — o SDR classifica Quente/Morno/Frio aqui mesmo. */}
              <div className="relative">
                {(() => {
                  const t = getLeadScore(lead);
                  return (
                    <button
                      onClick={() => setShowScoreMenu(!showScoreMenu)}
                      disabled={savingScore}
                      title="Temperatura do lead — clique para classificar"
                      className={
                        t
                          ? "text-xs font-bold px-2 py-0.5 rounded-md transition hover:opacity-80 disabled:opacity-50"
                          : "text-xs font-medium px-2 py-0.5 rounded-md border border-dashed border-gray-300 text-gray-400 hover:text-gray-600 hover:border-gray-400 transition disabled:opacity-50"
                      }
                      style={t ? { background: t.bg, color: t.color } : undefined}
                    >
                      {savingScore ? "..." : t ? t.label : "Classificar"}
                    </button>
                  );
                })()}
                {showScoreMenu && (
                  <>
                    {/* backdrop transparente: clique fora fecha o menu */}
                    <div className="fixed inset-0 z-10" onClick={() => setShowScoreMenu(false)} />
                    <div className="absolute left-0 top-7 z-20 w-40 rounded-lg border border-gray-100 bg-white shadow-lg py-1">
                      {TEMPERATURE_OPTIONS.map((opt) => (
                        <button
                          key={opt.label}
                          onClick={() => setTemperature(opt.label)}
                          disabled={savingScore}
                          className="w-full text-left px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
                          style={{ color: opt.color }}
                        >
                          {opt.label}
                        </button>
                      ))}
                      {lead.lead_score && (
                        <button
                          onClick={() => setTemperature(null)}
                          disabled={savingScore}
                          className="w-full text-left px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50 transition-colors border-t border-gray-100"
                        >
                          Sem classificação
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
              {lead.bitrix_id && (
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(lead.bitrix_id!);
                      // Feedback visual (Sprint 4): antes o clique não dava sinal
                      // nenhum de que o ID tinha ido pro clipboard.
                      setBitrixCopied(true);
                      setTimeout(() => setBitrixCopied(false), 1500);
                    } catch {
                      notifyError("Não foi possível copiar o ID — copie manualmente.");
                    }
                  }}
                  title="ID do cliente (Bitrix) — clique para copiar"
                  className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded-md transition ${
                    bitrixCopied
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {bitrixCopied ? "Copiado ✓" : `ID ${lead.bitrix_id}`}
                </button>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {lead.job_title} {lead.company_name ? `na ${lead.company_name}` : ""}
            </p>
            {lead.segment && (
              <p className="text-[13px] font-semibold text-gray-600 mt-0.5">Fonte/Produto: <span className="text-gray-800">{lead.segment}</span></p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
          <button
            onClick={() => setShowMeetingModal(true)}
            className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Agendar Reunião
          </button>
          <button
            onClick={() => setShowWhatsApp(true)}
            className="px-3 py-2 rounded-lg text-sm font-semibold text-white transition-colors flex items-center gap-2"
            style={{ background: "#25D366" }}
            title="Abrir WhatsApp"
            aria-label="Abrir WhatsApp"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
            </svg>
            WhatsApp
          </button>
          {(lead.status === "ganho" || lead.status === "perdido") && (
            <button
              onClick={async () => {
                if (reactivating) return;
                if (!window.confirm(`Reativar ${lead.full_name ?? "este lead"}? As atividades da cadência serão recriadas do dia 1.`)) return;
                setReactivating(true);
                try {
                  const { error } = await supabase.from("qs_leads").update({
                    status: "em_prospeccao",
                    loss_reason_id: null,
                    cadence_started_at: new Date().toISOString(),
                    arrived_at: new Date().toISOString(),
                  }).eq("id", lead.id);
                  if (error) {
                    console.warn("Erro ao reativar lead:", error);
                    notifyError("Não foi possível reativar o lead — tente novamente.");
                    return;
                  }

                  // Recria as tarefas pela função única da cadência (a versão antiga
                  // inseria uma coluna inexistente e falhava em silêncio: o lead
                  // voltava a "em prospecção" com ZERO atividades e sumia da fila).
                  if (lead.cadence_id) {
                    await createCadenceTasks(lead.id, lead.cadence_id, lead.owner_id);
                  }

                  setLead({ ...lead, status: "em_prospeccao" as LeadStatus, loss_reason_id: null });
                } finally {
                  setReactivating(false);
                }
              }}
              disabled={reactivating}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-60"
              style={{ background: "#0147FF" }}
            >
              {reactivating ? "Reativando..." : "↩ Reativar Lead"}
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
                  ? "border-[#0147FF] text-[#0147FF]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
              {tab.key === "anotacoes" && notes.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-[#0147FF]/15 text-[#0147FF] align-middle">
                  {notes.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div>{renderTabContent(lead)}</div>

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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-4 md:p-6">
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
                  className="flex-1 px-4 py-3 rounded-lg border-2 border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:border-[#0147FF] hover:bg-[#0147FF]/5 transition-all"
                >
                  30 dias
                </button>
                <button
                  onClick={() => scheduleReEngagement(60)}
                  className="flex-1 px-4 py-3 rounded-lg border-2 border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:border-[#0147FF] hover:bg-[#0147FF]/5 transition-all"
                >
                  60 dias
                </button>
                <button
                  onClick={() => scheduleReEngagement(90)}
                  className="flex-1 px-4 py-3 rounded-lg border-2 border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:border-[#0147FF] hover:bg-[#0147FF]/5 transition-all"
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
                      <div className="w-6 h-6 rounded-full bg-[#0147FF]/10 flex items-center justify-center shrink-0">
                        <span className="text-[9px] font-bold text-[#0147FF]">D{day.day_number}</span>
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

      {/* Meeting Modal (Task 1) */}
      {showMeetingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Agendar Reunião</h2>
              <button
                onClick={() => {
                  setShowMeetingModal(false);
                  setMeetingError(null);
                }}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                aria-label="Fechar"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Título</label>
                <input
                  type="text"
                  value={meetingForm.title}
                  onChange={(e) => setMeetingForm((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="Ex.: Reunião de apresentação"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Data e hora</label>
                  <input
                    type="datetime-local"
                    value={meetingForm.scheduled_at}
                    onChange={(e) => setMeetingForm((prev) => ({ ...prev, scheduled_at: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Duração (min)</label>
                  <input
                    type="number"
                    min={1}
                    value={meetingForm.duration_min}
                    onChange={(e) => setMeetingForm((prev) => ({ ...prev, duration_min: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Local</label>
                <input
                  type="text"
                  value={meetingForm.location}
                  onChange={(e) => setMeetingForm((prev) => ({ ...prev, location: e.target.value }))}
                  placeholder="Ex.: Escritório, Google Meet, telefone..."
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Link</label>
                <input
                  type="url"
                  value={meetingForm.meeting_link}
                  onChange={(e) => setMeetingForm((prev) => ({ ...prev, meeting_link: e.target.value }))}
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Anotações</label>
                <textarea
                  value={meetingForm.notes}
                  onChange={(e) => setMeetingForm((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  placeholder="Pauta, contexto ou observações..."
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF] resize-none"
                />
              </div>

              {meetingError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {meetingError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowMeetingModal(false);
                  setMeetingError(null);
                }}
                className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveMeeting}
                disabled={savingMeeting}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#0147FF] hover:bg-[#0139D6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {savingMeeting ? "Salvando..." : "Agendar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Modal (Task 3) */}
      <WhatsAppModal
        open={showWhatsApp}
        onClose={() => setShowWhatsApp(false)}
        lead={{
          id: lead.id,
          name: lead.full_name || `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim(),
          phone: lead.phone,
        }}
        ownerId={currentUser?.id ?? null}
      />
    </div>
  );
}
