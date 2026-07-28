// src/components/sdr/agenda/SlotPicker.tsx
// -----------------------------------------------------------------------------
// "Escolha o closer e um horário livre." É o componente que o SDR usa todo dia.
//
// Ele carrega a agenda dos closers uma vez (janela de ~8 semanas) e daí pra
// frente é tudo cálculo local — trocar de dia ou de closer não vai ao banco, a
// grade responde na hora.
//
// Não é um modal: é um bloco. Assim serve tanto o modal de agendamento da Agenda
// quanto o modal de Ganho do Painel de Atividades, que já é uma tela por si só.
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  fetchClosers,
  fetchCloserConfigs,
  fetchAvailability,
  fetchBlocks,
  fetchMeetingsInRange,
  computeDaySlots,
  countFreeSlots,
  configFor,
  closerColor,
  startOfDay,
  addDays,
  type Slot,
} from "@/lib/qs/closerAgenda";
import type { CloserAvailability, CloserBlock, CloserConfig, Meeting, SdrUser } from "../types";
import { WEEKDAY_SHORT, hhmm } from "@/lib/qs/calendarLayout";

/** Quantos dias pra frente o seletor deixa navegar. */
const HORIZON_DAYS = 56;
/** Dias mostrados na régua de datas. */
const STRIP_DAYS = 14;

export interface SlotSelection {
  closerId: string;
  closerName: string;
  start: Date;
  durationMin: number;
  /** Sala fixa do closer (qs_closer_config.default_link), se houver. */
  link: string | null;
}

interface SlotPickerProps {
  value: SlotSelection | null;
  onChange: (value: SlotSelection | null) => void;
  /** Ao REMARCAR: o horário atual da própria reunião não conta como ocupado. */
  ignoreMeetingId?: string;
  /** Pré-seleção (clique numa célula do calendário). */
  initialCloserId?: string | null;
  initialDate?: Date | null;
  /** Gestor pode encaixar fora da grade de slots. */
  allowManual?: boolean;
}

export default function SlotPicker({
  value,
  onChange,
  ignoreMeetingId,
  initialCloserId,
  initialDate,
  allowManual = false,
}: SlotPickerProps) {
  const [closers, setClosers] = useState<SdrUser[]>([]);
  const [configs, setConfigs] = useState<CloserConfig[]>([]);
  const [availability, setAvailability] = useState<CloserAvailability[]>([]);
  const [blocks, setBlocks] = useState<CloserBlock[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  const [closerId, setCloserId] = useState<string | null>(initialCloserId ?? null);
  const [day, setDay] = useState<Date>(startOfDay(initialDate ?? new Date()));
  const [stripStart, setStripStart] = useState<Date>(startOfDay(initialDate ?? new Date()));
  const [manual, setManual] = useState(false);
  const [manualTime, setManualTime] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const from = startOfDay(new Date());
      const to = addDays(from, HORIZON_DAYS);
      const [c, cfg, av, bl, mt] = await Promise.all([
        fetchClosers(),
        fetchCloserConfigs(),
        fetchAvailability(),
        fetchBlocks(from, to),
        fetchMeetingsInRange(from, to),
      ]);
      if (!alive) return;
      setClosers(c);
      setConfigs(cfg);
      setAvailability(av);
      setBlocks(bl);
      setMeetings(mt);
      setLoading(false);
      // Um closer só? Já entra escolhido — um clique a menos, todo dia.
      if (!closerId && c.length === 1) setCloserId(c[0].id);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedCloser = closers.find((c) => c.id === closerId) ?? null;
  const config = closerId ? configFor(closerId, configs) : null;

  const slotInput = useMemo(
    () =>
      closerId && config
        ? { closerId, availability, blocks, meetings, config }
        : null,
    [closerId, config, availability, blocks, meetings]
  );

  const slots: Slot[] = useMemo(() => {
    if (!slotInput) return [];
    return computeDaySlots(slotInput, day, { ignoreMeetingId });
  }, [slotInput, day, ignoreMeetingId]);

  const stripDays = useMemo(
    () => Array.from({ length: STRIP_DAYS }, (_, i) => addDays(stripStart, i)),
    [stripStart]
  );

  /** Livres por dia da régua — é o que faz o SDR ver "quarta tá cheia" sem clicar. */
  const freeByDay = useMemo(() => {
    if (!slotInput) return new Map<number, number>();
    const map = new Map<number, number>();
    for (const d of stripDays) {
      map.set(d.getTime(), countFreeSlots(slotInput, d, { ignoreMeetingId }));
    }
    return map;
  }, [slotInput, stripDays, ignoreMeetingId]);

  function pick(slot: Slot) {
    if (!selectedCloser || !config) return;
    const durationMin = Math.round((slot.end.getTime() - slot.start.getTime()) / 60_000);
    onChange({
      closerId: selectedCloser.id,
      closerName: selectedCloser.name,
      start: slot.start,
      durationMin,
      link: config.default_link,
    });
  }

  function pickManual(hm: string) {
    setManualTime(hm);
    if (!selectedCloser || !config || !/^\d{2}:\d{2}$/.test(hm)) return;
    const [h, m] = hm.split(":").map(Number);
    const start = new Date(day);
    start.setHours(h, m, 0, 0);
    onChange({
      closerId: selectedCloser.id,
      closerName: selectedCloser.name,
      start,
      durationMin: config.slot_minutes,
      link: config.default_link,
    });
  }

  function selectCloser(id: string) {
    setCloserId(id);
    onChange(null); // trocar de closer invalida o horário escolhido
  }

  function selectDay(d: Date) {
    setDay(d);
    onChange(null);
  }

  if (loading) {
    return <p className="text-sm text-gray-400 py-6 text-center">Carregando a agenda dos closers…</p>;
  }

  if (!closers.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center">
        <p className="text-sm font-semibold text-gray-700">Nenhum closer cadastrado.</p>
        <p className="text-xs text-gray-500 mt-1">
          Um administrador precisa criar os usuários com papel <b>Closer</b> em Configurações → Usuários.
        </p>
      </div>
    );
  }

  const bookableClosers = closers.filter((c) => configFor(c.id, configs).is_bookable);
  const freeSlots = slots.filter((s) => s.available);

  return (
    <div className="space-y-3">
      {/* ── Closer ── */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1.5">Closer</label>
        <div className="flex flex-wrap gap-1.5">
          {closers.map((c, i) => {
            const cfg = configFor(c.id, configs);
            const color = closerColor(c.id, i, cfg);
            const active = c.id === closerId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCloser(c.id)}
                disabled={!cfg.is_bookable}
                title={cfg.is_bookable ? c.name : `${c.name} não está aceitando agendamentos`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  active ? "text-white border-transparent" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
                style={active ? { background: color } : undefined}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: active ? "rgba(255,255,255,.85)" : color }}
                />
                {c.name}
              </button>
            );
          })}
        </div>
        {!bookableClosers.length && (
          <p className="mt-1.5 text-xs text-amber-600">
            Nenhum closer está aceitando agendamentos no momento.
          </p>
        )}
      </div>

      {!closerId ? (
        <p className="text-sm text-gray-400 py-4 text-center">Escolha um closer para ver os horários livres.</p>
      ) : (
        <>
          {/* ── Régua de dias ── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-gray-700">Dia</label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setStripStart(addDays(stripStart, -7))}
                  disabled={stripStart.getTime() <= startOfDay(new Date()).getTime()}
                  className="px-2 py-0.5 rounded text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ‹ semana
                </button>
                <button
                  type="button"
                  onClick={() => setStripStart(addDays(stripStart, 7))}
                  className="px-2 py-0.5 rounded text-xs text-gray-500 hover:bg-gray-100"
                >
                  semana ›
                </button>
              </div>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {stripDays.map((d) => {
                const free = freeByDay.get(d.getTime()) ?? 0;
                const active = d.getTime() === day.getTime();
                return (
                  <button
                    key={d.getTime()}
                    type="button"
                    onClick={() => selectDay(d)}
                    className={`shrink-0 w-[52px] rounded-lg border px-1 py-1.5 text-center transition-colors ${
                      active
                        ? "border-[#0147FF] bg-[#0147FF]/5"
                        : free > 0
                          ? "border-gray-200 bg-white hover:bg-gray-50"
                          : "border-gray-100 bg-gray-50"
                    }`}
                  >
                    <span className={`block text-[10px] font-semibold uppercase ${active ? "text-[#0147FF]" : "text-gray-400"}`}>
                      {WEEKDAY_SHORT[d.getDay()]}
                    </span>
                    <span className={`block text-sm font-bold leading-tight ${free > 0 ? "text-gray-800" : "text-gray-400"}`}>
                      {d.getDate()}
                    </span>
                    <span
                      className={`block text-[9px] font-semibold leading-tight ${
                        free > 0 ? "text-emerald-600" : "text-gray-300"
                      }`}
                    >
                      {free > 0 ? `${free} livre${free > 1 ? "s" : ""}` : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Horários ── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-gray-700">
                Horário {freeSlots.length > 0 && <span className="text-gray-400 font-normal">· {freeSlots.length} livre{freeSlots.length > 1 ? "s" : ""}</span>}
              </label>
              {allowManual && (
                <button
                  type="button"
                  onClick={() => { setManual((v) => !v); onChange(null); }}
                  className="text-[11px] font-semibold text-[#0147FF] hover:underline"
                >
                  {manual ? "Voltar aos slots" : "Encaixar fora da grade"}
                </button>
              )}
            </div>

            {manual ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-[11px] text-amber-800 mb-2">
                  Encaixe manual: ignora a grade de slots, mas a trava de choque de agenda do banco continua valendo.
                </p>
                <input
                  type="time"
                  value={manualTime}
                  onChange={(e) => pickManual(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-700"
                />
              </div>
            ) : slots.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
                <p className="text-sm text-gray-500">
                  {selectedCloser?.name} não atende {WEEKDAY_SHORT[day.getDay()].toLowerCase()}-feira
                  {day.getDay() === 0 || day.getDay() === 6 ? "" : "s"} — ou a agenda dele ainda não foi configurada.
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Configurações → Agenda dos Closers define os dias e horários de atendimento.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-[210px] overflow-y-auto pr-0.5">
                {slots.map((s) => {
                  const active =
                    value?.start != null && value.start.getTime() === s.start.getTime() && value.closerId === closerId;
                  const label = hhmm(s.start);
                  const title = s.available
                    ? `Agendar às ${label}`
                    : s.reason === "ocupado"
                      ? `Ocupado — ${s.meeting?.lead_name ?? s.meeting?.title ?? "reunião"}`
                      : s.reason === "bloqueio"
                        ? `Indisponível${s.block?.reason ? ` — ${s.block.reason}` : ""}`
                        : s.reason === "antecedencia"
                          ? "Antecedência mínima do closer"
                          : s.reason === "limite_diario"
                            ? "Limite de reuniões do dia atingido"
                            : "Horário já passou";
                  return (
                    <button
                      key={s.start.getTime()}
                      type="button"
                      onClick={() => s.available && pick(s)}
                      disabled={!s.available}
                      title={title}
                      className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                        active
                          ? "border-[#0147FF] bg-[#0147FF] text-white"
                          : s.available
                            ? "border-gray-200 bg-white text-gray-700 hover:border-[#0147FF] hover:text-[#0147FF]"
                            : "border-transparent bg-gray-100 text-gray-400 cursor-not-allowed line-through"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {value && (
            <div className="rounded-lg border border-[#0147FF]/20 bg-[#0147FF]/5 px-3 py-2">
              <p className="text-xs font-semibold text-[#0147FF]">
                {value.closerName} · {WEEKDAY_SHORT[value.start.getDay()]}{" "}
                {String(value.start.getDate()).padStart(2, "0")}/{String(value.start.getMonth() + 1).padStart(2, "0")} às{" "}
                {hhmm(value.start)} · {value.durationMin} min
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
