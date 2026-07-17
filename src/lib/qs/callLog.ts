// src/lib/qs/callLog.ts
// -----------------------------------------------------------------------------
// Log ESTRUTURADO de ligações (tabela qs_call_logs, migration 0020). Grava UMA
// linha por chamada encerrada — atendida ou não, com ou sem lead vinculado — pra
// alimentar as análises de telefonia (atendimento por horário, duração por SDR).
//
// TELEMETRIA FIRE-AND-FORGET: nunca joga erro. Se o insert falhar (tabela ainda
// não criada, RLS, rede), apenas console.warn e segue — o fluxo da ligação NÃO
// pode ser atrapalhado por um log que não gravou.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";

/** Provedor da chamada. Hoje o Painel loga sem distinguir (callback único). */
export type CallProvider = "wavoip" | "webrtc";

/** Mesmo formato do CallEndedInfo emitido por wavoip.ts e webphone.ts. */
export interface CallEndedInfo {
  leadId: string | null;
  phone: string | null;
  answered: boolean;
  durationSec: number;
}

// owner_id é uuid: o usuário "demo-skip" do bypass de login NÃO é uuid válido,
// então nesse caso gravamos owner_id null (mesma guarda do MeetingsPage).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function logCallEnded(info: CallEndedInfo, provider?: CallProvider): Promise<void> {
  try {
    // getSession (não getUser): lê o dono do localStorage sem round-trip ao
    // servidor — mesmo padrão do saveCallNote no webphone.ts.
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess?.session?.user?.id ?? null;
    const ownerId = uid && UUID_RE.test(uid) ? uid : null;

    await supabase.from("qs_call_logs").insert({
      owner_id: ownerId,
      lead_id: info.leadId ?? null,
      phone: info.phone ?? null,
      answered: !!info.answered,
      duration_sec: Math.max(0, Math.round(info.durationSec ?? 0)),
      provider: provider ?? null,
    });
  } catch (e) {
    console.warn("[call-log] não foi possível registrar a ligação:", e);
  }
}
