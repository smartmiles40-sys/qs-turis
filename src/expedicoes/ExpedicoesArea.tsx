// src/expedicoes/ExpedicoesArea.tsx
// -----------------------------------------------------------------------------
// EXPEDIÇÕES DENTRO DO QS (Bruno 21/10/2026: "tudo que existir no sistema
// antigo também existir nesse"). Base: as tabelas do Sistema de Expedições, que
// passaram a morar no banco do QS (0160) com os mesmos nomes.
//
// Entra no menu de Operações (edita) e no do Relacionamento (só vê, mas decide
// inscrições). Endereços: #<area>/<tela>/<caminho> — ex.: #ops/expedicoes/<id>/passageiros.
// Ficam de fora (Bruno): os portais dos clientes (/amigo, /lider, /inscricao
// continuam no app antigo, lendo este banco) e Câmbios.
// -----------------------------------------------------------------------------
import { Suspense, lazy, type ComponentType } from "react";
import { ExpProvider, type TelaExp } from "./contexto";
import { Carregando } from "./ui";

// Redesign 29/10: Expedições abre a Central (por fase); Pacotes segue na lista antiga.
// 29/10: Pacotes = os pacotes personalizados do Relacionamento (rel_viagens) + os cadastrados como expedição.
const PacotesPersonalizados = lazy(() => import("./lista/pacotes/PacotesPersonalizados"));
const CentralExpedicoes = lazy(() => import("./lista/central/CentralExpedicoes"));
const ExpedicaoDetalhe = lazy(() => import("./detalhe/ExpedicaoDetalhe"));
const PAGINAS: Partial<Record<TelaExp, React.LazyExoticComponent<ComponentType>>> = {
  "exp-inicio": lazy(() => import("./paginas/Inicio")),
  avisos: lazy(() => import("./paginas/Avisos")),
  passageiros: lazy(() => import("./paginas/PassageirosGlobal")),
  clientes: lazy(() => import("./paginas/Clientes")),
  inscricoes: lazy(() => import("./paginas/Inscricoes")),
  fornecedores: lazy(() => import("./paginas/Fornecedores")),
  "acessos-amigo": lazy(() => import("./paginas/AcessosAmigo")),
  "exp-config": lazy(() => import("./paginas/Config")),
  "checklist-padrao": lazy(() => import("./paginas/ChecklistPadrao")),
  receitas: lazy(() => import("./paginas/Receitas")),
  // 30/10: Saúde · fila do médico (laudos, acompanhamento, alimentação pra logística)
  saude: lazy(() => import("./paginas/Saude")),
};

export default function ExpedicoesArea({ tela, caminho, ir, setorRelacionamento = false }: {
  tela: TelaExp;
  caminho?: string;
  ir: (tela: TelaExp, caminho?: string) => void;
  setorRelacionamento?: boolean;
}) {
  const Pagina = PAGINAS[tela];
  return (
    <ExpProvider ir={ir} setorRelacionamento={setorRelacionamento}>
      <Suspense fallback={<Carregando />}>
        {(tela === "expedicoes" || tela === "pacotes") && (caminho
          ? <ExpedicaoDetalhe key={caminho.split("/")[0]} caminho={caminho} />
          : tela === "pacotes" ? <PacotesPersonalizados key={tela} /> : <CentralExpedicoes key={tela} />)}
        {Pagina && <Pagina />}
      </Suspense>
    </ExpProvider>
  );
}
