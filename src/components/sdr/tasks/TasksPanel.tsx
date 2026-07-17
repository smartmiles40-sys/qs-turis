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
import { notifyError } from "@/lib/qs/notify";
import { completeTask, skipTask, fetchQsUsers, transferLead, fetchActivityCounts, fetchActivityGoals, createCadenceTasks, undoCompleteTask, updateOpenTask, deleteExtraTask, fetchCadenceScripts, fetchAvailableCadences, type CadenceScriptRow } from "@/lib/qs/queries";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import { useChatAppDock } from "@/contexts/ChatAppDockContext";
import { getLeadScore } from "@/lib/leadScore";
import { formatPhoneDisplay, fillTemplate } from "@/lib/whatsapp";
import WhatsAppModal from "../whatsapp/WhatsAppModal";
import { dialViaWavoip, setOnCallEnded } from "@/lib/wavoip";
import { dialViaSip } from "@/lib/sip";
import { dialViaWebphone, isWebphoneConfigured, setOnCallEnded as setOnCallEndedWebphone } from "@/lib/webphone";
import { logCallEnded } from "@/lib/qs/callLog";
import { loadWorkHours, minutesLeftToday, minutesWorkedToday, DEFAULT_WORK_HOURS, nextExecutionDay, type WorkHours } from "@/lib/workHours";
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
  alreadyContacted: boolean,
): { label: string; bg: string; text: string; pulse: boolean } | null {
  // Primeiro contato já feito → o lead não é mais "sem contato" (as atividades
  // seguintes da cadência não voltam a marcar SEM CONTATO).
  if (alreadyContacted) return null;
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
    return { label: `Recém-chegado · ${diffMin}min`, bg: "#D1FAE5", text: "#059669", pulse: false };
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

// Canais que são LIGAÇÃO (recebem o bloco de classificação ao concluir).
const CALL_CHANNELS: ChannelType[] = ["ligacao", "ligacao_whatsapp"];

// Classificação da ligação (Growth Station): motivo/resultado da chamada, seleção
// única. `positive` = o SDR falou com a persona e avançou; `reached` = falou com
// alguém (conta como contato feito). O enum salvo vai em qs_tasks.contact_result.
const CALL_CLASSIFICATIONS: {
  key: string; label: string; desc: string; positive?: boolean; reached?: boolean;
}[] = [
  { key: "com_avanco", label: "Com avanço significativo", positive: true, reached: true,
    desc: "A conversa resultou em progresso tangível rumo ao objetivo — como agendar uma reunião ou demonstração." },
  { key: "sem_avanco", label: "Sem avanço significativo", reached: true,
    desc: "A conversa não avançou de forma significativa — não identificou as necessidades do lead ou não gerou interesse." },
  { key: "gatekeeper", label: "Parado no Gatekeeper",
    desc: "A conversa foi interrompida por um gatekeeper (assistente/secretária), impedindo o acesso à pessoa de interesse." },
  { key: "persona_indisponivel", label: "Persona indisponível",
    desc: "A pessoa com quem o SDR precisa falar não estava disponível durante a ligação." },
  { key: "telefone_incorreto", label: "Telefone incorreto",
    desc: "O número fornecido não corresponde ao telefone de contato da pessoa desejada." },
  { key: "sem_conexao", label: "Sem conexão",
    desc: "Não foi possível falar com ninguém — caixa postal, ocupado, chamando sem atender ou fora de serviço." },
];

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

/** Set de lead_ids a partir de linhas {lead_id} (ex.: tarefas concluídas = já contatados). */
function buildLeadIdSet(rows: { lead_id: string | null }[] | null): Set<string> {
  const s = new Set<string>();
  for (const r of rows || []) if (r.lead_id) s.add(r.lead_id);
  return s;
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
  // Só cadências DISPONÍVEIS — pro dropdown do Cadastrar Lead (item 12; congeladas/
  // rascunho não podem receber lead novo). `cadences` segue completo pro
  // cadencesMap, que precisa das congeladas pras tarefas antigas.
  const [availableCadences, setAvailableCadences] = useState<Cadence[]>([]);
  const [qsUsers, setQsUsers] = useState<SdrUser[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  // Quantas observações (notas) cada lead tem — pra mostrar a mini-notificação (item 6).
  const [noteCounts, setNoteCounts] = useState<Map<string, number>>(new Map());
  // Roteiros por atividade da cadência (script_text) — o gestor escreve e o SDR
  // agora VÊ no card (antes era gravado e nunca lido — auditoria 2026-07-14).
  const [cadenceScripts, setCadenceScripts] = useState<CadenceScriptRow[]>([]);
  // Leads que JÁ tiveram o primeiro contato (≥1 atividade concluída) — some o "SEM CONTATO".
  const [contactedLeadIds, setContactedLeadIds] = useState<Set<string>>(new Set());
  const markContacted = useCallback((leadId: string) => {
    setContactedLeadIds((prev) => { const s = new Set(prev); s.add(leadId); return s; });
  }, []);

  // Item ③ — atividades que o PRÓPRIO SDR concluiu HOJE (placar pessoal do dia).
  // Sempre escopado a currentUser.id (o gestor também vê só o dele aqui). Busca
  // leve (head count); fetchActivityCounts já trata erro em silêncio (console.warn).
  const [doneTodayMine, setDoneTodayMine] = useState(0);
  const refreshDoneTodayMine = useCallback(() => {
    if (!currentUser) return;
    fetchActivityCounts(currentUser.id).then((c) => setDoneTodayMine(c.doneToday));
  }, [currentUser]);

  // Falha no carregamento NÃO pode virar "Tudo limpo!" — guarda o erro pra
  // mostrar um estado próprio com "Tentar de novo".
  const [loadError, setLoadError] = useState(false);
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksRes, leadsRes, cadencesRes, usersData, productsRes, notesRes, contactedRes, scriptsData, availableData] = await Promise.all([
        supabase.from("qs_tasks").select("*").in("status", ["pendente", "atrasada"]).order("scheduled_at"),
        supabase.from("qs_leads").select("*"),
        supabase.from("qs_cadences").select("*"),
        fetchQsUsers(),
        supabase.from("qs_products").select("*").eq("is_active", true).order("name"),
        supabase.from("qs_notes").select("lead_id"),
        supabase.from("qs_tasks").select("lead_id").eq("status", "concluida"),
        fetchCadenceScripts(), // roteiros por atividade da cadência (item 6 — script_text)
        fetchAvailableCadences(), // só disponíveis — dropdown do Cadastrar Lead (item 12)
      ]);
      // supabase-js não lança em erro de query — checa as duas leituras vitais.
      if (tasksRes.error || leadsRes.error) {
        console.warn("[TasksPanel] falha ao carregar dados:", tasksRes.error ?? leadsRes.error);
        setLoadError(true);
      } else {
        setLoadError(false);
      }
      setTasks((tasksRes.data || []) as Task[]);
      setLeads((leadsRes.data || []) as Lead[]);
      setCadences((cadencesRes.data || []) as Cadence[]);
      setQsUsers(usersData);
      setProducts((productsRes.data || []) as { id: string; name: string }[]);
      setNoteCounts(buildNoteCounts(notesRes.data as { lead_id: string | null }[] | null));
      setContactedLeadIds(buildLeadIdSet(contactedRes.data as { lead_id: string | null }[] | null));
      setCadenceScripts(scriptsData);
      setAvailableCadences(availableData);
    } catch (err) {
      console.warn("[TasksPanel] falha ao carregar dados:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { loadData(); }, [loadData]);

  // Horário de funcionamento (Configurações) — alimenta as métricas de tempo.
  const [workHours, setWorkHours] = useState<WorkHours>(DEFAULT_WORK_HOURS);
  useEffect(() => { loadWorkHours().then(setWorkHours); }, []);

  // Equipe da reunião (Configurações) — listas do modal de Ganho.
  const [meetingTeam, setMeetingTeam] = useState({ schedulers: DEFAULT_MEETING_SCHEDULERS, owners: DEFAULT_MEETING_OWNERS });
  useEffect(() => { loadMeetingTeam().then(setMeetingTeam); }, []);

  // ── Fila em TEMPO REAL + fallback de polling ───────────────────────
  // Realtime: mudança em qs_tasks/qs_leads → refetch (debounced 1,2s). O poll de
  // 60s vira rede de segurança (pega o que o realtime perder). Nada atualiza com
  // modal aberto/desfecho pendente (pollBusyRef) nem com a aba oculta.
  const pollBusyRef = useRef(false);
  const refreshQueue = useCallback(async () => {
    if (document.hidden || pollBusyRef.current) return;
    try {
      const [tasksRes, leadsRes, notesRes, contactedRes] = await Promise.all([
        supabase.from("qs_tasks").select("*").in("status", ["pendente", "atrasada"]).order("scheduled_at"),
        supabase.from("qs_leads").select("*"),
        supabase.from("qs_notes").select("lead_id"),
        supabase.from("qs_tasks").select("lead_id").eq("status", "concluida"),
      ]);
      if (tasksRes.data) setTasks(tasksRes.data as Task[]);
      if (leadsRes.data) setLeads(leadsRes.data as Lead[]);
      if (notesRes.data) setNoteCounts(buildNoteCounts(notesRes.data as { lead_id: string | null }[]));
      if (contactedRes.data) setContactedLeadIds(buildLeadIdSet(contactedRes.data as { lead_id: string | null }[]));
      refreshDoneTodayMine(); // placar "feitas hoje" acompanha o refresh de 60s
    } catch { /* silencioso — próxima rodada tenta de novo */ }
  }, [refreshDoneTodayMine]);

  useEffect(() => {
    const id = setInterval(refreshQueue, 60_000); // fallback
    // Realtime (precisa das tabelas na publication — migration 0009)
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(refreshQueue, 1_200);
    };
    const channel = supabase
      .channel("qs_fila_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "qs_tasks" }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "qs_leads" }, onChange)
      .subscribe();
    return () => {
      clearInterval(id);
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [refreshQueue]);

  // ── Presença: "em atendimento por Fulano" ──────────────────────────
  // Cada SDR anuncia em qual lead está (card ativo). Se OUTRO usuário estiver no
  // mesmo lead, o card mostra o aviso — fim da ligação duplicada.
  const [othersOnLead, setOthersOnLead] = useState<Map<string, string>>(new Map());
  const presenceRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    if (!currentUser) return;
    const ch = supabase.channel("qs_painel_presence", { config: { presence: { key: currentUser.id } } });
    presenceRef.current = ch;
    const rebuild = () => {
      const state = ch.presenceState<{ name: string; leadId: string | null }>();
      const m = new Map<string, string>();
      Object.entries(state).forEach(([userId, metas]) => {
        if (userId === currentUser.id) return;
        const meta = metas[metas.length - 1];
        if (meta?.leadId) m.set(meta.leadId, meta.name);
      });
      setOthersOnLead(m);
    };
    ch.on("presence", { event: "sync" }, rebuild)
      .on("presence", { event: "join" }, rebuild)
      .on("presence", { event: "leave" }, rebuild)
      .subscribe();
    return () => { supabase.removeChannel(ch); presenceRef.current = null; };
  }, [currentUser]);


  // Filtro "Responsável" — declarado aqui em cima porque o PLACAR também o usa.
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);

  // Placar REAL: atividades concluídas (hoje/mês) + metas de qs_goals.
  // ESCOPO: SDR vê sempre o próprio placar; admin/gestor vê o da UNIDADE
  // selecionada no filtro "Responsável". A meta é sempre POR UNIDADE (pedido do
  // Bruno) — sem unidade selecionada cai na meta global, nunca na soma do time.
  const [doneCounts, setDoneCounts] = useState({ doneToday: 0, doneMonth: 0 });
  const [goalTargets, setGoalTargets] = useState<{ daily: number | null; monthly: number | null }>({ daily: null, monthly: null });
  const countsScope = currentUser && !canSeeAllData(currentUser.role) ? currentUser.id : (ownerFilter || null);
  const refreshCounts = useCallback(() => {
    fetchActivityCounts(countsScope).then(setDoneCounts);
    refreshDoneTodayMine(); // placar pessoal "feitas hoje" acompanha os desfechos
  }, [countsScope, refreshDoneTodayMine]);
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

  // Classifica a tarefa pro controle FUP / Atrasada (pedido do Bruno). A categoria
  // "Novo" foi EXTINTA: todo lead sem 1º contato entra como FUP 1 (fupDay mínimo 1).
  //  • fupDay = dia da cadência da tarefa (dia 1 = FUP 1, dia 2 = FUP 2…), derivado
  //             da data agendada vs. a chegada do lead (o task não guarda o dia)
  //  • overdue= venceu ANTES de hoje (a "atrasada" é sempre derivada da data)
  function classifyTask(task: Task): { fupDay: number; overdue: boolean } {
    const lead = getLeadForTask(task);
    const base = lead?.arrived_at || lead?.created_at || task.created_at;
    let fupDay = 1;
    if (base) {
      const d0 = new Date(base); d0.setHours(0, 0, 0, 0);
      const d1 = new Date(task.scheduled_at); d1.setHours(0, 0, 0, 0);
      fupDay = Math.max(1, Math.round((d1.getTime() - d0.getTime()) / 86400000) + 1);
    }
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const overdue = new Date(task.scheduled_at).getTime() < startToday.getTime();
    return { fupDay, overdue };
  }

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelType | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<PriorityLevel | null>(null);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter | null>(null);
  // (ownerFilter é declarado lá em cima, junto do placar, que também depende dele)

  // Confirmação do desfecho no card da "Próxima atividade"
  const [pendingResult, setPendingResult] = useState<{ taskId: string; result: string } | null>(null);
  // Timer de auto-conclusão pós-ligação NÃO ATENDIDA (item sprint): 10s pra o SDR
  // agir; senão conclui como "Não atendeu" e libera o próximo card.
  const [autoFinish, setAutoFinish] = useState<{ taskId: string; secs: number } | null>(null);
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
  const [newLeadError, setNewLeadError] = useState<string | null>(null);

  // Classificação da ligação: ao concluir uma atividade de LIGAÇÃO, o SDR escolhe
  // o motivo do resultado da chamada (radio único). Guarda o contexto pro título.
  const [classifyFor, setClassifyFor] = useState<{ taskId: string; leadName: string; phone: string | null; atLabel: string } | null>(null);
  const [classifySel, setClassifySel] = useState<string | null>(null);

  // Menu (⋯) do card: adiar/reagendar/editar/excluir extra (Sprint 4 — item 1/3).
  const [taskMenuOpen, setTaskMenuOpen] = useState(false);
  // Edição inline da tarefa (data/horário/canal/notas) — aberta pelo menu (⋯).
  const [editFor, setEditFor] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ date: "", time: "09:00", channel: "ligacao" as ChannelType, notes: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  // Roteiro da atividade (script_text) — colapsável no hero (Sprint 4 — item 6).
  const [scriptOpen, setScriptOpen] = useState(true);
  // Modal de WhatsApp com o roteiro pré-preenchido (quando a atividade tem script).
  const [waModal, setWaModal] = useState<{ lead: Lead; text: string } | null>(null);

  // O polling pausa enquanto o SDR está no meio de algo (atualizado a cada render).
  pollBusyRef.current = Boolean(
    meetingFor || transferOpen || pendingResult || obsText.trim() || savingObs ||
    showNewLeadModal || showExtraTaskModal || showDialer || skipMenuOpen || finalizing || classifyFor ||
    taskMenuOpen || editFor || waModal
  );

  // Celebration (shown once per session when daily goal hit)
  const [celebrationShown, setCelebrationShown] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);

  // Toast notification — com ação opcional (ex.: "Desfazer" na conclusão).
  const [toast, setToast] = useState<{ message: string; visible: boolean; action?: { label: string; run: () => void } } | null>(null);
  const toastTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function showToast(message: string, action?: { label: string; run: () => void }) {
    // Cancela os timers do toast anterior — senão o timer velho apaga o toast novo no meio.
    toastTimersRef.current.forEach(clearTimeout);
    setToast({ message, visible: true, action });
    // Toast com ação (Desfazer) fica ~10s na tela; o informativo, 3s.
    const ttl = action ? 10_000 : 3_000;
    toastTimersRef.current = [
      setTimeout(() => setToast(prev => prev ? { ...prev, visible: false } : null), ttl),
      setTimeout(() => setToast(null), ttl + 500),
    ];
  }

  // Persiste o PRÓXIMO PASSO do lead conforme o desfecho do contato.
  // Cria uma nova tarefa 'pendente' em qs_tasks (mesmo canal, data futura) e a devolve
  // para o estado local. Assim NENHUM lead fica sem próxima tarefa.
  async function insertFollowUp(task: Task, result: string): Promise<Task | null> {
    // ANTI-DUPLICAÇÃO: a cadência cria as tarefas de TODOS os dias na entrada do
    // lead. Se o lead JÁ tem outra atividade aberta (ex.: o dia 2 do plano), NÃO
    // criamos follow-up dinâmico — senão a fila duplica (2+ cards do mesmo lead
    // no mesmo dia), o SDR liga 2x pro mesmo lead e o FUP/placar inflam. O
    // follow-up dinâmico é a REDE DE SEGURANÇA pra quando o plano acabou.
    const { data: nextOpen } = await supabase
      .from("qs_tasks")
      .select("id")
      .eq("lead_id", task.lead_id)
      .in("status", ["pendente", "atrasada"])
      .neq("id", task.id)
      .limit(1);
    if (nextOpen && nextOpen.length > 0) return null;

    // Próximo dia ÚTIL da cadência (execution_weekdays; padrão seg–sex).
    // O "amanhã 09:00" fixo caía em sábado/domingo e amanhecia atrasado na segunda.
    const cadDays = getCadenceForTask(task)?.execution_weekdays;
    const allowed = cadDays && cadDays.length > 0 ? cadDays : [1, 2, 3, 4, 5];
    const next = new Date();
    for (let i = 0; i < 14; i++) {
      next.setDate(next.getDate() + 1);
      if (allowed.includes(next.getDay())) break;
    }
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
      com_avanco: "Reunião ficou de ser agendada — retomar o agendamento",
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
      notifyError("Não foi possível criar o follow-up — o lead pode ficar sem próxima atividade!");
      return null;
    }
    // Teto de tentativas (decisão do Bruno: AVISAR, não perder automático).
    // O follow-up é criado mesmo assim, mas o SDR fica sabendo que estourou.
    if (attempt > MAX_CONTACT_ATTEMPTS) {
      const leadName = getLeadForTask(task)?.full_name || "o lead";
      notifyError(`${leadName} passou de ${MAX_CONTACT_ATTEMPTS} tentativas sem contato (esta é a ${attempt}ª) — avalie dar Perdido, transferir ou mudar o canal.`);
    }
    return (data as Task) ?? null;
  }

  // Encerra (ignora) as demais tarefas pendentes do lead — usado quando o lead é
  // ganho/perdido. MEDIDO (item 7 da Sprint 4): retorna false se o banco recusar —
  // senão as tarefas "ressuscitavam" no refresh de 60s sem ninguém saber por quê.
  async function closeRemainingLeadTasks(leadId: string, exceptTaskId: string, reason: string): Promise<boolean> {
    const others = tasks.filter(t => t.lead_id === leadId && t.id !== exceptTaskId);
    if (others.length === 0) return true;
    const { error } = await supabase
      .from("qs_tasks")
      .update({ status: "ignorada", skip_reason: reason })
      .in("id", others.map(t => t.id));
    if (error) {
      console.warn("[QS] closeRemainingLeadTasks falhou:", error);
      return false;
    }
    return true;
  }

  // Guarda anti-reentrada dos desfechos: protege Enter+clique e tecla repetida
  // independente de quem seta `finalizing` (o botão "Finalizar" seta antes de chamar).
  const outcomeBusyRef = useRef(false);

  async function handleContactResult(taskId: string, result: string) {
    if (outcomeBusyRef.current) return;
    const currentTask = tasks.find(t => t.id === taskId);
    if (!currentTask) return;
    outcomeBusyRef.current = true;
    try {
      // 1. Conclui a tentativa atual (marca 'concluida' + registra contact_result).
      // Se a gravação FALHAR (ou a tarefa já tiver sido concluída), aborta aqui:
      // nada de toast verde, nada de sumir da fila, nada de Bitrix — antes o erro
      // e o "sucesso" apareciam juntos e o QS divergia do Bitrix em silêncio.
      const completed = await completeTask(taskId, result);
      if (!completed) return;
      markContacted(currentTask.lead_id); // lead trabalhado → some o "sem contato" nas próximas

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
        const { error: updErr } = await supabase.from("qs_leads").update({ status: "ganho" }).eq("id", currentTask.lead_id);
        if (updErr) {
          notifyError("A atividade foi concluída, mas o lead NÃO foi marcado como ganho — marque pelo perfil do lead.");
          setTasks(prev => prev.filter(t => t.id !== taskId));
          return;
        }
        notifyBitrix("ganho", { lead_id: currentTask.lead_id, bitrix_id: desfechoLead?.bitrix_id, full_name: desfechoLead?.full_name });
        const okCloseG = await closeRemainingLeadTasks(currentTask.lead_id, taskId, "Lead ganho");
        if (!okCloseG) notifyError("O lead foi ganho, mas as demais atividades dele não foram encerradas — podem reaparecer na fila.");
        setLeads(prev => prev.map((l): Lead => l.id === currentTask.lead_id ? { ...l, status: "ganho" } : l));
        setTasks(prev => prev.filter(t => t.lead_id !== currentTask.lead_id));
        showToast(`Ganho! ${leadName}`);
      } else if (result === "sem_interesse") {
        const { error: updErr } = await supabase.from("qs_leads").update({ status: "perdido" }).eq("id", currentTask.lead_id);
        if (updErr) {
          notifyError("A atividade foi concluída, mas o lead NÃO foi marcado como perdido — marque pelo perfil do lead.");
          setTasks(prev => prev.filter(t => t.id !== taskId));
          return;
        }
        notifyBitrix("perdido", { lead_id: currentTask.lead_id, bitrix_id: desfechoLead?.bitrix_id, full_name: desfechoLead?.full_name });
        const okCloseP = await closeRemainingLeadTasks(currentTask.lead_id, taskId, "Lead perdido — sem interesse");
        if (!okCloseP) notifyError("O lead foi marcado perdido, mas as demais atividades dele não foram encerradas — podem reaparecer na fila.");
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
        // Desfazer (~10s): volta a tarefa pra pendente e remove o follow-up criado junto.
        showToast(`Atividade registrada — ${leadName}`, {
          label: "Desfazer",
          run: () => undoCompletion(currentTask, followUp?.id ?? null),
        });
      }
      refreshCounts(); // placar de metas atualiza na hora
    } finally {
      outcomeBusyRef.current = false;
    }
  }

  // Marca a atividade como CONCLUÍDA (conta no placar do dia), some da fila e
  // libera a próxima. A observação (se houver) fica salva no perfil do lead.
  //
  // LIGAÇÃO: em vez de concluir direto, abre o bloco de CLASSIFICAÇÃO — o SDR
  // escolhe o motivo do resultado da chamada (só um clique pra registrar o que
  // aconteceu, mesmo quando o cliente não atende).
  async function handleConcludeActivity(task: Task) {
    if (CALL_CHANNELS.includes(task.channel_type)) {
      const lead = getLeadForTask(task);
      const now = new Date();
      const data = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
      const hora = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      setClassifySel(null);
      setClassifyFor({
        taskId: task.id,
        leadName: lead?.full_name || "o lead",
        phone: lead?.phone ? formatPhoneDisplay(lead.phone) : null,
        atLabel: `${data} às ${hora}`,
      });
      return;
    }
    if (outcomeBusyRef.current) return; // anti duplo clique / tecla "C" repetida
    outcomeBusyRef.current = true;
    try {
      const obs = obsText.trim();
      // Conclui PRIMEIRO; a observação só é gravada se a conclusão pegou — senão
      // a nota ia pro Bitrix sem a atividade existir concluída no QS.
      const completed = await completeTask(task.id, "concluida", obs || undefined, obs ? ["observacao"] : undefined);
      if (!completed) return; // falhou (ou já concluída): mantém o card e a observação digitada
      if (obs) {
        await persistObservation(task.lead_id, `${CHANNEL_LABELS[task.channel_type]} — Concluída: ${obs}`, ["bitrix", "observacao"]);
      }
      markContacted(task.lead_id); // primeiro contato feito → não é mais "sem contato"
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      setActiveTaskId(null);
      setObsText("");
      refreshCounts();
      // Desfazer (~10s): a tecla "C" concluía na hora sem NENHUM caminho de volta.
      showToast("Atividade concluída", { label: "Desfazer", run: () => undoCompletion(task, null) });
    } finally {
      outcomeBusyRef.current = false;
    }
  }

  // DESFAZ uma conclusão recém-feita (botão "Desfazer" do toast — Sprint 4, item 2):
  // volta a tarefa pra 'pendente' no banco (medido em undoCompleteTask) e apaga o
  // follow-up criado junto, se houver. A nota/observação já enviada permanece —
  // ela reflete um contato que de fato aconteceu.
  const undoBusyRef = useRef(false);
  async function undoCompletion(original: Task, followUpId: string | null) {
    if (undoBusyRef.current) return;
    undoBusyRef.current = true;
    // some o toast já — evita segundo clique no "Desfazer"
    toastTimersRef.current.forEach(clearTimeout);
    setToast(null);
    try {
      const ok = await undoCompleteTask(original.id);
      if (!ok) return; // undoCompleteTask já avisou o motivo
      if (followUpId) {
        const { data: del, error: delErr } = await supabase
          .from("qs_tasks")
          .delete()
          .eq("id", followUpId)
          .in("status", ["pendente", "atrasada"])
          .select("id");
        if (delErr || !del || del.length === 0) {
          console.warn("[QS] undoCompletion: follow-up não removido:", delErr);
          notifyError("A conclusão foi desfeita, mas o follow-up criado junto não foi removido — ele continua na fila.");
        }
      }
      setTasks((prev) => {
        const rest = prev.filter((t) => t.id !== original.id && t.id !== followUpId);
        return [...rest, { ...original, status: "pendente" as const, completed_at: null }];
      });
      refreshCounts(); // o placar devolve o ponto
      showToast("Conclusão desfeita — a atividade voltou pra fila");
    } finally {
      undoBusyRef.current = false;
    }
  }

  // Finaliza a ligação com a classificação escolhida (radio único). Salva o enum
  // em contact_result, registra a nota (vai pro Bitrix) e gera o próximo passo —
  // nenhum lead fica órfão. "com_avanco" leva ao agendamento da reunião.
  async function handleClassifyCall() {
    if (!classifyFor || !classifySel) return;
    const task = tasks.find((t) => t.id === classifyFor.taskId);
    if (!task) { setClassifyFor(null); return; }
    const meta = CALL_CLASSIFICATIONS.find((c) => c.key === classifySel);
    if (finalizing) return;
    setFinalizing(true);
    try {
      const obs = obsText.trim();
      const leadName = getLeadForTask(task)?.full_name || "Lead";

      // 1) Conclui a tarefa gravando a classificação como resultado do contato.
      // Falhou? mantém o modal aberto pro SDR tentar de novo (nada foi gravado).
      const completed = await completeTask(task.id, classifySel, obs || undefined, ["classificacao", classifySel]);
      if (!completed) return;

      // 2) Falou com alguém? então marca contato feito (some "sem contato").
      if (meta?.reached) markContacted(task.lead_id);

      // 3) Resumo pro perfil do lead / Bitrix.
      const resumo = `Ligação — ${meta?.label ?? classifySel}${obs ? `: ${obs}` : ""}`;
      await persistObservation(task.lead_id, resumo, ["bitrix", "ligacao", "classificacao", classifySel]);
      setObsText("");

      // 4) "Com avanço" (agendou reunião/demo) → vai pro agendamento.
      if (meta?.positive) {
        setClassifyFor(null);
        setClassifySel(null);
        openMeetingGanho(task);
        return;
      }

      // 5) Demais casos → cria o próximo passo da cadência (lead segue trabalhado).
      const followUp = await insertFollowUp(task, classifySel);
      setTasks((prev) => {
        const rest = prev.filter((t) => t.id !== task.id);
        return followUp ? [...rest, followUp] : rest;
      });
      setActiveTaskId(null);
      setClassifyFor(null);
      setClassifySel(null);
      refreshCounts();
      showToast(`Ligação classificada — ${leadName}`, {
        label: "Desfazer",
        run: () => undoCompletion(task, followUp?.id ?? null),
      });
    } finally {
      setFinalizing(false);
    }
  }

  // Salva a observação como nota do lead (n8n empurra pro Bitrix — itens 1 e 4).
  async function persistObservation(leadId: string, body: string, tags: string[] = ["bitrix"]) {
    const text = body.trim();
    if (!text) return;
    try {
      // Grava PRIMEIRO — o contador e o espelho no Bitrix só acontecem se a nota
      // existir de verdade (supabase-js não lança: o erro vem no retorno).
      const { error } = await supabase.from("qs_notes").insert({
        lead_id: leadId,
        author_id: currentUser?.id ?? null,
        body: text,
        tags,
      });
      if (error) {
        console.warn("[QS] não foi possível salvar a observação:", error);
        notifyError("Não foi possível salvar a observação — tente novamente.");
        return;
      }
      // Mini-notificação (item 6): incrementa o contador de observações do lead.
      setNoteCounts((prev) => { const m = new Map(prev); m.set(leadId, (m.get(leadId) || 0) + 1); return m; });
      // Espelha como comentário na timeline do negócio no Bitrix.
      notifyBitrix("nota", {
        lead_id: leadId,
        bitrix_id: leads.find((l) => l.id === leadId)?.bitrix_id,
        body: text,
      });
    } catch (e) {
      console.warn("[QS] não foi possível salvar a observação:", e);
      notifyError("Não foi possível salvar a observação — tente novamente.");
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

  // Cancela o modal de agendamento COM rede de segurança. No caminho "com avanço"
  // a tarefa já foi CONCLUÍDA antes de abrir o agendamento — cancelar aqui deixava
  // o lead sem nenhuma atividade aberta (zumbi invisível pra fila de todo mundo).
  // Se o lead ficou sem tarefa aberta, criamos um follow-up de "retomar o
  // agendamento". No caminho "Ganho/Agendou" a tarefa segue pendente e nada muda.
  async function cancelMeetingModal() {
    const ctx = meetingFor;
    setMeetingFor(null);
    if (!ctx) return;
    const { data: open } = await supabase
      .from("qs_tasks")
      .select("id")
      .eq("lead_id", ctx.leadId)
      .in("status", ["pendente", "atrasada"])
      .limit(1);
    if (open && open.length > 0) return; // ainda tem próxima atividade — ok
    const src = tasksRef.current.find((t) => t.id === ctx.taskId);
    if (!src) return;
    const followUp = await insertFollowUp(src, "com_avanco");
    setTasks((prev) => {
      const rest = prev.filter((t) => t.id !== ctx.taskId); // a origem já está concluída no banco
      return followUp ? [...rest, followUp] : rest;
    });
    if (followUp) showToast("Agendamento cancelado — criei um follow-up pra retomar com o lead.");
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
    // Item 7 (Sprint 4): cada passo secundário é MEDIDO — falha não some mais em
    // silêncio (as tarefas "ressuscitavam" no refresh de 60s sem explicação).
    const failures: string[] = [];
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
        const { error: ins2Err } = await supabase.from("qs_meetings").insert(meetingRow);
        if (ins2Err) {
          console.warn("[QS] insert da reunião falhou também no formato antigo:", ins2Err);
          failures.push("a reunião NÃO foi registrada em Reuniões");
        }
      }
      if (meeting.emailCliente) {
        const { error: mailErr } = await supabase.from("qs_leads").update({ email: meeting.emailCliente }).eq("id", leadId);
        if (mailErr) {
          console.warn("[QS] e-mail do lead não atualizado:", mailErr);
          failures.push("o e-mail do lead não foi atualizado");
        }
      }
      // completeTask é no-op se a tarefa já foi concluída (caminho "com avanço");
      // erro REAL de gravação ele mesmo notifica lá dentro.
      await completeTask(taskId, "ganho");
      // Ganho do lead MEDIDO (.select): sob RLS a recusa é silenciosa (0 linhas).
      const { data: wonRows, error: wonErr } = await supabase
        .from("qs_leads").update({ status: "ganho" }).eq("id", leadId).select("id");
      if (wonErr || !wonRows || wonRows.length === 0) {
        console.warn("[QS] lead não marcado como ganho:", wonErr);
        failures.push("o lead NÃO foi marcado como ganho — marque pelo perfil do lead");
      }
      if (currentTask) {
        const okClose = await closeRemainingLeadTasks(leadId, taskId, "Lead ganho — reunião agendada");
        if (!okClose) failures.push("as demais atividades do lead não foram encerradas (podem reaparecer na fila)");
      }
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
      notifyError("Não foi possível registrar a reunião — confira em Reuniões antes de seguir.");
    }
    // Um aviso só, listando exatamente o que falhou (em vez de silêncio).
    if (failures.length > 0) {
      notifyError(`Ganho registrado com pendências: ${failures.join("; ")}.`);
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
    // Monta a data no FUSO LOCAL: `new Date("YYYY-MM-DD")` interpreta como meia-noite
    // UTC (= 21h do dia ANTERIOR no Brasil) e o retorno "de amanhã" nascia hoje, atrasado.
    const [yy, mo, dd] = extraTask.date.split("-").map(Number);
    const scheduled = new Date(yy, (mo || 1) - 1, dd || 1, h || 9, m || 0, 0, 0);
    const lead = leads.find((l) => l.id === extraTask.lead_id);
    // "Pediu retorno" é MAIS UMA atividade do FUP (decisão do Bruno): herda a
    // contagem de tentativas da tarefa de origem — antes nascia sem tag e o
    // contador voltava pra 1, apagando o histórico do FUP.
    const originTask = extraFromTaskId ? tasks.find((t) => t.id === extraFromTaskId) : null;
    const extraTags = originTask ? ["follow-up", "retorno", `tentativa:${getAttemptCount(originTask) + 1}`] : [];
    const { data, error: extraError } = await supabase.from("qs_tasks").insert({
      lead_id: extraTask.lead_id,
      cadence_id: lead?.cadence_id || null,
      owner_id: currentUser?.id || null,
      channel_type: extraTask.channel_type,
      priority: "alta",
      scheduled_at: scheduled.toISOString(),
      status: "pendente",
      is_extra: true,
      notes: extraTask.notes || null,
      tags: extraTags,
    }).select().single();
    const extra = (data as Task | null) ?? null;

    // A extra NÃO foi criada? Aborta TUDO aqui — antes o código seguia e ignorava
    // as outras tarefas do lead, deixando-o órfão de atividades sem nenhum aviso.
    if (extraError || !extra) {
      console.warn("[QS] falha ao criar atividade extra:", extraError);
      notifyError("Não foi possível criar a atividade extra — nada foi alterado. Tente novamente.");
      setSavingExtra(false);
      return;
    }

    // REGRA: encerra as demais tarefas pendentes/atrasadas do lead (menos a extra e a de origem).
    // MEDIDO (item 7 da Sprint 4): se o banco recusar, as tarefas "ressuscitavam" no
    // refresh de 60s sem aviso nenhum — agora o SDR fica sabendo na hora.
    const exclude = [extra.id, extraFromTaskId].filter(Boolean) as string[];
    let q = supabase.from("qs_tasks").update({ status: "ignorada", skip_reason: "Substituída por atividade extra" })
      .eq("lead_id", extraTask.lead_id).in("status", ["pendente", "atrasada"]);
    if (exclude.length) q = q.not("id", "in", `(${exclude.join(",")})`);
    const { error: closeErr } = await q;
    if (closeErr) {
      console.warn("[QS] falha ao encerrar as demais tarefas do lead:", closeErr);
      notifyError("A atividade extra foi criada, mas as OUTRAS atividades do lead não foram encerradas — elas podem continuar na fila.");
    }

    // Se veio de "Pediu retorno", conclui a tarefa original + registra pro Bitrix.
    // completeTask devolve null quando NÃO gravou (erro real ele mesmo notifica;
    // null também cobre o no-op de "já concluída") — avisamos pro SDR conferir.
    const fromRetorno = extraFromTaskId;
    if (fromRetorno) {
      const done = await completeTask(fromRetorno, "atendeu");
      if (!done) {
        console.warn("[QS] retorno agendado, mas a atividade de origem não foi concluída agora:", fromRetorno);
        notifyError("O retorno foi agendado, mas a atividade de origem não foi concluída agora (pode já ter sido finalizada) — confira a fila.");
      }
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
    // Próximo dia ÚTIL da cadência (padrão seg–sex) — o "amanhã" fixo caía no
    // sábado/domingo e o retorno amanhecia atrasado na segunda (mesma regra do
    // insertFollowUp). O SDR ainda pode trocar a data no modal.
    const cadDays = getCadenceForTask(task)?.execution_weekdays;
    const allowed = cadDays && cadDays.length > 0 ? cadDays : [1, 2, 3, 4, 5];
    const d = new Date();
    for (let i = 0; i < 14; i++) {
      d.setDate(d.getDate() + 1);
      if (allowed.includes(d.getDay())) break;
    }
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

  // ── Sprint 4 — itens 1/3/5/6: adiar, editar, excluir extra, roteiro ────────

  // ADIA a tarefa mantendo o horário: "amanhã" ou "próximo dia útil" (calendário
  // central nextExecutionDay — respeita os execution_weekdays da cadência).
  // Gravação MEDIDA em updateOpenTask; `reasonNote` registra o motivo nas notas
  // (usado pelos motivos de pulo que REAGENDAM em vez de matar — item 5).
  async function postponeTask(task: Task, mode: "amanha" | "dia_util", reasonNote?: string) {
    setTaskMenuOpen(false);
    const base = new Date(task.scheduled_at);
    const target = new Date();
    target.setDate(target.getDate() + 1);
    target.setHours(base.getHours(), base.getMinutes(), 0, 0);
    const next = mode === "dia_util"
      ? nextExecutionDay(target, getCadenceForTask(task)?.execution_weekdays)
      : target;
    const patch: Partial<Pick<Task, "scheduled_at" | "notes">> = { scheduled_at: next.toISOString() };
    if (reasonNote) patch.notes = task.notes ? `${task.notes} · ${reasonNote}` : reasonNote;
    const updated = await updateOpenTask(task.id, patch);
    if (!updated) return; // updateOpenTask já avisou
    setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    setActiveTaskId(null);
    const when = next.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    showToast(reasonNote ? `Atividade reagendada para ${when} — ${reasonNote}` : `Atividade adiada para ${when}`);
  }

  // Abre a edição inline (data/horário/canal/notas) pré-preenchida com a tarefa.
  function openEditTask(task: Task) {
    const d = new Date(task.scheduled_at);
    setEditDraft({
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
      channel: task.channel_type,
      notes: task.notes ?? "",
    });
    setEditFor(task.id);
    setTaskMenuOpen(false);
  }

  async function handleSaveEdit(task: Task) {
    if (!editDraft.date || savingEdit) return;
    setSavingEdit(true);
    try {
      // Data no FUSO LOCAL (mesma regra do modal de extra — new Date("YYYY-MM-DD")
      // seria meia-noite UTC = dia anterior no Brasil).
      const [yy, mo, dd] = editDraft.date.split("-").map(Number);
      const [h, m] = editDraft.time.split(":").map(Number);
      const scheduled = new Date(yy, (mo || 1) - 1, dd || 1, h || 9, m || 0, 0, 0);
      const updated = await updateOpenTask(task.id, {
        scheduled_at: scheduled.toISOString(),
        channel_type: editDraft.channel,
        notes: editDraft.notes.trim() || null,
      });
      if (!updated) return; // updateOpenTask já avisou
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
      setEditFor(null);
      showToast("Atividade atualizada");
    } finally {
      setSavingEdit(false);
    }
  }

  // Exclui uma atividade EXTRA criada errada (item 3) — só is_extra, com confirmação.
  async function handleDeleteExtra(task: Task) {
    setTaskMenuOpen(false);
    if (!task.is_extra) return;
    const leadName = getLeadForTask(task)?.full_name || "o lead";
    if (!window.confirm(`Excluir a atividade extra de ${leadName}? Essa ação não tem volta.`)) return;
    const ok = await deleteExtraTask(task.id);
    if (!ok) return; // deleteExtraTask já avisou
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    setActiveTaskId(null);
    showToast("Atividade extra excluída");
  }

  // Roteiro (script_text) da atividade da cadência que casa com a tarefa (item 6).
  // Match: cadência + canal; desempate por horário (HH:MM) e depois pelo dia do plano.
  function getScriptForTask(task: Task): string | null {
    if (!task.cadence_id) return null;
    let cands = cadenceScripts.filter(
      (s) => s.cadence_id === task.cadence_id && s.channel_type === task.channel_type
    );
    if (cands.length === 0) return null;
    if (cands.length > 1) {
      const d = new Date(task.scheduled_at);
      const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const byTime = cands.filter((s) => (s.scheduled_time || "").slice(0, 5) === hhmm);
      if (byTime.length > 0) cands = byTime;
      if (cands.length > 1) {
        const day = classifyTask(task).fupDay;
        const byDay = cands.filter((s) => s.day_number === day);
        if (byDay.length > 0) cands = byDay;
      }
    }
    return cands[0]?.script_text ?? null;
  }

  // WhatsApp da tarefa: com roteiro → abre o modal com a mensagem PRONTA
  // (defaultText); sem roteiro → segue no dock do ChatApp como antes.
  function openWhatsAppForTask(task: Task, lead: Lead | undefined | null) {
    if (!lead) return;
    const script = task.channel_type === "whatsapp" ? getScriptForTask(task) : null;
    if (script) {
      setWaModal({ lead, text: fillTemplate(script, { name: lead.full_name }) });
      return;
    }
    openWhatsApp(lead);
  }

  // Filter logic
  const filteredTasks = useMemo(() => {
    let filtered = [...tasks];

    // Guard: tarefas de leads já encerrados (ganho/perdido) não aparecem na fila.
    // Exceção: re-contato agendado (tag "re_contato") — o lead está perdido de
    // propósito e a tarefa PRECISA aparecer quando a data chegar.
    filtered = filtered.filter((t) => {
      if (t.tags?.includes("re_contato")) return true;
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

    // "Atrasada" é DERIVADA da data (venceu antes de hoje) — o status 'atrasada'
    // nunca é gravado pelo sistema, então filtrar por ele mostrava sempre 0
    // enquanto o sino de notificações mostrava atrasadas de verdade.
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const startMs = startOfToday.getTime();
    const isOverdue = (t: Task) => new Date(t.scheduled_at).getTime() < startMs;
    if (statusFilter === "extras") {
      filtered = filtered.filter((t) => t.is_extra);
    } else if (statusFilter === "para_hoje") {
      filtered = filtered.filter((t) => !isOverdue(t));
    } else if (statusFilter === "atrasadas") {
      filtered = filtered.filter(isOverdue);
    }

    // (Filtro "Tipo" removido: a categoria "Novo" foi extinta — todo lead é FUP.)

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
      const qDigits = q.replace(/\D/g, ""); // telefone busca só por dígitos
      filtered = filtered.filter((t) => {
        const lead = getLeadForTask(t);
        if (!lead) return false;
        return (
          (lead.full_name?.toLowerCase().includes(q)) ||
          (lead.company_name?.toLowerCase().includes(q)) ||
          (lead.email?.toLowerCase().includes(q)) ||
          (qDigits.length >= 4 && (lead.phone ?? "").replace(/\D/g, "").includes(qDigits)) ||
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
  }, [tasks, leads, cadences, search, statusFilter, channelFilter, priorityFilter, periodFilter, ownerFilter, currentUser]);

  // Card "hero" atual (o que o SDR está atendendo) — usado no render E nos atalhos.
  const heroTaskMemo = useMemo(() => {
    const normais = filteredTasks.filter((t) => !t.is_extra);
    const activeInList = activeTaskId ? filteredTasks.find((t) => t.id === activeTaskId) : undefined;
    return activeInList ?? normais[0];
  }, [filteredTasks, activeTaskId]);

  // ── Atalhos de teclado (item 2 da Sprint Velocidade) ──────────────────────
  // 1 Ganho/Agendou · 2 Pediu retorno · 3 Perdido · 4-7 sem contato ·
  // C concluir · Enter confirma desfecho pendente · N próxima da fila.
  // Só agem com um card na tela e NENHUM campo de texto focado (e sem modal aberto).
  //
  // TUDO que o listener lê vem de REFS atualizadas a cada render (Sprint 4, item
  // 8): o efeito só re-rodava quando filteredTasks mudava, então os handlers
  // capturados viam obsText/tasks VELHOS — a tecla "C" concluía com a observação
  // vazia. Com as refs, o listener sempre chama a versão mais recente.
  const shortcutCtx = useRef<{ hero?: Task; pending: typeof pendingResult; busy: boolean }>({ hero: undefined, pending: null, busy: false });
  shortcutCtx.current = {
    hero: heroTaskMemo,
    pending: pendingResult,
    // classifyFor/editFor/menu/waModal também PAUSAM os atalhos (item 10): com a
    // classificação de ligação aberta, "C"/números agiam por baixo do bloco.
    busy: !!(meetingFor || transferOpen || skipMenuOpen || showExtraTaskModal || showDialer || showNewLeadModal || finalizing || classifyFor || editFor || taskMenuOpen || waModal),
  };
  const shortcutFnsRef = useRef({
    conclude: handleConcludeActivity,
    contact: handleContactResult,
    ganho: openMeetingGanho,
    retorno: openExtraFromRetorno,
    select: selectActive,
    filtered: [] as Task[],
  });
  shortcutFnsRef.current = {
    conclude: handleConcludeActivity,
    contact: handleContactResult,
    ganho: openMeetingGanho,
    retorno: openExtraFromRetorno,
    select: selectActive,
    filtered: filteredTasks,
  };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const { hero, pending, busy } = shortcutCtx.current;
      const fns = shortcutFnsRef.current;
      if (!hero || busy || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;

      const k = e.key.toLowerCase();
      const noContact = ["nao_atendeu", "caixa_postal", "numero_errado", "desligou"];
      if (k === "1") { e.preventDefault(); fns.ganho(hero); }
      else if (k === "2") { e.preventDefault(); fns.retorno(hero); }
      else if (k === "3") { e.preventDefault(); setPendingResult({ taskId: hero.id, result: "sem_interesse" }); }
      else if (["4", "5", "6", "7"].includes(k)) { e.preventDefault(); setPendingResult({ taskId: hero.id, result: noContact[Number(k) - 4] }); }
      else if (k === "c") { e.preventDefault(); fns.conclude(hero); }
      else if (k === "enter" && pending && pending.taskId === hero.id) {
        e.preventDefault();
        shortcutCtx.current.busy = true; // anti repetição até o próximo render
        fns.contact(hero.id, pending.result).finally(() => setPendingResult(null));
      }
      else if (k === "n" || k === "arrowright") {
        e.preventDefault();
        // próxima da fila (depois do hero)
        const normais = fns.filtered.filter((t) => !t.is_extra && t.id !== hero.id);
        if (normais[0]) fns.select(normais[0].id);
      }
      else if (k === "escape" && pending) { setPendingResult(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Monta UMA vez — o estado fresco chega pelas refs acima (nada de stale closure).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Anuncia o lead do card ativo (hero) sempre que ele muda — presença.
  const heroLeadIdForPresence = heroTaskMemo?.lead_id ?? null;
  useEffect(() => {
    const ch = presenceRef.current;
    if (!ch || !currentUser) return;
    ch.track({ name: currentUser.name, leadId: heroLeadIdForPresence }).catch(() => { /* offline */ });
  }, [heroLeadIdForPresence, currentUser]);

  // ── Desfecho automático pós-ligação (webfone) ─────────────────────────────
  // A chamada terminou → seleciona o card do lead e abre o desfecho. Se não foi
  // atendida, já pré-seleciona "Não atendeu" (o SDR só confirma com Enter).
  const tasksRef = useRef<Task[]>(tasks);
  tasksRef.current = tasks;
  useEffect(() => {
    // Mesmo desfecho automático pros DOIS webfones: Wavoip (WhatsApp) e WebRTC
    // (VoxFree). Ambos emitem o mesmo formato de CallEndedInfo.
    const handleCallEnded = (info: { leadId: string | null; phone: string | null; answered: boolean; durationSec: number }) => {
      // Loga TODA chamada encerrada (atendida ou não, com ou sem lead) — telemetria
      // fire-and-forget pras análises de telefonia. Vai ANTES do guard de leadId.
      void logCallEnded(info);
      if (!info.leadId) return;
      const task = tasksRef.current.find((t) => t.lead_id === info.leadId && (t.status === "pendente" || t.status === "atrasada"));
      if (!task) return;
      setActiveTaskId(task.id);
      if (!info.answered) {
        setPendingResult({ taskId: task.id, result: "nao_atendeu" });
        setAutoFinish({ taskId: task.id, secs: 10 });
        showToast("Ligação não atendida — concluindo em 10s (ou registre outro desfecho)");
      } else {
        showToast(`Ligação encerrada (${Math.round(info.durationSec / 60)}min) — registre o desfecho`);
      }
      // traz o card pra vista
      setTimeout(() => document.querySelector(".qsx-hero")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    };
    setOnCallEnded(handleCallEnded);
    setOnCallEndedWebphone(handleCallEnded);
    return () => { setOnCallEnded(null); setOnCallEndedWebphone(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-conclusão da ligação NÃO atendida ────────────────────────────────
  // 10s de contagem; se o SDR não agir, conclui como "Não atendeu" e libera o
  // próximo card. Usa um ref pra sempre chamar o handleContactResult mais atual.
  const finishRef = useRef<(taskId: string) => void>(() => {});
  finishRef.current = async (taskId: string) => {
    if (finalizing) return;
    setFinalizing(true);
    try { await handleContactResult(taskId, "nao_atendeu"); setPendingResult(null); }
    finally { setFinalizing(false); }
  };
  const autoFinishRef = useRef(autoFinish);
  autoFinishRef.current = autoFinish;
  useEffect(() => {
    if (!autoFinish) return;
    if (autoFinish.secs <= 0) {
      const tid = autoFinish.taskId;
      setAutoFinish(null);
      finishRef.current(tid);
      return;
    }
    const id = setTimeout(
      () => setAutoFinish((a) => (a && a.taskId === autoFinish.taskId ? { ...a, secs: a.secs - 1 } : a)),
      1000,
    );
    return () => clearTimeout(id);
  }, [autoFinish]);
  // Qualquer interação para o timer: mudar o desfecho, digitar observação, trocar
  // de card ou cancelar. (Lê autoFinish por ref pra não reiniciar a cada segundo.)
  useEffect(() => {
    const af = autoFinishRef.current;
    if (!af) return;
    const keep = pendingResult && pendingResult.taskId === af.taskId && pendingResult.result === "nao_atendeu" && !obsText.trim();
    if (!keep) setAutoFinish(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingResult, obsText]);

  // Contadores na MESMA base da fila exibida: só as tarefas do próprio SDR
  // (quando não é gestor/admin), de leads ainda ativos, até hoje. Antes contavam
  // a fila inteira do time + dias futuros e o número da saudação não batia.
  const endTodayMs = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); })();
  const startTodayMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const counterBase = useMemo(() => {
    let base = tasks.filter((t) => {
      if (t.tags?.includes("re_contato")) return true;
      const st = leadsMap.get(t.lead_id)?.status;
      return st !== "ganho" && st !== "perdido";
    });
    if (currentUser && !canSeeAllData(currentUser.role)) {
      base = base.filter((t) => t.owner_id === currentUser.id);
    }
    return base.filter((t) => new Date(t.scheduled_at).getTime() <= endTodayMs);
  }, [tasks, leadsMap, currentUser, endTodayMs]);
  const todayTasks = counterBase.filter((t) => new Date(t.scheduled_at).getTime() >= startTodayMs);
  const overdueTasks = counterBase.filter((t) => new Date(t.scheduled_at).getTime() < startTodayMs);
  const extraTasks = counterBase.filter((t) => t.is_extra);
  // Controle FUP / Atrasada (métrica que o Bruno pediu — sempre à vista). A
  // categoria "Novo" foi extinta: todo lead sem 1º contato é FUP 1, então TODA a
  // fila de hoje conta como "em FUP" (ninguém some da conta).
  const fupTasks = counterBase;


  // Placar real: concluídas hoje/mês vs metas (qs_goals, com fallback nos padrões)
  const DAILY_DONE = doneCounts.doneToday;
  const TOTAL_SCHEDULED = counterBase.length; // fila de hoje do PRÓPRIO SDR, não do time inteiro
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
  }, [DAILY_DONE, dailyGoal, celebrationShown]);

  // ── Renderizadores do design "Execução" (hero + pílulas) ───────────────────

  const periodOf = (task: Task): PeriodFilter =>
    new Date(task.scheduled_at).getHours() < 12 ? "manha" : "tarde";

  // Item 7 — escolher qual lead atender (vira o card ativo); reseta os campos.
  // Também limpa a classificação de ligação (item 10 — antes ela ficava "presa"
  // ao trocar de card e pausava a fila), o menu (⋯) e a edição inline.
  function selectActive(taskId: string) {
    setActiveTaskId(taskId);
    setObsText("");
    setPendingResult(null);
    setTransferOpen(false);
    setTransferTo("");
    setSkipMenuOpen(false);
    setClassifyFor(null);
    setClassifySel(null);
    setTaskMenuOpen(false);
    setEditFor(null);
    setScriptOpen(true); // roteiro volta aberto no card novo
  }

  // Card compacto da coluna de Atividades extras (retornos), destacado em azul.
  function renderExtraPill(task: Task) {
    const lead = getLeadForTask(task);
    const isActive = activeTaskId === task.id;
    const d = new Date(task.scheduled_at);
    const when = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " · " + formatTime(task.scheduled_at);
    // Atrasada derivada da data (item 9) — a data fica vermelha com o selo.
    const overdue = classifyTask(task).overdue;
    return (
      <div key={task.id} onClick={() => selectActive(task.id)} className={`qsx-extra-card${isActive ? " on" : ""}`} title="Clique para atender">
        <div className="flex items-center gap-2">
          <span className={`qsx-chan-ic ${CHANNEL_IC_CLASS[task.channel_type]}`} style={{ width: 30, height: 30, borderRadius: 9 }}>
            <ChannelIcon type={task.channel_type} size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold truncate" style={{ color: "var(--ink)" }}>{lead?.full_name || "Lead"}</div>
            <div className="text-[11.5px] font-semibold" style={{ color: overdue ? "#DC2626" : "var(--blue)" }} title={overdue ? "Atividade atrasada (venceu antes de hoje)" : undefined}>
              {overdue ? "⚠ " : ""}{when}{overdue ? " · atrasada" : ""}
            </div>
          </div>
        </div>
        <div className="text-[12px] mt-1.5 line-clamp-2" style={{ color: "var(--ink2)" }}>{task.notes || getActivityLabel(task.channel_type)}</div>
      </div>
    );
  }

  function renderPill(task: Task) {
    const lead = getLeadForTask(task);
    const cadence = getCadenceForTask(task);
    const slaAlert = getSlaAlert(lead, task, cadence, contactedLeadIds.has(lead?.id ?? ""));
    const prio = task.priority as PriorityLevel;
    const temp = getLeadScore(lead);
    const isActive = activeTaskId === task.id;
    // Atrasada é DERIVADA da data (nunca gravada) — item 9: sem o selo, a tarefa
    // atrasada era indistinguível da de hoje (o horário sozinho engana).
    const overdue = classifyTask(task).overdue;
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
            {temp && <span className="qsx-chip" style={{ background: temp.bg, color: temp.color }} title={`Temperatura vinda do Bitrix`}>{temp.label}</span>}
            <span className={`qsx-chip prio-${prio}`}><span className={`qsx-dot dot-${prio}`} />{PRIORITY_LABELS[prio]}</span>
            {slaAlert && (
              <span className="qsx-chip" style={{ background: slaAlert.bg, color: slaAlert.text, animation: slaAlert.pulse ? "pulseRed 1.5s ease-in-out infinite" : undefined }}>
                {slaAlert.label}
              </span>
            )}
            {task.is_extra && <span className="qsx-chip prio-baixa">Extra</span>}
            {overdue && (
              <span className="qsx-chip" style={{ background: "rgba(220,38,38,.12)", color: "#DC2626", fontWeight: 700 }} title="Atividade atrasada (venceu antes de hoje)">
                ⚠ Atrasada · era {new Date(task.scheduled_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
              </span>
            )}
          </div>
          <div className="qsx-pco mt-1">
            {lead?.company_name && <b>{lead.company_name}</b>}
            {lead?.company_name ? " · " : ""}
            {lead?.segment ? <>Fonte/Produto: <b>{lead.segment}</b> · </> : ""}
            {getActivityLabel(task.channel_type)}
            {cadence ? ` · ${cadence.name}` : ""}
          </div>
        </div>
        <div className="hidden lg:block shrink-0" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink2)", marginRight: 2 }}>
          {CHANNEL_LABELS[task.channel_type]}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {task.channel_type === "whatsapp" && lead?.phone && (
            <button onClick={(e) => { e.stopPropagation(); openWhatsAppForTask(task, lead); }} className="qsx-pa qsx-pa-wa" title={getScriptForTask(task) ? "Abrir WhatsApp com o roteiro da atividade preenchido" : "Abrir no ChatApp e copiar o número"}>
              <IconWhatsApp size={18} />
            </button>
          )}
          {(task.channel_type === "ligacao_whatsapp" || task.channel_type === "ligacao") && lead?.phone && (
            <button onClick={(e) => { e.stopPropagation(); pinTaskForCall(task); if (task.channel_type === "ligacao") callViaSip(lead.phone); else callViaWebfone(lead.phone, { leadName: lead.full_name, leadId: lead.id }); }} className="qsx-pa qsx-pa-wa" title={task.channel_type === "ligacao" ? "Ligar (BravoTech)" : "Ligar pelo webfone (Wavoip)"}>
              <ChannelIcon type="ligacao" size={17} />
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

  // Pina o card do lead ANTES de discar: a fila é "mais novo primeiro" e o
  // realtime pode trocar o hero no meio da ligação — sem o pin, o SDR
  // registraria o desfecho no lead errado.
  function pinTaskForCall(task: Task) {
    if (heroTaskMemo?.id === task.id) { setActiveTaskId(task.id); return; } // já é o hero — não apaga a observação digitada
    selectActive(task.id);
  }

  // Liga pelo WEBFONE (Wavoip) — TODA ligação do sistema sai por aqui.
  // Sem fallback pra WhatsApp externo: se o webfone não estiver configurado,
  // o SDR vê o erro na tela (e configura o token em Config → Webfone).
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
      console.warn("[QS] webfone indisponível:", r.error);
      notifyError(r.error || "Webfone indisponível — confira o token em Configurações → Webfone.");
    }
  }

  // Liga pelo canal "Ligação". Prefere o WEBFONE WebRTC (VoxFree): registra o
  // ramal e fala DENTRO do navegador, com desfecho automático ao encerrar. Se o
  // ramal do SDR ainda não estiver provisionado, cai no click-to-dial do
  // softphone (BravoTech/SIP) instalado no PC — a ligação acontece fora do
  // navegador e o SDR registra o desfecho na mão.
  async function callViaSip(phone?: string | null, opts?: { leadName?: string | null; leadId?: string | null }) {
    if (await isWebphoneConfigured()) {
      showToast("Ligando pelo webfone…");
      const r = await dialViaWebphone(phone, {
        leadName: opts?.leadName ?? null,
        leadId: opts?.leadId ?? null,
        ownerId: currentUser?.id ?? null,
      });
      if (!r.ok) notifyError(r.error || "Webfone WebRTC indisponível.");
      return;
    }
    const r = await dialViaSip(phone);
    if (r.ok) showToast("Discando no softphone (BravoTech)… registre o desfecho ao terminar");
    else notifyError(r.error || "Não foi possível abrir o softphone (BravoTech).");
  }

  // Botão do canal da tarefa. "Ligação" = softphone BravoTech (SIP); "Ligação
  // WhatsApp" continua no webfone Wavoip.
  function renderChannelAction(task: Task, lead: Lead | undefined) {
    switch (task.channel_type) {
      case "ligacao":
        // O "Ligar" (VoIP) agora vive na barra de contato fixa do card (sempre
        // visível), então aqui não repetimos o botão.
        return null;
      case "ligacao_whatsapp":
        return lead?.phone ? <button onClick={() => { pinTaskForCall(task); callViaWebfone(lead.phone, { leadName: lead.full_name, leadId: lead.id }); }} className="qsx-btn qsx-btn-green"><IconWhatsAppCall size={16} />Ligar no WhatsApp</button> : null;
      case "whatsapp":
        // "WhatsApp" (abrir conversa) já está na barra de contato fixa do card.
        return null;
      case "email": {
        if (!lead?.email) return null;
        // Fase 1 do e-mail integrado: abre o e-mail JÁ ESCRITO (script da atividade
        // ou template padrão) e registra a ação no histórico do lead.
        const firstName = (lead.full_name || "").split(/\s+/)[0] || "";
        const emailBody = (task.notes && task.notes.trim().length > 10 ? task.notes : null)
          ?? `Olá ${firstName},\n\nTudo bem? Sou da Se Tu For, Eu Vou! Viagens.\n\nVi seu interesse em viajar com a gente e queria te ajudar a dar o próximo passo. Podemos conversar?\n\nAbraço!`;
        const subject = `Sua viagem com a Se Tu For, Eu Vou!${lead.segment ? ` — ${lead.segment.replace(/[[\]]/g, "")}` : ""}`;
        const href = `mailto:${lead.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;
        return (
          <a
            href={href}
            onClick={() => persistObservation(lead.id, `E-mail — mensagem enviada para ${lead.email}`, ["bitrix", "email"])}
            className="qsx-btn qsx-btn-green"
          >
            <ChannelIcon type="email" size={16} />Escrever e-mail
          </a>
        );
      }
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
    const slaAlert = getSlaAlert(lead, task, cadence, contactedLeadIds.has(lead?.id ?? ""));
    const prio = task.priority as PriorityLevel;
    const temp = getLeadScore(lead);
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
            {temp && <span className="qsx-chip" style={{ background: temp.bg, color: temp.color }} title="Temperatura vinda do Bitrix">{temp.label}</span>}
            {othersOnLead.has(task.lead_id) && (
              <span className="qsx-chip" style={{ background: "rgba(229,72,77,.12)", color: "var(--red)", animation: "pulseRed 1.6s ease-in-out infinite" }} title="Outro usuário está com este lead aberto agora">
                👤 em atendimento por {othersOnLead.get(task.lead_id)}
              </span>
            )}
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
              {/* Menu (⋯): adiar/reagendar/editar/excluir extra — Sprint 4, itens 1 e 3 */}
              <div className="relative">
                <button
                  onClick={() => { setTaskMenuOpen((o) => !o); setEditFor(null); }}
                  className={`qsx-icon-sm${taskMenuOpen ? " on" : ""}`}
                  title="Mais opções (adiar, editar, excluir)"
                  aria-label="Mais opções da atividade"
                  aria-haspopup="menu"
                  aria-expanded={taskMenuOpen}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
                </button>
                {taskMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-30 rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid var(--line)", boxShadow: "0 12px 28px -14px rgba(16,24,40,.35)", minWidth: 230 }} role="menu">
                    <button className="qsx-menu-item" role="menuitem" onClick={() => postponeTask(task, "amanha")}>
                      Adiar para amanhã
                    </button>
                    <button className="qsx-menu-item" role="menuitem" onClick={() => postponeTask(task, "dia_util")}>
                      Adiar para o próximo dia útil
                    </button>
                    <button className="qsx-menu-item" role="menuitem" onClick={() => openEditTask(task)}>
                      Escolher data / editar…
                    </button>
                    {task.is_extra && (
                      <button className="qsx-menu-item danger" role="menuitem" onClick={() => handleDeleteExtra(task)}>
                        Excluir atividade extra…
                      </button>
                    )}
                  </div>
                )}
              </div>
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
              {/* Fonte do lead (campo Fonte do Bitrix) — sempre embaixo do nome pra
                  o SDR saber na hora de onde veio quem ele está atendendo. */}
              {lead?.segment && (
                <div className="flex items-center gap-1.5 mt-1" title="Fonte do lead (Bitrix) ou produto de interesse (cadastro manual)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--ink3)" }}>
                    <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span className="text-[12.5px] font-semibold" style={{ color: "var(--ink3)" }}>Fonte/Produto:</span>
                  <span className="text-[12.5px] font-bold" style={{ color: "var(--ink2)" }}>{lead.segment}</span>
                </div>
              )}
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
            <div className="ml-auto flex items-center gap-2 shrink-0 flex-wrap justify-end">
              {(() => {
                const c = classifyTask(task);
                const attempt = getAttemptCount(task);
                return (
                  <>
                    {/* "Novo" foi extinto: todo lead sem 1º contato é FUP 1. As DUAS
                        visões, com nomes distintos (decisão do Bruno): o DIA do
                        plano da cadência e a TENTATIVA real de contato. */}
                    <span className="qsx-chip" style={{ background: "rgba(180,83,9,.12)", color: "#B45309", fontWeight: 700 }} title={`Dia ${c.fupDay} do plano da cadência (pela data)`}>FUP dia {c.fupDay}</span>
                    <span className="qsx-chip" style={{ background: "rgba(1,71,255,.10)", color: "var(--blue, #0147FF)", fontWeight: 700 }} title={`${attempt}ª tentativa real de contato (independe de atraso)`}>{attempt}ª tentativa</span>
                    {c.overdue && (
                      <span className="qsx-chip" style={{ background: "rgba(220,38,38,.12)", color: "#DC2626", fontWeight: 700 }} title="Atividade atrasada (venceu antes de hoje — o status é derivado da data, nunca gravado)">
                        ⚠ Atrasada · era {new Date(task.scheduled_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                      </span>
                    )}
                  </>
                );
              })()}
              <span className="qsx-chip prio-baixa">{getActivityLabel(task.channel_type)}</span>
            </div>
          </div>

          {/* Ação de contato do card: UMA por atividade, conforme o canal da tarefa.
            Atividade de "Ligação" mostra só "Ligar"; atividade de "WhatsApp" mostra só
            "WhatsApp" — nunca as duas juntas (evita 2 execuções na mesma atividade).
            Os demais canais (e-mail, LinkedIn, Ligação-WhatsApp) usam o botão do
            renderChannelAction logo abaixo. */}
        {lead?.phone && task.channel_type === "ligacao" && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { pinTaskForCall(task); callViaSip(lead.phone, { leadName: lead.full_name, leadId: lead.id }); }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13.5px] font-bold text-white"
              style={{ background: "#12A18A", boxShadow: "0 6px 14px -8px rgba(18,161,138,.6)" }}
              title="Ligar pelo webfone (VoIP)"
            >
              <ChannelIcon type="ligacao" size={16} />Ligar
            </button>
          </div>
        )}
        {lead?.phone && task.channel_type === "whatsapp" && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => openWhatsAppForTask(task, lead)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13.5px] font-bold text-white"
              style={{ background: "#25D366", boxShadow: "0 6px 14px -8px rgba(37,211,102,.6)" }}
              title={getScriptForTask(task) ? "Abrir WhatsApp com o roteiro da atividade preenchido" : "Abrir conversa no WhatsApp"}
            >
              <IconWhatsApp size={16} />WhatsApp
            </button>
          </div>
        )}

        {task.notes && <div className="qsx-hbox">{task.notes}</div>}

        {/* Roteiro da atividade (script_text da cadência) — Sprint 4, item 6: o
            gestor escrevia e o SDR nunca via. Colapsável; no WhatsApp ele também
            vira a mensagem pré-preenchida do modal. */}
        {(() => {
          const script = getScriptForTask(task);
          if (!script) return null;
          const filled = fillTemplate(script, { name: lead?.full_name });
          return (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(37,99,235,.28)", background: "rgba(37,99,235,.04)" }}>
              <button
                onClick={() => setScriptOpen((o) => !o)}
                className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left"
                style={{ background: "transparent", border: 0, cursor: "pointer", fontFamily: "inherit" }}
                aria-expanded={scriptOpen}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--blue)" }}>
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                <span className="text-[12.5px] font-bold" style={{ color: "var(--blue)" }}>Roteiro da atividade</span>
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ color: "var(--ink3)", marginLeft: "auto", transform: scriptOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {scriptOpen && (
                <div className="px-3.5 pb-3">
                  <p className="text-[13px] leading-relaxed m-0" style={{ color: "var(--ink2)", whiteSpace: "pre-wrap" }}>{filled}</p>
                  <button
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(filled); showToast("Roteiro copiado"); }
                      catch { notifyError("Não foi possível copiar o roteiro."); }
                    }}
                    className="mt-2 text-[12px] font-bold hover:underline"
                    style={{ color: "var(--blue)", background: "none", border: 0, cursor: "pointer", padding: 0, fontFamily: "inherit" }}
                  >
                    Copiar roteiro
                  </button>
                </div>
              )}
            </div>
          );
        })()}

          {/* Ações: botão do canal + concluir atividade + pular */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {renderChannelAction(task, lead)}
            <button onClick={() => handleConcludeActivity(task)} className="qsx-btn qsx-btn-green" title="Marcar como concluída — atalho: C">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Concluir atividade <span className="qsx-kbd" style={{ background: "rgba(255,255,255,.25)", color: "#fff", borderColor: "transparent" }}>C</span>
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

          {/* Classificação da ligação (abre ao Concluir uma atividade de ligação) */}
          {classifyFor?.taskId === task.id && (
            <div className="mt-1 rounded-2xl overflow-hidden" style={{ border: "1px solid var(--line)", background: "#fff" }}>
              <div className="px-4 pt-3.5 pb-3" style={{ borderBottom: "1px solid var(--line2)" }}>
                <div className="flex items-center gap-2">
                  <span className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0" style={{ background: "rgba(18,161,138,.12)", color: "#0E7C6A" }}>
                    <ChannelIcon type="ligacao" size={15} />
                  </span>
                  <h3 className="text-[15px] font-extrabold leading-tight" style={{ color: "var(--ink)" }}>
                    Classifique a sua ligação com {classifyFor.leadName}
                  </h3>
                </div>
                <p className="text-[12.5px] mt-1.5 ml-9" style={{ color: "var(--ink3)" }}>
                  {classifyFor.phone ? `Ligação para ${classifyFor.phone}, ` : "Ligação "}realizada em {classifyFor.atLabel}
                </p>
              </div>

              <div className="p-3 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }} role="radiogroup" aria-label="Classificação da ligação">
                {CALL_CLASSIFICATIONS.map((opt) => {
                  const on = classifySel === opt.key;
                  return (
                    <button
                      key={opt.key}
                      role="radio"
                      aria-checked={on}
                      onClick={() => setClassifySel(opt.key)}
                      className="text-left rounded-xl p-3 transition-all"
                      style={{
                        border: on ? "1.5px solid var(--blue)" : "1.5px solid var(--line)",
                        background: on ? "rgba(1,71,255,.05)" : "#fff",
                        boxShadow: on ? "0 0 0 3px rgba(1,71,255,.10)" : "none",
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="mt-0.5 flex items-center justify-center rounded-full shrink-0"
                          style={{ width: 16, height: 16, border: on ? "5px solid var(--blue)" : "2px solid var(--line-strong, #C7CDD6)" }}
                        />
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-bold leading-tight" style={{ color: on ? "var(--blue)" : "var(--ink)" }}>{opt.label}</div>
                          <div className="text-[11.5px] mt-1 leading-snug" style={{ color: "var(--ink3)" }}>{opt.desc}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 px-3 pb-3">
                <button
                  onClick={handleClassifyCall}
                  disabled={!classifySel || finalizing}
                  className="qsx-btn qsx-btn-green"
                  style={{ opacity: !classifySel || finalizing ? 0.5 : 1 }}
                >
                  {finalizing ? "Registrando…" : "Concluir ligação"}
                </button>
                <button
                  onClick={() => { setClassifyFor(null); setClassifySel(null); }}
                  className="qsx-btn qsx-btn-ghost"
                >
                  Cancelar
                </button>
                {classifySel === "com_avanco" && (
                  <span className="text-[11.5px] ml-1" style={{ color: "var(--ink3)" }}>→ abre o agendamento da reunião</span>
                )}
              </div>
            </div>
          )}

          {/* Motivo do pulo (vai pro skip_reason). A ÚLTIMA atividade do lead é
              INTOCÁVEL (decisão do Bruno): pular deixaria o lead sem próximo
              passo — fora da fila de todo mundo. O SDR conclui com desfecho. */}
          {skipMenuOpen && (() => {
            const isLastOfLead = !tasks.some(
              (t) => t.lead_id === task.lead_id && t.id !== task.id && (t.status === "pendente" || t.status === "atrasada"),
            );
            if (isLastOfLead) {
              return (
                <div className="flex items-center gap-2 p-2.5 rounded-xl flex-wrap" style={{ background: "rgba(220,38,38,.08)", border: "1px solid rgba(220,38,38,.25)" }}>
                  <span className="text-[13px] font-semibold" style={{ color: "#B91C1C" }}>
                    🚫 Esta é a ÚLTIMA atividade deste lead — não dá pra pular. Conclua com um desfecho
                    (Ganho, Pediu retorno, Perdido, Não atendeu…) ou reagende:
                  </span>
                  {/* Reagendar NÃO mata a tarefa — seguro mesmo sendo a última (item 5). */}
                  {["Aguardando retorno", "Horário inadequado"].map((reason) => (
                    <button
                      key={reason}
                      onClick={async () => { setSkipMenuOpen(false); await postponeTask(task, "dia_util", reason); }}
                      className="qsx-out"
                      title="Reagenda a atividade pro próximo dia útil (não a encerra)"
                    >
                      {reason}
                    </button>
                  ))}
                  <button onClick={() => setSkipMenuOpen(false)} className="text-[13px] font-semibold hover:underline" style={{ color: "var(--ink3)", marginLeft: "auto" }}>
                    Entendi
                  </button>
                </div>
              );
            }
            return (
              <div className="flex items-center gap-2 p-2.5 rounded-xl flex-wrap" style={{ background: "var(--line2)" }}>
                <span className="text-[13px] font-semibold" style={{ color: "var(--ink2)" }}>Por que está pulando?</span>
                {["Aguardando retorno", "Horário inadequado", "Priorizar outro", "Outro"].map((reason) => (
                  <button
                    key={reason}
                    onClick={async () => {
                      // "Aguardando retorno" e "Horário inadequado" REAGENDAM em vez
                      // de matar (Sprint 4, item 5): a tarefa segue viva no próximo
                      // dia útil da cadência — antes esses motivos encerravam a
                      // atividade sem criar próximo passo nenhum.
                      if (reason === "Aguardando retorno" || reason === "Horário inadequado") {
                        setSkipMenuOpen(false);
                        await postponeTask(task, "dia_util", reason);
                        return;
                      }
                      // Guarda extra no banco: se ESTA virou a última atividade aberta
                      // no meio do caminho (corrida), o pulo é barrado do mesmo jeito.
                      const { data: others } = await supabase
                        .from("qs_tasks")
                        .select("id")
                        .eq("lead_id", task.lead_id)
                        .in("status", ["pendente", "atrasada"])
                        .neq("id", task.id)
                        .limit(1);
                      if (!others || others.length === 0) {
                        notifyError("Esta virou a última atividade do lead — pular não é permitido. Conclua com um desfecho.");
                        setSkipMenuOpen(false);
                        return;
                      }
                      // Só some da fila se o pulo realmente gravou (senão o card
                      // sumia e voltava no refresh de 60s, parecendo bug).
                      const skipped = await skipTask(task.id, reason);
                      if (!skipped) return;
                      setTasks((prev) => prev.filter((t) => t.id !== task.id));
                      setActiveTaskId(null);
                      setSkipMenuOpen(false);
                    }}
                    className="qsx-out"
                    title={reason === "Aguardando retorno" || reason === "Horário inadequado"
                      ? "Reagenda a atividade pro próximo dia útil (não a encerra)"
                      : undefined}
                  >
                    {reason}
                  </button>
                ))}
                <button onClick={() => setSkipMenuOpen(false)} className="text-[13px] font-semibold hover:underline" style={{ color: "var(--ink3)", marginLeft: "auto" }}>
                  Cancelar
                </button>
              </div>
            );
          })()}

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

          {/* Editar/reagendar a atividade (Sprint 4, item 1) — data, horário, canal e notas */}
          {editFor === task.id && (
            <div className="flex items-end gap-2 p-2.5 rounded-xl flex-wrap" style={{ background: "var(--line2)" }}>
              <div>
                <label className="block text-[11px] font-bold mb-1" style={{ color: "var(--ink3)" }}>Nova data</label>
                <input
                  type="date"
                  value={editDraft.date}
                  onChange={(e) => setEditDraft((p) => ({ ...p, date: e.target.value }))}
                  className="qsx-fchip"
                  style={{ height: 38, borderRadius: 10 }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-1" style={{ color: "var(--ink3)" }}>Horário</label>
                <input
                  type="time"
                  value={editDraft.time}
                  onChange={(e) => setEditDraft((p) => ({ ...p, time: e.target.value }))}
                  className="qsx-fchip"
                  style={{ height: 38, borderRadius: 10 }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-1" style={{ color: "var(--ink3)" }}>Canal</label>
                <select
                  value={editDraft.channel}
                  onChange={(e) => setEditDraft((p) => ({ ...p, channel: e.target.value as ChannelType }))}
                  className="qsx-fchip"
                  style={{ height: 38, borderRadius: 10 }}
                >
                  {(["ligacao", "ligacao_whatsapp", "whatsapp", "email", "linkedin", "pesquisa"] as ChannelType[]).map((ch) => (
                    <option key={ch} value={ch}>{CHANNEL_LABELS[ch]}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-[11px] font-bold mb-1" style={{ color: "var(--ink3)" }}>Notas da atividade</label>
                <input
                  type="text"
                  value={editDraft.notes}
                  onChange={(e) => setEditDraft((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Ex.: ligar depois das 14h"
                  className="w-full px-3 text-[13px] rounded-[10px]"
                  style={{ height: 38, border: "1px solid var(--line)", background: "#fff", outline: "none", fontFamily: "inherit", color: "var(--ink)" }}
                />
              </div>
              <button
                onClick={() => handleSaveEdit(task)}
                disabled={!editDraft.date || savingEdit}
                className="qsx-btn qsx-btn-blue"
                style={{ height: 38, opacity: !editDraft.date || savingEdit ? 0.5 : 1 }}
              >
                {savingEdit ? "Salvando…" : "Salvar"}
              </button>
              <button onClick={() => setEditFor(null)} className="qsx-btn qsx-btn-ghost" style={{ height: 38 }}>Cancelar</button>
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
              {/* Número REAL da tentativa, sem clampar em 5 — o clamp escondia a 6ª, 7ª… */}
              Como foi o contato? · Tentativa {getAttemptCount(task)}/{MAX_CONTACT_ATTEMPTS}
              {getAttemptCount(task) >= MAX_CONTACT_ATTEMPTS && (
                <span className="ml-2 text-[11px] font-bold" style={{ color: getAttemptCount(task) > MAX_CONTACT_ATTEMPTS ? "#DC2626" : "#B45309" }} title="Limite de tentativas sem contato atingido — considere dar Perdido, transferir ou mudar o canal">
                  {getAttemptCount(task) > MAX_CONTACT_ATTEMPTS ? "⚠ acima do limite de tentativas" : "⚠ última tentativa"}
                </span>
              )}
            </div>
            {/* Caminho principal: positivo em destaque, retorno/perdido médios */}
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => openMeetingGanho(task)} className="qsx-out-primary">
                Ganho / Agendou <span className="qsx-kbd">1</span>
              </button>
              <button onClick={() => openExtraFromRetorno(task)} className="qsx-out" data-tone="neutral">
                Pediu retorno <span className="qsx-kbd">2</span>
              </button>
              <button
                onClick={() => setPendingResult({ taskId: task.id, result: "sem_interesse" })}
                className="qsx-out"
                data-tone="lose"
                data-on={pending === "sem_interesse" ? "1" : undefined}
              >
                Perdido <span className="qsx-kbd">3</span>
              </button>
            </div>
            {/* Desfechos "sem contato" — recuados, o SDR só olha quando precisa */}
            <div className="flex items-center gap-2 flex-wrap mt-2.5">
              <span className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>Sem contato:</span>
              {["nao_atendeu", "caixa_postal", "numero_errado", "desligou"].map((key, idx) => (
                <button
                  key={key}
                  onClick={() => setPendingResult({ taskId: task.id, result: key })}
                  className="qsx-out-mini"
                  data-on={pending === key ? "1" : undefined}
                >
                  {outcomes.find((o) => o.key === key)?.label} <span className="qsx-kbd">{idx + 4}</span>
                </button>
              ))}
            </div>
            {pending && (
              <div className="mt-3 flex items-center gap-2 p-2.5 rounded-xl flex-wrap" style={{ background: "#FFF7ED", border: "1px solid #FED7AA" }}>
                <span className="text-[13px]" style={{ color: "var(--ink2)" }}>
                  Confirmar: <b style={{ color: "var(--ink)" }}>{outcomes.find((o) => o.key === pending)?.label}</b>?
                  {autoFinish?.taskId === task.id && <b style={{ color: "#C2410C" }}> · concluindo em {autoFinish.secs}s</b>}
                  {obsText.trim() && <span style={{ color: "var(--ink3)" }}> (a observação vai junto no resumo)</span>}
                </span>
                <button
                  onClick={async () => {
                    if (finalizing) return; // anti duplo-clique
                    setAutoFinish(null);
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
                {autoFinish?.taskId === task.id && (
                  <button onClick={() => setAutoFinish(null)} disabled={finalizing} className="qsx-btn qsx-btn-ghost" style={{ height: 38 }} title="Parar o auto-concluir e decidir com calma">
                    Manter aberto
                  </button>
                )}
                <button onClick={() => { setAutoFinish(null); setPendingResult(null); }} disabled={finalizing} className="qsx-btn qsx-btn-ghost" style={{ height: 38 }}>
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
    <div className="flex flex-col min-h-full" style={{ background: "var(--bg)" }}>
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

        /* Menu (⋯) do card — adiar/editar/excluir (Sprint 4) */
        .qsx-menu-item { display: flex; width: 100%; align-items: center; gap: 8px; padding: 10px 14px; font-size: 13px; font-weight: 600; color: var(--ink2); background: #fff; border: 0; cursor: pointer; text-align: left; font-family: inherit; white-space: nowrap; }
        .qsx-menu-item:hover { background: var(--line2); }
        .qsx-menu-item.danger { color: var(--red); }
        .qsx-menu-item:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }

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
        /* Dica de atalho de teclado dentro dos botões */
        .qsx-kbd { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 4px; margin-left: 4px; border-radius: 4px; border: 1px solid var(--line); background: var(--line2); color: var(--ink3); font-size: 10px; font-weight: 800; vertical-align: 1px; }
        .qsx-out-primary .qsx-kbd { background: rgba(255,255,255,.25); color: #fff; border-color: transparent; }
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
                background: ["#0147FF", "#3B82F6", "#10B981", "#EAB308", "#8B5CF6", "#EC4899"][i % 6],
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
          className="fixed bottom-4 right-4 z-[100] bg-gray-900 text-white px-4 py-3 rounded-lg shadow-xl text-sm font-medium flex items-center gap-3"
          style={{
            animation: toast.visible ? "toastIn 0.3s ease-out" : "toastOut 0.3s ease-out forwards",
          }}
        >
          <span>{toast.message}</span>
          {toast.action && (
            <button
              onClick={() => toast.action?.run()}
              className="shrink-0 font-bold underline underline-offset-2"
              style={{ color: "#7DD3FC", background: "none", border: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      {/* Faixa "Lead quente chegou!" REMOVIDA do cabeçalho (poluía o Painel).
          Leads quentes seguem no sino de notificações, sem faixa fixa no topo. */}

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
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <span className="text-[16px] font-extrabold" style={{ color: "var(--ink)", letterSpacing: "-.1px" }}>Fila de hoje</span>
            {/* Controle FUP / Atrasada + feitas hoje sempre à vista (pedido do
                Bruno). "Novo" foi extinto — todo lead sem 1º contato é FUP 1. */}
            <span className="text-[12px] font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: "#B45309" }}>{fupTasks.length} em FUP</span>
              <span style={{ color: "var(--ink3)" }}> · </span>
              <span style={{ color: "#DC2626" }}>{overdueTasks.length} atrasadas</span>
              <span style={{ color: "var(--ink3)" }}> · </span>
              <span style={{ color: "#0E7C6A" }} title="Atividades que você concluiu hoje">✅ {doneTodayMine} feitas hoje</span>
            </span>
          </div>
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
      <div className="flex-1" style={{ background: "var(--bg)" }}>
        <div className="px-4 md:px-6 pt-3 pb-24">
        <div className="qsx-page">
          {filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              {loadError ? (
                <>
                  <span className="text-3xl mb-2">⚠️</span>
                  <p className="mt-2 text-sm font-bold" style={{ color: "var(--ink)" }}>Não consegui carregar a fila.</p>
                  <p className="text-xs mt-1" style={{ color: "var(--ink3)" }}>Confira sua conexão — suas atividades continuam salvas.</p>
                  <button onClick={() => loadData()} className="mt-4 qsx-btn qsx-btn-orange">
                    Tentar de novo
                  </button>
                </>
              ) : (statusFilter || channelFilter || priorityFilter || periodFilter || ownerFilter || search.trim()) ? (
                <>
                  <span style={{ color: "var(--ink3)" }}><IconFilter /></span>
                  <p className="mt-4 text-sm font-medium" style={{ color: "var(--ink2)" }}>Nenhuma atividade com esses filtros.</p>
                  <button
                    onClick={() => { setStatusFilter(null); setChannelFilter(null); setPriorityFilter(null); setPeriodFilter(null); setOwnerFilter(null); setSearch(""); }}
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
            const heroTask = heroTaskMemo;
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
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !savingMeeting && cancelMeetingModal()} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4" style={{ background: "var(--green)" }}>
              <div className="text-white">
                <p className="text-sm font-bold leading-tight">Agendar reunião — Ganho</p>
                <p className="text-[11px] opacity-90 leading-tight">{meetingFor.leadName}</p>
              </div>
              <button onClick={() => cancelMeetingModal()} className="text-white/90 hover:text-white" aria-label="Fechar">
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
              <button onClick={() => cancelMeetingModal()} disabled={savingMeeting} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
              <button onClick={handleConfirmMeeting} disabled={savingMeeting || !meeting.agendadoPor || !meeting.responsavel || !meeting.dataHora} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--green)" }}>
                {savingMeeting ? "Salvando..." : "Confirmar ganho"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL LIGAÇÃO MANUAL ═════════════════════════════════════════════ */}
      {showDialer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(16,24,40,0.55)", backdropFilter: "blur(2px)" }}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-[340px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Cabeçalho */}
            <div className="flex items-center justify-between px-5 pt-4 pb-1">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: "rgba(18,161,138,.12)", color: "var(--green)" }}>
                  <ChannelIcon type="ligacao" size={15} />
                </span>
                <span className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>Telefone</span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--line2)", color: "var(--ink3)" }}>BravoTech</span>
              </div>
              <button onClick={() => { setShowDialer(false); setDialNumber(""); }} className="text-gray-400 hover:text-gray-600" aria-label="Fechar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>

            {/* Display do número */}
            <input
              type="tel"
              value={dialNumber}
              onChange={(e) => setDialNumber(e.target.value.replace(/[^\d+() -]/g, ""))}
              placeholder="Digite o número"
              className="w-full px-6 pt-3 pb-2 text-[26px] text-center font-extrabold tracking-wide bg-transparent outline-none"
              style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}
              autoFocus
            />
            <p className="text-center text-[11px] -mt-1 mb-2 h-4" style={{ color: "var(--ink3)" }}>
              {dialNumber.trim() ? formatPhoneDisplay(dialNumber) : "a chamada abre no softphone BravoTech do seu PC"}
            </p>

            {/* Teclado */}
            <div className="grid grid-cols-3 gap-2 px-6 pb-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0", "⌫"].map((k) => (
                <button
                  key={k}
                  onClick={() => setDialNumber((n) => (k === "⌫" ? n.slice(0, -1) : n + k))}
                  className="h-[52px] rounded-2xl text-[19px] font-bold transition-colors select-none"
                  style={{ background: "var(--line2)", color: k === "⌫" ? "var(--ink3)" : "var(--ink)" }}
                  onMouseDown={(e) => e.preventDefault()}
                  aria-label={k === "⌫" ? "Apagar" : k}
                >
                  {k}
                </button>
              ))}
            </div>

            {/* Botão de chamada */}
            <div className="flex justify-center pb-5 pt-2">
              <button
                onClick={() => { if (dialNumber.trim()) { callViaSip(dialNumber); setShowDialer(false); setDialNumber(""); } }}
                disabled={!dialNumber.trim()}
                className="flex items-center justify-center w-16 h-16 rounded-full text-white transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
                style={{ background: "var(--green)", boxShadow: "0 12px 26px -10px rgba(18,161,138,.75)" }}
                title="Ligar (BravoTech)"
                aria-label="Ligar"
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </button>
            </div>
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
                {extraTask._searchText && !extraTask.lead_id && (() => {
                  // Lead ganho/perdido fica FORA da busca (Sprint 4, item 4): a tarefa
                  // criada pra ele não passa no filtro da fila — nascia invisível.
                  const q = extraTask._searchText.toLowerCase();
                  const matches = leads.filter(l =>
                    l.status !== "ganho" && l.status !== "perdido" &&
                    (l.full_name?.toLowerCase().includes(q) || l.email?.toLowerCase().includes(q) || l.phone?.includes(q) || l.id.includes(q))
                  );
                  return (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {matches.slice(0, 10).map(l => (
                        <button
                          key={l.id}
                          onClick={() => setExtraTask(p => ({ ...p, lead_id: l.id, _searchText: (l.full_name ?? "") + (l.company_name ? ` · ${l.company_name}` : "") }))}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                        >
                          <span className="font-medium text-gray-900">{l.full_name}</span>
                          {l.company_name && <span className="text-gray-400"> · {l.company_name}</span>}
                          {l.phone && <span className="text-gray-300 text-xs ml-2">{l.phone}</span>}
                        </button>
                      ))}
                      {matches.length === 0 && (
                        <p className="px-3 py-2 text-xs text-gray-400">Nenhum lead ativo encontrado (leads ganhos/perdidos ficam fora)</p>
                      )}
                    </div>
                  );
                })()}
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
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
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
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">E-mail</label>
                <input
                  type="email"
                  value={newLead.email}
                  onChange={(e) => setNewLead(p => ({ ...p, email: e.target.value }))}
                  placeholder="email@empresa.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Produto de interesse</label>
                <select
                  value={newLead.company_name}
                  onChange={(e) => setNewLead(p => ({ ...p, company_name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
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
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
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
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">Selecione a cadência</option>
                  {/* Só cadências DISPONÍVEIS (item 12) — congelada/rascunho não
                      recebe lead novo (fetchAvailableCadences, criada pelo A3). */}
                  {availableCadences.map(c => (
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
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none"
                />
              </div>
            </div>
            {newLeadError && (
              <div className="mt-4 px-3 py-2 rounded-lg text-[13px] font-medium" style={{ background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA" }}>
                {newLeadError}
              </div>
            )}
            <div className="flex items-center gap-3 mt-5">
              <button
                onClick={async () => {
                  if (!newLead.full_name || !newLead.phone) return;
                  setSavingLead(true);
                  setNewLeadError(null);
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
                  if (error || !inserted) {
                    // Antes o erro era 100% silencioso: o botão voltava a "Cadastrar"
                    // e parecia que o clique não tinha funcionado.
                    console.warn("[QS] falha ao cadastrar lead:", error);
                    setNewLeadError("Não foi possível cadastrar o lead. Confira os dados e tente novamente.");
                    setSavingLead(false);
                    return;
                  }
                  // Salvar observação
                  if (newLead.notes?.trim()) {
                    await supabase.from("qs_notes").insert({
                      lead_id: inserted.id,
                      author_id: currentUser?.id ?? null,
                      body: newLead.notes.trim(),
                      tags: [],
                    });
                  }
                  // Tarefas da cadência pela função única (mesma regra do CSV e do Reativar).
                  // Dono = o que o BANCO gravou no lead (o trigger 0008 faz round-robin
                  // quando o form vem sem responsável) — antes usava o valor do form e
                  // tarefa nascia com owner NULL = invisível pra todo SDR (RLS).
                  if (hasCadence) {
                    const createdTasks = await createCadenceTasks(inserted.id, newLead.cadence_id, inserted.owner_id ?? newLead.owner_id ?? null);
                    if (createdTasks && createdTasks.length > 0) {
                      setTasks(prev => [...prev, ...createdTasks]);
                    }
                  }
                  setSavingLead(false);
                  setShowNewLeadModal(false);
                  setNewLead({ full_name: "", phone: "", email: "", company_name: "", owner_id: currentUser?.id ?? "", cadence_id: "", notes: "" });
                  showToast(`Lead cadastrado — ${inserted.full_name ?? ""}`);
                  const { data } = await supabase.from("qs_leads").select("*");
                  if (data) setLeads(data as Lead[]);
                }}
                disabled={savingLead || !newLead.full_name || !newLead.phone}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "#0147FF" }}
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

      {/* ══ MODAL WHATSAPP COM ROTEIRO (Sprint 4, item 6) ════════════════════
          Abre quando a atividade de WhatsApp tem script_text: a mensagem já vem
          preenchida com o roteiro do gestor ({nome}/{primeiro_nome} resolvidos). */}
      {waModal && (
        <WhatsAppModal
          open
          onClose={() => setWaModal(null)}
          lead={{ id: waModal.lead.id, name: waModal.lead.full_name, phone: waModal.lead.phone }}
          ownerId={currentUser?.id ?? null}
          defaultText={waModal.text}
        />
      )}
    </div>
  );
}
