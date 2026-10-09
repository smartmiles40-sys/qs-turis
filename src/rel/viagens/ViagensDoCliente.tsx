// src/rel/viagens/ViagensDoCliente.tsx
// A seção "Viagens" da ficha: todas em que o cliente é passageiro (o comprador
// também é), da mais nova pra mais antiga.
import { useEffect, useState } from "react";
import { FASES, periodo, quandoEmbarca, viagensDoCliente, type Viagem } from "../lib/viagens";
import { Etiqueta } from "../ui";

export const TOM_FASE = { antes: "rel", em_viagem: "aviso", concluida: "neutro", cancelada: "erro", sem_data: "neutro" } as const;

export default function ViagensDoCliente({ clienteId, onAbrirViagem }: { clienteId: string; onAbrirViagem: (id: string) => void }) {
  const [lista, setLista] = useState<Viagem[] | null>(null);
  useEffect(() => {
    viagensDoCliente(clienteId).then(setLista).catch(() => setLista([]));
  }, [clienteId]);

  if (lista === null) return <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  if (!lista.length) {
    return (
      <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>
        Nenhuma viagem ainda. As vendas do Bitrix ("Em emissão" e "Venda realizada") viram viagem sozinhas.
      </p>
    );
  }
  return (
    <div>
      {lista.map((v) => (
        <button key={v.id} onClick={() => onAbrirViagem(v.id)} className="rel-linha w-full flex items-center gap-3 p-2 -mx-2 rounded-lg text-left">
          <span className="flex-1 min-w-0">
            <span className="block text-[14px] font-semibold truncate" style={{ color: "var(--ink)" }}>{v.titulo}</span>
            <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>
              {periodo(v)} · {quandoEmbarca(v)}
              {v.cliente_id !== clienteId && v.cliente_nome ? ` · comprada por ${v.cliente_nome.split(" ")[0]}` : ""}
            </span>
          </span>
          {v.tarefas_atrasadas > 0 && <Etiqueta tom="erro">{v.tarefas_atrasadas} atrasada{v.tarefas_atrasadas > 1 ? "s" : ""}</Etiqueta>}
          <Etiqueta tom={TOM_FASE[v.fase]}>{FASES[v.fase]}</Etiqueta>
        </button>
      ))}
    </div>
  );
}
