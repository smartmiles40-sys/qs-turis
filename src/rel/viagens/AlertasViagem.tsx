// src/rel/viagens/AlertasViagem.tsx
// -----------------------------------------------------------------------------
// O QUE PODE DAR ERRADO NESTA VIAGEM (15/10/2026) — o resultado do conferente
// (lib/problemas.ts) em destaque no topo do card. Vermelho = urgente, laranja =
// conferir, azul = atenção. Clicar num alerta leva até o trecho na linha do
// tempo e pisca ele.
// -----------------------------------------------------------------------------
import { useState } from "react";
import { CATEGORIA, NIVEL, contar, diaBR, type Categoria, type Nivel, type Problema } from "../lib/problemas";

/** Leva até o trecho na linha do tempo (a página troca pra aba "Dia a dia" se precisar) e pisca. */
export function irParaTrecho(id: string) {
  window.dispatchEvent(new CustomEvent("rel-ir-trecho", { detail: id }));
  setTimeout(() => piscar(id), 80);
}
function piscar(id: string) {
  const el = document.getElementById(`trecho-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("rel-pisca");
  void el.offsetWidth; // reinicia a animação
  el.classList.add("rel-pisca");
}

export const CSS_PISCA = `
@keyframes rel-pisca { 0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0) } 30% { box-shadow: 0 0 0 4px rgba(220,38,38,.45) } }
.rel-pisca { animation: rel-pisca 1.2s cubic-bezier(.25,1,.5,1) 2; border-radius: 12px; }
@media (prefers-reduced-motion: reduce) { .rel-pisca { animation: none; outline: 3px solid #DC2626; } }
`;

export function SeloNivel({ nivel, n }: { nivel: Nivel; n: number }) {
  if (!n) return null;
  const x = NIVEL[nivel];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px] font-bold tabular-nums" style={{ background: x.fundo, color: x.cor }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: x.cor }} aria-hidden />{n} {x.rotulo.toLowerCase()}
    </span>
  );
}

export default function AlertasViagem({ problemas, carregando }: { problemas: Problema[] | null; carregando?: boolean }) {
  const [verInfo, setVerInfo] = useState(false);
  if (problemas === null) return <div className="rel-card h-20 animate-pulse" style={{ background: "var(--card2)" }} aria-busy={carregando} />;
  const c = contar(problemas);
  const visiveis = problemas.filter((p) => p.nivel !== "info" || verInfo);
  const porCat = new Map<Categoria, Problema[]>();
  for (const p of visiveis) porCat.set(p.categoria, [...(porCat.get(p.categoria) ?? []), p]);

  if (!problemas.length) {
    return (
      <div className="rel-card px-4 py-3 flex items-center gap-3" style={{ borderColor: "var(--rel)", background: "var(--rel-soft)" }}>
        <span className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold" style={{ background: "var(--rel)" }} aria-hidden>✓</span>
        <div>
          <p className="text-[14px] font-bold" style={{ color: "var(--rel-ink)" }}>Nenhum risco encontrado</p>
          <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>Voos, conexões, hotéis, transfers, passeios e documentos conferidos com o que está cadastrado.</p>
        </div>
      </div>
    );
  }

  return (
    <section className="rel-card p-4" style={c.alta ? { borderColor: NIVEL.alta.cor, borderWidth: 2 } : undefined} aria-label="O que pode dar errado nesta viagem">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-[14px] font-extrabold uppercase tracking-wide mr-1" style={{ color: c.alta ? NIVEL.alta.cor : "var(--ink)" }}>
          {c.alta ? "⚠ O que pode dar errado" : "Pontos pra conferir"}
        </h2>
        <SeloNivel nivel="alta" n={c.alta} />
        <SeloNivel nivel="media" n={c.media} />
        {c.info > 0 && (
          <button onClick={() => setVerInfo((v) => !v)} className="text-[11.5px] font-semibold underline" style={{ color: NIVEL.info.cor }} aria-pressed={verInfo}>
            {verInfo ? "esconder" : "ver"} {c.info} de atenção
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
        {[...porCat.entries()].map(([cat, lista]) => (
          <div key={cat} className="min-w-0">
            <h3 className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--ink3)" }}>{CATEGORIA[cat]}</h3>
            <ul className="space-y-1.5">
              {lista.map((p, i) => {
                const x = NIVEL[p.nivel];
                const clicavel = p.trechos.length > 0;
                return (
                  <li key={i}>
                    <button disabled={!clicavel} onClick={() => clicavel && irParaTrecho(p.trechos[0])}
                      className="w-full text-left rounded-lg px-3 py-2 flex gap-2.5 disabled:cursor-default"
                      style={{ background: x.fundo, borderLeft: `4px solid ${x.cor}` }}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold leading-snug" style={{ color: "var(--ink)" }}>{p.titulo}</span>
                        {p.detalhe && <span className="block text-[12px] mt-0.5" style={{ color: "var(--ink2)" }}>{p.detalhe}</span>}
                      </span>
                      <span className="flex-shrink-0 text-right">
                        <span className="block text-[10px] font-bold uppercase" style={{ color: x.cor }}>{x.rotulo}</span>
                        {p.dia && <span className="block text-[11px] tabular-nums" style={{ color: "var(--ink3)" }}>{diaBR(p.dia)}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
