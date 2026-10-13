// src/rel/kpis/KpisReceita.tsx
// -----------------------------------------------------------------------------
// Receita & expansão (Bruno, 13/10/2026): MRR estimado do Relacionamento,
// receita contratada a embarcar (12 meses) e taxa de expansão (recompra e
// complementos) com projeção dos 3 próximos meses. Gráficos em SVG à mão.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { hojeSP } from "../lib/viagens";
import { carregarViagensKpi, expansao, receitaAEmbarcar, receitaRelacionamento, rotuloMes, type ViagemKpi } from "../lib/kpis";
import { moeda } from "../lib/clientes";
import { Aviso, Vazio } from "../ui";

const COR_EXP = "#0E7C6A";
const COR_PAC = "#C98A1A";
const COR_AVU = "#9AA3AE";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const curto = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(".", ",")} mi` : v >= 1000 ? `${Math.round(v / 1000)} mil` : String(Math.round(v)));

function Cartao({ rotulo, valor, dica }: { rotulo: string; valor: string; dica: string }) {
  return (
    <div className="rel-card p-4">
      <span className="block text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>{rotulo}</span>
      <span className="block text-3xl font-bold mt-1 tabular-nums" style={{ color: "var(--ink)" }}>{valor}</span>
      <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink3)" }}>{dica}</span>
    </div>
  );
}

function Explica({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-relaxed" style={{ color: "var(--ink3)" }}>{children}</p>;
}

/** Barras simples (uma série) — vendas do Relacionamento por mês. */
function Barras({ dados, destaque }: { dados: { k: string; valor: number }[]; destaque: Set<string> }) {
  const max = Math.max(1, ...dados.map((d) => d.valor));
  const W = 640, H = 180, base = 150, larg = W / dados.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Vendas do Relacionamento por mês">
      {dados.map((d, i) => {
        const h = (d.valor / max) * 120;
        const x = i * larg + larg * 0.2;
        return (
          <g key={d.k}>
            <rect x={x} y={base - h} width={larg * 0.6} height={Math.max(h, d.valor ? 2 : 0)} rx={3}
              fill={destaque.has(d.k) ? COR_EXP : "var(--line)"}>
              <title>{`${rotuloMes(d.k)}: ${moeda(d.valor)}`}</title>
            </rect>
            {d.valor > 0 && <text x={x + larg * 0.3} y={base - h - 5} textAnchor="middle" fontSize="10" fill="var(--ink2)">{curto(d.valor)}</text>}
            <text x={x + larg * 0.3} y={base + 16} textAnchor="middle" fontSize="10" fill="var(--ink3)">{rotuloMes(d.k)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Barras empilhadas: expedição (cheia), pacote (listrada), avulsas (cinza). */
function Empilhadas({ dados }: { dados: { k: string; expedicao: number; pacote: number; avulsa: number }[] }) {
  const max = Math.max(1, ...dados.map((d) => d.expedicao + d.pacote + d.avulsa));
  const W = 640, H = 190, base = 155, larg = W / dados.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Receita a embarcar por mês">
      <defs>
        <pattern id="pac-listra" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={COR_PAC} />
          <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,.55)" strokeWidth="2" />
        </pattern>
      </defs>
      {dados.map((d, i) => {
        const x = i * larg + larg * 0.2, w = larg * 0.6;
        const total = d.expedicao + d.pacote + d.avulsa;
        let y = base;
        const peca = (v: number, fill: string, nome: string) => {
          const h = (v / max) * 125;
          y -= h;
          return v > 0 ? <rect key={nome} x={x} y={y} width={w} height={h} fill={fill}><title>{`${rotuloMes(d.k)} · ${nome}: ${moeda(v)}`}</title></rect> : null;
        };
        return (
          <g key={d.k}>
            {peca(d.expedicao, COR_EXP, "Expedições")}
            {peca(d.pacote, "url(#pac-listra)", "Pacotes")}
            {peca(d.avulsa, COR_AVU, "Avulsas")}
            {total > 0 && <text x={x + w / 2} y={y - 5} textAnchor="middle" fontSize="10" fill="var(--ink2)">{curto(total)}</text>}
            <text x={x + w / 2} y={base + 16} textAnchor="middle" fontSize="10" fill="var(--ink3)">{rotuloMes(d.k)}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Duas linhas (recompra e complemento) + projeção tracejada. */
function Linhas({ serie, futuros, proj }: {
  serie: { k: string; upsell: number | null; cross: number | null }[];
  futuros: string[]; proj: { upsell: number | null; cross: number | null };
}) {
  const todos = [...serie.map((s) => s.k), ...futuros];
  const W = 640, H = 190, topo = 15, base = 150, passo = (W - 40) / Math.max(1, todos.length - 1);
  const vals = [...serie.flatMap((s) => [s.upsell ?? 0, s.cross ?? 0]), proj.upsell ?? 0, proj.cross ?? 0];
  const max = Math.max(0.1, ...vals);
  const X = (i: number) => 20 + i * passo;
  const Y = (v: number) => base - (v / max) * (base - topo);
  const caminho = (f: (s: (typeof serie)[number]) => number | null) =>
    serie.map((s, i) => (f(s) == null ? null : `${X(i)},${Y(f(s)!)}`)).filter(Boolean).join(" ");
  const ultimo = serie.length - 1;
  const linhaProj = (v: number | null, ult: number | null) => (v == null || ult == null ? null
    : `${X(ultimo)},${Y(ult)} ${futuros.map((_, i) => `${X(ultimo + 1 + i)},${Y(v)}`).join(" ")}`);
  const series = [
    { nome: "Recompra (upsell)", cor: COR_EXP, f: (s: (typeof serie)[number]) => s.upsell, p: proj.upsell },
    { nome: "Complemento (cross-sell)", cor: COR_PAC, f: (s: (typeof serie)[number]) => s.cross, p: proj.cross },
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Taxa de expansão por mês com projeção">
      <rect x={X(ultimo) + passo / 2} y={topo - 5} width={W - X(ultimo) - passo / 2} height={base - topo + 5} fill="var(--card2)" />
      <text x={W - 6} y={topo + 6} textAnchor="end" fontSize="10" fill="var(--ink3)">projeção</text>
      {series.map((s) => {
        const ult = s.f(serie[ultimo]) ?? s.f(serie[ultimo - 1]) ?? null;
        const lp = linhaProj(s.p, ult);
        return (
          <g key={s.nome}>
            <polyline points={caminho(s.f)} fill="none" stroke={s.cor} strokeWidth="2.5" strokeLinejoin="round" />
            {serie.map((x, i) => s.f(x) == null ? null : (
              <circle key={x.k} cx={X(i)} cy={Y(s.f(x)!)} r="3" fill={s.cor}><title>{`${rotuloMes(x.k)} · ${s.nome}: ${pct(s.f(x))}`}</title></circle>
            ))}
            {lp && <polyline points={lp} fill="none" stroke={s.cor} strokeWidth="2" strokeDasharray="5 4" />}
          </g>
        );
      })}
      {todos.map((k, i) => (i % 2 === 0 || i === todos.length - 1) && (
        <text key={k} x={X(i)} y={base + 16} textAnchor="middle" fontSize="10" fill="var(--ink3)">{rotuloMes(k)}</text>
      ))}
    </svg>
  );
}

export default function KpisReceita() {
  const [vs, setVs] = useState<ViagemKpi[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    carregarViagensKpi().then((v) => { if (vivo) setVs(v); })
      .catch((e) => { if (vivo) { setErro(e instanceof Error ? e.message : "Falhou."); setVs([]); } });
    return () => { vivo = false; };
  }, []);

  const mesAtual = hojeSP().slice(0, 7);
  const r = useMemo(() => (vs ? {
    rec: receitaRelacionamento(vs, mesAtual),
    emb: receitaAEmbarcar(vs, mesAtual),
    exp: expansao(vs, mesAtual),
  } : null), [vs, mesAtual]);

  if (erro) return <Aviso tom="erro">As viagens não carregaram ({erro}).</Aviso>;
  if (!r) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="rel-card h-24 animate-pulse" />)}</div>
        <div className="rel-card h-56 animate-pulse" />
      </div>
    );
  }
  if (!vs?.length) return <div className="rel-card"><Vazio titulo="Sem viagens ainda" texto="Os indicadores de receita aparecem quando houver viagens importadas." /></div>;

  const totalEmb = r.emb.reduce((s, l) => s + l.expedicao + l.pacote + l.avulsa, 0);
  const ultFechado = r.exp.serie[r.exp.serie.length - 2];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Cartao rotulo="MRR estimado (Relacionamento)" valor={moeda(r.rec.mrr)} dica="média mensal das vendas do Comercial 2 nos últimos 6 meses" />
        <Cartao rotulo="A embarcar (12 meses)" valor={moeda(totalEmb)} dica="valor das viagens ativas que ainda vão embarcar" />
        <Cartao rotulo="Recompra (upsell)" valor={pct(r.exp.proj.upsell)} dica={`projeção pros próximos 3 meses · ${rotuloMes(ultFechado.k)}: ${pct(ultFechado.upsell)}`} />
        <Cartao rotulo="Complemento (cross-sell)" valor={pct(r.exp.proj.cross)} dica={`projeção pros próximos 3 meses · ${rotuloMes(ultFechado.k)}: ${pct(ultFechado.cross)}`} />
      </div>

      <section className="rel-card p-4 space-y-2">
        <h2 className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>MRR — receita recorrente estimada</h2>
        <Explica>
          O Relacionamento não vende assinatura, então o "MRR" aqui é uma <b>estimativa</b>: a média mensal do que o funil
          <b> Comercial 2 – Relacionamento</b> vendeu nos 6 meses fechados (em verde). Fórmula: <i>soma das vendas de
          {" "}{rotuloMes(r.rec.fechados[0])} a {rotuloMes(r.rec.fechados[5])} ÷ 6</i>. Conta a data da venda no Bitrix; venda sem data fica fora.
        </Explica>
        <Barras dados={r.rec.meses} destaque={new Set(r.rec.fechados)} />
      </section>

      <section className="rel-card p-4 space-y-2">
        <h2 className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>Receita contratada a embarcar</h2>
        <Explica>Soma do valor das viagens ativas pelo <b>mês de embarque</b>, nos próximos 12 meses — o que já está vendido e ainda vai acontecer. Viagem sem data de embarque não entra.</Explica>
        <div className="flex flex-wrap gap-3 text-[12px]" style={{ color: "var(--ink2)" }}>
          <span className="inline-flex items-center gap-1.5"><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill={COR_EXP} /></svg>Expedições (cheio)</span>
          <span className="inline-flex items-center gap-1.5"><svg width="12" height="12"><rect x="2" y="2" width="8" height="8" transform="rotate(45 6 6)" fill={COR_PAC} /></svg>Pacotes (listrado)</span>
          <span className="inline-flex items-center gap-1.5"><svg width="12" height="12"><rect x="1" y="1" width="10" height="10" rx="2" fill={COR_AVU} /></svg>Compras avulsas</span>
        </div>
        <Empilhadas dados={r.emb} />
      </section>

      <section className="rel-card p-4 space-y-2">
        <h2 className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>Taxa de expansão</h2>
        <Explica>
          <b>Recompra (upsell)</b>: dos clientes que compraram uma expedição ou pacote no mês, quantos % já tinham comprado
          outra viagem antes. <b>Complemento (cross-sell)</b>: das vendas do mês, quantos % foram aéreo, hotel, seguro ou
          outro serviço pra quem tem expedição/pacote embarcando perto (até 120 dias). A <b>projeção</b> (tracejado) é a
          média dos 3 últimos meses fechados.
        </Explica>
        <div className="flex flex-wrap gap-3 text-[12px]" style={{ color: "var(--ink2)" }}>
          <span className="inline-flex items-center gap-1.5"><svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke={COR_EXP} strokeWidth="3" /></svg>Recompra</span>
          <span className="inline-flex items-center gap-1.5"><svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke={COR_PAC} strokeWidth="3" /></svg>Complemento</span>
          <span className="inline-flex items-center gap-1.5"><svg width="18" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="var(--ink3)" strokeWidth="2" strokeDasharray="4 3" /></svg>Projeção</span>
        </div>
        <Linhas serie={r.exp.serie} futuros={r.exp.futuros} proj={r.exp.proj} />
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-[12.5px] min-w-[520px]">
            <thead>
              <tr className="text-[11px] text-left" style={{ color: "var(--ink2)" }}>
                <th className="py-1 font-semibold">Mês</th><th className="text-right font-semibold">Compraram viagem</th>
                <th className="text-right font-semibold">Já eram clientes</th><th className="text-right font-semibold">Recompra</th>
                <th className="text-right font-semibold">Vendas</th><th className="text-right font-semibold">Complementos</th><th className="text-right font-semibold">Cross-sell</th>
              </tr>
            </thead>
            <tbody>
              {r.exp.serie.slice().reverse().map((s) => (
                <tr key={s.k} style={{ borderTop: "1px solid var(--line2)", color: "var(--ink)" }}>
                  <td className="py-1.5">{rotuloMes(s.k)}{s.k === mesAtual ? " (parcial)" : ""}</td>
                  <td className="text-right tabular-nums">{s.compradores}</td>
                  <td className="text-right tabular-nums">{s.recompra}</td>
                  <td className="text-right tabular-nums">{pct(s.upsell)}</td>
                  <td className="text-right tabular-nums">{s.vendas}</td>
                  <td className="text-right tabular-nums">{s.complemento}</td>
                  <td className="text-right tabular-nums">{pct(s.cross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
