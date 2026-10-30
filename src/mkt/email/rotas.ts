// src/mkt/email/rotas.ts — frente E-mail marketing (0245).
// UMA entrada no menu (30/10/2026, pedido do Bruno: "não precisa ter tanta coisa
// no menu esquerdo"): Campanhas | Modelos | Públicos | Automações viram abas da
// mesma página; relatório fica dentro da campanha e a conexão (Resend) é o selo
// no canto. Os ids antigos (#mkt/email-modelos…) caem na aba certa.
import { lazy } from "react";
import type { RotaMkt } from "../rotas";
import { instalarIdsAntigos, type MapaIdsAntigos } from "../conteudo/idsAntigos";

export const IDS_ANTIGOS_EMAIL: MapaIdsAntigos = {
  "email-campanhas": { tela: "email" },
  "email-relatorios": { tela: "email" },
  "email-modelos": { tela: "email", params: { aba: "modelos" } },
  "email-segmentos": { tela: "email", params: { aba: "publicos" } },
  "email-automacoes": { tela: "email", params: { aba: "automacoes" } },
  "email-conexao": { tela: "email", params: { conexao: "1" } },
};
instalarIdsAntigos("mkt", IDS_ANTIGOS_EMAIL);

export const ROTAS_EMAIL: RotaMkt[] = [
  { id: "email", rotulo: "E-mail", grupo: "email", icone: "email", componente: lazy(() => import("./telas/EmailPage")) },
];
