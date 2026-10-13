// src/rel/clientes/ViagensComAGente.tsx
// -----------------------------------------------------------------------------
// "Viagens com a gente" na ficha: TODAS as viagens do cliente — as que ele
// comprou (titular) e as que fez como acompanhante (passageiro) — separadas
// em Expedição e Pacote, com o que já aconteceu e o que vem por aí.
// Regra única do sistema (grupoTipo): o que não é expedição é pacote —
// aéreo e hospedagem avulsos entram em Pacotes, com o tipo escrito ao lado.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FASES, TIPOS_VIAGEM, grupoTipo, periodo, quandoEmbarca, type Viagem } from "../lib/viagens";
import { Aviso, Etiqueta } from "../ui";
import { MarcaTipo } from "../viagens/MapaMundi";

const TOM = { antes: "rel", em_viagem: "aviso", concluida: "neutro", cancelada: "erro", sem_data: "neutro" } as const;
const GRUPOS: { id: "expedicao" | "pacote"; rotulo: string }[] = [
  { id: "expedicao", rotulo: "Expedições" },
  { id: "pacote", rotulo: "Pacotes" },
];

async function todasDoCliente(clienteId: string): Promise<Viagem[]> {
  const { data: ps, error: e1 } = await supabase.from("rel_viagem_passageiros").select("viagem_id").eq("cliente_id", clienteId);
  if (e1) throw e1;
  const ids = (ps ?? []).map((p: { viagem_id: string }) => p.viagem_id);
  let q = supabase.from("rel_viagens_v").select("*");
  q = ids.length ? q.or(`cliente_id.eq.${clienteId},id.in.(${[...new Set(ids)].join(",")})`) : q.eq("cliente_id", clienteId);
  const { data, error } = await q.order("data_embarque", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Viagem[];
}

export default function ViagensComAGente({ clienteId, onAbrirViagem }: { clienteId: string; onAbrirViagem: (id: string) => void }) {
  const [lista, setLista] = useState<Viagem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let atual = true;
    setLista(null);
    setErro(null);
    todasDoCliente(clienteId).then((l) => { if (atual) setLista(l); })
      .catch((e) => { if (atual) { setErro(e instanceof Error ? e.message : "erro desconhecido"); setLista([]); } });
    return () => { atual = false; };
  }, [clienteId]);

  const ativas = (lista ?? []).filter((v) => v.status !== "cancelada");
  const feitas = ativas.filter((v) => v.fase === "concluida").length;
  const futuras = ativas.filter((v) => v.fase === "antes" || v.fase === "em_viagem").length;

  return (
    <section className="rel-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>Viagens com a gente</h2>
        {lista && lista.length > 0 && (
          <span className="text-[12px]" style={{ color: "var(--ink3)" }}>
            {feitas} realizada{feitas === 1 ? "" : "s"} · {futuras} por vir
          </span>
        )}
      </div>
      {erro ? (
        <Aviso tom="erro">Não consegui carregar as viagens ({erro}).</Aviso>
      ) : lista === null ? (
        <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>
          Nenhuma viagem ainda. As vendas do Bitrix ("Em emissão" e "Venda realizada") viram viagem sozinhas.
        </p>
      ) : (
        <div className="space-y-3">
          {GRUPOS.map((g) => {
            const doGrupo = lista.filter((v) => grupoTipo(v.tipo) === g.id);
            if (!doGrupo.length) return null;
            return (
              <div key={g.id}>
                <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--ink2)" }}>
                  <MarcaTipo tipo={g.id} tamanho={8} />
                  {g.rotulo} · {doGrupo.length}
                </h3>
                {doGrupo.map((v) => (
                  <button key={v.id} onClick={() => onAbrirViagem(v.id)} className="rel-linha w-full flex items-center gap-3 p-2 -mx-2 rounded-lg text-left">
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] font-semibold truncate" style={{ color: "var(--ink)" }}>{v.titulo}</span>
                      <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>
                        {periodo(v)} · {quandoEmbarca(v)}
                        {v.tipo !== "expedicao" && v.tipo !== "pacote" ? ` · ${TIPOS_VIAGEM[v.tipo]}` : ""}
                        {v.cliente_id !== clienteId && v.cliente_nome ? ` · acompanhante de ${v.cliente_nome.split(" ")[0]}` : ""}
                      </span>
                    </span>
                    <Etiqueta tom={TOM[v.fase]}>{v.status === "cancelada" ? "Cancelada" : FASES[v.fase]}</Etiqueta>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
