// src/mkt/rotas.ts
// -----------------------------------------------------------------------------
// CONTRATO DO MENU DO MARKETING (0240, 30/10/2026).
//
// O menu da área lê ROTAS_MKT. Cada frente do Marketing cria o seu
// `src/mkt/<frente>/rotas.ts` exportando `ROTAS_<FRENTE>: RotaMkt[]` (com
// `import type { RotaMkt } from "../rotas"`) e a integração junta aqui embaixo.
//
//   id         → vira o endereço: #mkt/<id>  (e #mkt/<id>/<algo> pra abrir um item;
//                a tela lê com useRotaMkt() de src/mkt/navegacao.ts)
//   grupo      → em qual grupo do menu aparece (ordem dos grupos: GRUPOS_MKT)
//   icone      → nome de um ícone de src/mkt/icones.tsx (sem = ícone do grupo)
//   componente → React.lazy(() => import("./MinhaTela")) — sem props
//   papeis     → só mostra no menu pra quem tem um destes papéis do Marketing
//                ('organico' | 'trafego' | 'gestor'). Sem = todo mundo.
//                Gestor/admin e quem ainda não tem papel definido veem tudo.
//                ESCONDE do menu; não é trava — a trava é a RLS no banco.
// -----------------------------------------------------------------------------
import type React from "react";
import { ROTAS_CONTEUDO } from "./conteudo/rotas";
import { ROTAS_DRIVE } from "./drive/rotas";
import { ROTAS_DISPAROS } from "./disparos/rotas";
import { ROTAS_GRUPOS } from "./grupos/rotas";
import { ROTAS_AUTOMACOES } from "./automacoes/rotas";
import { ROTAS_EMAIL } from "./email/rotas";
import { registrarSeletorDrive } from "./conteudo/seletorDrive";
import { SeletorDriveDoCard } from "./drive/seletorDoCard";

// "Escolher do Drive" nos anexos do card (o picker em si é carregado sob demanda).
registrarSeletorDrive(SeletorDriveDoCard);

export interface RotaMkt {
  id: string;
  rotulo: string;
  grupo: 'organico' | 'trafego' | 'comum' | 'disparos' | 'automacoes' | 'email';
  icone?: string;
  componente: React.LazyExoticComponent<React.ComponentType>;
  papeis?: string[];
}

export type GrupoMkt = RotaMkt["grupo"];

/** Ordem e nome dos grupos no menu. Grupo sem nenhuma rota não aparece. */
export const GRUPOS_MKT: { id: GrupoMkt; rotulo: string }[] = [
  { id: "organico", rotulo: "Orgânico" },
  { id: "trafego", rotulo: "Tráfego" },
  { id: "comum", rotulo: "Comum" },
  { id: "disparos", rotulo: "Disparos" },
  { id: "automacoes", rotulo: "Automações" },
  { id: "email", rotulo: "E-mail" },
];

export const ROTAS_MKT: RotaMkt[] = [
  ...ROTAS_CONTEUDO,
  ...ROTAS_DRIVE,
  ...ROTAS_DISPAROS,
  ...ROTAS_GRUPOS,
  ...ROTAS_AUTOMACOES,
  ...ROTAS_EMAIL,
];
