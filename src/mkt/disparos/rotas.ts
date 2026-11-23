// src/mkt/disparos/rotas.ts
// A entrada "WhatsApp" do menu do Marketing (Bruno, 30/10/2026: menos coisa no
// menu esquerdo). Disparos, Automações, Conversas e Contatos são ABAS dentro da
// página (WhatsAppPage); recorrência e sequência são opções dentro de Disparos.
// Quem monta o menu é src/mkt/rotas.ts: é só espalhar ROTAS_DISPAROS lá.
import { lazy } from "react";
import type { RotaMkt } from "../rotas";

export const ROTAS_DISPAROS: RotaMkt[] = [
  { id: "whatsapp", rotulo: "WhatsApp", grupo: "disparos", icone: "disparo", componente: lazy(() => import("./WhatsAppPage")), papeis: ["organico"] },
  // 0411/0412 (23/11/2026): o disparo em massa do Relacionamento também aqui, com a escolha do número
  // (Rel, SDR ou Marketing) e a aba Acompanhar. No menu só pra gestor/admin; quem dispara de verdade
  // continua sendo o time do Relacionamento (a API confere o setor).
  { id: "disparos-em-massa", rotulo: "Disparos em massa", grupo: "disparos", icone: "disparo", componente: lazy(() => import("@/rel/disparos/DisparosRelPage")), papeis: ["gestor"] },
];
