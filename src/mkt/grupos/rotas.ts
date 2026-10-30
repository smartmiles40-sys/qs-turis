// src/mkt/grupos/rotas.ts — "Grupos" no menu do Marketing: UMA entrada, com as abas
// Campanhas | Cadências | Grupos | Celular dentro da página (pedido do Bruno, 30/10:
// "não precisa ter tanta coisa assim no menu esquerdo, pode ser um campo dentro da página").
// O chip do Marketing virou o selo no canto da página.
import { lazy } from "react";
import type { RotaMkt } from "../rotas";
import { hashNovoDaRotaAntiga } from "./rotasAntigas";

export const ROTAS_GRUPOS: RotaMkt[] = [
  { id: "grupos", rotulo: "Grupos", grupo: "disparos", icone: "grupo", componente: lazy(() => import("./GruposArea")) },
];

// Links antigos (#mkt/grupos-campanhas…) → #mkt/grupos?aba=…  Roda ao carregar o módulo
// (antes da área ler a rota) e a cada "hashchange" — este ouvinte entra antes do da área,
// então a área já lê o endereço corrigido. replaceState: não enche o "voltar".
if (typeof window !== "undefined") {
  const corrigir = () => {
    const novo = hashNovoDaRotaAntiga(window.location.hash);
    if (novo) history.replaceState(history.state, "", window.location.pathname + window.location.search + novo);
  };
  corrigir();
  window.addEventListener("hashchange", corrigir);
}
