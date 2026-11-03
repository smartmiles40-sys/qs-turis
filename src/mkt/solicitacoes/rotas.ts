// src/mkt/solicitacoes/rotas.ts — a Central de Solicitações no menu do Marketing
// (0283, 03/11/2026). Só aparece quando o banco já aceita o Marketing na Central
// (MarketingApp confere com centralTemMarketing()).
import { lazy } from "react";
import type { RotaMkt } from "../rotas";

export const ROTA_SOLICITACOES_MKT: RotaMkt = {
  id: "solicitacoes", rotulo: "Solicitações", grupo: "comum", icone: "pedido",
  componente: lazy(() => import("./CentralMkt")),
};
