// src/mkt/grupos/navegar.ts — estado das abas de Grupos no endereço, pra dar pra mandar o link:
//   #mkt/grupos?aba=campanhas&campanha=<id>      (detalhe)   · &campanha=nova · &editar=<id>
//   #mkt/grupos?aba=cadencias&cadencia=<id>      · &recorrencia=nova|<id> · &ver=recorrentes
//   #mkt/grupos?aba=links&link=<id>            · &link=nova · &editar=<id>   (0342)
//   #mkt/grupos?aba=celular&jid=<jid>            · #mkt/grupos?chip=1 (abre o chip)
import { useCallback, useEffect, useState } from "react";
import { gravarParamNoHash, lerParamDoHash } from "@/lib/hashQuery";

/** Avisa as outras telas abertas que um parâmetro mudou (replaceState não dispara "hashchange"). */
const EVENTO = "gr-param";

/** Um parâmetro do hash como estado (trocar não navega nem enche o "voltar"). Todas as telas que leem o mesmo nome andam juntas. */
export function useParam(nome: string): [string | null, (v: string | null) => void] {
  const [v, setV] = useState<string | null>(() => lerParamDoHash(nome));
  useEffect(() => {
    const on = () => setV(lerParamDoHash(nome));
    window.addEventListener("hashchange", on);
    window.addEventListener(EVENTO, on);
    return () => { window.removeEventListener("hashchange", on); window.removeEventListener(EVENTO, on); };
  }, [nome]);
  const set = useCallback((x: string | null) => {
    gravarParamNoHash(nome, x);
    setV(x);
    window.dispatchEvent(new Event(EVENTO));
  }, [nome]);
  return [v, set];
}

/** Vai pra outra aba de Grupos já com um item aberto (dispara "hashchange": a aba troca). */
export function irNaAba(aba: "campanhas" | "cadencias" | "grupos" | "links" | "celular", params: Record<string, string> = {}) {
  const q = new URLSearchParams();
  if (aba !== "campanhas") q.set("aba", aba);
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  const s = q.toString();
  window.location.hash = `#mkt/grupos${s ? `?${s}` : ""}`;
  window.scrollTo(0, 0);
}
