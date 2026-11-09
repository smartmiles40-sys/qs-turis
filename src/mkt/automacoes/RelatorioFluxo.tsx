// src/mkt/automacoes/RelatorioFluxo.tsx
// O RELATÓRIO de um fluxo (WhatsApp ou Instagram): quantos começaram e
// terminaram, o caminho passo a passo, cliques por botão, onde as pessoas param
// e as conversões (tag/campo/lista). Os números vêm contados do banco
// (mkt_auto_relatorio, 0343); a montagem é pura (relatorio.ts).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Grafo } from "./tipos";
import { relatorioDoFluxo } from "./api";
import { desdeDias, montarRelatorio, type DadosRelatorio } from "./relatorio";
import { Aviso, Carregando, COR, COR_SUAVE, COR_TEXTO, Modal } from "./ui";

const PERIODOS: { id: string; rotulo: string; dias: number | null }[] = [
  { id: "7", rotulo: "7 dias", dias: 7 }, { id: "30", rotulo: "30 dias", dias: 30 }, { id: "90", rotulo: "90 dias", dias: 90 }, { id: "tudo", rotulo: "Tudo", dias: null },
];

export default function RelatorioFluxo({ fluxoId, nome, grafo, onFechar }: { fluxoId: string; nome: string; grafo: Grafo; onFechar: () => void }) {
  const [periodo, setPeriodo] = useState("30");
  const [dados, setDados] = useState<DadosRelatorio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    setDados(null); setErro(null);
    relatorioDoFluxo(fluxoId, desdeDias(PERIODOS.find((p) => p.id === periodo)?.dias ?? null))
      .then((d) => { if (vivo) setDados(d); })
      .catch((e: unknown) => { if (vivo) setErro(e instanceof Error ? e.message : "Não consegui carregar o relatório."); });
    return () => { vivo = false; };
  }, [fluxoId, periodo]);
  const r = useMemo(() => (dados ? montarRelatorio(dados, grafo) : null), [dados, grafo]);

  return (
    <Modal aberto titulo={`Relatório: ${nome}`} onFechar={onFechar} largura={880}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button key={p.id} type="button" aria-pressed={periodo === p.id} onClick={() => setPeriodo(p.id)}
              className="rounded-full border px-3 py-1 text-[12.5px] font-semibold"
              style={periodo === p.id ? { background: COR_SUAVE, color: COR_TEXTO, borderColor: COR } : { borderColor: "var(--line)", color: "var(--ink2)" }}>{p.rotulo}</button>
          ))}
          <span className="ml-auto text-[12px]" style={{ color: "var(--ink3)" }}>Testes não contam.</span>
        </div>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        {!erro && !r && <Carregando />}
        {r && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Numero rotulo="Começaram" valor={r.resumo.iniciados} />
              <Numero rotulo="Concluíram" valor={r.resumo.concluidos} extra={`${r.resumo.taxaConclusao}%`} />
              <Numero rotulo="No meio do caminho" valor={r.resumo.andamento} />
              <Numero rotulo="Saíram ou deram erro" valor={r.resumo.cancelados + r.resumo.erros} />
            </div>
            {r.resumo.iniciados === 0 && <Aviso>Ninguém passou por este fluxo no período.</Aviso>}

            <Bloco titulo="Passo a passo" texto="Quantas pessoas chegaram em cada bloco (a barra compara com quem começou).">
              <ul className="space-y-1.5">
                {r.passos.map((p) => (
                  <li key={p.noId} className="text-[13px]">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate" style={{ color: "var(--ink)" }}>{p.rotulo}</span>
                      <span className="shrink-0 tabular-nums" style={{ color: "var(--ink2)" }}>{p.entrou}{p.erros ? <span style={{ color: "#B91C1C" }}> · {p.erros} erro</span> : null}</span>
                    </div>
                    <Barra pct={p.pct} />
                  </li>
                ))}
              </ul>
            </Bloco>

            {r.botoes.length > 0 && (
              <Bloco titulo="Cliques por botão" texto="Em cada bloco com botões: quem clicou em quê (% de quem viu o bloco).">
                <table className="w-full text-[13px]">
                  <thead><tr className="text-left text-[11.5px] uppercase tracking-wide" style={{ color: "var(--ink3)" }}><th className="py-1 font-semibold">Bloco</th><th className="font-semibold">Botão / saída</th><th className="text-right font-semibold">Cliques</th></tr></thead>
                  <tbody>
                    {r.botoes.map((b) => (
                      <tr key={`${b.noId}:${b.saida}`} className="border-t" style={{ borderColor: "var(--line)", color: b.secundaria ? "var(--ink3)" : "var(--ink)" }}>
                        <td className="max-w-[260px] truncate py-1.5 pr-2">{b.bloco}</td>
                        <td className="pr-2">{b.rotulo}</td>
                        <td className="text-right tabular-nums">{b.cliques} <span style={{ color: "var(--ink3)" }}>({b.pct}%)</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Bloco>
            )}

            <div className="grid gap-5 md:grid-cols-2">
              <Bloco titulo="Onde as pessoas param" texto="Quem não concluiu: em que bloco está e por quê.">
                {r.parados.length ? (
                  <ul className="space-y-1 text-[13px]">
                    {r.parados.map((p, i) => (
                      <li key={i} className="flex gap-2"><span className="min-w-0 flex-1" style={{ color: "var(--ink)" }}>{p.bloco}<span className="block text-[12px]" style={{ color: "var(--ink3)" }}>{p.estado}</span></span><b className="tabular-nums" style={{ color: "var(--ink)" }}>{p.total}</b></li>
                    ))}
                  </ul>
                ) : <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Ninguém parado.</p>}
              </Bloco>
              <Bloco titulo="Conversões" texto="Tag, campo ou lista que o fluxo aplicou (pessoas diferentes).">
                {r.conversoes.length ? (
                  <ul className="space-y-1 text-[13px]">
                    {r.conversoes.map((c) => (
                      <li key={c.rotulo} className="flex gap-2"><span className="min-w-0 flex-1" style={{ color: "var(--ink)" }}>{c.rotulo}</span><b className="tabular-nums" style={{ color: "var(--ink)" }}>{c.pessoas}</b><span className="w-14 text-right tabular-nums" style={{ color: "var(--ink3)" }}>{c.pct}%</span></li>
                    ))}
                  </ul>
                ) : <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma ainda. Ponha um bloco Ações com “adicionar tag” (ex.: <i>quer-japao</i>) no ponto que vale como conversão.</p>}
              </Bloco>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Numero({ rotulo, valor, extra }: { rotulo: string; valor: number; extra?: string }) {
  return (
    <div className="mkt-card px-3 py-2.5">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{rotulo}</div>
      <div className="text-[22px] font-bold tabular-nums leading-tight" style={{ color: "var(--ink)" }}>{valor.toLocaleString("pt-BR")}{extra && <span className="ml-1.5 text-[13px] font-semibold" style={{ color: COR_TEXTO }}>{extra}</span>}</div>
    </div>
  );
}

function Barra({ pct }: { pct: number }) {
  return (
    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--card2)" }} role="presentation">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: COR }} />
    </div>
  );
}

function Bloco({ titulo, texto, children }: { titulo: string; texto?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{titulo}</h3>
      {texto && <p className="mb-2 text-[12.5px]" style={{ color: "var(--ink3)" }}>{texto}</p>}
      {children}
    </section>
  );
}
