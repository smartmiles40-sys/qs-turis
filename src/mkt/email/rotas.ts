// src/mkt/email/rotas.ts — telas da frente E-mail marketing (0245).
// A área de Marketing (frente Conteúdo) junta ROTAS_EMAIL no menu, grupo "email".
import { lazy } from "react";
import type { RotaMkt } from "./tipoRota";

export const ROTAS_EMAIL: RotaMkt[] = [
  { id: "email-campanhas", rotulo: "Campanhas de e-mail", grupo: "email", componente: lazy(() => import("./telas/Campanhas")) },
  { id: "email-modelos", rotulo: "Modelos de e-mail", grupo: "email", componente: lazy(() => import("./telas/Modelos")) },
  { id: "email-segmentos", rotulo: "Segmentos e pontuação", grupo: "email", componente: lazy(() => import("./telas/Segmentos")) },
  { id: "email-automacoes", rotulo: "Automações de e-mail", grupo: "email", componente: lazy(() => import("./telas/Automacoes")) },
  { id: "email-relatorios", rotulo: "Relatórios de e-mail", grupo: "email", componente: lazy(() => import("./telas/Relatorios")) },
  { id: "email-conexao", rotulo: "Conexão (Resend)", grupo: "email", componente: lazy(() => import("./telas/Conexao")), papeis: ["admin", "marketing"] },
];
