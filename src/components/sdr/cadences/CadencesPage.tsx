// src/components/sdr/cadences/CadencesPage.tsx
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type {
  Cadence,
  CadenceDay,
  AcquisitionChannel,
  CadenceStatus,
  PriorityLevel,
  CadenceObjective,
  ChannelType,
} from "../types";
import {
  ACQUISITION_LABELS,
  CADENCE_STATUS_LABELS,
  PRIORITY_LABELS,
  OBJECTIVE_LABELS,
  CHANNEL_LABELS,
  WEEKDAY_LABELS,
} from "../types";

// ── Props ───────────────────────────────────────────────────────────────────

interface CadencesPageProps {
  onCreateCadence: () => void;
  onEditCadence: (cadenceId: string) => void;
}

// ── Inline SVG Icons ────────────────────────────────────────────────────────

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconSnowflake() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function ChannelIcon({ type, size = 14 }: { type: ChannelType; size?: number }) {
  const s = size;
  switch (type) {
    case "pesquisa":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case "email":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      );
    case "ligacao":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
    case "ligacao_whatsapp":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z" />
          <path d="M14.7 13.4c-.25-.13-1.02-.5-1.18-.56-.16-.06-.27-.09-.39.09-.11.17-.44.55-.54.66-.1.12-.2.13-.37.05-.17-.09-.72-.27-1.37-.85-.5-.45-.85-1.01-.95-1.18-.1-.17-.01-.26.08-.35.08-.08.17-.2.26-.3.09-.11.11-.18.17-.3.06-.11.03-.21-.01-.3-.05-.09-.39-.93-.53-1.28-.14-.33-.28-.29-.39-.29h-.33c-.11 0-.3.04-.45.21-.16.17-.6.58-.6 1.42s.61 1.65.7 1.76c.09.12 1.2 1.84 2.92 2.58.41.18.72.28.97.36.41.13.78.11 1.07.07.33-.05 1.02-.42 1.16-.82.14-.4.14-.74.1-.82-.04-.07-.15-.11-.32-.19z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      );
  }
}

// ── Color Maps ──────────────────────────────────────────────────────────────

const ACQUISITION_COLORS: Record<AcquisitionChannel, { bg: string; text: string; border: string }> = {
  levantada_de_mao: { bg: "#ECFDF5", text: "#065F46", border: "#A7F3D0" },
  resgate: { bg: "#FFF7ED", text: "#9A3412", border: "#FED7AA" },
  indicacao: { bg: "#F5F3FF", text: "#5B21B6", border: "#DDD6FE" },
  outbound: { bg: "#EFF6FF", text: "#1E40AF", border: "#BFDBFE" },
};

const STATUS_COLORS: Record<CadenceStatus, { bg: string; text: string }> = {
  rascunho: { bg: "#F3F4F6", text: "#4B5563" },
  disponivel: { bg: "#ECFDF5", text: "#065F46" },
  congelada: { bg: "#EFF6FF", text: "#1E40AF" },
};

const PRIORITY_COLORS: Record<PriorityLevel, { bg: string; text: string }> = {
  alta: { bg: "#FEF2F2", text: "#991B1B" },
  media: { bg: "#FFF7ED", text: "#9A3412" },
  baixa: { bg: "#F0FDF4", text: "#166534" },
};

const CHANNEL_COLORS: Record<ChannelType, string> = {
  pesquisa: "#6366F1",
  email: "#0EA5E9",
  ligacao: "#F59E0B",
  ligacao_whatsapp: "#12A18A",
  whatsapp: "#22C55E",
  linkedin: "#0A66C2",
  instagram: "#E1306C",
  tiktok: "#010101",
  youtube: "#FF0000",
};

// ── Component ───────────────────────────────────────────────────────────────

export default function CadencesPage({ onCreateCadence, onEditCadence }: CadencesPageProps) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<CadenceStatus | "todos">("todos");
  const [filterChannel, setFilterChannel] = useState<AcquisitionChannel | "todos">("todos");
  const [filterPriority, setFilterPriority] = useState<PriorityLevel | "todos">("todos");
  const [filterObjective, setFilterObjective] = useState<CadenceObjective | "todos">("todos");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [cadences, setCadences] = useState<Cadence[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadCadences = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("qs_cadences")
      .select("*, days:qs_cadence_days(*, activities:qs_cadence_activities(*)), owners:qs_cadence_owners(*, user:qs_users(*))")
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("Erro ao buscar cadences:", error);
      setLoading(false);
      return;
    }

    // Contagem real de leads por cadência: uma única query, agregada no cliente
    // (evita N queries head:true e não estoura performance com muitas cadências).
    const { data: leadRows, error: leadErr } = await supabase
      .from("qs_leads")
      .select("cadence_id, status")
      .not("cadence_id", "is", null);
    if (leadErr) console.warn("Erro ao contar leads das cadências:", leadErr);

    const totalMap = new Map<string, number>();
    const activeMap = new Map<string, number>();
    ((leadRows as { cadence_id: string | null; status: string }[]) ?? []).forEach((r) => {
      if (!r.cadence_id) return;
      totalMap.set(r.cadence_id, (totalMap.get(r.cadence_id) ?? 0) + 1);
      if (r.status === "em_prospeccao") {
        activeMap.set(r.cadence_id, (activeMap.get(r.cadence_id) ?? 0) + 1);
      }
    });

    const withCounts = ((data as Cadence[]) ?? []).map((c) => ({
      ...c,
      _leads_count: totalMap.get(c.id) ?? 0,
      _active_leads_count: activeMap.get(c.id) ?? 0,
    }));
    setCadences(withCounts);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCadences();
  }, [loadCadences]);

  // Congelar / Retomar em massa nas cadências selecionadas.
  async function bulkSetCadenceStatus(status: CadenceStatus) {
    if (selectedIds.size === 0) return;
    setActionError(null);
    const ids = Array.from(selectedIds);
    const { error } = await supabase
      .from("qs_cadences")
      .update({ status })
      .in("id", ids);
    if (error) {
      console.warn("Erro ao atualizar status das cadências:", error);
      setActionError("Não foi possível atualizar as cadências selecionadas. Tente novamente.");
      return;
    }
    setSelectedIds(new Set());
    await loadCadences();
  }

  // Filter cadences
  const filtered = cadences.filter((c) => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !(c.description || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (filterStatus !== "todos" && c.status !== filterStatus) return false;
    if (filterChannel !== "todos" && c.acquisition_channel !== filterChannel) return false;
    if (filterPriority !== "todos" && c.priority !== filterPriority) return false;
    if (filterObjective !== "todos" && c.objective !== filterObjective) return false;
    return true;
  });

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((c) => c.id)));
    }
  }

  // Build visual timeline for a cadence
  function renderTimeline(days: CadenceDay[]) {
    if (!days || days.length === 0) return <span className="text-xs text-gray-400">Sem atividades</span>;

    const maxDay = Math.max(...days.map((d) => d.day_number));

    return (
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {days.map((day, idx) => {
          const activities = day.activities || [];
          return (
            <div key={day.id} className="flex items-center gap-1.5">
              {idx > 0 && (
                <div className="flex items-center">
                  <div className="h-px bg-gray-300" style={{ width: Math.min((day.day_number - days[idx - 1].day_number - 1) * 8 + 16, 48) }} />
                </div>
              )}
              <div className="flex flex-col items-center gap-1 min-w-[40px]">
                <span className="text-[10px] font-semibold text-gray-500">Dia {day.day_number}</span>
                <div className="flex items-center gap-0.5">
                  {activities.map((act) => (
                    <div
                      key={act.id}
                      className="w-6 h-6 rounded-md flex items-center justify-center"
                      style={{ background: (CHANNEL_COLORS[act.channel_type] ?? "#999") + "18", color: CHANNEL_COLORS[act.channel_type] ?? "#999" }}
                      title={`${CHANNEL_LABELS[act.channel_type]} ${act.scheduled_time || ""}`}
                    >
                      <ChannelIcon type={act.channel_type} size={12} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        <div className="ml-2 text-[10px] text-gray-400 font-medium whitespace-nowrap">{maxDay} dias</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-4 md:px-6 py-6 max-w-[1400px] mx-auto flex items-center justify-center min-h-[400px]" style={{ fontFamily: "inherit" }}>
        <p className="text-sm text-gray-500">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-6 py-6 max-w-[1400px] mx-auto" style={{ fontFamily: "inherit" }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Banco de Cadências</h1>
          <p className="text-sm text-gray-500 mt-0.5">{cadences.length} cadências cadastradas</p>
        </div>
        <button
          onClick={onCreateCadence}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#0147FF] hover:bg-[#0139D6] transition-colors"
        >
          <IconPlus />
          Criar Cadência
        </button>
      </div>

      {/* ── Search ────────────────────────────────────────────────────── */}
      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          <IconSearch />
        </span>
        <input
          type="text"
          placeholder="Buscar cadência por nome ou descrição..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:border-[#0147FF] focus:ring-2 focus:ring-[#0147FF]/10 transition"
        />
      </div>

      {/* ── Filter Pills ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {/* Status pills */}
        <button
          onClick={() => setFilterStatus("todos")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            filterStatus === "todos" ? "bg-[#0147FF] text-white" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
          }`}
        >
          Todos
        </button>
        {(Object.keys(CADENCE_STATUS_LABELS) as CadenceStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(filterStatus === s ? "todos" : s)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filterStatus === s ? "bg-[#0147FF] text-white" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {CADENCE_STATUS_LABELS[s]}
          </button>
        ))}

        <span className="w-px h-5 bg-gray-200" />

        {/* Channel, Priority, Objective selects */}
        <select
          value={filterChannel}
          onChange={(e) => setFilterChannel(e.target.value as AcquisitionChannel | "todos")}
          className="rounded-full px-3 py-1.5 text-xs border border-gray-200 bg-white text-gray-700 focus:outline-none"
        >
          <option value="todos">Canal: Todos</option>
          {(Object.keys(ACQUISITION_LABELS) as AcquisitionChannel[]).map((ch) => (
            <option key={ch} value={ch}>{ACQUISITION_LABELS[ch]}</option>
          ))}
        </select>

        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value as PriorityLevel | "todos")}
          className="rounded-full px-3 py-1.5 text-xs border border-gray-200 bg-white text-gray-700 focus:outline-none"
        >
          <option value="todos">Prioridade: Todas</option>
          {(Object.keys(PRIORITY_LABELS) as PriorityLevel[]).map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </select>

        <select
          value={filterObjective}
          onChange={(e) => setFilterObjective(e.target.value as CadenceObjective | "todos")}
          className="rounded-full px-3 py-1.5 text-xs border border-gray-200 bg-white text-gray-700 focus:outline-none"
        >
          <option value="todos">Objetivo: Todos</option>
          {(Object.keys(OBJECTIVE_LABELS) as CadenceObjective[]).map((o) => (
            <option key={o} value={o}>{OBJECTIVE_LABELS[o]}</option>
          ))}
        </select>
      </div>

      {/* ── Bulk Actions ───────────────────────────────────────────────── */}
      <div className="mb-4">
        <div className="flex items-center justify-between flex-wrap gap-y-2">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selectedIds.size === filtered.length && filtered.length > 0}
              onChange={toggleSelectAll}
              className="w-3.5 h-3.5 rounded border-gray-300 text-[#0147FF] focus:ring-[#0147FF]/20"
            />
            Selecionar todas ({selectedIds.size}/{filtered.length})
          </label>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => bulkSetCadenceStatus("congelada")}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 transition"
              >
                <IconSnowflake />
                Congelar
              </button>
              <button
                onClick={() => bulkSetCadenceStatus("disponivel")}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 transition"
              >
                <IconPlay />
                Retomar
              </button>
            </div>
          )}
        </div>
        {actionError && (
          <p className="mt-2 text-xs text-red-600">{actionError}</p>
        )}
      </div>

      {/* ── Cadence Cards ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        {filtered.map((cadence) => {
          const acqColor = ACQUISITION_COLORS[cadence.acquisition_channel];
          const statusColor = STATUS_COLORS[cadence.status];
          const priorityColor = PRIORITY_COLORS[cadence.priority];
          const weekdays = cadence.execution_weekdays.map((w) => WEEKDAY_LABELS[w]).join(", ");

          return (
            <div
              key={cadence.id}
              className="bg-white border border-gray-100 rounded-xl shadow-none overflow-hidden"
            >
              <div className="p-5">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(cadence.id)}
                    onChange={() => toggleSelect(cadence.id)}
                    className="w-4 h-4 rounded border-gray-300 text-[#0147FF] focus:ring-[#0147FF]/20 mt-0.5"
                  />

                  <div className="flex-1 min-w-0">
                    {/* Channel Tag + Name */}
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border"
                        style={{ background: acqColor.bg, color: acqColor.text, borderColor: acqColor.border }}
                      >
                        {ACQUISITION_LABELS[cadence.acquisition_channel]}
                      </span>
                      <h3 className="text-sm font-bold text-gray-900 truncate">{cadence.name}</h3>
                    </div>

                    {cadence.description && (
                      <p className="text-sm text-gray-500 mb-4 line-clamp-2">{cadence.description}</p>
                    )}

                    {/* Timeline */}
                    <div className="mb-4">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
                        Resumo da cadência
                      </span>
                      <div className="bg-[#F8F9FA] rounded-lg px-4 py-3">
                        {renderTimeline(cadence.days || [])}
                      </div>
                    </div>

                    {/* Info Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Status</span>
                        <span
                          className="inline-flex items-center self-start rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: statusColor.bg, color: statusColor.text }}
                        >
                          {CADENCE_STATUS_LABELS[cadence.status]}
                        </span>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Objetivo</span>
                        <span className="text-xs text-gray-700 font-medium">{OBJECTIVE_LABELS[cadence.objective]}</span>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Dias de Execução</span>
                        <span className="text-xs text-gray-700 font-medium">{weekdays}</span>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Leads Vinculados</span>
                        <span className="text-sm font-bold text-gray-900">{cadence._leads_count ?? 0}</span>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Ativos em Cadência</span>
                        <span className="text-sm font-bold text-[#0147FF]">{cadence._active_leads_count ?? 0}</span>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Prioridade</span>
                        <span
                          className="inline-flex items-center self-start rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: priorityColor.bg, color: priorityColor.text }}
                        >
                          {PRIORITY_LABELS[cadence.priority]}
                        </span>
                      </div>
                    </div>

                    {/* Owners */}
                    {cadence.owners && cadence.owners.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Responsáveis</span>
                        <div className="flex items-center -space-x-1.5">
                          {cadence.owners.map((owner) => {
                            const initials = (owner.user?.name || "?")
                              .split(" ")
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join("")
                              .toUpperCase();
                            return (
                              <div
                                key={owner.user_id}
                                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-white bg-[#0147FF]/10 text-[#0147FF]"
                                title={owner.user?.name}
                              >
                                {initials}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => onEditCadence(cadence.id)}
                    className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-[#0147FF] hover:bg-[#0147FF]/5 transition"
                    title="Editar cadência"
                  >
                    <IconEdit />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-none p-12 text-center">
            <p className="text-gray-400 text-sm">Nenhuma cadência encontrada com os filtros selecionados.</p>
          </div>
        )}
      </div>
    </div>
  );
}
