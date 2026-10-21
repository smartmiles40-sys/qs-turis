// src/expedicoes/paginas/Avisos.tsx
// Avisos operacionais (app antigo: app/(app)/avisos/ — AvisosLista.tsx +
// getAlertasOperacionais): cada exigência pendente de passageiro que entrou na
// janela do tipo (lib/alertas/regras.ts) vira um aviso, crítico (bloqueia) ou
// atenção. Filtro Todos/Críticos/Atenção, busca, agrupado por expedição na ordem
// de urgência. Clicar abre o passageiro dentro da expedição. Atualiza sozinho.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Vazio } from "@/rel/ui";
import { useExp } from "../contexto";
import { Busca, Carregando, Selo, useAoVivo } from "../ui";
import { formatDate } from "../lib/utils";
import { calcularAlertas, carregarProntidaoAtivas, type AlertaOperacional } from "./_globais/prontidaoGlobal";

type Filtro = "todos" | "critico" | "atencao";

export default function Avisos() {
  const { ir } = useExp();
  const [alertas, setAlertas] = useState<AlertaOperacional[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    try { setAlertas(calcularAlertas(await carregarProntidaoAtivas({ soFuturas: true }))); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "passageiros" }, { tabela: "passageiro_requisitos" }, { tabela: "expedicoes" }], carregar, 1500);

  const lista = alertas ?? [];
  const criticos = lista.filter((a) => a.severidade === "critico").length;
  const atencoes = lista.length - criticos;

  const grupos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const out: { id: string; nome: string; embarque: string; dias: number; itens: AlertaOperacional[] }[] = [];
    const idx = new Map<string, number>();
    for (const a of alertas ?? []) {
      if (filtro !== "todos" && a.severidade !== filtro) continue;
      if (termo && !`${a.passageiro_nome} ${a.expedicao_nome} ${a.rotulo}`.toLowerCase().includes(termo)) continue;
      let i = idx.get(a.expedicao_id);
      if (i == null) { i = out.length; idx.set(a.expedicao_id, i); out.push({ id: a.expedicao_id, nome: a.expedicao_nome, embarque: a.data_embarque, dias: a.dias_ate_embarque, itens: [] }); }
      out[i].itens.push(a);
    }
    return out;
  }, [alertas, filtro, busca]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[22px] font-bold" style={{ color: "var(--ink)" }}>Avisos</h1>
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
          Pendências de passageiros que entraram no prazo — passaporte, visto, vacina, seguro, aéreo, contrato…
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar avisos">
          {(["todos", "critico", "atencao"] as Filtro[]).map((f) => (
            <button key={f} onClick={() => setFiltro(f)} aria-pressed={filtro === f}
              className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border"
              style={filtro === f ? { background: "var(--ink)", color: "var(--bg)", borderColor: "var(--ink)" } : { background: "var(--card)", color: "var(--ink2)", borderColor: "var(--line)" }}>
              {f === "todos" ? `Todos (${lista.length})` : f === "critico" ? `Críticos (${criticos})` : `Atenção (${atencoes})`}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[220px] max-w-sm ml-auto"><Busca valor={busca} onMudar={setBusca} placeholder="Buscar passageiro/expedição…  [/]" /></div>
      </div>

      {erro && <p className="text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
      {!alertas ? <Carregando texto="Conferindo a prontidão de todas as expedições…" /> : grupos.length === 0 ? (
        lista.length === 0
          ? <div className="rel-card"><Vazio titulo="Tudo dentro do prazo" texto="Nenhum aviso no momento — passaportes, vistos, documentos e prazos das expedições estão em dia. 🎉" /></div>
          : <div className="rel-card py-10 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum aviso para o filtro/busca atual.</div>
      ) : (
        grupos.map((g) => (
          <section key={g.id} className="rel-card overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--line)", background: "var(--card2)" }}>
              <button className="text-[13.5px] font-bold hover:underline text-left" style={{ color: "var(--ink)" }} onClick={() => ir("expedicoes", `${g.id}/passageiros`)}>{g.nome}</button>
              <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>embarque {formatDate(g.embarque)} · faltam {g.dias} dia{g.dias === 1 ? "" : "s"}</span>
              <span className="ml-auto"><Selo tom={g.dias <= 30 ? "erro" : "aviso"}>{g.itens.length} aviso{g.itens.length === 1 ? "" : "s"}</Selo></span>
            </div>
            <ul>
              {g.itens.map((a, i) => (
                <li key={`${a.passageiro_id}-${a.tipo}-${i}`}>
                  <button onClick={() => ir("expedicoes", `${a.expedicao_id}/passageiros/pax/${a.passageiro_id}`)}
                    className="w-full flex items-center gap-3 px-4 py-2 text-left border-b last:border-0 rel-linha" style={{ borderColor: "var(--line)" }}>
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: a.severidade === "critico" ? "#DC2626" : "#EA580C" }} aria-label={a.severidade === "critico" ? "Crítico" : "Atenção"} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{a.passageiro_nome}</span>
                      <span className="block text-[11.5px] truncate" style={{ color: "var(--ink3)" }}>{a.rotulo}{a.detalhe ? ` — ${a.detalhe}` : ""}</span>
                    </span>
                    <Selo tom={a.severidade === "critico" ? "erro" : "aviso"}>{a.tipo}</Selo>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
