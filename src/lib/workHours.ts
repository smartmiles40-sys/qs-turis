// src/lib/workHours.ts
// -----------------------------------------------------------------------------
// Horário de funcionamento da empresa (por dia da semana). Alimenta as métricas
// de tempo do Painel — só conta o que está dentro do expediente. Guardado em
// qs_settings (key = 'work_hours'). Default = o que estava hardcoded no Painel.
// -----------------------------------------------------------------------------

import { supabase } from "./supabase";

export interface DayHours {
  enabled: boolean;
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

// 0 = Domingo ... 6 = Sábado
export type WorkHours = Record<number, DayHours>;

export const WEEKDAY_NAMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export const DEFAULT_WORK_HOURS: WorkHours = {
  0: { enabled: false, start: "09:00", end: "18:00" },
  1: { enabled: true, start: "09:30", end: "19:30" },
  2: { enabled: true, start: "09:30", end: "19:30" },
  3: { enabled: true, start: "09:30", end: "19:30" },
  4: { enabled: true, start: "09:30", end: "19:30" },
  5: { enabled: true, start: "10:00", end: "19:00" },
  6: { enabled: false, start: "09:00", end: "13:00" },
};

export async function loadWorkHours(): Promise<WorkHours> {
  try {
    const { data } = await supabase.from("qs_settings").select("value").eq("key", "work_hours").maybeSingle();
    if (data?.value && typeof data.value === "object") {
      return { ...DEFAULT_WORK_HOURS, ...(data.value as WorkHours) };
    }
  } catch (e) {
    console.warn("[workHours] falha ao carregar, usando default:", e);
  }
  return DEFAULT_WORK_HOURS;
}

export async function saveWorkHours(wh: WorkHours): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("qs_settings")
      .upsert({ key: "work_hours", value: wh, updated_at: new Date().toISOString() }, { onConflict: "key" });
    return !error;
  } catch (e) {
    console.warn("[workHours] falha ao salvar:", e);
    return false;
  }
}

function parseHM(hm: string): [number, number] {
  const [h, m] = hm.split(":").map(Number);
  return [h || 0, m || 0];
}

/** Está dentro do horário de funcionamento agora? */
export function isWithinHours(wh: WorkHours, now = new Date()): boolean {
  const d = wh[now.getDay()];
  if (!d?.enabled) return false;
  const [sh, sm] = parseHM(d.start);
  const [eh, em] = parseHM(d.end);
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= sh * 60 + sm && mins <= eh * 60 + em;
}

/** Minutos já trabalhados hoje (do início do expediente até agora, dentro do horário). */
export function minutesWorkedToday(wh: WorkHours, now = new Date()): number {
  const d = wh[now.getDay()];
  if (!d?.enabled) return 0;
  const [sh, sm] = parseHM(d.start);
  const [eh, em] = parseHM(d.end);
  const start = new Date(now); start.setHours(sh, sm, 0, 0);
  const end = new Date(now); end.setHours(eh, em, 0, 0);
  if (now <= start) return 0;
  const cap = now > end ? end : now;
  return Math.max(0, Math.round((cap.getTime() - start.getTime()) / 60000));
}

/** Minutos que faltam até o fim do expediente de hoje. */
export function minutesLeftToday(wh: WorkHours, now = new Date()): number {
  const d = wh[now.getDay()];
  if (!d?.enabled) return 0;
  const [eh, em] = parseHM(d.end);
  const end = new Date(now); end.setHours(eh, em, 0, 0);
  return Math.max(0, Math.round((end.getTime() - now.getTime()) / 60000));
}

// ─────────────────────────────────────────────────────────────────────────────
// HORÁRIO DE TRABALHO COMO VERDADE ABSOLUTA (agendamento + contagem)
// Regra do Bruno: o QS NUNCA traz um lead/atividade pra fora do expediente. Lead
// que chega às 19:31 (depois do fim) ou no sábado só aparece pro SDR no próximo
// dia útil, no horário de início — nada nasce "atrasado". Estas funções são a
// fonte única disso; scheduling e métricas de dia útil consultam ELAS.
// ─────────────────────────────────────────────────────────────────────────────

/** É dia de trabalho (enabled no work_hours)? */
export function isWorkday(wh: WorkHours, date: Date): boolean {
  return !!wh[date.getDay()]?.enabled;
}

/** Dias da semana habilitados no expediente (0=Dom…6=Sáb). */
export function enabledWeekdays(wh: WorkHours): number[] {
  const out: number[] = [];
  for (let d = 0; d < 7; d++) if (wh[d]?.enabled) out.push(d);
  return out;
}

/**
 * Dias em que uma cadência pode agendar = expediente (verdade absoluta) ∩ dias de
 * execução da cadência. Se a cadência não define dias, usa só o expediente. Se a
 * interseção ficar vazia (config esquisita), cai no expediente inteiro; e se nem
 * o expediente tiver dia, no seg–sex (nunca devolve lista vazia → nada de loop
 * infinito no calendário).
 */
export function scheduleWeekdays(wh: WorkHours, cadenceWeekdays?: number[] | null): number[] {
  const enabled = enabledWeekdays(wh);
  if (!enabled.length) return [1, 2, 3, 4, 5];
  if (cadenceWeekdays && cadenceWeekdays.length) {
    const inter = cadenceWeekdays.filter((d) => enabled.includes(d));
    return inter.length ? inter : enabled;
  }
  return enabled;
}

/**
 * Próximo MOMENTO de trabalho válido a partir de `date` (INCLUSIVE):
 *  • dia útil, antes do início do expediente → o início daquele dia;
 *  • dia útil, dentro da janela → a própria `date`;
 *  • dia útil mas depois do fim, OU dia de folga → início do próximo dia útil.
 * Avança no máx. 14 dias (mesma trava do resto). É o "trazer o lead dentro do
 * horário de trabalho": usado pra 1ª atividade do lead e pros reagendamentos.
 */
export function nextWorkMoment(wh: WorkHours, date: Date): Date {
  const d = new Date(date);
  for (let i = 0; i < 15; i++) {
    const day = wh[d.getDay()];
    if (day?.enabled) {
      const [sh, sm] = parseHM(day.start);
      const [eh, em] = parseHM(day.end);
      const start = new Date(d); start.setHours(sh, sm, 0, 0);
      const end = new Date(d); end.setHours(eh, em, 0, 0);
      if (d.getTime() < start.getTime()) return start;
      if (d.getTime() <= end.getTime()) return new Date(d);
      // depois do fim → cai pro próximo dia (abaixo)
    }
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

/**
 * Mantém o DIA de `date` e encaixa só a HORA na janela do expediente daquele dia
 * (antes do início → início; depois do fim → fim). Dia de folga → devolve `date`
 * inalterada (o chamador escolhe o dia por fora, via scheduleWeekdays). Usado pras
 * atividades FUTURAS da cadência: o dia já é útil, só ajusta o horário.
 */
export function clampToWorkWindow(wh: WorkHours, date: Date): Date {
  const day = wh[date.getDay()];
  if (!day?.enabled) return new Date(date);
  const [sh, sm] = parseHM(day.start);
  const [eh, em] = parseHM(day.end);
  const start = new Date(date); start.setHours(sh, sm, 0, 0);
  const end = new Date(date); end.setHours(eh, em, 0, 0);
  if (date.getTime() < start.getTime()) return start;
  if (date.getTime() > end.getTime()) return end;
  return new Date(date);
}

/**
 * Nº de dias ÚTEIS entre `from` e `to` (exclui o dia de `from`, inclui o de `to`).
 * É o "atraso em dias" honesto: uma tarefa de sexta vista na segunda está 1 dia
 * útil atrasada, não 3 — o fim de semana não infla o atraso (nem vira "atrasada
 * falsa"). Compara por DIA local (zera as horas).
 */
export function workdaysBetween(wh: WorkHours, from: Date, to: Date): number {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to); b.setHours(0, 0, 0, 0);
  if (b.getTime() <= a.getTime()) return 0;
  let count = 0;
  const d = new Date(a);
  for (let i = 0; i < 3660 && d.getTime() < b.getTime(); i++) {
    d.setDate(d.getDate() + 1);
    if (wh[d.getDay()]?.enabled) count++;
  }
  return count;
}

/** Nº de dias úteis numa janela [from, to] INCLUSIVE — denominador de "média/dia". */
export function workdaysInRange(wh: WorkHours, from: Date, to: Date): number {
  const a = new Date(from); a.setHours(0, 0, 0, 0);
  const b = new Date(to); b.setHours(0, 0, 0, 0);
  let count = 0;
  const d = new Date(a);
  for (let i = 0; i < 3660 && d.getTime() <= b.getTime(); i++) {
    if (wh[d.getDay()]?.enabled) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/** Último dia ÚTIL ESTRITAMENTE antes de `date` (p/ "ontem" da retrospectiva não cair num domingo vazio). */
export function previousWorkday(wh: WorkHours, date: Date): Date {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 15; i++) {
    d.setDate(d.getDate() - 1);
    if (wh[d.getDay()]?.enabled) return d;
  }
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAS DE EXECUÇÃO DA CADÊNCIA (dia útil)
// Mesmo ajuste de calendário que o follow-up já fazia (TasksPanel): tarefa não
// cai em dia sem execução. Centralizado aqui pra geração INICIAL do plano usar
// a MESMA regra — antes o "Dia 2" de um lead que entrava na sexta caía no sábado.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Próximo dia de execução válido a partir de `date` (INCLUSIVE: se a própria
 * data já cai num dia permitido, devolve ela). `allowedWeekdays` são os dias da
 * cadência (`execution_weekdays`, 0=Dom…6=Sáb); vazio/ausente = seg–sex.
 * Avança no máximo 14 dias (mesma trava do follow-up). Não mexe no horário.
 */
export function nextExecutionDay(date: Date, allowedWeekdays?: number[] | null): Date {
  const allowed = allowedWeekdays && allowedWeekdays.length > 0 ? allowedWeekdays : [1, 2, 3, 4, 5];
  const d = new Date(date);
  for (let i = 0; i < 14 && !allowed.includes(d.getDay()); i++) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Datas reais do PLANO INICIAL de uma cadência: converte cada `day_number`
 * ("Dia 1", "Dia 2"…) em uma data que respeita os dias de execução:
 *  • cada dia cai no próximo dia PERMITIDO (nextExecutionDay);
 *  • offday_policy "iniciar_imediato" mantém o Dia 1 na data de entrada mesmo
 *    fora dos dias de execução (é o que a opção promete na tela);
 *  • dias distintos do plano nunca colapsam na MESMA data (Dia 6 no sábado e
 *    Dia 7 no domingo não viram duas cobranças na segunda — o seguinte pula
 *    pro próximo dia permitido).
 * Retorna um Map de day_number → Date (com o horário de `base`; o chamador
 * aplica o scheduled_time da atividade por cima).
 */
export function planCadenceDates(
  dayNumbers: number[],
  allowedWeekdays?: number[] | null,
  offdayPolicy?: string | null,
  base: Date = new Date()
): Map<number, Date> {
  const sorted = [...new Set(dayNumbers)].sort((a, b) => a - b);
  const result = new Map<number, Date>();
  let prevMidnight: number | null = null;
  for (const n of sorted) {
    let d = new Date(base);
    d.setDate(d.getDate() + Math.max(0, n - 1));
    const isFirst = prevMidnight === null;
    if (!(isFirst && offdayPolicy === "iniciar_imediato")) {
      d = nextExecutionDay(d, allowedWeekdays);
    }
    if (prevMidnight !== null) {
      const mid = new Date(d); mid.setHours(0, 0, 0, 0);
      if (mid.getTime() <= prevMidnight) {
        const bumped = new Date(prevMidnight + 86_400_000);
        bumped.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
        d = nextExecutionDay(bumped, allowedWeekdays);
      }
    }
    const mid = new Date(d); mid.setHours(0, 0, 0, 0);
    prevMidnight = mid.getTime();
    result.set(n, d);
  }
  return result;
}
