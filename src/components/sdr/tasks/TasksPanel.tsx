// src/components/sdr/tasks/TasksPanel.tsx
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type {
  Task,
  Lead,
  Cadence,
  ChannelType,
  PriorityLevel,
} from "../types";
import {
  CHANNEL_LABELS,
  ACQUISITION_LABELS,
} from "../types";
import { supabase } from "@/lib/supabase";
import { completeTask, skipTask, fetchQsUsers } from "@/lib/qs/queries";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
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

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
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

function IconCopy() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function IconGoogle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09A6.01 6.01 0 0 1 5.52 12c0-.72.12-1.42.32-2.09V7.07H2.18A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.49l3.77-2.4z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
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

function ChannelIcon({ type, size = 22 }: { type: ChannelType; size?: number }) {
  switch (type) {
    case "pesquisa":  return <IconResearch size={size} />;
    case "email":     return <IconEmail size={size} />;
    case "whatsapp":  return <IconWhatsApp size={size} />;
    case "ligacao":   return <IconPhone size={size} />;
    case "linkedin":  return <IconLinkedIn size={size} />;
    case "instagram": return <IconInstagram size={size} />;
    case "tiktok":    return <IconTikTok size={size} />;
    case "youtube":   return <IconYouTube size={size} />;
  }
}

// ── Channel Colors ───────────────────────────────────────────────────────────

const CHANNEL_COLORS: Record<ChannelType, { bg: string; fg: string }> = {
  pesquisa:  { bg: "#EEF2FF", fg: "#4F46E5" },
  email:     { bg: "#FEF3C7", fg: "#D97706" },
  whatsapp:  { bg: "#D1FAE5", fg: "#059669" },
  ligacao:   { bg: "#DBEAFE", fg: "#2563EB" },
  linkedin:  { bg: "#E0E7FF", fg: "#4338CA" },
  instagram: { bg: "#FCE7F3", fg: "#DB2777" },
  tiktok:    { bg: "#F3F4F6", fg: "#111827" },
  youtube:   { bg: "#FEE2E2", fg: "#DC2626" },
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

// ── Activity type labels ─────────────────────────────────────────────────────

function getActivityLabel(channel: ChannelType, _cadenceName?: string): string {
  const channelNames: Record<ChannelType, string> = {
    pesquisa: "Atividade de Pesquisa",
    email: "Enviar E-mail",
    ligacao: "Fazer Ligação",
    whatsapp: "Enviar WhatsApp",
    linkedin: "Contato pelo LinkedIn",
    instagram: "Contato pelo Instagram",
    tiktok: "Contato pelo TikTok",
    youtube: "Contato pelo YouTube",
  };
  return channelNames[channel];
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

  // ── Supabase data ──────────────────────────────────────────────────
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cadences, setCadences] = useState<Cadence[]>([]);
  const [qsUsers, setQsUsers] = useState<SdrUser[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [tasksRes, leadsRes, cadencesRes, usersData, productsRes] = await Promise.all([
          supabase.from("qs_tasks").select("*").in("status", ["pendente", "atrasada"]).order("scheduled_at"),
          supabase.from("qs_leads").select("*"),
          supabase.from("qs_cadences").select("*"),
          fetchQsUsers(),
          supabase.from("qs_products").select("*").eq("is_active", true).order("name"),
        ]);
        setTasks((tasksRes.data || []) as Task[]);
        setLeads((leadsRes.data || []) as Lead[]);
        setCadences((cadencesRes.data || []) as Cadence[]);
        setQsUsers(usersData);
        setProducts((productsRes.data || []) as { id: string; name: string }[]);
      } catch (err) {
        console.warn("[TasksPanel] falha ao carregar dados:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

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

  // Execution
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [executionNotes, setExecutionNotes] = useState("");
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Script Dinâmico
  const [scriptExpanded, setScriptExpanded] = useState(true);

  // Hover tooltip state (Change 1)
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback((taskId: string) => {
    hoverTimeout.current = setTimeout(() => {
      setHoveredTaskId(taskId);
    }, 300);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeout.current) {
      clearTimeout(hoverTimeout.current);
      hoverTimeout.current = null;
    }
    setHoveredTaskId(null);
  }, []);

  // Quick tags for notes (Change 3)
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showNoteField, setShowNoteField] = useState(false);

  // Skip reason (Change 4)
  const [showSkipReason, setShowSkipReason] = useState(false);

  // Loaded script from cadence activity (Change 14 display)
  const [loadedScript, setLoadedScript] = useState<string | null>(null);

  // Green flash animation (Change 2)
  const [flashResult, setFlashResult] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<{ taskId: string; result: string } | null>(null);

  // New Lead Modal
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showExtraTaskModal, setShowExtraTaskModal] = useState(false);
  const [extraTask, setExtraTask] = useState({ lead_id: "", channel_type: "ligacao" as ChannelType, date: "", time: "09:00", notes: "", _searchText: "" });
  const [savingExtra, setSavingExtra] = useState(false);
  const [showDialer, setShowDialer] = useState(false);
  const [dialNumber, setDialNumber] = useState("");
  const [newLead, setNewLead] = useState({ full_name: "", phone: "", email: "", company_name: "", owner_id: currentUser?.id ?? "", cadence_id: "", notes: "" });
  const [savingLead, setSavingLead] = useState(false);

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

    // 1. Conclui a tentativa atual (marca 'concluida' + registra contact_result/notas/tags).
    await completeTask(
      taskId,
      result,
      executionNotes || undefined,
      selectedTags.length > 0 ? selectedTags : undefined
    );

    const leadName = getLeadForTask(currentTask)?.full_name || "Lead";

    // 2. Desfecho: ganho/perdido encerram o lead; qualquer outro gera o próximo passo.
    if (result === "ganho") {
      await supabase.from("qs_leads").update({ status: "ganho" }).eq("id", currentTask.lead_id);
      await closeRemainingLeadTasks(currentTask.lead_id, taskId, "Lead ganho");
      setLeads(prev => prev.map((l): Lead => l.id === currentTask.lead_id ? { ...l, status: "ganho" } : l));
      setTasks(prev => prev.filter(t => t.lead_id !== currentTask.lead_id));
      showToast(`Ganho! ${leadName}`);
    } else if (result === "sem_interesse") {
      await supabase.from("qs_leads").update({ status: "perdido" }).eq("id", currentTask.lead_id);
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

    // 3. Flash + reset dos campos para a próxima tarefa.
    if (result === "atendeu" || result === "ganho") {
      setFlashResult("green");
      setTimeout(() => setFlashResult(null), 400);
    } else {
      setFlashResult("gray");
      setTimeout(() => setFlashResult(null), 200);
    }
    setSelectedTags([]);
    setShowNoteField(false);
    setExecutionNotes("");
    setShowSkipReason(false);
    setTimeout(() => {
      setSelectedTaskId(null);
      setTimerSeconds(0);
      setTimerRunning(false);
    }, 300);
  }

  // Timer effect
  useEffect(() => {
    if (!timerRunning) return;
    const interval = setInterval(() => {
      setTimerSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [timerRunning]);

  // Filter logic
  const filteredTasks = useMemo(() => {
    let filtered = [...tasks];

    // Role-based filtering: SDR only sees their own tasks
    if (currentUser && !canSeeAllData(currentUser.role)) {
      filtered = filtered.filter((t) => t.owner_id === currentUser.id);
    }

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
          (lead.phone?.includes(q))
        );
      });
    }

    // ── Smart Queue (Fila Inteligente) ──────────────────────────────
    // 1. Levantada de mão com maior tempo de espera primeiro (URGENTE)
    // 2. Tarefas atrasadas
    // 3. Prioridade alta
    // 4. Prioridade média por horário agendado
    // 5. Prioridade baixa por horário agendado
    function getSmartQueueWeight(t: Task): number {
      const cadence = getCadenceForTask(t);
      const lead = getLeadForTask(t);
      const isLevantada = cadence?.acquisition_channel === "levantada_de_mao";
      const isOverdue = t.status === "atrasada";

      if (isLevantada && lead?.arrived_at) {
        const waitMs = Date.now() - new Date(lead.arrived_at).getTime();
        return -1_000_000_000 - waitMs; // tier 1
      }
      if (isOverdue) return -500_000_000; // tier 2
      if (t.priority === "alta") return -100_000_000; // tier 3
      if (t.priority === "media") return 0; // tier 4
      return 100_000_000; // tier 5 (baixa)
    }

    filtered.sort((a, b) => {
      const wa = getSmartQueueWeight(a);
      const wb = getSmartQueueWeight(b);
      if (wa !== wb) return wa - wb;
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    });

    return filtered;
  }, [tasks, leads, cadences, search, statusFilter, channelFilter, priorityFilter, periodFilter, ownerFilter]);

  const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : null;
  const selectedLead = selectedTask ? getLeadForTask(selectedTask) : null;
  const selectedCadence = selectedTask ? getCadenceForTask(selectedTask) : null;

  const todayTasks = tasks.filter((t) => t.status === "pendente");
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

  // Days in funnel helper
  function getDaysInFunnel(lead: Lead): number {
    const created = new Date(lead.created_at).getTime();
    const now = Date.now();
    return Math.floor((now - created) / (1000 * 60 * 60 * 24));
  }

  function handleCopy(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  function handleSelectTask(taskId: string) {
    setSelectedTaskId(taskId);
    setExecutionNotes("");
    setTimerSeconds(0);
    setTimerRunning(true); // cronômetro da atividade começa ao abrir a tarefa
    setSelectedTags([]);
    setShowNoteField(false);
    setShowSkipReason(false);
    setLoadedScript(null);

    // Try to load script from cadence activity (Change 14 display)
    const task = tasks.find((t) => t.id === taskId);
    if ((task as any)?.cadence_activity_id) {
      supabase
        .from("qs_cadence_activities")
        .select("script_text")
        .eq("id", (task as any).cadence_activity_id)
        .single()
        .then(({ data }: { data: any }) => {
          if (data?.script_text) setLoadedScript(data.script_text);
        });
    }
  }

  function handleCloseExecution() {
    setSelectedTaskId(null);
    setExecutionNotes("");
    setTimerSeconds(0);
    setTimerRunning(false);
  }

  // Skip with reason handler (Change 4)
  async function handleSkipWithReason(reason: string) {
    if (selectedTaskId) {
      // Use skipTask from queries.ts
      await skipTask(selectedTaskId, reason);
      setTasks(prev => prev.filter(t => t.id !== selectedTaskId));
    }
    setShowSkipReason(false);
    setSelectedTags([]);
    setShowNoteField(false);
    setExecutionNotes("");
    setSelectedTaskId(null);
    setTimerSeconds(0);
    setTimerRunning(false);
  }

  // Toggle tag selection (Change 3)
  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  // Script Dinâmico helper
  function getScript(channel: ChannelType, lead: Lead): string {
    const nome = lead.full_name || lead.first_name || "[NOME]";
    const empresa = lead.company_name || "[EMPRESA]";
    const segmento = lead.segment || "[SEGMENTO]";

    switch (channel) {
      case "pesquisa":
        return `1. Verificar LinkedIn do lead\n2. Anotar cargo, empresa, conexões em comum\n3. Preparar abordagem personalizada`;
      case "ligacao":
        return `Olá ${nome}, aqui é [SEU NOME] da Inovvatur. Vi que você atua no segmento de ${segmento}. Tenho ajudado agências como a ${empresa} a escalar o faturamento com processos comerciais estruturados. Podemos conversar 2 minutos sobre isso?`;
      case "whatsapp":
        return `Oi ${nome}, tudo bem? 👋 Sou [SEU NOME] da Inovvatur. Vi seu interesse em estruturar processos comerciais. Posso te enviar um material sobre como agências estão escalando o faturamento com um time de SDR profissional?`;
      case "email":
        return `Assunto: ${empresa} + Inovvatur — Escalar faturamento com processos\n\nOlá ${nome},\n\nNotei que a ${empresa} atua no segmento de ${segmento}. Tenho ajudado agências de viagens a estruturar processos comerciais que escalam faturamento de forma previsível.\n\nPodemos agendar 15 minutos para te mostrar como funciona?`;
      case "linkedin":
        return `Olá ${nome}, vi que você lidera o comercial da ${empresa}. Tenho ajudado agências de viagens a estruturar processos de prospecção que aumentam a taxa de conversão em até 3x. Gostaria de trocar uma ideia sobre isso?`;
      default:
        return `Abordagem para ${nome} da ${empresa} via ${CHANNEL_LABELS[channel]}.`;
    }
  }

  // Progress calc — uses task count as placeholder until dashboard queries are built
  const DAILY_DONE = tasks.length;
  const TOTAL_SCHEDULED = tasks.length;
  const TOTAL_DONE_RATIO = `0/${tasks.length}`;
  const MONTHLY_DONE = tasks.length;
  const dailyPct = DAILY_GOAL > 0 ? Math.min((DAILY_DONE / DAILY_GOAL) * 100, 100) : 0;
  const monthlyPct = MONTHLY_GOAL > 0 ? Math.min((MONTHLY_DONE / MONTHLY_GOAL) * 100, 100) : 0;
  const monthlyBeat = MONTHLY_DONE >= MONTHLY_GOAL;
  // Horário comercial: Seg-Qui 09:30-19:30, Sex 10:00-19:00
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=dom, 1=seg...5=sex, 6=sab
  const isFriday = dayOfWeek === 5;
  const endHour = isFriday ? 19 : 19;
  const endMin = isFriday ? 0 : 30;
  const endToday = new Date(now);
  endToday.setHours(endHour, endMin, 0, 0);
  const diffMs = Math.max(0, endToday.getTime() - now.getTime());
  const totalMinLeft = Math.floor(diffMs / 60000);
  const hoursLeft = Math.floor(totalMinLeft / 60);
  const minutesLeft = totalMinLeft % 60;
  const hoursWorked = (() => {
    const startHour = isFriday ? 10 : 9;
    const startMin = isFriday ? 0 : 30;
    const startToday = new Date(now);
    startToday.setHours(startHour, startMin, 0, 0);
    return Math.max(0.1, (now.getTime() - startToday.getTime()) / 3600000);
  })();
  const rhythm = Math.round((DAILY_DONE / hoursWorked) * 10) / 10;

  // Motivational micro-copy based on daily progress
  const motivationalText = useMemo(() => {
    const remaining = DAILY_GOAL - DAILY_DONE;
    if (dailyPct >= 100) return "META BATIDA! Você é demais! 🎉";
    if (dailyPct >= 75) return `Quase lá! Faltam ${remaining} para bater a meta!`;
    if (dailyPct >= 50) return "Mais da metade! Está voando! 🚀";
    if (dailyPct >= 25) return "Bom ritmo, continue assim!";
    return "Bora começar! 💪";
  }, [dailyPct, DAILY_DONE]);

  // Celebration effect when daily goal is hit
  useEffect(() => {
    if (DAILY_DONE >= DAILY_GOAL && !celebrationShown) {
      setCelebrationShown(true);
      setShowCelebration(true);
      setTimeout(() => setShowCelebration(false), 3000);
    }
  }, [DAILY_DONE, celebrationShown]);

  // Lead data completeness
  function getLeadCompleteness(lead: Lead): { filled: number; total: number; missing: string[] } {
    const fields = [
      { key: "email", label: "E-mail" },
      { key: "phone", label: "Telefone" },
      { key: "linkedin_url", label: "LinkedIn" },
      { key: "company_name", label: "Empresa" },
      { key: "job_title", label: "Cargo" },
      { key: "department", label: "Departamento" },
      { key: "city", label: "Cidade" },
      { key: "segment", label: "Segmento" },
    ];
    const missing: string[] = [];
    let filled = 0;
    const record = lead as unknown as Record<string, unknown>;
    for (const f of fields) {
      if (record[f.key]) {
        filled++;
      } else {
        missing.push(f.label);
      }
    }
    return { filled, total: fields.length, missing };
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen" style={{ background: "#F8F9FA" }}>
        <div className="w-8 h-8 border-3 border-gray-200 border-t-orange-500 rounded-full animate-spin mb-4" />
        <p className="text-sm text-gray-400">Carregando atividades...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen" style={{ background: "#F8F9FA" }}>
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
          className="shrink-0 bg-red-500 text-white px-6 py-3 flex items-center justify-between"
          style={{ animation: "pulseBanner 2s ease-in-out infinite" }}
        >
          <div className="flex items-center gap-3">
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
            onClick={() => handleSelectTask(hotLead.task.id)}
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
      <header className="shrink-0 bg-white border-b border-gray-200">
        <div className="px-6 pt-4 pb-0">
          {/* Row 1: Activity count + ratio + META DE HOJE + META DESTE MES */}
          <div className="flex items-center justify-between mb-3">
            {/* Left: sentence with bold orange number */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-700">
                Existem{" "}
                <span className="font-bold" style={{ color: "#F97316" }}>
                  {TOTAL_SCHEDULED} atividades
                </span>{" "}
                agendadas para hoje
              </span>
              <span className="text-xs text-gray-400 font-medium ml-2">{TOTAL_DONE_RATIO}</span>
            </div>

            {/* Right: META DE HOJE + META DESTE MES inline */}
            <div className="flex items-center gap-6">
              {/* META DE HOJE */}
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: dailyPct >= 100 ? "#10B981" : "#EAB308" }}
                />
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Meta de hoje
                </span>
                <span className="text-xs font-bold text-gray-700">
                  {DAILY_DONE}/{DAILY_GOAL}
                </span>
                <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${dailyPct}%`,
                      background: dailyPct >= 100 ? "#10B981" : "#EAB308",
                    }}
                  />
                </div>
              </div>

              {/* META DESTE MES */}
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: monthlyBeat ? "#10B981" : "#3B82F6" }}
                />
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  Meta deste m&#234;s
                </span>
                <span className="text-xs font-bold" style={{ color: monthlyBeat ? "#059669" : "#1D4ED8" }}>
                  {MONTHLY_DONE.toLocaleString("pt-BR")}/{MONTHLY_GOAL.toLocaleString("pt-BR")}
                </span>
                <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${monthlyPct}%`,
                      background: monthlyBeat ? "#10B981" : "#3B82F6",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Full-width progress bar */}
          <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden mb-2">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${dailyPct}%`,
                background: monthlyBeat
                  ? "linear-gradient(90deg, #10B981, #34D399)"
                  : "linear-gradient(90deg, #3B82F6, #60A5FA)",
              }}
            />
          </div>

          {/* Row 3: Rhythm info + motivational text + action icons */}
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
              <span className="font-semibold" style={{ color: dailyPct >= 100 ? "#059669" : dailyPct >= 50 ? "#3B82F6" : "#F97316" }}>
                {motivationalText}
              </span>
              <span className="text-gray-300 mx-0.5">&#183;</span>
              <span>~{hoursLeft}h{String(minutesLeft).padStart(2, "0")}min restantes</span>
              <span className="text-gray-300 mx-0.5">&#183;</span>
              <span>Ritmo: {rhythm.toFixed(1)}/h</span>
              {monthlyBeat && (
                <>
                  <span className="text-gray-300 mx-0.5">&#183;</span>
                  <span className="text-emerald-600 font-semibold">Meta mensal batida!</span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════════════
          SEARCH + ACTION BUTTONS (same row)
          ══════════════════════════════════════════════════════════════════════ */}
      <div className="shrink-0 bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center gap-3">
          {/* Search input */}
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <IconSearch size={15} />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar lead, empresa, e-mail ou telefone..."
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-200 bg-gray-50 placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
            />
          </div>

          {/* Quick actions */}
          <button
            onClick={() => setShowDialer(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:opacity-90 whitespace-nowrap shrink-0"
            style={{ background: "#059669" }}
          >
            <IconPhoneCall size={14} />
            Ligação Manual
          </button>
          <button
            onClick={() => setShowExtraTaskModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:opacity-90 whitespace-nowrap shrink-0"
            style={{ background: "#0147FF" }}
          >
            + Atividade Extra
          </button>
          <button
            onClick={() => setShowNewLeadModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:opacity-90 whitespace-nowrap shrink-0"
            style={{ background: "#F97316" }}
          >
            + Cadastrar Lead
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          FILTERS SECTION
          ══════════════════════════════════════════════════════════════════════ */}
      <div className="shrink-0 bg-white border-b border-gray-200 px-6 py-2.5">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {/* Status dropdown */}
          <select
            value={statusFilter || ""}
            onChange={(e) => setStatusFilter(e.target.value as any || null)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-[#F97316]"
            style={statusFilter ? { borderColor: "#F97316", color: "#F97316", fontWeight: 600 } : {}}
          >
            <option value="">Status</option>
            <option value="extras">Extras ({extraTasks.length})</option>
            <option value="para_hoje">Para hoje ({todayTasks.length})</option>
            <option value="atrasadas">Atrasadas ({overdueTasks.length})</option>
          </select>

          {/* Canal dropdown */}
          <select
            value={channelFilter || ""}
            onChange={(e) => setChannelFilter(e.target.value as any || null)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-[#F97316]"
            style={channelFilter ? { borderColor: "#F97316", color: "#F97316", fontWeight: 600 } : {}}
          >
            <option value="">Canal</option>
            {(["pesquisa", "email", "ligacao", "whatsapp", "linkedin", "instagram", "tiktok", "youtube"] as ChannelType[]).map((ch) => (
              <option key={ch} value={ch}>{CHANNEL_LABELS[ch]}</option>
            ))}
          </select>

          {/* Prioridade dropdown */}
          <select
            value={priorityFilter || ""}
            onChange={(e) => setPriorityFilter(e.target.value as any || null)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-[#F97316]"
            style={priorityFilter ? { borderColor: "#F97316", color: "#F97316", fontWeight: 600 } : {}}
          >
            <option value="">Prioridade</option>
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
          </select>

          {/* Período dropdown */}
          <select
            value={periodFilter || ""}
            onChange={(e) => setPeriodFilter(e.target.value as any || null)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-[#F97316]"
            style={periodFilter ? { borderColor: "#F97316", color: "#F97316", fontWeight: 600 } : {}}
          >
            <option value="">Período</option>
            <option value="manha">Manhã</option>
            <option value="tarde">Tarde</option>
          </select>

          {/* Responsável dropdown (Change 17) */}
          <select
            value={ownerFilter || ""}
            onChange={(e) => setOwnerFilter(e.target.value || null)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-[#F97316]"
            style={ownerFilter ? { borderColor: "#F97316", color: "#F97316", fontWeight: 600 } : {}}
          >
            <option value="">Responsável</option>
            {qsUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>

          {/* Limpar filtros */}
          {(statusFilter || channelFilter || priorityFilter || periodFilter || ownerFilter) && (
            <button
              onClick={() => { setStatusFilter(null); setChannelFilter(null); setPriorityFilter(null); setPeriodFilter(null); setOwnerFilter(null); }}
              className="text-xs text-[#F97316] font-medium hover:underline"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MAIN CONTENT — TASK LIST + EXECUTION VIEW
          ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── TASK LIST ──────────────────────────────────────────────────── */}
        <div
          className="overflow-y-auto"
          style={{
            width: selectedTask ? "480px" : "100%",
            transition: "width 0.2s ease",
          }}
        >
          <div className="bg-white">
            {/* Results count */}
            <div className="flex items-center justify-between px-6 py-2 border-b border-gray-100">
              <span className="text-xs text-gray-400 font-medium">
                {filteredTasks.length} atividade{filteredTasks.length !== 1 ? "s" : ""}
              </span>
            </div>

            {filteredTasks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-gray-300">
                {(statusFilter || channelFilter || priorityFilter || periodFilter || search.trim()) ? (
                  <>
                    <IconFilter />
                    <p className="mt-4 text-sm text-gray-500 font-medium">Nenhuma atividade com esses filtros.</p>
                    <button
                      onClick={() => { setStatusFilter(null); setChannelFilter(null); setPriorityFilter(null); setPeriodFilter(null); setSearch(""); }}
                      className="mt-3 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:opacity-90"
                      style={{ background: "#F97316" }}
                    >
                      Limpar filtros
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-3xl mb-2">🎯</span>
                    <p className="mt-2 text-sm text-gray-500 font-medium">Tudo limpo!</p>
                    <p className="text-xs text-gray-400 mt-1">Nenhuma atividade pendente. Cadastre um novo lead para começar.</p>
                    <div className="flex items-center gap-2 mt-4">
                      <button
                        onClick={() => setShowNewLeadModal(true)}
                        className="px-4 py-2 rounded-lg text-xs font-semibold text-white transition-all hover:opacity-90"
                        style={{ background: "#F97316" }}
                      >
                        + Cadastrar Lead
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {filteredTasks.map((task, idx) => {
              const lead = getLeadForTask(task);
              const cadence = getCadenceForTask(task);
              const isSelected = selectedTaskId === task.id;
              const slaAlert = getSlaAlert(lead, task, cadence);
              // Tentativas já feitas (0 na primeira tarefa; follow-ups marcam a borda âmbar).
              const attempts = getAttemptCount(task) - 1;

              // Change 5: Colored left border by contact status
              const isLevantadaQuente = cadence?.acquisition_channel === "levantada_de_mao" && slaAlert?.pulse;
              const leftBorderColor = isLevantadaQuente
                ? "#EF4444"
                : attempts > 0
                  ? "#F59E0B"
                  : "#3B82F6";
              const leftBorderAnimation = isLevantadaQuente
                ? "pulseBorderRed 1.5s ease-in-out infinite"
                : undefined;

              return (
                <div
                  key={task.id}
                  onClick={() => handleSelectTask(task.id)}
                  onMouseEnter={() => handleMouseEnter(task.id)}
                  onMouseLeave={handleMouseLeave}
                  className="group cursor-pointer transition-colors duration-100 hover:bg-gray-50 border-b border-gray-100 relative"
                  style={{
                    background: isSelected ? "#FFFBF5" : undefined,
                    borderLeft: `3px solid ${leftBorderColor}`,
                    animation: leftBorderAnimation,
                  }}
                >
                  {/* ── Hover Tooltip (Change 1) ── */}

                  {/* Hover tooltip */}
                  {hoveredTaskId === task.id && lead && (() => {
                    const isFirst = idx === 0;
                    return (
                      <div
                        className="absolute z-50 bg-gray-900 text-white rounded-lg shadow-xl p-3 text-xs pointer-events-none"
                        style={{
                          ...(isFirst ? { top: "100%", marginTop: 8 } : { bottom: "100%", marginBottom: 8 }),
                          left: "50%",
                          transform: "translateX(-50%)",
                          maxWidth: 280,
                          minWidth: 220,
                        }}
                      >
                        {lead.phone && (
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-gray-400">Tel:</span>
                            <span>{lead.phone}</span>
                          </div>
                        )}
                        {lead.email && (
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-gray-400">Email:</span>
                            <span className="truncate max-w-[180px]">{lead.email}</span>
                          </div>
                        )}
                        <div className="mb-1.5">
                          <span className="text-gray-400">Empresa:</span>{" "}
                          <span>{lead.company_name || "--"}</span>
                          {lead.job_title && <span className="text-gray-400"> · {lead.job_title}</span>}
                        </div>
                        <div className="text-gray-400">
                          Há {getDaysInFunnel(lead)} dias no funil
                        </div>
                        <div
                          style={{
                            position: "absolute",
                            ...(isFirst ? { top: -6 } : { bottom: -6 }),
                            left: "50%",
                            transform: "translateX(-50%)",
                            width: 0, height: 0,
                            borderLeft: "6px solid transparent",
                            borderRight: "6px solid transparent",
                            ...(isFirst ? { borderBottom: "6px solid #111827" } : { borderTop: "6px solid #111827" }),
                          }}
                        />
                      </div>
                    );
                  })()}

                  {/* ── Simplified Card Layout (Change 4) ── */}
                  <div className="flex items-center gap-4 px-6 py-3">
                    {/* Channel icon — colored by channel */}
                    <div
                      className="shrink-0 flex items-center justify-center rounded-xl"
                      style={{ width: 48, height: 48, background: CHANNEL_COLORS[task.channel_type].bg, color: CHANNEL_COLORS[task.channel_type].fg }}
                    >
                      <ChannelIcon type={task.channel_type} size={20} />
                    </div>

                    {/* Center content - 3 essential lines */}
                    <div className="flex-1 min-w-0">
                      {/* Line 1: Lead Name . Company  [SLA badge] [Ligar button] */}
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-gray-900 truncate">
                          {lead?.full_name || "Lead desconhecido"}
                        </span>
                        {lead?.company_name && (
                          <>
                            <span className="text-gray-300">&middot;</span>
                            <span className="text-xs text-gray-500 truncate">{lead.company_name}</span>
                          </>
                        )}
                        <div className="flex items-center gap-1.5 ml-auto shrink-0">
                          {slaAlert && (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                              style={{
                                background: slaAlert.bg,
                                color: slaAlert.text,
                                animation: slaAlert.pulse ? "pulseRed 1.5s ease-in-out infinite" : undefined,
                              }}
                            >
                              {slaAlert.label}
                            </span>
                          )}
                          {lead?.phone && (
                            <a
                              href={`tel:${lead.phone.replace(/\D/g, "")}`}
                              onClick={(e) => { e.stopPropagation(); handleSelectTask(task.id); }}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white transition-all hover:opacity-90"
                              style={{ background: "#059669" }}
                              title={`Ligar para ${lead.phone}`}
                            >
                              <IconPhoneCall size={12} />
                              Ligar
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Line 2: Activity type bold . Tentativa X/5 */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[13px] font-bold text-gray-800">
                          {getActivityLabel(task.channel_type, cadence?.name)}
                        </span>
                        <span className="text-gray-300">&middot;</span>
                        <span
                          className="text-[11px] font-medium"
                          style={{ color: attempts >= MAX_CONTACT_ATTEMPTS ? "#DC2626" : "#6B7280" }}
                        >
                          Tentativa {attempts}/{MAX_CONTACT_ATTEMPTS}
                        </span>
                      </div>

                      {/* Line 3: Chegou em + tempo espera + Cadência */}
                      <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                        {lead?.arrived_at && (
                          <span className="font-medium">
                            Chegou {formatShortDate(lead.arrived_at)} às {formatTime(lead.arrived_at)}
                          </span>
                        )}
                        {lead?.arrived_at && (() => {
                          const waitMin = Math.floor((Date.now() - new Date(lead.arrived_at).getTime()) / 60000);
                          const waitColor = waitMin > 30 ? "#DC2626" : waitMin > 10 ? "#D97706" : "#059669";
                          const waitLabel = waitMin >= 60 ? `${Math.floor(waitMin/60)}h${waitMin%60}min em espera` : `${waitMin}min em espera`;
                          return (
                            <>
                              <span className="text-gray-300">&middot;</span>
                              <span className="font-semibold" style={{ color: waitColor }}>{waitLabel}</span>
                            </>
                          );
                        })()}
                        {cadence && (
                          <>
                            <span className="text-gray-300">&middot;</span>
                            <span>{ACQUISITION_LABELS[cadence.acquisition_channel]}</span>
                          </>
                        )}
                        {cadence && (
                          <>
                            <span className="text-gray-300">&middot;</span>
                            <span className="truncate max-w-[160px]">{cadence.name}</span>
                          </>
                        )}
                        {task.is_extra && (
                          <>
                            <span className="text-gray-300">&middot;</span>
                            <span className="text-green-600 font-semibold">Extra</span>
                          </>
                        )}
                        <span className="text-gray-300">&middot;</span>
                        <div className="flex items-center gap-0.5">
                          {lead?.email && <span className="text-gray-400" title="Email"><IconEmail size={13} /></span>}
                          {lead?.phone && <span className="text-gray-400" title="Telefone"><IconPhone size={13} /></span>}
                          {lead?.linkedin_url && <span className="text-gray-400" title="LinkedIn"><IconLinkedIn size={13} /></span>}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSelectTask(task.id); }}
                          className="ml-auto text-[11px] text-gray-400 hover:text-blue-600 hover:underline transition-colors"
                        >
                          Ver detalhes
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── EXECUTION VIEW (split panel) ──────────────────────────────── */}
        {selectedTask && selectedLead && (
          <div
            className="flex-1 border-l border-gray-200 overflow-y-auto bg-white"
            style={{ minWidth: 480 }}
          >
            {/* Execution header */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: "#F3F4F6", color: "#6B7280" }}
                >
                  <ChannelIcon type={selectedTask.channel_type} size={20} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-gray-900">
                    {getActivityLabel(selectedTask.channel_type)}
                  </h2>
                  <p className="text-xs text-gray-500">
                    {selectedLead.full_name} &#183; {selectedLead.company_name}
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseExecution}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <IconClose />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Split: Lead Info + Activity */}
              <div className="grid grid-cols-2 gap-6">
                {/* LEFT: Lead Info */}
                <div className="space-y-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Informa&#231;&#245;es do Lead
                  </h3>

                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Nome</label>
                      <p className="text-sm font-semibold text-gray-900 mt-0.5">
                        {selectedLead.full_name}
                      </p>
                    </div>

                    <div>
                      <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">E-mail</label>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-sm text-gray-700">{selectedLead.email || "--"}</p>
                        {selectedLead.email && (
                          <button
                            onClick={() => handleCopy(selectedLead.email!, "email")}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
                            title="Copiar e-mail"
                          >
                            {copiedField === "email" ? <IconCheck /> : <IconCopy />}
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Telefone</label>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-sm text-gray-700">{selectedLead.phone || "--"}</p>
                        {selectedLead.phone && (
                          <button
                            onClick={() => handleCopy(selectedLead.phone!, "phone")}
                            className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
                            title="Copiar telefone"
                          >
                            {copiedField === "phone" ? <IconCheck /> : <IconCopy />}
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Departamento</label>
                      <p className="text-sm text-gray-700 mt-0.5">{selectedLead.department || "--"}</p>
                    </div>

                    <div>
                      <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Cargo</label>
                      <p className="text-sm text-gray-700 mt-0.5">{selectedLead.job_title || "--"}</p>
                    </div>

                    <div>
                      <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Empresa</label>
                      <p className="text-sm text-gray-700 mt-0.5">{selectedLead.company_name || "--"}</p>
                    </div>

                    <button
                      onClick={() => onOpenLead(selectedLead.id)}
                      className="mt-2 flex items-center gap-1.5 text-xs font-medium transition-colors"
                      style={{ color: "#0147FF" }}
                    >
                      Ver perfil completo
                      <IconChevronRight />
                    </button>
                  </div>
                </div>

                {/* RIGHT: Activity details */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      Detalhes da Atividade
                    </h3>
                    <span className="text-[11px] font-mono font-semibold text-gray-400 tabular-nums" title="Tempo nesta atividade">
                      {String(Math.floor(timerSeconds / 60)).padStart(2, "0")}:{String(timerSeconds % 60).padStart(2, "0")}
                    </span>
                  </div>

                  {/* Ações diretas */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedLead.phone && (
                      <button
                        onClick={() => alert(`Ligando para ${selectedLead.phone}...`)}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90"
                        style={{ background: "#059669" }}
                      >
                        <IconPhoneCall size={16} />
                        Ligar ({selectedLead.phone})
                      </button>
                    )}
                    {selectedLead.phone && (
                      <a
                        href={`https://wa.me/55${selectedLead.phone.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90"
                        style={{ background: "#25D366" }}
                      >
                        <IconWhatsApp size={16} />
                        WhatsApp
                      </a>
                    )}
                    {selectedLead.email && (
                      <a
                        href={`mailto:${selectedLead.email}`}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-all"
                      >
                        <IconEmail size={16} />
                        E-mail
                      </a>
                    )}
                  </div>

                  {/* Resultado do contato — clicking finalizes activity (Change 1) */}
                  <div
                    style={{
                      animation: flashResult === "green" ? "flashGreen 0.4s ease-out" : flashResult === "gray" ? "flashGray 0.2s ease-out" : undefined,
                    }}
                    className="rounded-xl p-4 border border-gray-100"
                  >
                    <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-3 block">
                      Resultado do contato · Tentativa {getAttemptCount(selectedTask)}/{MAX_CONTACT_ATTEMPTS}
                      <span className="ml-2 text-[10px] font-normal text-gray-300">(finaliza atividade)</span>
                    </label>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      {/* Ganho / Agendou */}
                      <button
                        onClick={() => setPendingResult({ taskId: selectedTask.id, result: "ganho" })}
                        className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02]"
                        style={{ background: "#059669", boxShadow: "0 2px 8px rgba(5,150,105,0.3)" }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Ganho / Agendou
                      </button>
                      {/* Sem interesse = perdido */}
                      <button
                        onClick={() => setPendingResult({ taskId: selectedTask.id, result: "sem_interesse" })}
                        className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                        style={{ background: "#DC2626" }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        Sem interesse
                      </button>
                      {/* Separador */}
                      <div className="w-full border-t border-gray-100 my-1" />
                      {/* Atendeu (mantém em prospecção) */}
                      <button
                        onClick={() => setPendingResult({ taskId: selectedTask.id, result: "atendeu" })}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-gray-700 border-2 border-gray-200 bg-white hover:bg-gray-50 transition-all"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        Pediu retorno
                      </button>
                      <button
                        onClick={() => setPendingResult({ taskId: selectedTask.id, result: "nao_atendeu" })}
                        className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-gray-700 border-2 border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        N&#227;o atendeu
                      </button>
                      <button
                        onClick={() => setPendingResult({ taskId: selectedTask.id, result: "caixa_postal" })}
                        className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-gray-700 border-2 border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 12h7l2 3h2l2-3h7"/></svg>
                        Caixa postal
                      </button>
                      <button
                        onClick={() => setPendingResult({ taskId: selectedTask.id, result: "numero_errado" })}
                        className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                        style={{ background: "#DC2626" }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        N&#186; errado
                      </button>
                      <button
                        onClick={() => setPendingResult({ taskId: selectedTask.id, result: "desligou" })}
                        className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                        style={{ background: "#EA580C" }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07"/><path d="M1 1l22 22"/><path d="M4.22 4.22A19.79 19.79 0 0 0 2.12 12.67 2 2 0 0 0 4.11 15h3a2 2 0 0 0 2-1.72"/></svg>
                        Desligou
                      </button>
                    </div>

                    {/* Botão Finalizar Atividade — aparece após selecionar resultado */}
                    {pendingResult && pendingResult.taskId === selectedTask.id && (
                      <div className="mt-3 p-3 rounded-xl border-2 border-orange-200 bg-orange-50">
                        <p className="text-sm text-gray-700 mb-2">
                          Resultado selecionado: <strong>{
                            pendingResult.result === "ganho" ? "Ganho / Agendou" :
                            pendingResult.result === "sem_interesse" ? "Sem interesse" :
                            pendingResult.result === "atendeu" ? "Pediu retorno" :
                            pendingResult.result === "nao_atendeu" ? "Não atendeu" :
                            pendingResult.result === "caixa_postal" ? "Caixa postal" :
                            pendingResult.result === "numero_errado" ? "Nº errado" :
                            "Desligou"
                          }</strong>
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              const { taskId, result } = pendingResult;
                              // Todo o roteamento de desfecho (ganho/perdido/follow-up) mora
                              // em handleContactResult — fonte única de verdade do FUP.
                              await handleContactResult(taskId, result);
                              setPendingResult(null);
                            }}
                            className="flex-1 py-2.5 rounded-lg text-sm font-bold text-white"
                            style={{ background: "#F97316" }}
                          >
                            Finalizar Atividade
                          </button>
                          <button
                            onClick={() => setPendingResult(null)}
                            className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-500 border border-gray-200 hover:bg-gray-50"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Quick search buttons */}
                  <div>
                    <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-2 block">
                      Pesquisa r&#225;pida
                    </label>
                    <div className="flex items-center gap-2">
                      <a
                        href={selectedLead.linkedin_url
                          ? `https://${selectedLead.linkedin_url}`
                          : `https://linkedin.com/search/results/all/?keywords=${encodeURIComponent(selectedLead.full_name || "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 hover:bg-gray-50 transition-colors text-gray-700"
                      >
                        <span style={{ color: "#0A66C2" }}><IconLinkedIn size={16} /></span>
                        LinkedIn
                      </a>
                      <a
                        href={`https://google.com/search?q=${encodeURIComponent((selectedLead.full_name || "") + " " + (selectedLead.company_name || ""))}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 hover:bg-gray-50 transition-colors text-gray-700"
                      >
                        <IconGoogle />
                        Google
                      </a>
                      {selectedLead.email && (
                        <a
                          href={`mailto:${selectedLead.email}`}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 hover:bg-gray-50 transition-colors text-gray-700"
                        >
                          <span style={{ color: "#D97706" }}><IconEmail size={16} /></span>
                          E-mail
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Lead data completeness */}
                  {(() => {
                    const comp = getLeadCompleteness(selectedLead);
                    const pct = Math.round((comp.filled / comp.total) * 100);
                    return (
                      <div>
                        <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-2 block">
                          Dados do lead &#183; {comp.filled}/{comp.total} preenchidos
                        </label>
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-2">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              background: pct === 100 ? "#059669" : pct >= 75 ? "#0147FF" : "#D97706",
                            }}
                          />
                        </div>
                        {comp.missing.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {comp.missing.map((m) => (
                              <span key={m} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-600 border border-amber-200">
                                {m}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Cadence info */}
                  {selectedCadence && (
                    <div>
                      <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-1 block">Cad&#234;ncia</label>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-700">{selectedCadence.name}</span>
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-medium border"
                          style={{
                            background: selectedCadence.acquisition_channel === "levantada_de_mao" ? "#FFF7ED" : "#F0FDF4",
                            color: selectedCadence.acquisition_channel === "levantada_de_mao" ? "#EA580C" : "#15803D",
                            borderColor: selectedCadence.acquisition_channel === "levantada_de_mao" ? "#FDBA74" : "#BBF7D0",
                          }}
                        >
                          {ACQUISITION_LABELS[selectedCadence.acquisition_channel]}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Script da Atividade */}
              <div className="bg-white border border-gray-100 rounded-xl shadow-none">
                <button
                  onClick={() => setScriptExpanded(!scriptExpanded)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      Script da Atividade
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-50 text-[#F97316] border border-orange-200">
                      {CHANNEL_LABELS[selectedTask.channel_type]}
                    </span>
                  </div>
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className={`text-gray-400 transition-transform duration-200 ${scriptExpanded ? "rotate-180" : ""}`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {scriptExpanded && (
                  <div className="px-4 pb-4">
                    {loadedScript && (
                      <div className="mb-2">
                        <span className="text-[10px] text-green-600 font-medium uppercase tracking-wide">Script da cadência</span>
                      </div>
                    )}
                    <pre className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed bg-[#F8F9FA] rounded-lg p-4 border border-gray-100 font-sans">
                      {loadedScript || getScript(selectedTask.channel_type, selectedLead)}
                    </pre>
                    <button
                      onClick={() => handleCopy(loadedScript || getScript(selectedTask.channel_type, selectedLead), "script")}
                      className="mt-2 flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      {copiedField === "script" ? <IconCheck /> : <IconCopy />}
                      {copiedField === "script" ? "Copiado!" : "Copiar script"}
                    </button>
                  </div>
                )}
              </div>

              {/* Quick tags for notes (Change 3) */}
              <div>
                <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-2 block">
                  Anota&#231;&#245;es da atividade
                </label>
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  {["Interessado", "Pediu retorno", "Sem interesse", "Enviar proposta", "Agendar reuni\u00e3o", "Ocupado", "Ligar depois"].map((tag) => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150"
                      style={
                        selectedTags.includes(tag)
                          ? { background: "#F97316", color: "#fff", border: "1px solid #F97316" }
                          : { background: "#F9FAFB", color: "#6B7280", border: "1px solid #E5E7EB" }
                      }
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                {!showNoteField ? (
                  <button
                    onClick={() => setShowNoteField(true)}
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1.5"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Adicionar observa&#231;&#227;o...
                  </button>
                ) : (
                  <textarea
                    value={executionNotes}
                    onChange={(e) => setExecutionNotes(e.target.value)}
                    placeholder="Registre observa&#231;&#245;es sobre essa atividade..."
                    className="w-full h-24 px-4 py-3 text-sm rounded-xl border border-gray-200 bg-gray-50 placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none transition-all"
                    autoFocus
                  />
                )}
              </div>

              {/* Action buttons — only Pular (Change 1: removed "Atividade Executada") */}
              <div className="flex items-center gap-3 pt-2">
                {!showSkipReason ? (
                  <button
                    onClick={() => setShowSkipReason(true)}
                    className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-medium text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 transition-all duration-150"
                  >
                    <IconSkip />
                    Pular atividade
                  </button>
                ) : (
                  /* Skip reason inline (Change 4) */
                  <div className="flex-1">
                    <p className="text-xs font-medium text-gray-500 mb-2">Por que est&#225; pulando?</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {["Aguardando retorno", "Hor\u00e1rio inadequado", "Priorizar outro", "Outro"].map((reason) => (
                        <button
                          key={reason}
                          onClick={() => handleSkipWithReason(reason)}
                          className="px-3.5 py-2 rounded-lg text-xs font-medium text-gray-700 border border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300 transition-all"
                        >
                          {reason}
                        </button>
                      ))}
                      <button
                        onClick={() => setShowSkipReason(false)}
                        className="px-2 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <IconClose />
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}
      </div>

      {/* ══ MODAL LIGAÇÃO MANUAL ═════════════════════════════════════════════ */}
      {showDialer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Ligação Manual</h2>
              <button onClick={() => { setShowDialer(false); setDialNumber(""); }} className="text-gray-400 hover:text-gray-600">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Número de telefone</label>
              <input
                type="tel"
                value={dialNumber}
                onChange={(e) => setDialNumber(e.target.value)}
                placeholder="(11) 99999-9999"
                className="w-full px-4 py-3 text-lg text-center font-mono border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100"
                autoFocus
              />
            </div>
            <a
              href={dialNumber.trim() ? `tel:${dialNumber.replace(/\D/g, "")}` : "#"}
              onClick={() => { if (dialNumber.trim()) { setShowDialer(false); setDialNumber(""); } }}
              className={`mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold text-white transition-all ${dialNumber.trim() ? "hover:opacity-90" : "opacity-50 pointer-events-none"}`}
              style={{ background: "#059669" }}
            >
              <IconPhoneCall size={18} />
              Ligar
            </a>
          </div>
        </div>
      )}

      {/* ══ MODAL ATIVIDADE EXTRA ═════════════════════════════════════════════ */}
      {showExtraTaskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Atividade Extra</h2>
              <button onClick={() => setShowExtraTaskModal(false)} className="text-gray-400 hover:text-gray-600">
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
                  <option value="whatsapp">Enviar WhatsApp</option>
                  <option value="email">Enviar E-mail</option>
                  <option value="linkedin">Contato pelo LinkedIn</option>
                  <option value="pesquisa">Atividade de Pesquisa</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                onClick={async () => {
                  if (!extraTask.lead_id || !extraTask.date) return;
                  setSavingExtra(true);
                  const [h, m] = extraTask.time.split(":").map(Number);
                  const scheduled = new Date(extraTask.date);
                  scheduled.setHours(h, m, 0, 0);
                  const lead = leads.find(l => l.id === extraTask.lead_id);
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
                  setSavingExtra(false);
                  if (data) {
                    setTasks(prev => [...prev, data as Task]);
                    setShowExtraTaskModal(false);
                    setExtraTask({ lead_id: "", channel_type: "ligacao", date: "", time: "09:00", notes: "", _searchText: "" });
                  }
                }}
                disabled={savingExtra || !extraTask.lead_id || !extraTask.date}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "#0147FF" }}
              >
                {savingExtra ? "Salvando..." : "Agendar Atividade"}
              </button>
              <button
                onClick={() => setShowExtraTaskModal(false)}
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
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
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
