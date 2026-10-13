// src/rel/kpis/KpisPage.tsx
// -----------------------------------------------------------------------------
// KPIs do Relacionamento — tudo que mede o time num lugar só (pedido do Bruno,
// 13/10/2026: "Prazo de resposta pode sair do atendimento, vamos fazer uma aba
// só pra medir KPIs").
//
//   Prazo de resposta → a tela que já existia (PrazoPage), sem mudar nada
//   Chamados          → abertos, vencidos, tempo de resolução, por assunto
//   Pesquisa (NPS)    → nota de quem voltou de viagem
//   Carteira          → os 4 blocos da aba Clientes
//   Receita & expansão→ MRR estimado, a embarcar, recompra/complemento (13/10)
//   Atendimento       → TME e TMA do WhatsApp (13/10, função 0120)
//   NPS ganhou o bloco de avaliações do Google (13/10)
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import PrazoPage from "../atendimento/PrazoPage";
import KpisClientes from "../clientes/KpisClientes";
import {
  METAS_PADRAO, REGRAS_PADRAO, carregarMetricas, carregarRegras, type Metrica, type MetasContato, type RegrasCategorias,
} from "../lib/clientes";
import { PRIORIDADES, STATUS_CHAMADO, calcularNps, listarPesquisas, type Pesquisa, type Prioridade, type StatusChamado } from "../lib/pos";
import { Aviso, Vazio } from "../ui";
import KpisReceita from "./KpisReceita";
import KpisAtendimento from "./KpisAtendimento";
import KpisGoogle from "./KpisGoogle";

type Aba = "receita" | "atendimento" | "prazo" | "chamados" | "nps" | "carteira";
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "receita", rotulo: "Receita & expansão" },
  { id: "atendimento", rotulo: "Atendimento (TME/TMA)" },
  { id: "prazo", rotulo: "Prazo de resposta" },
  { id: "chamados", rotulo: "Chamados" },
  { id: "nps", rotulo: "NPS & Google" },
  { id: "carteira", rotulo: "Carteira" },
];
const PERIODOS = [{ d: 30, r: "30 dias" }, { d: 90, r: "90 dias" }, { d: 365, r: "12 meses" }];

function Numero({ rotulo, valor, dica, tom }: { rotulo: string; valor: string; dica?: string; tom?: "bom" | "ruim" }) {
  const cor = tom === "bom" ? "var(--rel-ink)" : tom === "ruim" ? "var(--err-ink)" : "var(--ink)";
  return (
    <div className="rel-card p-4">
      <span className="block text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>{rotulo}</span>
      <span className="block text-3xl font-bold mt-1 tabular-nums" style={{ color: cor }}>
        {valor}{tom && <span className="sr-only">{tom === "bom" ? " — bom" : " — precisa de atenção"}</span>}
      </span>
      {dica && <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink3)" }}>{dica}</span>}
    </div>
  );
}

function Periodo({ dias, onMudar }: { dias: number; onMudar: (d: number) => void }) {
  return (
    <div className="inline-flex rounded-lg p-0.5" style={{ background: "var(--card2)", border: "1px solid var(--line)" }} role="group" aria-label="Período">
      {PERIODOS.map((p) => (
        <button key={p.d} onClick={() => onMudar(p.d)} aria-pressed={dias === p.d} className="px-3 py-1.5 rounded-md text-[12.5px] font-semibold"
          style={dias === p.d ? { background: "var(--card)", color: "var(--ink)", boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { color: "var(--ink2)" }}>
          {p.r}
        </button>
      ))}
    </div>
  );
}

function Tabela({ titulo, linhas }: { titulo: string; linhas: { k: string; rotulo: string; cols: ReactNode[] }[] }) {
  return (
    <section className="rel-card p-4">
      <h2 className="text-[12px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ink2)" }}>{titulo}</h2>
      {linhas.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Sem dados no período.</p> : (
        <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-[13px] min-w-[420px]">
          <thead>
            <tr style={{ color: "var(--ink2)" }} className="text-[11px] text-left">
              <th className="font-semibold py-1"><span className="sr-only">{titulo}</span></th><th className="font-semibold text-right">Abertos</th>
              <th className="font-semibold text-right">Resolvidos</th><th className="font-semibold text-right">No prazo</th>
              <th className="font-semibold text-right">Tempo médio</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.k} style={{ borderTop: "1px solid var(--line2)", color: "var(--ink)" }}>
                <td className="py-1.5">{l.rotulo}</td>
                {l.cols.map((c, i) => <td key={i} className="text-right tabular-nums">{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}

// ── Chamados ────────────────────────────────────────────────────────────────
interface LinhaChamado {
  id: string; status: StatusChamado; prioridade: Prioridade; categoria: string | null;
  prazo: string | null; criado_em: string; resolvido_em: string | null; responsavel_id: string | null;
}

const horas = (h: number | null) => (h == null ? "—" : h < 24 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1).replace(".", ",")}d`);

function KpisChamados() {
  const [dias, setDias] = useState(90);
  const [linhas, setLinhas] = useState<LinhaChamado[] | null>(null);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // Trocar o período rápido: a resposta do período anterior é descartada.
    let atual = true;
    setLinhas(null);
    setErro(null);
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
    (async () => {
      const todas: LinhaChamado[] = [];
      for (let de = 0; ; de += 1000) {
        // abertos de qualquer data + tudo que nasceu no período
        const { data, error } = await supabase.from("rel_chamados")
          .select("id, status, prioridade, categoria, prazo, criado_em, resolvido_em, responsavel_id")
          .or(`status.neq.resolvido,criado_em.gte.${desde}`).order("id").range(de, de + 999);
        if (error) throw error;
        todas.push(...((data ?? []) as LinhaChamado[]));
        if (!data || data.length < 1000) break;
      }
      if (atual) setLinhas(todas);
    })().catch((e) => { if (atual) { setErro(e instanceof Error ? e.message : "Falhou."); setLinhas([]); } });
    return () => { atual = false; };
  }, [dias]);

  useEffect(() => {
    supabase.from("qs_users").select("id, name").then(({ data }) =>
      setNomes(Object.fromEntries((data ?? []).map((u: { id: string; name: string }) => [u.id, u.name]))));
  }, []);

  const r = useMemo(() => {
    const l = linhas ?? [];
    const agora = Date.now();
    const abertos = l.filter((x) => x.status !== "resolvido");
    const vencidos = abertos.filter((x) => x.prazo && new Date(x.prazo).getTime() < agora);
    const resolvidos = l.filter((x) => x.status === "resolvido" && x.resolvido_em);
    const dur = (x: LinhaChamado) => (new Date(x.resolvido_em!).getTime() - new Date(x.criado_em).getTime()) / 3_600_000;
    const noPrazo = (x: LinhaChamado) => !x.prazo || new Date(x.resolvido_em!).getTime() <= new Date(x.prazo).getTime();
    const media = (v: LinhaChamado[]) => (v.length ? v.reduce((s, x) => s + dur(x), 0) / v.length : null);
    const agrupar = (chave: (x: LinhaChamado) => string, rotulo: (k: string) => string) => {
      const m = new Map<string, LinhaChamado[]>();
      l.forEach((x) => m.set(chave(x), [...(m.get(chave(x)) ?? []), x]));
      return [...m.entries()].map(([k, v]) => {
        const res = v.filter((x) => x.status === "resolvido" && x.resolvido_em);
        return {
          k, rotulo: rotulo(k), total: v.length,
          cols: [
            v.filter((x) => x.status !== "resolvido").length,
            res.length,
            res.length ? `${Math.round((res.filter(noPrazo).length / res.length) * 100)}%` : "—",
            horas(media(res)),
          ],
        };
      }).sort((a, b) => b.total - a.total);
    };
    return {
      abertos: abertos.length,
      vencidos: vencidos.length,
      porStatus: (Object.keys(STATUS_CHAMADO) as StatusChamado[]).map((s) => ({ s, n: l.filter((x) => x.status === s).length })),
      resolvidos: resolvidos.length,
      pctNoPrazo: resolvidos.length ? Math.round((resolvidos.filter(noPrazo).length / resolvidos.length) * 100) : null,
      tempoMedio: media(resolvidos),
      porCategoria: agrupar((x) => x.categoria?.trim() || "Sem assunto definido", (k) => k),
      porPrioridade: agrupar((x) => x.prioridade, (k) => PRIORIDADES[k as Prioridade]?.rotulo ?? k),
      porPessoa: agrupar((x) => x.responsavel_id ?? "", (k) => (k ? nomes[k] ?? "—" : "Sem responsável")),
    };
  }, [linhas, nomes]);

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!linhas) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Periodo dias={dias} onMudar={setDias} /></div>
      {linhas.length === 0 ? (
        <div className="rel-card"><Vazio titulo="Nenhum chamado ainda" texto="Os chamados abertos na conversa ou na ficha aparecem aqui." /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Numero rotulo="Abertos agora" valor={String(r.abertos)} dica={r.porStatus.filter((x) => x.s !== "resolvido").map((x) => `${x.n} ${STATUS_CHAMADO[x.s].toLowerCase()}`).join(" · ")} />
            <Numero rotulo="Vencidos" valor={String(r.vencidos)} dica="abertos com o prazo estourado" tom={r.vencidos ? "ruim" : "bom"} />
            <Numero rotulo="Resolvidos no prazo" valor={r.pctNoPrazo == null ? "—" : `${r.pctNoPrazo}%`} dica={`${r.resolvidos} resolvidos no período`}
              tom={r.pctNoPrazo == null ? undefined : r.pctNoPrazo >= 80 ? "bom" : "ruim"} />
            <Numero rotulo="Tempo médio de resolução" valor={horas(r.tempoMedio)} dica="da abertura até resolver" />
          </div>
          <Tabela titulo="Por assunto" linhas={r.porCategoria} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Tabela titulo="Por prioridade" linhas={r.porPrioridade} />
            <Tabela titulo="Por responsável" linhas={r.porPessoa} />
          </div>
        </>
      )}
    </div>
  );
}

// ── NPS ─────────────────────────────────────────────────────────────────────
function KpisNps() {
  const [dias, setDias] = useState(90);
  const [lista, setLista] = useState<Pesquisa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let atual = true;
    setLista(null);
    setErro(null);
    listarPesquisas(dias).then((l) => { if (atual) setLista(l); })
      .catch((e) => { if (atual) { setErro(e instanceof Error ? e.message : "Falhou."); setLista([]); } });
    return () => { atual = false; };
  }, [dias]);

  const r = useMemo(() => {
    const l = lista ?? [];
    const notas = l.filter((p) => p.nota != null).map((p) => p.nota!);
    const destinos = new Map<string, number>();
    l.forEach((p) => { const d = p.proximo_destino?.trim(); if (d) destinos.set(d, (destinos.get(d) ?? 0) + 1); });
    return { ...calcularNps(notas), enviadas: l.length, destinos: [...destinos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8) };
  }, [lista]);

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!lista) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  return (
    <div className="space-y-4">
      <KpisGoogle />
      <div className="flex justify-end"><Periodo dias={dias} onMudar={setDias} /></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Numero rotulo="NPS" valor={r.nps == null ? "—" : String(r.nps)} dica="% promotores − % detratores" tom={r.nps == null ? undefined : r.nps >= 50 ? "bom" : r.nps < 0 ? "ruim" : undefined} />
        <Numero rotulo="Nota média" valor={r.media == null ? "—" : String(r.media).replace(".", ",")} dica="de 0 a 10" />
        <Numero rotulo="Taxa de resposta" valor={r.enviadas ? `${Math.round((r.n / r.enviadas) * 100)}%` : "—"} dica={`${r.n} de ${r.enviadas} responderam`} />
        <Numero rotulo="Promotores / Detratores" valor={`${r.prom} / ${r.det}`} dica={`${r.neut} neutros`} />
      </div>
      <section className="rel-card p-4">
        <h2 className="text-[12px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ink2)" }}>Para onde querem ir depois</h2>
        {r.destinos.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Ninguém respondeu ainda.</p> : (
          <ul className="flex flex-wrap gap-1.5">
            {r.destinos.map(([d, n]) => (
              <li key={d} className="px-2.5 py-1 rounded-full text-[12px]" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>{d} · <b>{n}</b></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Carteira ────────────────────────────────────────────────────────────────
function KpisCarteira() {
  const [metricas, setMetricas] = useState<Metrica[] | null>(null);
  const [regras, setRegras] = useState<RegrasCategorias>(REGRAS_PADRAO);
  const [metas, setMetas] = useState<MetasContato>(METAS_PADRAO);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    carregarMetricas().then(setMetricas).catch((e) => { setErro(e instanceof Error ? e.message : "Falhou."); setMetricas([]); });
    carregarRegras().then((r) => { setRegras(r.regras); setMetas(r.metas); })
      .catch((e) => setErro((x) => x ?? (e instanceof Error ? e.message : "Falhou.")));
  }, []);
  if (erro) return <Aviso tom="erro">Os indicadores da carteira não carregaram ({erro}).</Aviso>;
  if (!metricas) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  return (
    <>
      <KpisClientes metricas={metricas} regras={regras} metas={metas} filtro={null} onFiltro={() => undefined} />
      <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Para abrir a lista de cada grupo, use a aba Clientes — lá os blocos filtram a lista.</p>
    </>
  );
}

export default function KpisPage() {
  const [aba, setAba] = useState<Aba>("receita");
  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>KPIs</h1>
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Como o Relacionamento está indo — receita, atendimento, prazo, chamados, satisfação e carteira.</p>
      </div>
      <div className="flex gap-1 mb-4 border-b overflow-x-auto" style={{ borderColor: "var(--line)" }} role="tablist" aria-label="KPIs">
        {ABAS.map((a) => (
          <button key={a.id} onClick={() => setAba(a.id)} role="tab" aria-selected={aba === a.id} className="px-3 py-2.5 text-[13px] font-semibold whitespace-nowrap -mb-px"
            style={aba === a.id ? { color: "var(--rel-ink)", borderBottom: "2px solid var(--rel)" } : { color: "var(--ink2)", borderBottom: "2px solid transparent" }}>
            {a.rotulo}
          </button>
        ))}
      </div>
      {aba === "receita" && <KpisReceita />}
      {aba === "atendimento" && <KpisAtendimento />}
      {aba === "prazo" && <PrazoPage />}
      {aba === "chamados" && <KpisChamados />}
      {aba === "nps" && <KpisNps />}
      {aba === "carteira" && <KpisCarteira />}
    </div>
  );
}
