// src/closer/VendaDoCliente.tsx
// -----------------------------------------------------------------------------
// A VENDA NA FICHA DA PESSOA (Bruno, 26/10): contrato e link de pagamento ficam
// também no cadastro do cliente (aba "Venda" do lead, dentro da área do
// closer), não só no cartão do pipeline. São os MESMOS blocos do cartão
// (ContratoBloco e PagamentoBloco), sobre o cartão aberto do cliente ou, sem
// cartão aberto, o mais recente.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Aviso, Botao, Etiqueta } from "@/rel/ui";
import ContratoBloco from "./ContratoBloco";
import PagamentoBloco from "./PagamentoBloco";
import { ETAPAS_FINAIS, NOME_ETAPA, abrirNegocio, brl, dataBr, type Negocio } from "./lib";

const SELECT = "*, lead:qs_leads(id, full_name, first_name, last_name, phone, email, bitrix_id), closer:qs_users!qs_closer_negocios_closer_id_fkey(name)";

export default function VendaDoCliente({ leadId }: { leadId: string }) {
  const [n, setN] = useState<Negocio | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    // Cartão no quadro primeiro (aberto antes de encerrado), depois o arquivo.
    const { data, error } = await supabase.from("qs_closer_negocios").select(SELECT)
      .eq("lead_id", leadId)
      .order("arquivado_em", { ascending: false, nullsFirst: true })
      .order("criado_em", { ascending: false })
      .limit(5);
    if (error) setErro(error.message);
    const lista = (data ?? []) as unknown as Negocio[];
    const noQuadro = lista.filter((x) => !x.arquivado_em);
    setN(noQuadro.find((x) => !ETAPAS_FINAIS.includes(x.etapa)) ?? noQuadro[0] ?? lista[0] ?? null);
    setCarregando(false);
  }, [leadId]);
  useEffect(() => { void carregar(); }, [carregar]);

  const irPara = (hash: string) => { window.location.hash = hash; };

  if (carregando) return <p className="text-sm" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  if (erro) return <Aviso tom="erro">{erro}</Aviso>;

  if (!n || n.arquivado_em) {
    return (
      <div className="rel-card p-5 space-y-3">
        <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
          {n ? "O cartão deste cliente está no arquivo (pipeline antigo)." : "Este cliente ainda não tem cartão no pipeline."}
        </p>
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
          O cartão nasce quando uma reunião é agendada com você. Pra mandar contrato ou link de pagamento agora, traga o cliente pro quadro.
        </p>
        <Botao variante="primario" disabled={abrindo} onClick={async () => {
          setAbrindo(true);
          try { await abrirNegocio(leadId); await carregar(); }
          catch (e) { setErro((e as Error).message); }
          finally { setAbrindo(false); }
        }}>{abrindo ? "Abrindo…" : "Trazer pro pipeline"}</Botao>
      </div>
    );
  }

  const valor = Number(n.ficha?.valor_total ?? n.valor_previsto ?? 0);
  return (
    <div className="space-y-4">
      <div className="rel-card p-4 flex flex-wrap items-center gap-3">
        <Etiqueta tom={n.etapa === "perdido" || n.etapa === "venda_cancelada" ? "erro" : "rel"}>{NOME_ETAPA[n.etapa]}</Etiqueta>
        <span className="text-[13px] flex-1" style={{ color: "var(--ink2)" }}>
          {valor ? brl(valor) : "sem valor"} · desde {dataBr(n.etapa_em)}{n.closer?.name ? ` · closer ${n.closer.name}` : ""}
        </span>
        <Botao variante="fantasma" onClick={() => irPara(`#closer/pipeline/${n.id}`)}>Abrir no pipeline</Botao>
      </div>
      <ContratoBloco negocio={n} onMudou={() => void carregar()} />
      <PagamentoBloco negocio={n} onMudou={() => void carregar()} onAbrirSolicitacao={(id) => irPara(`#closer/solicitacoes/${id}`)} />
    </div>
  );
}
