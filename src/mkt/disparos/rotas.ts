// src/mkt/disparos/rotas.ts
// As telas da frente "Disparos" da área de Marketing (0242). Quem monta o menu
// é src/mkt/rotas.ts (frente conteudo): é só espalhar ROTAS_DISPAROS lá.
import { lazy } from "react";
import type { RotaMkt } from "./tipoRota";

const PAPEIS = ["admin", "marketing", "gestor"];

export const ROTAS_DISPAROS: RotaMkt[] = [
  { id: "mkt-contatos", rotulo: "Contatos", grupo: "disparos", icone: "users", papeis: PAPEIS, componente: lazy(() => import("./ContatosPage")) },
  { id: "mkt-disparos", rotulo: "Disparos WhatsApp", grupo: "disparos", icone: "send", papeis: PAPEIS, componente: lazy(() => import("./DisparosMktPage")) },
  { id: "mkt-recorrencias", rotulo: "Recorrências", grupo: "disparos", icone: "repeat", papeis: PAPEIS, componente: lazy(() => import("./RecorrenciasPage")) },
  { id: "mkt-sequencias", rotulo: "Sequências", grupo: "disparos", icone: "list-ordered", papeis: PAPEIS, componente: lazy(() => import("./SequenciasPage")) },
];
