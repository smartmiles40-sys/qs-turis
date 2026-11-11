// src/ops/useVendasSemRevisao.ts
// Bolinha do menu "Vendas para revisar" (0338): vendas do closer ainda sem
// revisão do Operacional. `versao` muda → reconta (depois de revisar).
// Sprint final (0356): só conta venda reservada/consolidada — negociação não é
// venda ainda. Banco sem a coluna `estado` → conta como antes.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function useVendasSemRevisao(versao = 0): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    const base = () => supabase.from("qs_vendas").select("id", { count: "exact", head: true }).eq("origem", "closer").is("revisado_em", null);
    void (async () => {
      let { count, error } = await base().in("estado", ["reservada", "consolidada"]);
      if (error) ({ count, error } = await base());
      if (vivo && !error) setN(count ?? 0);
    })();
    return () => { vivo = false; };
  }, [versao]);
  return n;
}
