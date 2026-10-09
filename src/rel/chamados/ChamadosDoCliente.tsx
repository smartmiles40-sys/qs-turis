// src/rel/chamados/ChamadosDoCliente.tsx
// Seção "Chamados" da ficha do cliente: os pedidos dele (abertos primeiro) e o
// botão de abrir um novo já ligado à ficha.
import { useCallback, useEffect, useState } from "react";
import { PRIORIDADES, STATUS_CHAMADO, chamadosDoCliente, situacaoDoPrazo, type Chamado } from "../lib/pos";
import { Botao, Etiqueta } from "../ui";
import ChamadoModal from "./ChamadoModal";

export default function ChamadosDoCliente({ clienteId, onAbrirChamado }: { clienteId: string; onAbrirChamado?: (c: Chamado) => void }) {
  const [lista, setLista] = useState<Chamado[]>([]);
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<Chamado | null>(null);

  const carregar = useCallback(() => {
    chamadosDoCliente(clienteId).then((l) =>
      setLista([...l].sort((a, b) => Number(a.status === "resolvido") - Number(b.status === "resolvido"))),
    ).catch(() => setLista([]));
  }, [clienteId]);
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <section className="rel-card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>Chamados</h2>
        <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => setNovo(true)}>+ Abrir chamado</Botao>
      </div>
      {lista.length === 0 ? (
        <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Nenhum chamado.</p>
      ) : (
        <ul className="space-y-1">
          {lista.map((c) => {
            const p = situacaoDoPrazo(c.prazo, c.status);
            return (
              <li key={c.id}>
                <button
                  onClick={() => (onAbrirChamado ? onAbrirChamado(c) : setEditando(c))}
                  className="rel-linha w-full text-left p-2 -mx-2 rounded-lg"
                >
                  <span className="block text-[13px]" style={{ color: c.status === "resolvido" ? "var(--ink3)" : "var(--ink)" }}>
                    #{c.numero} {c.assunto}
                  </span>
                  <span className="flex flex-wrap gap-1.5 mt-0.5">
                    {c.status === "resolvido"
                      ? <Etiqueta tom="rel">{STATUS_CHAMADO.resolvido}</Etiqueta>
                      : <><Etiqueta tom={p.tom === "neutro" ? "neutro" : p.tom}>⏱ {p.texto}</Etiqueta><Etiqueta>{PRIORIDADES[c.prioridade].rotulo}</Etiqueta></>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <ChamadoModal
        aberto={novo || !!editando}
        chamado={editando}
        inicial={{ clienteId }}
        onFechar={() => { setNovo(false); setEditando(null); }}
        onSalvo={() => { setNovo(false); setEditando(null); carregar(); }}
      />
    </section>
  );
}
