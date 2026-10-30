// src/mkt/disparos/rotas.ts
// A entrada "WhatsApp" do menu do Marketing (Bruno, 30/10/2026: menos coisa no
// menu esquerdo). Disparos, Automações, Conversas e Contatos são ABAS dentro da
// página (WhatsAppPage); recorrência e sequência são opções dentro de Disparos.
// Quem monta o menu é src/mkt/rotas.ts: é só espalhar ROTAS_DISPAROS lá.
import { lazy } from "react";
import type { RotaMkt } from "../rotas";

export const ROTAS_DISPAROS: RotaMkt[] = [
  { id: "whatsapp", rotulo: "WhatsApp", grupo: "disparos", icone: "disparo", componente: lazy(() => import("./WhatsAppPage")) },
];
