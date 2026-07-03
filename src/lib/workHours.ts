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
