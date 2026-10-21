// src/solicitacoes/cores.tsx
import type { ReactNode } from "react";

// Fora das áreas (Comercial): as cores e classes da central presas a este pedaço
// da tela, no azul do Comercial — sem mexer no :root do app.
const CORES_CENTRAL = `
.cores-central { --rel: #0147FF; --rel-hover: #0038CC; --rel-ink: #0038CC; --rel-soft: #E6EDFF; }
html.dark .cores-central { --rel-ink: #8FB0FF; --rel-soft: rgba(1, 71, 255, .16); }
.cores-central .rel-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
.cores-central .rel-linha:hover { background: var(--card2); }
.cores-central .rel-input { width: 100%; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font-size: 14px; }
.cores-central .rel-input:focus { outline: none; border-color: var(--rel); box-shadow: 0 0 0 3px rgba(1, 71, 255, .22); }
`;

export function ComCoresDaCentral({ children }: { children: ReactNode }) {
  return (
    <div className="cores-central contents">
      <style>{CORES_CENTRAL}</style>
      {children}
    </div>
  );
}
