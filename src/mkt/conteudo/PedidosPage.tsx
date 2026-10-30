// src/mkt/conteudo/PedidosPage.tsx
// -----------------------------------------------------------------------------
// PEDIDOS DO TRÁFEGO (0240): o Tráfego pede criativo / campanha / conteúdo ao
// Orgânico. O pedido é um card do quadro (eh_pedido) que nasce na coluna de
// entrada; aqui o Tráfego acompanha onde cada um está.
// -----------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao, Vazio } from "@/rel/ui";
import { useMkt } from "../contexto";
import { irMkt, useRotaMkt } from "../navegacao";
import CardDetalhe from "./CardDetalhe";
import NovoCard from "./NovoCard";
import { dataCurta, estaAtrasado, hojeSP } from "./regras";
import { Cabecalho, ChipStatus, ChipTipo, useQuadro } from "./ui";

export default function PedidosPage() {
  const rota = useRotaMkt();
  const { currentUser } = useQsAuth();
  const { nomeDe } = useMkt();
  const { colunas, cards, carregando, erro, recarregar } = useQuadro();
  const [novo, setNovo] = useState(false);
  const [soMeus, setSoMeus] = useState(true);
  const hoje = hojeSP();
  const colPorId = useMemo(() => new Map(colunas.map((k) => [k.id, k])), [colunas]);
  const pedidos = cards
    .filter((c) => c.eh_pedido && (!soMeus || c.solicitante_id === currentUser?.id))
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em));

  if (carregando) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  if (erro) return <Aviso tom="erro">{erro}</Aviso>;

  return (
    <div className="max-w-4xl mx-auto">
      <Cabecalho titulo="Pedidos ao Orgânico"
        texto="Criativo, campanha ou conteúdo que o Tráfego precisa. Antes de pedir, vale olhar a Biblioteca."
        acoes={<>
          <Botao onClick={() => irMkt("biblioteca")}>Ver Biblioteca</Botao>
          <Botao variante="primario" onClick={() => setNovo(true)}>+ Novo pedido</Botao>
        </>} />
      <label className="inline-flex items-center gap-1.5 text-[13px] font-semibold mb-3 cursor-pointer" style={{ color: "var(--ink2)" }}>
        <input type="checkbox" checked={soMeus} onChange={(e) => setSoMeus(e.target.checked)} /> Só os que eu pedi
      </label>
      {pedidos.length === 0 ? (
        <div className="rel-card"><Vazio titulo="Nenhum pedido" texto="Clique em Novo pedido: ele cai no quadro do Orgânico e o pessoal recebe o aviso." /></div>
      ) : (
        <ul className="space-y-2">
          {pedidos.map((c) => {
            const col = colPorId.get(c.coluna_id);
            const atrasado = estaAtrasado(c, col?.tipo, hoje);
            return (
              <li key={c.id}>
                <button type="button" className="rel-card w-full text-left p-3 flex flex-col sm:flex-row sm:items-center gap-2" onClick={() => irMkt("pedidos", c.id)}>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{c.titulo}</span>
                    <span className="flex flex-wrap gap-1 mt-1"><ChipTipo tipo={c.tipo} /><ChipStatus status={c.status_aprovacao} rodada={c.rodada} /></span>
                  </span>
                  <span className="text-[12px] sm:text-right" style={{ color: "var(--ink2)" }}>
                    <b>{col?.nome}</b><br />
                    {c.responsavel_id ? nomeDe(c.responsavel_id) : "Ainda sem responsável"}
                    {c.prazo && <span style={{ color: atrasado ? "var(--err-ink)" : "var(--ink3)" }}> · até {dataCurta(c.prazo, hoje)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {novo && <NovoCard modo="pedido" colunas={colunas} onFechar={() => setNovo(false)} onCriado={(id) => { setNovo(false); void recarregar(); irMkt("pedidos", id); }} />}
      {rota.id && <CardDetalhe key={rota.id} id={rota.id} colunas={colunas} onAbrir={(id) => irMkt("pedidos", id)} onFechar={() => irMkt("pedidos")} onMudou={() => void recarregar()} />}
    </div>
  );
}
