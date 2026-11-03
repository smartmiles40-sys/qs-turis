// src/components/sdr/leads/ficha/MenuDaFicha.tsx
// Menu suspenso da ficha ("Mais ações", temperatura, ações da nota): fecha no
// clique fora e no Esc, setas navegam, e o item perigoso fica no fim, em vermelho.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type ItemDoMenu =
  | { rotulo: ReactNode; onClick: () => void; dica?: string; disabled?: boolean; perigo?: boolean; cor?: string }
  | { separador: true }
  | { grupo: string };

export default function MenuDaFicha({ botao, rotuloAcessivel, itens, alinhar = "direita", classeBotao = "fl-btn" }: {
  botao: ReactNode; rotuloAcessivel?: string; itens: ItemDoMenu[]; alinhar?: "direita" | "esquerda"; classeBotao?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const gatilho = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { setAberto(false); gatilho.current?.focus(); } };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    raiz.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", tecla); };
  }, [aberto]);

  // Sem item de verdade, nem desenha o botão.
  if (!itens.some((i) => "onClick" in i)) return null;

  return (
    <div className="fl-menu" ref={raiz}>
      <button ref={gatilho} type="button" className={classeBotao} aria-haspopup="menu" aria-expanded={aberto}
        aria-controls={id} aria-label={rotuloAcessivel} onClick={() => setAberto((a) => !a)}>
        {botao}
      </button>
      {aberto && (
        <div id={id} role="menu" className={`fl-menu__pop${alinhar === "esquerda" ? " fl-menu__pop--esq" : ""}`}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const lista = [...(raiz.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
            const i = lista.indexOf(document.activeElement as HTMLButtonElement);
            lista[(i + (e.key === "ArrowDown" ? 1 : -1) + lista.length) % lista.length]?.focus();
          }}>
          {itens.map((it, i) => {
            if ("separador" in it) return <div key={i} className="fl-menu__sep" role="separator" />;
            if ("grupo" in it) return <div key={i} className="fl-menu__g">{it.grupo}</div>;
            return (
              <button key={i} type="button" role="menuitem" title={it.dica} disabled={it.disabled}
                className={`fl-menu__i${it.perigo ? " fl-menu__i--perigo" : ""}`} style={it.cor ? { color: it.cor } : undefined}
                onClick={() => { setAberto(false); it.onClick(); }}>
                {it.rotulo}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
