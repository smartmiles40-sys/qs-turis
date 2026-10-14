// src/rel/atendimento/MenuContexto.tsx
// -----------------------------------------------------------------------------
// O MENU DO BOTÃO DIREITO do WhatsApp (14/10/2026, Bruno: "funções com o botão
// esquerdo como fixar, marcar como não lido, etiquetas…").
//
// Abre onde o mouse clicou (ou embaixo da setinha que aparece no hover, como no
// WhatsApp Web), nunca sai da tela, fecha com Esc / clique fora / rolagem, e
// anda pelas setas do teclado. Uma peça só, usada na lista de conversas e nas
// bolhas de mensagem.
// -----------------------------------------------------------------------------
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ItemMenu =
  | { tipo?: "item"; rotulo: string; icone?: ReactNode; atalho?: string; perigo?: boolean; desligado?: boolean; onClick: () => void }
  | { tipo: "separador" }
  | { tipo: "reacoes"; emojis: string[]; atual?: string | null; onEscolher: (e: string) => void; onMais?: () => void };

export interface PosicaoMenu { x: number; y: number }

export default function MenuContexto({ pos, itens, onFechar, rotulo = "Opções" }: {
  pos: PosicaoMenu | null;
  itens: ItemMenu[];
  onFechar: () => void;
  rotulo?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [onde, setOnde] = useState<PosicaoMenu | null>(null);
  const [foco, setFoco] = useState(0);

  // Encaixa na tela: se não cabe embaixo/à direita, abre pra cima/esquerda.
  useLayoutEffect(() => {
    if (!pos) { setOnde(null); return; }
    const el = ref.current;
    const w = el?.offsetWidth ?? 240;
    const h = el?.offsetHeight ?? 300;
    const x = pos.x + w > window.innerWidth - 8 ? Math.max(8, pos.x - w) : pos.x;
    const y = pos.y + h > window.innerHeight - 8 ? Math.max(8, pos.y - h) : pos.y;
    setOnde({ x, y });
    setFoco(0);
  }, [pos, itens.length]);

  const clicaveis = itens.map((it, i) => ((!it.tipo || it.tipo === "item") && !it.desligado ? i : -1)).filter((i) => i >= 0);

  useEffect(() => {
    if (!pos) return;
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onFechar(); };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onFechar(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setFoco((f) => {
          const p = clicaveis.indexOf(clicaveis[f] ?? -1);
          const n = e.key === "ArrowDown" ? (p + 1) % clicaveis.length : (p - 1 + clicaveis.length) % clicaveis.length;
          return n;
        });
      }
      if (e.key === "Enter") {
        const it = itens[clicaveis[foco]];
        if (it && (!it.tipo || it.tipo === "item")) { e.preventDefault(); onFechar(); it.onClick(); }
      }
    };
    const rolou = () => onFechar();
    document.addEventListener("mousedown", fora, true);
    document.addEventListener("keydown", tecla, true);
    window.addEventListener("resize", rolou);
    document.addEventListener("scroll", rolou, true);
    return () => {
      document.removeEventListener("mousedown", fora, true);
      document.removeEventListener("keydown", tecla, true);
      window.removeEventListener("resize", rolou);
      document.removeEventListener("scroll", rolou, true);
    };
  }, [pos, onFechar, itens, foco, clicaveis]);

  if (!pos) return null;
  return createPortal(
    <div ref={ref} role="menu" aria-label={rotulo}
      className="wa wa-menu fixed z-[1000] min-w-[220px] max-w-[300px] py-2 rounded-lg"
      style={{ left: onde?.x ?? pos.x, top: onde?.y ?? pos.y, visibility: onde ? "visible" : "hidden" }}
      onContextMenu={(e) => e.preventDefault()}>
      {itens.map((it, i) => {
        if (it.tipo === "separador") return <div key={i} className="my-1.5 h-px" style={{ background: "var(--wa-line)" }} role="separator" />;
        if (it.tipo === "reacoes") {
          return (
            <div key={i} className="flex items-center gap-0.5 px-2 pb-1.5 mb-1" style={{ borderBottom: "1px solid var(--wa-line)" }} role="group" aria-label="Reagir">
              {it.emojis.map((e) => (
                <button key={e} onClick={() => { onFechar(); it.onEscolher(it.atual === e ? "" : e); }}
                  className="wa-emoji w-9 h-9 rounded-full text-[22px] inline-flex items-center justify-center hover:scale-110 transition-transform"
                  style={it.atual === e ? { background: "var(--wa-sel)" } : undefined} aria-label={`Reagir com ${e}`} aria-pressed={it.atual === e}>{e}</button>
              ))}
              {it.onMais && (
                <button onClick={() => { onFechar(); it.onMais?.(); }} className="w-9 h-9 rounded-full inline-flex items-center justify-center wa-icone" aria-label="Mais emojis">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </button>
              )}
            </div>
          );
        }
        const ativo = clicaveis[foco] === i;
        return (
          <button key={i} role="menuitem" disabled={it.desligado}
            onMouseEnter={() => { const p = clicaveis.indexOf(i); if (p >= 0) setFoco(p); }}
            onClick={() => { onFechar(); it.onClick(); }}
            className="w-full text-left px-4 h-10 flex items-center gap-3 text-[14.5px] disabled:opacity-40"
            style={{ background: ativo ? "var(--wa-hover)" : undefined, color: it.perigo ? "#EA0038" : "var(--wa-txt)" }}>
            {it.icone && <span className="w-5 inline-flex justify-center flex-shrink-0" style={{ color: it.perigo ? "#EA0038" : "var(--wa-meta)" }} aria-hidden>{it.icone}</span>}
            <span className="flex-1 truncate">{it.rotulo}</span>
            {it.atalho && <span className="text-[11.5px] flex-shrink-0" style={{ color: "var(--wa-meta)" }}>{it.atalho}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Abre o menu na posição do clique direito, ou embaixo do botão clicado. */
export function posicaoDoEvento(e: { clientX: number; clientY: number; currentTarget: EventTarget | null; type?: string }): PosicaoMenu {
  if (e.type === "click" && e.currentTarget instanceof HTMLElement) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4 };
  }
  return { x: e.clientX, y: e.clientY };
}

// ── Ícones pequenos dos itens (traço, 18px) ─────────────────────────────────
const I = (d: ReactNode) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
export const ICO = {
  fixar: I(<><line x1="12" y1="17" x2="12" y2="22" /><path d="M5 17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.8a2 2 0 0 1-1.1 1.7l-1.8.9A2 2 0 0 0 5 15.2z" /></>),
  estrela: I(<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2" />),
  naoLida: I(<><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" /><circle cx="18" cy="5" r="3" fill="currentColor" /></>),
  lida: I(<><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" /><polyline points="8 12 11 15 16 9" /></>),
  arquivar: I(<><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></>),
  silenciar: I(<><path d="M11 5L6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>),
  som: I(<><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></>),
  etiqueta: I(<><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" /><line x1="7" y1="7" x2="7.01" y2="7" /></>),
  lista: I(<><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>),
  contato: I(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></>),
  ficha: I(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><line x1="14" y1="9" x2="18" y2="9" /><line x1="14" y1="13" x2="18" y2="13" /><path d="M6 16c1-1.5 5-1.5 6 0" /></>),
  responder: I(<><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></>),
  copiar: I(<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>),
  encaminhar: I(<><polyline points="15 14 20 9 15 4" /><path d="M4 20v-7a4 4 0 0 1 4-4h12" /></>),
  nota: I(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></>),
  figurinha: I(<><path d="M21 12a9 9 0 1 1-9-9h4l5 5z" /><path d="M16 3v4a1 1 0 0 0 1 1h4" /><path d="M8.5 14.5s1.3 1.5 3.5 1.5 3.5-1.5 3.5-1.5" /></>),
  chamado: I(<><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>),
  resolver: I(<polyline points="20 6 9 17 4 12" />),
};
