// src/components/sdr/dashboard/MonitorLeadsPage.tsx
// -----------------------------------------------------------------------------
// DESEMPENHO → MONITOR DE LEADS (Bruno, 28/09/2026).
//
// Responde "os leads estão indo desproporcional?" com a régua certa: quem
// RECEBEU cada lead na chegada (0094), separando o que o rodízio distribuiu
// (novos) do que a carteira devolveu (retornos). Fim de semana, live por
// destino e closers no mesmo lugar, e a relação lead a lead embaixo — clicar
// num número filtra a lista.
//
// O mesmo retrato sai pro Dashboard por /api/monitor-distribuicao.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchLista, fetchMonitor, intervaloDo, listaEmCsv, PERIODOS, ROTULO_CANAL,
  type Canal, type LeadDistribuido, type LinhaSdr, type Monitor, type PeriodoId,
} from "@/lib/qs/monitorDistribuicao";

interface Props {
  onOpenLead: (leadId: string) => void;
}

type Contagem = "novos" | "todos";

interface Filtro {
  sdr: string | null;
  canal: Canal | null;
  soFds: boolean;
  rotulo: string;
}

const LINHA = "var(--line, #E8EBF0)";
const NUM = { fontVariantNumeric: "tabular-nums" as const };

function dataBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function diaCurto(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][w]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

/** Célula clicável: número que abre a lista filtrada. */
function Num({ v, onClick, forte }: { v: number; onClick?: () => void; forte?: boolean }) {
  if (!onClick || v === 0) {
    return <span className={forte ? "font-extrabold text-gray-900" : "text-gray-700"} style={NUM}>{v}</span>;
  }
  return (
    <button type="button" onClick={onClick}
            className={`${forte ? "font-extrabold text-gray-900" : "text-gray-700"} hover:underline hover:text-blue-700`}
            style={NUM}>
      {v}
    </button>
  );
}

/**
 * O veredito em uma frase. A pergunta do time é "está justo?" — a tela tem que
 * responder isso antes de mostrar tabela.
 */
function Equilibrio({ sdrs, contagem }: { sdrs: LinhaSdr[]; contagem: Contagem }) {
  const valor = (s: LinhaSdr) => (contagem === "novos" ? s.novos : s.total);
  const so = sdrs.filter((s) => s.papel === "sdr");
  if (so.length < 2) return null;
  const vals = so.map(valor);
  const max = Math.max(...vals), min = Math.min(...vals);
  const media = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (media === 0) return null;
  const pct = Math.round(((max - min) / media) * 100);
  const [cor, fundo, rotulo] =
    pct <= 10 ? ["#0E7C6A", "rgba(18,161,138,.12)", "Equilibrado"]
    : pct <= 25 ? ["#B45309", "rgba(180,83,9,.12)", "Atenção"]
    : ["#DC2626", "rgba(220,38,38,.10)", "Desequilibrado"];
  const quemMais = so.find((s) => valor(s) === max)?.nome ?? "—";
  const quemMenos = so.find((s) => valor(s) === min)?.nome ?? "—";

  return (
    <div className="rounded-2xl border p-4 mb-4 flex flex-wrap items-center gap-4" style={{ borderColor: LINHA, background: fundo }}>
      <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded" style={{ color: cor, background: "#fff" }}>
        {rotulo}
      </span>
      <p className="text-[13.5px] text-gray-800 flex-1 min-w-[240px]">
        Diferença de <b style={NUM}>{max - min}</b> lead(s) entre quem mais recebeu (<b>{quemMais}</b>, {max}) e quem menos
        recebeu (<b>{quemMenos}</b>, {min}) — <b>{pct}%</b> da média de {media.toFixed(1)}.
        {contagem === "novos"
          ? " Contando só os novos, que são os que o rodízio distribui."
          : " Contando tudo, inclusive retornos que a carteira devolve pro mesmo SDR."}
      </p>
    </div>
  );
}

export default function MonitorLeadsPage({ onOpenLead }: Props) {
  const [periodo, setPeriodo] = useState<PeriodoId | "custom">("fds");
  const [intervalo, setIntervalo] = useState(() => intervaloDo("fds"));
  const [contagem, setContagem] = useState<Contagem>("novos");
  const [dados, setDados] = useState<Monitor | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const [lista, setLista] = useState<LeadDistribuido[] | null>(null);
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [soNovosNaLista, setSoNovosNaLista] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await fetchMonitor(intervalo.de, intervalo.ate));
    } catch (e) {
      setErro((e as Error)?.message || "Não consegui carregar o monitor.");
    } finally {
      setCarregando(false);
    }
  }, [intervalo]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Trocar o período fecha a lista aberta: ela seria de outro intervalo.
  useEffect(() => { setFiltro(null); setLista(null); }, [intervalo]);

  const abrirLista = useCallback(async (f: Filtro, soNovos = false) => {
    setFiltro(f);
    setSoNovosNaLista(soNovos);
    setCarregandoLista(true);
    setLista(null);
    try {
      setLista(await fetchLista(intervalo.de, intervalo.ate, f));
    } catch (e) {
      setErro((e as Error)?.message || "Não consegui carregar a lista.");
    } finally {
      setCarregandoLista(false);
    }
    requestAnimationFrame(() => document.getElementById("monitor-lista")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [intervalo]);

  const nomes = useMemo(() => {
    const m = new Map<string, string>();
    dados?.sdrs.forEach((s) => s.sdr_id && m.set(s.sdr_id, s.nome ?? "—"));
    return m;
  }, [dados]);

  const sdrs = useMemo(() => {
    const l = dados?.sdrs ?? [];
    // SDRs primeiro; closer/admin/sem dono (lead que entrou direto com eles) no fim.
    return [...l].sort((a, b) => Number(b.papel === "sdr") - Number(a.papel === "sdr") || b.total - a.total);
  }, [dados]);

  const totalGeral = useMemo(() => {
    const soma = (k: keyof LinhaSdr) => sdrs.reduce((a, s) => a + (Number(s[k]) || 0), 0);
    return {
      total: soma("total"), novos: soma("novos"), retornos: soma("retornos"), semana: soma("semana"),
      fds: soma("fds"), sabado: soma("sabado"), domingo: soma("domingo"),
      live: soma("live"), trafego: soma("trafego"), organico: soma("organico"), outros: soma("outros"),
    };
  }, [sdrs]);

  // Colunas das tabelas de live e por dia: só SDRs com lead no período.
  const colunasSdr = useMemo(
    () => sdrs.filter((s) => s.papel === "sdr" && s.sdr_id).map((s) => ({ id: s.sdr_id as string, nome: s.nome ?? "—" })),
    [sdrs],
  );

  const lives = useMemo(() => {
    const m = new Map<string, Map<string, { total: number; novos: number }>>();
    dados?.lives.forEach((l) => {
      if (!m.has(l.destino)) m.set(l.destino, new Map());
      m.get(l.destino)!.set(l.sdr_id ?? "", { total: l.total, novos: l.novos });
    });
    return [...m.entries()];
  }, [dados]);

  const dias = useMemo(() => {
    const m = new Map<string, Map<string, { total: number; novos: number }>>();
    dados?.por_dia.forEach((d) => {
      if (!m.has(d.dia)) m.set(d.dia, new Map());
      m.get(d.dia)!.set(d.sdr_id ?? "", { total: d.total, novos: d.novos });
    });
    return [...m.entries()];
  }, [dados]);

  const listaVisivel = useMemo(
    () => (lista ?? []).filter((l) => !soNovosNaLista || !l.retorno),
    [lista, soNovosNaLista],
  );

  function baixarCsv() {
    if (!listaVisivel.length) return;
    const blob = new Blob([listaEmCsv(listaVisivel)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `distribuicao-${intervalo.de}_${intervalo.ate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const pick = (s: LinhaSdr) => (contagem === "novos" ? s.novos : s.total);
  const maxBarra = Math.max(1, ...sdrs.map(pick));
  const v = (d?: { total: number; novos: number }) => (d ? (contagem === "novos" ? d.novos : d.total) : 0);

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Monitor de leads</h1>
          <p className="text-[12.5px] text-gray-500 mt-0.5">
            Quem <b>recebeu</b> cada lead quando ele chegou — não muda quando o lead vira reunião e vai pro closer.
          </p>
        </div>
        <div className="flex rounded-lg border overflow-hidden text-[12.5px] font-semibold" style={{ borderColor: LINHA }}>
          {(["novos", "todos"] as Contagem[]).map((c) => (
            <button key={c} type="button" onClick={() => setContagem(c)}
                    className={`px-3 py-1.5 ${contagem === c ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              {c === "novos" ? "Só novos (rodízio)" : "Tudo (com retornos)"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {PERIODOS.map((p) => (
          <button key={p.id} type="button"
                  onClick={() => { setPeriodo(p.id); setIntervalo(intervaloDo(p.id)); }}
                  className={`px-3 py-1.5 rounded-full text-[12.5px] font-semibold border ${periodo === p.id ? "bg-blue-600 border-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                  style={periodo === p.id ? undefined : { borderColor: LINHA }}>
            {p.rotulo}
          </button>
        ))}
        <span className="flex items-center gap-1.5 text-[12.5px] text-gray-600 ml-1">
          <input type="date" value={intervalo.de} max={intervalo.ate}
                 onChange={(e) => { if (e.target.value) { setPeriodo("custom"); setIntervalo((i) => ({ ...i, de: e.target.value })); } }}
                 className="border rounded-md px-2 py-1" style={{ borderColor: LINHA }} />
          até
          <input type="date" value={intervalo.ate} min={intervalo.de}
                 onChange={(e) => { if (e.target.value) { setPeriodo("custom"); setIntervalo((i) => ({ ...i, ate: e.target.value })); } }}
                 className="border rounded-md px-2 py-1" style={{ borderColor: LINHA }} />
        </span>
        {carregando && <span className="text-[12px] text-gray-400">carregando…</span>}
      </div>

      {erro && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{erro}</div>
      )}

      {dados && (
        <>
          <Equilibrio sdrs={sdrs} contagem={contagem} />

          {/* ── Por SDR ─────────────────────────────────────────────────── */}
          <section className="rounded-2xl border bg-white mb-5 overflow-x-auto" style={{ borderColor: LINHA }}>
            <div className="px-4 pt-4 pb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold text-gray-900">Leads recebidos por SDR</h2>
              <span className="text-[11.5px] text-gray-500">{dataBR(intervalo.de)} a {dataBR(intervalo.ate)} · clique num número pra ver os leads</span>
            </div>
            <table className="w-full text-[13px] min-w-[860px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wider text-gray-400 text-right">
                  <th className="text-left font-bold px-4 py-2">Quem recebeu</th>
                  <th className="font-bold px-2 py-2 text-left w-[180px]">Parcela</th>
                  <th className="font-bold px-2 py-2">Total</th>
                  <th className="font-bold px-2 py-2">Novos</th>
                  <th className="font-bold px-2 py-2">Retornos</th>
                  <th className="font-bold px-2 py-2">Seg–sex</th>
                  <th className="font-bold px-2 py-2">Sáb</th>
                  <th className="font-bold px-2 py-2">Dom</th>
                  <th className="font-bold px-2 py-2">Live</th>
                  <th className="font-bold px-2 py-2">Tráfego</th>
                  <th className="font-bold px-2 py-2">Orgânico</th>
                  <th className="font-bold px-4 py-2">Outros</th>
                </tr>
              </thead>
              <tbody>
                {sdrs.length === 0 && (
                  <tr><td colSpan={12} className="px-4 py-6 text-center text-gray-400">Nenhum lead chegou nesse período.</td></tr>
                )}
                {sdrs.map((s) => {
                  const nome = s.nome ?? "Sem dono";
                  const base = { sdr: s.sdr_id, canal: null, soFds: false };
                  const pctParcela = totalGeral[contagem === "novos" ? "novos" : "total"]
                    ? Math.round((pick(s) / totalGeral[contagem === "novos" ? "novos" : "total"]) * 100) : 0;
                  return (
                    <tr key={s.sdr_id ?? "sem"} className="border-t text-right" style={{ borderColor: LINHA, opacity: s.papel === "sdr" ? 1 : 0.6 }}>
                      <td className="text-left px-4 py-2.5">
                        <span className="font-semibold text-gray-900">{nome}</span>
                        {s.papel !== "sdr" && <span className="ml-1.5 text-[10px] uppercase text-gray-400">{s.papel ?? "sem dono"}</span>}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full overflow-hidden" style={{ background: "rgba(100,116,139,.14)" }}>
                            <div className="h-full rounded-full bg-blue-600" style={{ width: `${(pick(s) / maxBarra) * 100}%` }} />
                          </div>
                          <span className="text-[11.5px] text-gray-500 w-9 text-right" style={NUM}>{pctParcela}%</span>
                        </div>
                      </td>
                      <td className="px-2"><Num forte v={s.total} onClick={() => abrirLista({ ...base, rotulo: `${nome} · todos` })} /></td>
                      <td className="px-2"><Num v={s.novos} onClick={() => abrirLista({ ...base, rotulo: `${nome} · novos` }, true)} /></td>
                      <td className="px-2"><Num v={s.retornos} onClick={() => abrirLista({ ...base, rotulo: `${nome} · todos` })} /></td>
                      <td className="px-2"><Num v={s.semana} /></td>
                      <td className="px-2"><Num v={s.sabado} onClick={() => abrirLista({ ...base, soFds: true, rotulo: `${nome} · fim de semana` })} /></td>
                      <td className="px-2"><Num v={s.domingo} onClick={() => abrirLista({ ...base, soFds: true, rotulo: `${nome} · fim de semana` })} /></td>
                      <td className="px-2"><Num v={s.live} onClick={() => abrirLista({ ...base, canal: "live", rotulo: `${nome} · live` })} /></td>
                      <td className="px-2"><Num v={s.trafego} onClick={() => abrirLista({ ...base, canal: "trafego", rotulo: `${nome} · tráfego` })} /></td>
                      <td className="px-2"><Num v={s.organico} onClick={() => abrirLista({ ...base, canal: "organico", rotulo: `${nome} · orgânico` })} /></td>
                      <td className="px-4"><Num v={s.outros} onClick={() => abrirLista({ ...base, canal: "outros", rotulo: `${nome} · outros` })} /></td>
                    </tr>
                  );
                })}
                {sdrs.length > 0 && (
                  <tr className="border-t text-right bg-gray-50/60 font-semibold" style={{ borderColor: LINHA }}>
                    <td className="text-left px-4 py-2.5 text-gray-700">Total</td>
                    <td />
                    <td className="px-2"><Num forte v={totalGeral.total} onClick={() => abrirLista({ sdr: null, canal: null, soFds: false, rotulo: "Todos" })} /></td>
                    <td className="px-2" style={NUM}>{totalGeral.novos}</td>
                    <td className="px-2" style={NUM}>{totalGeral.retornos}</td>
                    <td className="px-2" style={NUM}>{totalGeral.semana}</td>
                    <td className="px-2" style={NUM}>{totalGeral.sabado}</td>
                    <td className="px-2" style={NUM}>{totalGeral.domingo}</td>
                    <td className="px-2" style={NUM}>{totalGeral.live}</td>
                    <td className="px-2" style={NUM}>{totalGeral.trafego}</td>
                    <td className="px-2" style={NUM}>{totalGeral.organico}</td>
                    <td className="px-4" style={NUM}>{totalGeral.outros}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="px-4 py-3 text-[11.5px] text-gray-500 border-t" style={{ borderColor: LINHA }}>
              <b>Novo</b> = primeira vez que o telefone entra; é o que o rodízio divide. <b>Retorno</b> = a mesma pessoa voltando;
              a carteira devolve pro SDR que já atendia, fora do rodízio.
            </p>
          </section>

          <div className="grid gap-5 lg:grid-cols-2 mb-5">
            {/* ── Lives por destino ──────────────────────────────────────── */}
            <section className="rounded-2xl border bg-white overflow-x-auto" style={{ borderColor: LINHA }}>
              <h2 className="px-4 pt-4 pb-2 text-sm font-bold text-gray-900">Leads de live, por destino</h2>
              {lives.length === 0 ? (
                <p className="px-4 pb-4 text-[12.5px] text-gray-400">Nenhum lead de live nesse período.</p>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[10.5px] uppercase tracking-wider text-gray-400 text-right">
                      <th className="text-left font-bold px-4 py-2">Destino</th>
                      {colunasSdr.map((c) => <th key={c.id} className="font-bold px-2 py-2">{c.nome.split(" ")[0]}</th>)}
                      <th className="font-bold px-4 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lives.map(([destino, porSdr]) => {
                      const tot = [...porSdr.values()].reduce((a, d) => a + v(d), 0);
                      return (
                        <tr key={destino} className="border-t text-right" style={{ borderColor: LINHA }}>
                          <td className="text-left px-4 py-2 font-semibold text-gray-800">{destino}</td>
                          {colunasSdr.map((c) => <td key={c.id} className="px-2" style={NUM}>{v(porSdr.get(c.id))}</td>)}
                          <td className="px-4 font-bold" style={NUM}>{tot}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>

            {/* ── Closers ────────────────────────────────────────────────── */}
            <section className="rounded-2xl border bg-white overflow-x-auto" style={{ borderColor: LINHA }}>
              <h2 className="px-4 pt-4 pb-1 text-sm font-bold text-gray-900">Reuniões por closer</h2>
              <p className="px-4 pb-2 text-[11.5px] text-gray-500">Leads distintos com reunião marcada no período — remarcação não conta duas vezes.</p>
              {dados.closers.length === 0 ? (
                <p className="px-4 pb-4 text-[12.5px] text-gray-400">Nenhuma reunião marcada nesse período.</p>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[10.5px] uppercase tracking-wider text-gray-400 text-right">
                      <th className="text-left font-bold px-4 py-2">Closer</th>
                      <th className="font-bold px-2 py-2">Leads</th>
                      <th className="font-bold px-2 py-2">1ª reunião</th>
                      <th className="font-bold px-2 py-2">Retomada</th>
                      <th className="font-bold px-2 py-2">Fim de sem.</th>
                      <th className="font-bold px-2 py-2">Autoagend.</th>
                      <th className="font-bold px-4 py-2">Realizadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.closers.map((c) => (
                      <tr key={c.closer_id} className="border-t text-right" style={{ borderColor: LINHA }}>
                        <td className="text-left px-4 py-2 font-semibold text-gray-800">{c.nome ?? "—"}</td>
                        <td className="px-2 font-bold" style={NUM}>{c.leads}</td>
                        <td className="px-2" style={NUM}>{c.primeiras}</td>
                        <td className="px-2" style={NUM}>{c.retomadas}</td>
                        <td className="px-2" style={NUM}>{c.fds}</td>
                        <td className="px-2" style={NUM}>{c.autoagendamento}</td>
                        <td className="px-4" style={NUM}>{c.realizadas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {/* ── Dia a dia ────────────────────────────────────────────────── */}
          {dias.length > 0 && (
            <section className="rounded-2xl border bg-white mb-5 overflow-x-auto" style={{ borderColor: LINHA }}>
              <h2 className="px-4 pt-4 pb-2 text-sm font-bold text-gray-900">Dia a dia</h2>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[10.5px] uppercase tracking-wider text-gray-400 text-right">
                    <th className="text-left font-bold px-4 py-2">Dia</th>
                    {colunasSdr.map((c) => <th key={c.id} className="font-bold px-2 py-2">{c.nome.split(" ")[0]}</th>)}
                    <th className="font-bold px-4 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dias.map(([dia, porSdr]) => {
                    const fimDeSemana = /^(sáb|dom)/.test(diaCurto(dia));
                    const tot = [...porSdr.values()].reduce((a, d) => a + v(d), 0);
                    return (
                      <tr key={dia} className="border-t text-right" style={{ borderColor: LINHA, background: fimDeSemana ? "rgba(1,71,255,.04)" : undefined }}>
                        <td className="text-left px-4 py-2 text-gray-700">{diaCurto(dia)}</td>
                        {colunasSdr.map((c) => <td key={c.id} className="px-2" style={NUM}>{v(porSdr.get(c.id))}</td>)}
                        <td className="px-4 font-bold" style={NUM}>{tot}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {/* ── A relação lead a lead ────────────────────────────────────── */}
          <section id="monitor-lista" className="rounded-2xl border bg-white" style={{ borderColor: LINHA }}>
            <div className="px-4 pt-4 pb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Relação dos leads{filtro ? ` — ${filtro.rotulo}` : ""}</h2>
                {!filtro && <p className="text-[12px] text-gray-500">Clique num número da tabela, ou veja todos.</p>}
              </div>
              <div className="flex items-center gap-2">
                {filtro && (
                  <label className="flex items-center gap-1.5 text-[12.5px] text-gray-600">
                    <input type="checkbox" checked={soNovosNaLista} onChange={(e) => setSoNovosNaLista(e.target.checked)} />
                    só novos
                  </label>
                )}
                {!filtro && (
                  <button type="button" onClick={() => abrirLista({ sdr: null, canal: null, soFds: false, rotulo: "Todos" })}
                          className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border bg-white hover:bg-gray-50" style={{ borderColor: LINHA }}>
                    Ver todos
                  </button>
                )}
                {listaVisivel.length > 0 && (
                  <button type="button" onClick={baixarCsv}
                          className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold bg-blue-600 text-white hover:bg-blue-700">
                    Baixar planilha ({listaVisivel.length})
                  </button>
                )}
              </div>
            </div>
            {carregandoLista && <p className="px-4 pb-4 text-[12.5px] text-gray-400">carregando…</p>}
            {filtro && lista && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px] min-w-[860px]">
                  <thead>
                    <tr className="text-[10.5px] uppercase tracking-wider text-gray-400 text-left">
                      <th className="font-bold px-4 py-2">Chegou</th>
                      <th className="font-bold px-2 py-2">Lead</th>
                      <th className="font-bold px-2 py-2">Fonte</th>
                      <th className="font-bold px-2 py-2">Recebeu</th>
                      <th className="font-bold px-2 py-2">Dono hoje</th>
                      <th className="font-bold px-2 py-2">Tipo</th>
                      <th className="font-bold px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaVisivel.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Nenhum lead nesse filtro.</td></tr>
                    )}
                    {listaVisivel.map((l) => (
                      <tr key={l.lead_id} className="border-t hover:bg-gray-50 cursor-pointer" style={{ borderColor: LINHA }}
                          onClick={() => onOpenLead(l.lead_id)}>
                        <td className="px-4 py-2 text-gray-600 whitespace-nowrap" style={NUM}>
                          {new Date(l.chegou_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {l.fim_de_semana && <span className="ml-1 text-[10px] font-bold text-blue-600">FDS</span>}
                        </td>
                        <td className="px-2 py-2 font-semibold text-gray-900">{l.nome ?? "—"}</td>
                        <td className="px-2 py-2 text-gray-600">
                          <span className="text-[10.5px] font-bold uppercase text-gray-400 mr-1">{ROTULO_CANAL[l.canal] ?? l.canal}</span>
                          {l.destino ?? (l.canal === "outros" || l.canal === "sem_fonte" ? l.fonte ?? "" : "")}
                        </td>
                        <td className="px-2 py-2 text-gray-800">{l.recebeu ?? (l.sdr_id ? nomes.get(l.sdr_id) : "Sem dono")}</td>
                        <td className="px-2 py-2 text-gray-500">{l.dono_atual_id === l.sdr_id ? "o mesmo" : l.dono_atual ?? "—"}</td>
                        <td className="px-2 py-2">
                          <span className={`text-[10.5px] font-bold uppercase px-1.5 py-0.5 rounded ${l.retorno ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                            {l.retorno ? "Retorno" : "Novo"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-500">{l.status ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
