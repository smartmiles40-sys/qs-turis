// src/expedicoes/paginas/ChecklistPadrao.tsx
// -----------------------------------------------------------------------------
// ENDEREÇO ANTIGO #ops/checklist-padrao (29/10, ec105bf). Em 30/10 o Bruno pediu o
// checklist DENTRO do cockpit da expedição, como aba, e sem item solto no menu: o
// padrão agora se edita pelo botão "Editar o padrão" da aba Checklist
// (checklist/EditorPadrao.tsx). Este endereço só redireciona pra Central de
// Expedições, com um aviso de onde ficou — link salvo não quebra.
// -----------------------------------------------------------------------------
import { useEffect } from "react";
import { useExp } from "../contexto";
import { Carregando } from "../ui";

export default function ChecklistPadrao() {
  const { ir, avisar } = useExp();
  useEffect(() => {
    avisar("O checklist padrão agora fica na aba Checklist de cada expedição (botão “Editar o padrão”).");
    ir("expedicoes");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <Carregando texto="Abrindo as expedições…" />;
}
