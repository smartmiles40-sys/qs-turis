import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { fetchDashboardStats, fetchQsUsers, getClosedAtColumn, fetchAllRows, isGoalEffective } from "@/lib/qs/queries";
import type { GoalType } from "../types";
import type { SdrUser } from "../types";
import RankingPanel from "./RankingPanel";
import DailyFlowPanel from "./DailyFlowPanel";

// Desfechos que contam como CONEXÃO (falou com a pessoa certa): o legado
// "atendeu"/"ganho" + as classificações novas de ligação em que houve conversa
// com o decisor (com/sem avanço). Sem isso, Connect Rate, funil, heatmap e
// canal SUBESTIMAM — toda ligação classificada pelo bloco novo era ignorada.
const CONNECTED_RESULTS = ["atendeu", "ganho", "com_avanco", "sem_avanco"];
const isConnected = (r?: string | null): boolean => !!r && CONNECTED_RESULTS.includes(r);

// ── Types ───────────────────────────────────────────────────────────────────

interface KpiCard {
  label: string;
  value: string;
  // null = período não comparável com a meta MENSAL (só mostramos a % quando o
  // período selecionado é "Mês atual" — ver comentário na montagem dos cards).
  metaPercent: number | null;
  metaLabel: string;
  predicted: string;
  type: GoalType;
}

// ── Banner de erro por seção (padrão da MeetingsPage, com retry) ────────────
// Erro de query NUNCA pode virar zero/lista vazia parecendo dado real — cada
// seção que falhar mostra este banner no lugar do conteúdo.
function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-sm text-red-700">{message}</p>
      <button
        onClick={onRetry}
        className="shrink-0 text-xs font-semibold text-red-700 border border-red-300 rounded-lg px-3 py-1.5 hover:bg-red-100 transition-colors"
      >
        Tentar de novo
      </button>
    </div>
  );
}

interface LossReasonData {
  label: string;
  count: number;
}

interface CadenceEfficiency {
  cadence: string;
  total: number;
  ganhos: number;
  taxa: number;
}

interface SdrMeetings {
  name: string;
  count: number;
}

interface ChannelPerformanceRow {
  channel: string;
  total: number;
  atendeu: number;
  taxa: number;
}

interface HeatmapCell {
  day: number; // 0=Seg...4=Sex
  hour: number; // 6..20
  count: number;
}

// ── SVG Area Chart ──────────────────────────────────────────────────────────

const CHART_W = 720;
const CHART_H = 220;
const CHART_PAD_L = 40;
const CHART_PAD_R = 16;
const CHART_PAD_T = 16;
const CHART_PAD_B = 28;

function buildPath(data: number[], maxVal: number, totalDays: number): string {
  const usableW = CHART_W - CHART_PAD_L - CHART_PAD_R;
  const usableH = CHART_H - CHART_PAD_T - CHART_PAD_B;

  return data
    .map((v, i) => {
      const x = CHART_PAD_L + (i / (totalDays - 1)) * usableW;
      const y = CHART_PAD_T + usableH - (v / maxVal) * usableH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function buildAreaPath(
  data: number[],
  maxVal: number,
  totalDays: number
): string {
  const usableW = CHART_W - CHART_PAD_L - CHART_PAD_R;
  const usableH = CHART_H - CHART_PAD_T - CHART_PAD_B;
  const baseline = CHART_PAD_T + usableH;

  const linePath = data
    .map((v, i) => {
      const x = CHART_PAD_L + (i / (totalDays - 1)) * usableW;
      const y = CHART_PAD_T + usableH - (v / maxVal) * usableH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const lastX =
    CHART_PAD_L + ((data.length - 1) / (totalDays - 1)) * usableW;
  const firstX = CHART_PAD_L;

  return `${linePath} L${lastX.toFixed(1)},${baseline} L${firstX.toFixed(1)},${baseline} Z`;
}

function AreaChart({ realData, predictedData }: { realData: number[]; predictedData: number[] }) {
  const maxVal = Math.max(...predictedData, ...realData) * 1.1 || 100;
  const totalDays = 30;

  const yTicks = [0, 25, 50, 75, 100];
  const xTicks = [1, 5, 10, 15, 20, 25, 30];

  const usableW = CHART_W - CHART_PAD_L - CHART_PAD_R;
  const usableH = CHART_H - CHART_PAD_T - CHART_PAD_B;

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Grid lines */}
      {yTicks.map((tick) => {
        const y = CHART_PAD_T + usableH - (tick / maxVal) * usableH;
        return (
          <g key={tick}>
            <line x1={CHART_PAD_L} y1={y} x2={CHART_W - CHART_PAD_R} y2={y} stroke="#E5E7EB" strokeWidth="0.5" />
            <text x={CHART_PAD_L - 6} y={y + 3} textAnchor="end" fill="#9CA3AF" fontSize="9">{tick}</text>
          </g>
        );
      })}

      {/* X-axis labels */}
      {xTicks.map((day) => {
        const x = CHART_PAD_L + ((day - 1) / (totalDays - 1)) * usableW;
        return (
          <text key={day} x={x} y={CHART_H - 4} textAnchor="middle" fill="#9CA3AF" fontSize="9">{day}</text>
        );
      })}

      {/* Predicted line (dashed) */}
      {predictedData.length > 1 && (
        <path d={buildPath(predictedData, maxVal, totalDays)} fill="none" stroke="#9CA3AF" strokeWidth="1.5" strokeDasharray="5 3" />
      )}

      {/* Real area fill */}
      {realData.length > 1 && (
        <path d={buildAreaPath(realData, maxVal, totalDays)} fill="url(#orangeGradient)" opacity="0.15" />
      )}

      {/* Real line (solid) */}
      {realData.length > 1 && (
        <path d={buildPath(realData, maxVal, totalDays)} fill="none" stroke="#0147FF" strokeWidth="2" />
      )}

      {/* Current day dot */}
      {realData.length > 0 && (() => {
        const lastIdx = realData.length - 1;
        const x = CHART_PAD_L + (lastIdx / (totalDays - 1)) * usableW;
        const y = CHART_PAD_T + usableH - (realData[lastIdx] / maxVal) * usableH;
        return <circle cx={x} cy={y} r="4" fill="#0147FF" />;
      })()}

      <defs>
        <linearGradient id="orangeGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0147FF" />
          <stop offset="100%" stopColor="#0147FF" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── Horizontal Bar Chart ────────────────────────────────────────────────────

function LossReasonsChart({
  selectedUser,
  selectedPeriod,
  customStart,
  customEnd,
  refreshTick,
}: {
  selectedUser: string;
  selectedPeriod: string;
  customStart: string;
  customEnd: string;
  refreshTick: number; // auto-refresh de 60s do dashboard (recarga silenciosa)
}) {
  const [lossReasons, setLossReasons] = useState<LossReasonData[]>([]);
  const [loadingReasons, setLoadingReasons] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  // Chave dos filtros: se ela NÃO mudou, o reload veio do tick de 60s e não
  // deve piscar "Carregando..." na TV do time (recarga silenciosa).
  const filtersKey = `${selectedUser}|${selectedPeriod}|${customStart}|${customEnd}`;
  const lastKeyRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    async function fetchLossReasons() {
      const silent = lastKeyRef.current === filtersKey;
      lastKeyRef.current = filtersKey;
      if (!silent) setLoadingReasons(true);
      try {
        // Respeita o período selecionado (data de FECHAMENTO) e o SDR do header —
        // o título promete "{userName} · {período}" e o gráfico cumpre.
        const { from, to } = getDateRange(selectedPeriod, customStart, customEnd);
        // Data de FECHAMENTO real (closed_at, migration 0012; fallback updated_at).
        const closedCol = await getClosedAtColumn();

        // Paginado (cap de 1000 linhas do PostgREST) — sem isso a contagem
        // congela no lead perdido nº 1000 sem nenhum aviso.
        const data = await fetchAllRows<{ loss_reason: { label: string } | { label: string }[] | null }>(
          (f, t) => {
            let q = supabase
              .from("qs_leads")
              .select("loss_reason:qs_loss_reasons(label)")
              .eq("status", "perdido")
              .not("loss_reason_id", "is", null)
              .order("id");
            if (selectedUser !== "all") q = q.eq("owner_id", selectedUser);
            if (from) q = q.gte(closedCol, from);
            if (to) q = q.lte(closedCol, to);
            return q.range(f, t);
          }
        );
        if (cancelled) return;

        // Aggregate counts by label (embed pode vir objeto ou array — normaliza)
        const counts: Record<string, number> = {};
        data.forEach((row) => {
          const lr = Array.isArray(row.loss_reason) ? row.loss_reason[0] : row.loss_reason;
          const label = lr?.label;
          if (label) counts[label] = (counts[label] || 0) + 1;
        });

        const sorted = Object.entries(counts)
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count);

        setLossReasons(sorted);
        setErrorMsg(null);
      } catch (error) {
        console.warn("Erro ao buscar motivos de perda:", error);
        if (!cancelled) setErrorMsg("Não foi possível carregar os motivos de perda.");
      } finally {
        if (!cancelled) setLoadingReasons(false);
      }
    }
    fetchLossReasons();
    return () => {
      cancelled = true;
    };
  }, [filtersKey, selectedUser, selectedPeriod, customStart, customEnd, refreshTick, retryTick]);

  if (errorMsg) {
    return (
      <SectionError
        message={errorMsg}
        onRetry={() => {
          lastKeyRef.current = ""; // força reload NÃO silencioso
          setRetryTick((t) => t + 1);
        }}
      />
    );
  }

  if (loadingReasons) {
    return <p className="text-sm text-gray-500 text-center py-4">Carregando...</p>;
  }

  if (lossReasons.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">Nenhum dado de perda disponível.</p>;
  }

  const maxCount = Math.max(...lossReasons.map((r) => r.count));

  return (
    <div className="space-y-3">
      {lossReasons.map((reason) => (
        <div key={reason.label} className="flex items-center gap-3">
          <span className="text-sm text-gray-600 w-44 text-right shrink-0 truncate">
            {reason.label}
          </span>
          <div className="flex-1 h-7 bg-gray-100 rounded-md overflow-hidden relative">
            <div
              className="h-full rounded-md bg-[#0147FF]"
              style={{ width: `${(reason.count / maxCount) * 100}%`, opacity: 0.75 }}
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-700">
              {reason.count}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── KPI Card ────────────────────────────────────────────────────────────────

function KpiCardComponent({ card }: { card: KpiCard }) {
  const isAbove = (card.metaPercent ?? 0) >= 60;

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex flex-col gap-2">
      <span className="text-xs text-gray-500">{card.label}</span>
      <span className="text-2xl font-bold text-gray-900">{card.value}</span>
      <div className="flex items-center gap-2 mt-1">
        {card.metaPercent !== null ? (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              isAbove ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            {card.metaPercent}% da meta
          </span>
        ) : (
          // A meta é MENSAL — comparar "Hoje"/"90 dias" com meta de mês inteiro
          // mentia (3% vermelho num dia bom, 300% verde em 90 dias). Fora do
          // "Mês atual" a % some e o card avisa onde ela mora.
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-medium bg-gray-100 text-gray-500"
            title={'A porcentagem compara o realizado do MÊS com a meta mensal — selecione o período "Mês atual" para vê-la.'}
          >
            % da meta: ver "Mês atual"
          </span>
        )}
      </div>
      <span className="text-xs text-gray-400">{card.metaLabel}</span>
      <span className="text-xs text-gray-400">{card.predicted}</span>
    </div>
  );
}

// ── Speed-to-Lead KPI Card (Change 20) ──────────────────────────────────────

function SpeedToLeadCard({ avgMinutes, loading }: { avgMinutes: number | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex flex-col gap-2">
        <span className="text-xs text-gray-500">Tempo Médio de Contato</span>
        <span className="text-sm text-gray-400">Carregando...</span>
      </div>
    );
  }

  const value = avgMinutes !== null ? avgMinutes : 0;
  const color = value < 5 ? "#22C55E" : value < 15 ? "#EAB308" : "#EF4444";
  const bgColor = value < 5 ? "bg-green-50" : value < 15 ? "bg-yellow-50" : "bg-red-50";
  const label = value < 5 ? "Excelente" : value < 15 ? "Bom" : "Precisa melhorar";

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex flex-col gap-2">
      <span className="text-xs text-gray-500">Tempo Médio de Contato</span>
      <span className="text-2xl font-bold" style={{ color }}>
        {avgMinutes !== null ? `${value.toFixed(1)} min` : "N/A"}
      </span>
      <div className="flex items-center gap-2 mt-1">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${bgColor}`} style={{ color }}>
          {label}
        </span>
      </div>
      <span className="text-xs text-gray-400">Meta: &lt; 5 minutos</span>
    </div>
  );
}

// ── Channel Performance Table (Change 18) ───────────────────────────────────

function ChannelPerformanceTable({ data, loading }: { data: ChannelPerformanceRow[]; loading: boolean }) {
  const CHANNEL_DISPLAY: Record<string, string> = {
    pesquisa: "Pesquisa",
    email: "E-mail",
    ligacao: "Ligação",
    ligacao_whatsapp: "Ligação WhatsApp",
    whatsapp: "WhatsApp",
    linkedin: "LinkedIn",
    instagram: "Instagram",
    tiktok: "TikTok",
    youtube: "YouTube",
  };

  if (loading) {
    return <p className="text-sm text-gray-500 text-center py-4">Carregando...</p>;
  }

  if (data.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">Nenhum dado de canal disponível.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Canal</th>
            <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Atividades</th>
            <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Atendeu</th>
            <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Taxa</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.channel} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="py-2.5 px-3 text-sm font-medium text-gray-900">
                {CHANNEL_DISPLAY[row.channel] || row.channel}
              </td>
              <td className="py-2.5 px-3 text-center text-sm text-gray-700">{row.total}</td>
              <td className="py-2.5 px-3 text-center text-sm text-gray-700">{row.atendeu}</td>
              <td className="py-2.5 px-3 text-center">
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    background: row.taxa >= 50 ? "#D1FAE5" : row.taxa >= 25 ? "#FEF3C7" : "#FEE2E2",
                    color: row.taxa >= 50 ? "#059669" : row.taxa >= 25 ? "#D97706" : "#DC2626",
                  }}
                >
                  {row.taxa.toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Heatmap (Change 19) ─────────────────────────────────────────────────────

const HEATMAP_DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex"];
const HEATMAP_HOURS = Array.from({ length: 15 }, (_, i) => i + 6); // 6h-20h

function ContactHeatmap({ cells, loading }: { cells: HeatmapCell[]; loading: boolean }) {
  if (loading) {
    return <p className="text-sm text-gray-500 text-center py-4">Carregando...</p>;
  }

  const cellMap = new Map<string, number>();
  cells.forEach((c) => cellMap.set(`${c.day}-${c.hour}`, c.count));
  const maxCount = Math.max(1, ...cells.map((c) => c.count));

  function getIntensity(count: number): string {
    if (count === 0) return "#F3F4F6";
    const ratio = count / maxCount;
    if (ratio < 0.25) return "#FED7AA";
    if (ratio < 0.5) return "#FDBA74";
    if (ratio < 0.75) return "#FB923C";
    return "#EA580C";
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex flex-col gap-1">
        {/* Header row */}
        <div className="flex items-center gap-1">
          <div className="w-10" />
          {HEATMAP_HOURS.map((h) => (
            <div key={h} className="w-10 text-center text-[10px] text-gray-400 font-medium">
              {h}h
            </div>
          ))}
        </div>
        {/* Data rows */}
        {HEATMAP_DAYS.map((dayLabel, dayIdx) => (
          <div key={dayLabel} className="flex items-center gap-1">
            <div className="w-10 text-right text-[11px] text-gray-500 font-medium pr-1">{dayLabel}</div>
            {HEATMAP_HOURS.map((h) => {
              const count = cellMap.get(`${dayIdx}-${h}`) || 0;
              return (
                <div
                  key={h}
                  className="w-10 h-8 rounded-md flex items-center justify-center text-[10px] font-medium transition-colors"
                  style={{ background: getIntensity(count), color: count > 0 ? "#fff" : "#9CA3AF" }}
                  title={`${dayLabel} ${h}h: ${count} atendeu`}
                >
                  {count > 0 ? count : ""}
                </div>
              );
            })}
          </div>
        ))}
        {/* Legend */}
        <div className="flex items-center gap-2 mt-2 ml-10">
          <span className="text-[10px] text-gray-400">Menos</span>
          {["#F3F4F6", "#FED7AA", "#FDBA74", "#FB923C", "#EA580C"].map((color) => (
            <div key={color} className="w-6 h-4 rounded-sm" style={{ background: color }} />
          ))}
          <span className="text-[10px] text-gray-400">Mais</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { id: "today", label: "Hoje" },
  { id: "yesterday", label: "Ontem" },
  { id: "last7", label: "Últimos 7 dias" },
  { id: "last15", label: "Últimos 15 dias" },
  { id: "mtd", label: "Mês atual" },
  { id: "last30", label: "Últimos 30 dias" },
  { id: "last90", label: "Últimos 90 dias" },
  { id: "custom", label: "Personalizado" },
];

// Todas as janelas são calculadas em hora LOCAL (BRT é o fuso do negócio) e
// convertidas pra ISO só na borda da query.
// "Últimos N dias" INCLUI hoje: N dias de calendário = hoje - (N-1). O antigo
// "- 7" cobria 8 dias (idem 15/30/90) e o rótulo mentia por um dia inteiro.
function lastNDays(today: Date, endOfDay: Date, n: number): { from: string; to: string } {
  const d = new Date(today);
  d.setDate(d.getDate() - (n - 1));
  return { from: d.toISOString(), to: endOfDay.toISOString() };
}

function getDateRange(periodId: string, customStart: string, customEnd: string): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  switch (periodId) {
    case "today":
      return { from: today.toISOString(), to: endOfDay.toISOString() };
    case "yesterday": {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      const ye = new Date(y);
      ye.setHours(23, 59, 59, 999);
      return { from: y.toISOString(), to: ye.toISOString() };
    }
    case "last7":
      return lastNDays(today, endOfDay, 7);
    case "last15":
      return lastNDays(today, endOfDay, 15);
    case "mtd": {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: d.toISOString(), to: endOfDay.toISOString() };
    }
    case "last30":
      return lastNDays(today, endOfDay, 30);
    case "last90":
      return lastNDays(today, endOfDay, 90);
    case "custom":
      // "T00:00:00" força o parse em hora LOCAL — `new Date("2026-07-01")` é
      // interpretado como UTC e em BRT virava 21h do dia ANTERIOR, puxando pro
      // range leads da noite do dia que a pessoa nem selecionou.
      return {
        from: customStart ? new Date(customStart + "T00:00:00").toISOString() : today.toISOString(),
        to: customEnd ? new Date(customEnd + "T23:59:59.999").toISOString() : endOfDay.toISOString(),
      };
    default:
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: endOfDay.toISOString() };
  }
}

export default function SdrDashboard() {
  const [selectedUser, setSelectedUser] = useState("all");
  const [selectedPeriod, setSelectedPeriod] = useState("mtd");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  // Real data states
  const [users, setUsers] = useState<SdrUser[]>([]);
  const [kpiCards, setKpiCards] = useState<KpiCard[]>([]);
  const [realData, setRealData] = useState<number[]>([]);
  const [predictedData, setPredictedData] = useState<number[]>([]);
  const [channelPerformance, setChannelPerformance] = useState<ChannelPerformanceRow[]>([]);
  const [heatmapCells, setHeatmapCells] = useState<HeatmapCell[]>([]);
  const [speedToLead, setSpeedToLead] = useState<number | null>(null);
  const [loadingKpis, setLoadingKpis] = useState(true);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingHeatmap, setLoadingHeatmap] = useState(true);
  const [loadingSpeed, setLoadingSpeed] = useState(true);

  // Erro por seção (item FASE 2): query que falha NÃO vira zero silencioso —
  // a seção mostra banner com "Tentar de novo" no lugar de números mentirosos.
  const [errKpis, setErrKpis] = useState<string | null>(null);
  const [errChannels, setErrChannels] = useState<string | null>(null);
  const [errHeatmap, setErrHeatmap] = useState<string | null>(null);
  const [errSpeed, setErrSpeed] = useState<string | null>(null);
  const [errOperational, setErrOperational] = useState<string | null>(null);
  const [errFunnel, setErrFunnel] = useState<string | null>(null);
  const [errBusiness, setErrBusiness] = useState<string | null>(null);

  // Auto-refresh (TV do time): tick de 60s repassado ao LossReasonsChart.
  const [refreshTick, setRefreshTick] = useState(0);

  // Operational KPIs states
  const [cicloMedio, setCicloMedio] = useState<number | null>(null);
  const [cadenceEfficiency, setCadenceEfficiency] = useState<CadenceEfficiency[]>([]);
  const [connectRate, setConnectRate] = useState<number | null>(null);
  const [tasksOverdueRate, setTasksOverdueRate] = useState<number | null>(null);
  const [sdrMeetings, setSdrMeetings] = useState<SdrMeetings[]>([]);
  const [loadingOperational, setLoadingOperational] = useState(true);

  // KPIs de negócio (auditoria): reuniões do período, pipeline e conversão por fonte
  const [meetingKpis, setMeetingKpis] = useState<{ agendadas: number; realizadas: number; noShow: number; showRate: number | null; meta: number } | null>(null);
  const [pipelineOpen, setPipelineOpen] = useState<number | null>(null);
  const [revenueWon, setRevenueWon] = useState<number | null>(null);
  const [sourceRows, setSourceRows] = useState<{ source: string; total: number; ganhos: number; taxa: number }[]>([]);
  const [loadingBusiness, setLoadingBusiness] = useState(true);

  const periodLabel = PERIOD_OPTIONS.find(p => p.id === selectedPeriod)?.label || "Mês atual";

  // Fetch users
  useEffect(() => {
    async function loadUsers() {
      const data = await fetchQsUsers();
      setUsers(data);
    }
    loadUsers();
  }, []);

  const allUsers = [{ id: "all", name: "Todos os qualificadores" } as any, ...users];
  const userName = allUsers.find((u: any) => u.id === selectedUser)?.name || "Todos";

  // Fetch KPIs and chart data
  const loadKpis = useCallback(async (silent = false) => {
    if (!silent) setLoadingKpis(true);
    try {
      const { from, to } = getDateRange(selectedPeriod, customStart, customEnd);
      const ownerId = selectedUser === "all" ? undefined : selectedUser;

      // Metas mensais reais (qs_goals). Filtrado por usuário: as metas dele;
      // "todos": meta de EQUIPE (owner_id null) prevalece como placar do time —
      // senão soma as metas individuais dos donos ATIVOS. Fallback para os
      // defaults se não houver meta cadastrada (não quebra o layout).
      const META_DEFAULTS: Record<GoalType, number> = {
        ganhos: 87,
        leads_finalizados: 250,
        atividades: 450,
        conversao: 30,
        reunioes: 40,
      };

      let qGoals = supabase
        .from("qs_goals")
        .select("owner_id, type, target_value, period_start, owner:qs_users(is_active)")
        .eq("period", "mensal")
        .order("period_start", { ascending: false });
      if (ownerId) qGoals = qGoals.eq("owner_id", ownerId);

      // Data de FECHAMENTO (closed_at, migration 0012) — updated_at re-contava
      // ganhos antigos no mês atual a cada edição do lead.
      const closedCol = await getClosedAtColumn();
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentDay = now.getDate();

      // As 3 buscas são independentes → paralelas (antes eram 3 idas em série).
      const [stats, goalsRes, ganhosDays] = await Promise.all([
        fetchDashboardStats(ownerId, from, to),
        qGoals,
        // Paginado (cap 1000 do PostgREST): mês forte não pode "parar de contar".
        fetchAllRows<Record<string, string>>((f, t) => {
          let q = supabase
            .from("qs_leads")
            .select(closedCol)
            .eq("status", "ganho")
            .gte(closedCol, monthStart.toISOString())
            .order("id");
          if (ownerId) q = q.eq("owner_id", ownerId);
          return q.range(f, t);
        }),
      ]);
      if (goalsRes.error) throw goalsRes.error;

      const goalSum: Record<GoalType, number> = { ganhos: 0, leads_finalizados: 0, atividades: 0, conversao: 0, reunioes: 0 };
      const goalCount: Record<GoalType, number> = { ganhos: 0, leads_finalizados: 0, atividades: 0, conversao: 0, reunioes: 0 };
      const teamGoal: Partial<Record<GoalType, number>> = {};
      const seenGoal = new Set<string>();
      ((goalsRes.data ?? []) as any[]).forEach((g) => {
        const type = g.type as GoalType;
        if (!(type in goalSum)) return;
        // Meta ancorada num mês FUTURO ainda não vigora (regra compartilhada
        // com a página Metas — ver isGoalEffective em queries.ts).
        if (!isGoalEffective(g.period_start)) return;
        // Meta de dono DESATIVADO não entra no placar (ela ficava somada "pra
        // sempre" e ainda sumia da página Metas — agora é ignorada aqui e
        // aparece lá com badge pra excluir).
        const ownerRow = Array.isArray(g.owner) ? g.owner[0] : g.owner;
        if (g.owner_id && ownerRow && ownerRow.is_active === false) return;
        // Meta de EQUIPE (owner_id null): guarda a mais recente por tipo.
        if (g.owner_id == null) {
          if (teamGoal[type] === undefined) teamGoal[type] = Number(g.target_value) || 0;
          return;
        }
        // Dedupe por (owner, tipo) mantendo a meta vigente mais recente
        const key = `${g.owner_id}-${type}`;
        if (seenGoal.has(key)) return;
        seenGoal.add(key);
        goalSum[type] += Number(g.target_value) || 0;
        goalCount[type] += 1;
      });

      const metaFor = (type: GoalType): { value: number; team: boolean } => {
        // Visão "todos": a meta de equipe É o placar do time (não soma com as
        // individuais — somar as duas contaria a mesma meta em dobro).
        if (!ownerId && teamGoal[type] !== undefined) return { value: teamGoal[type]!, team: true };
        if (goalCount[type] === 0) return { value: META_DEFAULTS[type], team: false };
        // Conversão é percentual: usa a média das metas em vez de somar
        if (type === "conversao") return { value: Math.round(goalSum[type] / goalCount[type]), team: false };
        return { value: goalSum[type], team: false };
      };

      const metaGanhos = metaFor("ganhos");
      const metaFinalizados = metaFor("leads_finalizados");
      const metaAtividades = metaFor("atividades");
      const metaConversao = metaFor("conversao");

      // "% da meta" compara realizado do PERÍODO com meta MENSAL — só é honesto
      // quando o período é o mês ("Hoje" dava 3% vermelho; "90 dias", 300%).
      // Fora do "Mês atual" a % é omitida (badge explica). Exceção: Taxa de
      // Conversão é um percentual — comparável em qualquer período.
      const comparable = selectedPeriod === "mtd";
      const pct = (value: number, meta: { value: number }): number =>
        meta.value > 0 ? Math.round((value / meta.value) * 100) : 0;
      const metaLabel = (meta: { value: number; team: boolean }, suffix = ""): string =>
        `Meta mensal: ${meta.value}${suffix}${meta.team ? " (equipe)" : ""}`;

      const cards: KpiCard[] = [
        {
          label: "Ganhos",
          value: String(stats.ganhos),
          metaPercent: comparable ? pct(stats.ganhos, metaGanhos) : null,
          metaLabel: metaLabel(metaGanhos),
          predicted: "",
          type: "ganhos",
        },
        {
          label: "Leads Finalizados",
          value: String(stats.leadsFinalizados),
          metaPercent: comparable ? pct(stats.leadsFinalizados, metaFinalizados) : null,
          metaLabel: metaLabel(metaFinalizados),
          predicted: "",
          type: "leads_finalizados",
        },
        {
          label: "Atividades Realizadas",
          value: String(stats.atividadesRealizadas),
          metaPercent: comparable ? pct(stats.atividadesRealizadas, metaAtividades) : null,
          metaLabel: metaLabel(metaAtividades),
          predicted: "",
          type: "atividades",
        },
        {
          label: "Taxa de Conversão",
          value: `${stats.taxaConversao.toFixed(1).replace(".", ",")}%`,
          metaPercent: pct(stats.taxaConversao, metaConversao),
          metaLabel: metaLabel(metaConversao, "%"),
          predicted: "",
          type: "conversao",
        },
      ];

      setKpiCards(cards);

      // Build cumulative array (ganhos accumulated by day, mês corrente)
      const dayCounts = new Array(currentDay).fill(0);
      ganhosDays.forEach((row: any) => {
        const d = new Date(row[closedCol]).getDate();
        if (d >= 1 && d <= currentDay) {
          dayCounts[d - 1]++;
        }
      });

      const cumulative: number[] = [];
      let acc = 0;
      for (let i = 0; i < dayCounts.length; i++) {
        acc += dayCounts[i];
        cumulative.push(acc);
      }

      setRealData(cumulative.length > 0 ? cumulative : [0]);

      // Simple linear prediction
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const predicted: number[] = [];
      for (let i = 0; i < daysInMonth; i++) {
        predicted.push(Math.round((metaGanhos.value / daysInMonth) * (i + 1)));
      }
      setPredictedData(predicted);
      setErrKpis(null);
    } catch (err) {
      console.warn("Erro ao carregar KPIs do dashboard:", err);
      setErrKpis("Não foi possível carregar os indicadores e o gráfico de ganhos.");
    } finally {
      setLoadingKpis(false);
    }
  }, [selectedUser, selectedPeriod, customStart, customEnd]);

  useEffect(() => {
    loadKpis();
  }, [loadKpis]);

  // Fetch Channel Performance (Change 18)
  const loadChannelPerformance = useCallback(async (silent = false) => {
    if (!silent) setLoadingChannels(true);
    try {
      const { from, to } = getDateRange(selectedPeriod, customStart, customEnd);
      const ownerId = selectedUser === "all" ? undefined : selectedUser;

      // Paginado (cap 1000 do PostgREST) — mês com >1000 atividades subestimava
      // toda a tabela sem nenhum aviso.
      const data = await fetchAllRows<{ channel_type: string | null; contact_result: string | null }>((f, t) => {
        let q = supabase
          .from("qs_tasks")
          .select("channel_type, contact_result")
          .eq("status", "concluida")
          .order("id");
        if (ownerId) q = q.eq("owner_id", ownerId);
        if (from) q = q.gte("completed_at", from);
        if (to) q = q.lte("completed_at", to);
        return q.range(f, t);
      });

      const channelMap = new Map<string, { total: number; atendeu: number }>();
      data.forEach((row: any) => {
        const ch = row.channel_type;
        if (!ch) return;
        const entry = channelMap.get(ch) || { total: 0, atendeu: 0 };
        entry.total++;
        if (isConnected(row.contact_result)) entry.atendeu++;
        channelMap.set(ch, entry);
      });

      const rows: ChannelPerformanceRow[] = Array.from(channelMap.entries())
        .map(([channel, { total, atendeu }]) => ({
          channel,
          total,
          atendeu,
          taxa: total > 0 ? (atendeu / total) * 100 : 0,
        }))
        .sort((a, b) => b.total - a.total);

      setChannelPerformance(rows);
      setErrChannels(null);
    } catch (error) {
      console.warn("Erro ao buscar desempenho por canal:", error);
      setErrChannels("Não foi possível carregar o desempenho por canal.");
    } finally {
      setLoadingChannels(false);
    }
  }, [selectedUser, selectedPeriod, customStart, customEnd]);

  useEffect(() => {
    loadChannelPerformance();
  }, [loadChannelPerformance]);

  // Fetch Heatmap Data (Change 19)
  const loadHeatmap = useCallback(async (silent = false) => {
    if (!silent) setLoadingHeatmap(true);
    try {
      // respeita o período selecionado — antes era all-time e não respondia "esse mês"
      const { from, to } = getDateRange(selectedPeriod, customStart, customEnd);
      const ownerId = selectedUser === "all" ? undefined : selectedUser;

      // Paginado (cap 1000 do PostgREST).
      const data = await fetchAllRows<{ completed_at: string | null }>((f, t) => {
        let q = supabase
          .from("qs_tasks")
          .select("completed_at")
          .eq("status", "concluida")
          .in("contact_result", CONNECTED_RESULTS)
          .not("completed_at", "is", null)
          .order("id");
        if (ownerId) q = q.eq("owner_id", ownerId);
        if (from) q = q.gte("completed_at", from);
        if (to) q = q.lte("completed_at", to);
        return q.range(f, t);
      });

      const cellMap = new Map<string, number>();
      data.forEach((row: any) => {
        if (!row.completed_at) return;
        const d = new Date(row.completed_at);
        const jsDay = d.getDay(); // 0=Sun...6=Sat
        if (jsDay === 0 || jsDay === 6) return; // Skip weekends
        const dayIdx = jsDay - 1; // 0=Mon...4=Fri
        const hour = d.getHours();
        if (hour < 6 || hour > 20) return;
        const key = `${dayIdx}-${hour}`;
        cellMap.set(key, (cellMap.get(key) || 0) + 1);
      });

      const cells: HeatmapCell[] = Array.from(cellMap.entries()).map(([key, count]) => {
        const [day, hour] = key.split("-").map(Number);
        return { day, hour, count };
      });

      setHeatmapCells(cells);
      setErrHeatmap(null);
    } catch (error) {
      console.warn("Erro ao buscar dados do heatmap:", error);
      setErrHeatmap("Não foi possível carregar o heatmap de horários.");
    } finally {
      setLoadingHeatmap(false);
    }
  }, [selectedUser, selectedPeriod, customStart, customEnd]);

  useEffect(() => {
    loadHeatmap();
  }, [loadHeatmap]);

  // Fetch Speed-to-Lead (Change 20)
  const loadSpeedToLead = useCallback(async (silent = false) => {
    if (!silent) setLoadingSpeed(true);
    try {
      // respeita o período selecionado (leads que CHEGARAM no período) —
      // antes era all-time e não respondia "esse mês"
      const { from, to } = getDateRange(selectedPeriod, customStart, customEnd);
      const ownerId = selectedUser === "all" ? undefined : selectedUser;

      // Leads chegados no período — paginado (cap 1000 do PostgREST).
      const leadsData = await fetchAllRows<{ id: string; arrived_at: string }>((f, t) => {
        let q = supabase
          .from("qs_leads")
          .select("id, arrived_at")
          .not("arrived_at", "is", null)
          .order("id");
        if (ownerId) q = q.eq("owner_id", ownerId);
        if (from) q = q.gte("arrived_at", from);
        if (to) q = q.lte("arrived_at", to);
        return q.range(f, t);
      });
      if (leadsData.length === 0) {
        setSpeedToLead(null);
        setErrSpeed(null);
        return;
      }

      // Primeira tarefa concluída por lead. O 1º contato de um lead chegado no
      // período acontece DEPOIS da chegada → o corte inferior em `from` não
      // perde nada e evita varrer a tabela inteira. Ordenação estável
      // (completed_at + id) pra paginação não duplicar/pular linhas.
      const tasksData = await fetchAllRows<{ lead_id: string; completed_at: string }>((f, t) => {
        let q = supabase
          .from("qs_tasks")
          .select("lead_id, completed_at")
          .eq("status", "concluida")
          .not("completed_at", "is", null)
          .order("completed_at", { ascending: true })
          .order("id");
        if (ownerId) q = q.eq("owner_id", ownerId);
        if (from) q = q.gte("completed_at", from);
        return q.range(f, t);
      });

      // Build map of first task completion per lead
      const firstTaskMap = new Map<string, string>();
      tasksData.forEach((t) => {
        if (!firstTaskMap.has(t.lead_id)) {
          firstTaskMap.set(t.lead_id, t.completed_at);
        }
      });

      // Calculate average time
      let totalMinutes = 0;
      let count = 0;
      leadsData.forEach((lead) => {
        const firstTask = firstTaskMap.get(lead.id);
        if (!firstTask || !lead.arrived_at) return;
        const arrivedMs = new Date(lead.arrived_at).getTime();
        const taskMs = new Date(firstTask).getTime();
        const diffMin = (taskMs - arrivedMs) / 60000;
        if (diffMin >= 0 && diffMin < 1440) {
          // Only count reasonable values (< 24h)
          totalMinutes += diffMin;
          count++;
        }
      });

      setSpeedToLead(count > 0 ? totalMinutes / count : null);
      setErrSpeed(null);
    } catch (error) {
      console.warn("Erro ao calcular speed-to-lead:", error);
      setErrSpeed("Não foi possível calcular o tempo médio de contato.");
    } finally {
      setLoadingSpeed(false);
    }
  }, [selectedUser, selectedPeriod, customStart, customEnd]);

  useEffect(() => {
    loadSpeedToLead();
  }, [loadSpeedToLead]);

  // Fetch Operational KPIs
  useEffect(() => {
    async function loadOperationalKpis() {
      setLoadingOperational(true);
      const { from, to } = getDateRange(selectedPeriod, customStart, customEnd);
      const ownerId = selectedUser === "all" ? undefined : selectedUser;

      // Data de FECHAMENTO real (closed_at, migration 0012; fallback updated_at).
      const closedCol = await getClosedAtColumn();

      // 1. Ciclo Médio de Qualificação
      let qCiclo = supabase
        .from("qs_leads")
        .select(`arrived_at, ${closedCol}`)
        .in("status", ["ganho", "perdido"])
        .not("arrived_at", "is", null);
      if (ownerId) qCiclo = qCiclo.eq("owner_id", ownerId);
      if (from) qCiclo = qCiclo.gte(closedCol, from);
      if (to) qCiclo = qCiclo.lte(closedCol, to);

      const { data: cicloData } = await qCiclo;
      if (cicloData && cicloData.length > 0) {
        let totalDays = 0;
        let count = 0;
        (cicloData as any[]).forEach((row) => {
          if (!row.arrived_at || !row[closedCol]) return;
          const diff = (new Date(row[closedCol]).getTime() - new Date(row.arrived_at).getTime()) / 86400000;
          if (diff >= 0) {
            totalDays += diff;
            count++;
          }
        });
        setCicloMedio(count > 0 ? totalDays / count : null);
      } else {
        setCicloMedio(null);
      }

      // 2. Eficiência da Cadência
      let qCadence = supabase
        .from("qs_leads")
        .select("cadence_id, status, cadence:qs_cadences(name)")
        .in("status", ["ganho", "perdido"])
        .not("cadence_id", "is", null);
      if (ownerId) qCadence = qCadence.eq("owner_id", ownerId);
      if (from) qCadence = qCadence.gte(closedCol, from);
      if (to) qCadence = qCadence.lte(closedCol, to);

      const { data: cadenceData } = await qCadence;
      const cadenceMap = new Map<string, { name: string; total: number; ganhos: number }>();
      ((cadenceData ?? []) as any[]).forEach((row) => {
        const name = row.cadence?.name || "Sem cadência";
        const entry = cadenceMap.get(name) || { name, total: 0, ganhos: 0 };
        entry.total++;
        if (row.status === "ganho") entry.ganhos++;
        cadenceMap.set(name, entry);
      });
      const cadenceRows: CadenceEfficiency[] = Array.from(cadenceMap.values())
        .map((e) => ({ cadence: e.name, total: e.total, ganhos: e.ganhos, taxa: e.total > 0 ? (e.ganhos / e.total) * 100 : 0 }))
        .sort((a, b) => b.total - a.total);
      setCadenceEfficiency(cadenceRows);

      // 3. Taxa de Contato Efetivo (Connect Rate)
      let qConnect = supabase
        .from("qs_tasks")
        .select("contact_result")
        .eq("status", "concluida");
      if (ownerId) qConnect = qConnect.eq("owner_id", ownerId);
      if (from) qConnect = qConnect.gte("completed_at", from);
      if (to) qConnect = qConnect.lte("completed_at", to);

      const { data: connectData } = await qConnect;
      if (connectData && connectData.length > 0) {
        const total = connectData.length;
        const atendeu = (connectData as any[]).filter((r) => isConnected(r.contact_result)).length;
        setConnectRate(total > 0 ? (atendeu / total) * 100 : null);
      } else {
        setConnectRate(null);
      }

      // 4. Taxa de Tarefas Atrasadas
      let qOverdue = supabase
        .from("qs_tasks")
        .select("status, scheduled_at")
        .in("status", ["pendente", "atrasada"]);
      if (ownerId) qOverdue = qOverdue.eq("owner_id", ownerId);

      const { data: overdueData } = await qOverdue;
      if (overdueData && overdueData.length > 0) {
        const now = new Date().toISOString();
        const total = overdueData.length;
        const overdue = (overdueData as any[]).filter(
          (r) => r.status === "atrasada" || (r.status === "pendente" && r.scheduled_at && r.scheduled_at < now)
        ).length;
        setTasksOverdueRate(total > 0 ? (overdue / total) * 100 : null);
      } else {
        setTasksOverdueRate(null);
      }

      // 5. Reuniões Agendadas por SDR
      let qMeetings = supabase
        .from("qs_meetings")
        .select("owner_id, status, owner:qs_users(name)")
        .in("status", ["agendada", "realizada"]);
      if (ownerId) qMeetings = qMeetings.eq("owner_id", ownerId);
      if (from) qMeetings = qMeetings.gte("created_at", from);
      if (to) qMeetings = qMeetings.lte("created_at", to);

      const { data: meetingsData } = await qMeetings;
      const meetingsMap = new Map<string, number>();
      ((meetingsData ?? []) as any[]).forEach((row) => {
        const name = row.owner?.name || "Sem nome";
        meetingsMap.set(name, (meetingsMap.get(name) || 0) + 1);
      });
      const meetingsRows: SdrMeetings[] = Array.from(meetingsMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
      setSdrMeetings(meetingsRows);

      setLoadingOperational(false);
    }
    loadOperationalKpis();
  }, [selectedUser, selectedPeriod, customStart, customEnd]);

  // ── Funil por etapa (Sprint Velocidade): coorte de leads criados no período ──
  const [funnel, setFunnel] = useState<{ label: string; count: number }[]>([]);
  const [loadingFunnel, setLoadingFunnel] = useState(true);
  useEffect(() => {
    async function loadFunnel() {
      setLoadingFunnel(true);
      const { from, to } = getDateRange(selectedPeriod, customStart, customEnd);
      const ownerId = selectedUser === "all" ? undefined : selectedUser;

      let qLeads = supabase.from("qs_leads").select("id, status");
      if (ownerId) qLeads = qLeads.eq("owner_id", ownerId);
      if (from) qLeads = qLeads.gte("created_at", from);
      if (to) qLeads = qLeads.lte("created_at", to);

      const [leadsRes, tasksRes, meetsRes] = await Promise.all([
        qLeads,
        supabase.from("qs_tasks").select("lead_id, contact_result").eq("status", "concluida"),
        supabase.from("qs_meetings").select("lead_id").neq("status", "cancelada"),
      ]);

      const cohort = (leadsRes.data ?? []) as { id: string; status: string }[];
      const ids = new Set(cohort.map((l) => l.id));
      const contacted = new Set<string>();
      const connected = new Set<string>();
      ((tasksRes.data ?? []) as { lead_id: string; contact_result: string | null }[]).forEach((t) => {
        if (!ids.has(t.lead_id)) return;
        contacted.add(t.lead_id);
        if (isConnected(t.contact_result)) connected.add(t.lead_id);
      });
      const met = new Set<string>();
      ((meetsRes.data ?? []) as { lead_id: string }[]).forEach((m) => { if (ids.has(m.lead_id)) met.add(m.lead_id); });
      const won = cohort.filter((l) => l.status === "ganho").length;

      setFunnel([
        { label: "Leads novos", count: cohort.length },
        { label: "Contatados", count: contacted.size },
        { label: "Conectados (atenderam)", count: connected.size },
        { label: "Reunião agendada", count: met.size },
        { label: "Ganhos", count: won },
      ]);
      setLoadingFunnel(false);
    }
    loadFunnel();
  }, [selectedUser, selectedPeriod, customStart, customEnd]);

  // KPIs de negócio: reuniões (show rate), pipeline em R$ e conversão por fonte.
  useEffect(() => {
    async function loadBusinessKpis() {
      setLoadingBusiness(true);
      const { from, to } = getDateRange(selectedPeriod, customStart, customEnd);
      const ownerId = selectedUser === "all" ? undefined : selectedUser;

      // 1. Reuniões do período (agendadas no período, pelo created_at)
      let qM = supabase.from("qs_meetings").select("status, created_at");
      if (ownerId) qM = qM.eq("owner_id", ownerId);
      if (from) qM = qM.gte("created_at", from);
      if (to) qM = qM.lte("created_at", to);

      // 1b. Meta de reuniões (qs_goals type=reunioes, mensal)
      let qMGoal = supabase.from("qs_goals").select("owner_id, target_value, period_start")
        .eq("type", "reunioes").eq("period", "mensal").order("period_start", { ascending: false });
      if (ownerId) qMGoal = qMGoal.eq("owner_id", ownerId);

      // 2. Pipeline em aberto (foto atual, não depende do período)
      let qPipe = supabase.from("qs_leads").select("estimated_value")
        .in("status", ["nao_iniciado", "em_prospeccao"]);
      if (ownerId) qPipe = qPipe.eq("owner_id", ownerId);

      // 3. Receita ganha no período (pela data de FECHAMENTO — ver migration 0012)
      const closedColWon = await getClosedAtColumn();
      let qWon = supabase.from("qs_leads").select("estimated_value, closed_value")
        .eq("status", "ganho");
      if (ownerId) qWon = qWon.eq("owner_id", ownerId);
      if (from) qWon = qWon.gte(closedColWon, from);
      if (to) qWon = qWon.lte(closedColWon, to);

      // 4. Conversão por fonte (leads criados no período)
      let qSrc = supabase.from("qs_leads").select("segment, status, created_at");
      if (ownerId) qSrc = qSrc.eq("owner_id", ownerId);
      if (from) qSrc = qSrc.gte("created_at", from);
      if (to) qSrc = qSrc.lte("created_at", to);

      const [mRes, mGoalRes, pipeRes, wonRes, srcRes] = await Promise.all([qM, qMGoal, qPipe, qWon, qSrc]);

      // Reuniões
      const meetings = (mRes.data ?? []) as { status: string }[];
      const agendadas = meetings.filter((m) => m.status !== "cancelada").length;
      const realizadas = meetings.filter((m) => m.status === "realizada").length;
      const noShow = meetings.filter((m) => m.status === "no_show").length;
      const decididas = realizadas + noShow;
      const seenOwner = new Set<string>();
      let meta = 0;
      ((mGoalRes.data ?? []) as any[]).forEach((g) => {
        const key = g.owner_id ?? "none";
        if (seenOwner.has(key)) return; // mais recente por owner
        seenOwner.add(key);
        meta += Number(g.target_value) || 0;
      });
      setMeetingKpis({
        agendadas, realizadas, noShow,
        showRate: decididas > 0 ? (realizadas / decididas) * 100 : null,
        meta,
      });

      // Pipeline / receita
      const sum = (rows: any[] | null, pick: (r: any) => number) =>
        (rows ?? []).reduce((acc, r) => acc + (pick(r) || 0), 0);
      setPipelineOpen(sum(pipeRes.data as any[], (r) => Number(r.estimated_value)));
      setRevenueWon(sum(wonRes.data as any[], (r) => Number(r.closed_value ?? r.estimated_value)));

      // Fonte
      const srcMap = new Map<string, { total: number; ganhos: number }>();
      ((srcRes.data ?? []) as any[]).forEach((r) => {
        const key = (r.segment || "Sem fonte").trim() || "Sem fonte";
        const e = srcMap.get(key) || { total: 0, ganhos: 0 };
        e.total++;
        if (r.status === "ganho") e.ganhos++;
        srcMap.set(key, e);
      });
      setSourceRows(
        Array.from(srcMap.entries())
          .map(([source, { total, ganhos }]) => ({ source, total, ganhos, taxa: total > 0 ? (ganhos / total) * 100 : 0 }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 12)
      );

      setLoadingBusiness(false);
    }
    loadBusinessKpis();
  }, [selectedUser, selectedPeriod, customStart, customEnd]);

  const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  return (
    <div className="space-y-6" style={{ fontFamily: "inherit" }}>
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="M18 9l-5 5-4-4-3 3" />
              </svg>
              Visão Geral - QS
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {userName} · {periodLabel}
            </p>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          {/* Selecionar usuário */}
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-[#0147FF] focus:ring-2 focus:ring-blue-100"
            >
              {allUsers.map((u: any) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div className="w-px h-6 bg-gray-200" />

          {/* Período */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {PERIOD_OPTIONS.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedPeriod(p.id)}
                className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                style={{
                  background: selectedPeriod === p.id ? "#0147FF" : "transparent",
                  color: selectedPeriod === p.id ? "#fff" : "#6B7280",
                  border: selectedPeriod === p.id ? "1px solid #0147FF" : "1px solid #E5E7EB",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Datas customizadas */}
          {selectedPeriod === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-[#0147FF]"
              />
              <span className="text-xs text-gray-400">até</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-[#0147FF]"
              />
            </div>
          )}
        </div>
      </div>

      {/* Area Chart */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
        <div className="flex items-center justify-between flex-wrap gap-y-2 mb-4">
          <h2 className="text-sm font-medium text-gray-700">
            Ganhos ao longo do mês
          </h2>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-[#0147FF] rounded-full inline-block" />
              Real
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="w-4 h-0.5 rounded-full inline-block"
                style={{
                  backgroundImage: "repeating-linear-gradient(90deg, #9CA3AF 0 4px, transparent 4px 7px)",
                  backgroundColor: "transparent",
                }}
              />
              Previsto
            </span>
          </div>
        </div>
        {loadingKpis ? (
          <p className="text-sm text-gray-500 text-center py-8">Carregando...</p>
        ) : (
          <AreaChart realData={realData} predictedData={predictedData} />
        )}
      </div>

      {/* KPI Cards + Speed-to-Lead */}
      {loadingKpis ? (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex items-center justify-center">
              <span className="text-sm text-gray-400">Carregando...</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {kpiCards.map((card) => (
            <KpiCardComponent key={card.type} card={card} />
          ))}
          <SpeedToLeadCard avgMinutes={speedToLead} loading={loadingSpeed} />
        </div>
      )}

      {/* Indicadores Operacionais */}
      <div>
        <h2 className="text-sm font-medium text-gray-700 mb-3">Indicadores Operacionais</h2>
        {loadingOperational ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex items-center justify-center">
                <span className="text-sm text-gray-400">Carregando...</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* 1. Ciclo Médio de Qualificação */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex flex-col gap-2">
              <span className="text-xs text-gray-500 uppercase">Ciclo Médio de Qualificação</span>
              <span
                className="text-2xl font-bold"
                style={{
                  color: cicloMedio === null ? "#9CA3AF" : cicloMedio < 7 ? "#059669" : cicloMedio < 14 ? "#D97706" : "#DC2626",
                }}
              >
                {cicloMedio !== null ? `${cicloMedio.toFixed(1)} dias` : "N/A"}
              </span>
              <span className="text-xs text-gray-400">
                {cicloMedio === null ? "Sem dados" : cicloMedio < 7 ? "Excelente" : cicloMedio < 14 ? "Aceitável" : "Acima do ideal"}
              </span>
            </div>

            {/* 3. Taxa de Contato Efetivo */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex flex-col gap-2">
              <span className="text-xs text-gray-500 uppercase">Taxa de Contato Efetivo</span>
              <span
                className="text-2xl font-bold"
                style={{
                  color: connectRate === null ? "#9CA3AF" : connectRate > 40 ? "#059669" : connectRate > 20 ? "#D97706" : "#DC2626",
                }}
              >
                {connectRate !== null ? `${connectRate.toFixed(1)}%` : "N/A"}
              </span>
              <span className="text-xs text-gray-400">
                {connectRate === null ? "Sem dados" : connectRate > 40 ? "Excelente" : connectRate > 20 ? "Bom" : "Precisa melhorar"}
              </span>
            </div>

            {/* 4. Taxa de Tarefas Atrasadas */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex flex-col gap-2">
              <span className="text-xs text-gray-500 uppercase">Taxa de Tarefas Atrasadas</span>
              <span
                className="text-2xl font-bold"
                style={{
                  color: tasksOverdueRate === null ? "#9CA3AF" : tasksOverdueRate < 10 ? "#059669" : tasksOverdueRate < 25 ? "#D97706" : "#DC2626",
                }}
              >
                {tasksOverdueRate !== null ? `${tasksOverdueRate.toFixed(1)}%` : "N/A"}
              </span>
              <span className="text-xs text-gray-400">
                {tasksOverdueRate === null ? "Sem dados" : tasksOverdueRate < 10 ? "Sob controle" : tasksOverdueRate < 25 ? "Atenção" : "Crítico"}
              </span>
            </div>

            {/* 2. Eficiência da Cadência (table) */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex flex-col gap-2">
              <span className="text-xs text-gray-500 uppercase">Eficiência da Cadência</span>
              {cadenceEfficiency.length === 0 ? (
                <span className="text-sm text-gray-400">Sem dados</span>
              ) : (
                <div className="overflow-x-auto mt-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-1.5 text-[11px] font-semibold text-gray-500 uppercase">Cadência</th>
                        <th className="text-center py-1.5 text-[11px] font-semibold text-gray-500 uppercase">Leads</th>
                        <th className="text-center py-1.5 text-[11px] font-semibold text-gray-500 uppercase">Ganhos</th>
                        <th className="text-center py-1.5 text-[11px] font-semibold text-gray-500 uppercase">Taxa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cadenceEfficiency.map((row) => (
                        <tr key={row.cadence} className="border-b border-gray-50">
                          <td className="py-1.5 text-xs font-medium text-gray-900 truncate max-w-[120px]">{row.cadence}</td>
                          <td className="py-1.5 text-center text-xs text-gray-700">{row.total}</td>
                          <td className="py-1.5 text-center text-xs text-gray-700">{row.ganhos}</td>
                          <td className="py-1.5 text-center">
                            <span
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{
                                background: row.taxa > 20 ? "#D1FAE5" : row.taxa > 10 ? "#FEF3C7" : "#FEE2E2",
                                color: row.taxa > 20 ? "#059669" : row.taxa > 10 ? "#D97706" : "#DC2626",
                              }}
                            >
                              {row.taxa.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 5. Reuniões Agendadas por SDR (table) */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex flex-col gap-2">
              <span className="text-xs text-gray-500 uppercase">Reuniões por SDR</span>
              {sdrMeetings.length === 0 ? (
                <span className="text-sm text-gray-400">Sem dados</span>
              ) : (
                <div className="overflow-x-auto mt-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-1.5 text-[11px] font-semibold text-gray-500 uppercase">SDR</th>
                        <th className="text-center py-1.5 text-[11px] font-semibold text-gray-500 uppercase">Reuniões</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sdrMeetings.map((row) => (
                        <tr key={row.name} className="border-b border-gray-50">
                          <td className="py-1.5 text-xs font-medium text-gray-900 truncate max-w-[140px]">{row.name}</td>
                          <td className="py-1.5 text-center text-xs font-bold text-gray-700">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Funil por etapa (Sprint Velocidade) ──────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
        <h2 className="text-sm font-medium text-gray-700 mb-1">Funil por Etapa</h2>
        <p className="text-xs text-gray-400 mb-4">Leads criados no período e até onde chegaram — a % mostra quanto passa de uma etapa pra próxima.</p>
        {loadingFunnel ? (
          <p className="text-sm text-gray-500 text-center py-6">Carregando...</p>
        ) : funnel.length === 0 || funnel[0].count === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Nenhum lead criado no período.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {funnel.map((stage, i) => {
              const base = funnel[0].count || 1;
              const widthPct = Math.max((stage.count / base) * 100, 2);
              const prev = i > 0 ? funnel[i - 1].count : null;
              const stepPct = prev != null ? (prev > 0 ? Math.round((stage.count / prev) * 100) : 0) : null;
              const colors = ["#0147FF", "#3B6FF7", "#6D3BEB", "#E8920B", "#12A18A"];
              return (
                <div key={stage.label} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 text-xs font-semibold text-gray-600 text-right">{stage.label}</span>
                  <div className="flex-1 h-8 rounded-lg bg-gray-50 relative overflow-hidden">
                    <div className="h-full rounded-lg flex items-center px-2.5 transition-all" style={{ width: `${widthPct}%`, background: colors[i] }}>
                      <span className="text-[12px] font-extrabold text-white tabular-nums">{stage.count}</span>
                    </div>
                  </div>
                  <span className="w-14 shrink-0 text-[11px] font-bold text-right tabular-nums" style={{ color: stepPct == null ? "#9CA3AF" : stepPct >= 50 ? "#059669" : stepPct >= 25 ? "#D97706" : "#DC2626" }}>
                    {stepPct == null ? "100%" : `${stepPct}%`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Reuniões, Pipeline e Receita (auditoria) ─────────────────────── */}
      <div>
        <h2 className="text-sm font-medium text-gray-700 mb-3">Reuniões e Receita</h2>
        {loadingBusiness ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex items-center justify-center">
                <span className="text-sm text-gray-400">Carregando...</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Reuniões do período + show rate */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex flex-col gap-2">
              <span className="text-xs text-gray-500 uppercase">Reuniões no Período</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-gray-900">{meetingKpis?.agendadas ?? 0}</span>
                {meetingKpis && meetingKpis.meta > 0 && (
                  <span className="text-xs text-gray-400">/ meta {meetingKpis.meta}</span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-emerald-600 font-semibold">{meetingKpis?.realizadas ?? 0} realizadas</span>
                <span className="text-red-500 font-semibold">{meetingKpis?.noShow ?? 0} no-show</span>
              </div>
              <span className="text-xs text-gray-400">
                {meetingKpis?.showRate != null
                  ? `Show rate: ${meetingKpis.showRate.toFixed(0)}% das reuniões decididas`
                  : "Show rate: sem reuniões decididas ainda"}
              </span>
            </div>

            {/* Pipeline em aberto */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex flex-col gap-2">
              <span className="text-xs text-gray-500 uppercase">Pipeline em Aberto</span>
              <span className="text-2xl font-bold text-gray-900" style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtBRL.format(pipelineOpen ?? 0)}
              </span>
              <span className="text-xs text-gray-400">Valor estimado dos leads em prospecção (foto de agora)</span>
            </div>

            {/* Receita ganha */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex flex-col gap-2">
              <span className="text-xs text-gray-500 uppercase">Receita Ganha no Período</span>
              <span className="text-2xl font-bold text-emerald-600" style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtBRL.format(revenueWon ?? 0)}
              </span>
              <span className="text-xs text-gray-400">Soma dos leads ganhos (valor fechado ou estimado)</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Conversão por Fonte (auditoria) ──────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
        <h2 className="text-sm font-medium text-gray-700 mb-1">Conversão por Fonte</h2>
        <p className="text-xs text-gray-400 mb-4">Qual campanha/LP traz lead que fecha — leads criados no período, agrupados pela fonte que veio do Bitrix.</p>
        {loadingBusiness ? (
          <p className="text-sm text-gray-500 text-center py-4">Carregando...</p>
        ) : sourceRows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Nenhum lead criado no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Fonte</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Leads</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Ganhos</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Conversão</th>
                </tr>
              </thead>
              <tbody>
                {sourceRows.map((row) => (
                  <tr key={row.source} className="border-b border-gray-50">
                    <td className="py-2 px-3 text-xs font-medium text-gray-900 truncate max-w-[240px]">{row.source}</td>
                    <td className="py-2 px-3 text-center text-xs text-gray-700" style={{ fontVariantNumeric: "tabular-nums" }}>{row.total}</td>
                    <td className="py-2 px-3 text-center text-xs text-gray-700" style={{ fontVariantNumeric: "tabular-nums" }}>{row.ganhos}</td>
                    <td className="py-2 px-3 text-center">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          background: row.taxa > 20 ? "#D1FAE5" : row.taxa > 10 ? "#FEF3C7" : "#FEE2E2",
                          color: row.taxa > 20 ? "#059669" : row.taxa > 10 ? "#D97706" : "#DC2626",
                        }}
                      >
                        {row.taxa.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Channel Performance (Change 18) */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
        <h2 className="text-sm font-medium text-gray-700 mb-4">
          Desempenho por Canal
        </h2>
        <ChannelPerformanceTable data={channelPerformance} loading={loadingChannels} />
      </div>

      {/* Heatmap (Change 19) */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
        <h2 className="text-sm font-medium text-gray-700 mb-4">
          Melhores Horários de Contato
        </h2>
        <ContactHeatmap cells={heatmapCells} loading={loadingHeatmap} />
      </div>

      {/* Loss Reasons */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
        <h2 className="text-sm font-medium text-gray-700 mb-4">
          Motivos de Perda
        </h2>
        <LossReasonsChart
          selectedUser={selectedUser}
          selectedPeriod={selectedPeriod}
          customStart={customStart}
          customEnd={customEnd}
        />
      </div>

      {/* Ranking de SDRs */}
      <RankingPanel />

      {/* Análise dia a dia (leads que chegaram / agendamentos por dia) */}
      <DailyFlowPanel />
    </div>
  );
}
