// src/propostas/PropostasDaSolicitacao.tsx
// -----------------------------------------------------------------------------
// Dentro de uma solicitação (0156): as propostas feitas pra ela + "Montar
// proposta", que já nasce amarrada (solicitação, cliente, venda, lead e nome).
//
// 0157 (Bruno: "o link fica preso na solicitação e a pessoa precisa abrir para
// conseguir enviar"): quem MONTA clica e vai pro editor; quem PEDIU clica e
// abre a proposta por cima de tudo (PropostaParaEnviar) — é lá que envia.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { setoresDe, useQsAuth } from "@/contexts/QsAuthContext";
import { Botao, Etiqueta } from "@/rel/ui";
import type { Solicitacao } from "@/solicitacoes/lib";
import PropostaParaEnviar from "./PropostaParaEnviar";
import { STATUS_PROPOSTA, TOM_PROPOSTA, listarPropostas, propostaVazia, salvarProposta, type PropostaResumo } from "./lib";

export default function PropostasDaSolicitacao({ s, podeMontar, onAbrirEditor, onMudou }: {
  s: Solicitacao;
  podeMontar: boolean;
  /** Só nas áreas com a tela de Propostas (quem monta edita lá). */
  onAbrirEditor?: (id: string) => void;
  onMudou?: () => void;
}) {
  const { currentUser } = useQsAuth();
  const meusSetores = setoresDe(currentUser);
  const [lista, setLista] = useState<PropostaResumo[] | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [vendo, setVendo] = useState<string | null>(null);

  const carregar = useCallback(() => { listarPropostas({ solicitacaoId: s.id }).then(setLista).catch(() => setLista([])); }, [s.id]);
  useEffect(() => { carregar(); }, [carregar]);

  async function montar() {
    if (!onAbrirEditor) return;
    setCriando(true); setErro(null);
    try {
      const id = await salvarProposta({
        ...propostaVazia(s.para_setor),
        solicitacao_id: s.id, cliente_id: s.cliente_id, viagem_id: s.viagem_id, lead_id: s.lead_id,
        cliente_nome: (s.sobre_nome ?? "").split(" · ")[0] || "",
      });
      onAbrirEditor(id);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não criou."); setCriando(false); }
  }

  const monto = (x: PropostaResumo) => meusSetores.includes(x.setor) || x.criado_por === currentUser?.id;
  function abrir(x: PropostaResumo) {
    if (monto(x) && onAbrirEditor) onAbrirEditor(x.id);
    else setVendo(x.id);
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
      {lista.map((x) => {
        const euEnvio = x.de_outro_time && !monto(x);
        const chamar = euEnvio && x.status === "pronta";
        return (
          <button key={x.id} type="button" onClick={() => abrir(x)} className="rel-linha w-full text-left rounded-lg px-2 py-1.5 flex items-center gap-2 text-[13px]"
            style={chamar ? { background: "var(--rel-soft)" } : undefined}>
            <span className="flex-1 min-w-0">
              <span className="block truncate" style={{ color: "var(--ink)" }}>
                Nº {x.numero}{x.titulo || x.destino ? ` · ${x.titulo || x.destino}` : ""}{x.status === "enviada" && x.vista_em ? " · 👀 cliente abriu" : ""}
              </span>
              {chamar && <span className="block text-[12px] font-semibold" style={{ color: "var(--rel-ink)" }}>Abra pra conferir e enviar ao cliente →</span>}
              {euEnvio && x.status === "rascunho" && <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>sendo montada</span>}
            </span>
            <Etiqueta tom={TOM_PROPOSTA[x.status]}>{STATUS_PROPOSTA[x.status]}</Etiqueta>
          </button>
        );
      })}
      {vendo && <PropostaParaEnviar id={vendo} onFechar={() => { setVendo(null); carregar(); }} onMudou={() => { carregar(); onMudou?.(); }} />}
    </div>
  );
}
