// src/mkt/automacoes/tipoRota.ts
// Cópia local IDÊNTICA do contrato `RotaMkt` de src/mkt/rotas.ts (criado pela
// frente "conteudo", 0240). Fica aqui para esta frente compilar sozinha; na
// junção, troque o import de rotas.ts para "@/mkt/rotas" e apague este arquivo.
import type React from "react";

export interface RotaMkt {
  id: string;
  rotulo: string;
  grupo: "organico" | "trafego" | "comum" | "disparos" | "automacoes" | "email";
  icone?: string;
  componente: React.LazyExoticComponent<React.ComponentType>;
  papeis?: string[];
}
