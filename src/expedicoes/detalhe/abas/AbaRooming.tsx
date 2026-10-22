// Aba "Rooming" da expedição (app antigo: app/(app)/expedicoes/[id]/rooming/).
// Carrega passageiros, quartos, alocações, grupos e extensões e entrega pro
// quadro em ../../rooming/. Atualiza sozinha (realtime) quando alguém mexe.
import { useCallback, useEffect, useState } from "react";
import { useAoVivo, Carregando } from "../../ui";
import { carregarRooming, type DadosRooming } from "../../rooming/dados";
import RoomingBoard from "../../rooming/RoomingBoard";
import type { PropsAba } from "../ExpedicaoDetalhe";

export default function AbaRooming({ exp }: PropsAba) {
  const [dados, setDados] = useState<DadosRooming | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try { setDados(await carregarRooming(exp.id)); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar o rooming"); }
  }, [exp.id]);
  useEffect(() => { setDados(null); void carregar(); }, [carregar]);
  useAoVivo([
    { tabela: "quartos", filtro: `expedicao_id=eq.${exp.id}` },
    { tabela: "passageiros", filtro: `expedicao_id=eq.${exp.id}` },
    { tabela: "extensoes", filtro: `expedicao_id=eq.${exp.id}` },
    { tabela: "grupos_expedicao", filtro: `expedicao_id=eq.${exp.id}` },
  ], carregar, 500);
  // Sem expedicao_id (não dá pra filtrar no realtime): espera de 2 s pra mexida no
  // rooming de OUTRA expedição não recarregar este quadro a cada arraste. As ações
  // daqui já recarregam na hora (RoomingBoard → recarregar).
  useAoVivo([{ tabela: "passageiro_quarto" }, { tabela: "passageiro_extensao" }], carregar, 2000);

  if (erro && !dados) return <p className="py-10 text-center text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>;
  if (!dados) return <Carregando texto="Carregando rooming…" />;
  return <RoomingBoard expId={exp.id} dados={dados} recarregar={carregar} />;
}
