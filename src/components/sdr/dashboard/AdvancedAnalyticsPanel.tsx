// src/components/sdr/dashboard/AdvancedAnalyticsPanel.tsx
// -----------------------------------------------------------------------------
// "Análises Avançadas" — leitura gerencial cruzando telefonia, reuniões, leads e
// R$ (Sprint 4, Onda B3 de analytics). Painel MANAGER-ONLY: são comparativos
// cross-SDR (a RLS de gestor/admin já entrega o time inteiro; SDR/closer nem
// enxergam a rota). Seis seções, todas no período 7/30/90 dias do topo:
//   A. Telefonia — taxa de atendimento por HORÁRIO (qs_call_logs)
//   B. Telefonia — duração média por SDR (ligações atendidas)
//   C. Show-rate por FONTE (+ antecedência média de agendamento)
//   D. Speed-to-lead por SDR e por fonte (chegada → 1º contato)
//   E. Funil comparativo de SDRs (leads → contatados → reunião → ganho)
//   F. R$ por fonte (soma de closed_value dos ganhos + ticket médio)
// Mesmo padrão visual do FupAnalyticsPanel (barras em CSS, tabelas com TOTAL).
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAllRows, getClosedAtColumn } from "@/lib/qs/queries";
import { SOURCE_LABELS } from "@/components/sdr/types";
import type { LeadSource } from "@/components/sdr/types";

// Paleta padrão dos painéis (mesma do FupAnalyticsPanel).
const BLUE = "#0147FF";
const GREEN = "#0E7C6A";
const AMBER = "#B45309";
const RED = "#DC2626";

const PERIODS = [7, 30, 90] as const;
type PeriodDays = (typeof PERIODS)[number];

// ── Helpers de data/número (dia e hora sempre LOCAIS) ────────────────────────

// Corte do período: meia-noite LOCAL de N dias atrás (o dia de hoje conta).
function cutoffIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Hora LOCAL (0–23) do timestamp. getHours (não fatiar ISO) pra respeitar o fuso:
// uma ligação de 22h BRT não pode migrar pra 01h UTC do dia seguinte.
function localHour(iso: string): number {
  return new Date(iso).getHours();
}

// Divisão segura: "—" quando o denominador é 0 (nunca NaN/Infinity na tela).
function pct(num: number, den: number): string {
  return den > 0 ? `${Math.round((num / den) * 100)}%` : "—";
}

// Mediana de uma lista numérica (ordena e pega o meio; média dos 2 centrais se par).
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

// Duração legível a partir de MINUTOS: "45min" quando < 90min, senão "3.2h".
function fmtMin(minutes: number): string {
  if (minutes < 90) return `${Math.round(minutes)}min`;
  return `${(minutes / 60).toFixed(1)}h`;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Rótulo da fonte do lead (LeadSource + null → "Sem fonte").
function sourceLabel(src: string | null): string {
  if (!src) return "Sem fonte";
  return SOURCE_LABELS[src as LeadSource] ?? src;
}

// Embed do Supabase (FK to-one) vem como objeto OU array — normaliza pra objeto.
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// ── Tipos das linhas cruas ───────────────────────────────────────────────────

interface CallRow { ownerId: string | null; answered: boolean; durationSec: number; createdAt: string }
interface MeetingTermRow { status: string; scheduledAt: string | null; createdAt: string | null; source: string | null }
interface LeadRow { id: string; ownerId: string | null; source: string | null; status: string; arrivedAt: string | null; createdAt: string }
interface WonRow { source: string | null; closedValue: number | null }

// ── Componente ───────────────────────────────────────────────────────────────

export default function AdvancedAnalyticsPanel() {
  const [days, setDays] = useState<PeriodDays>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [calls, setCalls] = useState<CallRow[]>([]);
  const [meetingsTerm, setMeetingsTerm] = useState<MeetingTermRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [firstContact, setFirstContact] = useState<Map<string, string>>(new Map());
  const [meetingLeadIds, setMeetingLeadIds] = useState<Set<string>>(new Set());
  const [won, setWon] = useState<WonRow[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cut = cutoffIso(days);
      // A coluna de fechamento (closed_at | fallback updated_at) precisa ser
      // resolvida ANTES de montar a query de R$ (F).
      const closedCol = await getClosedAtColumn();

      // (A/B) Ligações do período — paginado (o cap de 1000 do PostgREST estoura
      // rápido com time cheio; sem paginar as análises subestimariam em silêncio).
      const callsP = fetchAllRows<any>((f, t) =>
        supabase
          .from("qs_call_logs")
          .select("owner_id, answered, duration_sec, created_at")
          .gte("created_at", cut)
          .order("id")
          .range(f, t),
      );

      // (C) Reuniões com desfecho TERMINAL no período (ancoradas em scheduled_at =
      // quando a reunião de fato aconteceu/deveria ter acontecido) + fonte do lead.
      const meetTermP = fetchAllRows<any>((f, t) =>
        supabase
          .from("qs_meetings")
          .select("status, scheduled_at, created_at, lead:qs_leads(source)")
          .in("status", ["realizada", "no_show"])
          .gte("scheduled_at", cut)
          .order("id")
          .range(f, t),
      );

      // (E) TODOS os lead_ids com reunião (qualquer status/data) — a reunião de um
      // lead do período pode ter sido criada fora dele. A tabela é pequena (≈1 por
      // lead qualificado), então varremos inteira e montamos um Set.
      const meetLeadsP = fetchAllRows<any>((f, t) =>
        supabase
          .from("qs_meetings")
          .select("lead_id")
          .not("lead_id", "is", null)
          .order("id")
          .range(f, t),
      );

      // (D/E) Leads que CHEGARAM no período (created_at é sempre presente; serve de
      // âncora estável). Reaproveitado nas duas seções.
      const leadsP = fetchAllRows<any>((f, t) =>
        supabase
          .from("qs_leads")
          .select("id, owner_id, source, status, arrived_at, created_at")
          .gte("created_at", cut)
          .order("id")
          .range(f, t),
      );

      // (D) Atividades concluídas no período → menor completed_at por lead = 1º
      // contato. completed_at >= cut é seguro: o lead é do período, logo seu 1º
      // contato não pode ser anterior ao corte.
      const tasksP = fetchAllRows<any>((f, t) =>
        supabase
          .from("qs_tasks")
          .select("lead_id, completed_at")
          .eq("status", "concluida")
          .gte("completed_at", cut)
          .not("completed_at", "is", null)
          .order("id")
          .range(f, t),
      );

      // (F) Ganhos por DATA DE FECHAMENTO no período (não por criação: lead antigo
      // ganho agora conta neste período).
      const wonP = fetchAllRows<any>((f, t) =>
        supabase
          .from("qs_leads")
          .select("source, closed_value")
          .eq("status", "ganho")
          .gte(closedCol, cut)
          .order("id")
          .range(f, t),
      );

      const [callRows, meetTermRows, meetLeadRows, leadRows, taskRows, wonRows, usersRes] =
        await Promise.all([callsP, meetTermP, meetLeadsP, leadsP, tasksP, wonP,
          supabase.from("qs_users").select("id, name").eq("is_active", true)]);

      if (usersRes.error) throw usersRes.error;

      setCalls(callRows.map((r) => ({
        ownerId: (r.owner_id as string) ?? null,
        answered: !!r.answered,
        durationSec: Number(r.duration_sec ?? 0),
        createdAt: (r.created_at as string) ?? "",
      })));

      setMeetingsTerm(meetTermRows.map((r) => ({
        status: (r.status as string) ?? "",
        scheduledAt: (r.scheduled_at as string) ?? null,
        createdAt: (r.created_at as string) ?? null,
        source: one(r.lead as { source: string | null } | { source: string | null }[] | null)?.source ?? null,
      })));

      setMeetingLeadIds(new Set(meetLeadRows.map((r) => r.lead_id as string).filter(Boolean)));

      setLeads(leadRows.map((r) => ({
        id: (r.id as string),
        ownerId: (r.owner_id as string) ?? null,
        source: (r.source as string) ?? null,
        status: (r.status as string) ?? "",
        arrivedAt: (r.arrived_at as string) ?? null,
        createdAt: (r.created_at as string) ?? "",
      })));

      // Menor completed_at por lead (1º contato).
      const fc = new Map<string, string>();
      for (const r of taskRows) {
        const lid = r.lead_id as string;
        const cAt = r.completed_at as string | null;
        if (!lid || !cAt) continue;
        const prev = fc.get(lid);
        if (!prev || cAt < prev) fc.set(lid, cAt);
      }
      setFirstContact(fc);

      setWon(wonRows.map((r) => ({
        source: (r.source as string) ?? null,
        closedValue: r.closed_value == null ? null : Number(r.closed_value),
      })));

      setUserNames(new Map(((usersRes.data ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name])));
    } catch (e) {
      const msg = (e as { message?: string })?.message || "erro desconhecido";
      console.warn("[análises-avançadas] falha:", msg);
      setError("Não foi possível carregar as análises avançadas. Tente de novo.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const nameOf = (id: string | null) => (id ? userNames.get(id) ?? "Sem dono" : "Sem dono");

  // ══ SEÇÃO A — Taxa de atendimento por horário ═══════════════════════════════
  interface HourBucket { hour: number; total: number; answered: number }
  const hourMap = new Map<number, HourBucket>();
  for (const c of calls) {
    if (!c.createdAt) continue;
    const h = localHour(c.createdAt);
    const b = hourMap.get(h) ?? { hour: h, total: 0, answered: 0 };
    b.total++;
    if (c.answered) b.answered++;
    hourMap.set(h, b);
  }
  const hourRows = [...hourMap.values()].sort((a, b) => a.hour - b.hour);
  const callsTotal = calls.length;
  const callsAnswered = calls.filter((c) => c.answered).length;

  // ══ SEÇÃO B — Duração média por SDR (só atendidas) ══════════════════════════
  interface DurRow { count: number; totalSec: number }
  const durBySdr = new Map<string, DurRow>();
  for (const c of calls) {
    if (!c.answered) continue; // duração só faz sentido em ligação atendida
    const key = c.ownerId ?? "—";
    const r = durBySdr.get(key) ?? { count: 0, totalSec: 0 };
    r.count++; r.totalSec += c.durationSec;
    durBySdr.set(key, r);
  }
  const durRows = [...durBySdr.entries()]
    .map(([id, v]) => ({ id, name: nameOf(id === "—" ? null : id), avgSec: v.count > 0 ? v.totalSec / v.count : 0, count: v.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const maxAvgSec = Math.max(1, ...durRows.map((r) => r.avgSec));

  // ══ SEÇÃO C — Show-rate por fonte + antecedência média ══════════════════════
  interface ShowRow { realizada: number; noShow: number; leadDays: number; leadCount: number }
  const showBySrc = new Map<string, ShowRow>();
  const showTotal: ShowRow = { realizada: 0, noShow: 0, leadDays: 0, leadCount: 0 };
  for (const m of meetingsTerm) {
    const key = sourceLabel(m.source);
    const r = showBySrc.get(key) ?? { realizada: 0, noShow: 0, leadDays: 0, leadCount: 0 };
    for (const t of [r, showTotal]) {
      if (m.status === "realizada") t.realizada++;
      else if (m.status === "no_show") t.noShow++;
      // Antecedência: dias entre criação da reunião e o horário agendado.
      if (m.createdAt && m.scheduledAt) {
        const d = (new Date(m.scheduledAt).getTime() - new Date(m.createdAt).getTime()) / 86400000;
        if (d >= 0) { t.leadDays += d; t.leadCount++; }
      }
    }
    showBySrc.set(key, r);
  }
  const showRows = [...showBySrc.entries()]
    .map(([src, v]) => ({ src, ...v }))
    .sort((a, b) => (b.realizada + b.noShow) - (a.realizada + a.noShow) || a.src.localeCompare(b.src));
  const antec = (r: ShowRow) => (r.leadCount > 0 ? `${(r.leadDays / r.leadCount).toFixed(1)}d` : "—");

  // ══ SEÇÃO D — Speed-to-lead (chegada → 1º contato) ══════════════════════════
  // Minutos entre arrived_at (ou created_at) e o 1º contato do lead.
  const speedBySdr = new Map<string, number[]>();
  const speedBySrc = new Map<string, number[]>();
  const pushSpeed = (m: Map<string, number[]>, key: string, mins: number) => {
    const arr = m.get(key) ?? [];
    arr.push(mins);
    m.set(key, arr);
  };
  for (const l of leads) {
    const first = firstContact.get(l.id);
    if (!first) continue; // sem contato ainda → fora do speed-to-lead
    const arrived = l.arrivedAt ?? l.createdAt;
    if (!arrived) continue;
    const mins = (new Date(first).getTime() - new Date(arrived).getTime()) / 60000;
    if (mins < 0) continue; // dado inconsistente (contato antes de chegar) → ignora
    pushSpeed(speedBySdr, l.ownerId ?? "—", mins);
    pushSpeed(speedBySrc, sourceLabel(l.source), mins);
  }
  const speedSdrRows = [...speedBySdr.entries()]
    .map(([id, mins]) => ({ key: id, label: nameOf(id === "—" ? null : id), n: mins.length, avg: mins.reduce((s, x) => s + x, 0) / mins.length, med: median(mins) }))
    .sort((a, b) => a.avg - b.avg || b.n - a.n);
  const speedSrcRows = [...speedBySrc.entries()]
    .map(([src, mins]) => ({ key: src, label: src, n: mins.length, avg: mins.reduce((s, x) => s + x, 0) / mins.length, med: median(mins) }))
    .sort((a, b) => a.avg - b.avg || b.n - a.n);

  // ══ SEÇÃO E — Funil comparativo de SDRs ═════════════════════════════════════
  interface FunnelRow { leads: number; contatados: number; comReuniao: number; ganho: number }
  const emptyFunnel = (): FunnelRow => ({ leads: 0, contatados: 0, comReuniao: 0, ganho: 0 });
  const funnelBySdr = new Map<string, FunnelRow>();
  const funnelTotal = emptyFunnel();
  for (const l of leads) {
    const key = l.ownerId ?? "—";
    const r = funnelBySdr.get(key) ?? emptyFunnel();
    for (const t of [r, funnelTotal]) {
      t.leads++;
      if (l.status !== "nao_iniciado") t.contatados++;
      if (meetingLeadIds.has(l.id)) t.comReuniao++;
      if (l.status === "ganho") t.ganho++;
    }
    funnelBySdr.set(key, r);
  }
  const funnelRows = [...funnelBySdr.entries()]
    .map(([id, v]) => ({ id, name: nameOf(id === "—" ? null : id), ...v }))
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));

  // ══ SEÇÃO F — R$ por fonte ══════════════════════════════════════════════════
  interface RevRow { total: number; count: number }
  const revBySrc = new Map<string, RevRow>();
  const revTotal: RevRow = { total: 0, count: 0 };
  for (const w of won) {
    const key = sourceLabel(w.source);
    const r = revBySrc.get(key) ?? { total: 0, count: 0 };
    const val = w.closedValue ?? 0;
    r.total += val; r.count++;
    revTotal.total += val; revTotal.count++;
    revBySrc.set(key, r);
  }
  const revRows = [...revBySrc.entries()]
    .map(([src, v]) => ({ src, ...v, ticket: v.count > 0 ? v.total / v.count : 0 }))
    .sort((a, b) => b.total - a.total || a.src.localeCompare(b.src));
  const maxRev = Math.max(1, ...revRows.map((r) => r.total));

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F8F9FA] px-4 md:px-6 py-6">
      <div className="max-w-6xl mx-auto">
        {/* Cabeçalho: título + filtro de período + atualizar */}
        <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
          <h1 className="text-xl font-extrabold text-gray-900">Análises Avançadas</h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setDays(p)}
                  className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold border transition-colors ${
                    days === p ? "text-white border-transparent" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                  }`}
                  style={days === p ? { background: BLUE } : undefined}
                >
                  {p} dias
                </button>
              ))}
            </div>
            <button onClick={load} className="text-sm font-semibold" style={{ color: BLUE }}>Atualizar</button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          Telefonia, <b style={{ color: GREEN }}>show-rate por fonte</b>, <b style={{ color: BLUE }}>speed-to-lead</b>,{" "}
          funil por SDR e <b style={{ color: AMBER }}>R$ por fonte</b> — últimos {days} dias, time inteiro.
        </p>

        {error ? (
          <div className="rounded-2xl border p-6 text-center" style={{ background: "#FEF2F2", borderColor: "#FECACA" }}>
            <p className="text-sm text-gray-700 mb-3">{error}</p>
            <button onClick={load} className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: BLUE }}>
              Tentar de novo
            </button>
          </div>
        ) : loading ? (
          <div className="text-sm text-gray-400 py-16 text-center">Carregando…</div>
        ) : (
          <>
            {/* ── Seção A: Atendimento por horário ── */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h2 className="text-sm font-bold text-gray-900">Telefonia — taxa de atendimento por horário</h2>
                <span className="text-[12px] text-gray-500 tabular-nums">
                  <b className="text-gray-900">{callsTotal}</b> ligações · <b style={{ color: GREEN }}>{callsAnswered}</b> atendidas ({pct(callsAnswered, callsTotal)})
                </span>
              </div>
              <p className="text-[12px] text-gray-400 mt-0.5 mb-4">
                Largura da barra = % de atendimento na faixa de horário (hora local). Só horas com ligação aparecem.
              </p>
              {callsTotal === 0 ? (
                <p className="text-sm text-gray-400">Sem ligações registradas ainda — a telefonia começa a logar assim que a migration 0020 for aplicada e os SDRs ligarem pelo sistema.</p>
              ) : (
                <div className="space-y-2">
                  {hourRows.map((b) => (
                    <div key={b.hour} className="flex items-center gap-3">
                      <span className="w-14 text-[13px] font-bold shrink-0 text-gray-700 tabular-nums">{String(b.hour).padStart(2, "0")}h</span>
                      <div className="flex-1 h-6 rounded-lg bg-gray-100 overflow-hidden relative">
                        <div className="h-full rounded-lg" style={{ width: `${(b.answered / b.total) * 100}%`, background: GREEN, opacity: 0.85, transition: "width .3s" }} />
                        <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-bold tabular-nums text-gray-700 mix-blend-multiply">
                          {pct(b.answered, b.total)}
                        </span>
                      </div>
                      <span className="w-40 text-right text-[12.5px] tabular-nums shrink-0 text-gray-600">
                        <b className="text-gray-900">{b.total}</b> lig. · <b style={{ color: GREEN }}>{b.answered}</b> atend.
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Seção B: Duração média por SDR ── */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
              <h2 className="text-sm font-bold text-gray-900">Telefonia — duração média por SDR</h2>
              <p className="text-[12px] text-gray-400 mt-0.5 mb-4">Média do tempo de conversa das ligações ATENDIDAS. Barra proporcional à maior média.</p>
              {durRows.length === 0 ? (
                <p className="text-sm text-gray-400">Nenhuma ligação atendida no período.</p>
              ) : (
                <div className="space-y-2.5">
                  {durRows.map((r) => (
                    <div key={r.id} className="flex items-center gap-3">
                      <span className="w-40 text-[13px] font-medium shrink-0 text-gray-800 truncate" title={r.name}>{r.name}</span>
                      <div className="flex-1 h-6 rounded-lg bg-gray-100 overflow-hidden relative">
                        <div className="h-full rounded-lg" style={{ width: `${(r.avgSec / maxAvgSec) * 100}%`, background: BLUE, opacity: 0.85, transition: "width .3s" }} />
                        <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-bold tabular-nums text-gray-700 mix-blend-multiply">
                          {fmtMin(r.avgSec / 60)}
                        </span>
                      </div>
                      <span className="w-28 text-right text-[12.5px] tabular-nums shrink-0 text-gray-600">
                        <b className="text-gray-900">{r.count}</b> atend.
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Seção C: Show-rate por fonte ── */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-6">
              <div className="px-5 pt-4 pb-3">
                <h2 className="text-sm font-bold text-gray-900">Show-rate por fonte</h2>
                <p className="text-[12px] text-gray-400 mt-0.5">
                  Reuniões com desfecho no período. Show-rate = realizadas ÷ (realizadas + no-show). Antecedência = dias entre agendar e a reunião.
                </p>
              </div>
              {showRows.length === 0 ? (
                <p className="text-sm text-gray-400 px-5 pb-5">Nenhuma reunião realizada ou no-show no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[620px]">
                    <thead>
                      <tr className="text-left text-[12px] uppercase text-gray-400 border-t border-gray-100">
                        <th className="px-5 py-2 font-semibold">Fonte</th>
                        <th className="px-3 py-2 font-semibold text-right">Realizadas</th>
                        <th className="px-3 py-2 font-semibold text-right">No-show</th>
                        <th className="px-3 py-2 font-semibold text-right">Antecedência</th>
                        <th className="px-5 py-2 font-semibold text-right">Show-rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {showRows.map((r) => (
                        <tr key={r.src} className="border-t border-gray-50">
                          <td className="px-5 py-2.5 font-medium text-gray-800">{r.src}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: GREEN }}>{r.realizada}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: r.noShow > 0 ? RED : "#6B7280" }}>{r.noShow}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{antec(r)}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums font-bold" style={{ color: BLUE, background: "rgba(1,71,255,0.05)" }}>{pct(r.realizada, r.realizada + r.noShow)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200 bg-gray-50 font-bold">
                        <td className="px-5 py-2.5 text-gray-900">TOTAL</td>
                        <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: GREEN }}>{showTotal.realizada}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: showTotal.noShow > 0 ? RED : "#6B7280" }}>{showTotal.noShow}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{antec(showTotal)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums" style={{ color: BLUE, background: "rgba(1,71,255,0.05)" }}>{pct(showTotal.realizada, showTotal.realizada + showTotal.noShow)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Seção D: Speed-to-lead (por SDR e por fonte) ── */}
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              {([
                { title: "Speed-to-lead por SDR", head: "SDR", rows: speedSdrRows },
                { title: "Speed-to-lead por fonte", head: "Fonte", rows: speedSrcRows },
              ] as const).map((block) => (
                <div key={block.title} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                  <div className="px-5 pt-4 pb-3">
                    <h2 className="text-sm font-bold text-gray-900">{block.title}</h2>
                    <p className="text-[12px] text-gray-400 mt-0.5">Tempo da chegada do lead até o 1º contato (menor conclusão de atividade).</p>
                  </div>
                  {block.rows.length === 0 ? (
                    <p className="text-sm text-gray-400 px-5 pb-5">Sem leads contatados no período.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[360px]">
                        <thead>
                          <tr className="text-left text-[12px] uppercase text-gray-400 border-t border-gray-100">
                            <th className="px-5 py-2 font-semibold">{block.head}</th>
                            <th className="px-3 py-2 font-semibold text-right">Leads</th>
                            <th className="px-3 py-2 font-semibold text-right">Média</th>
                            <th className="px-5 py-2 font-semibold text-right">Mediana</th>
                          </tr>
                        </thead>
                        <tbody>
                          {block.rows.map((r) => (
                            <tr key={r.key} className="border-t border-gray-50">
                              <td className="px-5 py-2.5 font-medium text-gray-800 truncate max-w-[160px]" title={r.label}>{r.label}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-bold text-gray-900">{r.n}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{fmtMin(r.avg)}</td>
                              <td className="px-5 py-2.5 text-right tabular-nums font-semibold" style={{ color: BLUE }}>{fmtMin(r.med)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* ── Seção E: Funil comparativo de SDRs ── */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-6">
              <div className="px-5 pt-4 pb-3">
                <h2 className="text-sm font-bold text-gray-900">Funil comparativo de SDRs</h2>
                <p className="text-[12px] text-gray-400 mt-0.5">
                  Leads que chegaram no período. % de conversão entre etapas: contatados÷leads, reunião÷contatados, ganho÷reunião.
                </p>
              </div>
              {funnelRows.length === 0 ? (
                <p className="text-sm text-gray-400 px-5 pb-5">Nenhum lead chegou no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[760px]">
                    <thead>
                      <tr className="text-left text-[12px] uppercase text-gray-400 border-t border-gray-100">
                        <th className="px-5 py-2 font-semibold">SDR</th>
                        <th className="px-3 py-2 font-semibold text-right">Leads</th>
                        <th className="px-3 py-2 font-semibold text-right">Contatados</th>
                        <th className="px-3 py-2 font-semibold text-right">→ %</th>
                        <th className="px-3 py-2 font-semibold text-right">Reunião</th>
                        <th className="px-3 py-2 font-semibold text-right">→ %</th>
                        <th className="px-3 py-2 font-semibold text-right">Ganho</th>
                        <th className="px-5 py-2 font-semibold text-right">→ %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnelRows.map((r) => (
                        <tr key={r.id} className="border-t border-gray-50">
                          <td className="px-5 py-2.5 font-medium text-gray-800">{r.name}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-bold text-gray-900">{r.leads}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{r.contatados}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{pct(r.contatados, r.leads)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{r.comReuniao}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{pct(r.comReuniao, r.contatados)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: GREEN }}>{r.ganho}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums font-bold" style={{ color: BLUE, background: "rgba(1,71,255,0.05)" }}>{pct(r.ganho, r.comReuniao)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200 bg-gray-50 font-bold">
                        <td className="px-5 py-2.5 text-gray-900">TOTAL</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{funnelTotal.leads}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{funnelTotal.contatados}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{pct(funnelTotal.contatados, funnelTotal.leads)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{funnelTotal.comReuniao}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{pct(funnelTotal.comReuniao, funnelTotal.contatados)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: GREEN }}>{funnelTotal.ganho}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums" style={{ color: BLUE, background: "rgba(1,71,255,0.05)" }}>{pct(funnelTotal.ganho, funnelTotal.comReuniao)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Seção F: R$ por fonte ── */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-5 pt-4 pb-3 flex items-baseline justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-sm font-bold text-gray-900">R$ por fonte</h2>
                  <p className="text-[12px] text-gray-400 mt-0.5">Soma de closed_value dos leads GANHOS (por data de fechamento) no período.</p>
                </div>
                <span className="text-[12px] text-gray-500 tabular-nums">
                  <b className="text-gray-900">{BRL.format(revTotal.total)}</b> · {revTotal.count} ganho(s)
                </span>
              </div>
              {revRows.length === 0 ? (
                <p className="text-sm text-gray-400 px-5 pb-5">Nenhum lead ganho no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="text-left text-[12px] uppercase text-gray-400 border-t border-gray-100">
                        <th className="px-5 py-2 font-semibold">Fonte</th>
                        <th className="px-3 py-2 font-semibold text-right">Ganhos</th>
                        <th className="px-3 py-2 font-semibold text-right">Ticket médio</th>
                        <th className="px-5 py-2 font-semibold" style={{ width: "40%" }}>R$ total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revRows.map((r) => (
                        <tr key={r.src} className="border-t border-gray-50">
                          <td className="px-5 py-2.5 font-medium text-gray-800">{r.src}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-bold text-gray-900">{r.count}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{BRL.format(r.ticket)}</td>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-3.5 rounded bg-gray-100 overflow-hidden">
                                <div className="h-full rounded" style={{ width: `${(r.total / maxRev) * 100}%`, background: AMBER, opacity: 0.85 }} />
                              </div>
                              <b className="tabular-nums text-gray-900 shrink-0 text-[13px]">{BRL.format(r.total)}</b>
                            </div>
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-200 bg-gray-50 font-bold">
                        <td className="px-5 py-2.5 text-gray-900">TOTAL</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{revTotal.count}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{BRL.format(revTotal.count > 0 ? revTotal.total / revTotal.count : 0)}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-gray-900">{BRL.format(revTotal.total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
