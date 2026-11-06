// src/components/sdr/desempenho/DesempenhoSdr.tsx
// -----------------------------------------------------------------------------
// Desempenho SDR (spec 06/11, Fase 4): 3 páginas — 1 · Principal, 2 · Conversão,
// 3 · Operação — lendo UMA resposta do qs_desempenho (0322). Preto e branco
// neutro, um azul de destaque, laranja só pra alerta; segue o tema do QS
// (classe "dark" no <html>).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  ETAPAS_FUNIL, PERIODOS_DESEMPENHO, ROTULO_FONTE, ROTULO_MOTIVO, ROTULO_PRODUTO, ROTULO_TEMP,
  brl, comparecimento, fetchDesempenho, horasTxt, iniciais, intervaloDesempenho, ondeVaza, passagens,
  pctTxt, pontoDeAtencao, produtosReuniao, rotuloPeriodo, taxa, taxaReagendamento, taxaSal, tempoHumano,
  type BlocoDesempenho, type Desempenho, type LinhaSdr, type PeriodoDesempenho,
} from "@/lib/qs/desempenho";
import OperacaoSdr from "./OperacaoSdr";

const CSS = `
.dsp{--bg:#F6F6F7;--card:#FFFFFF;--card2:#F4F4F5;--text:#0A0A0B;--muted:#5B5B63;--border:#E4E4E7;--track:#ECECEF;--ink:#0A0A0B;--accent:#1D4ED8;--warn:#C2410C;--warnBg:#FFF4EC;--cancel:#A1A1AA;--p1:#0A0A0B;--p2:#1D4ED8;--p3:#71717A;--p4:#C4C4CC}
.dark .dsp{--bg:#0A0A0B;--card:#141416;--card2:#1C1C1F;--text:#F4F4F5;--muted:#A1A1AA;--border:#2A2A2E;--track:#26262A;--ink:#F4F4F5;--accent:#60A5FA;--warn:#FB923C;--warnBg:#2A1B10;--cancel:#52525B;--p1:#F4F4F5;--p2:#60A5FA;--p3:#A1A1AA;--p4:#52525B}
.dsp{background:var(--bg);color:var(--text);font-variant-numeric:tabular-nums}
.dsp-card{background:var(--card);border:1px solid var(--border);border-radius:16px}
.dsp-lbl{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.dsp-mut{color:var(--muted)}
.dsp-chip{min-height:40px;padding:0 16px;border-radius:999px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px;font-weight:500}
.dsp-chip[aria-pressed=true]{border-color:var(--ink);background:var(--ink);color:var(--bg);font-weight:600}
.dsp-tab{padding:10px 16px;border-radius:9px;color:var(--muted);font-size:14px;font-weight:500}
.dsp-tab[aria-current=page]{background:var(--ink);color:var(--bg);font-weight:600}
.dsp table th{padding:10px 8px;font-weight:600;text-align:left;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.dsp table td{padding:12px 8px;border-top:1px solid var(--border)}
`;
const COR_PRODUTO: Record<string, string> = { expedicao: "var(--p1)", pacote: "var(--p2)", outros: "var(--p3)", aereo: "var(--p4)" };
type Pagina = "principal" | "conversao" | "operacao";
const n = (v: number) => v.toLocaleString("pt-BR");

export default function DesempenhoSdr({ onIrParaPainel }: { onIrParaPainel?: () => void }) {
  const [pagina, setPagina] = useState<Pagina>("principal");
  const [periodo, setPeriodo] = useState<PeriodoDesempenho>("mes");
  const [sdrSel, setSdrSel] = useState<string>("");
  const [dados, setDados] = useState<Desempenho | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const { de, ate } = intervaloDesempenho(periodo);
      setDados(await fetchDesempenho(de, ate));
    } catch (e) {
      setErro((e as Error)?.message ?? "Não consegui carregar o desempenho.");
    } finally { setCarregando(false); }
  }, [periodo]);
  useEffect(() => { void carregar(); }, [carregar]);

  // SDR (não gestor) vê só a própria linha: já vem filtrada do banco.
  const linhaSel = useMemo(() => {
    if (!dados) return null;
    if (!dados.gestor && dados.sdrs.length === 1) return dados.sdrs[0];
    return dados.sdrs.find((s) => s.sdr_id === sdrSel) ?? null;
  }, [dados, sdrSel]);
  const bloco: BlocoDesempenho | null = dados ? (linhaSel ?? dados.time) : null;

  return (
    <div className="dsp min-h-full">
      <style>{CSS}</style>
      <div className="mx-auto flex max-w-[1360px] flex-col gap-6 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium dsp-mut">QS · Comercial · SDRs</div>
            <h1 className="m-0 text-[26px] font-bold tracking-tight">Desempenho SDR</h1>
          </div>
          <nav aria-label="Páginas do desempenho" className="flex flex-wrap gap-1 rounded-xl p-1" style={{ background: "var(--card2)", border: "1px solid var(--border)" }}>
            {([["principal", "1 · Principal"], ["conversao", "2 · Conversão"], ["operacao", "3 · Operação"]] as [Pagina, string][]).map(([id, rot]) => (
              <button key={id} type="button" className="dsp-tab" aria-current={pagina === id ? "page" : undefined} onClick={() => setPagina(id)}>{rot}</button>
            ))}
          </nav>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {PERIODOS_DESEMPENHO.map((p) => (
              <button key={p.id} type="button" className="dsp-chip" aria-pressed={periodo === p.id} onClick={() => setPeriodo(p.id)}>{p.rotulo}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {dados?.gestor && (
              <label className="flex items-center gap-2 text-[13px] dsp-mut">SDR
                <select value={sdrSel} onChange={(e) => setSdrSel(e.target.value)} className="min-h-[40px] rounded-[10px] px-3 text-sm font-medium"
                  style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)" }}>
                  <option value="">Time todo</option>
                  {dados.sdrs.map((s) => <option key={s.sdr_id} value={s.sdr_id}>{s.nome}</option>)}
                </select>
              </label>
            )}
            <span className="text-[13px] dsp-mut">
              {carregando ? "Atualizando…" : dados ? `Atualizado ${new Date(dados.gerado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}
            </span>
            <button type="button" className="dsp-chip" onClick={() => void carregar()} disabled={carregando}>Atualizar</button>
          </div>
        </div>

        {bloco && bloco.reunioes.inferidas > 0 && (
          <div className="rounded-xl px-4 py-3 text-[13px]" style={{ background: "var(--card2)", border: "1px solid var(--border)" }}>
            <strong>{n(bloco.reunioes.inferidas)} de {n(bloco.reunioes.marcadas)}</strong> reuniões do período são de antes do campo Produto
            e aparecem como <strong>Outros (inferido)</strong>. A divisão por produto fica confiável a partir de 06/11.
          </div>
        )}

        {erro && <div className="dsp-card p-5 text-sm" style={{ color: "var(--warn)" }}>{erro}</div>}
        {!dados && !erro && <div className="dsp-card p-10 text-center text-sm dsp-mut">Carregando…</div>}

        {dados && bloco && pagina === "principal" && (
          <Principal d={dados} b={bloco} linha={linhaSel} periodo={periodo} onSdr={(id) => setSdrSel(id)} onIrParaPainel={onIrParaPainel} />
        )}
        {dados && bloco && pagina === "conversao" && <Conversao d={dados} b={bloco} linha={linhaSel} />}
        {dados && pagina === "operacao" && <OperacaoSdr de={dados.de} ate={dados.ate} sdrId={linhaSel?.sdr_id ?? null} velocidade={dados.velocidade} gestor={dados.gestor} />}
      </div>
    </div>
  );
}

// ── Peças ────────────────────────────────────────────────────────────────────

function Kpi({ rotulo, valor, sub, chip, alerta, children, escuro }: {
  rotulo: string; valor?: ReactNode; sub?: ReactNode; chip?: ReactNode; alerta?: boolean; children?: ReactNode; escuro?: boolean;
}) {
  const st: CSSProperties = escuro ? { background: "var(--ink)", color: "var(--bg)", borderRadius: 16 } : {};
  return (
    <div className={escuro ? "" : "dsp-card"} style={st}>
      <div className="flex min-w-0 flex-col gap-2.5 p-5">
        <div className="dsp-lbl" style={escuro ? { color: "inherit", opacity: 0.75 } : undefined}>{rotulo}</div>
        {valor !== undefined && <div className="text-[34px] font-bold leading-none tracking-tight">{valor}</div>}
        {sub && <div className="text-[13px]" style={{ color: escuro ? "inherit" : "var(--muted)", opacity: escuro ? 0.8 : 1 }}>{sub}</div>}
        {children}
        {chip && (
          <div className="self-start rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={escuro ? { border: "1px solid currentColor" } : alerta ? { background: "var(--warnBg)", color: "var(--warn)" } : { background: "var(--card2)" }}>
            {chip}
          </div>
        )}
      </div>
    </div>
  );
}

function Barra({ partes, altura = 18 }: { partes: { v: number; cor: string; rotulo: string }[]; altura?: number }) {
  const tot = partes.reduce((a, p) => a + p.v, 0);
  if (!tot) return <div style={{ height: altura, borderRadius: 999, background: "var(--track)" }} aria-hidden="true" />;
  return (
    <div className="flex overflow-hidden" style={{ height: altura, borderRadius: 999, gap: 3 }} role="img"
      aria-label={partes.map((p) => `${p.rotulo}: ${p.v}`).join(", ")}>
      {partes.filter((p) => p.v > 0).map((p) => <div key={p.rotulo} style={{ width: `${(p.v / tot) * 100}%`, background: p.cor }} title={`${p.rotulo}: ${p.v}`} />)}
    </div>
  );
}

function Legenda({ cor, rotulo, valor, extra }: { cor?: string; rotulo: string; valor: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[13px] dsp-mut">
        {cor && <span style={{ width: 10, height: 10, borderRadius: 3, background: cor }} />}{rotulo}
      </div>
      <div className="text-[26px] font-bold">{valor}{extra && <span className="text-[14px] font-medium dsp-mut">{extra}</span>}</div>
    </div>
  );
}

function Secao({ titulo, sub, direita, children }: { titulo: string; sub?: ReactNode; direita?: ReactNode; children: ReactNode }) {
  return (
    <section className="dsp-card flex flex-col gap-5 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="m-0 text-[18px] font-semibold">{titulo}</h2>
          {sub && <div className="mt-1 text-[13px] dsp-mut">{sub}</div>}
        </div>
        {direita && <div className="text-[13px] dsp-mut">{direita}</div>}
      </div>
      {children}
    </section>
  );
}

function Trilho({ v, cor = "var(--ink)", altura = 10 }: { v: number | null; cor?: string; altura?: number }) {
  return (
    <div className="overflow-hidden" style={{ height: altura, borderRadius: 999, background: "var(--track)" }} aria-hidden="true">
      <div style={{ width: `${Math.max(0, Math.min(1, v ?? 0)) * 100}%`, height: "100%", background: cor, borderRadius: 999 }} />
    </div>
  );
}

// ── Página 1 · Principal ─────────────────────────────────────────────────────

function Principal({ d, b, linha, periodo, onSdr, onIrParaPainel }: {
  d: Desempenho; b: BlocoDesempenho; linha: LinhaSdr | null; periodo: PeriodoDesempenho;
  onSdr: (id: string) => void; onIrParaPainel?: () => void;
}) {
  const r = b.reunioes;
  const slaNaMeta = taxa(b.funil.sla_na_meta, b.funil.sla_medidos);
  const ativ = taxa(b.atividades.concluidas, b.atividades.programadas);
  const prods = produtosReuniao(b.produtos);
  const somaProd = prods.reduce((a, p) => a + p.marcadas, 0);
  const forcashTotal = r.forcash_reunioes + b.cotacoes.forcash_proprio;
  const mostrarCards = d.gestor && !linha;
  const atrasPorSdr = d.sdrs.filter((s) => s.atividades.atrasadas > 0).sort((a, b2) => b2.atividades.atrasadas - a.atividades.atrasadas);

  return (
    <>
      <section aria-label="Indicadores principais" className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <Kpi rotulo="SLA do 1º contato" valor={tempoHumano(b.funil.sla_mediana_min)}
          sub={`mediana em horas úteis · meta ${tempoHumano(d.meta_sla_min)}`}
          chip={`${pctTxt(slaNaMeta)} dentro da meta`} alerta={slaNaMeta !== null && slaNaMeta < 0.5} />
        <Kpi rotulo="Leads em trabalho" valor={n(b.cadencia.em_trabalho)} sub="em cadência de FUP agora"
          chip={`${n(b.sem_1o_contato)} sem 1º contato`} alerta={b.sem_1o_contato > 0} />
        <div className="dsp-card flex min-w-0 items-center gap-4 p-5">
          <div aria-hidden="true" className="flex h-[76px] w-[76px] flex-none items-center justify-center rounded-full"
            style={{ background: `conic-gradient(var(--ink) 0 ${(ativ ?? 0) * 100}%, var(--track) 0)` }}>
            <div className="flex h-[58px] w-[58px] items-center justify-center rounded-full text-[15px] font-bold" style={{ background: "var(--card)" }}>{pctTxt(ativ)}</div>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="dsp-lbl">Atividades hoje</div>
            <div className="text-[26px] font-bold leading-none">{n(b.atividades.concluidas)}<span className="text-[15px] font-medium dsp-mut"> de {n(b.atividades.programadas)}</span></div>
            <div className="text-[13px] dsp-mut">feitas × programadas</div>
          </div>
        </div>
        <Kpi rotulo={`Reuniões ${rotuloPeriodo(periodo)}`} valor={n(r.marcadas)} sub="marcadas pelos SDRs · lead distinto, remarcação não conta 2×" />
        <Kpi rotulo="Reuniões hoje" valor={n(b.reunioes_hoje)}
          sub={`${n(b.reunioes_hoje_confirmadas)} confirmadas · ${n(b.por_confirmar)} por confirmar até amanhã`}>
          <div className="flex gap-1">
            <div style={{ flex: Math.max(b.reunioes_hoje_confirmadas, 0.001), height: 8, borderRadius: 999, background: "var(--ink)" }} />
            <div style={{ flex: Math.max(b.reunioes_hoje - b.reunioes_hoje_confirmadas, 0.001), height: 8, borderRadius: 999, background: "var(--track)" }} />
          </div>
        </Kpi>
        <Kpi rotulo="Cotações de aéreo" valor={n(b.cotacoes.entregues_hoje)} sub={<>entregues hoje · SLA de entrega {horasTxt(b.cotacoes.sla_mediana_h)}</>}
          chip={`${n(b.cotacoes.aprovadas)} aprovadas ${rotuloPeriodo(periodo)}`} alerta={b.cotacoes.vencidas > 0} />
        <Kpi escuro rotulo="For-cash gerado" valor={brl(forcashTotal)}
          sub={<>Reuniões {brl(r.forcash_reunioes)} · próprio (aéreo) {brl(b.cotacoes.forcash_proprio)}</>}
          chip={r.forcash_sem_valor > 0 ? `${r.forcash_sem_valor} SAL sem valor cadastrado` : undefined} />
      </section>

      <Secao titulo={`O que aconteceu com as ${n(r.marcadas)} reuniões ${rotuloPeriodo(periodo)}`} direita="R.R = reunião realizada">
        <Barra partes={[
          { v: r.rr, cor: "var(--ink)", rotulo: "R.R" }, { v: r.futuras, cor: "var(--accent)", rotulo: "Futuras" },
          { v: r.no_show, cor: "var(--warn)", rotulo: "No-show" }, { v: r.canceladas, cor: "var(--cancel)", rotulo: "Canceladas" },
          { v: r.sem_desfecho, cor: "var(--track)", rotulo: "Sem desfecho" },
        ]} />
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <Legenda cor="var(--ink)" rotulo="R.R realizadas" valor={n(r.rr)} />
          <Legenda cor="var(--accent)" rotulo="Ainda vão acontecer" valor={n(r.futuras)} />
          <Legenda cor="var(--warn)" rotulo="No-show" valor={n(r.no_show)} />
          <Legenda cor="var(--cancel)" rotulo="Canceladas" valor={n(r.canceladas)} />
          {r.sem_desfecho > 0 && <Legenda cor="var(--track)" rotulo="Passou sem desfecho" valor={n(r.sem_desfecho)} />}
          <div className="pl-4" style={{ borderLeft: "1px solid var(--border)" }}><Legenda rotulo="Comparecimento" valor={pctTxt(comparecimento(r))} /></div>
          <Legenda rotulo="Taxa de reagendamento" valor={pctTxt(taxaReagendamento(r))} extra={` · ${n(r.reagendadas)} de ${n(r.marcadas)}`} />
        </div>
      </Secao>

      <Secao titulo="Demanda dos SDRs para os closers, por produto" sub="produto escolhido pelo SDR no Agendou · aéreo não vai pro closer, vira cotação"
        direita={`${n(somaProd)} reuniões marcadas`}>
        <Barra partes={prods.map((p) => ({ v: p.marcadas, cor: COR_PRODUTO[p.produto], rotulo: ROTULO_PRODUTO[p.produto] }))} />
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {prods.map((p) => (
            <div key={p.produto} className="flex flex-col gap-1.5 rounded-xl p-4" style={{ border: "1px solid var(--border)" }}>
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <span style={{ width: 10, height: 10, borderRadius: 3, background: COR_PRODUTO[p.produto] }} />{ROTULO_PRODUTO[p.produto]}
                {p.inferidas > 0 && <span className="text-[11px] font-normal dsp-mut">({n(p.inferidas)} inferidas)</span>}
              </div>
              <div className="text-[28px] font-bold leading-tight">{n(p.marcadas)}<span className="text-[14px] font-medium dsp-mut"> · {pctTxt(taxa(p.marcadas, somaProd))}</span></div>
              <div className="text-[13px] dsp-mut">{n(p.rr)} R.R · {n(p.sal_aceito)} SAL · for-cash {brl(p.forcash)}</div>
            </div>
          ))}
          <div className="flex flex-col gap-1.5 rounded-xl p-4" style={{ background: "var(--card2)" }}>
            <div className="text-[13px] font-semibold">Cotações de aéreo</div>
            <div className="text-[28px] font-bold leading-tight">{n(b.cotacoes.entregues)}<span className="text-[14px] font-medium dsp-mut"> entregues</span></div>
            <div className="text-[13px] dsp-mut">{n(b.cotacoes.aprovadas)} aprovadas · {n(b.cotacoes.repassadas)} repassadas ao closer</div>
          </div>
        </div>
      </Secao>

      {mostrarCards && (
        <section aria-label="Desempenho por SDR" className="flex flex-col gap-3">
          <h2 className="m-0 text-[18px] font-semibold">Por SDR</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            {d.sdrs.map((s) => <CardSdr key={s.sdr_id} s={s} d={d} periodo={periodo} onAbrir={() => onSdr(s.sdr_id)} />)}
          </div>
        </section>
      )}

      <Secao titulo="Precisa de ação hoje">
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <Acao n={b.atividades.atrasadas} alerta titulo="Atividades atrasadas"
            sub={mostrarCards ? atrasPorSdr.map((s) => `${s.nome.split(" ")[0]} ${n(s.atividades.atrasadas)}`).join(" · ") : `${n(b.cadencia.leads_atrasados)} leads · a mais antiga parada há ${b.cadencia.mais_antiga_dias} dias`}
            onClick={onIrParaPainel} />
          <Acao n={b.sem_1o_contato} alerta titulo="Leads sem 1º contato" sub="chegaram nos últimos 30 dias · live primeiro, depois quentes" />
          <Acao n={b.por_confirmar} titulo="Reuniões por confirmar" sub="hoje e amanhã · confirmar na véspera reduz no-show" />
          <Acao n={b.desfechos_pendentes} titulo="Desfechos pendentes dos closers" sub="sem desfecho a R.R não entra na conta do SDR" />
          <Acao n={b.cotacoes.vencidas} alerta titulo="Cotações vencidas sem resposta" sub="o responsável já ganhou uma atividade de FUP" />
        </div>
      </Secao>
    </>
  );
}

function Acao({ n: v, titulo, sub, alerta, onClick }: { n: number; titulo: string; sub: string; alerta?: boolean; onClick?: () => void }) {
  const corpo = (
    <>
      <div className="text-[26px] font-bold" style={{ color: alerta && v > 0 ? "var(--warn)" : undefined }}>{n(v)}</div>
      <div className="text-[14px] font-semibold">{titulo}</div>
      <div className="text-[13px] dsp-mut">{sub}</div>
    </>
  );
  const cls = "flex flex-col gap-1 rounded-xl p-4 text-left";
  const st = { border: "1px solid var(--border)" };
  return onClick ? <button type="button" className={cls} style={st} onClick={onClick}>{corpo}</button> : <div className={cls} style={st}>{corpo}</div>;
}

function CardSdr({ s, d, periodo, onAbrir }: { s: LinhaSdr; d: Desempenho; periodo: PeriodoDesempenho; onAbrir: () => void }) {
  const r = s.reunioes;
  const prods = produtosReuniao(s.produtos);
  const ativ = taxa(s.atividades.concluidas, s.atividades.programadas);
  return (
    <article className="dsp-card flex min-w-0 flex-col gap-4 p-5">
      <button type="button" onClick={onAbrir} className="flex items-center gap-3 text-left" title="Ver só este SDR">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-[14px] font-bold" style={{ background: "var(--ink)", color: "var(--bg)" }}>{iniciais(s.nome)}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-semibold">{s.nome}</div>
          <div className="text-[13px] dsp-mut">{pctTxt(taxa(s.funil.marcou, s.funil.recebeu), 1)} dos leads viraram reunião</div>
        </div>
      </button>
      <div className="grid grid-cols-3 gap-2">
        <MiniBox rotulo={`Reuniões ${rotuloPeriodo(periodo).replace("do ", "").replace("da ", "").replace("de ", "")}`} valor={n(r.marcadas)} />
        <MiniBox rotulo="Reuniões hoje" valor={n(s.reunioes_hoje)} />
        <MiniBox rotulo="For-cash" valor={brl(r.forcash_reunioes + s.cotacoes.forcash_proprio)} pequeno />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap justify-between gap-1 text-[13px] dsp-mut">
          <span>Reuniões por produto</span>
          <span>+ {n(s.cotacoes.entregues)} cotações entregues · {n(s.cotacoes.aprovadas)} aprovadas</span>
        </div>
        <Barra altura={10} partes={prods.map((p) => ({ v: p.marcadas, cor: COR_PRODUTO[p.produto], rotulo: ROTULO_PRODUTO[p.produto] }))} />
        <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12px] dsp-mut">
          {prods.map((p) => (
            <span key={p.produto} className="flex items-center gap-1.5">
              <span style={{ width: 8, height: 8, borderRadius: 2, background: COR_PRODUTO[p.produto] }} />{ROTULO_PRODUTO[p.produto]} <strong style={{ color: "var(--text)" }}>{p.marcadas}</strong>
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-[13px]"><span className="dsp-mut">Atividades de hoje</span><span className="font-semibold">{n(s.atividades.concluidas)} de {n(s.atividades.programadas)}</span></div>
        <Trilho v={ativ} />
      </div>
      <div className="grid grid-cols-4 gap-2 text-center">
        {[["R.R", r.rr], ["No-show", r.no_show], ["Reagend.", r.reagendadas], ["SAL", r.sal_aceito]].map(([rot, v]) => (
          <div key={rot as string} className="rounded-[10px] px-1 py-2.5" style={{ border: "1px solid var(--border)" }}>
            <div className="text-[20px] font-bold">{n(v as number)}</div><div className="text-[12px] dsp-mut">{rot}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-3 text-[13px]" style={{ borderTop: "1px solid var(--border)" }}>
        <span className="dsp-mut">SLA do 1º contato (mediana)</span><span className="text-[15px] font-bold">{tempoHumano(s.funil.sla_mediana_min)}</span>
      </div>
      <div className="rounded-[10px] px-3.5 py-3 text-[13px] leading-snug" style={{ background: "var(--warnBg)" }}>
        <strong style={{ color: "var(--warn)" }}>Atenção</strong> · {pontoDeAtencao(s, d.time, d.sdrs.length)}
      </div>
    </article>
  );
}

function MiniBox({ rotulo, valor, pequeno }: { rotulo: string; valor: ReactNode; pequeno?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl p-3" style={{ background: "var(--card2)" }}>
      <div className="truncate text-[12px] dsp-mut">{rotulo}</div>
      <div className={`${pequeno ? "text-[17px]" : "text-[24px]"} truncate font-bold`}>{valor}</div>
    </div>
  );
}

// ── Página 2 · Conversão ─────────────────────────────────────────────────────

function Conversao({ d, b, linha }: { d: Desempenho; b: BlocoDesempenho; linha: LinhaSdr | null }) {
  const funis = linha ? [linha] : d.sdrs;
  const passT = passagens(d.time.funil);
  const conv = (c: Record<string, { leads: number; marcou: number }>, rot: Record<string, string>) => {
    const rows = Object.entries(c).map(([k, v]) => ({ k, nome: rot[k] ?? k, leads: v.leads, t: taxa(v.marcou, v.leads) })).filter((x) => x.leads > 0);
    rows.sort((a, b2) => (b2.t ?? 0) - (a.t ?? 0));
    const max = Math.max(...rows.map((x) => x.t ?? 0), 0.0001);
    return { rows, max };
  };
  const fontes = conv(b.fontes, ROTULO_FONTE);
  const temps = conv(b.temperaturas, ROTULO_TEMP);
  const faixas = b.cadencia.faixas;
  const maxFaixa = Math.max(...faixas.map((f) => f.em_dia + f.atrasadas), 1);
  const prods = produtosReuniao(b.produtos);
  const c = b.cotacoes;

  return (
    <>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="m-0 text-[18px] font-semibold">Funil por SDR</h2>
            <div className="mt-1 text-[13px] dsp-mut">dos leads que chegaram no período (coorte) — por isso "marcou" pode diferir das reuniões marcadas no período</div>
          </div>
          <div className="flex items-center gap-2 text-[13px] dsp-mut"><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--warn)" }} />etapa onde mais vaza contra a média do time</div>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {funis.map((s) => {
            const vaza = ondeVaza(s.funil, d.time.funil);
            const pass = passagens(s.funil);
            return (
              <article key={s.sdr_id} className="dsp-card flex min-w-0 flex-col gap-3.5 p-5">
                <div className="flex items-baseline justify-between">
                  <div className="text-[17px] font-semibold">{s.nome}</div>
                  <div className="text-[13px] dsp-mut"><strong style={{ color: "var(--text)" }}>{pctTxt(taxa(s.funil.marcou, s.funil.recebeu), 1)}</strong> viraram reunião</div>
                </div>
                {ETAPAS_FUNIL.map((e, i) => {
                  const v = s.funil[e.id];
                  const cor = i === vaza ? "var(--warn)" : "var(--ink)";
                  return (
                    <div key={e.id} className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-[13px]">
                        <span className="dsp-mut">{e.rotulo}</span>
                        <span><strong style={{ color: cor }}>{n(v)}</strong> <span className="dsp-mut">· {pctTxt(pass[i])}{i > 0 ? ` · time ${pctTxt(passT[i])}` : ""}</span></span>
                      </div>
                      <div className="flex justify-center rounded-md" style={{ height: 22, background: "var(--card2)" }}>
                        <div className="rounded-md" style={{ width: `${Math.max(4, s.funil.recebeu ? (v / s.funil.recebeu) * 100 : 0)}%`, background: cor }} />
                      </div>
                    </div>
                  );
                })}
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))" }}>
        <Secao titulo="Conversão por fonte" sub="% dos leads que viraram reunião">
          {fontes.rows.map((x, i) => <LinhaConv key={x.k} nome={x.nome} leads={x.leads} t={x.t} max={fontes.max} cor={i === 0 ? "var(--accent)" : "var(--ink)"} />)}
          {fontes.rows.length === 0 && <p className="text-sm dsp-mut">Nenhum lead no período.</p>}
        </Secao>
        <Secao titulo="Conversão por temperatura" sub="% dos leads que viraram reunião">
          {temps.rows.map((x) => <LinhaConv key={x.k} nome={x.nome} leads={x.leads} t={x.t} max={temps.max} cor="var(--ink)" />)}
          {d.gestor && !linha && d.sdrs.length > 0 && (
            <>
              <div className="grid gap-2 pt-3" style={{ gridTemplateColumns: `repeat(${Math.min(d.sdrs.length, 4)}, minmax(0, 1fr))`, borderTop: "1px solid var(--border)" }}>
                {d.sdrs.map((s) => (
                  <div key={s.sdr_id} className="rounded-xl p-3" style={{ background: "var(--card2)" }}>
                    <div className="truncate text-[12px] dsp-mut">{s.nome.split(" ")[0]} recebeu</div>
                    <div className="text-[22px] font-bold">{n(s.funil.recebeu)}</div>
                  </div>
                ))}
              </div>
              <div className="text-[13px] dsp-mut">{textoRodizio(d.sdrs.map((s) => s.funil.recebeu))}</div>
            </>
          )}
        </Secao>
      </div>

      <Secao titulo="Funil por produto" sub="rota reunião: do Agendou do SDR até o aceite do closer">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[14px]">
            <thead><tr><th>Produto</th><th>Marcadas</th><th>R.R</th><th>No-show</th><th>SAL aceito</th><th>SAL recusado</th><th style={{ width: "26%" }}>Marcada vira SAL</th><th>For-cash</th></tr></thead>
            <tbody>
              {prods.map((p) => {
                const t = taxa(p.sal_aceito, p.marcadas);
                return (
                  <tr key={p.produto}>
                    <td className="font-semibold"><span className="inline-flex items-center gap-2"><span style={{ width: 10, height: 10, borderRadius: 3, background: COR_PRODUTO[p.produto] }} />{ROTULO_PRODUTO[p.produto]}{p.inferidas > 0 && <span className="text-[11px] font-normal dsp-mut">({n(p.inferidas)} inferidas)</span>}</span></td>
                    <td>{n(p.marcadas)}</td><td>{n(p.rr)}</td><td>{n(p.no_show)}</td><td>{n(p.sal_aceito)}</td><td>{n(p.sal_recusado)}</td>
                    <td><div className="flex items-center gap-2.5"><div className="flex-1"><Trilho v={t} /></div><strong>{pctTxt(t)}</strong></div></td>
                    <td className={p.forcash > 0 ? "" : "dsp-mut"}>{brl(p.forcash)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Secao>

      <Secao titulo="Funil de cotação (aéreo)" sub="solicitadas → entregues → aprovadas no período">
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <MiniBox rotulo="Solicitadas" valor={n(c.solicitadas)} />
          <MiniBox rotulo="Entregues" valor={n(c.entregues)} />
          <MiniBox rotulo="Aprovadas" valor={n(c.aprovadas)} />
          <MiniBox rotulo="Taxa de aprovação" valor={pctTxt(taxa(c.aprovadas, c.entregues))} />
          <MiniBox rotulo="SLA de entrega (mediana · p90)" valor={`${horasTxt(c.sla_mediana_h)} · ${horasTxt(c.sla_p90_h)}`} pequeno />
          <MiniBox rotulo="For-cash próprio · repassado" valor={`${brl(c.forcash_proprio)} · ${brl(c.forcash_repassado)}`} pequeno />
        </div>
        <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))" }}>
          <div className="flex flex-col gap-2">
            <div className="text-[13px] font-semibold">Motivos de perda</div>
            {d.cotacoes_perda.length === 0 && <p className="text-[13px] dsp-mut">Nenhuma cotação perdida no período.</p>}
            {d.cotacoes_perda.map((p) => (
              <div key={p.motivo} className="grid items-center gap-3" style={{ gridTemplateColumns: "120px 1fr 40px" }}>
                <span className="text-[13px]">{ROTULO_MOTIVO[p.motivo] ?? p.motivo}</span>
                <Trilho v={taxa(p.n, Math.max(...d.cotacoes_perda.map((x) => x.n)))} cor="var(--warn)" />
                <strong className="text-right text-[13px]">{p.n}</strong>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-[13px] font-semibold">Repasse ao closer</div>
            {(linha ? [linha] : d.sdrs).filter((s) => s.cotacoes.solicitadas > 0).map((s) => (
              <div key={s.sdr_id} className="flex justify-between text-[13px]"><span>{s.nome}</span><span className="dsp-mut">{n(s.cotacoes.repassadas)} de {n(s.cotacoes.solicitadas)} repassadas</span></div>
            ))}
            {d.cotacoes_closers.map((x) => (
              <div key={x.nome} className="flex justify-between text-[13px]"><span>→ {x.nome}</span><span className="dsp-mut">{n(x.recebidas)} recebidas · {n(x.aprovadas)} aprovadas · {brl(x.valor)}</span></div>
            ))}
            {c.solicitadas === 0 && <p className="text-[13px] dsp-mut">Nenhuma cotação solicitada no período.</p>}
          </div>
        </div>
      </Secao>

      <Secao titulo="Saúde da cadência" direita={
        <span className="flex gap-4">
          <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--ink)" }} />em dia</span>
          <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--warn)" }} />atrasada</span>
        </span>}>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          <MiniBox rotulo="Na fila" valor={n(b.cadencia.em_trabalho)} />
          <div className="rounded-xl p-3" style={{ background: "var(--warnBg)" }}>
            <div className="text-[12px]" style={{ color: "var(--warn)" }}>Leads atrasados</div>
            <div className="text-[24px] font-bold" style={{ color: "var(--warn)" }}>{n(b.cadencia.leads_atrasados)}</div>
          </div>
          <MiniBox rotulo="Fim de cadência sem desfecho" valor={n(b.fim_cadencia)} />
          <MiniBox rotulo="Atividade mais parada" valor={`${b.cadencia.mais_antiga_dias} dias`} />
        </div>
        <div className="flex flex-col gap-3">
          {faixas.map((f) => {
            const tot = f.em_dia + f.atrasadas;
            return (
              <div key={f.faixa} className="grid items-center gap-3" style={{ gridTemplateColumns: "90px minmax(0,1fr) 150px" }}>
                <div className="text-[14px] font-semibold">{f.faixa}</div>
                <div className="overflow-hidden rounded-md" style={{ height: 22, background: "var(--card2)" }}>
                  <div className="flex h-full" style={{ width: `${Math.max(2, (tot / maxFaixa) * 100)}%` }}>
                    <div style={{ width: `${tot ? (f.em_dia / tot) * 100 : 0}%`, background: "var(--ink)" }} />
                    <div style={{ width: `${tot ? (f.atrasadas / tot) * 100 : 0}%`, background: "var(--warn)" }} />
                  </div>
                </div>
                <div className="text-right text-[13px]"><strong>{n(tot)}</strong> <span style={{ color: "var(--warn)" }}>· {n(f.atrasadas)} atrasadas</span></div>
              </div>
            );
          })}
        </div>
      </Secao>

      <Secao titulo="Desfecho no closer" sub="das reuniões realizadas, quantas o closer aceitou (SAL)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[14px]">
            <thead><tr><th>SDR</th><th>R.R</th><th>SAL aceito</th><th>Recusado</th><th style={{ width: "40%" }}>Taxa de SAL</th></tr></thead>
            <tbody>
              {(linha ? [linha] : d.sdrs).map((s) => {
                const t = taxaSal(s.reunioes);
                return (
                  <tr key={s.sdr_id}>
                    <td className="font-semibold">{s.nome}</td><td>{n(s.reunioes.rr)}</td><td>{n(s.reunioes.sal_aceito)}</td><td>{n(s.reunioes.sal_recusado)}</td>
                    <td><div className="flex items-center gap-2.5"><div className="flex-1"><Trilho v={t} /></div><strong>{pctTxt(t)}</strong></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {d.closers_pendentes.length > 0 && (
          <div className="pt-3 text-[13px] dsp-mut" style={{ borderTop: "1px solid var(--border)" }}>
            Desfechos pendentes: {d.closers_pendentes.map((x) => `${x.nome} ${x.pendentes}`).join(" · ")}
          </div>
        )}
      </Secao>
    </>
  );
}

function LinhaConv({ nome, leads, t, max, cor }: { nome: string; leads: number; t: number | null; max: number; cor: string }) {
  return (
    <div className="grid items-center gap-3" style={{ gridTemplateColumns: "120px minmax(0,1fr) 56px" }}>
      <div className="text-[14px] font-medium">{nome}<div className="text-[12px] font-normal dsp-mut">{n(leads)} leads</div></div>
      <Trilho v={(t ?? 0) / max} cor={cor} altura={14} />
      <div className="text-right text-[15px] font-bold">{pctTxt(t)}</div>
    </div>
  );
}

function textoRodizio(ns: number[]): string {
  if (ns.length < 2) return "";
  const min = Math.min(...ns), max = Math.max(...ns);
  if (max === 0) return "Nenhum lead novo no período.";
  const desvio = (max - min) / max;
  return desvio <= 0.15
    ? `Rodízio justo: de ${n(min)} a ${n(max)} leads por SDR. A diferença vem do que acontece depois.`
    : `Rodízio desigual: de ${n(min)} a ${n(max)} leads por SDR (${pctTxt(desvio)} de diferença). Vale olhar a distribuição.`;
}
