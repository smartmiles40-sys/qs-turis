// src/components/sdr/disparos/pecas.tsx
// Peças pequenas das telas de disparo (modal, campo, chips). Só tokens do
// redesign (ui.css), então servem igual no Comercial e no Relacionamento.
import { useEffect, type ReactNode } from "react";

export const INPUT =
  "w-full rounded-lg border px-3 py-2 text-[14px] outline-none focus:border-[var(--text)]";
export const INPUT_ESTILO = { background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" };

export function Campo({ rotulo, dica, children }: { rotulo: string; dica?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="qs-label block">{rotulo}</span>
      {children}
      {dica && <span className="block text-[12px]" style={{ color: "var(--subtle)" }}>{dica}</span>}
    </label>
  );
}

export function Modal({ aberto, titulo, onFechar, rodape, largura = 680, children }: {
  aberto: boolean; titulo: ReactNode; onFechar: () => void; rodape?: ReactNode; largura?: number; children: ReactNode;
}) {
  useEffect(() => {
    if (!aberto) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [aberto, onFechar]);
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: "rgba(0,0,0,.35)" }}
         onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div role="dialog" aria-modal="true" className="qs-card w-full my-8 flex flex-col" style={{ maxWidth: largura }}>
        <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 className="text-[16px] font-semibold" style={{ color: "var(--text)" }}>{titulo}</h2>
          <button type="button" className="qs-btn qs-btn--ghost qs-btn--sm" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">{children}</div>
        {rodape && <div className="flex flex-wrap justify-end gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--border)" }}>{rodape}</div>}
      </div>
    </div>
  );
}

/** Lista de escolhas múltiplas em chips (fonte, SDR, etapa, nível…). */
export function Chips<T extends string>({ opcoes, valor, onChange }: {
  opcoes: { id: T; rotulo: string }[]; valor: T[]; onChange: (v: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opcoes.map((o) => {
        const on = valor.includes(o.id);
        return (
          <button key={o.id} type="button" aria-pressed={on}
                  onClick={() => onChange(on ? valor.filter((x) => x !== o.id) : [...valor, o.id])}
                  className="rounded-full border px-2.5 py-1 text-[12.5px]"
                  style={on
                    ? { background: "var(--text)", color: "var(--surface)", borderColor: "var(--text)" }
                    : { background: "var(--surface)", color: "var(--muted)", borderColor: "var(--border)" }}>
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

/** A bolha do WhatsApp com o texto do modelo (prévia). */
export function Bolha({ titulo, texto, rodape, botao }: { titulo?: string | null; texto: string; rodape?: string | null; botao?: string | null }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "#E5DDD5" }}>
      <div className="max-w-[340px] rounded-lg bg-white px-3 py-2 shadow-sm text-[13.5px] text-gray-900">
        {titulo && <p className="font-semibold mb-1">{titulo}</p>}
        <p className="whitespace-pre-wrap break-words">{texto || "…"}</p>
        {rodape && <p className="mt-1 text-[11.5px] text-gray-500">{rodape}</p>}
        {botao && <p className="mt-2 border-t pt-1.5 text-center text-[13px] text-sky-600">{botao}</p>}
      </div>
    </div>
  );
}
