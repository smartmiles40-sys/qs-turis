// src/rel/atendimento/DadosContato.tsx
// -----------------------------------------------------------------------------
// DADOS DO CONTATO (16/10/2026) — clicar no nome no topo da conversa abre este
// painel à direita, igual ao WhatsApp: foto, nome, telefone, a ficha e os
// GRUPOS EM COMUM (os grupos em que a pessoa está junto com o número do
// Relacionamento — 0143). Clicar num grupo abre ele em Grupos.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { gruposEmComum, type Grupo } from "../lib/grupos";
import { formatarTelefone } from "../lib/clientes";
import { AvatarWa, WA_CSS, horaDaLista } from "./waUi";

export default function DadosContato({ nome, telefone, temFicha, podeVerGrupos, onFechar, onFicha }: {
  nome: string; telefone: string; temFicha: boolean; podeVerGrupos: boolean; onFechar: () => void; onFicha: () => void;
}) {
  const [grupos, setGrupos] = useState<(Grupo & { admin: string | null })[] | null>(null);
  useEffect(() => {
    if (!podeVerGrupos) { setGrupos([]); return; }
    let vivo = true;
    gruposEmComum(telefone).then((g) => { if (vivo) setGrupos(g); }).catch(() => { if (vivo) setGrupos([]); });
    return () => { vivo = false; };
  }, [telefone, podeVerGrupos]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onFechar]);

  const abrirGrupo = (jid: string) => { window.location.hash = `#rel/grupos/${encodeURIComponent(jid)}`; onFechar(); };

  return createPortal(
    <div className="wa fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Dados do contato">
      <style>{WA_CSS}</style>
      <div className="absolute inset-0" style={{ background: "rgba(11,20,26,.35)" }} onClick={onFechar} />
      <aside className="absolute right-0 top-0 h-full w-full sm:w-[400px] flex flex-col shadow-2xl wa-lista">
        <header className="wa-cab h-[60px] flex items-center gap-3 px-4 flex-shrink-0">
          <button onClick={onFechar} className="wa-icone w-9 h-9 inline-flex items-center justify-center" aria-label="Fechar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <span className="text-[16px]" style={{ color: "var(--wa-txt)" }}>Dados do contato</span>
        </header>
        <div className="flex-1 overflow-y-auto">
          <section className="flex flex-col items-center text-center px-6 py-6" style={{ borderBottom: "8px solid var(--wa-head)" }}>
            <AvatarWa nome={nome} tamanho={120} />
            <p className="mt-3 text-[22px]" style={{ color: "var(--wa-txt)" }}>{nome}</p>
            <p className="text-[15px]" style={{ color: "var(--wa-meta)" }}>{formatarTelefone(telefone)}</p>
            <button onClick={onFicha} className="mt-4 h-9 px-4 rounded-full text-[13.5px] font-semibold wa-verde">
              {temFicha ? "Abrir a ficha do cliente" : "Ligar a uma ficha"}
            </button>
          </section>
          {podeVerGrupos && (
            <section className="py-3">
              <h3 className="px-6 pb-2 text-[14px]" style={{ color: "var(--wa-meta)" }}>
                {grupos === null ? "Grupos em comum…" : `${grupos.length} ${grupos.length === 1 ? "grupo" : "grupos"} em comum`}
              </h3>
              {grupos === null && <div className="mx-6 h-14 rounded-lg animate-pulse" style={{ background: "var(--wa-head)" }} />}
              {grupos && !grupos.length && <p className="px-6 text-[13.5px]" style={{ color: "var(--wa-meta)" }}>Nenhum grupo em comum com o número do Relacionamento.</p>}
              <ul>
                {grupos?.map((g) => (
                  <li key={g.jid}>
                    <button onClick={() => abrirGrupo(g.jid)} className="wa-item w-full text-left flex items-center gap-3 px-6 py-2.5">
                      <AvatarWa nome={g.nome || "Grupo"} tamanho={44} />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-baseline gap-2">
                          <span className="flex-1 truncate text-[15.5px]" style={{ color: "var(--wa-txt)" }}>{g.nome || "Grupo sem nome"}</span>
                          <span className="text-[11.5px] flex-shrink-0" style={{ color: "var(--wa-meta)" }}>{horaDaLista(g.ultima_msg_em)}</span>
                        </span>
                        <span className="block truncate text-[13px]" style={{ color: "var(--wa-meta)" }}>
                          {g.admin ? "Admin do grupo · " : ""}{g.participantes ? `${g.participantes} participantes` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
