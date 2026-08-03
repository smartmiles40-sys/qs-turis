// Preview isolado do seletor de emojis — só pra olhar o desenho sem precisar
// logar no QS e abrir uma conversa. Não entra no build do app.
// O tema escuro é `html.dark`, então alterna com o botão no topo.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import WaEmojiPicker from "../components/sdr/wa/WaEmojiPicker";
import "../index.css";

function Palco({ largura }: { largura: number }) {
  const [texto, setTexto] = useState("Bom dia, Marina! ");
  const [aberto, setAberto] = useState(true);
  return (
    <div className="qs-wa"
         style={{ width: largura, height: 520, display: "flex", flexDirection: "column",
                  justifyContent: "flex-end", border: "1px solid var(--line)",
                  background: "var(--bg)", overflow: "hidden" }}>
      <div className="flex-1" style={{ padding: 12, color: "var(--ink3)", fontSize: 12 }}>
        (conversa) — {largura}px
      </div>
      {aberto && (
        <WaEmojiPicker onPick={(e) => setTexto((t) => t + e)} onClose={() => setAberto(false)} />
      )}
      <div className="wa-composer shrink-0 border-t px-3 py-2.5 flex items-end gap-1.5"
           style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        <button onClick={() => setAberto((v) => !v)} data-wa-emoji-toggle
                data-aberto={aberto || undefined}
                className="wa-icon-btn wa-emoji-toggle shrink-0 w-9 h-9 grid place-items-center rounded-lg">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <circle cx="12" cy="12" r="9.25" />
            <path d="M8.6 14.2a4.3 4.3 0 0 0 6.8 0" />
            <path d="M9.2 9.4h.01M14.8 9.4h.01" strokeWidth="2.4" />
          </svg>
        </button>
        <button className="wa-icon-btn shrink-0 w-9 h-9 grid place-items-center rounded-lg">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.2a3.67 3.67 0 1 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 1 1-2.6-2.6l8.5-8.48" />
          </svg>
        </button>
        <button className="wa-icon-btn shrink-0 w-9 h-9 grid place-items-center rounded-lg">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
          </svg>
        </button>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={1}
                  className="flex-1 min-w-0 resize-none rounded-xl px-3 py-2 text-[14px] outline-none"
                  style={{ border: "1px solid var(--line)", background: "var(--card2)", color: "var(--ink)" }} />
        <button className="wa-send wa-send-btn shrink-0 h-9 rounded-xl text-white text-[13px] font-semibold grid place-items-center">
          <span className="wa-send-label">Enviar</span>
          <svg className="wa-send-icone" width="17" height="17" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 12 3 4.5l3 7.5-3 7.5z" /><path d="M6 12h15.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function App() {
  const [escuro, setEscuro] = useState(false);
  const trocar = () => {
    const v = !escuro;
    setEscuro(v);
    document.documentElement.classList.toggle("dark", v);
  };
  return (
    <div style={{ padding: 24, background: "var(--bg)", minHeight: "100vh" }}>
      <button id="toggle-tema" onClick={trocar}
              style={{ marginBottom: 16, padding: "6px 12px", border: "1px solid var(--line)",
                       borderRadius: 8, color: "var(--ink)", background: "var(--card)" }}>
        {escuro ? "→ claro" : "→ escuro"}
      </button>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <Palco largura={440} />
        <Palco largura={340} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
