// src/mkt/conteudo/rotas.ts — telas da frente "conteúdo" (quadro + aprovação), 0240.
// "Equipe e papéis" + "Colunas do quadro" viraram UMA entrada (Ajustes, com abas,
// só pro gestor) em 30/10/2026 — os links antigos (#mkt/equipe, #mkt/colunas)
// caem na aba certa (idsAntigos.ts).
import { lazy } from "react";
import type { RotaMkt } from "../rotas";
import { IDS_ANTIGOS_CONTEUDO, instalarIdsAntigos } from "./idsAntigos";

instalarIdsAntigos("mkt", IDS_ANTIGOS_CONTEUDO);

export const ROTAS_CONTEUDO: RotaMkt[] = [
  // Orgânico
  { id: "calendario", rotulo: "Calendário editorial", grupo: "organico", icone: "calendario", componente: lazy(() => import("./QuadroPage").then((m) => ({ default: m.CalendarioPage }))), papeis: ["organico"] },
  // Tráfego
  { id: "pedidos", rotulo: "Pedidos ao Orgânico", grupo: "trafego", icone: "pedido", componente: lazy(() => import("./PedidosPage")), papeis: ["trafego"] },
  { id: "biblioteca", rotulo: "Biblioteca de conteúdos", grupo: "trafego", icone: "biblioteca", componente: lazy(() => import("./BibliotecaPage")), papeis: ["trafego"] },
  // Comum
  { id: "quadro", rotulo: "Quadro de conteúdo", grupo: "comum", icone: "quadro", componente: lazy(() => import("./QuadroPage")) },
  { id: "aprovacoes", rotulo: "Aprovações", grupo: "comum", icone: "aprovacao", componente: lazy(() => import("./AprovacoesPage")) },
  { id: "ajustes", rotulo: "Ajustes", grupo: "comum", icone: "config", componente: lazy(() => import("./AjustesPage")), papeis: ["gestor"] },
];
