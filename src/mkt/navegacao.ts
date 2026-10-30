// src/mkt/navegacao.ts
// -----------------------------------------------------------------------------
// Endereço da área Marketing: #mkt/<tela>/<id>?<estado>. As telas do contrato
// (src/mkt/rotas.ts) não recebem props: leem a rota daqui e navegam por irMkt.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { hashDaArea, lerHashDaArea } from "@/area/CascaDeArea";

export const PREFIXO_MKT = "mkt";

export interface RotaAtualMkt { tela: string; id?: string }

export function lerRotaMkt(): RotaAtualMkt {
  return lerHashDaArea(PREFIXO_MKT);
}

/** Vai pra uma tela do Marketing (e, opcional, um item dela). */
export function irMkt(tela: string, id?: string) {
  window.location.hash = hashDaArea(PREFIXO_MKT, id ? { tela, id } : { tela });
  window.scrollTo(0, 0);
}

/** A rota atual, atualizada quando o endereço muda. */
export function useRotaMkt(): RotaAtualMkt {
  const [r, setR] = useState<RotaAtualMkt>(lerRotaMkt);
  useEffect(() => {
    const on = () => setR(lerRotaMkt());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}
