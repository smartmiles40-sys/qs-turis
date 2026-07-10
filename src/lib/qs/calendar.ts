// src/lib/qs/calendar.ts
// -----------------------------------------------------------------------------
// Convite de agenda para reuniões (reduz no-show): link "adicionar ao Google
// Agenda" e download de .ics (Outlook/Apple/qualquer calendário).
// Fase 2 (futura): convite automático por e-mail via integração Google Calendar.
// -----------------------------------------------------------------------------

export interface CalendarEvent {
  title: string;
  startsAt: string;          // ISO
  durationMin?: number | null;
  description?: string | null;
  location?: string | null;  // local ou link do Meet
}

/** AAAAMMDDTHHMMSSZ (UTC) — formato que Google e .ics esperam. */
function toCalStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function eventRange(ev: CalendarEvent): { start: string; end: string } {
  const start = new Date(ev.startsAt);
  const end = new Date(start.getTime() + (ev.durationMin && ev.durationMin > 0 ? ev.durationMin : 30) * 60_000);
  return { start: toCalStamp(start.toISOString()), end: toCalStamp(end.toISOString()) };
}

/** Link que abre o Google Agenda com o evento pré-preenchido. */
export function googleCalendarUrl(ev: CalendarEvent): string {
  const { start, end } = eventRange(ev);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${start}/${end}`,
  });
  if (ev.description) params.set("details", ev.description);
  if (ev.location) params.set("location", ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Baixa um .ics do evento (Outlook, Apple Calendar, etc.). */
export function downloadIcs(ev: CalendarEvent): void {
  const { start, end } = eventRange(ev);
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//QS Turis//Reunioes//PT-BR",
    "BEGIN:VEVENT",
    `UID:${Date.now()}-${Math.random().toString(36).slice(2)}@qs-turis`,
    `DTSTAMP:${toCalStamp(new Date().toISOString())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${esc(ev.title)}`,
    ev.description ? `DESCRIPTION:${esc(ev.description)}` : "",
    ev.location ? `LOCATION:${esc(ev.location)}` : "",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Lembrete da reunião",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reuniao-${new Date(ev.startsAt).toISOString().slice(0, 10)}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
