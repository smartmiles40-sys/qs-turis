// src/controle-comercial/pecas.tsx
// Peças pequenas desta pasta (campo, select, modal) só com os tokens globais
// (tokens.css + ponte.css), pra funcionar igual no SDR, no Closer e na Gestão
// sem depender do REL_CSS que cada área injeta.
import { useEffect, type CSSProperties, type ReactNode } from "react";

export const estiloEntrada: CSSProperties = {
  width: "100%", minHeight: 36, padding: "6px 10px", borderRadius: 8, fontSize: 14,
  background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)",
};

export function Campo({ rotulo, dica, children }: { rotulo: string; dica?: ReactNode; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>{rotulo}</span>
      {children}
      {dica && <span style={{ fontSize: 12, color: "var(--subtle)" }}>{dica}</span>}
    </label>
  );
}

export function Janela({ aberta, titulo, onFechar, children, rodape, largura = 620 }: {
  aberta: boolean; titulo: string; onFechar: () => void; children: ReactNode; rodape?: ReactNode; largura?: number;
}) {
  useEffect(() => {
    if (!aberta) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberta, onFechar]);
  if (!aberta) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0" style={{ background: "rgba(15, 20, 26, .45)" }} onClick={onFechar} />
      <div className="relative w-full flex flex-col rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh]"
        style={{ maxWidth: largura, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{titulo}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="p-1 rounded-md" style={{ color: "var(--subtle)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto" style={{ display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
        {rodape && <div className="flex justify-end gap-2 px-5 py-3.5" style={{ borderTop: "1px solid var(--border)" }}>{rodape}</div>}
      </div>
    </div>
  );
}
