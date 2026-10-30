// src/mkt/grupos/rotas.ts — telas da frente "Grupos do WhatsApp" (0243) no menu do Marketing.
// Ícones: nomes de src/mkt/icones.tsx (frente conteudo).
import { lazy } from "react";
import type { RotaMkt } from "./tipoRota";

export const ROTAS_GRUPOS: RotaMkt[] = [
  { id: "grupos", rotulo: "Grupos do WhatsApp", grupo: "disparos", icone: "grupo", componente: lazy(() => import("./GruposPage")) },
  { id: "grupos-campanhas", rotulo: "Campanhas p/ grupos", grupo: "disparos", icone: "disparo", componente: lazy(() => import("./CampanhasPage")) },
  { id: "grupos-cadencias", rotulo: "Cadências de grupo", grupo: "disparos", icone: "automacao", componente: lazy(() => import("./CadenciasPage")) },
  { id: "grupos-celular", rotulo: "Celular do MKT", grupo: "disparos", icone: "lista", componente: lazy(() => import("./CelularPage")) },
  { id: "grupos-chip", rotulo: "Chip do Marketing", grupo: "disparos", icone: "config", componente: lazy(() => import("./ConexaoPage")) },
];
