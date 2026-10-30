// src/mkt/disparos/tipoRota.ts
// Cópia local do contrato de src/mkt/rotas.ts (frente conteudo), pra esta
// frente compilar sozinha. Na junção, troque o import por "@/mkt/rotas" e
// apague este arquivo — as duas definições são idênticas.
import type React from "react";

export interface RotaMkt {
  id: string;
  rotulo: string;
  grupo: "organico" | "trafego" | "comum" | "disparos" | "automacoes" | "email";
  icone?: string;
  componente: React.LazyExoticComponent<React.ComponentType>;
  papeis?: string[];
}
