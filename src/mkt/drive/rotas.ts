// src/mkt/drive/rotas.ts — a tela "Drive" na área Marketing (0241).
import { lazy } from "react";
import type { RotaMkt } from "../rotas";

export const ROTAS_DRIVE: RotaMkt[] = [
  {
    id: "drive",
    rotulo: "Drive",
    grupo: "comum", // serve o Orgânico e o Tráfego
    icone: "pasta",
    componente: lazy(() => import("./DrivePage")),
  },
];
