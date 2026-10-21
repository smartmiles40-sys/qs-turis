// src/propostas/PropostasDaSolicitacao.tsx
// -----------------------------------------------------------------------------
// Dentro de uma solicitação (0156): as propostas feitas pra ela + "Montar
// proposta", que já nasce amarrada (solicitação, cliente, venda, lead e nome).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Botao, Etiqueta } from "@/rel/ui";
import type { Solicitacao } from "@/solicitacoes/lib";
import { STATUS_PROPOSTA, TOM_PROPOSTA, listarPropostas, propostaVazia, salvarProposta, type PropostaResumo } from "./lib";

export default function PropostasDaSolicitacao({ s, podeMontar, onAbrir }: { s: Solicitacao; podeMontar: boolean; onAbrir: (id: string) => void }) {
  const [lista, setLista] = useState<PropostaResumo[] | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => { listarPropostas({ solicitacaoId: s.id }).then(setLista).catch(() => setLista([])); }, [s.id]);

  async function montar() {
    setCriando(true); setErro(null);
    try {
      const id = await salvarProposta({
        ...propostaVazia(s.para_setor),
        solicitacao_id: s.id, cliente_id: s.cliente_id, viagem_id: s.viagem_id, lead_id: s.lead_id,
        cliente_nome: (s.sobre_nome ?? "").split(" · ")[0] || "",
      });
      onAbrir(id);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não criou."); setCriando(false); }
  }

  if (!lista) return null;
  if (!lista.length && !podeMontar) return null;
  return (
    <div className="rel-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Propostas{lista.length ? ` (${lista.length})` : ""}</p>
        {podeMontar && <Botao variante={lista.length ? "secundario" : "primario"} onClick={() => void montar()} disabled={criando}>{criando ? "Criando…" : "Montar proposta"}</Botao>}
      </div>
      {erro && <p className="text-[12.5px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
      {lista.map((x) => (
        <button key={x.id} type="button" onClick={() => onAbrir(x.id)} className="rel-linha w-full text-left rounded-lg px-2 py-1.5 flex items-center gap-2 text-[13px]">
          <span className="flex-1 truncate" style={{ color: "var(--ink)" }}>Nº {x.numero}{x.titulo || x.destino ? ` · ${x.titulo || x.destino}` : ""}{x.status === "enviada" && x.vista_em ? " · 👀 cliente abriu" : ""}</span>
          <Etiqueta tom={TOM_PROPOSTA[x.status]}>{STATUS_PROPOSTA[x.status]}</Etiqueta>
        </button>
      ))}
    </div>
  );
}
