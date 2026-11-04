// src/closer/DesempenhoCloser.tsx
// -----------------------------------------------------------------------------
// DESEMPENHO DO CLOSER (Bruno, 03/11): "100% visual, só o que importa".
// Substitui o painel do SDR (SdrDashboard) que o closer via em #closer/desempenho.
//
//   Closer ....... só os números dele, grandes.
//   Gestão ....... (admin / gestor do Comercial) o TIME em cima, a comparação
//                  entre closers embaixo; clicar num closer abre os números dele.
//
// O que cada número é: ./desempenho.ts (a conta mora lá, testada).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/qs/queries";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao } from "@/rel/ui";
import { brl, hojeISO } from "./lib";
import { lotes } from "@/lib/lotes";
import {
  PRESETS, calcularDesempenho, datasDoPreset, intervaloIso,
  type AnexoLido, type Metricas, type NegocioLido, type PresetPeriodo, type ReuniaoLida,
} from "./desempenho";

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const int = (v: number) => v.toLocaleString("pt-BR");
const brlCurto = (v: number) => (v >= 1_000_000 ? `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`
  : v >= 10_000 ? `R$ ${Math.round(v / 1000).toLocaleString("pt-BR")} mil` : brl(v));

interface Dados { reunioes: ReuniaoLida[]; negocios: NegocioLido[]; anexos: AnexoLido[] }

/** 0295: quais desses cartões têm a proposta anexada na venda. Sem a migration, nenhum (sem erro vermelho). */
async function lerAnexos(negocioIds: string[]): Promise<AnexoLido[]> {
  const fora: AnexoLido[] = [];
  const rs = await Promise.all(lotes(negocioIds, 150).map((l) => supabase.from("qs_venda_propostas").select("negocio_id").in("negocio_id", l)));
  for (const { data, error } of rs) {
    if (error) return fora;
    fora.push(...((data ?? []) as AnexoLido[]));
  }
  return fora;
}

async function carregar(deIso: string, ateIso: string, closerId: string | null): Promise<Dados> {
  const [reunioes, negocios] = await Promise.all([
    fetchAllRows<ReuniaoLida>((de, ate) => {
      let q = supabase.from("qs_meetings").select("id, closer_id, status, tipo, sal, venda_valor, venda_tipo")
        .in("status", ["realizada", "no_show"]).gte("scheduled_at", deIso).lt("scheduled_at", ateIso);
      if (closerId) q = q.eq("closer_id", closerId);
      return q.order("id").range(de, ate);
    }),
    // A venda conta no dia da PRÉ-VENDA; sem pré-venda, no dia da ficha. Um cartão, uma venda.
    fetchAllRows<NegocioLido>((de, ate) => {
      let q = supabase.from("qs_closer_negocios").select("*")
        .or(`and(pre_venda_em.gte.${deIso},pre_venda_em.lt.${ateIso}),and(pre_venda_em.is.null,consolidada_em.gte.${deIso},consolidada_em.lt.${ateIso})`);
      if (closerId) q = q.eq("closer_id", closerId);
      return q.order("id").range(de, ate);
    }),
  ]);
  const anexos = await lerAnexos([...new Set(negocios.map((n) => n.id))]);
  return { reunioes, negocios, anexos };
}

/** Todos os closers (inativo só aparece se tiver número no período). */
async function lerClosers(): Promise<{ id: string; nome: string; ativo: boolean }[]> {
  const { data, error } = await supabase.from("qs_users").select("id, name, is_active").eq("role", "closer").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((u) => ({ id: u.id as string, nome: String(u.name ?? "Sem nome").trim(), ativo: u.is_active !== false }));
}

export default function DesempenhoCloser() {
  const { currentUser } = useQsAuth();
  const gestao = currentUser?.role === "admin" || (currentUser?.role === "gestor" && (!currentUser.setores?.length || currentUser.setores.includes("comercial")));
  const [preset, setPreset] = useState<PresetPeriodo>("mes");
  const [datas, setDatas] = useState(() => datasDoPreset("mes", hojeISO()));
  const [closers, setClosers] = useState<{ id: string; nome: string; ativo: boolean }[]>([]);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  // Gestão: null = o time; id = um closer.
  const [foco, setFoco] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    if (!gestao) { setClosers([{ id: currentUser.id, nome: currentUser.name ?? "Você", ativo: true }]); return; }
    void lerClosers().then(setClosers).catch((e) => setErro((e as Error).message));
  }, [currentUser, gestao]);

  useEffect(() => {
    if (!currentUser || datas.de > datas.ate) return;
    let vivo = true;
    setCarregando(true); setErro(null);
    const { deIso, ateIso } = intervaloIso(datas.de, datas.ate);
    carregar(deIso, ateIso, gestao ? null : currentUser.id)
      .then((d) => { if (vivo) setDados(d); })
      .catch((e) => { if (vivo) setErro((e as Error).message || "Não deu pra ler os números."); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [currentUser, gestao, datas]);

  const conta = useMemo(() => {
    if (!dados || !closers.length) return null;
    const r = calcularDesempenho(dados, closers);
    const ativos = new Set(closers.filter((c) => c.ativo).map((c) => c.id));
    const temNumero = (m: Metricas) => m.realizadas + m.noShow + m.vendas + m.propostas > 0;
    return { ...r, porCloser: r.porCloser.filter((m) => ativos.has(m.id) || temNumero(m)) };
  }, [dados, closers]);

  function escolher(p: PresetPeriodo) {
    setPreset(p);
    if (p !== "personalizado") setDatas(datasDoPreset(p, hojeISO()));
  }

  if (!currentUser) return null;
  const meu = conta?.porCloser.find((l) => l.id === currentUser.id) ?? null;
  const emFoco = gestao ? (foco ? conta?.porCloser.find((l) => l.id === foco) ?? null : conta?.time ?? null) : meu;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-[22px] font-bold" style={{ color: "var(--ink)" }}>Desempenho</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            {gestao ? (foco ? emFoco?.nome : "Time de closers") : "Seus números"} · {dataCurta(datas.de)} a {dataCurta(datas.ate)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 p-1 rounded-xl" style={{ background: "var(--card2)" }} role="tablist" aria-label="Período">
          {PRESETS.map((p) => (
            <button key={p.id} role="tab" aria-selected={preset === p.id} onClick={() => escolher(p.id)}
              className="px-3 py-1.5 rounded-lg text-[13px] font-semibold"
              style={preset === p.id ? { background: "var(--card)", color: "var(--rel-ink)", boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { color: "var(--ink2)" }}>
              {p.rotulo}
            </button>
          ))}
        </div>
      </div>
      {preset === "personalizado" && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          <label className="flex items-center gap-2">De <input type="date" className="rel-input !w-auto" value={datas.de} max={datas.ate} onChange={(e) => e.target.value && setDatas((d) => ({ ...d, de: e.target.value }))} /></label>
          <label className="flex items-center gap-2">até <input type="date" className="rel-input !w-auto" value={datas.ate} min={datas.de} onChange={(e) => e.target.value && setDatas((d) => ({ ...d, ate: e.target.value }))} /></label>
        </div>
      )}

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {gestao && foco && <Botao variante="fantasma" onClick={() => setFoco(null)}>← Voltar pro time</Botao>}

      {carregando && !conta ? (
        <p className="text-sm" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : emFoco ? (
        <div style={{ opacity: carregando ? 0.6 : 1, transition: "opacity .15s" }} className="space-y-5">
          <Painel m={emFoco} />
          {gestao && !foco && conta && <Comparacao linhas={conta.porCloser} onAbrir={setFoco} />}
        </div>
      ) : null}
    </div>
  );
}

function dataCurta(ymd: string) {
  const [a, m, d] = ymd.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

// ── Os números grandes ──────────────────────────────────────────────────────
function Painel({ m }: { m: Metricas }) {
  const semVenda = m.vendas === 0;
  return (
    <div className="space-y-3">
      {/* Linha 1: o dinheiro */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Cartao destaque rotulo="Faturamento" valor={brl(m.faturamento)}
          dica={semVenda ? "nenhuma venda registrada no QS no período" : `${int(m.vendas)} ${m.vendas === 1 ? "venda" : "vendas"} · sem aéreo`} />
        <Cartao rotulo="Conversão" valor={pct(m.conversao)} dica="vendas ÷ reuniões realizadas" barra={m.conversao} />
        <Cartao rotulo="Ticket médio" valor={m.ticket == null ? "—" : brl(m.ticket)} dica="faturamento ÷ vendas" />
      </div>
      {/* Linha 2: as reuniões */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Cartao rotulo="R.R. — realizadas" valor={int(m.realizadas)} dica={`${int(m.realizadas + m.noShow)} reuniões no período`} />
        <Cartao rotulo="No-show" valor={int(m.noShow)} dica={`${pct(m.taxaNoShow)} das reuniões`} tom={m.taxaNoShow != null && m.taxaNoShow >= 0.25 ? "erro" : undefined} barra={m.taxaNoShow} />
        <Cartao rotulo="Eram SAL" valor={pct(m.taxaSal)} barra={m.taxaSal}
          dica={`${int(m.sal)} de ${int(m.primeiras)} 1ªs reuniões${m.salSemResposta ? ` · ${int(m.salSemResposta)} sem SAL marcado` : ""}`} />
        <Cartao rotulo="Vendas com proposta anexada" valor={int(m.propostas)}
          dica={m.vendas ? `${int(m.propostas)} de ${int(m.vendas)} vendas · a proposta anexada ao registrar a venda` : "a proposta anexada ao registrar a venda"} />
      </div>
      {m.emNegociacao > 0 && (
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
          Em negociação: <b style={{ color: "var(--ink2)" }}>{brl(m.emNegociacao)}</b> informados no desfecho das reuniões realizadas (ainda não é venda).
        </p>
      )}
    </div>
  );
}

function Cartao({ rotulo, valor, dica, destaque, tom, barra }: {
  rotulo: string; valor: string; dica?: string; destaque?: boolean; tom?: "erro"; barra?: number | null;
}) {
  return (
    <div className="rel-card p-4 sm:p-5 flex flex-col gap-1 min-w-0"
      style={destaque ? { background: "var(--rel)", borderColor: "var(--rel)" } : undefined}>
      <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: destaque ? "rgba(255,255,255,.85)" : "var(--ink3)" }}>{rotulo}</span>
      <span className="text-[30px] sm:text-[34px] leading-tight font-extrabold tabular-nums truncate"
        style={{ color: destaque ? "#fff" : tom === "erro" ? "var(--red)" : "var(--ink)" }}>{valor}</span>
      {barra != null && (
        <span className="h-1.5 rounded-full overflow-hidden" style={{ background: destaque ? "rgba(255,255,255,.25)" : "var(--card2)" }} aria-hidden>
          <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.round(barra * 100))}%`, background: tom === "erro" ? "var(--red)" : destaque ? "#fff" : "var(--rel)" }} />
        </span>
      )}
      {dica && <span className="text-[12px]" style={{ color: destaque ? "rgba(255,255,255,.85)" : "var(--ink3)" }}>{dica}</span>}
    </div>
  );
}

// ── Gestão: um closer do lado do outro ──────────────────────────────────────
const COLUNAS: { id: keyof Metricas; rotulo: string; fmt: (m: Metricas) => string }[] = [
  { id: "faturamento", rotulo: "Faturamento", fmt: (m) => brlCurto(m.faturamento) },
  { id: "vendas", rotulo: "Vendas", fmt: (m) => int(m.vendas) },
  { id: "conversao", rotulo: "Conversão", fmt: (m) => pct(m.conversao) },
  { id: "ticket", rotulo: "Ticket", fmt: (m) => (m.ticket == null ? "—" : brlCurto(m.ticket)) },
  { id: "realizadas", rotulo: "R.R.", fmt: (m) => int(m.realizadas) },
  { id: "taxaNoShow", rotulo: "No-show", fmt: (m) => `${int(m.noShow)} · ${pct(m.taxaNoShow)}` },
  { id: "taxaSal", rotulo: "SAL", fmt: (m) => pct(m.taxaSal) },
  { id: "propostas", rotulo: "Com proposta", fmt: (m) => `${int(m.propostas)}/${int(m.vendas)}` },
];

function Comparacao({ linhas, onAbrir }: { linhas: Metricas[]; onAbrir: (id: string) => void }) {
  const [ordem, setOrdem] = useState<keyof Metricas>("faturamento");
  const ordenadas = [...linhas].sort((a, b) => Number(b[ordem] ?? -1) - Number(a[ordem] ?? -1) || a.nome.localeCompare(b.nome));
  const maxFat = Math.max(1, ...linhas.map((l) => l.faturamento));
  const maxRR = Math.max(1, ...linhas.map((l) => l.realizadas));
  return (
    <section className="rel-card overflow-hidden">
      <header className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--line)" }}>
        <h2 className="text-[15px] font-bold flex-1" style={{ color: "var(--ink)" }}>Closer a closer</h2>
        <span className="text-[12px]" style={{ color: "var(--ink3)" }}>clique no nome pra abrir · no título pra ordenar</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr style={{ color: "var(--ink3)" }}>
              <th className="text-left font-semibold px-4 py-2">Closer</th>
              {COLUNAS.map((c) => (
                <th key={c.id} className="text-right font-semibold px-3 py-2 whitespace-nowrap">
                  <button onClick={() => setOrdem(c.id)} style={{ color: ordem === c.id ? "var(--rel-ink)" : undefined }}>
                    {c.rotulo}{ordem === c.id ? " ↓" : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((l) => (
              <tr key={l.id} className="rel-linha border-t" style={{ borderColor: "var(--line)" }}>
                <td className="px-4 py-2.5 min-w-[180px]">
                  <button className="font-semibold hover:underline text-left" style={{ color: "var(--ink)" }} onClick={() => onAbrir(l.id)}>{l.nome}</button>
                  {/* Duas barrinhas: faturamento (cor da área) e reuniões realizadas (cinza). */}
                  <div className="mt-1 space-y-0.5" aria-hidden>
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, (l.faturamento / maxFat) * 100)}%`, background: "var(--rel)" }} />
                    <div className="h-1 rounded-full" style={{ width: `${Math.max(2, (l.realizadas / maxRR) * 100)}%`, background: "var(--line2, var(--line))" }} />
                  </div>
                </td>
                {COLUNAS.map((c) => (
                  <td key={c.id} className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold"
                    style={{ color: c.id === "taxaNoShow" && (l.taxaNoShow ?? 0) >= 0.25 ? "var(--red)" : "var(--ink)" }}>
                    {c.fmt(l)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
