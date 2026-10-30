// Gera (memorizado) o HTML do e-mail a partir dos blocos + dados do rodapé.
import { useMemo } from "react";
import { renderEmail, type Bloco } from "./blocos";

export function useHtmlDosBlocos(blocos: Bloco[], rodape: { texto?: string | null; endereco?: string | null }) {
  return useMemo(() => renderEmail(blocos, { rodapeTexto: rodape.texto, rodapeEndereco: rodape.endereco }), [blocos, rodape.texto, rodape.endereco]);
}
