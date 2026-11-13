// src/fin/receber/PlanosDivergentes.tsx
// Ponte pós-venda (0388): "Planos para conferir" — a venda mudou depois de consolidada
// (item, valor, pessoa ou forma de pagamento) e o plano/parcelas não batem mais.
// Nada é refeito sozinho: o Financeiro confere e ajusta. Sem a migration (ou sem
// acesso), o bloco simplesmente não aparece.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Etiqueta } from "../ui";
import { explicarMotivo, ordenarDivergencias, type Divergencia } from "./divergencias";

export default function PlanosDivergentes({ recarregar = 0 }: { recarregar?: number }) {
  const [lista, setLista] = useState<Divergencia[]>([]);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    let atual = true;
    void (async () => {
      try {
        const r = await supabase.from("fin_planos_divergentes_v")
          .select("plano_id, cliente_nome, closer_nome, plano_total, venda_total, soma_parcelas, soma_pagamentos, motivos, tem_parcela_paga, atualizado_em")
          .limit(200);
        if (atual) setLista(r.error ? [] : ordenarDivergencias((r.data ?? []) as Divergencia[]));
      } catch { if (atual) setLista([]); }
    })();
    return () => { atual = false; };
  }, [recarregar]);

  if (!lista.length) return null;
  return (
    <section className="rel-card p-3" style={{ borderLeft: "3px solid #B45309" }}>
      <button className="text-[13.5px] font-bold text-left w-full" style={{ color: "var(--ink)" }} onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
        {aberto ? "▾" : "▸"} {lista.length} plano{lista.length > 1 ? "s" : ""} para conferir
        <span className="font-normal text-[12px] ml-2" style={{ color: "var(--ink3)" }}>a venda mudou depois de consolidada — as parcelas não foram refeitas</span>
      </button>
      {aberto && (
        <ul className="mt-2 space-y-2">
          {lista.map((d) => (
            <li key={d.plano_id} className="text-[12.5px] border-t pt-2" style={{ borderColor: "var(--line)", color: "var(--ink2)" }}>
              <div className="flex flex-wrap items-center gap-2">
                <b style={{ color: "var(--ink)" }}>{d.cliente_nome || "Cliente"}</b>
                {d.closer_nome && <span style={{ color: "var(--ink3)" }}>closer {d.closer_nome}</span>}
                {d.tem_parcela_paga && <Etiqueta tom="aviso">já tem parcela paga</Etiqueta>}
              </div>
              <ul className="mt-0.5">
                {(d.motivos ?? []).map((m) => <li key={m}>• {explicarMotivo(m, d)}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
