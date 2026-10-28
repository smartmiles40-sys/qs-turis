// src/controle-comercial/filtroUrl.ts
// -----------------------------------------------------------------------------
// Filtros por FONTE e por SDR RESPONSÁVEL guardados no endereço (Bruno,
// 28/10/2026). Ficam na query (?fonte=…&sdr=…), não no hash — o hash é a rota
// das áreas (#closer/…, #gestao) e não pode ser mexido. Assim o link copiado
// abre com o mesmo filtro, e Leads e Gestão falam a mesma língua.
//
// Fonte = qs_leads.segment (texto livre: "[Japão] - Tráfego", "Orgânico"…).
// O `source` é enum técnico (manual/import/…) e não diz de onde o lead veio.
// -----------------------------------------------------------------------------
import { useEffect, useMemo } from "react";

export type ChaveFiltro = "fonte" | "sdr";
/** Valor do filtro de fonte para "lead sem fonte" (segment vazio). */
export const SEM_FONTE = "__sem_fonte__";

export function lerFiltroDaUrl(chave: ChaveFiltro): string {
  try { return new URLSearchParams(window.location.search).get(chave) ?? ""; } catch { return ""; }
}

export function gravarFiltroNaUrl(valores: Partial<Record<ChaveFiltro, string>>) {
  const u = new URL(window.location.href);
  for (const [k, v] of Object.entries(valores)) {
    if (v) u.searchParams.set(k, v); else u.searchParams.delete(k);
  }
  const novo = u.pathname + u.search + u.hash;
  if (novo !== window.location.pathname + window.location.search + window.location.hash) {
    history.replaceState(history.state, "", novo);
  }
}

/** Espelha os filtros no endereço sempre que mudam. */
export function useFiltrosNaUrl(fonte: string, sdr: string) {
  useEffect(() => { gravarFiltroNaUrl({ fonte, sdr }); }, [fonte, sdr]);
}

/** O lead passa no filtro de fonte? */
export function casaFonte(segment: string | null | undefined, fonte: string): boolean {
  if (!fonte) return true;
  const s = (segment ?? "").trim();
  return fonte === SEM_FONTE ? !s : s === fonte;
}

/** Fontes presentes numa lista, da mais comum pra menos comum. */
export function useFontes(linhas: readonly { segment?: string | null }[]): { valor: string; rotulo: string; n: number }[] {
  return useMemo(() => {
    const c = new Map<string, number>();
    for (const l of linhas) { const s = (l.segment ?? "").trim() || SEM_FONTE; c.set(s, (c.get(s) ?? 0) + 1); }
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
      .map(([valor, n]) => ({ valor, n, rotulo: valor === SEM_FONTE ? "(sem fonte)" : valor }));
  }, [linhas]);
}
