// src/rel/atendimento/PrazoPage.tsx
// -----------------------------------------------------------------------------
// PRAZO DE RESPOSTA (SLA). Cada vez que alguém responde um cliente que estava
// esperando, o banco guarda quanto tempo ÚTIL ele esperou (rel_wa_sla). Aqui:
// quantas respostas saíram dentro do prazo, o tempo típico (mediana) e o
// retrato por atendente. "Pelo celular" = respondida no aparelho (Coexistência).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { carregarSla, contarEsperando, duracao, type LinhaSla } from "../lib/whatsapp";
import { Aviso, Vazio } from "../ui";

const PERIODOS = [{ d: 7, r: "7 dias" }, { d: 30, r: "30 dias" }, { d: 90, r: "90 dias" }];

function mediana(v: number[]) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function Numero({ rotulo, valor, dica, tom }: { rotulo: string; valor: string; dica: string; tom?: "bom" | "ruim" }) {
  const cor = tom === "bom" ? "var(--rel-ink)" : tom === "ruim" ? "var(--err-ink)" : "var(--ink)";
  return (
    <div className="rel-card p-4">
      <span className="block text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>{rotulo}</span>
      <span className="block text-3xl font-bold mt-1 tabular-nums" style={{ color: cor }}>{valor}</span>
      <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink3)" }}>{dica}</span>
    </div>
  );
}

export default function PrazoPage() {
  const [dias, setDias] = useState(7);
  const [linhas, setLinhas] = useState<LinhaSla[] | null>(null);
  const [agora, setAgora] = useState<{ esperando: number; foraDoPrazo: number } | null>(null);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLinhas(null);
    carregarSla(dias).then(setLinhas).catch((e) => { setErro(e instanceof Error ? e.message : "Falhou."); setLinhas([]); });
  }, [dias]);
  useEffect(() => {
    contarEsperando().then(setAgora).catch(() => undefined);
    supabase.from("qs_users").select("id, name").then(({ data }) =>
      setNomes(Object.fromEntries((data ?? []).map((u: { id: string; name: string }) => [u.id, u.name]))));
  }, []);

  const resumo = useMemo(() => {
    const l = linhas ?? [];
    const dentro = l.filter((x) => x.dentro_do_prazo).length;
    const porPessoa = new Map<string, LinhaSla[]>();
    for (const x of l) {
      const k = x.atendente_id ?? "";
      porPessoa.set(k, [...(porPessoa.get(k) ?? []), x]);
    }
    return {
      total: l.length,
      pct: l.length ? Math.round((dentro / l.length) * 100) : null,
      mediana: mediana(l.map((x) => x.minutos_uteis)),
      meta: l[0]?.meta_min ?? null,
      pessoas: [...porPessoa.entries()]
        .map(([id, xs]) => ({
          id,
          total: xs.length,
          pct: Math.round((xs.filter((x) => x.dentro_do_prazo).length / xs.length) * 100),
          mediana: mediana(xs.map((x) => x.minutos_uteis)),
          pior: Math.max(...xs.map((x) => x.minutos_uteis)),
        }))
        .sort((a, b) => b.total - a.total),
    };
  }, [linhas]);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Prazo de resposta</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Tempo que o cliente esperou, contado só no horário de atendimento.</p>
        </div>
        <div className="flex gap-1 rel-card p-1">
          {PERIODOS.map((p) => (
            <button key={p.d} onClick={() => setDias(p.d)} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold"
              style={dias === p.d ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink3)" }}>
              {p.r}
            </button>
          ))}
        </div>
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Numero rotulo="Dentro do prazo" valor={resumo.pct === null ? "–" : `${resumo.pct}%`} dica={`${resumo.total} respostas no período`}
          tom={resumo.pct === null ? undefined : resumo.pct >= 90 ? "bom" : resumo.pct < 70 ? "ruim" : undefined} />
        <Numero rotulo="Tempo típico" valor={resumo.total ? duracao(resumo.mediana) : "–"} dica={resumo.meta ? `prazo: ${duracao(resumo.meta)}` : "mediana das esperas"} />
        <Numero rotulo="Esperando agora" valor={agora ? String(agora.esperando) : "–"} dica="clientes sem resposta" />
        <Numero rotulo="Fora do prazo agora" valor={agora ? String(agora.foraDoPrazo) : "–"} dica="já passaram do prazo" tom={agora?.foraDoPrazo ? "ruim" : undefined} />
      </div>

      <section className="rel-card overflow-hidden">
        <h2 className="px-4 pt-4 pb-2 text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>Por atendente</h2>
        {linhas === null ? (
          <p className="px-4 pb-4 text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        ) : resumo.pessoas.length === 0 ? (
          <Vazio titulo="Sem respostas no período" texto="Quando o time responder clientes pelo WhatsApp do Relacionamento, o retrato aparece aqui." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ color: "var(--ink3)" }}>
                  <th className="text-left font-semibold px-4 py-2">Quem</th>
                  <th className="text-right font-semibold px-4 py-2">Respostas</th>
                  <th className="text-right font-semibold px-4 py-2">No prazo</th>
                  <th className="text-right font-semibold px-4 py-2">Típico</th>
                  <th className="text-right font-semibold px-4 py-2">Pior espera</th>
                </tr>
              </thead>
              <tbody>
                {resumo.pessoas.map((p) => (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--line2)", color: "var(--ink)" }}>
                    <td className="px-4 py-2.5 font-semibold">{p.id ? nomes[p.id] || "—" : "Pelo celular / sem atendente"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{p.total}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: p.pct >= 90 ? "var(--rel-ink)" : p.pct < 70 ? "var(--err-ink)" : undefined }}>{p.pct}%</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{duracao(p.mediana)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{duracao(p.pior)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
