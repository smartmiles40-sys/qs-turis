// src/components/sdr/agenda/TimeGrid.tsx
// -----------------------------------------------------------------------------
// A grade de horas do calendário — o mesmo componente serve a visão de SEMANA
// (7 colunas = 7 dias) e a de DIA (N colunas = N closers, lado a lado, pra bater
// o olho e ver quem está livre agora).
//
// Ele não sabe o que é uma reunião: recebe colunas e eventos posicionados no
// tempo. Toda a regra (quem é closer, o que está ocupado) fica na AgendaCalendar.
// -----------------------------------------------------------------------------

import { layoutEvents, verticalPosition, shortTime, type TimedItem } from "@/lib/qs/calendarLayout";

/** Altura de uma hora, em pixels. Define a densidade da grade toda. */
const HOUR_PX = 56;

export interface GridColumn {
  key: string;
  label: string;
  sublabel?: string;
  /** Dia que esta coluna representa (na visão de dia, todas repetem o mesmo). */
  date: Date;
  /** Preenchido quando a coluna É um closer (visão de dia). */
  closerId?: string;
  isToday?: boolean;
  accent?: string;
  muted?: boolean;
}

export interface GridEvent extends TimedItem {
  id: string;
  columnKey: string;
  title: string;
  subtitle?: string;
  color: string;
  /** Reunião cancelada/no-show fica esmaecida e riscada. */
  faded?: boolean;
  strikethrough?: boolean;
}

/** Faixa disponível do dia, em minutos desde a meia-noite. */
export interface AvailBand {
  startMin: number;
  endMin: number;
}

interface TimeGridProps {
  columns: GridColumn[];
  events: GridEvent[];
  startHour: number;
  endHour: number;
  /** Só passe quando as faixas forem inequívocas (1 closer filtrado) — senão o
   *  sombreado mente sobre a disponibilidade de quem. */
  availability?: Record<string, AvailBand[]>;
  onSelectSlot?: (column: GridColumn, when: Date) => void;
  onSelectEvent?: (eventId: string) => void;
  /** Granularidade do clique numa área vazia (minutos). */
  slotMinutes?: number;
}

export default function TimeGrid({
  columns,
  events,
  startHour,
  endHour,
  availability,
  onSelectSlot,
  onSelectEvent,
  slotMinutes = 30,
}: TimeGridProps) {
  const hours = Array.from({ length: Math.max(1, endHour - startHour) }, (_, i) => startHour + i);
  const totalHeight = hours.length * HOUR_PX;
  const totalMin = hours.length * 60;
  const cellsPerHour = Math.max(1, Math.round(60 / slotMinutes));

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes() - startHour * 60;
  const nowPct = (nowMin / totalMin) * 100;
  const nowVisible = nowPct >= 0 && nowPct <= 100;

  const template = `56px repeat(${columns.length}, minmax(0, 1fr))`;

  return (
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      {/* Cabeçalho das colunas (fica preso no topo ao rolar) */}
      <div
        className="grid sticky top-0 z-20 bg-white border-b border-gray-100"
        style={{ gridTemplateColumns: template }}
      >
        <div className="border-r border-gray-100" />
        {columns.map((col) => (
          <div
            key={col.key}
            className={`px-2 py-2 text-center border-r border-gray-100 last:border-r-0 ${col.muted ? "opacity-50" : ""}`}
          >
            <div className="flex items-center justify-center gap-1.5">
              {col.accent && (
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col.accent }} />
              )}
              <span
                className={`text-[11px] font-semibold uppercase tracking-wide truncate ${
                  col.isToday ? "text-[#0147FF]" : "text-gray-500"
                }`}
              >
                {col.label}
              </span>
            </div>
            {col.sublabel && (
              <div
                className={`mt-0.5 text-lg font-bold leading-none ${
                  col.isToday
                    ? "inline-flex items-center justify-center w-8 h-8 rounded-full bg-[#0147FF] text-white"
                    : "text-gray-800"
                }`}
              >
                {col.sublabel}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Corpo rolável */}
      <div className="overflow-y-auto" style={{ maxHeight: "62vh" }}>
        <div className="grid relative" style={{ gridTemplateColumns: template }}>
          {/* Régua de horas */}
          <div className="border-r border-gray-100" style={{ height: totalHeight }}>
            {hours.map((h) => (
              <div
                key={h}
                className="relative border-b border-gray-50 pr-2 text-right"
                style={{ height: HOUR_PX }}
              >
                <span className="text-[10px] font-medium text-gray-400 leading-none">
                  {String(h).padStart(2, "0")}h
                </span>
              </div>
            ))}
          </div>

          {/* Uma coluna por dia (semana) ou por closer (dia) */}
          {columns.map((col) => {
            const colEvents = events.filter((e) => e.columnKey === col.key);
            const positioned = layoutEvents(colEvents);
            const bands = availability?.[col.key];

            return (
              <div
                key={col.key}
                className={`relative border-r border-gray-100 last:border-r-0 ${
                  bands ? "bg-gray-50" : ""
                } ${col.muted ? "opacity-60" : ""}`}
                style={{ height: totalHeight }}
              >
                {/* Faixa de atendimento: o resto da coluna fica cinza, o horário
                    em que o closer atende fica claro. */}
                {bands?.map((b, i) => {
                  const top = ((b.startMin - startHour * 60) / totalMin) * 100;
                  const height = ((b.endMin - b.startMin) / totalMin) * 100;
                  if (top + height <= 0 || top >= 100) return null;
                  return (
                    <div
                      key={i}
                      className="absolute left-0 right-0 bg-white"
                      style={{ top: `${Math.max(0, top)}%`, height: `${Math.min(100 - Math.max(0, top), height)}%` }}
                    />
                  );
                })}

                {/* Células clicáveis (agendar direto no horário) */}
                {hours.map((h) =>
                  Array.from({ length: cellsPerHour }, (_, k) => {
                    const when = new Date(col.date);
                    when.setHours(h, k * slotMinutes, 0, 0);
                    return (
                      <button
                        key={`${h}-${k}`}
                        type="button"
                        onClick={onSelectSlot ? () => onSelectSlot(col, when) : undefined}
                        disabled={!onSelectSlot}
                        title={onSelectSlot ? `Agendar ${shortTime(when)}` : undefined}
                        className={`absolute left-0 right-0 border-b ${
                          k === cellsPerHour - 1 ? "border-gray-100" : "border-gray-50 border-dashed"
                        } ${onSelectSlot ? "hover:bg-[#0147FF]/5 cursor-pointer" : "cursor-default"} transition-colors`}
                        style={{
                          top: (h - startHour) * HOUR_PX + (k * HOUR_PX) / cellsPerHour,
                          height: HOUR_PX / cellsPerHour,
                        }}
                      />
                    );
                  })
                )}

                {/* Eventos */}
                {positioned.map(({ item, col: c, cols }) => {
                  const { top, height } = verticalPosition(item.start, item.end, startHour, endHour);
                  const widthPct = 100 / cols;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={onSelectEvent ? () => onSelectEvent(item.id) : undefined}
                      className={`absolute rounded-md px-1.5 py-1 text-left overflow-hidden border-l-[3px] transition-shadow hover:shadow-md hover:z-10 ${
                        item.faded ? "opacity-55" : ""
                      }`}
                      style={{
                        top: `${top}%`,
                        height: `${height}%`,
                        left: `calc(${c * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        background: `${item.color}1A`,
                        borderLeftColor: item.color,
                        color: item.color,
                      }}
                      title={`${shortTime(item.start)} — ${item.title}${item.subtitle ? ` · ${item.subtitle}` : ""}`}
                    >
                      <span
                        className={`block text-[11px] font-bold leading-tight truncate ${
                          item.strikethrough ? "line-through" : ""
                        }`}
                      >
                        {item.title}
                      </span>
                      <span className="block text-[10px] leading-tight opacity-80 truncate">
                        {shortTime(item.start)}
                        {item.subtitle ? ` · ${item.subtitle}` : ""}
                      </span>
                    </button>
                  );
                })}

                {/* Linha do "agora" — só na coluna de hoje */}
                {nowVisible && col.isToday && (
                  <div
                    className="absolute left-0 right-0 z-10 pointer-events-none"
                    style={{ top: `${nowPct}%` }}
                  >
                    <div className="relative border-t-2 border-red-500">
                      <span className="absolute -left-1 -top-[5px] w-2 h-2 rounded-full bg-red-500" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
