// src/mkt/drive/ui.tsx — peças visuais do Drive do Marketing.
// Usa só as variáveis de cor do app (--card, --ink, --line...) → modo noturno
// funciona sozinho. A cor da área vem de --mkt (definida pela área Marketing);
// sem ela, cai no azul de destaque do app.
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { TipoArquivo } from "./tipos";

export const COR = "var(--mkt, var(--accent))";
export const COR_SUAVE = "var(--mkt-soft, var(--accent-soft))";

type Variante = "primario" | "secundario" | "fantasma" | "perigo";
export function Botao({ variante = "secundario", className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  const estilos: Record<Variante, React.CSSProperties> = {
    primario: { background: COR, color: "#fff", border: `1px solid ${COR}` },
    secundario: { background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" },
    fantasma: { background: "transparent", color: "var(--ink2)", border: "1px solid transparent" },
    perigo: { background: "var(--err-bg)", color: "var(--err-ink)", border: "1px solid var(--err-line)" },
  };
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 ${className}`}
      style={{ ...estilos[variante], ...rest.style }}
    >
      {children}
    </button>
  );
}

export const estiloEntrada: React.CSSProperties = {
  width: "100%", padding: "8px 11px", borderRadius: 10, border: "1px solid var(--line)",
  background: "var(--card)", color: "var(--ink)", fontSize: 14,
};

export function Modal({ aberto, titulo, onFechar, children, rodape, largura = 560, cheio = false }: {
  aberto: boolean; titulo: string; onFechar: () => void; children: ReactNode; rodape?: ReactNode; largura?: number; cheio?: boolean;
}) {
  const fechar = useRef(onFechar);
  fechar.current = onFechar;
  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fechar.current(); };
    window.addEventListener("keydown", esc);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = antes; };
  }, [aberto]);
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0" style={{ background: "rgba(15, 20, 26, .5)" }} onClick={onFechar} />
      <div
        className={`relative w-full flex flex-col rounded-t-2xl sm:rounded-2xl shadow-xl ${cheio ? "h-[94vh]" : "max-h-[92vh]"}`}
        style={{ maxWidth: largura, background: "var(--card)", border: "1px solid var(--line)" }}
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b" style={{ borderColor: "var(--line)" }}>
          <h2 className="text-[15px] font-bold truncate" style={{ color: "var(--ink)" }}>{titulo}</h2>
          <button onClick={onFechar} aria-label="Fechar" className="p-1 rounded-md flex-shrink-0" style={{ color: "var(--ink3)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="px-4 sm:px-5 py-4 overflow-y-auto flex-1 min-h-0">{children}</div>
        {rodape && <div className="flex flex-wrap justify-end gap-2 px-4 sm:px-5 py-3 border-t" style={{ borderColor: "var(--line)" }}>{rodape}</div>}
      </div>
    </div>
  );
}

const S = (d: ReactNode, tam = 16) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);

export const Ic = {
  pasta: (t?: number) => S(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />, t),
  video: (t?: number) => S(<><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m22 8-6 4 6 4z" /></>, t),
  imagem: (t?: number) => S(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>, t),
  audio: (t?: number) => S(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>, t),
  pdf: (t?: number) => S(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 14h8M8 17h5" /></>, t),
  documento: (t?: number) => S(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></>, t),
  outro: (t?: number) => S(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></>, t),
  subir: () => S(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5M12 3v12" /></>),
  novaPasta: () => S(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 11v5M9.5 13.5h5" /></>),
  grade: () => S(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>),
  lista: () => S(<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />),
  busca: () => S(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
  filtro: () => S(<path d="M3 5h18l-7 8v6l-4-2v-4z" />),
  atualizar: () => S(<><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>),
  externo: () => S(<><path d="M14 3h7v7M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></>),
  check: () => S(<path d="m5 12 5 5L20 7" />),
  seta: () => S(<path d="m9 18 6-6-6-6" />, 14),
};

export function IconeTipo({ tipo, tam = 18 }: { tipo: TipoArquivo; tam?: number }) {
  const cor = tipo === "pasta" ? "var(--amber)" : tipo === "video" ? "var(--red)" : tipo === "imagem" ? "var(--green)" : tipo === "pdf" ? "var(--err-ink)" : "var(--ink3)";
  return <span style={{ color: cor, display: "inline-flex" }}>{Ic[tipo](tam)}</span>;
}

/** Miniatura com carregamento preguiçoso; sem miniatura (ou erro) → ícone do tipo. */
export function Miniatura({ url, tipo, alt, className = "" }: { url: string | null; tipo: TipoArquivo; alt: string; className?: string }) {
  const [falhou, setFalhou] = useState(false);
  if (!url || falhou) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ background: "var(--card2)" }}>
        <IconeTipo tipo={tipo} tam={30} />
      </div>
    );
  }
  return <img src={url} alt={alt} loading="lazy" decoding="async" onError={() => setFalhou(true)} className={`object-cover ${className}`} style={{ background: "var(--card2)" }} />;
}

export function Chip({ children, ativo, onClick, onRemover }: { children: ReactNode; ativo?: boolean; onClick?: () => void; onRemover?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px] font-semibold"
      style={{ background: ativo ? COR : COR_SUAVE, color: ativo ? "#fff" : "var(--ink2)", cursor: onClick ? "pointer" : undefined }}
      onClick={onClick}
    >
      {children}
      {onRemover && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemover(); }} aria-label="Tirar" className="leading-none opacity-70 hover:opacity-100">×</button>
      )}
    </span>
  );
}
