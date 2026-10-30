// src/mkt/email/ui.tsx — peças pequenas das telas de e-mail (usam as variáveis
// de cor do app: --card, --ink, --line…, então o modo noturno vem de graça).
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export const MKE_CSS = `
:root { --mke: #0E7C6A; --mke-soft: #E4F4EF; }
html.dark { --mke-soft: rgba(43,192,166,.14); }
.mke-input { width:100%; padding:8px 11px; border-radius:9px; border:1px solid var(--line); background:var(--card); color:var(--ink); font-size:14px; }
.mke-input:focus { outline:none; border-color:var(--mke); box-shadow:0 0 0 3px rgba(14,124,106,.25); }
.mke-card { background:var(--card); border:1px solid var(--line); border-radius:14px; }
.mke-tab[aria-selected="true"] { background:var(--mke-soft); color:var(--ink); font-weight:600; }
:is(.mke button, .mke a, .mke select):focus-visible { outline:2px solid var(--mke); outline-offset:2px; }
`;

export function Tela({ titulo, sub, acoes, children }: { titulo: string; sub?: ReactNode; acoes?: ReactNode; children: ReactNode }) {
  return (
    <div className="mke p-4 sm:p-6 max-w-6xl mx-auto" style={{ color: "var(--ink)" }}>
      <style>{MKE_CSS}</style>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold">{titulo}</h1>
          {sub ? <p className="text-sm mt-1" style={{ color: "var(--ink2)" }}>{sub}</p> : null}
        </div>
        {acoes ? <div className="flex flex-wrap gap-2">{acoes}</div> : null}
      </div>
      {children}
    </div>
  );
}

type Variante = "primario" | "secundario" | "fantasma" | "perigo";
export function Botao({ variante = "secundario", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  const v: Record<Variante, React.CSSProperties> = {
    primario: { background: "var(--mke)", color: "#fff", border: "1px solid var(--mke)" },
    secundario: { background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" },
    fantasma: { background: "transparent", color: "var(--ink2)", border: "1px solid transparent" },
    perigo: { background: "transparent", color: "var(--red)", border: "1px solid var(--red)" },
  };
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 ${className}`}
      style={{ ...v[variante], ...rest.style }}
    />
  );
}

export function Campo({ rotulo, dica, children }: { rotulo: string; dica?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold mb-1" style={{ color: "var(--ink2)" }}>{rotulo}</span>
      {children}
      {dica ? <span className="block text-[11px] mt-1" style={{ color: "var(--ink2)" }}>{dica}</span> : null}
    </label>
  );
}

export const Entrada = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`mke-input ${p.className ?? ""}`} />;
export const Area = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`mke-input ${p.className ?? ""}`} />;
export const Escolha = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`mke-input ${p.className ?? ""}`} />;

export function Aviso({ tom = "aviso", children }: { tom?: "aviso" | "erro" | "ok"; children: ReactNode }) {
  const cor = tom === "erro" ? "var(--red)" : tom === "ok" ? "var(--green)" : "#B7791F";
  return (
    <div role={tom === "erro" ? "alert" : "status"} className="rounded-lg px-3 py-2 text-[13px] mb-3" style={{ border: `1px solid ${cor}`, color: "var(--ink)", background: "var(--card2)" }}>
      {children}
    </div>
  );
}

export function Etiqueta({ children, tom = "neutro" }: { children: ReactNode; tom?: "neutro" | "ok" | "aviso" | "erro" | "ativo" }) {
  const cor = { neutro: "var(--ink2)", ok: "var(--green)", aviso: "#B7791F", erro: "var(--red)", ativo: "var(--mke)" }[tom];
  return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ border: `1px solid ${cor}`, color: cor }}>{children}</span>;
}

export function Vazio({ texto, acao }: { texto: string; acao?: ReactNode }) {
  return (
    <div className="mke-card p-8 text-center text-sm" style={{ color: "var(--ink2)" }}>
      <p>{texto}</p>
      {acao ? <div className="mt-3">{acao}</div> : null}
    </div>
  );
}

export function Numero({ rotulo, valor, sub }: { rotulo: string; valor: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mke-card px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>{rotulo}</div>
      <div className="text-2xl font-bold tabular-nums mt-0.5">{valor}</div>
      {sub ? <div className="text-xs mt-0.5" style={{ color: "var(--ink2)" }}>{sub}</div> : null}
    </div>
  );
}
