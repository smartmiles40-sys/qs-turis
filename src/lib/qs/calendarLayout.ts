// src/lib/qs/calendarLayout.ts
// -----------------------------------------------------------------------------
// A matemática do calendário — sem React, sem banco, só datas.
//
// Duas coisas moram aqui:
//   1) navegação por período (grade do mês, semana começando no domingo, etc.);
//   2) o layout de eventos SOBREPOSTOS na grade de horas — o algoritmo que faz
//      duas reuniões no mesmo horário aparecerem lado a lado, com metade da
//      largura cada, do jeito que o Google Agenda faz.
//
// Fica separado da UI porque é a parte que dá errado silenciosamente: um bug
// aqui não quebra a tela, só desenha a reunião no lugar errado.
// -----------------------------------------------------------------------------

export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const WEEKDAY_LONG = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const MONTH_LONG = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export type CalendarView = "mes" | "semana" | "dia";

// ── Navegação por data ──────────────────────────────────────────────────────

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  // Vai pro dia 1 antes de somar: senão 31/jan + 1 mês vira 3/mar.
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  return x;
}

/** Domingo da semana de `d` (semana brasileira: Dom → Sáb). */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

/**
 * A grade do mês: SEMPRE 6 semanas × 7 dias (42 células), começando no domingo
 * da semana do dia 1. Altura fixa evita a grade "pular" ao trocar de mês.
 */
export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function weekGrid(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Intervalo [from, to) que a visualização precisa carregar do banco. */
export function viewRange(view: CalendarView, anchor: Date): { from: Date; to: Date } {
  if (view === "dia") {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1) };
  }
  if (view === "semana") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  const grid = monthGrid(anchor);
  return { from: grid[0], to: addDays(grid[41], 1) };
}

export function periodLabel(view: CalendarView, anchor: Date): string {
  if (view === "dia") {
    return `${WEEKDAY_LONG[anchor.getDay()]}, ${anchor.getDate()} de ${MONTH_LONG[anchor.getMonth()]}`;
  }
  if (view === "semana") {
    const days = weekGrid(anchor);
    const a = days[0];
    const b = days[6];
    if (a.getMonth() === b.getMonth()) {
      return `${a.getDate()} – ${b.getDate()} de ${MONTH_LONG[a.getMonth()]} de ${a.getFullYear()}`;
    }
    return `${a.getDate()} de ${MONTH_LONG[a.getMonth()]} – ${b.getDate()} de ${MONTH_LONG[b.getMonth()]} de ${b.getFullYear()}`;
  }
  return `${MONTH_LONG[anchor.getMonth()]} de ${anchor.getFullYear()}`;
}

// ── Formatação ──────────────────────────────────────────────────────────────

export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "14:00" ou "14:30" — no ponto certo, sem os ":00" redundantes ficarem feios. */
export function shortTime(d: Date): string {
  const m = d.getMinutes();
  return m === 0 ? `${d.getHours()}h` : `${d.getHours()}:${String(m).padStart(2, "0")}`;
}

// ── Layout de eventos sobrepostos ───────────────────────────────────────────

export interface TimedItem {
  start: Date;
  end: Date;
}

export interface Positioned<T extends TimedItem> {
  item: T;
  /** Coluna que o evento ocupa dentro do grupo de sobreposição (0-based). */
  col: number;
  /** Quantas colunas o grupo tem — a largura do evento é 1/cols. */
  cols: number;
}

/**
 * Distribui eventos sobrepostos em colunas.
 *
 * Como funciona: os eventos são varridos em ordem de início. Enquanto um evento
 * começa ANTES do fim do grupo atual, ele entra nesse grupo. Dentro do grupo,
 * cada evento pega a primeira coluna cujo último ocupante já terminou. No fim do
 * grupo, todos recebem o mesmo `cols` — é isso que faz duas reuniões simultâneas
 * ficarem com 50% de largura cada, e uma sozinha ocupar 100%.
 */
export function layoutEvents<T extends TimedItem>(events: T[]): Positioned<T>[] {
  const sorted = [...events].sort((a, b) => {
    const d = a.start.getTime() - b.start.getTime();
    return d !== 0 ? d : b.end.getTime() - a.end.getTime();
  });

  const out: Positioned<T>[] = [];
  let group: Positioned<T>[] = [];
  let groupEnd = -Infinity;
  // Fim do último evento de cada coluna do grupo corrente.
  let colEnds: number[] = [];

  const flush = () => {
    const cols = colEnds.length || 1;
    for (const p of group) out.push({ ...p, cols });
    group = [];
    colEnds = [];
    groupEnd = -Infinity;
  };

  for (const ev of sorted) {
    const s = ev.start.getTime();
    const e = ev.end.getTime();

    if (group.length && s >= groupEnd) flush();

    let col = colEnds.findIndex((end) => end <= s);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(e);
    } else {
      colEnds[col] = e;
    }

    group.push({ item: ev, col, cols: 1 });
    groupEnd = Math.max(groupEnd, e);
  }
  if (group.length) flush();

  return out;
}

/**
 * Posição vertical de um evento na grade de horas, em PORCENTAGEM da altura do
 * dia visível [dayStartHour, dayEndHour). Trabalhar em % (e não em pixels) deixa
 * a grade responsiva de graça.
 */
export function verticalPosition(
  start: Date,
  end: Date,
  dayStartHour: number,
  dayEndHour: number
): { top: number; height: number } {
  const totalMin = (dayEndHour - dayStartHour) * 60;
  const startMin = start.getHours() * 60 + start.getMinutes() - dayStartHour * 60;
  const endMin = end.getHours() * 60 + end.getMinutes() - dayStartHour * 60;
  // Evento que atravessa a meia-noite ou começa antes da grade é aparado.
  const top = Math.max(0, (startMin / totalMin) * 100);
  const bottom = Math.min(100, (endMin / totalMin) * 100);
  return { top, height: Math.max(1.2, bottom - top) };
}

/**
 * A faixa de horas que a grade mostra. Sai da disponibilidade real dos closers
 * (com 1h de folga em cima e embaixo) em vez de um 00–24 fixo: a grade abre já
 * no horário em que a operação acontece, sem scroll até as 9h.
 */
export function gridHourRange(
  windows: { start_time: string; end_time: string }[],
  events: TimedItem[] = []
): { startHour: number; endHour: number } {
  let min = 23;
  let max = 0;
  for (const w of windows) {
    min = Math.min(min, parseInt(w.start_time.slice(0, 2), 10));
    max = Math.max(max, Math.ceil(parseInt(w.end_time.slice(0, 2), 10) + (parseInt(w.end_time.slice(3, 5), 10) > 0 ? 1 : 0)));
  }
  for (const e of events) {
    min = Math.min(min, e.start.getHours());
    max = Math.max(max, e.end.getHours() + (e.end.getMinutes() > 0 ? 1 : 0));
  }
  if (min > max) return { startHour: 8, endHour: 20 }; // sem dados → padrão comercial
  return {
    startHour: Math.max(0, Math.min(min - 1, 22)),
    endHour: Math.min(24, Math.max(max + 1, min + 2)),
  };
}
