// src/mkt/automacoes/rotas.ts
// A entrada "Instagram" do menu do Marketing (igual ManyChat). As automações e
// as conversas do WhatsApp moram nas abas da página WhatsApp
// (src/mkt/disparos/WhatsAppPage.tsx). Fica no mesmo grupo do WhatsApp pra os
// dois canais aparecerem juntos no menu.
import { lazy } from "react";
import type { RotaMkt } from "../rotas";

export const ROTAS_AUTOMACOES: RotaMkt[] = [
  { id: "instagram", rotulo: "Instagram", grupo: "disparos", icone: "automacao", componente: lazy(() => import("./InstagramPage")) },
];
