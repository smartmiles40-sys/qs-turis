// src/mkt/agendamento/rotas.ts — Marketing › Links de agendamento (0354).
// Em "Comum": serve o Orgânico e o Tráfego.
import { lazy } from "react";
import type { RotaMkt } from "../rotas";

export const ROTAS_AGENDAMENTO: RotaMkt[] = [
  { id: "links-agendamento", rotulo: "Links de agendamento", grupo: "comum", icone: "calendario", componente: lazy(() => import("./LinksAgendamento")), papeis: ["trafego"],
    // Giovanna (Orgânico) cria os links com SDR/closer — Bruno, 18/11.
    pessoas: ["849f2f55-7be0-4f4b-80bf-04173c7e36a6"] },
];
