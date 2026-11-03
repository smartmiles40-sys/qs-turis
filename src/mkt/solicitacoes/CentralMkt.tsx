// src/mkt/solicitacoes/CentralMkt.tsx
// -----------------------------------------------------------------------------
// Central de Solicitações dentro do Marketing (0283, 03/11/2026): a mesma tela
// dos outros setores, com setor = "marketing". Endereço #mkt/solicitacoes/<id>
// (é o link que o aviso do sino abre). A recontagem da bolinha do menu vem do
// evento de solicitação (src/solicitacoes/lib.ts) — não precisa de prop.
// -----------------------------------------------------------------------------
import SolicitacoesPage from "@/solicitacoes/SolicitacoesPage";
import { avisarSolicitacaoMudou } from "@/solicitacoes/lib";
import { irMkt, useRotaMkt } from "../navegacao";

export default function CentralMkt() {
  const rota = useRotaMkt();
  return (
    <SolicitacoesPage setor="marketing" abrirId={rota.id ?? null}
      onAbrirId={(id) => irMkt("solicitacoes", id ?? undefined)}
      onMudou={() => avisarSolicitacaoMudou()} />
  );
}
