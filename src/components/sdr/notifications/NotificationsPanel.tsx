// src/components/sdr/notifications/NotificationsPanel.tsx — Sino de notificações/lembretes
import { useState, useEffect, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import { CHANNEL_LABELS, SOURCE_LABELS } from "@/components/sdr/types";
import type { ChannelType, LeadSource } from "@/components/sdr/types";

// ── Props ────────────────────────────────────────────────────────────────────

interface NotificationsPanelProps {
  /** Fecha o painel e leva o SDR à fila de tarefas (activeNav = "painel"). */
  onGoToTasks: () => void;
  /** Fecha o painel e abre o detalhe do lead (activeNav = "lead-detail"). */
  onOpenLead: (leadId: string) => void;
}

// ── Tipos locais (client Supabase não é tipado) ─────────────────────────────

interface NotifTaskLead {
  full_name: string | null;
  company_name: string | null;
  status?: string | null; // pra filtrar tarefas de leads já ganho/perdido
}

interface NotifTask {
  id: string;
  channel_type: ChannelType;
  scheduled_at: string;
  lead: NotifTaskLead | null;
}

interface NotifLead {
  id: string;
  full_name: string | null;
  company_name: string | null;
  source: LeadSource | null;
  arrived_at: string | null;
  created_at: string;
}

interface NotifHandover {
  id: string;
  lead_id: string;
  briefing: string | null;
  created_at: string;
  lead: NotifTaskLead | null;
  from_user: { name: string } | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  const h = Math.floor(diffMin / 60);
  const rem = diffMin % 60;
  if (h < 24) return rem > 0 ? `${h}h ${rem}min` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function leadTitle(lead: NotifTaskLead | null): string {
  return lead?.full_name?.trim() || "Lead sem nome";
}

function sourceLabel(source: LeadSource | null): string {
  if (!source) return "Origem não informada";
  return SOURCE_LABELS[source] ?? source;
}

// ── Ícones (inline, sem dependências) ────────────────────────────────────────

function IconBell() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconSpark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M4.93 4.93l2.83 2.83" />
      <path d="M16.24 16.24l2.83 2.83" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="M4.93 19.07l2.83-2.83" />
      <path d="M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function IconSwap() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3h5v5" />
      <path d="M21 3l-7 7" />
      <path d="M8 21H3v-5" />
      <path d="M3 21l7-7" />
    </svg>
  );
}

function IconEmptyCheck() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

// ── Sub-componentes de apresentação ──────────────────────────────────────────

function SectionHeader({
  icon,
  label,
  count,
  color,
  bg,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  color: string;
  bg: string;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
      <span style={{ color }}>{icon}</span>
      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
      <span
        className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold"
        style={{ background: bg, color }}
      >
        {count}
      </span>
    </div>
  );
}

function NotifRow({
  onClick,
  accent,
  title,
  subtitle,
  meta,
  metaColor,
}: {
  onClick: () => void;
  accent: string;
  title: string;
  subtitle: string;
  meta: string;
  metaColor: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50 transition-colors border-l-2"
      style={{ borderLeftColor: accent }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-gray-900 truncate">{title}</p>
        <p className="text-[11px] text-gray-400 truncate">{subtitle}</p>
      </div>
      <span className="text-[11px] font-semibold whitespace-nowrap shrink-0 mt-0.5" style={{ color: metaColor }}>
        {meta}
      </span>
    </button>
  );
}

// ── Componente ───────────────────────────────────────────────────────────────

export default function NotificationsPanel({ onGoToTasks, onOpenLead }: NotificationsPanelProps) {
  const { currentUser } = useQsAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [overdue, setOverdue] = useState<NotifTask[]>([]);
  const [today, setToday] = useState<NotifTask[]>([]);
  const [hotLeads, setHotLeads] = useState<NotifLead[]>([]);
  const [received, setReceived] = useState<NotifHandover[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const total = overdue.length + today.length + hotLeads.length + received.length;

  // ── Carregamento dos dados ─────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);

    const seeAll = canSeeAllData(currentUser.role);
    const ownerId = currentUser.id;

    const now = new Date();
    // Definição OFICIAL de "atrasada" (unificada entre as telas): tarefa aberta
    // (pendente/atrasada) agendada ANTES DE HOJE 00:00 local — o que é de hoje
    // ainda não está atrasado — ignorando tarefas de leads já ganho/perdido.
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const startIso = startOfDay.toISOString();
    const endIso = endOfDay.toISOString();
    const h48Iso = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

    const taskSelect = "id, channel_type, scheduled_at, lead:qs_leads(full_name, company_name, status)";

    // 1. Follow-ups atrasados: abertos agendados antes de hoje 00:00.
    let overdueQ = supabase
      .from("qs_tasks")
      .select(taskSelect)
      .in("status", ["pendente", "atrasada"])
      .lt("scheduled_at", startIso)
      .order("scheduled_at", { ascending: true })
      .limit(30);
    if (!seeAll) overdueQ = overdueQ.eq("owner_id", ownerId);

    // 2. Tarefas de hoje: abertas de hoje 00:00 até o fim do dia
    //    (antes de 00:00 é "atrasados", então não há duplicidade).
    let todayQ = supabase
      .from("qs_tasks")
      .select(taskSelect)
      .in("status", ["pendente", "atrasada"])
      .gte("scheduled_at", startIso)
      .lte("scheduled_at", endIso)
      .order("scheduled_at", { ascending: true })
      .limit(30);
    if (!seeAll) todayQ = todayQ.eq("owner_id", ownerId);

    // 3. Leads quentes/novos: não iniciados que chegaram nas últimas 48h.
    let leadsQ = supabase
      .from("qs_leads")
      .select("id, full_name, company_name, source, arrived_at, created_at")
      .eq("status", "nao_iniciado")
      .or(`arrived_at.gte.${h48Iso},created_at.gte.${h48Iso}`)
      .order("created_at", { ascending: false })
      .limit(20);
    if (!seeAll) leadsQ = leadsQ.eq("owner_id", ownerId);

    // 4. Leads recebidos por transferência/handover nas últimas 24h (pessoal).
    const h24Iso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const receivedQ = supabase
      .from("qs_handovers")
      .select("id, lead_id, briefing, created_at, lead:qs_leads(full_name, company_name), from_user:qs_users!qs_handovers_from_user_id_fkey(name)")
      .eq("to_user_id", ownerId)
      .gte("created_at", h24Iso)
      .order("created_at", { ascending: false })
      .limit(20);

    const [overdueRes, todayRes, leadsRes, receivedRes] = await Promise.all([overdueQ, todayQ, leadsQ, receivedQ]);

    if (overdueRes.error) console.warn("[QS] notificações — atrasados:", overdueRes.error);
    if (todayRes.error) console.warn("[QS] notificações — hoje:", todayRes.error);
    if (leadsRes.error) console.warn("[QS] notificações — leads:", leadsRes.error);
    if (receivedRes.error) console.warn("[QS] notificações — recebidos:", receivedRes.error);

    // Lead fechado (ganho/perdido) sai dos lembretes de tarefa — não é mais
    // trabalho pendente (mesma regra do "A fazer" do Meu Dia).
    const isOpenLead = (t: NotifTask) => t.lead?.status !== "ganho" && t.lead?.status !== "perdido";
    setOverdue(((overdueRes.data ?? []) as unknown as NotifTask[]).filter(isOpenLead));
    setToday(((todayRes.data ?? []) as unknown as NotifTask[]).filter(isOpenLead));
    setHotLeads((leadsRes.data ?? []) as unknown as NotifLead[]);
    setReceived((receivedRes.data ?? []) as unknown as NotifHandover[]);
    setLoading(false);
  }, [currentUser]);

  // Carrega ao montar + revalida a cada 60s.
  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 60000);
    return () => clearInterval(id);
  }, [loadData]);

  // Recarrega ao abrir o painel.
  useEffect(() => {
    if (open) loadData();
  }, [open, loadData]);

  // Fecha ao clicar fora (mesmo padrão do menu de usuário do SdrLayout).
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Navegação dos itens ────────────────────────────────────────────
  function goToTasks() {
    setOpen(false);
    onGoToTasks();
  }

  function openLead(leadId: string) {
    setOpen(false);
    onOpenLead(leadId);
  }

  const badge = total > 9 ? "9+" : String(total);

  return (
    <div ref={ref} className="relative">
      {/* Sino */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notificações"
        className="relative flex items-center justify-center w-9 h-9 rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
      >
        <IconBell />
        {total > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold text-white ring-2 ring-white"
            style={{ background: "#EF4444" }}
          >
            {badge}
          </span>
        )}
      </button>

      {/* Painel */}
      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-[calc(100vw-1.5rem)] max-w-[380px] bg-white rounded-xl shadow-lg border border-gray-100 z-50 flex flex-col overflow-hidden"
          style={{ maxHeight: "min(560px, 80vh)" }}
        >
          {/* Cabeçalho */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-gray-900">Notificações</span>
              {total > 0 && (
                <span
                  className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold text-white"
                  style={{ background: "#0147FF" }}
                >
                  {total}
                </span>
              )}
            </div>
            {loading && (
              <span className="w-3.5 h-3.5 border-2 border-gray-200 border-t-[#0147FF] rounded-full animate-spin" />
            )}
          </div>

          {/* Corpo */}
          <div className="overflow-y-auto flex-1">
            {total === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <span className="text-green-500 mb-2">
                  <IconEmptyCheck />
                </span>
                <p className="text-[13px] font-semibold text-gray-900 mb-0.5">Tudo em dia!</p>
                <p className="text-[11px] text-gray-400">Nenhum lembrete pendente para você agora.</p>
              </div>
            ) : (
              <>
                {/* 1. Follow-ups atrasados */}
                {overdue.length > 0 && (
                  <div className="pb-2 border-b border-gray-50">
                    <SectionHeader
                      icon={<IconAlert />}
                      label="Follow-ups atrasados"
                      count={overdue.length}
                      color="#DC2626"
                      bg="#FEE2E2"
                    />
                    {overdue.map((t) => (
                      <NotifRow
                        key={t.id}
                        onClick={goToTasks}
                        accent="#DC2626"
                        title={leadTitle(t.lead)}
                        subtitle={`${CHANNEL_LABELS[t.channel_type]}${t.lead?.company_name ? ` · ${t.lead.company_name}` : ""}`}
                        meta={`atrasada há ${timeAgo(t.scheduled_at)}`}
                        metaColor="#DC2626"
                      />
                    ))}
                  </div>
                )}

                {/* 2. Tarefas de hoje */}
                {today.length > 0 && (
                  <div className="pb-2 border-b border-gray-50">
                    <SectionHeader
                      icon={<IconClock />}
                      label="Tarefas de hoje"
                      count={today.length}
                      color="#0147FF"
                      bg="#DBEAFE"
                    />
                    {today.map((t) => (
                      <NotifRow
                        key={t.id}
                        onClick={goToTasks}
                        accent="#0147FF"
                        title={leadTitle(t.lead)}
                        subtitle={`${CHANNEL_LABELS[t.channel_type]}${t.lead?.company_name ? ` · ${t.lead.company_name}` : ""}`}
                        meta={formatTime(t.scheduled_at)}
                        metaColor="#0147FF"
                      />
                    ))}
                  </div>
                )}

                {/* 3. Leads recebidos (transferência/handover) */}
                {received.length > 0 && (
                  <div className="pb-2 border-b border-gray-50">
                    <SectionHeader
                      icon={<IconSwap />}
                      label="Leads recebidos"
                      count={received.length}
                      color="#12A18A"
                      bg="#D1FAE5"
                    />
                    {received.map((h) => (
                      <NotifRow
                        key={h.id}
                        onClick={() => openLead(h.lead_id)}
                        accent="#12A18A"
                        title={leadTitle(h.lead)}
                        subtitle={`${h.from_user?.name ? `de ${h.from_user.name}` : "transferido"}${h.briefing ? ` · ${h.briefing}` : ""}`}
                        meta={`há ${timeAgo(h.created_at)}`}
                        metaColor="#12A18A"
                      />
                    ))}
                  </div>
                )}

                {/* 4. Leads quentes / novos */}
                {hotLeads.length > 0 && (
                  <div className="pb-2">
                    <SectionHeader
                      icon={<IconSpark />}
                      label="Leads quentes / novos"
                      count={hotLeads.length}
                      color="#0147FF"
                      bg="#FFEDD5"
                    />
                    {hotLeads.map((l) => (
                      <NotifRow
                        key={l.id}
                        onClick={() => openLead(l.id)}
                        accent="#0147FF"
                        title={l.full_name?.trim() || "Lead sem nome"}
                        subtitle={`${l.company_name?.trim() || "Sem empresa"} · ${sourceLabel(l.source)}`}
                        meta={`há ${timeAgo(l.arrived_at ?? l.created_at)}`}
                        metaColor="#0147FF"
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Rodapé */}
          <button
            onClick={goToTasks}
            className="shrink-0 border-t border-gray-100 px-4 py-2.5 text-[12px] font-semibold text-[#0147FF] hover:bg-gray-50 transition-colors text-center"
          >
            Abrir painel de atividades
          </button>
        </div>
      )}
    </div>
  );
}
