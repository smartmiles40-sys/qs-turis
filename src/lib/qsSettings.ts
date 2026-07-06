// src/lib/qsSettings.ts
// -----------------------------------------------------------------------------
// Acesso genérico à tabela qs_settings (chave → valor JSON). Usado pelo Horário
// de Trabalho (via workHours.ts) e pela Equipe da reunião (agendadores e
// responsáveis do modal de Ganho).
// -----------------------------------------------------------------------------

import { supabase } from "./supabase";

export async function getSetting<T>(key: string): Promise<T | null> {
  try {
    const { data } = await supabase.from("qs_settings").select("value").eq("key", key).maybeSingle();
    return (data?.value as T) ?? null;
  } catch (e) {
    console.warn(`[qsSettings] falha ao ler '${key}':`, e);
    return null;
  }
}

export async function setSetting(key: string, value: unknown): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("qs_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    return !error;
  } catch (e) {
    console.warn(`[qsSettings] falha ao salvar '${key}':`, e);
    return false;
  }
}

// ── Equipe da reunião (modal de Ganho) ──────────────────────────────────────

export const MEETING_SCHEDULERS_KEY = "meeting_schedulers";
export const MEETING_OWNERS_KEY = "meeting_owners";

export const DEFAULT_MEETING_SCHEDULERS = ["Mariana Rodrigues - SDR", "Victor Hugo - SDR"];
export const DEFAULT_MEETING_OWNERS = ["Talita Carvalho", "Victor Maldonado", "Bruno Matheus", "John Italo"];

export async function loadMeetingTeam(): Promise<{ schedulers: string[]; owners: string[] }> {
  const [schedulers, owners] = await Promise.all([
    getSetting<string[]>(MEETING_SCHEDULERS_KEY),
    getSetting<string[]>(MEETING_OWNERS_KEY),
  ]);
  return {
    schedulers: Array.isArray(schedulers) && schedulers.length > 0 ? schedulers : DEFAULT_MEETING_SCHEDULERS,
    owners: Array.isArray(owners) && owners.length > 0 ? owners : DEFAULT_MEETING_OWNERS,
  };
}

export async function saveMeetingTeam(schedulers: string[], owners: string[]): Promise<boolean> {
  const [a, b] = await Promise.all([
    setSetting(MEETING_SCHEDULERS_KEY, schedulers),
    setSetting(MEETING_OWNERS_KEY, owners),
  ]);
  return a && b;
}
