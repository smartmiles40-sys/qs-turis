// src/lib/qs/agenda.ts
// -----------------------------------------------------------------------------
// Agenda dos closers embutida no QS (Google Agenda via iframe). O admin cola o
// ID da agenda compartilhada (ou a URL de incorporação inteira) em Configurações
// → Agenda; a aba "Agenda" monta o iframe a partir disso. Só VISUALIZAÇÃO — a
// criação de reunião hoje é pelo Bitrix (o Bruno tira depois).
// -----------------------------------------------------------------------------

import { getSetting, setSetting } from "@/lib/qsSettings";

export const GOOGLE_CALENDAR_KEY = "google_calendar_embed";
export const AGENDA_TZ = "America/Sao_Paulo";

export type AgendaMode = "WEEK" | "MONTH" | "AGENDA";

/** true se o valor salvo já é a URL de incorporação completa (colada do Google). */
export function isEmbedUrl(raw: string): boolean {
  return /^https?:\/\//i.test((raw || "").trim());
}

/**
 * Monta o `src` do iframe a partir do que o admin salvou:
 *  - URL completa (começa com http) → usa como está (o modo já vem embutido).
 *  - Um ou mais IDs de agenda separados por vírgula → monta a URL de embed do
 *    Google com fuso BR e o modo escolhido.
 */
export function buildAgendaEmbedSrc(raw: string, mode: AgendaMode = "WEEK"): string {
  const value = (raw || "").trim();
  if (!value) return "";
  if (isEmbedUrl(value)) return value;
  const ids = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return "";
  const srcs = ids.map((id) => `src=${encodeURIComponent(id)}`).join("&");
  const opts = `ctz=${encodeURIComponent(AGENDA_TZ)}&mode=${mode}&wkst=2&showTitle=0&showPrint=0&showCalendars=0&showTz=0`;
  return `https://calendar.google.com/calendar/embed?${srcs}&${opts}`;
}

/** Valor bruto salvo (ID(s) da agenda ou URL de incorporação). "" se não configurado. */
export async function getAgendaEmbed(): Promise<string> {
  return ((await getSetting<string>(GOOGLE_CALENDAR_KEY)) ?? "").trim();
}

/** Salva o ID/URL da agenda (só admin/gestor — RLS de qs_settings). */
export async function saveAgendaEmbed(value: string): Promise<boolean> {
  return setSetting(GOOGLE_CALENDAR_KEY, value.trim());
}
