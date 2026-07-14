// src/components/sdr/telefone/WebphoneWidget.tsx
// -----------------------------------------------------------------------------
// UI flutuante da ligação WebRTC (VoxFree). O JsSIP não traz interface própria,
// então este widget desenha o estado da chamada: chamando / tocando / em ligação,
// com cronômetro, mudo e desligar. Fica escondido quando não há chamada.
//
// É puramente apresentacional: assina o estado em webphone.ts (subscribeWebphone)
// e chama hangup/toggleMute. O áudio remoto é gerido pelo próprio webphone.ts.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import {
  subscribeWebphone,
  hangupWebphone,
  toggleMuteWebphone,
  type WebphoneState,
} from "@/lib/webphone";

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const LABELS: Record<WebphoneState["status"], string> = {
  idle: "",
  registering: "Conectando ao servidor…",
  connecting: "Chamando…",
  ringing: "Tocando…",
  in_call: "Em ligação",
  ended: "Chamada encerrada",
};

export default function WebphoneWidget() {
  const [st, setSt] = useState<WebphoneState | null>(null);
  useEffect(() => subscribeWebphone(setSt), []);

  const inCall = st?.status === "in_call";
  const now = useNow(inCall);

  // Só aparece quando há atividade de chamada.
  if (!st || st.status === "idle") return null;

  const elapsed = inCall && st.answeredAt ? Math.max(0, Math.round((now - st.answeredAt) / 1000)) : 0;
  const active = st.status === "connecting" || st.status === "ringing" || st.status === "in_call";
  const name = st.peerName?.trim();
  const number = st.peerNumber;

  return (
    <div
      className="qs-webphone-card fixed z-[80] bottom-4 left-4 w-[280px] rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 overflow-hidden"
      role="dialog"
      aria-label="Ligação em andamento"
    >
      {/* Cabeçalho com o estado */}
      <div className={`px-4 py-3 flex items-center gap-2 ${inCall ? "bg-emerald-600" : "bg-gray-900"} text-white`}>
        <span className={`inline-block w-2 h-2 rounded-full ${inCall ? "bg-emerald-200 animate-pulse" : "bg-white/70"}`} />
        <span className="text-sm font-semibold">{LABELS[st.status]}</span>
        {inCall && <span className="ml-auto text-sm font-mono tabular-nums">{fmt(elapsed)}</span>}
      </div>

      {/* Quem está sendo chamado */}
      <div className="px-4 py-3">
        <p className="text-base font-bold text-gray-900 truncate">{name || "Ligação"}</p>
        {number && <p className="text-sm text-gray-500 tabular-nums">{number}</p>}
        {st.status === "ended" && st.error && <p className="mt-1 text-xs text-red-600">{st.error}</p>}
      </div>

      {/* Ações */}
      {active && (
        <div className="px-4 pb-4 flex items-center gap-2">
          <button
            onClick={() => toggleMuteWebphone()}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold border transition ${
              st.muted
                ? "bg-amber-50 border-amber-300 text-amber-700"
                : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
            }`}
            aria-pressed={st.muted}
          >
            {st.muted ? "🔇 Mudo" : "🎙️ Microfone"}
          </button>
          <button
            onClick={() => hangupWebphone()}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition"
          >
            Desligar
          </button>
        </div>
      )}
    </div>
  );
}
