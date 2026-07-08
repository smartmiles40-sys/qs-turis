// src/components/sdr/tasks/TasksPanel.tsx
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type {
  Task,
  Lead,
  Cadence,
  ChannelType,
  PriorityLevel,
} from "../types";
import { CHANNEL_LABELS } from "../types";
import { supabase } from "@/lib/supabase";
import { notifyBitrix } from "@/lib/qs/bitrixSync";
import { completeTask, skipTask, fetchQsUsers, transferLead, fetchActivityCounts, fetchActivityGoals } from "@/lib/qs/queries";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import { useChatAppDock } from "@/contexts/ChatAppDockContext";
import { computeLeadScore } from "@/lib/leadScore";
import { startWhatsAppCall, formatPhoneDisplay } from "@/lib/whatsapp";
import { dialViaWavoip } from "@/lib/wavoip";
import { loadWorkHours, minutesLeftToday, minutesWorkedToday, DEFAULT_WORK_HOURS, type WorkHours } from "@/lib/workHours";
import { loadMeetingTeam, DEFAULT_MEETING_SCHEDULERS, DEFAULT_MEETING_OWNERS } from "@/lib/qsSettings";
import type { SdrUser } from "../types";

// ── Props ────────────────────────────────────────────────────────────────────

interface TasksPanelProps {
  onOpenLead: (leadId: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type StatusFilter = "extras" | "para_hoje" | "atrasadas";
type PeriodFilter = "manha" | "tarde";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ── SVG Icons (inline, no external deps) ────────────────────────────────────

function IconSearch({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconResearch({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
      <path d="M11 8v6" />
      <path d="M8 11h6" />
    </svg>
  );
}

function IconEmail({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function IconWhatsApp({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 0 1-4.243-1.214l-.294-.18-3.072.806.82-2.994-.196-.312A8 8 0 1 1 12 20z" />
    </svg>
  );
}

function IconPhone({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function IconLinkedIn({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function IconSkip() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 4 10 8-10 8V4z" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </svg>
  );
}

function IconFilter() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function IconInstagram({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconTikTok({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.75a8.18 8.18 0 0 0 4.76 1.52V6.84a4.84 4.84 0 0 1-1-.15z" />
    </svg>
  );
}

function IconYouTube({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.546 12 3.546 12 3.546s-7.505 0-9.377.504A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.504 9.376.504 9.376.504s7.505 0 9.377-.504a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function IconPhoneCall({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      <path d="M14.05 2a9 9 0 0 1 8 7.94" />
      <path d="M14.05 6A5 5 0 0 1 18 10" />
    </svg>
  );
}

// Ligação via WhatsApp: bolha do zap com um handset dentro (separa da ligação normal)
function IconWhatsAppCall({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z" />
      <path d="M14.7 13.4c-.25-.13-1.02-.5-1.18-.56-.16-.06-.27-.09-.39.09-.11.17-.44.55-.54.66-.1.12-.2.13-.37.05-.17-.09-.72-.27-1.37-.85-.5-.45-.85-1.01-.95-1.18-.1-.17-.01-.26.08-.35.08-.08.17-.2.26-.3.09-.11.11-.18.17-.3.06-.11.03-.21-.01-.3-.05-.09-.39-.93-.53-1.28-.14-.33-.28-.29-.39-.29h-.33c-.11 0-.3.04-.45.21-.16.17-.6.58-.6 1.42s.61 1.65.7 1.76c.09.12 1.2 1.84 2.92 2.58.41.18.72.28.97.36.41.13.78.11 1.07.07.33-.05 1.02-.42 1.16-.82.14-.4.14-.74.1-.82-.04-.07-.15-.11-.32-.19z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChannelIcon({ type, size = 22 }: { type: ChannelType; size?: number }) {
  switch (type) {
    case "pesquisa":         return <IconResearch size={size} />;
    case "email":            return <IconEmail size={size} />;
    case "whatsapp":         return <IconWhatsApp size={size} />;
    case "ligacao":          return <IconPhone size={size} />;
    case "ligacao_whatsapp": return <IconWhatsAppCall size={size} />;
    case "linkedin":         return <IconLinkedIn size={size} />;
    case "instagram":        return <IconInstagram size={size} />;
    case "tiktok":           return <IconTikTok size={size} />;
    case "youtube":          return <IconYouTube size={size} />;
  }
}

// ── Mapa canal → classe do ícone redondo (design Execução) ──────────────────
const CHANNEL_IC_CLASS: Record<ChannelType, string> = {
  ligacao: "ic-call",
  ligacao_whatsapp: "ic-whats",
  whatsapp: "ic-whats",
  email: "ic-mail",
  pesquisa: "ic-pesquisa",
  linkedin: "ic-linkedin",
  instagram: "ic-social",
  tiktok: "ic-social",
  youtube: "ic-social",
};

const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

// ── SLA Alert helper ────────────────────────────────────────────────────────

function getSlaAlert(
  lead: Lead | undefined,
  task: Task,
  cadence: Cadence | undefined,
): { label: string; bg: string; text: string; pulse: boolean } | null {
  if (!lead?.arrived_at || task.completed_at || task.status === "concluida") return null;
  const now = Date.now();
  const arrivedMs = new Date(lead.arrived_at).getTime();
  const diffMin = Math.floor((now - arrivedMs) / 60000);
  if (diffMin < 0) return null;

  const isLevantada = cadence?.acquisition_channel === "levantada_de_mao";
  const t1 = isLevantada ? 3 : 5;
  const t2 = 15;
  const t3 = 30;

  if (diffMin < t1) {
    return { label: `Novo · ${diffMin}min`, bg: "#D1FAE5", text: "#059669", pulse: false };
  } else if (diffMin < t2) {
    return { label: `⚠ ${diffMin}min sem contato`, bg: "#FEF3C7", text: "#D97706", pulse: false };
  } else if (diffMin < t3) {
    return { label: `⚠ ${diffMin}min sem contato`, bg: "#FFEDD5", text: "#EA580C", pulse: false };
  } else {
    return { label: `🔴 ${diffMin}min SEM CONTATO`, bg: "#FEE2E2", text: "#DC2626", pulse: true };
  }
}

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_CONTACT_ATTEMPTS = 5;
const DAILY_GOAL = 350; // Will come from qs_goals later
const MONTHLY_GOAL = 7350;

// Agendamento da reunião (ao dar "Ganho") — as listas vêm de Configurações →
// Equipe da reunião (qs_settings), com estes defaults como fallback.

// ── Activity type labels ─────────────────────────────────────────────────────

function getActivityLabel(channel: ChannelType, _cadenceName?: string): string {
  const channelNames: Record<ChannelType, string> = {
    pesquisa: "Atividade de Pesquisa",
    email: "Enviar E-mail",
    ligacao: "Fazer Ligação",
    ligacao_whatsapp: "Ligar no WhatsApp",
    whatsapp: "Enviar WhatsApp",
    linkedin: "Contato pelo LinkedIn",
    instagram: "Contato pelo Instagram",
    tiktok: "Contato pelo TikTok",
    youtube: "Contato pelo YouTube",
  };
  return channelNames[channel];
}

/** Conta observações (qs_notes) por lead_id — alimenta a mini-notificação. */
function buildNoteCounts(rows: { lead_id: string | null }[] | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows || []) {
    if (r.lead_id) m.set(r.lead_id, (m.get(r.lead_id) || 0) + 1);
  }
  return m;
}

// ── Tentativas de contato ────────────────────────────────────────────────────
// A coluna qs_tasks NÃO tem `contact_attempts`. Cada tarefa de follow-up carrega a
// tag `tentativa:N`; a primeira tarefa da cadência (sem tag) conta como tentativa 1.
function getAttemptCount(task: Task): number {
  const tags = (task as unknown as { tags?: string[] | null }).tags;
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      const m = /^tentativa:(\d+)$/.exec(tag);
      if (m) return Number(m[1]);
    }
  }
  return 1;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TasksPanel({ onOpenLead }: TasksPanelProps) {
  const { currentUser } = useQsAuth();
  const chatDock = useChatAppDock();

  // Abre o dock do ChatApp focando um lead (copia o telefone pra colar na busca).
  const openWhatsApp = useCallback((lead: Lead | undefined | null) => {
    if (!lead) return;
    chatDock.openForLead({
      leadId: lead.id,
      name: lead.full_name ?? lead.first_name ?? null,
      phone: lead.phone ?? null,
      ownerId: lead.owner_id ?? null,
    });
  }, [chatDock]);

  // ── Supabase data ──────────────────────────────────────────────────
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cadences, setCadences] = useState<Cadence[]>([]);
  const [qsUsers, setQsUsers] = useState<SdrUser[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  // Quantas observações (notas) cada lead tem — pra mostrar a mini-notificação (item 6).
  const [noteCounts, setNoteCounts] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [tasksRes, leadsRes, cadencesRes, usersData, productsRes, notesRes] = await Promise.all([
          supabase.from("qs_tasks").select("*").in("status", ["pendente", "atrasada"]).order("scheduled_at"),
          supabase.from("qs_leads").select("*"),
          supabase.from("qs_cadences").select("*"),
          fetchQsUsers(),
          supabase.from("qs_products").select("*").eq("is_active", true).order("name"),
          supabase.from("qs_notes").select("lead_id"),
        ]);
        setTasks((tasksRes.data || []) as Task[]);
        setLeads((leadsRes.data || []) as Lead[]);
        setCadences((cadencesRes.data || []) as Cadence[]);
        setQsUsers(usersData);
        setProducts((productsRes.data || []) as { id: string; name: string }[]);
        setNoteCounts(buildNoteCounts(notesRes.data as { lead_id: string | null }[] | null));
      } catch (err) {
        console.warn("[TasksPanel] falha ao carregar dados:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Horário de funcionamento (Configurações) — alimenta as métricas de tempo.
  const [workHours, setWorkHours] = useState<WorkHours>(DEFAULT_WORK_HOURS);
  useEffect(() => { loadWorkHours().then(setWorkHours); }, []);

  // Equipe da reunião (Configurações) — listas do modal de Ganho.
  const [meetingTeam, setMeetingTeam] = useState({ schedulers: DEFAULT_MEETING_SCHEDULERS, owners: DEFAULT_MEETING_OWNERS });
  useEffect(() => { loadMeetingTeam().then(setMeetingTeam); }, []);

  // ── Auto-atualização da fila (60s) ─────────────────────────────────
  // Lead quente novo aparece sem F5. Não atualiza quando o SDR está no meio
  // de algo (modal aberto, desfecho pendente, observação digitada) nem com a
  // aba oculta. O guard vive num ref pra não recriar o intervalo a cada render.
  const pollBusyRef = useRef(false);
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden || pollBusyRef.current) return;
      try {
        const [tasksRes, leadsRes, notesRes] = await Promise.all([
          supabase.from("qs_tasks").select("*").in("status", ["pendente", "atrasada"]).order("scheduled_at"),
          supabase.from("qs_leads").select("*"),
          supabase.from("qs_notes").select("lead_id"),
        ]);
        if (tasksRes.data) setTasks(tasksRes.data as Task[]);
        if (leadsRes.data) setLeads(leadsRes.data as Lead[]);
        if (notesRes.data) setNoteCounts(buildNoteCounts(notesRes.data as { lead_id: string | null }[]));
      } catch { /* silencioso — próxima rodada tenta de novo */ }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Placar REAL: atividades concluídas (hoje/mês) + metas de qs_goals.
  const [doneCounts, setDoneCounts] = useState({ doneToday: 0, doneMonth: 0 });
  const [goalTargets, setGoalTargets] = useState<{ daily: number | null; monthly: number | null }>({ daily: null, monthly: null });
  const countsScope = currentUser && !canSeeAllData(currentUser.role) ? currentUser.id : null;
  const refreshCounts = useCallback(() => {
    fetchActivityCounts(countsScope).then(setDoneCounts);
  }, [countsScope]);
  useEffect(() => {
    refreshCounts();
    fetchActivityGoals(countsScope).then(setGoalTargets);
  }, [countsScope, refreshCounts]);

  // ── Lookup maps ────────────────────────────────────────────────────
  const leadsMap = useMemo(() => new Map(leads.map(l => [l.id, l])), [leads]);
  const cadencesMap = useMemo(() => new Map(cadences.map(c => [c.id, c])), [cadences]);

  function getLeadForTask(task: Task): Lead | undefined {
    return leadsMap.get(task.lead_id);
  }
  function getCadenceForTask(task: Task): Cadence | undefined {
    return task.cadence_id ? cadencesMap.get(task.cadence_id) : undefined;
  }

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelType | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<PriorityLevel | null>(null);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);

  // Confirmação do desfecho no card da "Próxima atividade"
  const [pendingResult, setPendingResult] = useState<{ taskId: string; result: string } | null>(null);
  // Item 7 — o SDR pode escolher qual lead atender (vira o card ativo). Sem seleção, o topo da fila.
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  // Itens 1 e 4 — observações da atividade (viram resumo no Bitrix via qs_notes)
  const [obsText, setObsText] = useState("");
  const [savingObs, setSavingObs] = useState(false);
  // Feedback do "copiar telefone" no card hero
  const [phoneCopied, setPhoneCopied] = useState(false);
  // Anti duplo-clique: trava os desfechos enquanto um finaliza
  const [finalizing, setFinalizing] = useState(false);
  // "Pular" abre um mini-menu de motivos (vai pro skip_reason)
  const [skipMenuOpen, setSkipMenuOpen] = useState(false);
  // Item 5 — transferir 1 lead pra outro SDR
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  // "Ganho" → formulário de agendamento da reunião
  const [meetingFor, setMeetingFor] = useState<{ taskId: string; leadId: string; leadName: string } | null>(null);
  const [meeting, setMeeting] = useState({ agendadoPor: "", emailCliente: "", dataAgendamento: "", responsavel: "", dataHora: "" });
  const [savingMeeting, setSavingMeeting] = useState(false);

  // New Lead Modal
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showExtraTaskModal, setShowExtraTaskModal] = useState(false);
  const [extraTask, setExtraTask] = useState({ lead_id: "", channel_type: "ligacao" as ChannelType, date: "", time: "09:00", notes: "", _searchText: "" });
  const [savingExtra, setSavingExtra] = useState(false);
  // Quando a extra vem de "Pediu retorno", guarda a tarefa original pra concluí-la no salvar.
  const [extraFromTaskId, setExtraFromTaskId] = useState<string | null>(null);
  const [showDialer, setShowDialer] = useState(false);
  const [dialNumber, setDialNumber] = useState("");
  const [newLead, setNewLead] = useState({ full_name: "", phone: "", email: "", company_name: "", owner_id: currentUser?.id ?? "", cadence_id: "", notes: "" });
  const [savingLead, setSavingLead] = useState(false);

  // O polling pausa enquanto o SDR está no meio de algo (atualizado a cada render).
  pollBusyRef.current = Boolean(
    meetingFor || transferOpen || pendingResult || obsText.trim() || savingObs ||
    showNewLeadModal || showExtraTaskModal || showDialer || skipMenuOpen || finalizing
  );

  // Celebration (shown once per session when daily goal hit)
  const [celebrationShown, setCelebrationShown] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);

  // Toast notification
  const [toast, setToast] = useState<{ message: string; visible: boolean } | null>(null);

  function showToast(message: string) {
    setToast({ message, visible: true });
    setTimeout(() => setToast(prev => prev ? { ...prev, visible: false } : null), 3000);
    setTimeout(() => setToast(null), 3500);
  }

  // Persiste o PRÓXIMO PASSO do lead conforme o desfecho do contato.
  // Cria uma nova tarefa 'pendente' em qs_tasks (mesmo canal, data futura) e a devolve
  // para o estado local. Assim NENHUM lead fica sem próxima tarefa.
  async function insertFollowUp(task: Task, result: string): Promise<Task | null> {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);

    const attempt = getAttemptCount(task) + 1;

    // "Número errado" → o canal atual está furado; o próximo passo é repesquisar o contato.
    const isBadNumber = result === "numero_errado";
    const channel: ChannelType = isBadNumber ? "pesquisa" : task.channel_type;

    const resultNote: Record<string, string> = {
      atendeu: "Lead pediu retorno — retomar contato",
      nao_atendeu: "Não atendeu na tentativa anterior",
      caixa_postal: "Caiu na caixa postal na tentativa anterior",
      desligou: "Ligação caiu / desligou na tentativa anterior",
      numero_errado: "Número/contato inválido — pesquisar dado correto",
    };

    const tags = isBadNumber
      ? ["follow-up", "dado-invalido", `tentativa:${attempt}`]
      : ["follow-up", `tentativa:${attempt}`];

    const { data, error } = await supabase
      .from("qs_tasks")
      .insert({
        lead_id: task.lead_id,
        cadence_id: task.cadence_id,
        owner_id: task.owner_id,
        channel_type: channel,
        priority: task.priority,
        scheduled_at: next.toISOString(),
        status: "pendente",
        is_extra: false,
        notes: `Follow-up (tentativa ${attempt}): ${resultNote[result] ?? "Retomar contato"}`,
        tags,
      })
      .select()
      .single();

    if (error) {
      console.error("[QS] Falha ao criar follow-up:", error);
      return null;
    }
    return (data as Task) ?? null;
  }

  // Encerra (ignora) as demais tarefas pendentes do lead — usado quando o lead é ganho/perdido.
  async function closeRemainingLeadTasks(leadId: string, exceptTaskId: string, reason: string) {
    const others = tasks.filter(t => t.lead_id === leadId && t.id !== exceptTaskId);
    if (others.length === 0) return;
    await supabase
      .from("qs_tasks")
      .update({ status: "ignorada", skip_reason: reason })
      .in("id", others.map(t => t.id));
  }

  async function handleContactResult(taskId: string, result: string) {
    const currentTask = tasks.find(t => t.id === taskId);
    if (!currentTask) return;

    // 1. Conclui a tentativa atual (marca 'concluida' + registra contact_result).
    await completeTask(taskId, result);

    const leadName = getLeadForTask(currentTask)?.full_name || "Lead";

    // 1b. Resumo da atividade → nota do lead (vai pro Bitrix via n8n). Itens 1 e 4.
    const outcomeLabels: Record<string, string> = {
      ganho: "Ganho / Agendou", sem_interesse: "Perdido", atendeu: "Pediu retorno",
      nao_atendeu: "Não atendeu", caixa_postal: "Caixa postal", numero_errado: "Nº errado", desligou: "Desligou",
    };
    const resumo = `${CHANNEL_LABELS[currentTask.channel_type]} — ${outcomeLabels[result] ?? result}${obsText.trim() ? `: ${obsText.trim()}` : ""}`;
    await persistObservation(currentTask.lead_id, resumo, ["bitrix", "desfecho", result]);
    setObsText("");
    setActiveTaskId(null);

    // 2. Desfecho: ganho/perdido encerram o lead; qualquer outro gera o próximo passo.
    const desfechoLead = getLeadForTask(currentTask);
    if (result === "ganho") {
      await supabase.from("qs_leads").update({ status: "ganho" }).eq("id", currentTask.lead_id);
      notifyBitrix("ganho", { lead_id: currentTask.lead_id, bitrix_id: desfechoLead?.bitrix_id, full_name: desfechoLead?.full_name });
      await closeRemainingLeadTasks(currentTask.lead_id, taskId, "Lead ganho");
      setLeads(prev => prev.map((l): Lead => l.id === currentTask.lead_id ? { ...l, status: "ganho" } : l));
      setTasks(prev => prev.filter(t => t.lead_id !== currentTask.lead_id));
      showToast(`Ganho! ${leadName}`);
    } else if (result === "sem_interesse") {
      await supabase.from("qs_leads").update({ status: "perdido" }).eq("id", currentTask.lead_id);
      notifyBitrix("perdido", { lead_id: currentTask.lead_id, bitrix_id: desfechoLead?.bitrix_id, full_name: desfechoLead?.full_name });
      await closeRemainingLeadTasks(currentTask.lead_id, taskId, "Lead perdido — sem interesse");
      setLeads(prev => prev.map((l): Lead => l.id === currentTask.lead_id ? { ...l, status: "perdido" } : l));
      setTasks(prev => prev.filter(t => t.lead_id !== currentTask.lead_id));
      showToast(`Lead perdido — ${leadName}`);
    } else {
      // atendeu (pediu retorno), nao_atendeu, caixa_postal, desligou, numero_errado
      // → SEMPRE cria a próxima tarefa. Nenhum lead fica órfão.
      const followUp = await insertFollowUp(currentTask, result);
      setTasks(prev => {
        const rest = prev.filter(t => t.id !== taskId);
        return followUp ? [...rest, followUp] : rest;
      });
      showToast(`Atividade registrada — ${leadName}`);
    }
    refreshCounts(); // placar de metas atualiza na hora
  }

  // Marca a atividade como CONCLUÍDA (conta no placar do dia), some da fila e
  // libera a próxima. A observação (se houver) fica salva no perfil do lead.
  async function handleConcludeActivity(task: Task) {
    const obs = obsText.trim();
    if (obs) {
      await persistObservation(task.lead_id, `${CHANNEL_LABELS[task.channel_type]} — Concluída: ${obs}`, ["bitrix", "observacao"]);
    }
    await completeTask(task.id, "concluida", obs || undefined, obs ? ["observacao"] : undefined);
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    setActiveTaskId(null);
    setObsText("");
    refreshCounts();
    showToast("Atividade concluída");
  }

  // Salva a observação como nota do lead (n8n empurra pro Bitrix — itens 1 e 4).
  async function persistObservation(leadId: string, body: string, tags: string[] = ["bitrix"]) {
    const text = body.trim();
    if (!text) return;
    try {
      // Mini-notificação (item 6): incrementa o contador de observações do lead na hora.
      setNoteCounts((prev) => { const m = new Map(prev); m.set(leadId, (m.get(leadId) || 0) + 1); return m; });
      await supabase.from("qs_notes").insert({
        lead_id: leadId,
        author_id: currentUser?.id ?? null,
        body: text,
        tags,
      });
      // Espelha como comentário na timeline do negócio no Bitrix.
      notifyBitrix("nota", {
        lead_id: leadId,
        bitrix_id: leads.find((l) => l.id === leadId)?.bitrix_id,
        body: text,
      });
    } catch (e) {
      console.warn("[QS] não foi possível salvar a observação:", e);
    }
  }

  // "Salvar no Bitrix" avulso (sem finalizar a atividade) — item 4.
  async function handleSaveObs(leadId: string) {
    if (!obsText.trim()) return;
    setSavingObs(true);
    await persistObservation(leadId, obsText, ["bitrix", "observacao"]);
    setSavingObs(false);
    setObsText("");
    showToast("Observação salva e enviada ao Bitrix");
  }

  // Transfere 1 lead pra outro SDR (item 5).
  async function handleTransfer(task: Task) {
    if (!transferTo) return;
    const ok = await transferLead(task.lead_id, currentUser?.id ?? null, transferTo, "Lead transferido pelo SDR");
    if (ok) {
      setTasks(prev => prev.filter(t => t.lead_id !== task.lead_id));
      const to = qsUsers.find(u => u.id === transferTo);
      showToast(`Lead transferido para ${to?.name ?? "outro SDR"}`);
    } else {
      showToast("Não foi possível transferir o lead");
    }
    setTransferOpen(false);
    setTransferTo("");
    setActiveTaskId(null);
  }

  // "Ganho" abre o formulário de agendamento da reunião (prefill do e-mail + data de hoje).
  function openMeetingGanho(task: Task) {
    const lead = getLeadForTask(task);
    const hoje = new Date();
    const yyyy = hoje.getFullYear();
    const mm = String(hoje.getMonth() + 1).padStart(2, "0");
    const dd = String(hoje.getDate()).padStart(2, "0");
    setMeeting({ agendadoPor: "", emailCliente: lead?.email ?? "", dataAgendamento: `${yyyy}-${mm}-${dd}`, responsavel: "", dataHora: "" });
    setPendingResult(null);
    setMeetingFor({ taskId: task.id, leadId: task.lead_id, leadName: lead?.full_name ?? "Lead" });
  }

  // Confirma o "Ganho": cria a reunião (qs_meetings), marca o lead ganho e encerra as tarefas.
  async function handleConfirmMeeting() {
    if (!meetingFor) return;
    if (!meeting.agendadoPor || !meeting.responsavel || !meeting.dataHora) return;
    setSavingMeeting(true);
    const { taskId, leadId, leadName } = meetingFor;
    const currentTask = tasks.find((t) => t.id === taskId);
    const obs = obsText.trim();
    const resumo = [
      meeting.agendadoPor && `Agendado por: ${meeting.agendadoPor}`,
      meeting.responsavel && `Responsável: ${meeting.responsavel}`,
      meeting.emailCliente && `E-mail: ${meeting.emailCliente}`,
      meeting.dataAgendamento && `Data do agendamento: ${meeting.dataAgendamento}`,
      obs && `Observações: ${obs}`,
    ].filter(Boolean).join(" · ");
    try {
      const meetingRow = {
        lead_id: leadId,
        owner_id: currentUser?.id ?? null,
        title: `Reunião — ${leadName}`,
        scheduled_at: new Date(meeting.dataHora).toISOString(),
        location: "Google Meet",
        notes: resumo,
        status: "agendada",
      };
      // Campos estruturados (migration 0006) — o n8n usa pra preencher o Bitrix.
      // Se a migration ainda não foi aplicada, o insert com eles falha e
      // repetimos no formato antigo (só notes) pra nunca travar o Ganho.
      const { error: insErr } = await supabase.from("qs_meetings").insert({
        ...meetingRow,
        scheduled_by: meeting.agendadoPor || null,
        meeting_owner: meeting.responsavel || null,
        client_email: meeting.emailCliente || null,
        booking_date: meeting.dataAgendamento || null,
      });
      if (insErr) {
        console.warn("[QS] insert com campos estruturados falhou (aplicar 0006?); usando formato antigo:", insErr.message);
        await supabase.from("qs_meetings").insert(meetingRow);
      }
      if (meeting.emailCliente) {
        await supabase.from("qs_leads").update({ email: meeting.emailCliente }).eq("id", leadId);
      }
      await completeTask(taskId, "ganho");
      await supabase.from("qs_leads").update({ status: "ganho" }).eq("id", leadId);
      if (currentTask) await closeRemainingLeadTasks(leadId, taskId, "Lead ganho — reunião agendada");
      await persistObservation(leadId, `Ganho — reunião agendada para ${meeting.dataHora}. ${resumo}`, ["bitrix", "ganho", "reuniao"]);
      // Preenche os campos da reunião no Bitrix e move o negócio pra "Reunião agendada".
      notifyBitrix("reuniao", {
        lead_id: leadId,
        bitrix_id: leads.find((l) => l.id === leadId)?.bitrix_id,
        full_name: leadName,
        title: meetingRow.title,
        scheduled_at: meetingRow.scheduled_at,
        location: meetingRow.location,
        notes: resumo,
        scheduled_by: meeting.agendadoPor || null,
        meeting_owner: meeting.responsavel || null,
        client_email: meeting.emailCliente || null,
        booking_date: meeting.dataAgendamento || null,
      });
    } catch (e) {
      console.warn("[QS] falha ao registrar a reunião do ganho:", e);
    }
    setLeads((prev) => prev.map((l): Lead => l.id === leadId ? { ...l, status: "ganho" } : l));
    setTasks((prev) => prev.filter((t) => t.lead_id !== leadId));
    setActiveTaskId(null);
    setObsText("");
    setSavingMeeting(false);
    setMeetingFor(null);
    refreshCounts();
    showToast(`Ganho! Reunião agendada — ${leadName}`);
  }

  // Cria a atividade extra e aplica a REGRA: encerra todas as outras tarefas
  // pendentes do lead — ele fica só com a extra (destacada em azul).
  async function handleSaveExtra() {
    if (!extraTask.lead_id || !extraTask.date) return;
    setSavingExtra(true);
    const [h, m] = extraTask.time.split(":").map(Number);
    const scheduled = new Date(extraTask.date);
    scheduled.setHours(h || 9, m || 0, 0, 0);
    const lead = leads.find((l) => l.id === extraTask.lead_id);
    const { data } = await supabase.from("qs_tasks").insert({
      lead_id: extraTask.lead_id,
      cadence_id: lead?.cadence_id || null,
      owner_id: currentUser?.id || null,
      channel_type: extraTask.channel_type,
      priority: "alta",
      scheduled_at: scheduled.toISOString(),
      status: "pendente",
      is_extra: true,
      notes: extraTask.notes || null,
    }).select().single();
    const extra = data as Task | null;

    // REGRA: encerra as demais tarefas pendentes/atrasadas do lead (menos a extra e a de origem)
    const exclude = [extra?.id, extraFromTaskId].filter(Boolean) as string[];
    let q = supabase.from("qs_tasks").update({ status: "ignorada", skip_reason: "Substituída por atividade extra" })
      .eq("lead_id", extraTask.lead_id).in("status", ["pendente", "atrasada"]);
    if (exclude.length) q = q.not("id", "in", `(${exclude.join(",")})`);
    await q;

    // Se veio de "Pediu retorno", conclui a tarefa original + registra pro Bitrix
    const fromRetorno = extraFromTaskId;
    if (fromRetorno) {
      await completeTask(fromRetorno, "atendeu");
      await persistObservation(extraTask.lead_id, `Pediu retorno — atividade extra agendada para ${extraTask.date} ${extraTask.time}.${obsText.trim() ? " " + obsText.trim() : ""}`, ["bitrix", "retorno"]);
    }

    setSavingExtra(false);
    if (extra) {
      // Estado local: o lead fica só com a extra
      setTasks((prev) => [...prev.filter((t) => t.lead_id !== extraTask.lead_id), extra]);
      setShowExtraTaskModal(false);
      setExtraFromTaskId(null);
      setActiveTaskId(null);
      setObsText("");
      setExtraTask({ lead_id: "", channel_type: "ligacao", date: "", time: "09:00", notes: "", _searchText: "" });
      if (fromRetorno) refreshCounts();
      showToast(fromRetorno ? "Retorno agendado — atividade extra criada" : "Atividade extra criada");
    }
  }

  // "Pediu retorno" abre o modal de atividade extra já preenchido pro lead.
  function openExtraFromRetorno(task: Task) {
    const lead = getLeadForTask(task);
    const d = new Date(); d.setDate(d.getDate() + 1);
    const yyyy = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
    setExtraTask({
      lead_id: task.lead_id,
      channel_type: task.channel_type,
      date: `${yyyy}-${mm}-${dd}`,
      time: "09:00",
      notes: obsText.trim() || "Retorno solicitado pelo lead",
      _searchText: (lead?.full_name ?? "Lead") + (lead?.company_name ? ` · ${lead.company_name}` : ""),
    });
    setExtraFromTaskId(task.id);
    setPendingResult(null);
    setShowExtraTaskModal(true);
  }

  // Filter logic
  const filteredTasks = useMemo(() => {
    let filtered = [...tasks];

    // Guard: tarefas de leads já encerrados (ganho/perdido) não aparecem na fila
    filtered = filtered.filter((t) => {
      const st = getLeadForTask(t)?.status;
      return st !== "ganho" && st !== "perdido";
    });

    // Role-based filtering: SDR only sees their own tasks
    if (currentUser && !canSeeAllData(currentUser.role)) {
      filtered = filtered.filter((t) => t.owner_id === currentUser.id);
    }

    // Só o que é pra HOJE (ou atrasado). As atividades de dias FUTUROS da cadência
    // ficam guardadas e só entram na fila quando o dia chega — não poluem o hoje.
    const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
    const endMs = endOfToday.getTime();
    filtered = filtered.filter((t) => new Date(t.scheduled_at).getTime() <= endMs);

    if (statusFilter === "extras") {
      filtered = filtered.filter((t) => t.is_extra);
    } else if (statusFilter === "para_hoje") {
      filtered = filtered.filter((t) => t.status === "pendente");
    } else if (statusFilter === "atrasadas") {
      filtered = filtered.filter((t) => t.status === "atrasada");
    }

    if (channelFilter) {
      filtered = filtered.filter((t) => t.channel_type === channelFilter);
    }

    if (priorityFilter) {
      filtered = filtered.filter((t) => t.priority === priorityFilter);
    }

    if (ownerFilter) {
      filtered = filtered.filter((t) => t.owner_id === ownerFilter);
    }

    if (periodFilter) {
      filtered = filtered.filter((t) => {
        const h = new Date(t.scheduled_at).getHours();
        return periodFilter === "manha" ? h < 12 : h >= 12;
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((t) => {
        const lead = getLeadForTask(t);
        if (!lead) return false;
        return (
          (lead.full_name?.toLowerCase().includes(q)) ||
          (lead.company_name?.toLowerCase().includes(q)) ||
          (lead.email?.toLowerCase().includes(q)) ||
          (lead.phone?.includes(q)) ||
          (lead.bitrix_id?.toLowerCase().includes(q))
        );
      });
    }

    // ── Ordem da fila: MAIS NOVOS PRIMEIRO (item 7) ─────────────────
    // O topo é sempre o lead que chegou mais recentemente. O SDR pode clicar
    // em qualquer lead pra atendê-lo antes (vira o card ativo), mas o padrão
    // prioriza sempre os mais novos.
    const recencyTs = (t: Task): number => {
      const lead = getLeadForTask(t);
      const iso = lead?.arrived_at || lead?.created_at || t.scheduled_at;
      return new Date(iso).getTime();
    };
    const prioRank: Record<PriorityLevel, number> = { alta: 0, media: 1, baixa: 2 };
    filtered.sort((a, b) => {
      const ra = recencyTs(a), rb = recencyTs(b);
      if (ra !== rb) return rb - ra; // desc → mais novo primeiro
      const pa = prioRank[a.priority], pb = prioRank[b.priority];
      if (pa !== pb) return pa - pb; // desempate por prioridade
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    });

    return filtered;
  }, [tasks, leads, cadences, search, statusFilter, channelFilter, priorityFilter, periodFilter, ownerFilter]);

  const endTodayMs = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })();
  const todayTasks = tasks.filter((t) => t.status === "pendente" && new Date(t.scheduled_at).getTime() <= endTodayMs);
  const overdueTasks = tasks.filter((t) => t.status === "atrasada");
  const extraTasks = tasks.filter((t) => t.is_extra);

  // Hot lead detection (Change 2)
  const hotLead = useMemo(() => {
    const now = Date.now();
    for (const task of tasks) {
      if (task.completed_at || task.status === "concluida") continue;
      const cadence = getCadenceForTask(task);
      if (cadence?.acquisition_channel !== "levantada_de_mao") continue;
      const lead = getLeadForTask(task);
      if (!lead?.arrived_at) continue;
      const arrivedMs = new Date(lead.arrived_at).getTime();
      const diffMin = Math.floor((now - arrivedMs) / 60000);
      if (diffMin >= 0 && diffMin <= 3) {
        return { task, lead, diffMin };
      }
    }
    return null;
  }, [tasks, leads, cadences]);

  // Placar real: concluídas hoje/mês vs metas (qs_goals, com fallback nos padrões)
  const DAILY_DONE = doneCounts.doneToday;
  const TOTAL_SCHEDULED = tasks.length;
  const MONTHLY_DONE = doneCounts.doneMonth;
  const dailyGoal = goalTargets.daily ?? DAILY_GOAL;
  const monthlyGoal = goalTargets.monthly ?? MONTHLY_GOAL;
  const dailyPct = dailyGoal > 0 ? Math.min((DAILY_DONE / dailyGoal) * 100, 100) : 0;
  const monthlyPct = monthlyGoal > 0 ? Math.min((MONTHLY_DONE / monthlyGoal) * 100, 100) : 0;
  const monthlyBeat = MONTHLY_DONE >= monthlyGoal;
  // Métricas de tempo dentro do horário de funcionamento (Configurações → Horário de Trabalho)
  const now = new Date();
  const totalMinLeft = minutesLeftToday(workHours, now);
  const hoursLeft = Math.floor(totalMinLeft / 60);
  const minutesLeft = totalMinLeft % 60;
  const hoursWorked = Math.max(0.1, minutesWorkedToday(workHours, now) / 60);
  const rhythm = Math.round((DAILY_DONE / hoursWorked) * 10) / 10;

  // Saudação (design Execução)
  const greetHour = now.getHours();
  const greetWord = greetHour < 12 ? "Bom dia" : greetHour < 18 ? "Boa tarde" : "Boa noite";
  const firstName = currentUser?.name?.split(" ")[0] ?? "";
  const todayLabel = now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" });
  const remainingGoal = Math.max(0, dailyGoal - DAILY_DONE);

  // Celebration effect when daily goal is hit
  useEffect(() => {
    if (DAILY_DONE >= dailyGoal && !celebrationShown) {
      setCelebrationShown(true);
      setShowCelebration(true);
      setTimeout(() => setShowCelebration(false), 3000);
    }
  }, [DAILY_DONE, celebrationShown]);

  // ── Renderizadores do design "Execução" (hero + pílulas) ───────────────────

  const periodOf = (task: Task): PeriodFilter =>
    new Date(task.scheduled_at).getHours() < 12 ? "manha" : "tarde";

  // Item 7 — escolher qual lead atender (vira o card ativo); reseta os campos.
  function selectActive(taskId: string) {
    setActiveTaskId(taskId);
    setObsText("");
    setPendingResult(null);
    setTransferOpen(false);
    setTransferTo("");
    setSkipMenuOpen(false);
  }

  // Card compacto da coluna de Atividades extras (retornos), destacado em azul.
  function renderExtraPill(task: Task) {
    const lead = getLeadForTask(task);
    const isActive = activeTaskId === task.id;
    const d = new Date(task.scheduled_at);
    const when = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " · " + formatTime(task.scheduled_at);
    return (
      <div key={task.id} onClick={() => selectActive(task.id)} className={`qsx-extra-card${isActive ? " on" : ""}`} title="Clique para atender">
        <div className="flex items-center gap-2">
          <span className={`qsx-chan-ic ${CHANNEL_IC_CLASS[task.channel_type]}`} style={{ width: 30, height: 30, borderRadius: 9 }}>
            <ChannelIcon type={task.channel_type} size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold truncate" style={{ color: "var(--ink)" }}>{lead?.full_name || "Lead"}</div>
            <div className="text-[11.5px] font-semibold" style={{ color: "var(--blue)" }}>{when}</div>
          </div>
        </div>
        <div className="text-[12px] mt-1.5 line-clamp-2" style={{ color: "var(--ink2)" }}>{task.notes || getActivityLabel(task.channel_type)}</div>
      </div>
    );
  }

  function renderPill(task: Task) {
    const lead = getLeadForTask(task);
    const cadence = getCadenceForTask(task);
    const slaAlert = getSlaAlert(lead, task, cadence);
    const prio = task.priority as PriorityLevel;
    const temp = computeLeadScore(lead, cadence, getAttemptCount(task) - 1);
    const isActive = activeTaskId === task.id;
    return (
      <div key={task.id} onClick={() => selectActive(task.id)} className={`qsx-pill${isActive ? " sel" : ""}`} title="Clique para atender este lead">
        <div className="qsx-time">{formatTime(task.scheduled_at)}</div>
        <span className={`qsx-chan-ic ${CHANNEL_IC_CLASS[task.channel_type]}`} style={{ width: 44, height: 44, borderRadius: 13 }}>
          <ChannelIcon type={task.channel_type} size={19} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {lead ? (
              <button onClick={(e) => { e.stopPropagation(); onOpenLead(lead.id); }} className="qsx-name-btn qsx-lname truncate min-w-0 max-w-full" title="Ver informações do lead">
                {lead.full_name || "Lead"}
              </button>
            ) : (
              <span className="qsx-lname truncate min-w-0 max-w-full">Lead desconhecido</span>
            )}
            <span className="qsx-chip" style={{ background: temp.bg, color: temp.color }} title={`Lead score ${temp.score}/100`}>{temp.label}</span>
            <span className={`qsx-chip prio-${prio}`}><span className={`qsx-dot dot-${prio}`} />{PRIORITY_LABELS[prio]}</span>
            {slaAlert && (
              <span className="qsx-chip" style={{ background: slaAlert.bg, color: slaAlert.text, animation: slaAlert.pulse ? "pulseRed 1.5s ease-in-out infinite" : undefined }}>
                {slaAlert.label}
              </span>
            )}
            {task.is_extra && <span className="qsx-chip prio-baixa">Extra</span>}
          </div>
          <div className="qsx-pco mt-1">
            {lead?.company_name && <b>{lead.company_name}</b>}
            {lead?.company_name ? " · " : ""}
            {getActivityLabel(task.channel_type)}
            {cadence ? ` · ${cadence.name}` : ""}
          </div>
        </div>
        <div className="hidden lg:block shrink-0" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink2)", marginRight: 2 }}>
          {CHANNEL_LABELS[task.channel_type]}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {task.channel_type === "whatsapp" && lead?.phone && (
            <button onClick={(e) => { e.stopPropagation(); openWhatsApp(lead); }} className="qsx-pa qsx-pa-wa" title="Abrir no ChatApp e copiar o número">
              <IconWhatsApp size={18} />
            </button>
          )}
          {(task.channel_type === "ligacao_whatsapp" || task.channel_type === "ligacao") && lead?.phone && (
            <button onClick={(e) => { e.stopPropagation(); startWhatsAppCall(lead.phone); }} className="qsx-pa qsx-pa-wa" title="Ligar no WhatsApp">
              <IconWhatsApp size={18} />
            </button>
          )}
          {lead && (
            <button onClick={(e) => { e.stopPropagation(); onOpenLead(lead.id); }} className="qsx-pa" title="Ver informações do lead">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Liga pelo WEBFONE (voz dentro do sistema). Se o webfone não estiver
  // configurado/disponível, cai pro WhatsApp (abre a conversa pra ligar por lá).
  async function callViaWebfone(
    phone?: string | null,
    opts?: { leadName?: string | null; leadId?: string | null },
  ) {
    const r = await dialViaWavoip(phone, {
      displayName: opts?.leadName ?? undefined,
      leadName: opts?.leadName ?? undefined,
      leadId: opts?.leadId ?? null,
      ownerId: currentUser?.id ?? null,
    });
    if (!r.ok) {
      console.warn("[QS] webfone indisponível, caindo pro WhatsApp:", r.error);
      startWhatsAppCall(phone);
    }
  }

  // Só o botão do canal da tarefa (item 3). Ligação = webfone (fallback WhatsApp).
  function renderChannelAction(task: Task, lead: Lead | undefined) {
    switch (task.channel_type) {
      case "ligacao":
        return lead?.phone ? <button onClick={() => callViaWebfone(lead.phone, { leadName: lead.full_name, leadId: lead.id })} className="qsx-btn qsx-btn-green"><ChannelIcon type="ligacao" size={16} />Ligar</button> : null;
      case "ligacao_whatsapp":
        return lead?.phone ? <button onClick={() => startWhatsAppCall(lead.phone)} className="qsx-btn qsx-btn-green"><IconWhatsApp size={16} />Ligar no WhatsApp</button> : null;
      case "whatsapp":
        return lead?.phone ? <button onClick={() => openWhatsApp(lead)} className="qsx-btn qsx-btn-green"><IconWhatsApp size={16} />Abrir conversa</button> : null;
      case "email":
        return lead?.email ? <a href={`mailto:${lead.email}`} className="qsx-btn qsx-btn-green"><ChannelIcon type="email" size={16} />Escrever e-mail</a> : null;
      case "linkedin":
        return (
          <a href={lead?.linkedin_url ? (lead.linkedin_url.startsWith("http") ? lead.linkedin_url : `https://${lead.linkedin_url}`) : `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(lead?.full_name || "")}`} target="_blank" rel="noopener noreferrer" className="qsx-btn qsx-btn-green">
            <ChannelIcon type="linkedin" size={16} />Abrir LinkedIn
          </a>
        );
      default:
        return lead ? <button onClick={() => onOpenLead(lead.id)} className="qsx-btn qsx-btn-green">Ver informações</button> : null;
    }
  }

  function renderHero(task: Task, upNext: Task[]) {
    const lead = getLeadForTask(task);
    const cadence = getCadenceForTask(task);
    const slaAlert = getSlaAlert(lead, task, cadence);
    const prio = task.priority as PriorityLevel;
    const temp = computeLeadScore(lead, cadence, getAttemptCount(task) - 1);
    const isActiveCard = activeTaskId === task.id;
    const otherSdrs = qsUsers.filter((u) => u.id !== currentUser?.id);
    const outcomes: { key: string; label: string; tone: "win" | "lose" | "neutral" }[] = [
      { key: "ganho", label: "Ganho / Agendou", tone: "win" },
      { key: "sem_interesse", label: "Perdido", tone: "lose" },
      { key: "atendeu", label: "Pediu retorno", tone: "neutral" },
      { key: "nao_atendeu", label: "Não atendeu", tone: "neutral" },
      { key: "caixa_postal", label: "Caixa postal", tone: "neutral" },
      { key: "numero_errado", label: "Nº errado", tone: "lose" },
      { key: "desligou", label: "Desligou", tone: "neutral" },
    ];
    const pending = pendingResult && pendingResult.taskId === task.id ? pendingResult.result : null;

    return (
      <div className="qsx-hero mb-2">
        <div className={`qsx-hero-accent acc-${prio}`} style={task.is_extra ? { background: "var(--blue)" } : undefined} />
        <div className="qsx-hero-main">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="qsx-eyebrow" style={task.is_extra ? { color: "var(--blue)" } : undefined}>
              {task.is_extra ? "Atividade extra" : isActiveCard ? "Atendendo agora" : "Próxima atividade"}
            </span>
            <span className="qsx-chip" style={{ background: temp.bg, color: temp.color }} title={`Lead score ${temp.score}/100`}>{temp.label}</span>
            {slaAlert && (
              <span className="qsx-chip" style={{ background: slaAlert.bg, color: slaAlert.text, animation: slaAlert.pulse ? "pulseRed 1.5s ease-in-out infinite" : undefined }}>
                {slaAlert.label}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2.5">
              <span style={{ fontSize: 15, fontWeight: 800, color: "var(--ink2)", fontVariantNumeric: "tabular-nums" }}>
                {formatTime(task.scheduled_at)}
              </span>
              {lead && (
                <button onClick={() => setTransferOpen((o) => !o)} className={`qsx-icon-sm${transferOpen ? " on" : ""}`} title="Transferir lead para outro SDR" aria-label="Transferir lead">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5" /><path d="M21 3l-7 7" /><path d="M8 21H3v-5" /><path d="M3 21l7-7" /></svg>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className={`qsx-chan-ic ${CHANNEL_IC_CLASS[task.channel_type]}`} style={{ width: 46, height: 46, borderRadius: 14 }}>
              <ChannelIcon type={task.channel_type} size={20} />
            </span>
            <div className="min-w-0">
              {lead ? (
                <button onClick={() => onOpenLead(lead.id)} className="qsx-name-btn" title="Ver informações do lead">
                  <h2 className="qsx-hln truncate">{lead.full_name || "Lead"}</h2>
                </button>
              ) : (
                <h2 className="qsx-hln truncate">Lead</h2>
              )}
              <div className="qsx-hco truncate">
                {lead?.company_name || "—"}{lead?.job_title ? ` · ${lead.job_title}` : ""}
              </div>
              {(lead?.bitrix_id || (lead && (noteCounts.get(lead.id) || 0) > 0)) && (
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {lead?.bitrix_id && (
                    <span className="qsx-chip prio-baixa" style={{ fontVariantNumeric: "tabular-nums" }} title="ID do cliente (Bitrix)">ID {lead.bitrix_id}</span>
                  )}
                  {lead && (noteCounts.get(lead.id) || 0) > 0 && (
                    <span className="qsx-chip" style={{ background: "rgba(37,99,235,.10)", color: "var(--blue)" }} title="Este lead tem observações no perfil">
                      📝 {noteCounts.get(lead.id)} obs.
                    </span>
                  )}
                </div>
              )}
              {lead?.phone && (
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(formatPhoneDisplay(lead.phone));
                      setPhoneCopied(true);
                      setTimeout(() => setPhoneCopied(false), 2000);
                    } catch { /* clipboard bloqueado */ }
                  }}
                  className="flex items-center gap-1.5 mt-1 text-[13px] font-bold hover:underline"
                  style={{ color: phoneCopied ? "#0E7C6A" : "var(--ink2)", fontVariantNumeric: "tabular-nums" }}
                  title="Copiar telefone"
                >
                  {formatPhoneDisplay(lead.phone)}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  {phoneCopied && <span className="text-[11px] font-semibold">copiado!</span>}
                </button>
              )}
            </div>
            <div className="ml-auto flex gap-2 shrink-0">
              <span className="qsx-chip prio-baixa">{getActivityLabel(task.channel_type)}</span>
            </div>
          </div>

          {task.notes && <div className="qsx-hbox">{task.notes}</div>}

          {/* Ações: botão do canal + concluir atividade + pular */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {renderChannelAction(task, lead)}
            <button onClick={() => handleConcludeActivity(task)} className="qsx-btn qsx-btn-green" title="Marcar como concluída (conta no placar do dia)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Concluir atividade
            </button>
            <button
              onClick={() => setSkipMenuOpen((o) => !o)}
              className="qsx-btn qsx-btn-ghost"
              style={{ marginLeft: "auto" }}
            >
              <IconSkip />
              Pular
            </button>
          </div>

          {/* Motivo do pulo (vai pro skip_reason) */}
          {skipMenuOpen && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl flex-wrap" style={{ background: "var(--line2)" }}>
              <span className="text-[13px] font-semibold" style={{ color: "var(--ink2)" }}>Por que está pulando?</span>
              {["Aguardando retorno", "Horário inadequado", "Priorizar outro", "Outro"].map((reason) => (
                <button
                  key={reason}
                  onClick={async () => {
                    await skipTask(task.id, reason);
                    setTasks((prev) => prev.filter((t) => t.id !== task.id));
                    setActiveTaskId(null);
                    setSkipMenuOpen(false);
                  }}
                  className="qsx-out"
                >
                  {reason}
                </button>
              ))}
              <button onClick={() => setSkipMenuOpen(false)} className="text-[13px] font-semibold hover:underline" style={{ color: "var(--ink3)", marginLeft: "auto" }}>
                Cancelar
              </button>
            </div>
          )}

          {/* Transferir 1 lead pra outro SDR (item 5) */}
          {transferOpen && lead && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl flex-wrap" style={{ background: "var(--line2)" }}>
              <span className="text-[13px] font-semibold" style={{ color: "var(--ink2)" }}>Transferir este lead para:</span>
              <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className="qsx-fchip" style={{ height: 38 }}>
                <option value="">Escolha um SDR…</option>
                {otherSdrs.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button onClick={() => handleTransfer(task)} disabled={!transferTo} className="qsx-btn qsx-btn-blue" style={{ height: 38, opacity: transferTo ? 1 : 0.5 }}>Enviar lead</button>
              <button onClick={() => { setTransferOpen(false); setTransferTo(""); }} className="qsx-btn qsx-btn-ghost" style={{ height: 38 }}>Cancelar</button>
            </div>
          )}

          {/* Observações + desfecho (itens 1 e 4) */}
          <div style={{ borderTop: "1px solid var(--line2)", paddingTop: 14 }}>
            <div className="flex items-center justify-between mb-2">
              <div className="qsx-side-lab" style={{ margin: 0 }}>Observações da atividade</div>
              <button onClick={() => handleSaveObs(task.lead_id)} disabled={!obsText.trim() || savingObs} className="text-[12px] font-bold" style={{ color: obsText.trim() ? "#0E7C6A" : "var(--ink3)" }}>
                {savingObs ? "Salvando…" : "Salvar no Bitrix"}
              </button>
            </div>
            <textarea
              value={obsText}
              onChange={(e) => setObsText(e.target.value)}
              rows={2}
              placeholder="Anote o que rolou no contato… (vai como resumo para o Bitrix)"
              className="w-full px-3 py-2 text-sm rounded-xl resize-none"
              style={{ border: "1px solid var(--line)", background: "#fff", outline: "none", fontFamily: "inherit", color: "var(--ink)" }}
            />

            <div className="qsx-side-lab" style={{ margin: "12px 0 9px" }}>
              Como foi o contato? · Tentativa {getAttemptCount(task)}/{MAX_CONTACT_ATTEMPTS}
            </div>
            {/* Caminho principal: positivo em destaque, retorno/perdido médios */}
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => openMeetingGanho(task)} className="qsx-out-primary">
                Ganho / Agendou
              </button>
              <button onClick={() => openExtraFromRetorno(task)} className="qsx-out" data-tone="neutral">
                Pediu retorno
              </button>
              <button
                onClick={() => setPendingResult({ taskId: task.id, result: "sem_interesse" })}
                className="qsx-out"
                data-tone="lose"
                data-on={pending === "sem_interesse" ? "1" : undefined}
              >
                Perdido
              </button>
            </div>
            {/* Desfechos "sem contato" — recuados, o SDR só olha quando precisa */}
            <div className="flex items-center gap-2 flex-wrap mt-2.5">
              <span className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>Sem contato:</span>
              {["nao_atendeu", "caixa_postal", "numero_errado", "desligou"].map((key) => (
                <button
                  key={key}
                  onClick={() => setPendingResult({ taskId: task.id, result: key })}
                  className="qsx-out-mini"
                  data-on={pending === key ? "1" : undefined}
                >
                  {outcomes.find((o) => o.key === key)?.label}
                </button>
              ))}
            </div>
            {pending && (
              <div className="mt-3 flex items-center gap-2 p-2.5 rounded-xl flex-wrap" style={{ background: "#FFF7ED", border: "1px solid #FED7AA" }}>
                <span className="text-[13px]" style={{ color: "var(--ink2)" }}>
                  Confirmar: <b style={{ color: "var(--ink)" }}>{outcomes.find((o) => o.key === pending)?.label}</b>? {obsText.trim() && <span style={{ color: "var(--ink3)" }}>(a observação vai junto no resumo)</span>}
                </span>
                <button
                  onClick={async () => {
                    if (finalizing) return; // anti duplo-clique
                    setFinalizing(true);
                    try {
                      await handleContactResult(task.id, pending);
                      setPendingResult(null);
                    } finally {
                      setFinalizing(false);
                    }
                  }}
                  disabled={finalizing}
                  className="qsx-btn qsx-btn-orange"
                  style={{ height: 38, marginLeft: "auto", opacity: finalizing ? 0.6 : 1 }}
                >
                  {finalizing ? "Finalizando…" : "Finalizar"}
                </button>
                <button onClick={() => setPendingResult(null)} disabled={finalizing} className="qsx-btn qsx-btn-ghost" style={{ height: 38 }}>
                  Cancelar
                </button>
              </div>
            )}
          </div>
        </div>

        {upNext.length > 0 && !chatDock.isOpen && (
          <div className="qsx-hero-side">
            <div className="qsx-side-lab">A seguir · clique para atender</div>
            {upNext.map((t) => {
              const l = getLeadForTask(t);
              const p = t.priority as PriorityLevel;
              return (
                <div key={t.id} className="qsx-mini" onClick={() => selectActive(t.id)} title="Atender este lead">
                  <span className="qsx-mini-time">{formatTime(t.scheduled_at)}</span>
                  <span className={`qsx-chan-ic ${CHANNEL_IC_CLASS[t.channel_type]}`} style={{ width: 34, height: 34, borderRadius: 10 }}>
                    <ChannelIcon type={t.channel_type} size={15} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="qsx-mini-n">{l?.full_name || "Lead"}</div>
                    <div className="qsx-mini-c">{l?.company_name || "—"}</div>
                  </div>
                  <span className={`qsx-dot dot-${p}`} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────

  if (loading) {
    // Skeleton no formato da tela real (saudação + hero + pílulas)
    const sk = (w: string | number, h: number, r = 12) => (
      <div style={{ width: w, height: h, borderRadius: r, background: "var(--line2, #EEF1F5)", animation: "skPulse 1.4s ease-in-out infinite" }} />
    );
    return (
      <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--bg)" }}>
        <style>{`@keyframes skPulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }`}</style>
        <div className="px-4 md:px-6 pt-5 pb-4" style={{ background: "#fff", borderBottom: "1px solid var(--line)" }}>
          <div className="flex flex-col gap-4" style={{ maxWidth: 1400, margin: "0 auto" }}>
            <div className="flex flex-wrap items-center gap-3">{sk(180, 24)}{sk(300, 16)}</div>
            <div className="flex flex-wrap items-center gap-3">{sk("40%", 48, 14)}{sk(150, 48, 14)}{sk(140, 48, 14)}{sk(140, 48, 14)}</div>
            <div className="flex flex-wrap items-center gap-8">{sk(180, 30)}{sk(180, 30)}</div>
          </div>
        </div>
        <div className="px-4 md:px-6 pt-4">
          <div className="flex flex-col gap-3" style={{ maxWidth: 1400, margin: "0 auto" }}>
            {sk("100%", 260, 22)}
            {sk("100%", 76, 20)}
            {sk("100%", 76, 20)}
            {sk("100%", 76, 20)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg)" }}>
      {/* CSS Keyframes */}
      <style>{`
        @keyframes pulseRed { 0%,100% { opacity:1 } 50% { opacity:0.5 } }
        @keyframes pulseBorderRed { 0%,100% { border-left-color: #EF4444; } 50% { border-left-color: #FCA5A5; } }
        @keyframes flashGreen { 0% { background: #D1FAE5; } 100% { background: transparent; } }
        @keyframes flashGray { 0% { background: #F3F4F6; } 100% { background: transparent; } }
        @keyframes pulseBanner { 0%,100% { opacity:1 } 50% { opacity:0.85 } }
        @keyframes confettiFall {
          0% { transform: translateY(-10px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @keyframes toastIn { 0% { opacity: 0; transform: translateY(20px); } 100% { opacity: 1; transform: translateY(0); } }
        @keyframes toastOut { 0% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(20px); } }

        /* ── Design "Execução" (Turis) — usado no Painel de Atividades ── */
        .qsx-page { max-width: 1400px; margin: 0 auto; }
        .qsx-greet h2 { font-size: 20px; font-weight: 800; letter-spacing: -.2px; color: var(--ink); margin: 0; }
        .qsx-sub { font-size: 14px; color: var(--ink2); }
        .qsx-hl { color: var(--orange); font-weight: 800; }

        .qsx-search { flex: 1; display: flex; align-items: center; gap: 11px; height: 48px; padding: 0 16px; background: #fff; border: 1px solid var(--line); border-radius: 14px; }
        .qsx-search input { border: 0; outline: 0; background: transparent; flex: 1; font-size: 14.5px; color: var(--ink); font-family: inherit; }
        .qsx-search input::placeholder { color: var(--ink3); }
        .qsx-btn { height: 48px; padding: 0 18px; border-radius: 14px; font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 8px; border: 0; color: #fff; cursor: pointer; white-space: nowrap; transition: filter .15s; }
        .qsx-btn:hover { filter: brightness(1.06); }
        .qsx-btn-green { background: var(--green); box-shadow: 0 8px 18px -8px rgba(18,161,138,.6); }
        .qsx-btn-blue { background: var(--blue); box-shadow: 0 8px 18px -8px rgba(37,99,235,.6); }
        .qsx-btn-orange { background: var(--orange); box-shadow: 0 8px 18px -8px rgba(245,130,31,.6); }
        .qsx-btn-ghost { background: #fff; border: 1px solid var(--line); color: var(--ink); }
        .qsx-btn-ghost:hover { background: var(--line2); filter: none; }

        .qsx-metric { display: flex; flex-direction: column; gap: 7px; min-width: 168px; }
        .qsx-mtop { display: flex; align-items: center; gap: 7px; }
        .qsx-mdot { width: 9px; height: 9px; border-radius: 50%; }
        .qsx-mlab { font-size: 10.5px; font-weight: 800; letter-spacing: .9px; text-transform: uppercase; color: var(--ink3); }
        .qsx-mnums { margin-left: auto; font-weight: 800; font-size: 14px; font-variant-numeric: tabular-nums; color: var(--ink); }
        .qsx-mnums span { color: var(--ink3); font-weight: 700; }
        .qsx-bar { height: 7px; border-radius: 999px; background: var(--line2); overflow: hidden; }
        .qsx-bar i { display: block; height: 100%; border-radius: 999px; }
        .qsx-pace { display: flex; align-items: center; gap: 9px; padding: 9px 15px; background: #fff; border: 1px solid var(--line); border-radius: 999px; font-size: 13px; color: var(--ink2); font-weight: 600; white-space: nowrap; }
        .qsx-pace b { color: var(--ink); font-weight: 800; }
        .qsx-pace .sep { width: 4px; height: 4px; border-radius: 50%; background: var(--line); flex: none; }

        /* Hero — Próxima atividade */
        .qsx-hero { display: flex; background: #fff; border: 1px solid var(--line); border-radius: 18px; overflow: hidden; box-shadow: 0 1px 2px rgba(16,24,40,.04), 0 12px 28px -22px rgba(16,24,40,.30); }
        .qsx-hero-accent { width: 4px; flex: none; opacity: .9; }
        .acc-alta { background: var(--red); } .acc-media { background: var(--amber); } .acc-baixa { background: var(--ink3); }
        .qsx-hero-main { flex: 1; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .qsx-eyebrow { font-size: 11.5px; font-weight: 700; letter-spacing: .2px; color: var(--ink3); }
        .qsx-hln { font-size: 18px; font-weight: 800; letter-spacing: -.3px; margin: 0; color: var(--ink); }
        .qsx-hco { font-size: 13px; color: var(--ink2); font-weight: 500; margin-top: 2px; }
        .qsx-hbox { background: #FAFBFC; border: 1px solid var(--line2); border-radius: 13px; padding: 10px 13px; font-size: 13px; color: var(--ink2); line-height: 1.45; }
        .qsx-hbox b { color: var(--ink); font-weight: 700; }
        .qsx-hero-side { width: 260px; flex: none; border-left: 1px solid var(--line); padding: 16px; background: #FAFBFC; display: flex; flex-direction: column; gap: 4px; }
        .qsx-side-lab { font-size: 11.5px; font-weight: 700; letter-spacing: .2px; color: var(--ink3); margin-bottom: 8px; }
        .qsx-mini { display: flex; align-items: center; gap: 11px; padding: 10px; border-radius: 13px; cursor: pointer; }
        .qsx-mini:hover { background: #fff; box-shadow: 0 2px 10px -4px rgba(23,32,46,.15); }
        .qsx-mini-time { font-size: 13px; font-weight: 800; color: var(--ink2); width: 42px; font-variant-numeric: tabular-nums; }
        .qsx-mini-n { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink); }
        .qsx-mini-c { font-size: 12px; color: var(--ink3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* Ícone de canal (redondo colorido) */
        .qsx-chan-ic { display: flex; align-items: center; justify-content: center; flex: none; }
        .ic-call { background: rgba(18,161,138,.12); color: var(--green); }
        .ic-whats { background: rgba(37,187,108,.13); color: #1DA453; }
        .ic-mail { background: rgba(37,99,235,.11); color: var(--blue); }
        .ic-pesquisa { background: rgba(79,70,229,.11); color: #4F46E5; }
        .ic-linkedin { background: rgba(10,102,194,.12); color: #0A66C2; }
        .ic-social { background: rgba(219,39,119,.10); color: #DB2777; }

        /* Chips de prioridade */
        .qsx-chip { height: 26px; padding: 0 11px; border-radius: 999px; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
        .prio-alta { background: rgba(229,72,77,.11); color: var(--red); }
        .prio-media { background: rgba(232,146,11,.13); color: var(--amber); }
        .prio-baixa { background: var(--line2); color: var(--ink2); }
        .qsx-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
        .dot-alta { background: var(--red); } .dot-media { background: var(--amber); } .dot-baixa { background: var(--ink3); }

        /* Rótulo de grupo (Manhã / Tarde) */
        .qsx-glabel { font-size: 12.5px; font-weight: 700; letter-spacing: .1px; color: var(--ink3); margin: 22px 2px 11px; display: flex; align-items: center; gap: 9px; }
        .qsx-glabel:before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .35; }

        /* Pílula da fila */
        .qsx-pill { display: flex; align-items: center; gap: 15px; min-height: 76px; padding: 0 14px 0 20px; background: #fff; border: 1px solid var(--line); border-radius: 20px; cursor: pointer; transition: box-shadow .16s, border-color .16s, transform .16s; }
        .qsx-pill:hover { border-color: #d3dae5; box-shadow: 0 14px 30px -20px rgba(23,32,46,.4); transform: translateY(-1px); }
        .qsx-pill.sel { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(37,99,235,.12); }
        .qsx-time { font-variant-numeric: tabular-nums; font-weight: 800; color: var(--ink); font-size: 15px; width: 48px; flex: none; }
        .qsx-lname { font-weight: 700; font-size: 15px; color: var(--ink); }
        .qsx-pco { font-size: 13px; color: var(--ink3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
        .qsx-pco b { color: var(--ink2); font-weight: 700; }
        .qsx-pa { width: 42px; height: 42px; border-radius: 50%; border: 1px solid var(--line); background: #fff; color: var(--ink2); display: flex; align-items: center; justify-content: center; cursor: pointer; flex: none; transition: background .15s; }
        .qsx-pa:hover { background: var(--line2); }
        .qsx-pa-wa { background: rgba(18,161,138,.12); color: var(--green); border: 0; }
        .qsx-pa-wa:hover { background: rgba(18,161,138,.2); }
        .qsx-pa-go { background: var(--blue); color: #fff; border: 0; box-shadow: 0 8px 16px -8px rgba(37,99,235,.7); }
        .qsx-pa-go:hover { background: var(--blue-ink); }

        /* Chip de filtro (select estilizado) */
        .qsx-fchip { height: 36px; padding: 0 12px; border-radius: 999px; background: #fff; border: 1px solid var(--line); font-size: 13px; font-weight: 600; color: var(--ink2); cursor: pointer; font-family: inherit; outline: 0; transition: border-color .15s; }
        .qsx-fchip:hover { border-color: #d5dae2; }
        .qsx-fchip.on { background: var(--ink); color: #fff; border-color: var(--ink); }

        /* Nome do lead clicável (abre as informações) */
        .qsx-name-btn { background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; text-align: left; min-width: 0; max-width: 100%; }
        .qsx-name-btn.qsx-lname:hover { color: var(--blue); text-decoration: underline; }
        .qsx-name-btn:hover .qsx-hln { color: var(--blue); text-decoration: underline; }

        /* Botões de desfecho do contato (no card da próxima atividade) */
        .qsx-out { height: 34px; padding: 0 12px; border-radius: 10px; font-size: 12.5px; font-weight: 700; border: 1.5px solid var(--line); background: #fff; color: var(--ink2); cursor: pointer; white-space: nowrap; font-family: inherit; transition: background .12s, border-color .12s; }
        .qsx-out:hover { border-color: #d3dae5; background: var(--line2); }
        .qsx-out[data-tone="win"] { border-color: rgba(18,161,138,.4); color: #0E7C6A; background: rgba(18,161,138,.06); }
        .qsx-out[data-tone="lose"] { border-color: rgba(229,72,77,.35); color: var(--red); background: rgba(229,72,77,.05); }
        .qsx-out[data-on="1"] { background: var(--ink); color: #fff; border-color: var(--ink); }

        /* Botão pequeno de ícone (ex.: Transferir, ao lado do horário) */
        .qsx-icon-sm { width: 30px; height: 30px; border-radius: 9px; border: 1px solid var(--line); background: #fff; color: var(--ink3); display: flex; align-items: center; justify-content: center; cursor: pointer; flex: none; transition: background .12s, color .12s, border-color .12s; }
        .qsx-icon-sm:hover { background: var(--line2); color: var(--ink2); }
        .qsx-icon-sm.on { background: rgba(37,99,235,.10); color: var(--blue); border-color: rgba(37,99,235,.3); }

        /* Atividades extras (retornos) — coluna à esquerda alinhada ao cabeçalho, em azul */
        .qsx-extras-head { font-size: 12.5px; font-weight: 700; letter-spacing: .1px; color: var(--blue); margin: 0 2px 11px; display: flex; align-items: center; gap: 8px; }
        .qsx-extra-card { background: rgba(37,99,235,.06); border: 1.5px solid rgba(37,99,235,.35); border-radius: 16px; padding: 12px 14px; cursor: pointer; transition: box-shadow .15s, border-color .15s; }
        .qsx-extra-card:hover { border-color: var(--blue); box-shadow: 0 10px 24px -16px rgba(37,99,235,.6); }
        .qsx-extra-card.on { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(37,99,235,.15); }

        /* Fila: extras à esquerda (alinhado ao topo) + card largo ocupando o resto */
        .qsx-fila-row { display: flex; gap: 20px; align-items: flex-start; }
        .qsx-fila-extras { width: 260px; flex: none; }
        .qsx-fila-main { flex: 1 1 auto; min-width: 0; }
        @media (max-width: 1100px) { .qsx-fila-extras { width: 230px; } }

        /* ── Celular (≤767px): empilha as colunas do hero e da fila ── */
        @media (max-width: 767px) {
          .qsx-hero { flex-direction: column; }
          .qsx-hero-accent { width: 100%; height: 4px; }
          .qsx-hero-main { padding: 20px 18px; gap: 14px; }
          .qsx-hero-side { width: 100%; border-left: 0; border-top: 1px solid var(--line); }
          .qsx-hln { font-size: 20px; }
          .qsx-fila-row { flex-direction: column; align-items: stretch; gap: 14px; }
          .qsx-fila-extras { width: 100%; }
          .qsx-fila-main { width: 100%; }
        }

        /* Botão do topo em versão calma (só a ação principal fica cheia) */
        .qsx-btn-soft { background: #fff; border: 1px solid var(--line); color: var(--ink); box-shadow: none; }
        .qsx-btn-soft:hover { background: var(--line2); filter: none; }

        /* Desfecho — hierarquia: caminho positivo salta, os raros recuam */
        .qsx-out-primary { height: 40px; padding: 0 20px; border-radius: 11px; font-size: 13.5px; font-weight: 800; border: 0; background: var(--green); color: #fff; cursor: pointer; white-space: nowrap; font-family: inherit; box-shadow: 0 8px 18px -10px rgba(18,161,138,.65); transition: filter .12s; }
        .qsx-out-primary:hover { filter: brightness(1.05); }
        .qsx-out-mini { height: 30px; padding: 0 11px; border-radius: 9px; font-size: 12px; font-weight: 600; border: 1px solid var(--line); background: #fff; color: var(--ink3); cursor: pointer; white-space: nowrap; font-family: inherit; transition: background .12s, color .12s; }
        .qsx-out-mini:hover { background: var(--line2); color: var(--ink2); }
        .qsx-out-mini[data-on="1"] { background: var(--ink); color: #fff; border-color: var(--ink); }

        /* Foco visível — conforto pra quem navega por teclado o dia todo */
        .qsx-btn:focus-visible, .qsx-out:focus-visible, .qsx-out-primary:focus-visible, .qsx-out-mini:focus-visible,
        .qsx-fchip:focus-visible, .qsx-pill:focus-visible, .qsx-icon-sm:focus-visible, .qsx-name-btn:focus-visible,
        .qsx-extra-card:focus-visible, .qsx-mini:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
        .qsx-search:focus-within { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(37,99,235,.12); }

        /* Respeita quem prefere menos movimento (uso o dia inteiro) */
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; scroll-behavior: auto !important; }
        }
      `}</style>

      {/* ══════════════════════════════════════════════════════════════════════
          CELEBRATION CONFETTI (Change 5)
          ══════════════════════════════════════════════════════════════════════ */}
      {showCelebration && (
        <div className="fixed inset-0 pointer-events-none z-[100]">
          {Array.from({ length: 40 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                width: 8 + Math.random() * 8,
                height: 8 + Math.random() * 8,
                left: `${Math.random() * 100}%`,
                top: -10,
                background: ["#F97316", "#3B82F6", "#10B981", "#EAB308", "#8B5CF6", "#EC4899"][i % 6],
                animation: `confettiFall ${1.5 + Math.random() * 2}s ease-out forwards`,
                animationDelay: `${Math.random() * 0.5}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TOAST NOTIFICATION (Change 7)
          ══════════════════════════════════════════════════════════════════════ */}
      {toast && (
        <div
          className="fixed bottom-4 right-4 z-[100] bg-gray-900 text-white px-4 py-3 rounded-lg shadow-xl text-sm font-medium"
          style={{
            animation: toast.visible ? "toastIn 0.3s ease-out" : "toastOut 0.3s ease-out forwards",
          }}
        >
          {toast.message}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          HOT LEAD NOTIFICATION BANNER (Change 2)
          ══════════════════════════════════════════════════════════════════════ */}
      {hotLead && (
        <div
          className="shrink-0 bg-red-500 text-white px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-y-2"
          style={{ animation: "pulseBanner 2s ease-in-out infinite" }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg">&#128308;</span>
            <span className="text-sm font-bold">Lead quente chegou!</span>
            <span className="text-sm font-medium">
              {hotLead.lead.full_name} &mdash; {hotLead.lead.company_name}
            </span>
            <span className="text-xs opacity-80">
              &middot; H&aacute; {hotLead.diffMin} min
            </span>
          </div>
          <button
            onClick={() => openWhatsApp(hotLead.lead)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-white text-red-600 hover:bg-red-50 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
              <path d="M14.05 2a9 9 0 0 1 8 7.94"/>
              <path d="M14.05 6A5 5 0 0 1 18 10"/>
            </svg>
            Atender agora
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          DAILY BRIEFING (Change 3)
          ══════════════════════════════════════════════════════════════════════ */}

      {/* ══════════════════════════════════════════════════════════════════════
          HEADER SECTION
          ══════════════════════════════════════════════════════════════════════ */}
      <div className="shrink-0 px-4 md:px-6 pt-5 pb-4" style={{ background: "#fff", borderBottom: "1px solid var(--line)" }}>
        <div className="qsx-page">
          {/* Saudação */}
          <div className="qsx-greet flex items-baseline gap-3 flex-wrap">
            <h2>{greetWord}{firstName ? `, ${firstName}` : ""}</h2>
            <span className="qsx-sub">
              Você tem <span className="qsx-hl">{TOTAL_SCHEDULED} atividade{TOTAL_SCHEDULED !== 1 ? "s" : ""}</span> na fila de hoje · <span className="capitalize">{todayLabel}</span>
            </span>
          </div>

          {/* Comando: busca + ações rápidas */}
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <div className="qsx-search">
              <span style={{ color: "var(--ink3)", display: "flex" }}><IconSearch size={16} /></span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar por ID, lead, empresa, e-mail ou telefone…"
                aria-label="Pesquisar leads na fila"
              />
            </div>
            <button onClick={() => setShowDialer(true)} className="qsx-btn qsx-btn-soft">
              <span style={{ color: "var(--green)", display: "flex" }}><IconPhoneCall size={16} /></span>
              Ligação Manual
            </button>
            <button onClick={() => setShowExtraTaskModal(true)} className="qsx-btn qsx-btn-soft">
              <span style={{ color: "var(--blue)", display: "flex" }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></span>
              Atividade Extra
            </button>
            <button onClick={() => setShowNewLeadModal(true)} className="qsx-btn qsx-btn-orange">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              Cadastrar Lead
            </button>
          </div>

          {/* Contexto: métricas + ritmo */}
          <div className="flex items-center justify-between gap-5 mt-5 flex-wrap">
            <div className="flex flex-wrap items-center gap-8">
              <div className="qsx-metric">
                <div className="qsx-mtop">
                  <span className="qsx-mdot" style={{ background: dailyPct >= 100 ? "var(--green)" : "var(--amber)" }} />
                  <span className="qsx-mlab">Meta de hoje</span>
                  <span className="qsx-mnums">{DAILY_DONE}<span>/{dailyGoal}</span></span>
                </div>
                <div className="qsx-bar"><i style={{ width: `${dailyPct}%`, background: dailyPct >= 100 ? "var(--green)" : "var(--amber)" }} /></div>
              </div>
              <div className="qsx-metric">
                <div className="qsx-mtop">
                  <span className="qsx-mdot" style={{ background: monthlyBeat ? "var(--green)" : "var(--blue)" }} />
                  <span className="qsx-mlab">Meta do mês</span>
                  <span className="qsx-mnums">{MONTHLY_DONE.toLocaleString("pt-BR")}<span>/{monthlyGoal.toLocaleString("pt-BR")}</span></span>
                </div>
                <div className="qsx-bar"><i style={{ width: `${monthlyPct}%`, background: monthlyBeat ? "var(--green)" : "var(--blue)" }} /></div>
              </div>
            </div>
            <div className="qsx-pace">
              <span style={{ color: "var(--orange)", display: "flex" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              </span>
              Ritmo <b>{rhythm.toFixed(1)}/h</b><span className="sep" />faltam <b>{remainingGoal}</b><span className="sep" /><b>~{hoursLeft}h{String(minutesLeft).padStart(2, "0")}</b> restantes
              {monthlyBeat && <><span className="sep" /><b style={{ color: "var(--green)" }}>Meta mensal batida!</b></>}
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          FILTERS SECTION
          ══════════════════════════════════════════════════════════════════════ */}
      <div className="shrink-0 px-4 md:px-6 pt-4 pb-1" style={{ background: "var(--bg)" }}>
        <div className="qsx-page flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[16px] font-extrabold" style={{ color: "var(--ink)", letterSpacing: "-.1px" }}>Fila de hoje</span>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={statusFilter || ""}
              onChange={(e) => setStatusFilter(e.target.value as any || null)}
              className={`qsx-fchip${statusFilter ? " on" : ""}`}
              aria-label="Filtrar por status"
            >
              <option value="">Status</option>
              <option value="extras">Extras ({extraTasks.length})</option>
              <option value="para_hoje">Para hoje ({todayTasks.length})</option>
              <option value="atrasadas">Atrasadas ({overdueTasks.length})</option>
            </select>

            <select
              value={channelFilter || ""}
              onChange={(e) => setChannelFilter(e.target.value as any || null)}
              className={`qsx-fchip${channelFilter ? " on" : ""}`}
              aria-label="Filtrar por canal"
            >
              <option value="">Canal</option>
              {(["pesquisa", "email", "ligacao", "ligacao_whatsapp", "whatsapp", "linkedin", "instagram", "tiktok", "youtube"] as ChannelType[]).map((ch) => (
                <option key={ch} value={ch}>{CHANNEL_LABELS[ch]}</option>
              ))}
            </select>

            <select
              value={priorityFilter || ""}
              onChange={(e) => setPriorityFilter(e.target.value as any || null)}
              className={`qsx-fchip${priorityFilter ? " on" : ""}`}
              aria-label="Filtrar por prioridade"
            >
              <option value="">Prioridade</option>
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>

            <select
              value={periodFilter || ""}
              onChange={(e) => setPeriodFilter(e.target.value as any || null)}
              className={`qsx-fchip${periodFilter ? " on" : ""}`}
              aria-label="Filtrar por período"
            >
              <option value="">Período</option>
              <option value="manha">Manhã</option>
              <option value="tarde">Tarde</option>
            </select>

            <select
              value={ownerFilter || ""}
              onChange={(e) => setOwnerFilter(e.target.value || null)}
              className={`qsx-fchip${ownerFilter ? " on" : ""}`}
              aria-label="Filtrar por responsável"
            >
              <option value="">Responsável</option>
              {qsUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>

            {(statusFilter || channelFilter || priorityFilter || periodFilter || ownerFilter) && (
              <button
                onClick={() => { setStatusFilter(null); setChannelFilter(null); setPriorityFilter(null); setPeriodFilter(null); setOwnerFilter(null); }}
                className="text-[13px] font-semibold hover:underline"
                style={{ color: "var(--orange)" }}
              >
                Limpar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MAIN CONTENT — TASK LIST + EXECUTION VIEW
          ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: "var(--bg)" }}>
        <div className="px-4 md:px-6 pt-3 pb-24">
        <div className="qsx-page">
          {filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              {(statusFilter || channelFilter || priorityFilter || periodFilter || search.trim()) ? (
                <>
                  <span style={{ color: "var(--ink3)" }}><IconFilter /></span>
                  <p className="mt-4 text-sm font-medium" style={{ color: "var(--ink2)" }}>Nenhuma atividade com esses filtros.</p>
                  <button
                    onClick={() => { setStatusFilter(null); setChannelFilter(null); setPriorityFilter(null); setPeriodFilter(null); setSearch(""); }}
                    className="mt-4 qsx-btn qsx-btn-orange"
                  >
                    Limpar filtros
                  </button>
                </>
              ) : (
                <>
                  <span className="text-3xl mb-2">🎯</span>
                  <p className="mt-2 text-sm font-bold" style={{ color: "var(--ink)" }}>Tudo limpo!</p>
                  <p className="text-xs mt-1" style={{ color: "var(--ink3)" }}>Nenhuma atividade pendente. Cadastre um novo lead para começar.</p>
                  <button onClick={() => setShowNewLeadModal(true)} className="mt-4 qsx-btn qsx-btn-orange">
                    + Cadastrar Lead
                  </button>
                </>
              )}
            </div>
          ) : (() => {
            const extras = filteredTasks.filter((t) => t.is_extra);
            const normais = filteredTasks.filter((t) => !t.is_extra);
            const activeInList = activeTaskId ? filteredTasks.find((t) => t.id === activeTaskId) : undefined;
            const heroTask = activeInList ?? normais[0];
            const restNormais = normais.filter((t) => t.id !== heroTask?.id);
            const extrasCol = extras.filter((t) => t.id !== heroTask?.id);
            const manha = restNormais.filter((t) => periodOf(t) === "manha");
            const tarde = restNormais.filter((t) => periodOf(t) === "tarde");

            const extrasInner = extrasCol.length > 0 ? (
              <>
                <div className="qsx-extras-head">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></svg>
                  Atividades extras · {extrasCol.length}
                </div>
                <div className="flex flex-col gap-2.5">{extrasCol.map(renderExtraPill)}</div>
              </>
            ) : null;

            const mainInner = (
              <>
                {heroTask ? renderHero(heroTask, restNormais.slice(0, 3)) : (
                  <div className="text-center py-16 text-sm" style={{ color: "var(--ink3)" }}>
                    Nenhum lead novo na fila agora.{extrasCol.length > 0 ? " ⚡ Foque nas atividades extras à esquerda." : ""}
                  </div>
                )}
                {manha.length > 0 && (
                  <>
                    <div className="qsx-glabel">Manhã · {manha.length} {manha.length === 1 ? "atividade" : "atividades"}</div>
                    <div className="flex flex-col gap-2.5">{manha.map(renderPill)}</div>
                  </>
                )}
                {tarde.length > 0 && (
                  <>
                    <div className="qsx-glabel">Tarde · {tarde.length} {tarde.length === 1 ? "atividade" : "atividades"}</div>
                    <div className="flex flex-col gap-2.5">{tarde.map(renderPill)}</div>
                  </>
                )}
              </>
            );

            // Extras à esquerda (na linha do cabeçalho) + card largo ocupando o resto.
            return (
              <div className="qsx-fila-row">
                {extrasInner && <div className="qsx-fila-extras">{extrasInner}</div>}
                <div className="qsx-fila-main">{mainInner}</div>
              </div>
            );
          })()}
        </div>
        </div>
      </div>
      {/* ══ MODAL AGENDAMENTO (ao dar Ganho) ════════════════════════════════ */}
      {meetingFor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !savingMeeting && setMeetingFor(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4" style={{ background: "var(--green)" }}>
              <div className="text-white">
                <p className="text-sm font-bold leading-tight">Agendar reunião — Ganho</p>
                <p className="text-[11px] opacity-90 leading-tight">{meetingFor.leadName}</p>
              </div>
              <button onClick={() => setMeetingFor(null)} className="text-white/90 hover:text-white" aria-label="Fechar">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Quem fez o agendamento *</label>
                <select value={meeting.agendadoPor} onChange={(e) => setMeeting((m) => ({ ...m, agendadoPor: e.target.value }))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-green-400">
                  <option value="">Selecione...</option>
                  {meetingTeam.schedulers.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">E-mail do cliente</label>
                <input type="email" value={meeting.emailCliente} onChange={(e) => setMeeting((m) => ({ ...m, emailCliente: e.target.value }))} placeholder="email@cliente.com" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-green-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Data do agendamento</label>
                <input type="date" value={meeting.dataAgendamento} onChange={(e) => setMeeting((m) => ({ ...m, dataAgendamento: e.target.value }))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-green-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Responsável pela reunião *</label>
                <select value={meeting.responsavel} onChange={(e) => setMeeting((m) => ({ ...m, responsavel: e.target.value }))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-green-400">
                  <option value="">Selecione...</option>
                  {meetingTeam.owners.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Data e hora da reunião (Google Meet) *</label>
                <input type="datetime-local" value={meeting.dataHora} onChange={(e) => setMeeting((m) => ({ ...m, dataHora: e.target.value }))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-green-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Observações da atividade</label>
                <textarea value={obsText} onChange={(e) => setObsText(e.target.value)} rows={2} placeholder="Anotações do contato — vão junto para o Bitrix" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-green-400 resize-none" />
              </div>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button onClick={() => setMeetingFor(null)} disabled={savingMeeting} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button onClick={handleConfirmMeeting} disabled={savingMeeting || !meeting.agendadoPor || !meeting.responsavel || !meeting.dataHora} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--green)" }}>
                {savingMeeting ? "Salvando..." : "Confirmar ganho"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL LIGAÇÃO MANUAL ═════════════════════════════════════════════ */}
      {showDialer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-4 md:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Ligação Manual</h2>
              <button onClick={() => { setShowDialer(false); setDialNumber(""); }} className="text-gray-400 hover:text-gray-600">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Número</label>
              <input
                type="tel"
                value={dialNumber}
                onChange={(e) => setDialNumber(e.target.value)}
                placeholder="(11) 99999-9999"
                className="w-full px-4 py-3 text-lg text-center font-mono border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100"
                autoFocus
              />
            </div>
            <button
              onClick={() => { if (dialNumber.trim()) { callViaWebfone(dialNumber); setShowDialer(false); setDialNumber(""); } }}
              disabled={!dialNumber.trim()}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "#12A18A" }}
            >
              <ChannelIcon type="ligacao" size={18} />
              Ligar (webfone)
            </button>
            <button
              onClick={() => { if (dialNumber.trim()) { startWhatsAppCall(dialNumber); setShowDialer(false); setDialNumber(""); } }}
              disabled={!dialNumber.trim()}
              className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50 transition-all disabled:opacity-50"
            >
              <IconWhatsApp size={16} />
              Ligar no WhatsApp
            </button>
          </div>
        </div>
      )}

      {/* ══ MODAL ATIVIDADE EXTRA ═════════════════════════════════════════════ */}
      {showExtraTaskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-4 md:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">{extraFromTaskId ? "Agendar retorno" : "Atividade Extra"}</h2>
              <button onClick={() => { setShowExtraTaskModal(false); setExtraFromTaskId(null); }} className="text-gray-400 hover:text-gray-600">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="space-y-3">
              <div className="relative">
                <label className="text-xs font-medium text-gray-500 block mb-1">Lead *</label>
                <input
                  type="text"
                  value={extraTask._searchText}
                  onChange={(e) => {
                    const val = e.target.value;
                    setExtraTask(p => ({ ...p, _searchText: val, lead_id: "" }));
                  }}
                  placeholder="Digite o nome do lead..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400"
                />
                {extraTask._searchText && !extraTask.lead_id && (
                  <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {leads
                      .filter(l => {
                        const q = extraTask._searchText.toLowerCase();
                        return (l.full_name?.toLowerCase().includes(q) || l.email?.toLowerCase().includes(q) || l.phone?.includes(q) || l.id.includes(q));
                      })
                      .slice(0, 10)
                      .map(l => (
                        <button
                          key={l.id}
                          onClick={() => setExtraTask(p => ({ ...p, lead_id: l.id, _searchText: (l.full_name ?? "") + (l.company_name ? ` · ${l.company_name}` : "") }))}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                        >
                          <span className="font-medium text-gray-900">{l.full_name}</span>
                          {l.company_name && <span className="text-gray-400"> · {l.company_name}</span>}
                          {l.phone && <span className="text-gray-300 text-xs ml-2">{l.phone}</span>}
                        </button>
                      ))
                    }
                    {leads.filter(l => {
                      const q = extraTask._searchText.toLowerCase();
                      return (l.full_name?.toLowerCase().includes(q) || l.email?.toLowerCase().includes(q) || l.phone?.includes(q) || l.id.includes(q));
                    }).length === 0 && (
                      <p className="px-3 py-2 text-xs text-gray-400">Nenhum lead encontrado</p>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Canal *</label>
                <select
                  value={extraTask.channel_type}
                  onChange={(e) => setExtraTask(p => ({ ...p, channel_type: e.target.value as ChannelType }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400"
                >
                  <option value="ligacao">Fazer Ligação</option>
                  <option value="ligacao_whatsapp">Ligar no WhatsApp</option>
                  <option value="whatsapp">Enviar WhatsApp</option>
                  <option value="email">Enviar E-mail</option>
                  <option value="linkedin">Contato pelo LinkedIn</option>
                  <option value="pesquisa">Atividade de Pesquisa</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Data *</label>
                  <input
                    type="date"
                    value={extraTask.date}
                    onChange={(e) => setExtraTask(p => ({ ...p, date: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Horário *</label>
                  <input
                    type="time"
                    value={extraTask.time}
                    onChange={(e) => setExtraTask(p => ({ ...p, time: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Observação</label>
                <input
                  type="text"
                  value={extraTask.notes}
                  onChange={(e) => setExtraTask(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Ex: Cliente pediu retorno às 14h"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={handleSaveExtra}
                disabled={savingExtra || !extraTask.lead_id || !extraTask.date}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "#2563EB" }}
              >
                {savingExtra ? "Salvando..." : "Agendar Atividade"}
              </button>
              <button
                onClick={() => { setShowExtraTaskModal(false); setExtraFromTaskId(null); }}
                className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL CADASTRAR LEAD ══════════════════════════════════════════════ */}
      {showNewLeadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-4 md:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Cadastrar Lead</h2>
              <button onClick={() => setShowNewLeadModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Nome completo *</label>
                <input
                  type="text"
                  value={newLead.full_name}
                  onChange={(e) => setNewLead(p => ({ ...p, full_name: e.target.value }))}
                  placeholder="Ex: João da Silva"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Telefone *</label>
                <input
                  type="tel"
                  value={newLead.phone}
                  onChange={(e) => setNewLead(p => ({ ...p, phone: e.target.value }))}
                  placeholder="(11) 99999-9999"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">E-mail</label>
                <input
                  type="email"
                  value={newLead.email}
                  onChange={(e) => setNewLead(p => ({ ...p, email: e.target.value }))}
                  placeholder="email@empresa.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Produto de interesse</label>
                <select
                  value={newLead.company_name}
                  onChange={(e) => setNewLead(p => ({ ...p, company_name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                >
                  <option value="">Selecione o produto</option>
                  {products.map(p => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Responsável (SDR)</label>
                <select
                  value={newLead.owner_id}
                  onChange={(e) => setNewLead(p => ({ ...p, owner_id: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                >
                  <option value="">Selecione o responsável</option>
                  {qsUsers.filter(u => u.role === "sdr" || u.role === "admin" || u.role === "gestor").map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Cadência</label>
                <select
                  value={newLead.cadence_id}
                  onChange={(e) => setNewLead(p => ({ ...p, cadence_id: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                >
                  <option value="">Selecione a cadência</option>
                  {cadences.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Observação</label>
                <textarea
                  value={newLead.notes}
                  onChange={(e) => setNewLead(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Informações adicionais sobre o lead..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 resize-none"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={async () => {
                  if (!newLead.full_name || !newLead.phone) return;
                  setSavingLead(true);
                  const names = newLead.full_name.trim().split(" ");
                  const hasCadence = !!newLead.cadence_id;
                  const { data: inserted, error } = await supabase.from("qs_leads").insert({
                    full_name: newLead.full_name.trim(),
                    first_name: names[0],
                    last_name: names.slice(1).join(" ") || null,
                    phone: newLead.phone.trim(),
                    email: newLead.email.trim() || null,
                    segment: newLead.company_name.trim() || null,
                    owner_id: newLead.owner_id || null,
                    cadence_id: newLead.cadence_id || null,
                    source: "manual",
                    status: hasCadence ? "em_prospeccao" : "nao_iniciado",
                    arrived_at: new Date().toISOString(),
                    cadence_started_at: hasCadence ? new Date().toISOString() : null,
                  }).select().single();
                  // Salvar observação
                  if (!error && inserted && newLead.notes?.trim()) {
                    await supabase.from("qs_notes").insert({
                      lead_id: inserted.id,
                      body: newLead.notes.trim(),
                      tags: [],
                    });
                  }
                  // Criar tasks da cadência automaticamente
                  if (!error && inserted && hasCadence) {
                    const { data: days } = await supabase
                      .from("qs_cadence_days")
                      .select("*, activities:qs_cadence_activities(*)")
                      .eq("cadence_id", newLead.cadence_id)
                      .order("day_number");
                    if (days && days.length > 0) {
                      const now = new Date();
                      const newTasks = days.flatMap((day: any) =>
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
                            lead_id: inserted.id,
                            cadence_id: newLead.cadence_id,
                            owner_id: newLead.owner_id || null,
                            channel_type: act.channel_type,
                            priority: "alta",
                            scheduled_at: scheduled.toISOString(),
                            status: "pendente",
                          };
                        })
                      );
                      if (newTasks.length > 0) {
                        const { data: createdTasks } = await supabase.from("qs_tasks").insert(newTasks).select();
                        if (createdTasks) {
                          setTasks(prev => [...prev, ...(createdTasks as Task[])]);
                        }
                      }
                    }
                  }
                  setSavingLead(false);
                  if (!error) {
                    setShowNewLeadModal(false);
                    setNewLead({ full_name: "", phone: "", email: "", company_name: "", owner_id: currentUser?.id ?? "", cadence_id: "", notes: "" });
                    const { data } = await supabase.from("qs_leads").select("*");
                    if (data) setLeads(data as Lead[]);
                  }
                }}
                disabled={savingLead || !newLead.full_name || !newLead.phone}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "#F97316" }}
              >
                {savingLead ? "Salvando..." : "Cadastrar"}
              </button>
              <button
                onClick={() => setShowNewLeadModal(false)}
                className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
