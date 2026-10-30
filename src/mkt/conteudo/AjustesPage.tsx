// src/mkt/conteudo/AjustesPage.tsx
// -----------------------------------------------------------------------------
// AJUSTES DO QUADRO (30/10/2026): "Equipe e papéis" + "Colunas do quadro" numa
// entrada só do menu, com abas (só o gestor vê no menu; quem trava é a RPC/RLS).
// A engrenagem do Quadro também abre aqui, direto na aba Colunas.
// -----------------------------------------------------------------------------
import { lazy } from "react";
import { PaginaComAbas } from "../Abas";

const Equipe = lazy(() => import("./EquipeMktPage"));
const Colunas = lazy(() => import("./ColunasPage"));

export default function AjustesPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PaginaComAbas
        titulo="Ajustes"
        subtitulo="Quem é quem no Marketing e as etapas (colunas) do quadro de conteúdo."
        abas={[
          { id: "equipe", rotulo: "Equipe", componente: Equipe },
          { id: "colunas", rotulo: "Colunas", componente: Colunas },
        ]}
      />
    </div>
  );
}
