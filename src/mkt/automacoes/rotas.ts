// src/mkt/automacoes/rotas.ts
// As telas da frente AUTOMAÇÕES (igual ManyChat) para o menu da área de Marketing.
import { lazy } from "react";
import type { RotaMkt } from "../rotas";

export const ROTAS_AUTOMACOES: RotaMkt[] = [
  { id: "automacoes", rotulo: "Automações (WhatsApp)", grupo: "automacoes", icone: "zap", componente: lazy(() => import("./AutomacoesPage")) },
  { id: "conversas", rotulo: "Conversas (número MKT)", grupo: "automacoes", icone: "message", componente: lazy(() => import("./ConversasPage")) },
  { id: "instagram", rotulo: "Instagram", grupo: "automacoes", icone: "instagram", componente: lazy(() => import("./InstagramPage")) },
];
