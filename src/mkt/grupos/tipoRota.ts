// src/mkt/grupos/tipoRota.ts
// Cópia LOCAL do contrato de src/mkt/rotas.ts (frente conteudo, 0240), pra esta
// frente compilar sozinha. Na integração, troque o import em ./rotas.ts por
// `import type { RotaMkt } from "../rotas"` e apague este arquivo.
import type React from "react";

export interface RotaMkt {
  id: string;
  rotulo: string;
  grupo: 'organico' | 'trafego' | 'comum' | 'disparos' | 'automacoes' | 'email';
  icone?: string;
  componente: React.LazyExoticComponent<React.ComponentType>;
  papeis?: string[];
}
