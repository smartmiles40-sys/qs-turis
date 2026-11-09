// src/ops/useVendasSemRevisao.ts
// Bolinha do menu "Vendas para revisar" (0338): vendas do closer ainda sem
// revisão do Operacional. `versao` muda → reconta (depois de revisar).
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function useVendasSemRevisao(versao = 0): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    void supabase.from("qs_vendas").select("id", { count: "exact", head: true }).eq("origem", "closer").is("revisado_em", null)
      .then(({ count, error }) => { if (vivo && !error) setN(count ?? 0); });
    return () => { vivo = false; };
  }, [versao]);
  return n;
}
