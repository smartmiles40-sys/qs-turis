// src/mkt/trafego/rotas.ts — Tráfego › Meta Ads (0265): verba, funil e travas.
// Uma entrada no menu; o resto são abas dentro da página (pedido do Bruno: menu enxuto).
import { lazy } from "react";
import type { RotaMkt } from "../rotas";

export const ROTAS_TRAFEGO: RotaMkt[] = [
  { id: "meta-ads", rotulo: "Meta Ads", grupo: "trafego", icone: "grafico", componente: lazy(() => import("./MetaAdsPage")), papeis: ["trafego"] },
];
