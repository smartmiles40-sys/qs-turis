// src/components/sdr/telefone/WebphoneWidget.tsx
// -----------------------------------------------------------------------------
// UI flutuante da ligação WebRTC (VoxFree). O JsSIP não traz interface própria,
// então este widget desenha o estado da chamada: conectando / tocando / em
// ligação, com cronômetro em destaque, avatar, e as ações Mudo, Teclado (DTMF),
// Anotar (grava no lead) e Desligar. Fica escondido quando não há chamada.
//
// É apenas apresentacional: assina o estado em webphone.ts (subscribeWebphone) e
// chama as ações. O áudio remoto é gerido pelo próprio webphone.ts.
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  subscribeWebphone,
  hangupWebphone,
  toggleMuteWebphone,
  sendDtmf,
  saveCallNote,
  type WebphoneState,
} from "@/lib/webphone";

// ── Ícones (inline SVG, traço fino no estilo do app) ─────────────────────────
const ic = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const IconMic = () => (<svg {...ic}><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v1a7 7 0 0 1-14 0v-1" /><line x1="12" y1="19" x2="12" y2="22" /></svg>);
const IconMicOff = () => (<svg {...ic}><line x1="2" y1="2" x2="22" y2="22" /><path d="M9 9v2a3 3 0 0 0 5.12 2.12" /><path d="M15 9.34V5a3 3 0 0 0-5.94-.6" /><path d="M19 10v1a7 7 0 0 1-11.3 5.5" /><path d="M5 10v1a7 7 0 0 0 .3 2" /><line x1="12" y1="19" x2="12" y2="22" /></svg>);
const IconKeypad = () => (<svg {...ic}><circle cx="5" cy="5" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="19" cy="5" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="19" r="1" /><circle cx="12" cy="19" r="1" /><circle cx="19" cy="19" r="1" /></svg>);
const IconNote = () => (<svg {...ic}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>);
const IconHangup = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" transform="rotate(135 12 12)" /></svg>);

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

function initials(name?: string | null): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const LABELS: Record<WebphoneState["status"], string> = {
  idle: "",
  registering: "Conectando ao servidor…",
  connecting: "Chamando…",
  ringing: "Tocando…",
  in_call: "Em ligação",
  ended: "Chamada encerrada",
};

const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

// `demo` é usado só pela página de preview (webfone-preview.html) para renderizar
// o widget com dados de mentira, sem chamada real. Em produção nunca é passado.
export default function WebphoneWidget({ demo }: { demo?: WebphoneState } = {}) {
  const [subscribed, setSubscribed] = useState<WebphoneState | null>(null);
  const [panel, setPanel] = useState<"none" | "keypad" | "notes">("none");
  const [dtmf, setDtmf] = useState("");
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [localMuted, setLocalMuted] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (demo) return; return subscribeWebphone(setSubscribed); }, [demo]);
  const st = demo ?? subscribed;

  const inCall = st?.status === "in_call";
  const now = useNow(inCall);

  // Reseta os painéis quando a chamada acaba.
  useEffect(() => {
    if (!st || st.status === "idle" || st.status === "ended") {
      setPanel("none"); setDtmf(""); setNote(""); setNoteSaved(false);
    }
  }, [st?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st || st.status === "idle") return null;

  const elapsed = inCall && st.answeredAt ? Math.max(0, Math.round((now - st.answeredAt) / 1000)) : 0;
  const active = st.status === "connecting" || st.status === "ringing" || st.status === "in_call";
  const name = st.peerName?.trim();
  const number = st.peerNumber;
  const inits = initials(name);
  const muted = demo ? localMuted : !!st.muted;

  function pressDtmf(k: string) {
    sendDtmf(k);
    setDtmf((d) => (d + k).slice(-16));
  }

  async function handleSaveNote() {
    const text = note.trim();
    if (!text || !st?.leadId) return;
    if (demo) { setNote(""); setNoteSaved(true); setTimeout(() => setNoteSaved(false), 2500); return; }
    setSavingNote(true);
    const ok = await saveCallNote(st.leadId, text);
    setSavingNote(false);
    if (ok) { setNote(""); setNoteSaved(true); setTimeout(() => setNoteSaved(false), 2500); }
  }

  const headerClass = inCall
    ? "bg-gradient-to-r from-emerald-500 to-emerald-600"
    : st.status === "ended" ? "bg-gray-600" : "bg-gray-900";

  return (
    <div
      className="qs-webphone-card fixed z-[80] bottom-4 left-4 w-[min(340px,calc(100vw-2rem))] rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden"
      role="dialog"
      aria-label="Ligação em andamento"
    >
      {/* Cabeçalho: estado + cronômetro em destaque */}
      <div className={`px-4 py-2.5 flex items-center gap-2 text-white ${headerClass}`}>
        <span className={`inline-block w-2 h-2 rounded-full ${inCall ? "bg-emerald-100 animate-pulse" : "bg-white/70"}`} />
        <span className="text-[13px] font-semibold tracking-wide">{LABELS[st.status]}</span>
        {inCall && <span className="ml-auto text-lg font-mono font-semibold tabular-nums leading-none">{fmt(elapsed)}</span>}
      </div>

      {/* Contato */}
      <div className="px-4 py-3 flex items-center gap-3">
        <div className={`flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold ${inCall ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
          {inits || (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-gray-900 truncate leading-tight">{name || "Ligação"}</p>
          {number && <p className="text-[13px] text-gray-500 tabular-nums">{number}</p>}
        </div>
      </div>

      {/* Painel do teclado (DTMF) */}
      {active && panel === "keypad" && (
        <div className="px-4 pb-3">
          {dtmf && <div className="mb-2 text-center text-lg font-mono tabular-nums text-gray-700 bg-gray-50 rounded-lg py-1.5 tracking-widest">{dtmf}</div>}
          <div className="grid grid-cols-3 gap-2">
            {DTMF_KEYS.map((k) => (
              <button key={k} onClick={() => pressDtmf(k)}
                className="py-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-lg font-semibold text-gray-800 transition">
                {k}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Painel de anotação */}
      {active && panel === "notes" && (
        <div className="px-4 pb-3">
          {st.leadId ? (
            <>
              <textarea
                ref={noteRef}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anotação sobre a ligação…"
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 resize-none"
              />
              <div className="flex items-center gap-2 mt-2">
                <button onClick={handleSaveNote} disabled={savingNote || !note.trim()}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50" style={{ background: "#0147FF" }}>
                  {savingNote ? "Salvando…" : "Salvar no lead"}
                </button>
                {noteSaved && <span className="text-xs font-medium text-green-600">Salvo no lead + Bitrix ✓</span>}
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400 py-2">Ligação manual (sem lead vinculado) — anotação indisponível.</p>
          )}
        </div>
      )}

      {/* Ações */}
      {active && (
        <div className="px-3 pb-3 pt-1 flex items-center gap-1.5 border-t border-gray-100">
          <ActionBtn label="Mudo" active={muted} onClick={() => (demo ? setLocalMuted((m) => !m) : toggleMuteWebphone())} tone="amber">
            {muted ? <IconMicOff /> : <IconMic />}
          </ActionBtn>
          <ActionBtn label="Teclado" active={panel === "keypad"} onClick={() => setPanel((p) => (p === "keypad" ? "none" : "keypad"))}>
            <IconKeypad />
          </ActionBtn>
          <ActionBtn label="Anotar" active={panel === "notes"} onClick={() => { setPanel((p) => (p === "notes" ? "none" : "notes")); setTimeout(() => noteRef.current?.focus(), 50); }}>
            <IconNote />
          </ActionBtn>
          <button
            onClick={() => hangupWebphone()}
            className="ml-auto flex-shrink-0 w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-sm transition"
            aria-label="Desligar"
            title="Desligar"
          >
            <IconHangup />
          </button>
        </div>
      )}

      {st.status === "ended" && st.error && <p className="px-4 pb-3 -mt-1 text-xs text-red-600">{st.error}</p>}
    </div>
  );
}

function ActionBtn({ children, label, active, onClick, tone = "blue" }: {
  children: ReactNode; label: string; active?: boolean; onClick: () => void; tone?: "blue" | "amber";
}) {
  const on = tone === "amber"
    ? "bg-amber-50 border-amber-300 text-amber-700"
    : "bg-blue-50 border-blue-300 text-blue-700";
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl border text-[10px] font-medium transition ${
        active ? on : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
      }`}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}
