// src/components/sdr/dashboard/CoveragePanel.tsx — Leads sem contato
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { createCadenceTasks, fetchAllRows } from "@/lib/qs/queries";

// ── Types ──────────────────────────────────────────────────────────────────

interface Lead {
  id: string;
  name: string;
  company: string;
  channel: string;
  arrivedAt: Date;
  contacted: boolean;
  ownerId: string | null;
  ownerName: string | null;
}

interface QsUser {
  id: string;
  name: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getWaitMinutes(arrivedAt: Date): number {
  return Math.round((Date.now() - arrivedAt.getTime()) / 60000);
}

function formatWaitTime(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function getStatusColor(minutes: number): string {
  if (minutes <= 5) return "#22C55E";   // green
  if (minutes <= 15) return "#EAB308";  // yellow
  return "#EF4444";                     // red
}

function getTimeTextColor(minutes: number): string {
  if (minutes <= 5) return "#16A34A";
  if (minutes <= 15) return "#CA8A04";
  if (minutes <= 30) return "#EA580C";
  return "#DC2626";
}

function getChannelStyle(channel: string): { bg: string; text: string } {
  switch (channel) {
    case "Instagram": return { bg: "#FDF2F8", text: "#BE185D" };
    case "WhatsApp": return { bg: "#F0FDF4", text: "#15803D" };
    case "Site": return { bg: "#EFF6FF", text: "#1D4ED8" };
    case "Indicação": return { bg: "#FFF7ED", text: "#C2410C" };
    default: return { bg: "#F3F4F6", text: "#374151" };
  }
}

function getSlaColor(value: number, thresholdGreen: number, thresholdYellow: number): string {
  if (value >= thresholdGreen) return "#22C55E";
  if (value >= thresholdYellow) return "#EAB308";
  return "#EF4444";
}

// Próximo dia ÚTIL (seg–sex) às 09:00 local — o "amanhã" fixo cairia no fim de
// semana e a tarefa amanheceria atrasada na segunda (mesma regra do TasksPanel).
function nextBusinessDayAt9(): Date {
  const d = new Date();
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  d.setHours(9, 0, 0, 0);
  return d;
}

// Janela do relatório de SLA: leads CHEGADOS nos últimos N dias.
const SLA_WINDOW_DAYS = 7;

// Tarefas concluídas de uma lista de leads, em LOTES — `.in()` com centenas de
// ids estoura o limite de URL, e o resultado pode passar do cap de 1000 linhas
// do PostgREST (por isso cada lote também é paginado via fetchAllRows).
async function fetchCompletedTasksByLeadIds(leadIds: string[]): Promise<{ lead_id: string }[]> {
  const out: { lead_id: string }[] = [];
  const CHUNK = 150;
  for (let i = 0; i < leadIds.length; i += CHUNK) {
    const chunk = leadIds.slice(i, i + CHUNK);
    const rows = await fetchAllRows<{ lead_id: string }>((f, t) =>
      supabase
        .from("qs_tasks")
        .select("lead_id")
        .in("lead_id", chunk)
        .eq("status", "concluida")
        .order("id")
        .range(f, t)
    );
    out.push(...rows);
  }
  return out;
}

// ── Icons (inline SVG) ─────────────────────────────────────────────────────

function IconClock() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

interface SlaMetric {
  label: string;
  value: number | null; // null = ainda não há lead "julgável" na janela
  unit: string;
  greenThreshold: number;
  yellowThreshold: number;
}

export default function CoveragePanel({ onOpenLead }: { onOpenLead?: (leadId: string) => void }) {
  const { currentUser } = useQsAuth();
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<QsUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contactingId, setContactingId] = useState<string | null>(null);
  const [slaMetrics, setSlaMetrics] = useState<SlaMetric[]>([
    { label: "Contatados em < 5min", value: null, unit: "%", greenThreshold: 80, yellowThreshold: 60 },
    { label: "Contatados em < 15min", value: null, unit: "%", greenThreshold: 85, yellowThreshold: 70 },
    { label: "Contatados em < 30min", value: null, unit: "%", greenThreshold: 90, yellowThreshold: 75 },
  ]);
  const [semContato, setSemContato] = useState({ label: "Sem contato (> 30min)", value: 0, unit: "leads" });

  // Fetch real leads from Supabase — roda no mount e a cada 60s (este painel
  // vigia SLA em MINUTOS; congelado até o F5 ele não serve pra nada).
  const fetchLeads = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      // Fetch users
      const { data: usersData, error: usersErr } = await supabase
        .from("qs_users").select("id, name").eq("is_active", true).order("name");
      if (usersErr) throw usersErr;
      if (usersData) setUsers(usersData as QsUser[]);

      // Isolamento por dono: o SDR só enxerga a cobertura dos PRÓPRIOS leads.
      // Gestor/admin veem o time todo (e podem filtrar por SDR no seletor acima).
      // Backstop de tela — a garantia real é a RLS 0007/0008 no banco.
      const scoped = currentUser && !canSeeAllData(currentUser.role) ? currentUser.id : null;

      // ── Fila "aguardando contato": leads ATIVOS com chegada — paginado
      // (cap 1000 do PostgREST; a fila cheia não pode sumir lead em silêncio).
      const leadsData = await fetchAllRows<any>((f, t) => {
        let q = supabase
          .from("qs_leads")
          .select("id, full_name, company_name, source, arrived_at, owner_id, owner:qs_users(name)")
          .not("arrived_at", "is", null)
          .in("status", ["nao_iniciado", "em_prospeccao"])
          .order("arrived_at", { ascending: true })
          .order("id");
        if (scoped) q = q.eq("owner_id", scoped);
        return q.range(f, t);
      });

      // ── Base do SLA: leads CHEGADOS na janela (últimos 7 dias), QUALQUER
      // status. Antes a base era só nao_iniciado/em_prospeccao — lead que
      // avançava pra ganho/perdido SAÍA do denominador e o "% < 5min" mudava
      // retroativamente (o relatório reescrevia a própria história).
      const windowStart = new Date();
      windowStart.setDate(windowStart.getDate() - (SLA_WINDOW_DAYS - 1));
      windowStart.setHours(0, 0, 0, 0);

      const [arrivedRows, contactRows, queueTasks] = await Promise.all([
        fetchAllRows<{ id: string; arrived_at: string }>((f, t) => {
          let q = supabase
            .from("qs_leads")
            .select("id, arrived_at")
            .not("arrived_at", "is", null)
            .gte("arrived_at", windowStart.toISOString())
            .order("arrived_at")
            .order("id");
          if (scoped) q = q.eq("owner_id", scoped);
          return q.range(f, t);
        }),
        // 1º contato dos leads da janela: o contato acontece DEPOIS da chegada,
        // então completed_at >= início da janela cobre todos os casos.
        fetchAllRows<{ lead_id: string; completed_at: string }>((f, t) =>
          supabase
            .from("qs_tasks")
            .select("lead_id, completed_at")
            .eq("status", "concluida")
            .not("completed_at", "is", null)
            .gte("completed_at", windowStart.toISOString())
            .order("completed_at")
            .order("id")
            .range(f, t)
        ),
        // Quem da FILA já tem tarefa concluída (histórico segue o lead — 0015)
        fetchCompletedTasksByLeadIds(leadsData.map((l: any) => l.id)),
      ]);

      const contactedSet = new Set(queueTasks.map((t) => t.lead_id));

      // Build lead list — only leads WITHOUT completed tasks
      const sourceMap: Record<string, string> = {
        manual: "Manual",
        api: "API",
        integracao: "Integração",
        importacao: "Importação",
        levantada_de_mao: "Levantada de mão",
        indicacao: "Indicação",
        prospeccao_ativa: "Prospecção",
        site: "Site",
        whatsapp: "WhatsApp",
      };

      const pendingLeads: Lead[] = leadsData
        .filter((l: any) => !contactedSet.has(l.id))
        .map((l: any) => ({
          id: l.id,
          name: l.full_name || "Sem nome",
          company: l.company_name || "",
          channel: sourceMap[l.source] || l.source || "Manual",
          arrivedAt: new Date(l.arrived_at),
          contacted: false,
          ownerId: l.owner_id,
          ownerName: (Array.isArray(l.owner) ? l.owner[0] : l.owner)?.name || null,
        }));

      setAllLeads(pendingLeads);

      // ── SLA sobre a coorte de chegada ──
      // contactRows vem ordenado por completed_at asc → o 1º visto é o 1º contato.
      const firstContactMap = new Map<string, Date>();
      contactRows.forEach((t) => {
        if (!firstContactMap.has(t.lead_id)) firstContactMap.set(t.lead_id, new Date(t.completed_at));
      });

      // Denominador JUSTO por limiar: entram os leads cujo desfecho para aquele
      // limiar já é conhecido — contatados (a qualquer tempo) ou ainda sem
      // contato mas JÁ além do limiar. Lead que chegou há 2min não é julgado
      // pelo "< 5min" ainda (entra quando estourar ou for contatado). Uma vez
      // na base, o lead NUNCA sai — a % não muda retroativamente.
      const slaFor = (thresholdMin: number): number | null => {
        let decided = 0;
        let hit = 0;
        arrivedRows.forEach((l) => {
          const arrived = new Date(l.arrived_at);
          const fc = firstContactMap.get(l.id);
          if (fc) {
            decided++;
            if ((fc.getTime() - arrived.getTime()) / 60000 <= thresholdMin) hit++;
          } else if (getWaitMinutes(arrived) > thresholdMin) {
            decided++; // sem contato e além do limiar = falha definitiva
          }
        });
        return decided > 0 ? Math.round((hit / decided) * 100) : null;
      };

      setSlaMetrics([
        { label: "Contatados em < 5min", value: slaFor(5), unit: "%", greenThreshold: 80, yellowThreshold: 60 },
        { label: "Contatados em < 15min", value: slaFor(15), unit: "%", greenThreshold: 85, yellowThreshold: 70 },
        { label: "Contatados em < 30min", value: slaFor(30), unit: "%", greenThreshold: 90, yellowThreshold: 75 },
      ]);
      setSemContato({
        label: "Sem contato (> 30min)",
        value: arrivedRows.filter((l) => !firstContactMap.has(l.id) && getWaitMinutes(new Date(l.arrived_at)) > 30).length,
        unit: "leads",
      });

      setLoadError(null);
    } catch (err) {
      // Erro NÃO vira "fila vazia / SLA 100%": mantém o que está na tela e
      // mostra o banner com retry (refresh de fundo não apaga dados bons).
      console.warn("Erro ao buscar leads para cobertura:", err);
      setLoadError("Não foi possível carregar a cobertura de leads.");
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    fetchLeads(true);
    const id = setInterval(() => {
      if (!document.hidden) fetchLeads(false);
    }, 60_000);
    return () => clearInterval(id);
  }, [fetchLeads]);

  // Lista visível DERIVADA (fonte única = allLeads): o filtro por SDR não se
  // perde quando o refresh de 60s recarrega os dados.
  const visibleLeads = useMemo(
    () => (selectedUser ? allLeads.filter((l) => l.ownerId === selectedUser) : allLeads),
    [allLeads, selectedUser]
  );
  const pendingLeads = visibleLeads.filter((l) => !l.contacted);
  const allContacted = pendingLeads.length === 0;
  const hasUrgent = pendingLeads.some((l) => getWaitMinutes(l.arrivedAt) > 15);

  // Summary stats
  const avgWait = pendingLeads.length > 0
    ? Math.round(pendingLeads.reduce((sum, l) => sum + getWaitMinutes(l.arrivedAt), 0) / pendingLeads.length)
    : 0;
  const sla5min = pendingLeads.length > 0
    ? Math.round((pendingLeads.filter((l) => getWaitMinutes(l.arrivedAt) <= 5).length / pendingLeads.length) * 100)
    : 100;

  // Sort by longest wait first
  const sortedLeads = [...pendingLeads].sort(
    (a, b) => a.arrivedAt.getTime() - b.arrivedAt.getTime()
  );

  async function handleContact(leadId: string) {
    if (contactingId) return;
    const leadToContact = allLeads.find((l) => l.id === leadId);
    // Este botão REGISTRA um contato concluído (conta no placar do SDR) — não
    // pode ser um clique acidental sem ligação de verdade.
    if (!window.confirm(`Registrar contato feito com ${leadToContact?.name ?? "este lead"}? Isso marca uma ligação concluída no histórico.`)) return;
    setContactingId(leadId);

    const lead = leadToContact;
    const nowIso = new Date().toISOString();
    // Owner da atividade: dono do lead; senão o usuário logado (ignora o admin demo)
    const ownerId =
      lead?.ownerId ??
      (currentUser && currentUser.id !== "demo-skip" ? currentUser.id : null);

    // Registra o contato como uma atividade extra concluída (persiste de verdade)
    const { error: taskErr } = await supabase.from("qs_tasks").insert({
      lead_id: leadId,
      owner_id: ownerId,
      channel_type: "ligacao",
      priority: "media",
      scheduled_at: nowIso,
      status: "concluida",
      is_extra: true,
      completed_at: nowIso,
    });

    if (taskErr) {
      console.warn("Erro ao registrar contato:", taskErr);
      notifyError("Não foi possível registrar o contato — tente novamente.");
      setContactingId(null);
      return;
    }

    // Move o lead sem contato para "em prospecção" (deixa a fila de aguardando)
    const { error: leadErr } = await supabase
      .from("qs_leads")
      .update({ status: "em_prospeccao", updated_at: nowIso })
      .eq("id", leadId)
      .eq("status", "nao_iniciado");
    if (leadErr) console.warn("Erro ao atualizar status do lead:", leadErr);

    // ── Anti-zumbi (lead task-driven): sem NENHUMA tarefa aberta o lead fica
    // invisível em todas as filas (Painel, Meu Dia, notificações). Registrar o
    // contato tira o lead da lista de "sem contato" — então ele PRECISA sair
    // daqui com cadência e/ou pelo menos uma próxima atividade pendente.
    let nextActivityMsg: string | null = null;
    let followUpFailed = false;
    try {
      // Estado fresco do lead: o cadence_id pode ter mudado desde o fetch da lista.
      const { data: freshLead } = await supabase
        .from("qs_leads")
        .select("cadence_id")
        .eq("id", leadId)
        .maybeSingle();
      const hasCadence = Boolean((freshLead as { cadence_id: string | null } | null)?.cadence_id);

      // 1. Lead SEM cadência: vincula a primeira disponível e cria o plano de tarefas.
      if (!hasCadence) {
        const { data: cadRows } = await supabase
          .from("qs_cadences")
          .select("id, name")
          .eq("status", "disponivel")
          .order("created_at", { ascending: true })
          .limit(1);
        const cad = (cadRows as { id: string; name: string | null }[] | null)?.[0];
        if (cad) {
          // `.is("cadence_id", null)` + select: só vincula se ninguém vinculou no
          // meio do caminho (evita plano de tarefas duplicado numa corrida).
          const { data: linked, error: linkErr } = await supabase
            .from("qs_leads")
            .update({ cadence_id: cad.id, cadence_started_at: new Date().toISOString() })
            .eq("id", leadId)
            .is("cadence_id", null)
            .select("id");
          if (linkErr) {
            console.warn("Erro ao vincular cadência ao lead:", linkErr);
          } else if (linked && linked.length > 0) {
            const created = await createCadenceTasks(leadId, cad.id, ownerId);
            if (created && created.length > 0) {
              nextActivityMsg = `cadência "${cad.name ?? "sem nome"}" vinculada e atividades do plano criadas`;
            }
          }
        }
        // Sem cadência disponível: segue pro passo 2 mesmo assim (não trava).
      }

      // 2. Rede de segurança: garante ao menos UMA tarefa aberta. Se não houver,
      //    cria um follow-up no próximo dia útil às 09:00.
      if (!nextActivityMsg) {
        const { data: openTasks } = await supabase
          .from("qs_tasks")
          .select("id")
          .eq("lead_id", leadId)
          .in("status", ["pendente", "atrasada"])
          .limit(1);
        if (!openTasks || openTasks.length === 0) {
          const followUpAt = nextBusinessDayAt9();
          const { error: fupErr } = await supabase.from("qs_tasks").insert({
            lead_id: leadId,
            owner_id: ownerId,
            channel_type: "ligacao",
            priority: "alta",
            scheduled_at: followUpAt.toISOString(),
            status: "pendente",
            is_extra: false,
            notes: "Follow-up: retomar contato (registrado pela Cobertura)",
            tags: ["follow-up"],
          });
          if (fupErr) {
            console.warn("Erro ao criar follow-up de cobertura:", fupErr);
            followUpFailed = true;
          } else {
            nextActivityMsg = `follow-up agendado para ${followUpAt.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })} às 09:00`;
          }
        }
      }
    } catch (err) {
      // O contato em si já foi registrado — a garantia da próxima atividade não
      // pode desfazer isso; avisa e deixa o SDR agir manualmente.
      console.warn("Erro ao garantir próxima atividade do lead:", err);
      followUpFailed = true;
    }

    if (followUpFailed) {
      notifyError("Contato registrado, mas não foi possível criar a próxima atividade — agende um follow-up manual para este lead não sumir da fila!");
    } else {
      notifySuccess(nextActivityMsg ? `Contato registrado — ${nextActivityMsg}.` : "Contato registrado.");
    }

    // Atualiza a lista local (remove da fila de aguardando)
    setAllLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, contacted: true } : l)));
    setContactingId(null);

    // "Contatar agora" agora CONTATA de verdade: abre a página do lead
    // (telefone, WhatsApp, histórico) — antes só registrava a tarefa e deixava
    // o SDR na mesma tela, sem caminho pro contato em si.
    onOpenLead?.(leadId);
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 flex items-center justify-center">
        <p className="text-sm text-gray-500">Carregando leads aguardando contato...</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
      {/* Erro de carga: banner com retry (a lista/SLA anteriores continuam na tela) */}
      {loadError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{loadError}</p>
          <button
            onClick={() => fetchLeads(true)}
            className="shrink-0 text-xs font-semibold text-red-700 border border-red-300 rounded-lg px-3 py-1.5 hover:bg-red-100 transition-colors"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {/* ── Panel: Leads Aguardando ─────────────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-y-2 px-4 md:px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h2 className="text-[16px] font-semibold text-gray-900">Leads Aguardando Contato</h2>
            <span
              className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full text-[12px] font-bold text-white"
              style={{ background: pendingLeads.length > 0 ? "#0147FF" : "#22C55E" }}
            >
              {pendingLeads.length}
            </span>
            {hasUrgent && (
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-blue-400"
            >
              <option value="">Todos os SDRs</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary bar */}
        {!allContacted && (
          <div className="px-4 md:px-6 py-3 bg-gray-50 border-b border-gray-100 flex items-center flex-wrap gap-4 text-[13px] text-gray-600">
            <span>
              <strong className="text-gray-900">{pendingLeads.length}</strong> leads aguardando
            </span>
            <span className="text-gray-300">|</span>
            <span>
              Tempo médio: <strong className="text-gray-900">{avgWait}min</strong>
            </span>
            <span className="text-gray-300">|</span>
            <span>
              SLA (5min):{" "}
              <strong style={{ color: getSlaColor(sla5min, 80, 60) }}>{sla5min}%</strong>
            </span>
          </div>
        )}

        {/* Lead list or empty state */}
        {allContacted ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-green-500 mb-3">
              <IconCheck />
            </div>
            <p className="text-[16px] font-semibold text-gray-900 mb-1">
              Todos os leads foram contatados!
            </p>
            <p className="text-[13px] text-gray-400">Nenhum lead aguardando no momento.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {sortedLeads.map((lead) => {
              const waitMin = getWaitMinutes(lead.arrivedAt);
              const statusColor = getStatusColor(waitMin);
              const timeColor = getTimeTextColor(waitMin);
              const channelStyle = getChannelStyle(lead.channel);

              return (
                <div
                  key={lead.id}
                  className="flex items-center justify-between flex-wrap gap-y-3 px-4 md:px-6 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    {/* Status dot */}
                    <span
                      className="flex-shrink-0 w-3 h-3 rounded-full"
                      style={{ background: statusColor }}
                    />

                    {/* Name + company + responsável (nome clicável → abre o lead) */}
                    <div className="min-w-0">
                      {onOpenLead ? (
                        <button
                          onClick={() => onOpenLead(lead.id)}
                          className="block max-w-full text-left text-[14px] font-medium text-gray-900 truncate hover:text-[#0147FF] hover:underline"
                          title="Ver informações do lead"
                        >
                          {lead.name}
                        </button>
                      ) : (
                        <p className="text-[14px] font-medium text-gray-900 truncate">{lead.name}</p>
                      )}
                      <p className="text-[12px] text-gray-400 truncate">
                        {lead.company}
                        {lead.ownerName && <span> · SDR: <span className="font-medium text-gray-500">{lead.ownerName}</span></span>}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* Wait time */}
                    <div className="flex items-center gap-1.5" style={{ color: timeColor }}>
                      <IconClock />
                      <span className="text-[13px] font-medium whitespace-nowrap">
                        Chegou há {formatWaitTime(waitMin)}
                      </span>
                    </div>

                    {/* Channel tag */}
                    <span
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium"
                      style={{ background: channelStyle.bg, color: channelStyle.text }}
                    >
                      {lead.channel}
                    </span>

                    {/* Contact button */}
                    <button
                      onClick={() => handleContact(lead.id)}
                      disabled={contactingId === lead.id}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{ background: "#0147FF" }}
                    >
                      <IconPhone />
                      {contactingId === lead.id ? "Registrando..." : "Contatar agora"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── SLA Report ────────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-4 md:px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <span className="text-gray-500">
              <IconShield />
            </span>
            <h2 className="text-[16px] font-semibold text-gray-900">Relatório de Cobertura SLA</h2>
          </div>
          <p className="text-[12px] text-gray-400 mt-1">
            Base: leads que CHEGARAM nos últimos {SLA_WINDOW_DAYS} dias (qualquer etapa) — lead que avança de coluna continua contando.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 md:p-6">
          {slaMetrics.map((metric) => {
            const color = metric.value === null
              ? "#9CA3AF"
              : getSlaColor(metric.value, metric.greenThreshold, metric.yellowThreshold);
            return (
              <div
                key={metric.label}
                className="bg-gray-50 rounded-xl p-5 flex flex-col gap-2"
              >
                <span className="text-[12px] text-gray-500 font-medium">{metric.label}</span>
                <span className="text-[28px] font-bold" style={{ color }}>
                  {metric.value !== null ? metric.value : "—"}
                  {metric.value !== null && (
                    <span className="text-[16px] font-semibold ml-0.5">{metric.unit}</span>
                  )}
                </span>
              </div>
            );
          })}

          {/* Sem contato card */}
          <div className="bg-gray-50 rounded-xl p-5 flex flex-col gap-2">
            <span className="text-[12px] text-gray-500 font-medium">{semContato.label}</span>
            <span className="text-[28px] font-bold" style={{ color: semContato.value > 0 ? "#EF4444" : "#22C55E" }}>
              {semContato.value}
              <span className="text-[16px] font-semibold ml-1 text-gray-400">{semContato.unit}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
