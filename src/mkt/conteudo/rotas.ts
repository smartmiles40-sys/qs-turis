// src/mkt/conteudo/rotas.ts — telas da frente "conteúdo" (quadro + aprovação), 0240.
import { lazy } from "react";
import type { RotaMkt } from "../rotas";

export const ROTAS_CONTEUDO: RotaMkt[] = [
  // Orgânico
  { id: "calendario", rotulo: "Calendário editorial", grupo: "organico", icone: "calendario", componente: lazy(() => import("./QuadroPage").then((m) => ({ default: m.CalendarioPage }))), papeis: ["organico"] },
  // Tráfego
  { id: "pedidos", rotulo: "Pedidos ao Orgânico", grupo: "trafego", icone: "pedido", componente: lazy(() => import("./PedidosPage")), papeis: ["trafego"] },
  { id: "biblioteca", rotulo: "Biblioteca de conteúdos", grupo: "trafego", icone: "biblioteca", componente: lazy(() => import("./BibliotecaPage")) },
  // Comum
  { id: "quadro", rotulo: "Quadro de conteúdo", grupo: "comum", icone: "quadro", componente: lazy(() => import("./QuadroPage")) },
  { id: "aprovacoes", rotulo: "Aprovações", grupo: "comum", icone: "aprovacao", componente: lazy(() => import("./AprovacoesPage")) },
  { id: "equipe", rotulo: "Equipe e papéis", grupo: "comum", icone: "equipe", componente: lazy(() => import("./EquipeMktPage")) },
  { id: "colunas", rotulo: "Colunas do quadro", grupo: "comum", icone: "colunas", componente: lazy(() => import("./ColunasPage")), papeis: ["gestor"] },
];
