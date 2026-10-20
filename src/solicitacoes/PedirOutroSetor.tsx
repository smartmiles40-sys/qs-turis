// src/solicitacoes/PedirOutroSetor.tsx
// -----------------------------------------------------------------------------
// O botão "Pedir a outro setor" + os pedidos já feitos sobre o mesmo cliente /
// viagem / lead (0149). Mora na viagem e na ficha (Relacionamento) e no lead
// (Comercial): o pedido já sai ligado, e quem pediu vê o andamento ali mesmo,
// sem ir atrás.
//
// Fora das áreas com casca (Comercial), envolva com <ComCoresDaCentral>.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Botao, Etiqueta } from "@/rel/ui";
import NovaSolicitacao from "./NovaSolicitacao";
import SolicitacaoDetalhe, { type LinksSol } from "./SolicitacaoDetalhe";
import { AGUARDANDO, COR_SETOR, SIGLA, STATUS_CURTO, TOM_SOL, primeiroNome, solicitacoesDe, textoPrazo, type AlvoSol, type Setor, type Solicitacao } from "./lib";

export function BotaoPedirOutroSetor({ deSetor, alvo, onCriada, children, className }: {
  deSetor: Setor; alvo: AlvoSol; onCriada?: () => void; children?: ReactNode; className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Botao className={className} onClick={() => setAberto(true)}>{children ?? "↗ Pedir a outro setor"}</Botao>
      <NovaSolicitacao aberto={aberto} deSetor={deSetor} alvo={alvo} onFechar={() => setAberto(false)}
        onCriada={() => { setAberto(false); onCriada?.(); }} />
    </>
  );
}

/** Pedidos sobre este cliente/viagem/lead: abertos + o último fechado. Some se não houver. */
export function PedidosSobre({ alvo, recarregar = 0, links, titulo = "Pedidos a outros setores" }: {
  alvo: AlvoSol; recarregar?: number; links?: LinksSol; titulo?: string;
}) {
  const [lista, setLista] = useState<Solicitacao[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const chave = `${alvo.clienteId}|${alvo.viagemId}|${alvo.leadId}|${alvo.conversaId}|${recarregar}`;
  const carregar = useCallback(() => { solicitacoesDe(alvo).then(setLista).catch(() => undefined); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chave]);
  useEffect(() => {
    carregar();
    const t = setInterval(() => { if (!document.hidden) carregar(); }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  const abertas = lista.filter((s) => s.aberta || (s.status === "concluida" && !s.confirmado_em));
  const mostrar = abertas.length ? abertas : lista.slice(0, 1);
  if (!mostrar.length) return null;
  return (
    <div className="rel-card p-3 space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{titulo}</p>
      {mostrar.map((s) => {
        const p = textoPrazo(s);
        return (
          <button key={s.id} onClick={() => setAberta(s.id)} className="rel-linha w-full text-left rounded-lg px-2 py-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px]" style={{ color: "var(--ink2)" }}>
            {s.novidade && <span className="w-2 h-2 rounded-full" style={{ background: "var(--rel)" }} aria-label="Tem novidade" />}
            <b style={{ color: "var(--ink)" }}>#{s.numero}</b>
            <span className="font-bold" style={{ color: COR_SETOR[s.para_setor] }}>{SIGLA[s.de_setor]}→{SIGLA[s.para_setor]}</span>
            <span className="truncate max-w-[260px]" style={{ color: "var(--ink)" }}>{s.titulo}</span>
            <Etiqueta tom={TOM_SOL[s.status]}>{s.status === "aguardando" && s.aguardando_quem ? `Aguardando ${AGUARDANDO[s.aguardando_quem]}` : STATUS_CURTO[s.status]}</Etiqueta>
            {s.responsavel_nome && <span>· com {primeiroNome(s.responsavel_nome)}</span>}
            {s.aberta && <span style={{ color: p.tom === "erro" ? "var(--err-ink)" : "var(--ink3)" }}>· {p.texto}</span>}
          </button>
        );
      })}
      <SolicitacaoDetalhe id={aberta} onFechar={() => setAberta(null)} onMudou={carregar} links={links} />
    </div>
  );
}

/**
 * TUDO que foi pedido sobre o cliente (0150 — "controle de todas as funções que
 * eles pedem"): abertas sempre à vista; o histórico fechado abre num clique.
 * Mora na ficha do cliente.
 */
export function HistoricoDeSolicitacoes({ clienteId, recarregar = 0, links }: { clienteId: string; recarregar?: number; links?: LinksSol }) {
  const [lista, setLista] = useState<Solicitacao[] | null>(null);
  const [verTudo, setVerTudo] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const carregar = useCallback(() => { solicitacoesDe({ clienteId }, 300).then(setLista).catch(() => setLista([])); }, [clienteId]);
  useEffect(() => { carregar(); }, [carregar, recarregar]);
  if (!lista || lista.length === 0) return null;

  const abertas = lista.filter((s) => s.aberta || (s.status === "concluida" && !s.confirmado_em));
  const fechadas = lista.filter((s) => !abertas.includes(s));
  const porTipo = new Map<string, number>();
  for (const s of lista) porTipo.set(s.tipo_rotulo ?? "Outro", (porTipo.get(s.tipo_rotulo ?? "Outro") ?? 0) + 1);

  const Linha = ({ s }: { s: Solicitacao }) => {
    const p = textoPrazo(s);
    const venda = s.viagem_id ? (s.sobre_nome ?? "").split(" · ").slice(1).join(" · ") : "";
    return (
      <li>
        <button onClick={() => setAberta(s.id)} className="rel-linha w-full text-left rounded-lg px-2 py-2 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2.5 items-start text-[12.5px]">
          <span className="font-bold tabular-nums pt-px" style={{ color: "var(--ink3)" }}>#{s.numero}</span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-1.5">
              {s.novidade && <span className="w-2 h-2 rounded-full" style={{ background: "var(--rel)" }} aria-label="Tem novidade" />}
              <span className="font-bold" style={{ color: COR_SETOR[s.para_setor] }}>{SIGLA[s.de_setor]}→{SIGLA[s.para_setor]}</span>
              <span style={{ color: "var(--ink3)" }}>{s.tipo_rotulo}</span>
              {venda && <span style={{ color: "var(--ink3)" }}>· {venda}</span>}
            </span>
            <span className="block font-semibold truncate" style={{ color: "var(--ink)" }}>{s.titulo}</span>
            {!s.aberta && s.resolucao && <span className="block truncate" style={{ color: "var(--ink3)" }}>{s.status === "recusada" ? "Recusada: " : "Feito: "}{s.resolucao}</span>}
          </span>
          <span className="flex flex-col items-end gap-0.5 whitespace-nowrap">
            <Etiqueta tom={TOM_SOL[s.status]}>{s.status === "aguardando" && s.aguardando_quem ? `Aguardando ${AGUARDANDO[s.aguardando_quem]}` : STATUS_CURTO[s.status]}</Etiqueta>
            <span className="text-[11px]" style={{ color: s.aberta && p.tom === "erro" ? "var(--err-ink)" : "var(--ink3)" }}>
              {s.aberta ? p.texto : new Date(s.concluido_em ?? s.criado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <section className="rel-card p-3 sm:p-4 space-y-2" aria-label="Solicitações do cliente">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>Solicitações <span style={{ color: "var(--ink3)" }}>{lista.length}</span></h2>
        <span className="text-[12px]" style={{ color: "var(--ink3)" }}>
          {abertas.length ? `${abertas.length} em aberto · ` : ""}{[...porTipo.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${t.toLowerCase()}`).join(" · ")}
        </span>
      </div>
      {abertas.length > 0 && <ul className="space-y-0.5">{abertas.map((s) => <Linha key={s.id} s={s} />)}</ul>}
      {fechadas.length > 0 && (
        verTudo
          ? <ul className="space-y-0.5 border-t pt-2" style={{ borderColor: "var(--line)" }}>{fechadas.map((s) => <Linha key={s.id} s={s} />)}</ul>
          : <button className="text-[12.5px] underline" style={{ color: "var(--ink3)" }} onClick={() => setVerTudo(true)}>ver histórico ({fechadas.length} fechada{fechadas.length > 1 ? "s" : ""})</button>
      )}
      <SolicitacaoDetalhe id={aberta} onFechar={() => setAberta(null)} onMudou={carregar} links={links} />
    </section>
  );
}

// Fora das áreas (Comercial): as cores e classes da central presas a este pedaço
// da tela, no azul do Comercial — sem mexer no :root do app.
const CORES_CENTRAL = `
.cores-central { --rel: #0147FF; --rel-hover: #0038CC; --rel-ink: #0038CC; --rel-soft: #E6EDFF; }
html.dark .cores-central { --rel-ink: #8FB0FF; --rel-soft: rgba(1, 71, 255, .16); }
.cores-central .rel-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
.cores-central .rel-linha:hover { background: var(--card2); }
.cores-central .rel-input { width: 100%; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font-size: 14px; }
.cores-central .rel-input:focus { outline: none; border-color: var(--rel); box-shadow: 0 0 0 3px rgba(1, 71, 255, .22); }
`;

export function ComCoresDaCentral({ children }: { children: ReactNode }) {
  return (
    <div className="cores-central contents">
      <style>{CORES_CENTRAL}</style>
      {children}
    </div>
  );
}
