// src/components/sdr/agenda/CloserAvailabilityStrip.tsx
// -----------------------------------------------------------------------------
// "Quem foi agendado e quem tem buraco na agenda" — a faixa de cards acima do
// calendário. Responde de bate-pronto as duas perguntas do SDR antes de ligar
// pro lead: *quem está livre hoje* e *qual o próximo horário disponível*.
//
// Não vai ao banco: recebe os dados que a AgendaCalendar já carregou e faz só
// contas. Clicar num card filtra o calendário naquele closer.
// -----------------------------------------------------------------------------

import { useMemo } from "react";
import {
  computeDaySlots,
  countFreeSlots,
  nextFreeSlot,
  configFor,
  closerColor,
  startOfDay,
} from "@/lib/qs/closerAgenda";
import type { CloserAvailability, CloserBlock, CloserConfig, Meeting, SdrUser } from "../types";
import { hhmm, WEEKDAY_SHORT, isSameDay } from "@/lib/qs/calendarLayout";

interface CloserAvailabilityStripProps {
  closers: SdrUser[];
  configs: CloserConfig[];
  availability: CloserAvailability[];
  blocks: CloserBlock[];
  /** TODAS as reuniões carregadas — o cálculo de "próximo livre" varre 30 dias e
   *  erraria se enxergasse só a janela exibida na tela. */
  meetings: Meeting[];
  /** Só as da janela que o calendário está mostrando (para o contador do período). */
  periodMeetings: Meeting[];
  /** Closers atualmente visíveis no calendário. Vazio = todos. */
  selected: Set<string>;
  onToggle: (closerId: string) => void;
}

export default function CloserAvailabilityStrip({
  closers,
  configs,
  availability,
  blocks,
  meetings,
  periodMeetings,
  selected,
  onToggle,
}: CloserAvailabilityStripProps) {
  const hoje = startOfDay(new Date());

  const cards = useMemo(() => {
    return closers.map((closer, i) => {
      const config = configFor(closer.id, configs);
      const input = { closerId: closer.id, availability, blocks, meetings, config };

      const agendadasHoje = meetings.filter(
        (m) => m.closer_id === closer.id && m.status === "agendada" && isSameDay(new Date(m.scheduled_at), hoje)
      ).length;

      // "No período" acompanha a navegação do calendário (mês/semana/dia exibido).
      const agendadasPeriodo = periodMeetings.filter(
        (m) => m.closer_id === closer.id && m.status === "agendada"
      ).length;

      const livresHoje = config.is_bookable ? countFreeSlots(input, hoje) : 0;
      const proximo = config.is_bookable ? nextFreeSlot(input) : null;
      const ocupadosHoje = computeDaySlots(input, hoje).length;

      return {
        closer,
        color: closerColor(closer.id, i, config),
        config,
        agendadasHoje,
        agendadasPeriodo,
        livresHoje,
        ocupadosHoje,
        proximo,
      };
    });
  }, [closers, configs, availability, blocks, meetings, periodMeetings, hoje]);

  if (!closers.length) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {cards.map((c) => {
        const ativo = selected.size === 0 || selected.has(c.closer.id);
        const taxa = c.ocupadosHoje > 0 ? Math.round(((c.ocupadosHoje - c.livresHoje) / c.ocupadosHoje) * 100) : 0;
        return (
          <button
            key={c.closer.id}
            type="button"
            onClick={() => onToggle(c.closer.id)}
            title={ativo ? `Ocultar ${c.closer.name} do calendário` : `Mostrar só ${c.closer.name}`}
            className={`shrink-0 min-w-[190px] text-left rounded-xl border px-3 py-2.5 transition-all ${
              ativo ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 opacity-50"
            } hover:border-gray-300`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
              <span className="text-sm font-bold text-gray-800 truncate">{c.closer.name}</span>
            </div>

            {!c.config.is_bookable ? (
              <p className="text-[11px] font-semibold text-amber-600">Não aceita agendamentos</p>
            ) : (
              <>
                <div className="flex items-baseline gap-3">
                  <div>
                    <span className="text-lg font-bold leading-none" style={{ color: c.color }}>
                      {c.livresHoje}
                    </span>
                    <span className="text-[10px] text-gray-400 ml-1">livres hoje</span>
                  </div>
                  <div>
                    <span className="text-lg font-bold text-gray-800 leading-none">{c.agendadasHoje}</span>
                    <span className="text-[10px] text-gray-400 ml-1">agendadas</span>
                  </div>
                </div>

                {/* Ocupação de hoje */}
                <div className="mt-1.5 h-1 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${taxa}%`, background: c.color }} />
                </div>

                <p className="mt-1.5 text-[10px] text-gray-500 truncate">
                  {c.proximo ? (
                    <>
                      Próximo livre:{" "}
                      <b className="text-gray-700">
                        {isSameDay(c.proximo.start, hoje)
                          ? `hoje ${hhmm(c.proximo.start)}`
                          : `${WEEKDAY_SHORT[c.proximo.start.getDay()].toLowerCase()} ${c.proximo.start.getDate()}/${c.proximo.start.getMonth() + 1} ${hhmm(c.proximo.start)}`}
                      </b>
                    </>
                  ) : (
                    <span className="text-amber-600">Sem horário livre nos próximos 30 dias</span>
                  )}
                </p>
                <p className="text-[10px] text-gray-400">{c.agendadasPeriodo} no período exibido</p>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
