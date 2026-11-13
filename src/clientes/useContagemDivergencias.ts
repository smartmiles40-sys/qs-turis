// src/clientes/useContagemDivergencias.ts
// -----------------------------------------------------------------------------
// Bolinha do menu "Arrumar cadastros" (ponte/pedidos, 13/11/2026): as
// divergências ficha × expedição em aberto (cad_divergencias, 0172). A
// auditoria achou 110 paradas, a mais antiga de 23/10 — ninguém via a fila sem
// entrar nela. Mesmo ritmo das outras bolinhas: reconta a cada 2 min com a aba
// à vista e quando a tela avisa que resolveu uma (recontar()).
// Sem a tabela (banco antigo) ou sem permissão de leitura: 0 (sem bolinha).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

import { DIAS_DIVERGENCIA_ANTIGA, type ContagemDivergencias } from "./divergenciasRegras";

export { bolinhaDasDivergencias, DIAS_DIVERGENCIA_ANTIGA, type ContagemDivergencias } from "./divergenciasRegras";

export async function contarDivergenciasAbertas(agora = Date.now()): Promise<ContagemDivergencias> {
  const corte = new Date(agora - DIAS_DIVERGENCIA_ANTIGA * 86_400_000).toISOString();
  const [t, v] = await Promise.all([
    supabase.from("cad_divergencias").select("id", { count: "exact", head: true }).is("resolvido_em", null),
    supabase.from("cad_divergencias").select("id", { count: "exact", head: true }).is("resolvido_em", null).lt("criado_em", corte),
  ]);
  if (t.error) return { abertas: 0, antigas: false };
  return { abertas: t.count ?? 0, antigas: (v.count ?? 0) > 0 };
}

export function useContagemDivergencias(): [ContagemDivergencias, () => void] {
  const [c, setC] = useState<ContagemDivergencias>({ abertas: 0, antigas: false });
  const contar = useCallback(() => { contarDivergenciasAbertas().then(setC).catch(() => undefined); }, []);
  useEffect(() => {
    contar();
    const t = setInterval(() => { if (!document.hidden) contar(); }, 120_000);
    return () => clearInterval(t);
  }, [contar]);
  return [c, contar];
}
