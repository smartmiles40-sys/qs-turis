// src/mkt/planejamento/rotas.ts — Planejamento de conteúdo (0395, 13/11/2026).
// Fica no grupo "Comum": o Orgânico planeja, mas os supervisores dos DOIS times
// deixam obs. #mkt/planejamentos/<id> abre um planejamento.
import { lazy } from "react";
import type { RotaMkt } from "../rotas";

export const ROTAS_PLANEJAMENTO: RotaMkt[] = [
  { id: "planejamentos", rotulo: "Planejamento de conteúdo", grupo: "comum", icone: "planejamento", componente: lazy(() => import("./PlanejamentosPage")) },
];
