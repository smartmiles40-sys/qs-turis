// src/fin/ui.tsx
// -----------------------------------------------------------------------------
// Peças de interface da área FINANCEIRO (0126, 14/10/2026).
//
// São as MESMAS peças do Relacionamento (../rel/ui: Botao, Campo, Entrada,
// Modal, Etiqueta, Aviso, Vazio, Avatar, classes rel-card/rel-input/rel-linha)
// — elas leem a cor da área das variáveis --rel*, então aqui só trocamos essas
// variáveis pela cor do Financeiro (índigo, a mesma da porta do login). Tela do
// Financeiro importa daqui, nunca de ../rel/ui direto: se um dia o Financeiro
// precisar de uma peça diferente, ela nasce neste arquivo sem mexer no Rel.
// -----------------------------------------------------------------------------
import { REL_CSS } from "../rel/ui";

export { Aviso, Avatar, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "../rel/ui";

/** Cor do Financeiro: índigo (#3730A3 com texto branco = 10:1, WCAG AA de sobra). */
export const FIN_CSS = `${REL_CSS}
:root {
  --rel: #3730A3;
  --rel-hover: #312E81;
  --rel-ink: #3730A3;
  --rel-soft: #ECEBFB;
  --fin: #3730A3;
}
html.dark {
  --rel-ink: #A5B4FC;
  --rel-soft: rgba(129, 140, 248, .16);
}
.rel-input:focus, .rel-input:focus-visible { box-shadow: 0 0 0 3px rgba(55, 48, 163, .25); }
`;
