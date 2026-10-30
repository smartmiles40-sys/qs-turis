// src/mkt/email/tipoRota.ts
// Cópia LOCAL e idêntica do contrato de src/mkt/rotas.ts (frente Conteúdo, 0240).
// Existe só pra esta frente compilar sozinha; na integração, trocar o import de
// ./tipoRota por ../rotas e apagar este arquivo.
import type React from "react";

export interface RotaMkt {
  id: string;
  rotulo: string;
  grupo: "organico" | "trafego" | "comum" | "disparos" | "automacoes" | "email";
  icone?: string;
  componente: React.LazyExoticComponent<React.ComponentType>;
  papeis?: string[];
}
