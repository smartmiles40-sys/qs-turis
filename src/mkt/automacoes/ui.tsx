// src/mkt/automacoes/ui.tsx
// Peças de tela das automações. Usam as variáveis de cor do app (--bg, --card,
// --ink, --line…) — o modo noturno funciona sozinho. A cor da área é
// var(--mkt), com reserva roxa se a casca do Marketing ainda não a definiu.
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const COR = "var(--mkt, #6D28D9)";
export const COR_SUAVE = "var(--mkt-soft, rgba(109, 40, 217, .10))";

export const MKT_CSS = `
.mkt-input { width: 100%; padding: 8px 11px; border-radius: 9px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font-size: 13.5px; }
.mkt-input:focus { outline: none; border-color: ${COR}; box-shadow: 0 0 0 3px rgba(109,40,217,.22); }
.mkt-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
:is(.mkt-raiz button, .mkt-raiz a, .mkt-raiz [tabindex]):focus-visible { outline: 2px solid ${COR}; outline-offset: 2px; }
`;

type Variante = "primario" | "secundario" | "fantasma" | "perigo";
export function Botao({ variante = "secundario", className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  const estilos: Record<Variante, React.CSSProperties> = {
    primario: { background: COR, color: "#fff", border: `1px solid ${COR}` },
    secundario: { background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" },
    fantasma: { background: "transparent", color: "var(--ink2)", border: "1px solid transparent" },
    perigo: { background: "var(--err-bg, #FEF2F2)", color: "var(--err-ink, #B91C1C)", border: "1px solid var(--err-line, #FECACA)" },
  };
  return (
    <button type="button" {...rest}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      style={{ ...estilos[variante], ...rest.style }}>
      {children}
    </button>
  );
}

export function Campo({ rotulo, dica, children }: { rotulo: string; dica?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold mb-1" style={{ color: "var(--ink2)" }}>{rotulo}</span>
      {children}
      {dica ? <span className="block text-[11px] mt-1" style={{ color: "var(--ink3)" }}>{dica}</span> : null}
    </label>
  );
}

export const Entrada = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`mkt-input ${p.className ?? ""}`} />;
export const AreaTexto = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={`mkt-input ${p.className ?? ""}`} />;
export const Selecao = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`mkt-input ${p.className ?? ""}`} />;

export function Aviso({ tom = "info", children }: { tom?: "info" | "alerta" | "erro" | "ok"; children: ReactNode }) {
  const cores = {
    info: { bg: "var(--card2)", ink: "var(--ink2)" },
    alerta: { bg: "var(--warn-bg, #FFFBEB)", ink: "var(--warn-ink, #92400E)" },
    erro: { bg: "var(--err-bg, #FEF2F2)", ink: "var(--err-ink, #B91C1C)" },
    ok: { bg: "var(--ok-bg, #ECFDF5)", ink: "var(--ok-ink, #047857)" },
  }[tom];
  return <div className="rounded-lg px-3 py-2 text-[12.5px] leading-snug" style={{ background: cores.bg, color: cores.ink }}>{children}</div>;
}

export function Abas<T extends string>({ abas, atual, onTrocar }: { abas: { id: T; rotulo: string }[]; atual: T; onTrocar: (id: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1" role="tablist">
      {abas.map((a) => (
        <button key={a.id} role="tab" aria-selected={a.id === atual} type="button" onClick={() => onTrocar(a.id)}
          className="px-3 py-1.5 rounded-lg text-[13px] font-semibold whitespace-nowrap"
          style={a.id === atual ? { background: COR_SUAVE, color: COR } : { color: "var(--ink2)" }}>
          {a.rotulo}
        </button>
      ))}
    </div>
  );
}

export function Modal({ aberto, titulo, onFechar, children, rodape, largura = 560 }: { aberto: boolean; titulo: string; onFechar: () => void; children: ReactNode; rodape?: ReactNode; largura?: number }) {
  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberto, onFechar]);
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0" style={{ background: "rgba(15,20,26,.45)" }} onClick={onFechar} />
      <div className="relative w-full flex flex-col rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh]" style={{ maxWidth: largura, background: "var(--card)", border: "1px solid var(--line)" }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: "var(--line)" }}>
          <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>{titulo}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="p-1 text-lg leading-none" style={{ color: "var(--ink3)" }}>×</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {rodape && <div className="flex justify-end gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--line)" }}>{rodape}</div>}
      </div>
    </div>
  );
}

export function Chip({ children, cor }: { children: ReactNode; cor?: string }) {
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: cor ? `${cor}22` : COR_SUAVE, color: cor ?? COR }}>{children}</span>;
}

export function quando(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function Carregando() {
  return <div className="py-10 text-center text-sm" style={{ color: "var(--ink3)" }}>Carregando…</div>;
}
