// src/rel/viagens/CentralProblemas.tsx
// -----------------------------------------------------------------------------
// CENTRAL DE PROBLEMAS (15/10/2026) — no topo do painel de Viagens: todas as
// viagens em andamento com algum risco do conferente (lib/problemas.ts), as
// URGENTES primeiro e, dentro disso, quem embarca antes. Cada linha mostra o
// pior problema e abre a viagem.
// -----------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { grupoTipo, type Viagem } from "../lib/viagens";
import { NIVEL, contar, type Analise } from "../lib/problemas";
import { MarcaTipo } from "./MapaMundi";
import { SeloNivel } from "./AlertasViagem";

const dataCurta = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "s/ data");

export default function CentralProblemas({ viagens, analises, filtro, onAbrirViagem }: {
  viagens: Viagem[]; analises: Map<string, Analise> | null; filtro: "todos" | "expedicao" | "pacote"; onAbrirViagem: (id: string) => void;
}) {
  const [todas, setTodas] = useState(false);
  const [soUrgentes, setSoUrgentes] = useState(false);

  const linhas = useMemo(() => {
    if (!analises) return [];
    return viagens
      .filter((v) => filtro === "todos" || grupoTipo(v.tipo) === filtro)
      .map((v) => ({ v, ps: (analises.get(v.id)?.problemas ?? []).filter((p) => p.nivel !== "info") }))
      .filter((x) => x.ps.length && (!soUrgentes || x.ps.some((p) => p.nivel === "alta")))
      .map((x) => ({ ...x, c: contar(x.ps) }))
      .sort((a, b) => (b.c.alta ? 1 : 0) - (a.c.alta ? 1 : 0) || (a.v.data_embarque ?? "9999").localeCompare(b.v.data_embarque ?? "9999"));
  }, [viagens, analises, filtro, soUrgentes]);

  if (!analises) return <div className="rel-card h-24 animate-pulse" style={{ background: "var(--card2)" }} aria-busy="true" />;
  const urgentes = linhas.filter((l) => l.c.alta).length;
  const lista = todas ? linhas : linhas.slice(0, 8);

  if (!linhas.length && !soUrgentes) {
    return (
      <div className="rel-card px-4 py-3 flex items-center gap-3" style={{ borderColor: "var(--rel)", background: "var(--rel-soft)" }}>
        <span className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold" style={{ background: "var(--rel)" }} aria-hidden>✓</span>
        <p className="text-[14px] font-bold" style={{ color: "var(--rel-ink)" }}>Nenhuma viagem com risco encontrado agora.</p>
      </div>
    );
  }

  return (
    <section className="rel-card overflow-hidden" style={urgentes ? { borderColor: NIVEL.alta.cor, borderWidth: 2 } : undefined} aria-label="Central de problemas">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ background: urgentes ? NIVEL.alta.fundo : "var(--card2)" }}>
        <h2 className="text-[14px] font-extrabold uppercase tracking-wide" style={{ color: urgentes ? NIVEL.alta.cor : "var(--ink)" }}>
          {urgentes ? `⚠ ${urgentes} viage${urgentes === 1 ? "m" : "ns"} com risco urgente` : "Viagens com pontos pra conferir"}
        </h2>
        <span className="text-[12.5px]" style={{ color: "var(--ink2)" }}>{linhas.length} no total</span>
        <label className="ml-auto flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={soUrgentes} onChange={(e) => setSoUrgentes(e.target.checked)} style={{ accentColor: NIVEL.alta.cor }} /> só urgentes
        </label>
      </div>
      <ul>
        {lista.map(({ v, ps, c }) => {
          const topo = ps[0];
          return (
            <li key={v.id} style={{ borderTop: "1px solid var(--line2)" }}>
              <button onClick={() => onAbrirViagem(v.id)} className="rel-linha w-full text-left px-4 py-2.5 grid grid-cols-[64px_minmax(0,1fr)] sm:grid-cols-[64px_minmax(160px,240px)_minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center">
                <span className="text-[13px] font-extrabold tabular-nums" style={{ color: "var(--ink)" }}>{dataCurta(v.data_embarque)}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[13.5px] font-bold truncate" style={{ color: "var(--ink)" }}>
                    <MarcaTipo tipo={grupoTipo(v.tipo)} tamanho={8} />{v.cliente_nome || v.titulo}
                  </span>
                  <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>{v.destino || v.expedicao || v.titulo}</span>
                </span>
                <span className="col-span-2 sm:col-span-1 text-[12.5px] font-semibold min-w-0 truncate" style={{ color: NIVEL[topo.nivel].cor }}>
                  {topo.nivel === "alta" ? "⚠ " : ""}{topo.titulo}{ps.length > 1 ? <span style={{ color: "var(--ink3)" }}> +{ps.length - 1}</span> : null}
                </span>
                <span className="hidden sm:flex gap-1"><SeloNivel nivel="alta" n={c.alta} /><SeloNivel nivel="media" n={c.media} /></span>
              </button>
            </li>
          );
        })}
      </ul>
      {linhas.length > 8 && (
        <button onClick={() => setTodas((x) => !x)} className="rel-linha w-full py-2.5 text-[12.5px] font-semibold" style={{ color: "var(--rel-ink)", borderTop: "1px solid var(--line2)" }}>
          {todas ? "Mostrar menos" : `Ver todas as ${linhas.length}`}
        </button>
      )}
    </section>
  );
}
