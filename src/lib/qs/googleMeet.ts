// src/lib/qs/googleMeet.ts
// -----------------------------------------------------------------------------
// Pede ao servidor que crie o evento no Google Calendar (com sala do Meet) para
// uma reunião já gravada no QS.
//
// Quem fala com o Google é o n8n, e quem fala com o n8n é /api/meet-create — o
// segredo do webhook não pode existir no navegador. Aqui é só a ponte.
//
// REGRA DE OURO: isto NUNCA derruba o fluxo do Ganho. A reunião já está gravada
// no QS quando esta função é chamada; o Meet é um bônus. Integração desligada,
// n8n fora do ar ou Google recusando viram aviso, nunca exceção.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";

export interface ResultadoMeet {
  ok: boolean;
  /** Link da sala do Meet, quando o Google devolveu um. */
  meetLink?: string | null;
  /** Link pra abrir o evento na agenda (suporte/depuração). */
  htmlLink?: string | null;
  /** Motivo curto pra mostrar ao SDR. Só vem quando ok = false. */
  aviso?: string;
  /** A integração nem está ligada — não é falha, é ausência. */
  desligado?: boolean;
}

export async function criarEventoNoGoogle(meetingId: string): Promise<ResultadoMeet> {
  try {
    const { data: sessao } = await supabase.auth.getSession();
    const token = sessao?.session?.access_token;
    if (!token) return { ok: false, aviso: "sessão expirada" };

    const r = await fetch("/api/meet-create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ access_token: token, meeting_id: meetingId }),
    });

    // 501 = N8N_AGENDA_URL não configurada. Silêncio: quem não ligou a
    // integração não precisa ver erro toda vez que marca um ganho.
    if (r.status === 501) return { ok: false, desligado: true };

    const json = await r.json().catch(() => null);
    if (!r.ok || !json?.success) {
      return { ok: false, aviso: json?.error || `falha ${r.status}` };
    }
    return { ok: true, meetLink: json.meet_link ?? null, htmlLink: json.html_link ?? null };
  } catch (e) {
    // Rede caiu / navegador bloqueou: o Ganho segue valendo.
    return { ok: false, aviso: e instanceof Error ? e.message : "falha de rede" };
  }
}
