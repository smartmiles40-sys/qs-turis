// src/mkt/drive/tipoRota.ts
// Cópia LOCAL do contrato de rotas da área Marketing (o original é criado pela
// frente "conteudo" em src/mkt/rotas.ts). Existe só pra esta frente compilar
// sozinha — na integração, trocar o import em ./rotas.ts por "../rotas" e
// apagar este arquivo.
import type React from "react";

export interface RotaMkt {
  id: string;
  rotulo: string;
  grupo: "organico" | "trafego" | "comum" | "disparos" | "automacoes" | "email";
  icone?: string;
  componente: React.LazyExoticComponent<React.ComponentType>;
  papeis?: string[];
}
