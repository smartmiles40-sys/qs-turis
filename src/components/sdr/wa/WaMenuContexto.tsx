// src/components/sdr/wa/WaMenuContexto.tsx
// -----------------------------------------------------------------------------
// O menu do botão direito — o mesmo gesto que todo mundo já faz no WhatsApp Web.
//
// Por que um componente só, usado pela lista E pela conversa: as duas precisam
// exatamente do mesmo comportamento chato de acertar (posicionar sem sair da
// tela, fechar no clique fora / Esc / rolagem, funcionar no toque). Duas cópias
// significariam um dos dois lugares ficando pra trás na primeira correção.
//
// DECISÕES QUE IMPORTAM:
//
// 1. TOQUE TAMBÉM ABRE. No celular não existe botão direito, e no WhatsApp o
//    gesto é segurar o dedo. `useToqueLongo` cobre isso, com uma tolerância de
//    movimento: sem ela, rolar a lista com o dedo em cima de uma linha abriria o
//    menu no meio da rolagem.
//
// 2. NÃO SAI DA TELA. O menu vira pra cima/esquerda quando está perto da borda.
//    Aberto no rodapé da conversa — que é justamente onde ficam as mensagens
//    mais recentes, as que mais recebem ação — ele abriria pra fora sem isso.
//
// 3. AÇÃO DESTRUTIVA SEPARADA. "Apagar" fica no fim, atrás de um traço e em
//    vermelho: distância física do resto reduz o clique errado, e é assim que o
//    WhatsApp faz.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface ItemMenu {
  id: string;
  label: string;
  icone?: ReactNode;
  /** Vermelho e separado do resto (apagar). */
  perigo?: boolean;
  /** Fora do menu — usado pra esconder "Apagar" na mensagem do cliente. */
  escondido?: boolean;
  onClick: () => void;
}

export interface PosMenu { x: number; y: number }

const LARGURA = 208;
const ALTURA_ITEM = 38;
const MARGEM = 8;

/**
 * Segurar o dedo abre o menu (celular). A tolerância de 10px existe porque o
 * dedo sempre treme um pouco — sem ela, metade das aberturas seria cancelada;
 * com ela, rolar de verdade continua cancelando.
 */
export function useToqueLongo(aoAbrir: (pos: PosMenu) => void, ms = 500) {
  const timer = useRef<number | null>(null);
  const inicio = useRef<PosMenu | null>(null);

  const limpar = useCallback(() => {
    if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; }
    inicio.current = null;
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    inicio.current = { x: t.clientX, y: t.clientY };
    timer.current = window.setTimeout(() => {
      if (inicio.current) aoAbrir(inicio.current);
      timer.current = null;
    }, ms);
  }, [aoAbrir, ms]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t || !inicio.current) return;
    const longe = Math.abs(t.clientX - inicio.current.x) > 10
      || Math.abs(t.clientY - inicio.current.y) > 10;
    if (longe) limpar();
  }, [limpar]);

  return { onTouchStart, onTouchMove, onTouchEnd: limpar, onTouchCancel: limpar };
}

export default function WaMenuContexto({
  pos, itens, onFechar, titulo,
}: {
  pos: PosMenu | null;
  itens: ItemMenu[];
  onFechar: () => void;
  /** Cabeçalho curto (ex.: o nome do cliente) — ajuda a saber sobre o que é o menu. */
  titulo?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [montado, setMontado] = useState(false);

  useEffect(() => { setMontado(pos !== null); }, [pos]);

  useEffect(() => {
    if (!pos) return;
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onFechar();
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    // Rolar com o menu aberto o deixaria "solto" no ar, longe do que abriu.
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    window.addEventListener("scroll", onFechar, true);
    window.addEventListener("resize", onFechar);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", onFechar, true);
      window.removeEventListener("resize", onFechar);
    };
  }, [pos, onFechar]);

  // Foco no menu ao abrir: sem isso, quem navega por teclado ficaria com o foco
  // na mensagem lá atrás e o Tab passearia pela página inteira.
  useEffect(() => {
    if (pos && ref.current) ref.current.focus();
  }, [pos]);

  if (!pos) return null;

  const visiveis = itens.filter((i) => !i.escondido);
  if (!visiveis.length) return null;

  const altura = visiveis.length * ALTURA_ITEM + (titulo ? 28 : 0) + 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Vira pro outro lado quando não cabe — nunca deixa o menu meio fora da tela.
  const x = Math.max(MARGEM, Math.min(pos.x, vw - LARGURA - MARGEM));
  const y = pos.y + altura > vh - MARGEM
    ? Math.max(MARGEM, pos.y - altura)
    : pos.y;

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={titulo || "Ações"}
      className="fixed z-[80] rounded-xl border shadow-xl overflow-hidden outline-none"
      style={{
        left: x, top: y, width: LARGURA,
        borderColor: "var(--line)", background: "var(--card)",
        transform: montado ? "scale(1)" : "scale(.96)",
        opacity: montado ? 1 : 0,
        transition: "transform .09s ease-out, opacity .09s ease-out",
        transformOrigin: "top left",
      }}
    >
      {titulo && (
        <p className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wide truncate"
           style={{ color: "var(--ink3)" }}>
          {titulo}
        </p>
      )}
      {visiveis.map((item, i) => {
        const primeiroPerigo = item.perigo && !visiveis[i - 1]?.perigo;
        return (
          <button
            key={item.id}
            role="menuitem"
            onClick={() => { item.onClick(); onFechar(); }}
            className="wa-row-btn w-full text-left flex items-center gap-2.5 px-3 text-[13px] font-medium"
            style={{
              height: ALTURA_ITEM,
              color: item.perigo ? "var(--red)" : "var(--ink)",
              borderTop: primeiroPerigo ? "1px solid var(--line)" : undefined,
            }}
          >
            {item.icone && (
              <span className="shrink-0 grid place-items-center w-4" aria-hidden>{item.icone}</span>
            )}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Ícones do menu (traço fino, no mesmo peso do resto do painel) ────────────

export function IconeMenu({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const PATHS = {
  responder: "M9 17l-6-5 6-5M3 12h10a8 8 0 0 1 8 8v1",
  copiar: "M9 9h10v12H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  reagir: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
  apagar: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6",
  info: "M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  naoLida: "M22 6l-10 7L2 6M2 6h20v12H2z",
  lida: "M22 6l-10 7L2 6M2 6h20v12H2zM17 3l2 2 4-4",
  fixar: "M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z",
  card: "M3 5h18v14H3zM3 10h18M8 15h5",
  baixar: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
};
