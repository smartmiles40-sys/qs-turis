import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { fetchDashboardStats, fetchQsUsers, getClosedAtColumn, fetchAllRows, isGoalEffective } from "@/lib/qs/queries";
import { loadWorkHours, workdaysInRange } from "@/lib/workHours";
import type { GoalType } from "../types";
import type { SdrUser } from "../types";
import { CHANNEL_LABELS } from "../types";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
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
  ownerId: string;
  name: string;
  count: number;
}

// Metas mensais PADRÃO (fallback quando não há meta cadastrada). Ficam no escopo
// do módulo porque tanto os KPIs (loadKpis) quanto a meta de reuniões
// (loadBusinessKpis) e a tabela "Reuniões por SDR" usam o MESMO valor —
// antes o default de reuniões (40) morava dentro de loadKpis e os outros pontos
// tinham que "adivinhar" o mesmo número.
const META_DEFAULTS: Record<GoalType, number> = {
  ganhos: 87,
  leads_finalizados: 250,
  atividades: 450,
  conversao: 30,
  reunioes: 40,
};

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

// ── Redesign Onda 4: componentes/helpers visuais por papel ──────────────────
// A Visão Geral foi separada por PAPEL (SDR foca no dia; gestor foca em
// comparação + exceção). Toda a camada de DADOS (fetches auditados) foi
// PRESERVADA; estes componentes só reorganizam como os números aparecem, com o
// selo "como calculamos?" documentando a lógica exata de cada KPI.

// Selo de transparência de métrica (o title= carrega a definição exata).
function HintPill({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="text-[11px] font-semibold text-gray-400 border border-dashed border-gray-300 rounded-full px-2 py-0.5 cursor-help select-none whitespace-nowrap"
    >
      como calculamos?
    </span>
  );
}

function SectionHeading({ title, hint, extra }: { title: string; hint?: string; extra?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <h2 className="text-sm font-bold text-gray-800">{title}</h2>
      {hint && <HintPill text={hint} />}
      {extra}
    </div>
  );
}

// Card de KPI do "hero" (rótulo + bolinha semântica + número grande + barra
// opcional de meta + legenda). Cores semânticas ficam SEPARADAS do azul de marca.
function HeroCard({
  label, dotColor, value, valueColor, sub, barPct, barColor, hint,
}: {
  label: string; dotColor: string; value: ReactNode; valueColor?: string;
  sub?: string; barPct?: number | null; barColor?: string; hint?: string;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: dotColor }} />
        {label}
        {hint && <span className="ml-auto"><HintPill text={hint} /></span>}
      </span>
      <span
        className="text-[26px] font-extrabold leading-none tracking-tight tabular-nums"
        style={{ color: valueColor ?? "#141C2B" }}
      >
        {value}
      </span>
      {barPct != null && (
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mt-0.5">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, barPct))}%`, background: barColor ?? "#0147FF" }} />
        </div>
      )}
      {sub && <span className="text-[11.5px] font-medium text-gray-400">{sub}</span>}
    </div>
  );
}

// Fila por FUP (dia da cadência), com a PARTE ATRASADA em vermelho por etapa.
// Reaproveita a lógica do CadenceHealthPanel (não existe mais "Novo": quem não
// teve 1º contato é FUP 1). Recebe os "stages" já calculados.
function FupQueue({ stages, note }: { stages: { fupDay: number; overdue: boolean }[]; note?: string }) {
  if (stages.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">Nenhum lead na fila.</p>;
  }
  const buckets = [
    { label: "FUP 1", count: 0, late: 0 },
    { label: "FUP 2", count: 0, late: 0 },
    { label: "FUP 3", count: 0, late: 0 },
    { label: "FUP 4", count: 0, late: 0 },
    { label: "FUP 5+", count: 0, late: 0 },
  ];
  for (const s of stages) {
    const idx = Math.min(5, Math.max(1, s.fupDay)) - 1;
    buckets[idx].count++;
    if (s.overdue) buckets[idx].late++;
  }
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const totalLate = stages.filter((s) => s.overdue).length;
  return (
    <div>
      {buckets.map((b) => {
        const totalPct = (b.count / max) * 100;
        const latePct = b.count > 0 ? (b.late / b.count) * totalPct : 0;
        const goodPct = Math.max(0, totalPct - latePct);
        return (
          <div
            key={b.label}
            className="grid items-center gap-3 py-1.5 border-b border-gray-50 last:border-0"
            style={{ gridTemplateColumns: "56px 1fr 76px" }}
          >
            <span className="text-[12.5px] font-bold text-gray-500">{b.label}</span>
            <div className="h-5 rounded-md bg-[#E8EEFF] overflow-hidden flex">
              <div className="h-full" style={{ width: `${goodPct}%`, background: "#0147FF" }} />
              <div className="h-full" style={{ width: `${latePct}%`, background: "#DC2626", opacity: 0.9 }} />
            </div>
            <span className="text-[12.5px] font-bold text-right tabular-nums text-gray-700">
              {b.count}
              {b.late > 0 && <span className="text-[#DC2626]"> · {b.late}</span>}
            </span>
          </div>
        );
      })}
      <p className="text-[11.5px] font-medium text-gray-400 mt-2">
        {stages.length} leads na fila ·{" "}
        {totalLate > 0
          ? <b className="text-[#DC2626]">{totalLate} atrasado{totalLate > 1 ? "s" : ""}</b>
          : "nenhum atrasado"}
        .{note ? ` ${note}` : ""}
      </p>
    </div>
  );
}

// ── Tipos/helpers das buscas NOVAS (fila do SDR e visão do time) ─────────────
interface QueueStage {
  leadId: string;
  ownerId: string | null;
  leadName: string;
  fupDay: number;
  overdue: boolean;
  daysOverdue: number;
  channel: string | null;
}
interface HotLead { id: string; name: string; arrivedAt: string | null; }
interface ComparativoRow {
  id: string; name: string;
  leads: number; contatados: number; reuniao: number; ganho: number;
  conv: number; atrasadas: number; backlogDias: number;
}
interface ZombieSummary { total: number; bySdr: { name: string; count: number }[]; }

// Início do dia LOCAL em ms (BRT é o fuso do negócio) — mesma definição de
// "atrasada" do resto do sistema (venceu ANTES de hoje 00:00).
function dayStartMs(d: Date): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

// Nome de exibição do lead a partir das colunas disponíveis.
function leadDisplayName(l: { full_name?: string | null; first_name?: string | null; last_name?: string | null }): string {
  const composed = (l.full_name || [l.first_name, l.last_name].filter(Boolean).join(" ") || "").trim();
  return composed || "Sem nome";
}

function channelLabel(ch: string | null): string {
  if (!ch) return "Atividade";
  return (CHANNEL_LABELS as Record<string, string>)[ch] ?? ch;
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

  // Dias úteis do mês corrente (respeita o Horário de Trabalho configurado) —
  // denominador da "meta de reuniões POR DIA". Carregado 1x no mount.
  const [workdaysMonth, setWorkdaysMonth] = useState<number>(0);
  // Meta MENSAL de reuniões por SDR (owner_id → alvo mensal, já com vigência e
  // dono ativo aplicados). A tabela "Reuniões por SDR" deriva a meta/dia daqui.
  const [meetingGoalByOwner, setMeetingGoalByOwner] = useState<Record<string, number>>({});

  // KPIs de negócio (auditoria): reuniões do período, pipeline e conversão por fonte
  const [meetingKpis, setMeetingKpis] = useState<{ agendadas: number; realizadas: number; noShow: number; showRate: number | null; meta: number } | null>(null);
  const [pipelineOpen, setPipelineOpen] = useState<number | null>(null);
  const [revenueWon, setRevenueWon] = useState<number | null>(null);
  const [sourceRows, setSourceRows] = useState<{ source: string; total: number; ganhos: number; taxa: number }[]>([]);
  const [loadingBusiness, setLoadingBusiness] = useState(true);

  // ── Onda 4: separação por PAPEL ────────────────────────────────────────────
  // Gestor/admin veem a Visão do Gestor (time); SDR/closer veem a Visão do SDR
  // (só o próprio). canSeeAllData é a MESMA regra usada no resto do app.
  const { currentUser } = useQsAuth();
  const isManager = !!currentUser && canSeeAllData(currentUser.role);

  // Visão do SDR — "Minha fila" (FUP), leads quentes sem 1º contato e priorização.
  const [myStages, setMyStages] = useState<QueueStage[]>([]);
  const [hotLeads, setHotLeads] = useState<HotLead[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [errQueue, setErrQueue] = useState<string | null>(null);

  // Visão do Gestor — saúde da fila do time, comparativo por SDR e "zumbis".
  const [teamStages, setTeamStages] = useState<QueueStage[]>([]);
  const [comparativoRows, setComparativoRows] = useState<ComparativoRow[]>([]);
  const [zombies, setZombies] = useState<ZombieSummary | null>(null);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [errTeam, setErrTeam] = useState<string | null>(null);

  // SDR só enxerga o próprio: força o "qualificador" para ele e esconde o
  // seletor (feito no render). Efeitos que dependem de selectedUser reagem sozinhos.
  useEffect(() => {
    if (currentUser && !canSeeAllData(currentUser.role)) setSelectedUser(currentUser.id);
  }, [currentUser]);

  const periodLabel = PERIOD_OPTIONS.find(p => p.id === selectedPeriod)?.label || "Mês atual";

  // Fetch users
  useEffect(() => {
    async function loadUsers() {
      const data = await fetchQsUsers();
      setUsers(data);
    }
    loadUsers();
  }, []);

  // Dias úteis do mês corrente (Horário de Trabalho da empresa) — usado para
  // transformar a meta MENSAL de reuniões em meta POR DIA.
  useEffect(() => {
    let active = true;
    (async () => {
      const wh = await loadWorkHours();
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      if (active) setWorkdaysMonth(workdaysInRange(wh, first, last));
    })();
    return () => { active = false; };
  }, []);

  const allUsers = [{ id: "all", name: "Todos os qualificadores" } as any, ...users];
  const userName = allUsers.find((u: any) => u.id === selectedUser)?.name || "Todos";

  // Quantos SDRs ATIVOS existem — base da somatória do admin ("N SDRs × meta").
  // Quem tem meta cadastrada entra com ela; o resto entra com o valor padrão.
  const activeSdrUsers = users.filter((u) => u.role === "sdr" && u.is_active !== false);
  const activeSdrCount = activeSdrUsers.length;
  // Meta/dia de reuniões = meta mensal ÷ dias úteis do mês (arredonda p/ cima,
  // mínimo 1 quando há meta). Reutilizada no hero do SDR e na tabela por SDR.
  const meetingDaily = (monthly: number): number | null =>
    monthly > 0 && workdaysMonth > 0 ? Math.max(1, Math.ceil(monthly / workdaysMonth)) : null;

  // Reuniões por SDR (tabela do gestor): TODOS os SDRs ativos aparecem (mesmo
  // com 0 reuniões no período), cada um com a meta/dia derivada da meta mensal.
  const meetingRows = (() => {
    const countByOwner: Record<string, number> = {};
    sdrMeetings.forEach((r) => { countByOwner[r.ownerId] = r.count; });
    const base = activeSdrUsers.length > 0
      ? activeSdrUsers.map((u) => ({ id: u.id, name: u.name, count: countByOwner[u.id] ?? 0 }))
      : sdrMeetings.map((r) => ({ id: r.ownerId, name: r.name, count: r.count }));
    return base
      .map((r) => {
        const monthly = meetingGoalByOwner[r.id] ?? META_DEFAULTS.reunioes;
        return { ...r, monthly, daily: meetingDaily(monthly) };
      })
      .sort((a, b) => b.count - a.count);
  })();

  // Fetch KPIs and chart data
  const loadKpis = useCallback(async (silent = false) => {
    if (!silent) setLoadingKpis(true);
    try {
      const { from, to } = getDateRange(selectedPeriod, customStart, customEnd);
      const ownerId = selectedUser === "all" ? undefined : selectedUser;

      // Metas mensais reais (qs_goals). Um SDR selecionado → a meta DELE (ou o
      // padrão). Admin em "todos" → SOMATÓRIA de todos os SDRs ativos: quem tem
      // meta entra com ela, quem não tem entra com o valor padrão ("N SDRs ×
      // meta"). A meta de EQUIPE (owner_id null) NÃO é mais usada como placar —
      // decisão do Bruno (2026-07-20): o admin sempre vê a soma dos SDRs.
      let qGoals = supabase
        .from("qs_goals")
        .select("owner_id, type, target_value, period_start, owner:qs_users(is_active, role)")
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

      // goalSum/goalCount: TODAS as metas individuais (usado quando um usuário
      // específico está selecionado — a query já vem filtrada nele).
      // sdrSum/sdrCount: só as de SDRs ativos — base da somatória do admin.
      const goalSum: Record<GoalType, number> = { ganhos: 0, leads_finalizados: 0, atividades: 0, conversao: 0, reunioes: 0 };
      const goalCount: Record<GoalType, number> = { ganhos: 0, leads_finalizados: 0, atividades: 0, conversao: 0, reunioes: 0 };
      const sdrSum: Record<GoalType, number> = { ganhos: 0, leads_finalizados: 0, atividades: 0, conversao: 0, reunioes: 0 };
      const sdrCount: Record<GoalType, number> = { ganhos: 0, leads_finalizados: 0, atividades: 0, conversao: 0, reunioes: 0 };
      const seenGoal = new Set<string>();
      ((goalsRes.data ?? []) as any[]).forEach((g) => {
        const type = g.type as GoalType;
        if (!(type in goalSum)) return;
        // Meta ancorada num mês FUTURO ainda não vigora (regra compartilhada
        // com a página Metas — ver isGoalEffective em queries.ts).
        if (!isGoalEffective(g.period_start)) return;
        // Meta de EQUIPE (owner_id null) não conta mais no placar do admin.
        if (g.owner_id == null) return;
        // Meta de dono DESATIVADO não entra (ficava somada "pra sempre").
        const ownerRow = Array.isArray(g.owner) ? g.owner[0] : g.owner;
        if (ownerRow && ownerRow.is_active === false) return;
        // Dedupe por (owner, tipo) mantendo a meta vigente mais recente
        const key = `${g.owner_id}-${type}`;
        if (seenGoal.has(key)) return;
        seenGoal.add(key);
        const val = Number(g.target_value) || 0;
        goalSum[type] += val;
        goalCount[type] += 1;
        if (ownerRow && ownerRow.role === "sdr") {
          sdrSum[type] += val;
          sdrCount[type] += 1;
        }
      });

      const metaFor = (type: GoalType): { value: number; team: boolean } => {
        // Usuário específico selecionado: a meta dele (ou o padrão).
        if (ownerId) {
          return { value: goalCount[type] > 0 ? goalSum[type] : META_DEFAULTS[type], team: false };
        }
        // Admin / "todos": SOMATÓRIA de todos os SDRs ativos, preenchendo quem
        // não tem meta com o padrão → "N SDRs × meta".
        if (type === "conversao") {
          // Percentual não soma: usa a MÉDIA das metas dos SDRs (ou o padrão).
          const v = sdrCount[type] > 0 ? Math.round(sdrSum[type] / sdrCount[type]) : META_DEFAULTS[type];
          return { value: v, team: true };
        }
        if (activeSdrCount > 0) {
          const fill = Math.max(0, activeSdrCount - sdrCount[type]) * META_DEFAULTS[type];
          return { value: sdrSum[type] + fill, team: true };
        }
        // Sem lista de SDRs ainda (boot): cai na soma do que houver / padrão.
        return { value: goalCount[type] > 0 ? goalSum[type] : META_DEFAULTS[type], team: true };
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
        `Meta mensal: ${meta.value}${suffix}${
          meta.team
            ? activeSdrCount > 0
              ? ` (soma de ${activeSdrCount} SDR${activeSdrCount !== 1 ? "s" : ""})`
              : " (time)"
            : ""
        }`;

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
  }, [selectedUser, selectedPeriod, customStart, customEnd, activeSdrCount]);

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

  // Detalhamento é só do gestor: não dispara as buscas pesadas para o SDR.
  useEffect(() => {
    if (isManager) loadChannelPerformance();
  }, [loadChannelPerformance, isManager]);

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
    if (isManager) loadHeatmap();
  }, [loadHeatmap, isManager]);

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
    if (isManager) loadSpeedToLead();
  }, [loadSpeedToLead, isManager]);

  // Fetch Operational KPIs
  const loadOperationalKpis = useCallback(async (silent = false) => {
    if (!silent) setLoadingOperational(true);
    try {
      const { from, to } = getDateRange(selectedPeriod, customStart, customEnd);
      const ownerId = selectedUser === "all" ? undefined : selectedUser;

      // Data de FECHAMENTO real (closed_at, migration 0012; fallback updated_at).
      const closedCol = await getClosedAtColumn();
      // "Atrasada" é POR DIA (mesma definição de classifyTask / notificações):
      // conta só o que venceu ANTES de hoje 00:00 local. Antes o corte era "agora"
      // (nowIso), então uma tarefa de HOJE 09h vista às 15h já entrava como
      // atrasada e inflava a "Taxa de Tarefas Atrasadas".
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const startOfTodayIso = startOfToday.toISOString();

      // 1. Ciclo Médio de Qualificação — paginado (cap 1000 do PostgREST)
      const cicloPromise = fetchAllRows<any>((f, t) => {
        let q = supabase
          .from("qs_leads")
          .select(`arrived_at, ${closedCol}`)
          .in("status", ["ganho", "perdido"])
          .not("arrived_at", "is", null)
          .order("id");
        if (ownerId) q = q.eq("owner_id", ownerId);
        if (from) q = q.gte(closedCol, from);
        if (to) q = q.lte(closedCol, to);
        return q.range(f, t);
      });

      // 2. Eficiência da Cadência — paginado
      const cadencePromise = fetchAllRows<any>((f, t) => {
        let q = supabase
          .from("qs_leads")
          .select("cadence_id, status, cadence:qs_cadences(name)")
          .in("status", ["ganho", "perdido"])
          .not("cadence_id", "is", null)
          .order("id");
        if (ownerId) q = q.eq("owner_id", ownerId);
        if (from) q = q.gte(closedCol, from);
        if (to) q = q.lte(closedCol, to);
        return q.range(f, t);
      });

      // 3. Taxa de Contato Efetivo — só precisamos CONTAR: `count exact + head`
      // não sofre o cap de 1000 linhas nem baixa payload.
      let qConnTotal = supabase
        .from("qs_tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "concluida");
      let qConnHit = supabase
        .from("qs_tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "concluida")
        .in("contact_result", CONNECTED_RESULTS);
      if (ownerId) {
        qConnTotal = qConnTotal.eq("owner_id", ownerId);
        qConnHit = qConnHit.eq("owner_id", ownerId);
      }
      if (from) {
        qConnTotal = qConnTotal.gte("completed_at", from);
        qConnHit = qConnHit.gte("completed_at", from);
      }
      if (to) {
        qConnTotal = qConnTotal.lte("completed_at", to);
        qConnHit = qConnHit.lte("completed_at", to);
      }

      // 4. Taxa de Tarefas Atrasadas — idem, 3 contagens head
      let qOpenTotal = supabase
        .from("qs_tasks")
        .select("id", { count: "exact", head: true })
        .in("status", ["pendente", "atrasada"]);
      let qLate = supabase
        .from("qs_tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "atrasada");
      let qPendVencida = supabase
        .from("qs_tasks")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente")
        .lt("scheduled_at", startOfTodayIso);
      if (ownerId) {
        qOpenTotal = qOpenTotal.eq("owner_id", ownerId);
        qLate = qLate.eq("owner_id", ownerId);
        qPendVencida = qPendVencida.eq("owner_id", ownerId);
      }

      // 5. Reuniões Agendadas por SDR — paginado
      const meetingsPromise = fetchAllRows<any>((f, t) => {
        let q = supabase
          .from("qs_meetings")
          .select("owner_id, status, owner:qs_users(name)")
          .in("status", ["agendada", "realizada"])
          .order("id");
        if (ownerId) q = q.eq("owner_id", ownerId);
        if (from) q = q.gte("created_at", from);
        if (to) q = q.lte("created_at", to);
        return q.range(f, t);
      });

      // Tudo independente → uma rodada só (antes eram 5 idas em SÉRIE).
      const [cicloData, cadenceData, connTotalRes, connHitRes, openTotalRes, lateRes, pendVencidaRes, meetingsData] =
        await Promise.all([cicloPromise, cadencePromise, qConnTotal, qConnHit, qOpenTotal, qLate, qPendVencida, meetingsPromise]);
      if (connTotalRes.error) throw connTotalRes.error;
      if (connHitRes.error) throw connHitRes.error;
      if (openTotalRes.error) throw openTotalRes.error;
      if (lateRes.error) throw lateRes.error;
      if (pendVencidaRes.error) throw pendVencidaRes.error;

      // 1. Ciclo médio
      if (cicloData.length > 0) {
        let totalDays = 0;
        let count = 0;
        cicloData.forEach((row) => {
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

      // 2. Eficiência da cadência
      const cadenceMap = new Map<string, { name: string; total: number; ganhos: number }>();
      cadenceData.forEach((row) => {
        const cad = Array.isArray(row.cadence) ? row.cadence[0] : row.cadence;
        const name = cad?.name || "Sem cadência";
        const entry = cadenceMap.get(name) || { name, total: 0, ganhos: 0 };
        entry.total++;
        if (row.status === "ganho") entry.ganhos++;
        cadenceMap.set(name, entry);
      });
      const cadenceRows: CadenceEfficiency[] = Array.from(cadenceMap.values())
        .map((e) => ({ cadence: e.name, total: e.total, ganhos: e.ganhos, taxa: e.total > 0 ? (e.ganhos / e.total) * 100 : 0 }))
        .sort((a, b) => b.total - a.total);
      setCadenceEfficiency(cadenceRows);

      // 3. Connect rate
      const connTotal = connTotalRes.count ?? 0;
      setConnectRate(connTotal > 0 ? ((connHitRes.count ?? 0) / connTotal) * 100 : null);

      // 4. Tarefas atrasadas
      const openTotal = openTotalRes.count ?? 0;
      const overdue = (lateRes.count ?? 0) + (pendVencidaRes.count ?? 0);
      setTasksOverdueRate(openTotal > 0 ? (overdue / openTotal) * 100 : null);

      // 5. Reuniões por SDR — agora por owner_id (a tabela cruza com a meta/dia).
      const meetingsMap = new Map<string, { name: string; count: number }>();
      meetingsData.forEach((row) => {
        const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner;
        const id = row.owner_id || "sem-dono";
        const name = owner?.name || "Sem nome";
        const e = meetingsMap.get(id) || { name, count: 0 };
        e.count += 1;
        meetingsMap.set(id, e);
      });
      const meetingsRows: SdrMeetings[] = Array.from(meetingsMap.entries())
        .map(([ownerId, { name, count }]) => ({ ownerId, name, count }))
        .sort((a, b) => b.count - a.count);
      setSdrMeetings(meetingsRows);

      setErrOperational(null);
    } catch (error) {
      console.warn("Erro ao carregar indicadores operacionais:", error);
      setErrOperational("Não foi possível carregar os indicadores operacionais.");
    } finally {
      setLoadingOperational(false);
    }
  }, [selectedUser, selectedPeriod, customStart, customEnd]);

  useEffect(() => {
    loadOperationalKpis();
  }, [loadOperationalKpis]);

  // ── Funil por etapa (Sprint Velocidade): coorte de leads criados no período ──
  const [funnel, setFunnel] = useState<{ label: string; count: number }[]>([]);
  const [loadingFunnel, setLoadingFunnel] = useState(true);
  const loadFunnel = useCallback(async (silent = false) => {
    if (!silent) setLoadingFunnel(true);
    try {
      const { from, to } = getDateRange(selectedPeriod, customStart, customEnd);
      const ownerId = selectedUser === "all" ? undefined : selectedUser;

      // Tudo paginado (cap 1000 do PostgREST) — o funil somava só os 1000
      // primeiros e mentia em silêncio. Tarefas/reuniões de um lead da coorte
      // acontecem DEPOIS da criação dele → o corte inferior em `from` não perde
      // nada e evita varrer as tabelas inteiras.
      const [cohort, tasks, meets] = await Promise.all([
        fetchAllRows<{ id: string; status: string }>((f, t) => {
          let q = supabase.from("qs_leads").select("id, status").order("id");
          if (ownerId) q = q.eq("owner_id", ownerId);
          if (from) q = q.gte("created_at", from);
          if (to) q = q.lte("created_at", to);
          return q.range(f, t);
        }),
        fetchAllRows<{ lead_id: string; contact_result: string | null }>((f, t) => {
          let q = supabase.from("qs_tasks").select("lead_id, contact_result").eq("status", "concluida").order("id");
          if (from) q = q.gte("completed_at", from);
          return q.range(f, t);
        }),
        fetchAllRows<{ lead_id: string }>((f, t) => {
          let q = supabase.from("qs_meetings").select("lead_id").neq("status", "cancelada").order("id");
          if (from) q = q.gte("created_at", from);
          return q.range(f, t);
        }),
      ]);

      const ids = new Set(cohort.map((l) => l.id));
      const contacted = new Set<string>();
      const connected = new Set<string>();
      tasks.forEach((t) => {
        if (!ids.has(t.lead_id)) return;
        contacted.add(t.lead_id);
        if (isConnected(t.contact_result)) connected.add(t.lead_id);
      });
      const met = new Set<string>();
      meets.forEach((m) => { if (ids.has(m.lead_id)) met.add(m.lead_id); });
      const won = cohort.filter((l) => l.status === "ganho").length;

      setFunnel([
        { label: "Leads novos", count: cohort.length },
        { label: "Contatados", count: contacted.size },
        { label: "Conectados (atenderam)", count: connected.size },
        { label: "Reunião agendada", count: met.size },
        { label: "Ganhos", count: won },
      ]);
      setErrFunnel(null);
    } catch (error) {
      console.warn("Erro ao carregar funil por etapa:", error);
      setErrFunnel("Não foi possível carregar o funil por etapa.");
    } finally {
      setLoadingFunnel(false);
    }
  }, [selectedUser, selectedPeriod, customStart, customEnd]);

  useEffect(() => {
    if (isManager) loadFunnel();
  }, [loadFunnel, isManager]);

  // KPIs de negócio: reuniões (show rate), pipeline em R$ e conversão por fonte.
  const loadBusinessKpis = useCallback(async (silent = false) => {
    if (!silent) setLoadingBusiness(true);
    try {
      const { from, to } = getDateRange(selectedPeriod, customStart, customEnd);
      const ownerId = selectedUser === "all" ? undefined : selectedUser;
      const closedColWon = await getClosedAtColumn();

      // Todas paginadas (cap 1000 do PostgREST) — pipeline com >1000 leads em
      // aberto "perdia" dinheiro da soma sem avisar.
      // 1. Reuniões do período (agendadas no período, pelo created_at)
      const mPromise = fetchAllRows<{ status: string }>((f, t) => {
        let q = supabase.from("qs_meetings").select("status, created_at").order("id");
        if (ownerId) q = q.eq("owner_id", ownerId);
        if (from) q = q.gte("created_at", from);
        if (to) q = q.lte("created_at", to);
        return q.range(f, t);
      });

      // 1b. Meta de reuniões (qs_goals type=reunioes, mensal) — mesma regra de
      // vigência/donos inativos dos KPIs (isGoalEffective). Admin em "todos" soma
      // os SDRs (default-fill); SDR selecionado usa a meta dele (ou o padrão).
      let qMGoal = supabase.from("qs_goals")
        .select("owner_id, target_value, period_start, owner:qs_users(is_active, role)")
        .eq("type", "reunioes").eq("period", "mensal").order("period_start", { ascending: false });
      if (ownerId) qMGoal = qMGoal.eq("owner_id", ownerId);

      // 2. Pipeline em aberto (foto atual, não depende do período)
      const pipePromise = fetchAllRows<{ estimated_value: number | null }>((f, t) => {
        let q = supabase.from("qs_leads").select("estimated_value")
          .in("status", ["nao_iniciado", "em_prospeccao"]).order("id");
        if (ownerId) q = q.eq("owner_id", ownerId);
        return q.range(f, t);
      });

      // 3. Receita ganha no período (pela data de FECHAMENTO — ver migration 0012)
      const wonPromise = fetchAllRows<{ estimated_value: number | null; closed_value: number | null }>((f, t) => {
        let q = supabase.from("qs_leads").select("estimated_value, closed_value")
          .eq("status", "ganho").order("id");
        if (ownerId) q = q.eq("owner_id", ownerId);
        if (from) q = q.gte(closedColWon, from);
        if (to) q = q.lte(closedColWon, to);
        return q.range(f, t);
      });

      // 4. Conversão por fonte (leads criados no período)
      const srcPromise = fetchAllRows<{ segment: string | null; status: string }>((f, t) => {
        let q = supabase.from("qs_leads").select("segment, status, created_at").order("id");
        if (ownerId) q = q.eq("owner_id", ownerId);
        if (from) q = q.gte("created_at", from);
        if (to) q = q.lte("created_at", to);
        return q.range(f, t);
      });

      const [meetings, mGoalRes, pipeRows, wonRows, srcRows] =
        await Promise.all([mPromise, qMGoal, pipePromise, wonPromise, srcPromise]);
      if (mGoalRes.error) throw mGoalRes.error;

      // Reuniões
      const agendadas = meetings.filter((m) => m.status !== "cancelada").length;
      const realizadas = meetings.filter((m) => m.status === "realizada").length;
      const noShow = meetings.filter((m) => m.status === "no_show").length;
      const decididas = realizadas + noShow;
      // Meta MENSAL de reuniões por dono (vigente + dono ativo, mais recente).
      const goalByOwner: Record<string, number> = {};
      const sdrOwners = new Set<string>();
      ((mGoalRes.data ?? []) as any[]).forEach((g) => {
        if (!isGoalEffective(g.period_start)) return; // meta de mês futuro não vigora
        if (g.owner_id == null) return; // meta de equipe não conta na soma dos SDRs
        const ownerRow = Array.isArray(g.owner) ? g.owner[0] : g.owner;
        if (ownerRow && ownerRow.is_active === false) return; // dono desativado
        if (g.owner_id in goalByOwner) return; // mais recente por owner (query ordena desc)
        goalByOwner[g.owner_id] = Number(g.target_value) || 0;
        if (ownerRow && ownerRow.role === "sdr") sdrOwners.add(g.owner_id);
      });
      setMeetingGoalByOwner(goalByOwner);

      const DEF = META_DEFAULTS.reunioes;
      let meta: number;
      if (ownerId) {
        // Um SDR/usuário específico: a meta dele (ou o padrão se não tiver).
        meta = goalByOwner[ownerId] ?? DEF;
      } else if (activeSdrCount > 0) {
        // Admin / "todos": soma de TODOS os SDRs ativos; quem não tem meta
        // cadastrada entra com o padrão ("N SDRs × meta").
        const sumSdr = [...sdrOwners].reduce((acc, id) => acc + (goalByOwner[id] || 0), 0);
        const fill = Math.max(0, activeSdrCount - sdrOwners.size) * DEF;
        meta = sumSdr + fill;
      } else {
        // Boot (lista de SDRs ainda não chegou): soma o que houver, ou o padrão.
        const sumAll = Object.values(goalByOwner).reduce((a, b) => a + b, 0);
        meta = sumAll || DEF;
      }
      setMeetingKpis({
        agendadas, realizadas, noShow,
        showRate: decididas > 0 ? (realizadas / decididas) * 100 : null,
        meta,
      });

      // Pipeline / receita
      const sum = (rows: any[], pick: (r: any) => number) =>
        rows.reduce((acc, r) => acc + (pick(r) || 0), 0);
      setPipelineOpen(sum(pipeRows, (r) => Number(r.estimated_value)));
      setRevenueWon(sum(wonRows, (r) => Number(r.closed_value ?? r.estimated_value)));

      // Fonte
      const srcMap = new Map<string, { total: number; ganhos: number }>();
      srcRows.forEach((r) => {
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

      setErrBusiness(null);
    } catch (error) {
      console.warn("Erro ao carregar KPIs de negócio:", error);
      setErrBusiness("Não foi possível carregar reuniões, pipeline e conversão por fonte.");
    } finally {
      setLoadingBusiness(false);
    }
  }, [selectedUser, selectedPeriod, customStart, customEnd, activeSdrCount]);

  useEffect(() => {
    loadBusinessKpis();
  }, [loadBusinessKpis]);

  // ── Onda 4: Minha fila (Visão do SDR) ──────────────────────────────────────
  // Reaproveita a lógica do CadenceHealthPanel escopada ao próprio SDR: a
  // atividade ATUAL de cada lead (menor scheduled_at) define o FUP; venceu antes
  // de hoje 00:00 = atrasada. Também separa leads QUENTES sem 1º contato
  // (status "nao_iniciado" = nunca contatado) para a priorização.
  const loadMyQueue = useCallback(async (silent = false) => {
    if (!currentUser || isManager) return; // seção exclusiva do papel operacional
    if (!silent) setLoadingQueue(true);
    try {
      const own = currentUser.id;
      const [tasks, leads] = await Promise.all([
        // Paginado (cap 1000 do PostgREST): fila cheia não pode "parar de contar".
        fetchAllRows<{ lead_id: string; owner_id: string | null; scheduled_at: string; channel_type: string | null }>((f, t) =>
          supabase
            .from("qs_tasks")
            .select("lead_id, owner_id, scheduled_at, channel_type")
            .in("status", ["pendente", "atrasada"])
            .eq("owner_id", own)
            .order("id")
            .range(f, t)
        ),
        fetchAllRows<any>((f, t) =>
          supabase
            .from("qs_leads")
            .select("id, full_name, first_name, last_name, status, arrived_at, created_at, lead_score, owner_id")
            .eq("owner_id", own)
            .order("id")
            .range(f, t)
        ),
      ]);

      const leadsById = new Map(leads.map((l: any) => [l.id, l]));
      const today0 = dayStartMs(new Date());

      // Uma tarefa por lead: a ATUAL = a de menor scheduled_at (vence antes).
      const currentByLead = new Map<string, any>();
      for (const t of tasks) {
        const lead = leadsById.get(t.lead_id);
        if (!lead || lead.status === "ganho" || lead.status === "perdido") continue;
        const prev = currentByLead.get(t.lead_id);
        if (!prev || new Date(t.scheduled_at).getTime() < new Date(prev.scheduled_at).getTime()) currentByLead.set(t.lead_id, t);
      }

      const built: QueueStage[] = [];
      for (const [leadId, t] of currentByLead) {
        const lead = leadsById.get(leadId);
        const base = lead.arrived_at || lead.created_at;
        let fupDay = 1;
        if (base) fupDay = Math.max(1, Math.round((dayStartMs(new Date(t.scheduled_at)) - dayStartMs(new Date(base))) / 86400000) + 1);
        const sched0 = dayStartMs(new Date(t.scheduled_at));
        const overdue = sched0 < today0;
        built.push({
          leadId,
          ownerId: t.owner_id ?? lead.owner_id ?? null,
          leadName: leadDisplayName(lead),
          fupDay,
          overdue,
          daysOverdue: overdue ? Math.round((today0 - sched0) / 86400000) : 0,
          channel: t.channel_type ?? null,
        });
      }

      const hots: HotLead[] = leads
        .filter((l: any) => l.status === "nao_iniciado" && /quente/i.test(String(l.lead_score ?? "")))
        .map((l: any) => ({ id: l.id, name: leadDisplayName(l), arrivedAt: l.arrived_at ?? null }))
        .sort((a: HotLead, b: HotLead) => String(b.arrivedAt ?? "").localeCompare(String(a.arrivedAt ?? "")));

      setMyStages(built);
      setHotLeads(hots);
      setErrQueue(null);
    } catch (e) {
      console.warn("Erro ao carregar minha fila:", e);
      setErrQueue("Não foi possível carregar sua fila.");
    } finally {
      setLoadingQueue(false);
    }
  }, [currentUser, isManager]);

  useEffect(() => {
    loadMyQueue();
  }, [loadMyQueue]);

  // ── Onda 4: Visão do time (saúde da fila + comparativo por SDR + zumbis) ────
  // Time inteiro (ignora o seletor de drill-down, que só afeta o placar/fontes):
  // são visões de comparação/exceção. Só roda para gestor/admin.
  const loadTeamOps = useCallback(async (silent = false) => {
    if (!isManager) return;
    if (!silent) setLoadingTeam(true);
    try {
      // Tudo paginado (cap 1000 do PostgREST) — base do time passa de 1000 fácil.
      const [leads, openTasks, doneTasks, meets, usersRes] = await Promise.all([
        fetchAllRows<any>((f, t) =>
          supabase.from("qs_leads").select("id, full_name, first_name, last_name, owner_id, status, arrived_at, created_at").order("id").range(f, t)
        ),
        fetchAllRows<{ lead_id: string; owner_id: string | null; scheduled_at: string }>((f, t) =>
          supabase.from("qs_tasks").select("lead_id, owner_id, scheduled_at").in("status", ["pendente", "atrasada"]).order("id").range(f, t)
        ),
        fetchAllRows<{ lead_id: string; owner_id: string | null }>((f, t) =>
          supabase.from("qs_tasks").select("lead_id, owner_id").eq("status", "concluida").order("id").range(f, t)
        ),
        fetchAllRows<{ lead_id: string; owner_id: string | null }>((f, t) =>
          supabase.from("qs_meetings").select("lead_id, owner_id").neq("status", "cancelada").order("id").range(f, t)
        ),
        supabase.from("qs_users").select("id, name").eq("is_active", true).in("role", ["sdr", "closer", "gestor"]).order("name"),
      ]);
      if (usersRes.error) throw usersRes.error;
      const users = (usersRes.data ?? []) as { id: string; name: string }[];
      const leadsById = new Map(leads.map((l: any) => [l.id, l]));
      const today0 = dayStartMs(new Date());

      // Saúde da operação: FUP atual de cada lead aberto do time.
      const currentByLead = new Map<string, any>();
      for (const t of openTasks) {
        const lead = leadsById.get(t.lead_id);
        if (!lead || lead.status === "ganho" || lead.status === "perdido") continue;
        const prev = currentByLead.get(t.lead_id);
        if (!prev || new Date(t.scheduled_at).getTime() < new Date(prev.scheduled_at).getTime()) currentByLead.set(t.lead_id, t);
      }
      const stages: QueueStage[] = [];
      const lateByOwner = new Map<string, number>();
      const backlogByOwner = new Map<string, number>();
      for (const [leadId, t] of currentByLead) {
        const lead = leadsById.get(leadId);
        const base = lead.arrived_at || lead.created_at;
        let fupDay = 1;
        if (base) fupDay = Math.max(1, Math.round((dayStartMs(new Date(t.scheduled_at)) - dayStartMs(new Date(base))) / 86400000) + 1);
        const sched0 = dayStartMs(new Date(t.scheduled_at));
        const overdue = sched0 < today0;
        const dOver = overdue ? Math.round((today0 - sched0) / 86400000) : 0;
        const owner = t.owner_id ?? lead.owner_id ?? null;
        stages.push({ leadId, ownerId: owner, leadName: leadDisplayName(lead), fupDay, overdue, daysOverdue: dOver, channel: null });
        if (owner && overdue) {
          lateByOwner.set(owner, (lateByOwner.get(owner) ?? 0) + 1);
          backlogByOwner.set(owner, Math.max(backlogByOwner.get(owner) ?? 0, dOver));
        }
      }
      setTeamStages(stages);

      // Comparativo por SDR (foto da carteira): Leads / Contatados / Reunião /
      // Ganho / Conv. (ganho ÷ finalizados) + Atrasadas / Backlog (da fila).
      const doneLeadIds = new Set<string>();
      doneTasks.forEach((t) => doneLeadIds.add(t.lead_id));
      const meetLeadIds = new Set<string>();
      meets.forEach((m) => meetLeadIds.add(m.lead_id));
      const perOwner = new Map<string, { leads: number; contatados: number; reuniao: number; ganho: number; finalizados: number }>();
      const ensure = (id: string) => {
        let r = perOwner.get(id);
        if (!r) { r = { leads: 0, contatados: 0, reuniao: 0, ganho: 0, finalizados: 0 }; perOwner.set(id, r); }
        return r;
      };
      for (const l of leads as any[]) {
        if (!l.owner_id) continue;
        const r = ensure(l.owner_id);
        r.leads++;
        // Contatado = status já saiu de "não iniciado" OU tem alguma atividade concluída.
        if (l.status !== "nao_iniciado" || doneLeadIds.has(l.id)) r.contatados++;
        if (meetLeadIds.has(l.id)) r.reuniao++;
        if (l.status === "ganho") { r.ganho++; r.finalizados++; }
        else if (l.status === "perdido") r.finalizados++;
      }
      const rows: ComparativoRow[] = users
        .map((u) => {
          const r = perOwner.get(u.id) ?? { leads: 0, contatados: 0, reuniao: 0, ganho: 0, finalizados: 0 };
          return {
            id: u.id, name: u.name,
            leads: r.leads, contatados: r.contatados, reuniao: r.reuniao, ganho: r.ganho,
            conv: r.finalizados > 0 ? (r.ganho / r.finalizados) * 100 : 0,
            atrasadas: lateByOwner.get(u.id) ?? 0,
            backlogDias: backlogByOwner.get(u.id) ?? 0,
          };
        })
        .sort((a, b) => b.reuniao - a.reuniao || b.ganho - a.ganho);
      setComparativoRows(rows);

      // Atividade parada sem contato ("zumbis"): lead aberto, SEM 1º contato
      // (nenhuma tarefa concluída) e cuja atividade aberta mais recente está
      // parada há 3+ dias — ou que nem tem tarefa aberta (fora de qualquer fila).
      const latestOpenByLead = new Map<string, number>();
      for (const t of openTasks) {
        const ms = new Date(t.scheduled_at).getTime();
        const prev = latestOpenByLead.get(t.lead_id);
        if (prev === undefined || ms > prev) latestOpenByLead.set(t.lead_id, ms);
      }
      const staleBefore = today0 - 3 * 86400000;
      const zByOwner = new Map<string, number>();
      let zTotal = 0;
      for (const l of leads as any[]) {
        if (l.status !== "nao_iniciado" && l.status !== "em_prospeccao") continue;
        if (doneLeadIds.has(l.id)) continue; // já teve 1º contato → não é zumbi
        const latestOpen = latestOpenByLead.get(l.id);
        const stalled = latestOpen === undefined || latestOpen < staleBefore;
        if (!stalled) continue;
        zTotal++;
        const k = l.owner_id ?? "—";
        zByOwner.set(k, (zByOwner.get(k) ?? 0) + 1);
      }
      const nameById = new Map(users.map((u) => [u.id, u.name] as const));
      const zRows = [...zByOwner.entries()]
        .map(([id, count]) => ({ name: id === "—" ? "Sem dono" : (nameById.get(id) ?? "Sem dono"), count }))
        .sort((a, b) => b.count - a.count);
      setZombies({ total: zTotal, bySdr: zRows });

      setErrTeam(null);
    } catch (e) {
      console.warn("Erro ao carregar visão do time:", e);
      setErrTeam("Não foi possível carregar a visão do time (saúde da fila, comparativo e alertas).");
    } finally {
      setLoadingTeam(false);
    }
  }, [isManager]);

  useEffect(() => {
    loadTeamOps();
  }, [loadTeamOps]);

  // ── Auto-refresh (item P2): a TV do time congelava até alguém dar F5. A cada
  // 60s, com a aba VISÍVEL (guard de document.hidden — mesmo padrão do
  // CoveragePanel), recarrega tudo em modo silencioso (sem piscar "Carregando").
  // As buscas de detalhamento (canal/heatmap/speed/funil/motivos) e o refreshTick
  // só rodam para o gestor — o SDR não vê essas seções.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      loadKpis(true);
      loadOperationalKpis(true);
      loadBusinessKpis(true);
      loadMyQueue(true);
      loadTeamOps(true);
      if (isManager) {
        loadChannelPerformance(true);
        loadHeatmap(true);
        loadSpeedToLead(true);
        loadFunnel(true);
        setRefreshTick((t) => t + 1); // LossReasonsChart escuta este tick
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [loadKpis, loadChannelPerformance, loadHeatmap, loadSpeedToLead, loadOperationalKpis, loadFunnel, loadBusinessKpis, loadMyQueue, loadTeamOps, isManager]);

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
              {currentUser && (
                <span className="ml-2 align-middle inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-gray-100 text-gray-500">
                  {isManager ? "Visão do Gestor · equipe inteira" : "Visão do SDR · só os seus números"}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          {/* Selecionar usuário — drill-down por SDR. Só para o gestor: o SDR
              enxerga apenas o próprio (selectedUser é forçado ao id dele). */}
          {isManager && (
            <>
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
            </>
          )}

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

      {/* ═══════════════════ VISÃO DO SDR (não-gestor) ═══════════════════ */}
      {currentUser && !isManager && (() => {
        const atividadesCard = kpiCards.find((c) => c.type === "atividades");
        const conversaoCard = kpiCards.find((c) => c.type === "conversao");
        const conversaoValue = conversaoCard ? conversaoCard.value.replace("%", "") : "—";
        const myOverdue = myStages.filter((s) => s.overdue).length;
        const metaPct = meetingKpis && meetingKpis.meta > 0 ? (meetingKpis.agendadas / meetingKpis.meta) * 100 : null;
        // Meta de reuniões POR DIA (meta mensal ÷ dias úteis do mês).
        const myMeetMeta = meetingKpis?.meta ?? 0;
        const myDaily = meetingDaily(myMeetMeta);
        // Priorização: atrasados (mais dias parado no topo) + quentes sem 1º contato.
        const overdueItems = [...myStages]
          .filter((s) => s.overdue)
          .sort((a, b) => b.daysOverdue - a.daysOverdue)
          .slice(0, 6)
          .map((s) => ({
            key: s.leadId,
            name: s.leadName,
            meta: `${channelLabel(s.channel)} · atrasada há ${s.daysOverdue} dia${s.daysOverdue !== 1 ? "s" : ""}`,
            tag: `FUP ${Math.min(5, s.fupDay)}${s.fupDay > 5 ? "+" : ""}`,
            crit: true,
          }));
        const overdueSet = new Set(overdueItems.map((i) => i.key));
        const hotItems = hotLeads
          .filter((h) => !overdueSet.has(h.id))
          .slice(0, 4)
          .map((h) => ({ key: h.id, name: h.name, meta: "Lead quente · sem 1º contato", tag: "FUP 1", crit: false }));
        const prioridade = [...overdueItems, ...hotItems].slice(0, 8);
        return (
          <>
            {/* (1) Meu dia — hero de 4 KPIs */}
            <div>
              <SectionHeading
                title="Meu dia"
                hint="Reuniões por dia = sua meta mensal de reuniões ÷ dias úteis do mês (o ritmo que você precisa manter). A barra mostra o quanto da meta mensal você já agendou. Atividades realizadas = tarefas concluídas no período. Atrasadas = leads cuja atividade atual venceu ANTES de hoje 00:00 (nunca as de hoje). Reuniões agendadas = no período."
              />
              {loadingKpis || loadingBusiness || loadingQueue ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 h-[104px] flex items-center justify-center">
                      <span className="text-sm text-gray-400">Carregando...</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <HeroCard
                    label="Reuniões por dia"
                    dotColor="#0147FF"
                    value={myDaily != null ? <>{myDaily}<span className="text-[15px] font-bold text-gray-400">/dia</span></> : "—"}
                    barPct={metaPct}
                    barColor="#0147FF"
                    sub={
                      myMeetMeta > 0
                        ? `Agende ~${myDaily ?? "—"}/dia útil · meta mensal ${myMeetMeta}${metaPct != null ? ` (${Math.round(metaPct)}%)` : ""}`
                        : "sem meta de reuniões definida"
                    }
                  />
                  <HeroCard
                    label="Atividades realizadas"
                    dotColor="#059669"
                    value={atividadesCard?.value ?? "0"}
                    valueColor="#059669"
                    sub={atividadesCard?.metaLabel ?? "no período"}
                  />
                  <HeroCard
                    label="Atrasadas"
                    dotColor="#DC2626"
                    value={myOverdue}
                    valueColor={myOverdue > 0 ? "#DC2626" : "#141C2B"}
                    sub="venceram antes de hoje"
                  />
                  <HeroCard
                    label="Reuniões agendadas"
                    dotColor="#0147FF"
                    value={meetingKpis?.agendadas ?? 0}
                    sub={`${meetingKpis?.realizadas ?? 0} realizadas · ${meetingKpis?.noShow ?? 0} no-show`}
                  />
                </div>
              )}
            </div>

            {/* (2) Minha fila (FUP) + (3) Minha conversão */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
                <SectionHeading
                  title="Minha fila (FUP)"
                  hint="A fila são seus leads com atividade aberta. FUP N = dia N da cadência (quem não teve 1º contato é FUP 1, não existe mais 'Novo'). A faixa vermelha é a parte atrasada de cada etapa."
                />
                {errQueue ? (
                  <SectionError message={errQueue} onRetry={() => loadMyQueue()} />
                ) : loadingQueue ? (
                  <p className="text-sm text-gray-500 text-center py-4">Carregando...</p>
                ) : (
                  <FupQueue stages={myStages} />
                )}
              </div>
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
                <SectionHeading
                  title="Minha conversão"
                  hint="Connect rate = atividades que conectaram ÷ total (conexão = atendeu/ganho/com_avanço/sem_avanço). Conversão = ganhos ÷ finalizados. Show-rate = reuniões realizadas ÷ (realizadas + no-show). Janela = período selecionado."
                />
                {loadingOperational || loadingBusiness || loadingKpis ? (
                  <p className="text-sm text-gray-500 text-center py-4">Carregando...</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="px-2 py-4">
                      <div className="text-[24px] font-extrabold tabular-nums text-gray-900">
                        {connectRate != null ? connectRate.toFixed(0) : "—"}<span className="text-[14px] text-gray-400 font-bold">%</span>
                      </div>
                      <div className="text-[11.5px] font-medium text-gray-400 mt-1">Connect rate</div>
                    </div>
                    <div className="px-2 py-4 border-x border-gray-100">
                      <div className="text-[24px] font-extrabold tabular-nums" style={{ color: "#059669" }}>
                        {conversaoValue}<span className="text-[14px] text-gray-400 font-bold">%</span>
                      </div>
                      <div className="text-[11.5px] font-medium text-gray-400 mt-1">Conversão</div>
                    </div>
                    <div className="px-2 py-4">
                      <div className="text-[24px] font-extrabold tabular-nums text-gray-900">
                        {meetingKpis?.showRate != null ? meetingKpis.showRate.toFixed(0) : "—"}<span className="text-[14px] text-gray-400 font-bold">%</span>
                      </div>
                      <div className="text-[11.5px] font-medium text-gray-400 mt-1">Show-rate</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* (5) Priorize agora */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
              <SectionHeading
                title="Priorize agora"
                hint="Primeiro os leads atrasados (mais dias parado no topo), depois os leads quentes ainda sem 1º contato. Ordem por urgência."
              />
              {errQueue ? (
                <SectionError message={errQueue} onRetry={() => loadMyQueue()} />
              ) : loadingQueue ? (
                <p className="text-sm text-gray-500 text-center py-4">Carregando...</p>
              ) : prioridade.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Nada urgente agora — sem atrasados nem leads quentes sem contato. Bom trabalho!</p>
              ) : (
                <div className="flex flex-col">
                  {prioridade.map((it) => (
                    <div key={it.key} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                      <span className="w-[3px] self-stretch rounded" style={{ background: it.crit ? "#DC2626" : "#D97706" }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold text-gray-800 truncate">{it.name}</div>
                        <div className="text-[11.5px] font-medium text-gray-400 truncate">{it.meta}</div>
                      </div>
                      <span
                        className="text-[10.5px] font-bold px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: it.crit ? "#FBE3E1" : "#FCEFD6", color: it.crit ? "#D92D20" : "#C77700" }}
                      >
                        {it.tag}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* (4) Meu ritmo — reaproveita a Análise dia a dia (já escopada ao SDR) */}
            <DailyFlowPanel />
          </>
        );
      })()}

      {/* ═══════════════════ VISÃO DO GESTOR — placar do time ═══════════════════ */}
      {isManager && (() => {
        const ganhosCard = kpiCards.find((c) => c.type === "ganhos");
        const crColor = connectRate == null ? "#8792A6" : connectRate > 40 ? "#059669" : connectRate > 20 ? "#C77700" : "#D92D20";
        const topZombie = zombies && zombies.bySdr.length > 0 ? `${zombies.bySdr[0].count} ${zombies.bySdr[0].count > 1 ? "são" : "é"} de ${zombies.bySdr[0].name}.` : "";
        // Total de reuniões/dia do time (soma dos SDRs ÷ dias úteis do mês).
        const teamMeetDaily = meetingDaily(meetingKpis?.meta ?? 0);
        return (
          <>
            {/* (1) Placar da equipe — hero */}
            <div>
              <SectionHeading
                title="Placar da equipe"
                hint="Meta do time = SOMATÓRIA das metas de todos os SDRs ativos (quem não tem meta cadastrada entra com o valor padrão). Reuniões = agendadas por todos no período, com o total de reuniões/dia esperado do time. R$ em jogo = valor estimado dos leads em aberto (foto de agora). Connect rate = conexões ÷ atividades (30 dias / período)."
              />
              {loadingKpis || loadingBusiness || loadingOperational ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="bg-white border border-gray-100 rounded-xl shadow-sm p-4 h-[104px] flex items-center justify-center">
                      <span className="text-sm text-gray-400">Carregando...</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <HeroCard
                    label="Meta do time (ganhos)"
                    dotColor="#0147FF"
                    value={ganhosCard?.value ?? "0"}
                    barPct={ganhosCard?.metaPercent ?? null}
                    sub={ganhosCard?.metaLabel ?? ""}
                  />
                  <HeroCard
                    label="Reuniões do time"
                    dotColor="#0147FF"
                    value={meetingKpis?.agendadas ?? 0}
                    sub={
                      meetingKpis && meetingKpis.meta > 0
                        ? `no período · meta ${meetingKpis.meta}/mês${teamMeetDaily != null ? ` (~${teamMeetDaily}/dia, ${activeSdrCount} SDR${activeSdrCount !== 1 ? "s" : ""})` : ""}`
                        : "no período"
                    }
                  />
                  <HeroCard
                    label="R$ em jogo"
                    dotColor="#059669"
                    value={fmtBRL.format(pipelineOpen ?? 0)}
                    valueColor="#059669"
                    sub="pipeline em aberto"
                  />
                  <HeroCard
                    label="Connect rate médio"
                    dotColor="#C77700"
                    value={<>{connectRate != null ? connectRate.toFixed(0) : "—"}<span className="text-[15px] font-bold text-gray-400">%</span></>}
                    valueColor={crColor}
                    sub="time · período selecionado"
                  />
                </div>
              )}
            </div>

            {/* (2) Ranking + Saúde da operação */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
              <RankingPanel />
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
                <SectionHeading
                  title="Saúde da operação"
                  hint="Fila total do time por etapa FUP + a parcela atrasada (vermelho). É o estoque de trabalho vivo, time inteiro (não muda com o seletor de SDR)."
                />
                {errTeam ? (
                  <SectionError message={errTeam} onRetry={() => loadTeamOps()} />
                ) : loadingTeam ? (
                  <p className="text-sm text-gray-500 text-center py-4">Carregando...</p>
                ) : (
                  <FupQueue stages={teamStages} note="Maior estoque no topo do funil = onde priorizar reforço." />
                )}
              </div>
            </div>

            {/* (3) Comparativo por SDR */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
              <SectionHeading
                title="Comparativo por SDR"
                hint="Foto da carteira de cada SDR: Leads = total da carteira; Contatados = saíram de 'não iniciado' ou têm atividade concluída; Reunião = têm reunião não-cancelada; Ganho = status ganho; Conv. = ganho ÷ finalizados; Atrasadas/Backlog = da fila atual (atividade vencida)."
              />
              {errTeam ? (
                <SectionError message={errTeam} onRetry={() => loadTeamOps()} />
              ) : loadingTeam ? (
                <p className="text-sm text-gray-500 text-center py-4">Carregando...</p>
              ) : comparativoRows.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Nenhum SDR ativo encontrado.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">SDR</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">Leads</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">Contatados</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">Reunião</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">Ganho</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">Conv.</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">Atrasadas</th>
                        <th className="text-right py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400">Backlog</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparativoRows.map((r) => (
                        <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="py-2.5 px-3 text-[13px] font-bold text-gray-800">{r.name}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-gray-600">{r.leads}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-gray-600">{r.contatados}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-gray-600">{r.reuniao}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-gray-600">{r.ganho}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold" style={{ color: r.conv >= 10 ? "#059669" : "#47536A" }}>{r.conv.toFixed(0)}%</td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold" style={{ color: r.atrasadas > 0 ? "#D92D20" : "#8792A6" }}>{r.atrasadas}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums" style={{ color: r.backlogDias >= 3 ? "#D92D20" : "#8792A6" }}>{r.backlogDias > 0 ? `${r.backlogDias}d` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* (4) Atividade parada sem contato (zumbis) — bloco de ALERTA */}
            <div>
              <SectionHeading
                title="Atenção da gestão — atividade parada sem contato"
                hint="Leads em aberto (não iniciado / em prospecção) SEM nenhuma atividade concluída (nunca contatados) cuja atividade aberta mais recente está parada há 3+ dias — ou que nem têm tarefa aberta (fora de qualquer fila). Some por SDR. Só aparece para gestor/admin."
              />
              {errTeam ? (
                <SectionError message={errTeam} onRetry={() => loadTeamOps()} />
              ) : loadingTeam ? (
                <p className="text-sm text-gray-500 text-center py-4">Carregando...</p>
              ) : !zombies || zombies.total === 0 ? (
                <div className="rounded-xl border p-4 flex items-center gap-3" style={{ background: "#E1F5F0", borderColor: "#0E9F8640" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E9F86" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  <p className="text-sm font-semibold text-gray-600">Nenhum lead parado sem contato há 3+ dias. Operação limpa.</p>
                </div>
              ) : (
                <div className="rounded-xl border p-4 flex gap-3 items-start" style={{ background: "#FBE3E1", borderColor: "#D92D2040" }}>
                  <svg className="shrink-0" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#D92D20" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-gray-700 leading-relaxed">
                      <b style={{ color: "#D92D20" }}>{zombies.total} lead{zombies.total > 1 ? "s" : ""} parado{zombies.total > 1 ? "s" : ""} sem nenhum contato</b> há 3+ dias — fora da fila de qualquer SDR (zumbis). {topZombie}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {zombies.bySdr.map((z) => (
                        <span key={z.name} className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-white/70 text-gray-600 border border-red-100">
                          {z.name}: {z.count}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* (5) Fontes & Receita — recap (o detalhamento completo fica abaixo) */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
              <SectionHeading
                title="Fontes & Receita"
                hint="Receita ganha = valor fechado (ou estimado) dos ganhos no período. Pipeline = valor estimado dos leads em aberto. Show-rate = reuniões realizadas ÷ decididas. Top fontes = leads criados no período que mais convertem (ganho ÷ leads da fonte)."
              />
              {errBusiness ? (
                <SectionError message={errBusiness} onRetry={() => loadBusinessKpis()} />
              ) : loadingBusiness ? (
                <p className="text-sm text-gray-500 text-center py-4">Carregando...</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                    <div className="px-2 py-3">
                      <div className="text-[20px] font-extrabold tabular-nums" style={{ color: "#059669" }}>{fmtBRL.format(revenueWon ?? 0)}</div>
                      <div className="text-[11.5px] font-medium text-gray-400 mt-1">Receita ganha</div>
                    </div>
                    <div className="px-2 py-3 border-x border-gray-100">
                      <div className="text-[20px] font-extrabold tabular-nums text-gray-900">{fmtBRL.format(pipelineOpen ?? 0)}</div>
                      <div className="text-[11.5px] font-medium text-gray-400 mt-1">Pipeline em aberto</div>
                    </div>
                    <div className="px-2 py-3">
                      <div className="text-[20px] font-extrabold tabular-nums text-gray-900">{meetingKpis?.showRate != null ? `${meetingKpis.showRate.toFixed(0)}%` : "—"}</div>
                      <div className="text-[11.5px] font-medium text-gray-400 mt-1">Show-rate</div>
                    </div>
                  </div>
                  {sourceRows.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-2">Nenhum lead criado no período.</p>
                  ) : (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Top fontes por conversão</p>
                      {[...sourceRows].sort((a, b) => b.taxa - a.taxa || b.total - a.total).slice(0, 5).map((s) => {
                        const maxTaxa = Math.max(1, ...sourceRows.map((r) => r.taxa));
                        return (
                          <div key={s.source} className="grid items-center gap-3 py-1" style={{ gridTemplateColumns: "120px 1fr 90px" }}>
                            <span className="text-[11.5px] font-semibold text-gray-500 truncate">{s.source}</span>
                            <div className="h-4 rounded bg-[#E1F5F0] overflow-hidden">
                              <div className="h-full rounded" style={{ width: `${(s.taxa / maxTaxa) * 100}%`, background: "#0E9F86" }} />
                            </div>
                            <span className="text-[11.5px] font-bold text-right tabular-nums text-gray-700">{s.taxa.toFixed(0)}% · {s.ganhos}/{s.total}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        );
      })()}

      {/* ═══════════ DETALHAMENTO (gestor) — seções analíticas completas ═══════════ */}
      {isManager && (<>
      <div className="pt-2">
        <h2 className="text-sm font-bold text-gray-800">Detalhamento</h2>
        <p className="text-xs text-gray-400 mt-0.5">Séries históricas, canais, horários, funil e motivos de perda — a camada analítica completa da operação.</p>
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
        {errKpis ? (
          <SectionError message={errKpis} onRetry={() => loadKpis()} />
        ) : loadingKpis ? (
          <p className="text-sm text-gray-500 text-center py-8">Carregando...</p>
        ) : (
          <AreaChart realData={realData} predictedData={predictedData} />
        )}
      </div>

      {/* KPI Cards + Speed-to-Lead */}
      {errKpis ? (
        <SectionError message="Não foi possível carregar os cards de indicadores." onRetry={() => loadKpis()} />
      ) : loadingKpis ? (
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
          {errSpeed ? (
            <div className="bg-white border border-red-200 rounded-xl shadow-none p-5 flex flex-col gap-2">
              <span className="text-xs text-gray-500">Tempo Médio de Contato</span>
              <span className="text-sm text-red-600">{errSpeed}</span>
              <button
                onClick={() => loadSpeedToLead()}
                className="self-start text-xs font-semibold text-red-700 border border-red-300 rounded-lg px-3 py-1.5 hover:bg-red-50 transition-colors"
              >
                Tentar de novo
              </button>
            </div>
          ) : (
            <SpeedToLeadCard avgMinutes={speedToLead} loading={loadingSpeed} />
          )}
        </div>
      )}

      {/* Indicadores Operacionais */}
      <div>
        <h2 className="text-sm font-medium text-gray-700 mb-3">Indicadores Operacionais</h2>
        {errOperational ? (
          <SectionError message={errOperational} onRetry={() => loadOperationalKpis()} />
        ) : loadingOperational ? (
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

            {/* 5. Reuniões por SDR + meta/dia (derivada da meta mensal ÷ dias úteis) */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5 flex flex-col gap-2">
              <span className="text-xs text-gray-500 uppercase">Reuniões por SDR</span>
              <span className="text-[11px] text-gray-400 -mt-1">
                Reuniões = agendadas no período. Meta/dia = meta mensal de reuniões ÷ {workdaysMonth || "—"} dias úteis do mês.
              </span>
              {meetingRows.length === 0 ? (
                <span className="text-sm text-gray-400">Sem dados</span>
              ) : (
                <div className="overflow-x-auto mt-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-1.5 text-[11px] font-semibold text-gray-500 uppercase">SDR</th>
                        <th className="text-center py-1.5 text-[11px] font-semibold text-gray-500 uppercase">Reuniões</th>
                        <th className="text-center py-1.5 text-[11px] font-semibold text-gray-500 uppercase">Meta/dia</th>
                        <th className="text-center py-1.5 text-[11px] font-semibold text-gray-500 uppercase">Meta/mês</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meetingRows.map((row) => (
                        <tr key={row.id} className="border-b border-gray-50">
                          <td className="py-1.5 text-xs font-medium text-gray-900 truncate max-w-[140px]">{row.name}</td>
                          <td className="py-1.5 text-center text-xs font-bold text-gray-700">{row.count}</td>
                          <td className="py-1.5 text-center text-xs font-bold" style={{ color: "#0147FF" }}>{row.daily ?? "—"}</td>
                          <td className="py-1.5 text-center text-xs text-gray-400">{row.monthly}</td>
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
        {errFunnel ? (
          <SectionError message={errFunnel} onRetry={() => loadFunnel()} />
        ) : loadingFunnel ? (
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
        {errBusiness ? (
          <SectionError message={errBusiness} onRetry={() => loadBusinessKpis()} />
        ) : loadingBusiness ? (
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
        {errBusiness ? (
          <SectionError message={errBusiness} onRetry={() => loadBusinessKpis()} />
        ) : loadingBusiness ? (
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
        {errChannels ? (
          <SectionError message={errChannels} onRetry={() => loadChannelPerformance()} />
        ) : (
          <ChannelPerformanceTable data={channelPerformance} loading={loadingChannels} />
        )}
      </div>

      {/* Heatmap (Change 19) */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-none p-5">
        <h2 className="text-sm font-medium text-gray-700 mb-4">
          Melhores Horários de Contato
        </h2>
        {errHeatmap ? (
          <SectionError message={errHeatmap} onRetry={() => loadHeatmap()} />
        ) : (
          <ContactHeatmap cells={heatmapCells} loading={loadingHeatmap} />
        )}
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
          refreshTick={refreshTick}
        />
      </div>

      {/* Análise dia a dia (leads que chegaram / agendamentos por dia) */}
      <DailyFlowPanel />
      </>)}
    </div>
  );
}
