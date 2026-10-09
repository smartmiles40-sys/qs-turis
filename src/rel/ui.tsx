// src/rel/ui.tsx
// -----------------------------------------------------------------------------
// Peças de interface da área de Relacionamento.
//
// O Relacionamento nasceu do zero (09/10/2026) — não reaproveita as telas do
// Comercial. Usa as MESMAS variáveis de cor do app (--bg, --card, --ink...),
// então o modo noturno funciona sozinho, e acrescenta a cor própria da área
// (--rel, verde-petróleo) pra ninguém confundir em qual porta entrou.
// -----------------------------------------------------------------------------
import { useEffect, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";

export const REL_CSS = `
:root {
  --rel: #0E7C6A;          /* fundo com texto branco por cima (5,1:1, WCAG AA) */
  --rel-hover: #0B6B5C;
  --rel-ink: #0B6B5C;      /* texto/realce na cor da área */
  --rel-soft: #E4F4EF;     /* fundo suave (item ativo, chips) */
}
html.dark {
  --rel-ink: #3CCFB3;
  --rel-soft: rgba(43, 192, 166, .14);
}
.rel-input {
  width: 100%;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--card);
  color: var(--ink);
  font-size: 14px;
  transition: border-color .15s, box-shadow .15s;
}
.rel-input::placeholder { color: var(--ink3); }
.rel-input:focus { outline: none; border-color: var(--rel); box-shadow: 0 0 0 3px var(--rel-soft); }
.rel-input[aria-invalid="true"] { border-color: var(--red); }
.rel-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
.rel-linha:hover { background: var(--card2); }
`;

type Variante = "primario" | "secundario" | "fantasma" | "perigo";

export function Botao({ variante = "secundario", className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  const estilos: Record<Variante, React.CSSProperties> = {
    primario: { background: "var(--rel)", color: "#fff", border: "1px solid var(--rel)" },
    secundario: { background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" },
    fantasma: { background: "transparent", color: "var(--ink2)", border: "1px solid transparent" },
    perigo: { background: "var(--err-bg)", color: "var(--err-ink)", border: "1px solid var(--err-line)" },
  };
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      style={{ ...estilos[variante], ...rest.style }}
    >
      {children}
    </button>
  );
}

export function Campo({ rotulo, dica, erro, children }: { rotulo: string; dica?: ReactNode; erro?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>{rotulo}</span>
      {children}
      {erro ? (
        <span className="block text-[11px] mt-1" style={{ color: "var(--err-ink)" }}>{erro}</span>
      ) : dica ? (
        <span className="block text-[11px] mt-1" style={{ color: "var(--ink3)" }}>{dica}</span>
      ) : null}
    </label>
  );
}

export function Entrada(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`rel-input ${props.className ?? ""}`} />;
}

export function Modal({ aberto, titulo, onFechar, children, rodape, largura = 560 }: {
  aberto: boolean;
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
  largura?: number;
}) {
  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberto, onFechar]);
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0" style={{ background: "rgba(15, 20, 26, .45)" }} onClick={onFechar} />
      <div
        className="relative w-full flex flex-col rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh]"
        style={{ maxWidth: largura, background: "var(--card)", border: "1px solid var(--line)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--line)" }}>
          <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>{titulo}</h2>
          <button onClick={onFechar} aria-label="Fechar" className="p-1 rounded-md" style={{ color: "var(--ink3)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {rodape && (
          <div className="flex justify-end gap-2 px-5 py-3.5 border-t" style={{ borderColor: "var(--line)" }}>{rodape}</div>
        )}
      </div>
    </div>
  );
}

export function Avatar({ nome, tamanho = 36 }: { nome: string; tamanho?: number }) {
  const ini = nome.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold flex-shrink-0"
      style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.36, background: "var(--rel-soft)", color: "var(--rel-ink)" }}
    >
      {ini || "?"}
    </span>
  );
}

export function Etiqueta({ children, tom = "neutro" }: { children: ReactNode; tom?: "neutro" | "rel" | "aviso" | "erro" }) {
  const cores = {
    neutro: { background: "var(--card2)", color: "var(--ink2)", border: "1px solid var(--line)" },
    rel: { background: "var(--rel-soft)", color: "var(--rel-ink)", border: "1px solid transparent" },
    aviso: { background: "var(--warn-bg)", color: "var(--warn-ink)", border: "1px solid var(--warn-line)" },
    erro: { background: "var(--err-bg)", color: "var(--err-ink)", border: "1px solid var(--err-line)" },
  }[tom];
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap" style={cores}>{children}</span>;
}

export function Vazio({ titulo, texto, acao }: { titulo: string; texto?: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6">
      <span className="flex items-center justify-center w-12 h-12 rounded-2xl mb-3" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
      </span>
      <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>{titulo}</p>
      {texto && <p className="text-[13px] mt-1 max-w-sm leading-snug" style={{ color: "var(--ink3)" }}>{texto}</p>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}

export function Aviso({ tom = "aviso", children }: { tom?: "aviso" | "erro" | "ok"; children: ReactNode }) {
  const c = {
    aviso: { background: "var(--warn-bg)", color: "var(--warn-ink)", borderColor: "var(--warn-line)" },
    erro: { background: "var(--err-bg)", color: "var(--err-ink)", borderColor: "var(--err-line)" },
    ok: { background: "var(--rel-soft)", color: "var(--rel-ink)", borderColor: "transparent" },
  }[tom];
  return <div className="text-[13px] leading-snug px-3 py-2.5 rounded-lg border" style={c}>{children}</div>;
}
