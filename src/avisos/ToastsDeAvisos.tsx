// src/avisos/ToastsDeAvisos.tsx
// -----------------------------------------------------------------------------
// Toast do aviso que acabou de chegar (0315, 05/11/2026): "Antônio respondeu no
// pedido #45" no canto da tela, com clique que abre o pedido. Só aparece com a
// aba à vista — escondida, quem avisa é a notificação do navegador
// (AvisosProvider). Some sozinho em 8 s; no máximo 3 na tela.
// -----------------------------------------------------------------------------
import type { Aviso } from "./lib";

export default function ToastsDeAvisos({ itens, onAbrir, onFechar }: {
  itens: Aviso[];
  onAbrir: (a: Aviso) => void;
  onFechar: (id: number) => void;
}) {
  if (!itens.length) return null;
  return (
    <div role="status" aria-live="polite"
      style={{ position: "fixed", zIndex: 95, right: 16, bottom: "calc(16px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", pointerEvents: "none", maxWidth: "calc(100vw - 32px)" }}>
      {itens.map((a) => (
        <div key={a.id}
          style={{ pointerEvents: "auto", display: "flex", alignItems: "flex-start", gap: 6, width: 360, maxWidth: "100%", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,.18)", animation: "qsToastIn .22s ease-out", fontFamily: "var(--font-sans)" }}>
          <button type="button" onClick={() => onAbrir(a)}
            style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, textAlign: "left", padding: "12px 4px 12px 14px", border: 0, background: "transparent", color: "inherit", cursor: "pointer", font: "inherit" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{a.titulo}</span>
            {a.texto && <span style={{ fontSize: 12.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{a.texto}</span>}
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--info)", marginTop: 2 }}>Abrir pedido</span>
          </button>
          <button type="button" aria-label="Fechar aviso" onClick={() => onFechar(a.id)}
            style={{ flexShrink: 0, width: 32, height: 32, margin: 6, border: 0, borderRadius: 8, background: "transparent", color: "var(--muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      ))}
      <style>{`@keyframes qsToastIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
