// src/expedicoes/lista/central/menu.tsx
// O "⋯" de cada expedição na Central (Cartões e Tabela): Editar, Mudar status e
// Excluir — as ações da lista antiga.
import { useEffect, useRef, useState } from "react";
import { STATUS_EXPEDICAO } from "../../lib/constants";
import type { StatusExpedicao } from "../../lib/database";
import type { LinhaExp } from "./linhas";

export interface AcoesDaLinha {
  onEditar: (l: LinhaExp) => void;
  onStatus: (l: LinhaExp, s: StatusExpedicao) => void;
  onExcluir: (l: LinhaExp) => void;
}

/** "⋯" da linha: Editar, Mudar status, Excluir (as ações da lista antiga). */
export function MenuLinha({ l, acoes }: { l: LinhaExp; acoes: AcoesDaLinha }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    raiz.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);
  const item = (rotulo: string, f: () => void, perigo = false) => (
    <button type="button" role="menuitem" className="qs-menu__i" style={perigo ? { color: "var(--danger)" } : undefined}
      onClick={() => { setAberto(false); f(); }}>{rotulo}</button>
  );
  return (
    <span className="qs-menu" ref={raiz}>
      <button type="button" className="cx-ico" aria-haspopup="menu" aria-expanded={aberto} aria-label={`Ações de ${l.e.nome}`} onClick={() => setAberto((a) => !a)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {aberto && (
        <div role="menu" className="qs-menu__pop" style={{ minWidth: 200 }}>
          {item("Editar", () => acoes.onEditar(l))}
          <div role="group" aria-label="Status">
            <div className="qs-menu__g">Status (atual: {l.e.status})</div>
            {STATUS_EXPEDICAO.filter((s) => s !== l.e.status).map((s) => <span key={s}>{item(s, () => acoes.onStatus(l, s))}</span>)}
          </div>
          <div className="qs-menu__g">Outras</div>
          {item("Excluir…", () => acoes.onExcluir(l), true)}
        </div>
      )}
    </span>
  );
}
