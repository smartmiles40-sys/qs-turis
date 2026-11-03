// src/expedicoes/passageiros/MatrizPassageiros.tsx
// -----------------------------------------------------------------------------
// MATRIZ DE PASSAGEIROS (redesign 29/10, spec §3.2 Passageiros). Uma linha por
// passageiro, uma coluna por requisito (Passaporte, Visto, Seguro, Formulário,
// Quarto, Pagamento) com o placar no cabeçalho ("14/16 válidos"). Filtros com
// contagem (Todos / Com pendência / Formulário pendente / Líderes). Clicar no nome
// abre a gaveta do passageiro (tem a aba "Cliente" = ficha única); clicar numa
// célula abre a gaveta de prontidão. A conta é a de lib/cockpit/matriz.ts.
// Só lê: "Cobrar formulário" e "Cobrar apólice" ficam desligados até existir um
// disparo nas Expedições (MAPA-EXPEDICOES §6) — nada de mandar mensagem daqui.
// -----------------------------------------------------------------------------
import { useMemo, useState, type ReactNode } from "react";
import { Btn, FilterPill } from "@/components/ui";
import { ordinalFem } from "../lib/fidelidade";
import {
  COLUNAS_MATRIZ, contagensMatriz, filtrarMatriz, placarDaMatriz, type FiltroMatriz, type LinhaMatriz,
} from "../lib/cockpit/matriz";

const TOM_TAG = { ok: "ok", warn: "warn", danger: "danger", neutral: "" } as const;

const iniciais = (nome: string) => {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
};

export default function MatrizPassageiros({ linhas, posicoes, onAbrir, busca = "", aoLadoDoNome }: {
  linhas: readonly LinhaMatriz[];
  /** Nª expedição da pessoa com a gente (construirPosicoesFidelidade). */
  posicoes: Record<string, number>;
  onAbrir: (paxId: string, modo: "pax" | "prontidao") => void;
  busca?: string;
  /** 03/11: selo da inscrição junto do nome (lib/inscricaoPax.ts). */
  aoLadoDoNome?: (paxId: string) => ReactNode;
}) {
  const [filtro, setFiltro] = useState<FiltroMatriz>("todos");
  const placar = useMemo(() => placarDaMatriz(linhas), [linhas]);
  const n = useMemo(() => contagensMatriz(linhas), [linhas]);
  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return filtrarMatriz(linhas, filtro).filter((l) => !t || `${l.pax.nome} ${l.pax.passaporte ?? ""}`.toLowerCase().includes(t));
  }, [linhas, filtro, busca]);

  const filtros: { id: FiltroMatriz; rotulo: string; qtd: number; tom?: "warn" | "danger" }[] = [
    { id: "todos", rotulo: "Todos", qtd: n.todos },
    { id: "pendencia", rotulo: "Com pendência", qtd: n.pendencia, tom: "warn" },
    { id: "formulario", rotulo: "Formulário pendente", qtd: n.formulario, tom: "warn" },
    { id: "lideres", rotulo: "Líderes", qtd: n.lideres },
  ];
  if (n.seguro) filtros.push({ id: "seguro", rotulo: "Sem seguro", qtd: n.seguro, tom: "warn" });

  return (
    <section className="ck-mx" aria-label="Matriz de passageiros">
      <div className="ck-mx__bar">
        <div className="ck-mx__f" role="group" aria-label="Filtros">
          {filtros.map((f) => (
            <FilterPill key={f.id} active={filtro === f.id} count={f.qtd} countTone={f.tom} onClick={() => setFiltro(f.id)}>{f.rotulo}</FilterPill>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* TODO: não existe disparo de cobrança nas Expedições (MAPA-EXPEDICOES §6). Quando existir, ligar aqui. */}
          <Btn size="sm" disabled title="Ainda não existe disparo de mensagem nas Expedições">Cobrar formulário ({n.formulario})</Btn>
          <Btn size="sm" disabled title="Ainda não existe disparo de mensagem nas Expedições">Cobrar apólice de seguro ({n.seguro})</Btn>
        </div>
      </div>
      <div className="ck-mx__scroll">
        <table>
          <thead>
            <tr>
              <th scope="col"><span><span>Passageiro</span></span></th>
              {COLUNAS_MATRIZ.map((c) => (
                <th key={c.id} scope="col">
                  <span><span>{c.rotulo}</span><span className={`ck-mx__pl ck-mx__pl--${placar[c.id].tom}`}>{placar[c.id].texto}</span></span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 ? (
              <tr><td colSpan={COLUNAS_MATRIZ.length + 1} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>Ninguém neste filtro.</td></tr>
            ) : visiveis.map((l) => {
              const pos = posicoes[l.pax.id];
              return (
                <tr key={l.pax.id}>
                  <td>
                    <button type="button" className="ck-mx__pax" onClick={() => onAbrir(l.pax.id, "pax")}>
                      <span className="ck-mx__av" aria-hidden="true">{iniciais(l.pax.nome)}</span>
                      <span style={{ display: "flex", flexDirection: "column" }}>
                        <span className="ck-mx__n">{l.pax.nome}</span>
                        <span className="ck-mx__s">{l.lider ? "Líder" : l.pax.tipo}{pos ? ` · ${ordinalFem(pos)} expedição` : ""}{l.pax.status_reserva !== "Confirmado" ? ` · ${l.pax.status_reserva}` : ""}</span>
                      </span>
                    </button>
                    {aoLadoDoNome && <div style={{ marginTop: 4, paddingLeft: 40 }}>{aoLadoDoNome(l.pax.id)}</div>}
                  </td>
                  {COLUNAS_MATRIZ.map((c) => {
                    const cel = l.celulas[c.id];
                    const tom = TOM_TAG[cel.tom];
                    return (
                      <td key={c.id}>
                        <button type="button" className="ck-mx__cel" title={cel.dica ?? `Abrir a prontidão de ${l.pax.nome}`}
                          onClick={() => onAbrir(l.pax.id, c.id === "pagamento" || c.id === "quarto" ? "pax" : "prontidao")}>
                          <span className={`ck-tag${tom ? ` ck-tag--${tom}` : ""}`}>{cel.rotulo}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="ck-mx__rod">Mostrando {visiveis.length} de {linhas.length} · cancelados ficam de fora · clique no nome pra abrir o passageiro, numa célula pra ver a prontidão</div>
    </section>
  );
}
