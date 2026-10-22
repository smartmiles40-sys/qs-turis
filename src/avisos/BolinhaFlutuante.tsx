// src/avisos/BolinhaFlutuante.tsx
// -----------------------------------------------------------------------------
// A BOLINHA FLUTUANTE (0196, refeita 22/10): Bruno quer "só o ícone" — nada de
// janelinha com barra. É um círculo pequeno por cima do QS, com o número de
// avisos novos; a pessoa arrasta pra qualquer canto e ele fica lá (lembrado
// neste computador). Clique (sem arrastar) abre a lista ao lado da bolinha.
//
// Fora do QS (outra aba / outro programa) quem avisa é o bip + a notificação
// do Windows — o navegador não deixa um site desenhar por cima de outros programas.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAvisos } from "./AvisosProvider";
import { ListaDeAvisos } from "./SinoDeAvisos";

const TAM = 46;
const MARGEM = 8;
const CHAVE_POS = "qs_avisos_bolinha_pos";

type Pos = { x: number; y: number };

function limitar(p: Pos): Pos {
  const maxX = Math.max(MARGEM, window.innerWidth - TAM - MARGEM);
  const maxY = Math.max(MARGEM, window.innerHeight - TAM - MARGEM);
  return { x: Math.min(Math.max(MARGEM, p.x), maxX), y: Math.min(Math.max(MARGEM, p.y), maxY) };
}

function posInicial(): Pos {
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE_POS) || "null") as Pos | null;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return limitar(p);
  } catch { /* sem memória: canto padrão */ }
  return limitar({ x: window.innerWidth - TAM - 20, y: window.innerHeight - TAM - 96 });
}

export default function BolinhaFlutuante({ pulso }: { pulso: number }) {
  const ctx = useAvisos();
  const [pos, setPos] = useState<Pos>(posInicial);
  const [aberta, setAberta] = useState(false);
  const [painelPos, setPainelPos] = useState<{ top: number; left: number } | null>(null);
  const arraste = useRef<{ dx: number; dy: number; x0: number; y0: number; moveu: boolean } | null>(null);
  const bolinha = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  // Janela mudou de tamanho: a bolinha não some pra fora da tela.
  useEffect(() => {
    const on = () => setPos((p) => limitar(p));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const soltar = useCallback((p: Pos) => {
    try { localStorage.setItem(CHAVE_POS, JSON.stringify(p)); } catch { /* ok */ }
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    arraste.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, x0: e.clientX, y0: e.clientY, moveu: false };
  }
  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const a = arraste.current;
    if (!a) return;
    if (!a.moveu && Math.hypot(e.clientX - a.x0, e.clientY - a.y0) < 5) return;
    a.moveu = true;
    setAberta(false);
    setPos(limitar({ x: e.clientX - a.dx, y: e.clientY - a.dy }));
  }
  function onPointerUp() {
    const a = arraste.current;
    arraste.current = null;
    if (!a) return;
    if (a.moveu) soltar(pos);
    else setAberta((v) => !v);
  }

  // Lista abre do lado que tem espaço.
  useLayoutEffect(() => {
    if (!aberta) return;
    const larg = Math.min(360, window.innerWidth - 2 * MARGEM);
    const alt = Math.min(480, window.innerHeight * 0.7);
    const left = pos.x + TAM / 2 > window.innerWidth / 2 ? pos.x - larg - 10 : pos.x + TAM + 10;
    const top = pos.y + TAM / 2 > window.innerHeight / 2 ? pos.y + TAM - alt : pos.y;
    setPainelPos({ left: Math.min(Math.max(MARGEM, left), window.innerWidth - larg - MARGEM), top: Math.max(MARGEM, top) });
  }, [aberta, pos]);

  useEffect(() => {
    if (!aberta) return;
    const fora = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!painel.current?.contains(t) && !bolinha.current?.contains(t)) setAberta(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberta(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberta]);

  if (!ctx) return null;
  const n = ctx.total;
  const rotulo = ctx.maisQueLimite ? `${n}+` : n > 99 ? "99+" : String(n);

  return (
    <>
      <style>{`
        @keyframes qs-bol-onda { 0% { transform: scale(1); opacity: .8; } 100% { transform: scale(1.7); opacity: 0; } }
        @keyframes qs-bol-pula { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
        .qs-bol-vai { animation: qs-bol-pula .45s ease-in-out 3; }
        .qs-bol-vai .qs-bol-onda { animation: qs-bol-onda 1.1s ease-out 3; }
        @media (prefers-reduced-motion: reduce) { .qs-bol-vai, .qs-bol-vai .qs-bol-onda { animation: none; } }
      `}</style>
      <button
        ref={bolinha}
        key={pulso}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { arraste.current = null; }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAberta((v) => !v); } }}
        aria-label={n ? `${rotulo} avisos novos` : "Avisos: nenhum novo"}
        aria-expanded={aberta}
        title={n ? `${rotulo} avisos novos — clique pra ver, arraste pra mudar de lugar` : "Sem avisos novos — arraste pra mudar de lugar"}
        className={`fixed z-[80] rounded-full flex items-center justify-center select-none touch-none ${pulso && n ? "qs-bol-vai" : ""}`}
        style={{
          left: pos.x, top: pos.y, width: TAM, height: TAM, cursor: "grab",
          background: n ? "#0147FF" : "#334155", color: "#fff",
          boxShadow: "0 4px 14px rgba(0,0,0,.28)",
        }}
      >
        <span className="qs-bol-onda absolute inset-0 rounded-full pointer-events-none" style={{ border: "3px solid #60A5FA", opacity: 0 }} />
        {n ? (
          <span className="font-extrabold leading-none" style={{ fontSize: rotulo.length > 2 ? 13 : 17 }}>{rotulo}</span>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
        )}
      </button>

      {aberta && painelPos && (
        <div ref={painel} role="dialog" aria-label="Avisos"
          className="fixed z-[80] rounded-xl shadow-xl border flex flex-col overflow-hidden"
          style={{ top: painelPos.top, left: painelPos.left, width: "min(360px, calc(100vw - 16px))", maxHeight: "min(480px, 70vh)", background: "var(--card, #fff)", borderColor: "var(--line, #e5e7eb)" }}>
          <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-shrink-0" style={{ borderColor: "var(--line, #e5e7eb)" }}>
            <span className="text-[14px] font-bold flex-1" style={{ color: "var(--ink, #111)" }}>Avisos</span>
            {n > 0 && (
              <button onClick={ctx.marcarTodos} className="text-[12px] font-semibold" style={{ color: "var(--accent, #0147FF)" }}>Marcar todos como lidos</button>
            )}
          </div>
          <div className="overflow-y-auto flex-1">
            <ListaDeAvisos onDepoisDeAbrir={() => setAberta(false)} />
          </div>
        </div>
      )}
    </>
  );
}
