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
const Perfis = lazy(() => import("../planejamento/PerfisPage"));
const Agencia = lazy(() => import("../planejamento/AgenciaContasPage"));

export default function AjustesPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PaginaComAbas
        titulo="Ajustes"
        subtitulo="Quem é quem no Marketing, as etapas do quadro, os perfis onde a gente posta e o acesso da agência."
        abas={[
          { id: "equipe", rotulo: "Equipe", componente: Equipe },
          { id: "colunas", rotulo: "Colunas", componente: Colunas },
          { id: "perfis", rotulo: "Perfis e redes", componente: Perfis },
          { id: "agencia", rotulo: "Agência", componente: Agencia },
        ]}
      />
    </div>
  );
}
