// src/components/sdr/agenda/AgendaCalendar.tsx
// -----------------------------------------------------------------------------
// A AGENDA DOS CLOSERS, dentro do QS. Substitui o iframe da Google Agenda: os
// dados são nossos, o agendamento acontece aqui e ninguém fica refém de uma
// agenda externa.
//
// Três visões, como no Google Agenda:
//   • MÊS    — os 30 dias de uma vez, pra bater o olho no volume
//   • SEMANA — 7 colunas de dias, grade de horas
//   • DIA    — UMA COLUNA POR CLOSER, lado a lado. É a visão que responde
//              "quem está livre às 15h?" sem precisar abrir agenda por agenda.
//
// Clique numa área vazia = agendar naquele horário. Clique numa reunião = abrir
// o desfecho. O calendário se atualiza sozinho (realtime) quando outro SDR
// agenda algo — dois SDRs olhando a mesma agenda veem a mesma coisa.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  fetchClosers,
  fetchCloserConfigs,
  fetchAvailability,
  fetchBlocks,
  fetchMeetingsInRange,
  agendaSchemaReady,
  configFor,
  closerColor,
} from "@/lib/qs/closerAgenda";
import {
  addDays,
  addMonths,
  isSameDay,
  isToday,
  monthGrid,
  periodLabel,
  startOfDay,
  startOfWeek,
  viewRange,
  weekGrid,
  gridHourRange,
  shortTime,
  WEEKDAY_SHORT,
  MONTH_LONG,
  type CalendarView,
} from "@/lib/qs/calendarLayout";
import TimeGrid, { type AvailBand, type GridColumn, type GridEvent } from "./TimeGrid";
import CloserAvailabilityStrip from "./CloserAvailabilityStrip";
import ScheduleMeetingModal from "./ScheduleMeetingModal";
import MeetingDetailModal from "./MeetingDetailModal";
import type { CloserAvailability, CloserBlock, CloserConfig, Meeting, SdrUser } from "../types";

const NEUTRAL = "#94A3B8"; // reunião sem closer definido (herança do texto livre)

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function minutesOf(hms: string): number {
  const [h, m] = hms.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

interface AgendaCalendarProps {
  onOpenLead?: (leadId: string) => void;
}

export default function AgendaCalendar({ onOpenLead }: AgendaCalendarProps) {
  const { currentUser } = useQsAuth();

  const [view, setView] = useState<CalendarView>("semana");
  const [anchor, setAnchor] = useState<Date>(new Date());
  // Vazio = todos. Closer logado entra vendo a própria agenda.
  const [selected, setSelected] = useState<Set<string>>(
    () => (currentUser?.role === "closer" && currentUser.id ? new Set([currentUser.id]) : new Set())
  );

  const [closers, setClosers] = useState<SdrUser[]>([]);
  const [configs, setConfigs] = useState<CloserConfig[]>([]);
  const [availability, setAvailability] = useState<CloserAvailability[]>([]);
  const [blocks, setBlocks] = useState<CloserBlock[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  // A migration 0027 já rodou? Sem ela o calendário até desenha (as reuniões vêm),
  // mas não existe closer, disponibilidade nem slot livre — e uma tela vazia sem
  // explicação parece defeito.
  const [schemaOk, setSchemaOk] = useState(true);

  const [detail, setDetail] = useState<Meeting | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [seedCloser, setSeedCloser] = useState<string | null>(null);
  const [seedDate, setSeedDate] = useState<Date | null>(null);
  const [rescheduling, setRescheduling] = useState<Meeting | null>(null);

  const range = useMemo(() => viewRange(view, anchor), [view, anchor]);

  // A janela CARREGADA é maior que a exibida de propósito: o painel de
  // disponibilidade procura o "próximo horário livre" até 30 dias à frente, e
  // ele mentiria se não enxergasse as reuniões que estão fora da tela.
  const load = useCallback(async () => {
    const hoje = startOfDay(new Date());
    const from = new Date(Math.min(range.from.getTime(), hoje.getTime()));
    const to = new Date(Math.max(range.to.getTime(), addDays(hoje, 35).getTime()));

    const [c, cfg, av, bl, mt] = await Promise.all([
      fetchClosers(),
      fetchCloserConfigs(),
      fetchAvailability(),
      fetchBlocks(from, to),
      fetchMeetingsInRange(from, to),
    ]);
    setClosers(c);
    setConfigs(cfg);
    setAvailability(av);
    setBlocks(bl);
    setMeetings(mt);
    setLoading(false);
  }, [range.from, range.to]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    void agendaSchemaReady().then(setSchemaOk);
  }, []);

  // Realtime: outro SDR agendou → a grade se atualiza sozinha (sem F5).
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void load(), 1_000);
    };
    const channel = supabase
      .channel("qs_agenda_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "qs_meetings" }, onChange)
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [load]);

  // ── Recortes ──────────────────────────────────────────────────────────────
  const visibleClosers = useMemo(
    () => (selected.size ? closers.filter((c) => selected.has(c.id)) : closers),
    [closers, selected]
  );

  const colorOf = useCallback(
    (closerId: string | null | undefined): string => {
      if (!closerId) return NEUTRAL;
      const i = closers.findIndex((c) => c.id === closerId);
      return closerColor(closerId, i < 0 ? 0 : i, configFor(closerId, configs));
    },
    [closers, configs]
  );

  /** Reuniões dentro da janela EXIBIDA e dos closers visíveis. */
  const periodMeetings = useMemo(() => {
    const from = range.from.getTime();
    const to = range.to.getTime();
    return meetings.filter((m) => {
      const t = new Date(m.scheduled_at).getTime();
      if (t < from || t >= to) return false;
      if (!selected.size) return true;
      // Sem closer: aparece quando nenhum filtro está ativo (ver aviso abaixo).
      return m.closer_id ? selected.has(m.closer_id) : false;
    });
  }, [meetings, range, selected]);

  const semCloser = useMemo(
    () =>
      meetings.filter((m) => {
        const t = new Date(m.scheduled_at).getTime();
        return !m.closer_id && m.status === "agendada" && t >= range.from.getTime() && t < range.to.getTime();
      }),
    [meetings, range]
  );

  const toGridEvent = useCallback(
    (m: Meeting, columnKey: string): GridEvent => {
      const start = new Date(m.scheduled_at);
      return {
        id: m.id,
        columnKey,
        start,
        end: new Date(start.getTime() + (m.duration_min ?? 30) * 60_000),
        title: m.lead_name ?? m.lead?.full_name ?? m.title ?? "Reunião",
        subtitle: view === "dia" ? (m.owner?.name ?? undefined) : (m.closer?.name ?? undefined),
        color: colorOf(m.closer_id),
        faded: m.status !== "agendada",
        strikethrough: m.status === "cancelada",
      };
    },
    [colorOf, view]
  );

  // Faixa de horas da grade: sai da disponibilidade real dos closers visíveis.
  const hourRange = useMemo(() => {
    const ids = new Set(visibleClosers.map((c) => c.id));
    const windows = availability.filter((a) => ids.has(a.closer_id));
    const evs = periodMeetings.map((m) => ({
      start: new Date(m.scheduled_at),
      end: new Date(new Date(m.scheduled_at).getTime() + (m.duration_min ?? 30) * 60_000),
    }));
    return gridHourRange(windows, evs);
  }, [availability, visibleClosers, periodMeetings]);

  // ── Ações ─────────────────────────────────────────────────────────────────
  function toggleCloser(id: string) {
    setSelected((prev) => {
      // Vazio = "todos". O primeiro clique ISOLA aquele closer (é o que se quer
      // 9 em 10 vezes); dos próximos em diante, soma e subtrai da seleção.
      if (prev.size === 0) return new Set([id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Nenhum ou todos marcados = voltar pro estado "todos".
      return next.size === 0 || next.size === closers.length ? new Set() : next;
    });
  }

  function openSchedule(closerId: string | null, date: Date | null) {
    setSeedCloser(closerId);
    setSeedDate(date);
    setRescheduling(null);
    setScheduleOpen(true);
  }

  function goto(delta: number) {
    if (view === "mes") setAnchor(addMonths(anchor, delta));
    else if (view === "semana") setAnchor(addDays(startOfWeek(anchor), delta * 7));
    else setAnchor(addDays(startOfDay(anchor), delta));
  }

  // ── Colunas por visão ─────────────────────────────────────────────────────
  const weekColumns: GridColumn[] = useMemo(
    () =>
      weekGrid(anchor).map((d) => ({
        key: dayKey(d),
        label: WEEKDAY_SHORT[d.getDay()],
        sublabel: String(d.getDate()),
        date: d,
        isToday: isToday(d),
      })),
    [anchor]
  );

  const dayColumns: GridColumn[] = useMemo(
    () =>
      visibleClosers.map((c, i) => ({
        key: c.id,
        label: c.name,
        date: startOfDay(anchor),
        closerId: c.id,
        isToday: isToday(anchor),
        accent: closerColor(c.id, closers.findIndex((x) => x.id === c.id) < 0 ? i : closers.findIndex((x) => x.id === c.id), configFor(c.id, configs)),
        muted: !configFor(c.id, configs).is_bookable,
      })),
    [visibleClosers, anchor, closers, configs]
  );

  /** Faixas de atendimento pra sombrear a grade. */
  const weekBands: Record<string, AvailBand[]> | undefined = useMemo(() => {
    // Só faz sentido com UM closer: com vários, a faixa clara seria "de quem?".
    if (visibleClosers.length !== 1) return undefined;
    const id = visibleClosers[0].id;
    const out: Record<string, AvailBand[]> = {};
    for (const col of weekColumns) {
      out[col.key] = availability
        .filter((a) => a.closer_id === id && a.weekday === col.date.getDay())
        .map((a) => ({ startMin: minutesOf(a.start_time), endMin: minutesOf(a.end_time) }));
    }
    return out;
  }, [visibleClosers, weekColumns, availability]);

  const dayBands: Record<string, AvailBand[]> = useMemo(() => {
    const out: Record<string, AvailBand[]> = {};
    const wd = startOfDay(anchor).getDay();
    for (const c of visibleClosers) {
      out[c.id] = availability
        .filter((a) => a.closer_id === c.id && a.weekday === wd)
        .map((a) => ({ startMin: minutesOf(a.start_time), endMin: minutesOf(a.end_time) }));
    }
    return out;
  }, [visibleClosers, availability, anchor]);

  const weekEvents: GridEvent[] = useMemo(
    () => periodMeetings.map((m) => toGridEvent(m, dayKey(new Date(m.scheduled_at)))),
    [periodMeetings, toGridEvent]
  );

  const dayEvents: GridEvent[] = useMemo(
    () =>
      periodMeetings
        .filter((m) => m.closer_id && isSameDay(new Date(m.scheduled_at), anchor))
        .map((m) => toGridEvent(m, m.closer_id as string)),
    [periodMeetings, anchor, toGridEvent]
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const btn = "px-3 py-1.5 text-sm font-semibold rounded-md transition";

  return (
    <div className="space-y-3">
      {/* Barra de navegação */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAnchor(new Date())}
            className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Hoje
          </button>
          <div className="flex items-center">
            <button
              onClick={() => goto(-1)}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
              aria-label="Período anterior"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <button
              onClick={() => goto(1)}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
              aria-label="Próximo período"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>
          <h2 className="text-base font-bold text-gray-900 capitalize ml-1">{periodLabel(view, anchor)}</h2>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
            {([
              { id: "mes", label: "Mês" },
              { id: "semana", label: "Semana" },
              { id: "dia", label: "Dia" },
            ] as const).map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`${btn} ${view === v.id ? "bg-[#0147FF] text-white" : "text-gray-600 hover:bg-gray-50"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => openSchedule(null, null)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0147FF] text-sm font-semibold text-white hover:bg-[#0139D6]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            Agendar
          </button>
        </div>
      </div>

      {/* Painel: quem está livre / quem foi agendado */}
      <CloserAvailabilityStrip
        closers={closers}
        configs={configs}
        availability={availability}
        blocks={blocks}
        meetings={meetings}
        periodMeetings={periodMeetings}
        selected={selected}
        onToggle={toggleCloser}
      />

      {selected.size > 0 && (
        <button
          onClick={() => setSelected(new Set())}
          className="text-xs font-semibold text-[#0147FF] hover:underline"
        >
          Mostrar todos os closers
        </button>
      )}

      {!schemaOk && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <p className="text-xs text-red-800">
            <b>A agenda ainda não foi ativada no banco.</b> As reuniões abaixo aparecem, mas não há
            closers, horários livres nem agendamento por slot até um administrador aplicar a migration{" "}
            <code className="font-mono">0027_agenda_closers.sql</code> no Supabase.
          </p>
        </div>
      )}

      {semCloser.length > 0 && selected.size === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs text-amber-800">
            <b>{semCloser.length}</b> reunião(ões) deste período ainda não têm closer vinculado (vieram do campo de
            texto antigo). Abra cada uma e use <b>Remarcar</b> para atribuir o closer — assim ela passa a ocupar a
            agenda dele de verdade.
          </p>
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-gray-100 bg-white py-16 text-center">
          <p className="text-sm text-gray-400">Carregando a agenda…</p>
        </div>
      ) : view === "mes" ? (
        <MonthGrid
          anchor={anchor}
          meetings={periodMeetings}
          colorOf={colorOf}
          onSelectDay={(d) => { setAnchor(d); setView("dia"); }}
          onSelectEvent={(m) => setDetail(m)}
          onSchedule={(d) => openSchedule(selected.size === 1 ? [...selected][0] : null, d)}
        />
      ) : view === "semana" ? (
        <TimeGrid
          columns={weekColumns}
          events={weekEvents}
          startHour={hourRange.startHour}
          endHour={hourRange.endHour}
          availability={weekBands}
          onSelectSlot={(_col, when) => openSchedule(visibleClosers.length === 1 ? visibleClosers[0].id : null, when)}
          onSelectEvent={(id) => setDetail(periodMeetings.find((m) => m.id === id) ?? null)}
        />
      ) : dayColumns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-12 text-center">
          <p className="text-sm font-semibold text-gray-700">Nenhum closer para exibir.</p>
          <p className="text-xs text-gray-500 mt-1">
            Cadastre usuários com papel <b>Closer</b> em Configurações → Usuários.
          </p>
        </div>
      ) : (
        <TimeGrid
          columns={dayColumns}
          events={dayEvents}
          startHour={hourRange.startHour}
          endHour={hourRange.endHour}
          availability={dayBands}
          onSelectSlot={(col, when) => openSchedule(col.closerId ?? null, when)}
          onSelectEvent={(id) => setDetail(periodMeetings.find((m) => m.id === id) ?? null)}
        />
      )}

      {/* Modais */}
      <ScheduleMeetingModal
        open={scheduleOpen}
        onClose={() => { setScheduleOpen(false); setRescheduling(null); }}
        onSaved={() => void load()}
        initialCloserId={seedCloser}
        initialDate={seedDate}
        reschedule={rescheduling}
      />
      <MeetingDetailModal
        meeting={detail}
        onClose={() => setDetail(null)}
        onChanged={() => void load()}
        onReschedule={(m) => { setRescheduling(m); setSeedCloser(m.closer_id ?? null); setSeedDate(new Date(m.scheduled_at)); setScheduleOpen(true); }}
        onOpenLead={onOpenLead}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Visão de MÊS — os 30 dias de uma vez.
// ─────────────────────────────────────────────────────────────────────────────

interface MonthGridProps {
  anchor: Date;
  meetings: Meeting[];
  colorOf: (closerId: string | null | undefined) => string;
  onSelectDay: (d: Date) => void;
  onSelectEvent: (m: Meeting) => void;
  onSchedule: (d: Date) => void;
}

function MonthGrid({ anchor, meetings, colorOf, onSelectDay, onSelectEvent, onSchedule }: MonthGridProps) {
  const days = monthGrid(anchor);
  const mesAtual = anchor.getMonth();

  const porDia = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const m of meetings) {
      const k = dayKey(new Date(m.scheduled_at));
      const arr = map.get(k);
      if (arr) arr.push(m);
      else map.set(k, [m]);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    }
    return map;
  }, [meetings]);

  return (
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-100">
        {WEEKDAY_SHORT.map((w) => (
          <div key={w} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const doMes = d.getMonth() === mesAtual;
          const hoje = isToday(d);
          const list = porDia.get(dayKey(d)) ?? [];
          const extras = Math.max(0, list.length - 3);
          return (
            <div
              key={d.getTime()}
              className={`group relative min-h-[92px] border-b border-r border-gray-100 p-1.5 ${
                doMes ? "" : "bg-gray-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <button
                  onClick={() => onSelectDay(d)}
                  title="Abrir o dia"
                  className={`text-xs font-bold w-6 h-6 rounded-full inline-flex items-center justify-center transition-colors ${
                    hoje
                      ? "bg-[#0147FF] text-white"
                      : doMes
                        ? "text-gray-700 hover:bg-gray-100"
                        : "text-gray-400 hover:bg-gray-100"
                  }`}
                >
                  {d.getDate()}
                </button>
                <button
                  onClick={() => onSchedule(d)}
                  title="Agendar neste dia"
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-gray-400 hover:text-[#0147FF] hover:bg-gray-100"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </button>
              </div>

              <div className="mt-1 space-y-0.5">
                {list.slice(0, 3).map((m) => {
                  const color = colorOf(m.closer_id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => onSelectEvent(m)}
                      title={`${shortTime(new Date(m.scheduled_at))} · ${m.lead_name ?? "Reunião"}${m.closer?.name ? ` · ${m.closer.name}` : ""}`}
                      className={`w-full flex items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-gray-50 ${
                        m.status !== "agendada" ? "opacity-50" : ""
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-[10px] font-semibold text-gray-500 shrink-0">
                        {shortTime(new Date(m.scheduled_at))}
                      </span>
                      <span
                        className={`text-[10px] text-gray-700 truncate ${m.status === "cancelada" ? "line-through" : ""}`}
                      >
                        {m.lead_name ?? m.title ?? "Reunião"}
                      </span>
                    </button>
                  );
                })}
                {extras > 0 && (
                  <button
                    onClick={() => onSelectDay(d)}
                    className="w-full text-left px-1 text-[10px] font-semibold text-[#0147FF] hover:underline"
                  >
                    +{extras} mais
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="px-3 py-2 text-[11px] text-gray-400">
        {MONTH_LONG[mesAtual]}: {meetings.length} reunião(ões) no período. Clique no número do dia para abrir a visão
        por closer.
      </p>
    </div>
  );
}
