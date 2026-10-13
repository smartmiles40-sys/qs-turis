// src/rel/clientes/KpisClientes.tsx
// -----------------------------------------------------------------------------
// Os 4 blocos do topo da aba Clientes (pedido do Bruno, 13/10/2026):
//   1. Carteira por categoria (Bronze / Silver / Black / Green) — rosca
//   2. LTV médio — quanto cada cliente já gastou com a gente, em média
//   3. Índice de contato — há quantos dias não falamos com cada um, comparado
//      com a meta da categoria dele (Green a gente procura mais vezes)
//   4. Cadastro completo — meta 100%: quem já viajou tem que ter tudo
//
// Os números vêm prontos da view rel_cliente_metricas (0106); aqui só soma.
// Gráficos em SVG à mão — nada de biblioteca nova.
// -----------------------------------------------------------------------------
import { useMemo, useState, type ReactNode } from "react";
import {
  CAMPOS_CADASTRO, SEM_CATEGORIA, moeda, regraDoNivel,
  type CategoriaId, type Metrica, type MetasContato, type RegrasCategorias,
} from "../lib/clientes";

export type FiltroKpi =
  | { tipo: "categoria"; categoria: CategoriaId }
  | { tipo: "sem_contato" }
  | { tipo: "incompletos"; campo?: string };

export interface Cat { id: CategoriaId; nome: string; cor: string }

/** As categorias na ordem do config + "Sem categoria" no fim. */
export function categoriasDe(regras: RegrasCategorias): Cat[] {
  return [...regras.niveis.map((n) => ({ id: n.id, nome: n.nome, cor: n.cor })), SEM_CATEGORIA];
}

/** Dias sem contato; quem nunca teve contato conta desde que a ficha nasceu. */
export function diasParado(m: Metrica): number {
  if (m.dias_sem_contato != null) return m.dias_sem_contato;
  return Math.max(0, Math.floor((Date.now() - new Date(m.criado_em).getTime()) / 86_400_000));
}
export const foraDaMeta = (m: Metrica) => m.dias_sem_contato == null || m.dias_sem_contato > m.meta_contato_dias;

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
// Anel cinza neutro em volta das bolinhas: o "Black" (#1F2328) sumia no cartão escuro.
const ANEL = "inset 0 0 0 1px rgba(127,127,127,.45)";

function Bloco({ titulo, sub, children }: { titulo: string; sub: string; children: ReactNode }) {
  return (
    <section className="rel-card p-4 flex flex-col min-w-0">
      <h2 className="text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>{titulo}</h2>
      <p className="text-[11.5px] leading-snug mt-0.5 mb-3" style={{ color: "var(--ink3)" }}>{sub}</p>
      {children}
    </section>
  );
}

function Barra({ valor, max, cor }: { valor: number; max: number; cor: string }) {
  return (
    <span className="block h-1.5 rounded-full overflow-hidden" style={{ background: "var(--card2)" }}>
      <span className="block h-full rounded-full" style={{ width: `${max ? Math.max(2, (valor / max) * 100) : 0}%`, background: cor, boxShadow: ANEL }} />
    </span>
  );
}

// ── 1. Rosca ────────────────────────────────────────────────────────────────
function Rosca({ fatias, ativa, onClicar }: { fatias: { cat: Cat; n: number }[]; ativa?: CategoriaId; onClicar: (c: CategoriaId) => void }) {
  const total = fatias.reduce((s, f) => s + f.n, 0);
  const R = 52, r = 34, C = 64;
  let ang = -Math.PI / 2;
  const arcos = fatias.filter((f) => f.n > 0).map((f) => {
    const a = (f.n / total) * Math.PI * 2;
    const a0 = ang, a1 = ang + a;
    ang = a1;
    const p = (rad: number, raio: number) => `${C + raio * Math.cos(rad)} ${C + raio * Math.sin(rad)}`;
    const grande = a > Math.PI ? 1 : 0;
    // fatia de 100%: dois meios-círculos (o arco SVG não fecha sozinho)
    const d = f.n === total
      ? `M ${p(-Math.PI / 2, R)} A ${R} ${R} 0 1 1 ${p(Math.PI / 2, R)} A ${R} ${R} 0 1 1 ${p(-Math.PI / 2, R)} M ${p(-Math.PI / 2, r)} A ${r} ${r} 0 1 0 ${p(Math.PI / 2, r)} A ${r} ${r} 0 1 0 ${p(-Math.PI / 2, r)} Z`
      : `M ${p(a0, R)} A ${R} ${R} 0 ${grande} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${grande} 0 ${p(a0, r)} Z`;
    return { f, d };
  });
  return (
    <svg viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="Clientes por categoria" className="flex-shrink-0">
      {total === 0 && <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke="var(--line)" strokeWidth={R - r} />}
      {arcos.map(({ f, d }) => (
        <path key={f.cat.id} d={d} fill={f.cat.cor} fillRule="evenodd" stroke="var(--card)" strokeWidth="1.5"
          opacity={ativa && ativa !== f.cat.id ? 0.3 : 1} className="cursor-pointer" onClick={() => onClicar(f.cat.id)}
          style={{ transition: "opacity .2s cubic-bezier(.25,1,.5,1)" }}>
          <title>{`${f.cat.nome}: ${f.n} (${pct(f.n, total)}%)`}</title>
        </path>
      ))}
      {total > 0 && <>
        <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(127,127,127,.35)" strokeWidth="1" pointerEvents="none" />
        <circle cx={C} cy={C} r={r} fill="none" stroke="rgba(127,127,127,.35)" strokeWidth="1" pointerEvents="none" />
      </>}
      <text x={C} y={C - 2} textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink)">{total}</text>
      <text x={C} y={C + 15} textAnchor="middle" fontSize="10" fill="var(--ink2)">clientes</text>
    </svg>
  );
}

export default function KpisClientes({ metricas, regras, metas, filtro, onFiltro }: {
  metricas: Metrica[];
  regras: RegrasCategorias;
  metas: MetasContato;
  filtro: FiltroKpi | null;
  onFiltro: (f: FiltroKpi | null) => void;
}) {
  const [soViajou, setSoViajou] = useState(false);
  const cats = useMemo(() => categoriasDe(regras), [regras]);

  const porCat = useMemo(() => cats.map((cat) => {
    const lista = metricas.filter((m) => m.categoria === cat.id);
    return { cat, n: lista.length, lista };
  }), [cats, metricas]);

  // ── LTV ──
  const ltv = useMemo(() => {
    const comViagem = metricas.filter((m) => m.viagens_compradas > 0);
    const media = (l: Metrica[]) => (l.length ? l.reduce((s, m) => s + m.valor_total, 0) / l.length : 0);
    const titulares = comViagem.filter((m) => m.valor_total > 0); // quem pagou (titular da venda)
    return {
      media: media(titulares),
      titulares: titulares.length,
      total: titulares.reduce((s, m) => s + m.valor_total, 0),
      porCat: cats.filter((c) => c.id !== "sem_categoria").map((c) => {
        const l = titulares.filter((m) => m.categoria === c.id);
        return { cat: c, media: media(l), n: l.length };
      }),
      // Regra única (grupoTipo): o que não é expedição é pacote — aéreo/hospedagem avulsos contam como pacote.
      expedicao: media(titulares.filter((m) => m.expedicoes > 0 && m.viagens_compradas - m.expedicoes === 0)),
      pacote: media(titulares.filter((m) => m.viagens_compradas - m.expedicoes > 0 && m.expedicoes === 0)),
      ambos: titulares.filter((m) => m.viagens_compradas - m.expedicoes > 0 && m.expedicoes > 0).length,
    };
  }, [metricas, cats]);

  // ── Contato ──
  const contato = useMemo(() => {
    const base = soViajou ? metricas.filter((m) => m.ultimo_retorno) : metricas;
    const linhas = cats.map((c) => {
      const l = base.filter((m) => m.categoria === c.id);
      const comDias = l.filter((m) => m.dias_sem_contato != null);
      return {
        cat: c,
        n: l.length,
        mediaDias: comDias.length ? Math.round(comDias.reduce((s, m) => s + (m.dias_sem_contato ?? 0), 0) / comDias.length) : null,
        dentro: l.filter((m) => !foraDaMeta(m)).length,
        nunca: l.length - comDias.length,
        meta: metas[c.id],
      };
    }).filter((x) => x.n > 0);
    const dentro = base.filter((m) => !foraDaMeta(m)).length;
    const atrasados = [...base].filter(foraDaMeta)
      .sort((a, b) => diasParado(b) / b.meta_contato_dias - diasParado(a) / a.meta_contato_dias)
      .slice(0, 4);
    return { base, linhas, dentro, atrasados, nunca: base.filter((m) => m.dias_sem_contato == null).length };
  }, [metricas, cats, metas, soViajou]);

  // ── Cadastro ──
  // Só conta quem tem viagem com a gente (ficha sem viagem não entra na meta de 100%).
  const cadastro = useMemo(() => {
    const viajantes = metricas.filter((m) => m.viagens_compradas > 0);
    const completos = viajantes.filter((m) => m.cadastro_completo).length;
    const campos = new Map<string, number>();
    viajantes.forEach((m) => m.faltando.forEach((f) => campos.set(f, (campos.get(f) ?? 0) + 1)));
    return { completos, total: viajantes.length, p: pct(completos, viajantes.length), campos: [...campos.entries()].sort((a, b) => b[1] - a[1]) };
  }, [metricas]);

  const ativaCat = filtro?.tipo === "categoria" ? filtro.categoria : undefined;
  const indice = pct(contato.dentro, contato.base.length);
  const maxCampo = cadastro.campos[0]?.[1] ?? 0;
  const maxLtv = Math.max(...ltv.porCat.map((x) => x.media), 1);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
      {/* 1 ── Categorias */}
      <Bloco titulo="Carteira por categoria" sub="Clique numa fatia para ver só aquela categoria.">
        <div className="flex items-center gap-3">
          <Rosca fatias={porCat} ativa={ativaCat}
            onClicar={(c) => onFiltro(ativaCat === c ? null : { tipo: "categoria", categoria: c })} />
          <ul className="flex-1 min-w-0 space-y-1">
            {porCat.map(({ cat, n }) => {
              const nivel = regras.niveis.find((x) => x.id === cat.id);
              return (
                <li key={cat.id}>
                  <button onClick={() => onFiltro(ativaCat === cat.id ? null : { tipo: "categoria", categoria: cat.id })}
                    aria-pressed={ativaCat === cat.id}
                    className="w-full flex items-center gap-1.5 text-left rounded-md px-1.5 py-1 rel-linha"
                    style={{ opacity: ativaCat && ativaCat !== cat.id ? 0.55 : 1, background: ativaCat === cat.id ? "var(--rel-soft)" : undefined }}>
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: cat.cor, boxShadow: ANEL }} aria-hidden />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12px] font-semibold truncate" style={{ color: "var(--ink)" }}>{cat.nome}</span>
                      <span className="block text-[11px] truncate" style={{ color: "var(--ink3)" }}>
                        {nivel ? regraDoNivel(nivel, regras) : "sem viagem ainda"}
                      </span>
                    </span>
                    <span className="text-[12px] font-bold tabular-nums" style={{ color: "var(--ink)" }}>{n}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </Bloco>

      {/* 2 ── LTV */}
      <Bloco titulo="LTV médio" sub={`Quanto cada cliente pagante já gastou com a gente (${ltv.titulares} pagantes).`}>
        <span className="text-3xl font-bold tabular-nums" style={{ color: "var(--ink)" }}>{moeda(ltv.media)}</span>
        <span className="text-[11px] mb-3" style={{ color: "var(--ink3)" }}>Carteira total: {moeda(ltv.total)}</span>
        <ul className="space-y-1.5">
          {ltv.porCat.map((x) => (
            <li key={x.cat.id}>
              <span className="flex justify-between text-[11px]" style={{ color: "var(--ink2)" }}>
                <span>{x.cat.nome} <span style={{ color: "var(--ink3)" }}>· {x.n}</span></span>
                <b className="tabular-nums">{x.n ? moeda(x.media) : "—"}</b>
              </span>
              <Barra valor={x.media} max={maxLtv} cor={x.cat.cor} />
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t" style={{ borderColor: "var(--line2)" }}>
          <span className="text-[11px]" style={{ color: "var(--ink3)" }}>Só expedição<b className="block text-[13px] tabular-nums" style={{ color: "var(--ink)" }}>{moeda(ltv.expedicao)}</b></span>
          <span className="text-[11px]" style={{ color: "var(--ink3)" }}>Só pacote<b className="block text-[13px] tabular-nums" style={{ color: "var(--ink)" }}>{moeda(ltv.pacote)}</b></span>
        </div>
        {ltv.ambos > 0 && <span className="text-[11px] mt-1" style={{ color: "var(--ink3)" }}>{ltv.ambos} cliente{ltv.ambos > 1 ? "s" : ""} já comprou os dois.</span>}
      </Bloco>

      {/* 3 ── Contato */}
      <Bloco titulo="Índice de contato" sub="Quem está dentro da meta de dias sem falar com a gente, por categoria.">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-3xl font-bold tabular-nums" style={{ color: indice >= 80 ? "var(--rel-ink)" : "var(--err-ink)" }}>
            {indice}%<span className="sr-only">{indice >= 80 ? " — dentro da meta" : " — abaixo da meta de 80%"}</span>
          </span>
          <label className="flex items-center gap-1.5 text-[11.5px] cursor-pointer py-1" style={{ color: "var(--ink2)" }}>
            <input type="checkbox" style={{ accentColor: "var(--rel)" }} checked={soViajou} onChange={(e) => setSoViajou(e.target.checked)} /> só quem já viajou
          </label>
        </div>
        <span className="text-[11px] mb-2" style={{ color: "var(--ink3)" }}>
          {contato.dentro} de {contato.base.length} em dia{contato.nunca ? ` · ${contato.nunca} nunca tiveram contato` : ""}
        </span>
        <ul className="space-y-1">
          {contato.linhas.map((x) => (
            <li key={x.cat.id} className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--ink2)" }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: x.cat.cor, boxShadow: ANEL }} aria-hidden />
              <span className="flex-1 truncate">{x.cat.nome}</span>
              <span className="tabular-nums" title="média de dias sem contato / meta">{x.mediaDias ?? "—"}d / {x.meta}d</span>
              <b className="tabular-nums w-9 text-right" style={{ color: pct(x.dentro, x.n) >= 80 ? "var(--rel-ink)" : "var(--err-ink)" }}>{pct(x.dentro, x.n)}%</b>
            </li>
          ))}
          {contato.linhas.length === 0 && <li className="text-[11px]" style={{ color: "var(--ink3)" }}>Ninguém {soViajou ? "voltou de viagem ainda" : "na carteira"}.</li>}
        </ul>
        {contato.atrasados.length > 0 && (
          <div className="mt-3 pt-2 border-t" style={{ borderColor: "var(--line2)" }}>
            <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--ink2)" }}>Mais tempo sem falar</p>
            {contato.atrasados.map((m) => (
              <p key={m.id} className="flex justify-between text-[11px]" style={{ color: "var(--ink)" }}>
                <span className="truncate">{m.nome}</span>
                <span className="tabular-nums flex-shrink-0 ml-2" style={{ color: "var(--err-ink)" }}>{m.dias_sem_contato == null ? "nunca" : `${m.dias_sem_contato}d`}</span>
              </p>
            ))}
            <button onClick={() => onFiltro(filtro?.tipo === "sem_contato" ? null : { tipo: "sem_contato" })}
              aria-pressed={filtro?.tipo === "sem_contato"}
              className="text-[12px] font-semibold underline mt-1.5 py-1" style={{ color: "var(--rel-ink)" }}>
              {filtro?.tipo === "sem_contato" ? "Mostrar todos" : `Ver os ${contato.base.length - contato.dentro} fora da meta`}
            </button>
          </div>
        )}
      </Bloco>

      {/* 4 ── Cadastro */}
      <Bloco titulo="Cadastros completos" sub="Meta: 100%. Quem já viajou com a gente tem que ter todos os documentos.">
        <span className="text-3xl font-bold tabular-nums" style={{ color: cadastro.p === 100 ? "var(--rel-ink)" : "var(--err-ink)" }}>
          {cadastro.p}%<span className="sr-only">{cadastro.p === 100 ? " — meta batida" : " — abaixo da meta de 100%"}</span>
        </span>
        <span className="block h-2 rounded-full overflow-hidden my-2" style={{ background: "var(--err-bg)" }} role="progressbar" aria-valuenow={cadastro.p} aria-valuemin={0} aria-valuemax={100} aria-label="Cadastros completos">
          <span className="block h-full rounded-full" style={{ width: `${cadastro.p}%`, background: "var(--rel)" }} />
        </span>
        <span className="text-[11px] mb-2" style={{ color: "var(--ink3)" }}>{cadastro.completos} de {cadastro.total} clientes com viagem estão completos</span>
        <ul className="space-y-1">
          {cadastro.campos.slice(0, 6).map(([campo, n]) => (
            <li key={campo}>
              <button onClick={() => onFiltro({ tipo: "incompletos", campo })} aria-pressed={filtro?.tipo === "incompletos" && filtro.campo === campo}
                className="w-full text-left rel-linha rounded-md px-1.5 py-1">
                <span className="flex justify-between text-[11px]" style={{ color: "var(--ink2)" }}>
                  <span>falta {CAMPOS_CADASTRO[campo] ?? campo}</span><b className="tabular-nums">{n}</b>
                </span>
                <Barra valor={n} max={maxCampo} cor="var(--err-ink)" />
              </button>
            </li>
          ))}
        </ul>
        {cadastro.p < 100 && (
          <button onClick={() => onFiltro(filtro?.tipo === "incompletos" && !filtro.campo ? null : { tipo: "incompletos" })}
            className="text-[12px] font-semibold underline mt-2 py-1 self-start" style={{ color: "var(--rel-ink)" }}>
            Ver os {cadastro.total - cadastro.completos} incompletos
          </button>
        )}
      </Bloco>
    </div>
  );
}
