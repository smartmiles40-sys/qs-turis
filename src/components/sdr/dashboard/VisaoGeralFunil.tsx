// src/components/sdr/dashboard/VisaoGeralFunil.tsx
// -----------------------------------------------------------------------------
// DESEMPENHO → VISÃO GERAL, versão funil (Bruno, 28/09/2026; protótipo aprovado).
//
// Uma pergunta por tela, respondida de relance:
//   gestor → "onde cada SDR perde o lead?" (um funil por pessoa, a etapa mais
//            abaixo do time em laranja, com a frase do porquê);
//   SDR    → "como estou em relação ao time, e o que faço hoje?".
//
// Cor: azul do QS pro que está normal; laranja SÓ onde vaza. Toda conta vem de
// qs_funil_sdr (0095) — a tela não recalcula nada a partir de listas.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  diagnostico, etapas, fetchFunil, fmtPct, intervaloFunil, PERIODOS_FUNIL, taxas, tempoHumano,
  type Funil, type LinhaFunil, type PeriodoFunil,
} from "@/lib/qs/funil";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  Kpi, MetaDoMes, FunilDegraus, EvolucaoDiaria, RankingReunioes, LigacoesGravadas, useExtrasDesempenho, salDoPeriodo,
  type Extras,
} from "./DesempenhoExtras";

const AZUL = "#0147FF";
const LARANJA = "#F5821F";
const LARANJA_TXT = "#C2410C";
const LINHA = "var(--line, #E8EBF0)";
const NUM = { fontVariantNumeric: "tabular-nums" as const };

interface Props {
  /** SDR: o botão "Abrir o Painel" do card Hoje. */
  onIrParaPainel?: () => void;
}

function primeiroNome(n?: string) {
  return (n ?? "").split(" ")[0] || "—";
}

function dataBR(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function Rotulo({ children }: { children: ReactNode }) {
  return <div className="text-[11.5px] font-bold uppercase tracking-wider text-gray-500">{children}</div>;
}

function Cartao({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border p-5 ${className}`} style={{ borderColor: LINHA }}>
      {children}
    </div>
  );
}

/** Barra de reuniões: aconteceu / no-show / cancelada / ainda vai acontecer. */
function BarraReunioes({ l }: { l: LinhaFunil }) {
  const tot = Math.max(1, l.marcou);
  const partes = [
    { v: l.aconteceu, cor: AZUL, rot: "aconteceram", txt: AZUL },
    { v: l.noshow, cor: LARANJA, rot: "no-show", txt: LARANJA_TXT },
    { v: l.cancelou, cor: "#FDBA74", rot: "canceladas", txt: "#9A4A06" },
    { v: l.futura, cor: "#CBD5E1", rot: "ainda vão acontecer", txt: "#475569" },
  ];
  return (
    <div className="flex flex-col gap-2">
      <Rotulo>Reuniões marcadas ({l.marcou})</Rotulo>
      <div className="flex h-3.5 rounded-full overflow-hidden" style={{ background: "#EEF0F4" }}>
        {partes.map((p) => <div key={p.rot} style={{ width: `${(p.v / tot) * 100}%`, background: p.cor }} />)}
      </div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-gray-600">
        {partes.map((p) => (
          <span key={p.rot}><b style={{ color: p.txt, ...NUM }}>{p.v}</b> {p.rot}</span>
        ))}
      </div>
    </div>
  );
}

/** Temperatura e fonte: quantos recebeu e quanto virou reunião. */
function Origem({ l }: { l: LinhaFunil }) {
  const linha = (rot: string, p: { n: number; marcou: number }) => (
    <div key={rot} className="flex justify-between text-[13.5px]" style={NUM}>
      <span className="text-gray-700">{rot} <span className="text-gray-400">{p.n}</span></span>
      <span className="font-bold text-gray-900">{p.n ? fmtPct((p.marcou / p.n) * 100) : "—"}</span>
    </div>
  );
  return (
    <div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Rotulo>Temperatura</Rotulo>
          {linha("Quente", l.temperatura.quente)}
          {linha("Morno", l.temperatura.morno)}
          {linha("Frio", l.temperatura.frio)}
        </div>
        <div className="flex flex-col gap-1.5">
          <Rotulo>Fonte</Rotulo>
          {linha("Tráfego", l.fontes.trafego)}
          {linha("Live", l.fontes.live)}
          {linha("Orgânico", l.fontes.organico)}
          {linha("Outros", l.fontes.outros)}
        </div>
      </div>
      <p className="text-[12px] text-gray-400 mt-1.5">% = quantos viraram reunião</p>
    </div>
  );
}

function CardSdr({ l, time }: { l: LinhaFunil; time: LinhaFunil | null }) {
  const d = diagnostico(l, time);
  const passos = etapas(l, time);
  const fim = l.recebidos ? (l.aconteceu / l.recebidos) * 100 : null;
  const ate5 = l.medidos_1o ? (l.ate5min / l.medidos_1o) * 100 : null;
  return (
    <Cartao className="flex flex-col gap-5">
      <div className="flex justify-between items-baseline gap-2">
        <div className="text-[19px] font-extrabold text-gray-900 truncate">{l.nome}</div>
        <div className="text-[13.5px] text-gray-600 shrink-0"><b className="text-gray-900" style={NUM}>{fmtPct(fim, 1)}</b> viraram reunião</div>
      </div>

      {d.pior ? (
        <div className="rounded-xl px-4 py-3" style={{ background: "#FFF4EA" }}>
          <div className="text-[11.5px] font-extrabold uppercase tracking-wider" style={{ color: "#9A4A06" }}>Vaza em: {d.vaza}</div>
          <div className="text-[14px] leading-snug mt-1" style={{ color: "#3B2410" }}>{d.frase}</div>
        </div>
      ) : (
        <div className="rounded-xl px-4 py-3 bg-emerald-50 text-[14px] text-emerald-800">{d.frase}</div>
      )}

      <div className="flex flex-col gap-2.5">
        {passos.map((p) => {
          const ruim = p.id === d.pior;
          return (
            <div key={p.id} className="flex flex-col gap-1">
              <div className="flex justify-between text-[13.5px]">
                <span className="font-semibold text-gray-700">{p.rotulo}</span>
                <span style={NUM} className="text-gray-600">
                  <b className="text-gray-900">{p.n}</b>
                  {p.taxa !== null && <b className="ml-1.5" style={{ color: ruim ? LARANJA_TXT : "#0F172A" }}>{fmtPct(p.taxa)}</b>}
                  {p.taxaTime !== null && <span className="ml-1.5 text-gray-400">time {fmtPct(p.taxaTime)}</span>}
                </span>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "#EEF0F4" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, (p.n / Math.max(1, l.recebidos)) * 100)}%`, background: ruim ? LARANJA : AZUL }} />
              </div>
            </div>
          );
        })}
      </div>

      <BarraReunioes l={l} />
      <Origem l={l} />

      <div className="grid grid-cols-4 gap-3 pt-4 border-t" style={{ borderColor: LINHA }}>
        {[
          { v: l.tent_media === null ? "—" : Number(l.tent_media).toFixed(1).replace(".", ","), r: "tentativas por lead", alerta: false },
          { v: String(l.em_fup), r: "ainda em FUP", alerta: false },
          { v: fmtPct(ate5), r: "1º contato em até 5 min", alerta: false },
          { v: String(l.atrasadas ?? 0), r: "atividades atrasadas", alerta: (l.atrasadas ?? 0) > 0 },
        ].map((x) => (
          <div key={x.r} className="flex flex-col gap-0.5 min-w-0">
            <div className="text-[21px] font-extrabold" style={{ ...NUM, color: x.alerta ? LARANJA_TXT : "#0F172A" }}>{x.v}</div>
            <div className="text-[12px] text-gray-500 leading-tight">{x.r}</div>
          </div>
        ))}
      </div>
    </Cartao>
  );
}

/** Velocidade do 1º contato × reunião: por que o relógio do Painel existe. */
function Velocidade({ f }: { f: Funil }) {
  const faixas = f.velocidade.filter((v) => v.faixa !== "sem contato");
  const max = Math.max(1, ...faixas.map((v) => (v.leads ? v.marcou / v.leads : 0)));
  const t = f.time;
  return (
    <Cartao className="flex flex-col gap-4">
      <div>
        <h2 className="m-0 text-[17px] font-extrabold text-gray-900">Velocidade do 1º contato</h2>
        <p className="text-[13px] text-gray-500 mt-0.5">Leads novos, em horas úteis. Quanto antes o primeiro contato, mais reunião.</p>
      </div>
      <div className="flex flex-col gap-2.5">
        {faixas.map((v) => {
          const taxa = v.leads ? (v.marcou / v.leads) * 100 : 0;
          return (
            <div key={v.faixa} className="grid items-center gap-3" style={{ gridTemplateColumns: "96px minmax(0,1fr) 92px" }}>
              <span className="text-[13.5px] font-semibold text-gray-700">{v.faixa}</span>
              <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "#EEF0F4" }}>
                <div className="h-full rounded-full" style={{ width: `${(taxa / 100 / max) * 100}%`, background: AZUL }} />
              </div>
              <span className="text-right text-[13.5px]" style={NUM}><b>{fmtPct(taxa)}</b> <span className="text-gray-400">{v.leads}</span></span>
            </div>
          );
        })}
      </div>
      {t && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 pt-3 border-t text-[13.5px] text-gray-600" style={{ borderColor: LINHA }}>
          <span>Metade dos leads recebe o 1º contato em <b className="text-gray-900">{tempoHumano(t.mediana_1o_min)}</b></span>
          {f.sdrs.map((s) => (
            <span key={s.sdr_id}>{primeiroNome(s.nome)} <b className="text-gray-900">{tempoHumano(s.mediana_1o_min)}</b></span>
          ))}
        </div>
      )}
    </Cartao>
  );
}

function Atencao({ f }: { f: Funil }) {
  const itens: { n: number; titulo: string; sub: string }[] = [];
  for (const s of f.sdrs) {
    if ((s.atrasadas ?? 0) > 0) itens.push({ n: s.atrasadas!, titulo: `Atividades atrasadas — ${primeiroNome(s.nome)}`, sub: "Vencidas antes de hoje, ainda abertas." });
  }
  const pior = [...f.sdrs].sort((a, b) => b.cancelou + b.noshow - (a.cancelou + a.noshow))[0];
  if (pior && pior.cancelou + pior.noshow > 0) {
    itens.push({ n: pior.cancelou + pior.noshow, titulo: `Reuniões perdidas — ${primeiroNome(pior.nome)}`, sub: `${pior.cancelou} canceladas e ${pior.noshow} no-show. Vale confirmar na véspera.` });
  }
  const closers = f.closers.filter((c) => c.desfechos_atrasados > 0);
  const totC = closers.reduce((a, c) => a + c.desfechos_atrasados, 0);
  if (totC > 0) {
    itens.push({ n: totC, titulo: "Desfechos atrasados dos closers", sub: closers.map((c) => `${primeiroNome(c.nome)} ${c.desfechos_atrasados}`).join(" · ") + " — sem desfecho a reunião não entra no funil." });
  }
  if (f.time && f.time.futura > 0) {
    itens.push({ n: f.time.futura, titulo: "Reuniões ainda por acontecer", sub: "Confirmar presença reduz no-show." });
  }
  return (
    <Cartao className="flex flex-col gap-3.5">
      <h2 className="m-0 text-[17px] font-extrabold text-gray-900">Precisa de atenção agora</h2>
      {itens.length === 0 && <p className="text-[14px] text-gray-500">Nada pendente.</p>}
      {itens.map((a) => (
        <div key={a.titulo} className="flex gap-3.5 items-start">
          <div className="min-w-[52px] text-[21px] font-extrabold" style={{ ...NUM, color: LARANJA_TXT }}>{a.n}</div>
          <div>
            <div className="text-[14.5px] font-bold text-gray-900">{a.titulo}</div>
            <div className="text-[13.5px] text-gray-500">{a.sub}</div>
          </div>
        </div>
      ))}
    </Cartao>
  );
}

/** Três leituras do período, escritas a partir dos números. */
function Leituras({ f }: { f: Funil }) {
  const t = f.time;
  if (!t) return null;
  const out: { titulo: string; texto: string }[] = [];
  if (f.sdrs.length > 1) {
    const rec = f.sdrs.map((s) => s.novos);
    const min = Math.min(...rec), max = Math.max(...rec);
    const media = rec.reduce((a, b) => a + b, 0) / rec.length;
    const justo = media > 0 && (max - min) / media <= 0.1;
    out.push({
      titulo: justo ? "A distribuição está justa" : "A distribuição está desigual",
      texto: `Leads novos por SDR: entre ${min} e ${max}.${justo ? " A diferença de resultado vem do que acontece depois." : " Confira o Monitor de leads."}`,
    });
  }
  const taxaF = (p: { n: number; marcou: number }) => (p.n ? (p.marcou / p.n) * 100 : 0);
  const canais = [
    { r: "Live", v: taxaF(t.fontes.live), n: t.fontes.live.n },
    { r: "Orgânico", v: taxaF(t.fontes.organico), n: t.fontes.organico.n },
    { r: "Tráfego", v: taxaF(t.fontes.trafego), n: t.fontes.trafego.n },
  ].filter((c) => c.n >= 10).sort((a, b) => b.v - a.v);
  if (canais.length >= 2) {
    const melhor = canais[0];
    const pior = canais[canais.length - 1];
    const x = pior.v > 0 ? melhor.v / pior.v : null;
    out.push({
      titulo: `${melhor.r} é a fonte que mais vira reunião`,
      texto: `${melhor.r}: ${fmtPct(melhor.v)} viram reunião. ${pior.r}: ${fmtPct(pior.v)}${x && x >= 1.5 ? ` (${x.toFixed(1).replace(".", ",")}× menos)` : ""}. O lead de ${melhor.r.toLowerCase()} merece a primeira ligação do dia.`,
    });
  }
  const q = taxaF(t.temperatura.quente), fr = taxaF(t.temperatura.frio);
  if (t.temperatura.quente.n >= 5) {
    const partFrio = t.recebidos ? Math.round((t.temperatura.frio.n / t.recebidos) * 100) : 0;
    out.push({ titulo: "Quente vira reunião; frio quase não", texto: `Quentes: ${fmtPct(q)} viram reunião. Frios: ${fmtPct(fr)} — e são ${partFrio}% dos leads.` });
  }
  return (
    <Cartao className="flex flex-col gap-3">
      <h2 className="m-0 text-[17px] font-extrabold text-gray-900">O que o funil diz</h2>
      {out.map((l) => (
        <div key={l.titulo} className="pb-3 border-b last:border-b-0 last:pb-0" style={{ borderColor: LINHA }}>
          <div className="text-[14.5px] font-bold text-gray-900">{l.titulo}</div>
          <div className="text-[13.5px] leading-relaxed text-gray-600">{l.texto}</div>
        </div>
      ))}
    </Cartao>
  );
}

function VisaoGestor({ f, filtroSdr, extras, de, ate }: { f: Funil; filtroSdr: string; extras: Extras | null; de: string; ate: string }) {
  const t = f.time;
  const tx = t ? taxas(t) : null;
  const sdrs = filtroSdr ? f.sdrs.filter((s) => s.sdr_id === filtroSdr) : f.sdrs;
  return (
    <>
      {t && tx && (
        <div className="grid grid-cols-2 md:grid-cols-5 bg-white rounded-2xl border overflow-hidden" style={{ borderColor: LINHA }}>
          {[
            { r: "Recebeu", v: t.recebidos, s: `${t.novos} novos · ${t.retornos} retornos` },
            { r: "Falou", v: t.falou, s: `${fmtPct(tx.falou)} dos trabalhados` },
            { r: "Marcou", v: t.marcou, s: `${fmtPct(tx.marcou)} das conversas` },
            { r: "Aconteceu", v: t.aconteceu, s: `${fmtPct(tx.aconteceu)} das que já tiveram data` },
            { r: "Perdeu", v: t.noshow + t.cancelou, s: `${t.noshow} no-show · ${t.cancelou} canceladas`, alerta: true },
          ].map((x) => (
            <div key={x.r} className="px-5 py-4 flex flex-col gap-1 border-r border-b md:border-b-0" style={{ borderColor: "#EEF0F4" }}>
              <Rotulo>{x.r}</Rotulo>
              <div className="text-[34px] font-extrabold tracking-tight" style={{ ...NUM, color: x.alerta ? LARANJA_TXT : "#0F172A" }}>
                {x.v.toLocaleString("pt-BR")}
              </div>
              <div className="text-[13px] text-gray-600">{x.s}</div>
            </div>
          ))}
        </div>
      )}

      {/* Meta e ranking logo abaixo dos números (Bruno, 03/11): o "estamos no
          ritmo?" e o "quem está puxando" vêm antes do detalhe por pessoa. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <MetaDoMes kpis={extras?.kpis ?? null} time={!filtroSdr} />
        <RankingReunioes de={de} ate={ate} extras={extras} eu={filtroSdr || null} />
      </div>
      <EvolucaoDiaria de={de} ate={ate} extras={extras} sdrId={filtroSdr || null} />

      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="m-0 text-[19px] font-extrabold text-gray-900">Onde cada SDR perde o lead</h2>
        <span className="text-[13px] text-gray-500">Laranja = a etapa em que a pessoa fica mais abaixo da média do time</span>
      </div>
      {sdrs.length === 0 ? (
        <Cartao><p className="text-[14px] text-gray-500">Nenhum lead chegou pra SDR nesse período.</p></Cartao>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {sdrs.map((s) => <CardSdr key={s.sdr_id} l={s} time={t} />)}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Velocidade f={f} />
        <Atencao f={f} />
        <LigacoesGravadas extras={extras} gestor />
      </div>
      <Leituras f={f} />
    </>
  );
}

function VisaoSdr({ f, onIrParaPainel, extras, de, ate, euId }: {
  f: Funil; onIrParaPainel?: () => void; extras: Extras | null; de: string; ate: string; euId: string | null;
}) {
  // DESEMPENHO VISUAL (Bruno, 03/11). Ordem da leitura, de cima pra baixo:
  //   1. cinco números grandes (o que fiz no período);
  //   2. a meta do mês com o ritmo, ao lado da fila de hoje;
  //   3. o funil em degraus (onde perco o lead) + o ranking do time;
  //   4. a evolução dia a dia;
  //   5. os detalhes (reuniões, origem, FUP, ligações gravadas).
  const eu = f.sdrs[0];
  const t = f.time;
  const sal = salDoPeriodo(extras, de, ate, euId);

  const hoje = (
    <div className="rounded-2xl p-5 flex flex-col gap-2 text-white h-full" style={{ background: AZUL }}>
      <div className="text-[11.5px] font-bold uppercase tracking-wider" style={{ color: "#DCE6FF" }}>Hoje</div>
      <div className="text-[44px] font-extrabold leading-none" style={NUM}>{f.eu.fila_hoje}</div>
      <div className="text-[14px] font-semibold" style={{ color: "#DCE6FF" }}>atividades na fila</div>
      <div className="text-[14px]" style={{ color: "#EEF3FF" }}>
        {f.eu.atrasadas > 0 ? `${f.eu.atrasadas} atrasadas de dias anteriores: comece por elas.` : "Nenhuma atrasada. Boa!"}
      </div>
      {onIrParaPainel && (
        <button type="button" onClick={onIrParaPainel}
                className="mt-auto self-start h-11 px-5 rounded-xl bg-white font-bold text-[14.5px]" style={{ color: AZUL }}>
          Abrir o Painel
        </button>
      )}
    </div>
  );

  if (!eu) {
    return (
      <>
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2"><MetaDoMes kpis={extras?.kpis ?? null} /></div>
          {hoje}
        </div>
        <Cartao><p className="text-[14px] text-gray-500">Nenhum lead chegou pra você nesse período.</p></Cartao>
        <div className="grid gap-5 lg:grid-cols-2">
          <RankingReunioes de={de} ate={ate} extras={extras} eu={euId} />
          <EvolucaoDiaria de={de} ate={ate} extras={extras} sdrId={euId} />
        </div>
      </>
    );
  }

  const d = diagnostico(eu, t, true);
  const tx = taxas(eu);
  const txT = t ? taxas(t) : null;
  const passos = etapas(eu, t);
  const ate5 = eu.medidos_1o ? (eu.ate5min / eu.medidos_1o) * 100 : null;
  const ate5Time = t && t.medidos_1o ? (t.ate5min / t.medidos_1o) * 100 : null;
  const origem = [
    { r: "Quente", p: eu.temperatura.quente },
    { r: "Live", p: eu.fontes.live },
    { r: "Orgânico", p: eu.fontes.organico },
    { r: "Tráfego", p: eu.fontes.trafego },
    { r: "Frio", p: eu.temperatura.frio },
  ];
  const vsTime = (id: "trabalhou" | "falou" | "marcou" | "aconteceu") => (txT && txT[id] !== null ? ` · time ${fmtPct(txT[id])}` : "");

  return (
    <>
      {/* 1. Os números do período */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Kpi rotulo="Leads trabalhados" valor={eu.trabalhou.toLocaleString("pt-BR")}
          sub={`de ${eu.recebidos} recebidos · ${fmtPct(tx.trabalhou)}`} tom={d.pior === "trabalhou" ? "alerta" : undefined} />
        <Kpi rotulo="Contatos" valor={eu.falou.toLocaleString("pt-BR")}
          sub={`falou com ${fmtPct(tx.falou)}${vsTime("falou")}`} tom={d.pior === "falou" ? "alerta" : undefined} />
        <Kpi rotulo="Agendamentos" valor={eu.marcou.toLocaleString("pt-BR")}
          sub={`${fmtPct(tx.marcou)} das conversas${vsTime("marcou")}`} tom={d.pior === "marcou" ? "alerta" : undefined} />
        <Kpi rotulo="Comparecimento" valor={fmtPct(tx.aconteceu)}
          sub={`${eu.aconteceu} realizadas · ${eu.noshow} no-show${vsTime("aconteceu")}`} tom={d.pior === "aconteceu" ? "alerta" : undefined} />
        <Kpi rotulo="SAL aceito" valor={sal ? sal.sal : "—"}
          sub={sal && sal.realizadas ? `${fmtPct((sal.sal / sal.realizadas) * 100)} das reuniões realizadas no período` : "das reuniões realizadas no período"} />
      </div>

      {/* 2. Meta do mês + fila de hoje */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2"><MetaDoMes kpis={extras?.kpis ?? null} /></div>
        {hoje}
      </div>

      {/* 3. Funil + ranking */}
      <div className="grid gap-5 lg:grid-cols-5">
        <Cartao className="lg:col-span-3 flex flex-col gap-4">
          <div className="flex justify-between items-baseline flex-wrap gap-2">
            <h2 className="m-0 text-[17px] font-extrabold text-gray-900">Seu funil</h2>
            <span className="text-[12.5px] text-gray-500">↓ = quanto passa pra próxima etapa · laranja = onde você mais fica abaixo do time</span>
          </div>
          <FunilDegraus passos={passos} pior={d.pior} recebidos={eu.recebidos} />
          <div className="grid gap-3 sm:grid-cols-2 pt-1">
            <div className="rounded-xl px-4 py-3" style={{ background: "#EEF3FF" }}>
              <div className="text-[11.5px] font-extrabold uppercase tracking-wider" style={{ color: AZUL }}>Seu ponto forte</div>
              <div className="text-[14px] leading-snug mt-1 text-gray-900">{d.forteFrase ?? "Você está na média do time em todas as etapas."}</div>
            </div>
            <div className="rounded-xl px-4 py-3" style={{ background: d.pior ? "#FFF4EA" : "#ECFDF5" }}>
              <div className="text-[11.5px] font-extrabold uppercase tracking-wider" style={{ color: d.pior ? "#9A4A06" : "#047857" }}>
                {d.pior ? "Onde crescer" : "Tudo em dia"}
              </div>
              <div className="text-[14px] leading-snug mt-1" style={{ color: d.pior ? "#3B2410" : "#065F46" }}>{d.frase}</div>
            </div>
          </div>
        </Cartao>
        <div className="lg:col-span-2"><RankingReunioes de={de} ate={ate} extras={extras} eu={euId} /></div>
      </div>

      {/* 4. Dia a dia */}
      <EvolucaoDiaria de={de} ate={ate} extras={extras} sdrId={euId} />

      {/* 5. Detalhes */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Cartao><BarraReunioes l={eu} /></Cartao>
        <Cartao className="flex flex-col gap-1.5">
          <Rotulo>Que lead vira reunião</Rotulo>
          {origem.map((o) => (
            <div key={o.r} className="flex justify-between text-[14px]" style={NUM}>
              <span className="text-gray-700">{o.r} <span className="text-gray-400">{o.p.n} leads</span></span>
              <b>{o.p.n ? fmtPct((o.p.marcou / o.p.n) * 100) : "—"}</b>
            </div>
          ))}
        </Cartao>
        <Cartao className="flex flex-col gap-2">
          <Rotulo>Seu FUP</Rotulo>
          {[
            { r: "Tentativas por lead", v: eu.tent_media === null ? "—" : eu.tent_media.toFixed(1).replace(".", ","), time: t?.tent_media === null || !t ? null : t.tent_media!.toFixed(1).replace(".", ",") },
            { r: "1º contato em até 5 min", v: fmtPct(ate5), time: fmtPct(ate5Time) },
            { r: "Tempo até o 1º contato", v: tempoHumano(eu.mediana_1o_min), time: tempoHumano(t?.mediana_1o_min ?? null) },
            { r: "Leads ainda em FUP", v: String(eu.em_fup), time: null },
          ].map((x) => (
            <div key={x.r} className="flex justify-between gap-2 text-[14px]" style={NUM}>
              <span className="text-gray-700">{x.r}</span>
              <span className="font-extrabold whitespace-nowrap">{x.v}{x.time && <span className="font-medium text-gray-500 ml-1.5">time {x.time}</span>}</span>
            </div>
          ))}
        </Cartao>
        <LigacoesGravadas extras={extras} gestor={false} />
      </div>
    </>
  );
}

export default function VisaoGeralFunil({ onIrParaPainel }: Props) {
  const [periodo, setPeriodo] = useState<PeriodoFunil>("mes");
  const intervalo = useMemo(() => intervaloFunil(periodo), [periodo]);
  const [f, setF] = useState<Funil | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [filtroSdr, setFiltroSdr] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setF(await fetchFunil(intervalo.de, intervalo.ate));
    } catch (e) {
      setErro((e as Error)?.message || "Não consegui carregar o funil.");
    } finally {
      setCarregando(false);
    }
  }, [intervalo]);

  useEffect(() => { void carregar(); }, [carregar]);
  // Recarrega a cada 2 min: "Hoje" e "atrasadas" são foto de agora.
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) void carregar(); }, 120_000);
    return () => window.clearInterval(t);
  }, [carregar]);

  const gestor = !!f?.gestor;
  const { currentUser } = useQsAuth();
  // SDR em foco: o próprio (SDR) ou o escolhido no filtro (gestão); sem foco,
  // o time — e aí não se baixam as atividades de todo mundo.
  const foco = f ? (gestor ? filtroSdr || null : currentUser?.id ?? null) : null;
  // Só busca depois do funil: é ele que diz se a pessoa é gestão.
  const extras = useExtrasDesempenho(intervalo.de, intervalo.ate, foco, !!f);

  return (
    <div className="max-w-[1440px] mx-auto flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <div className="text-[12px] font-bold uppercase tracking-wider text-gray-500">Visão Geral{gestor ? " · Gestor" : ""}</div>
          <h1 className="m-0 text-[30px] font-extrabold tracking-tight text-gray-900">{gestor ? "Funil do time" : "Seu funil"}</h1>
          <div className="text-[14px] text-gray-600">
            Leads que {gestor ? "cada SDR" : "você"} recebeu de {dataBR(intervalo.de)} a {dataBR(intervalo.ate)} e até onde chegaram.
            {carregando && <span className="text-gray-400"> · atualizando…</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {PERIODOS_FUNIL.map((p) => (
            <button key={p.id} type="button" onClick={() => setPeriodo(p.id)}
                    className={`h-10 px-4 rounded-full border text-[14px] font-semibold ${periodo === p.id ? "text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                    style={periodo === p.id ? { background: AZUL, borderColor: AZUL } : { borderColor: LINHA }}>
              {p.rotulo}
            </button>
          ))}
          {gestor && f && f.sdrs.length > 1 && (
            <label className="flex items-center gap-2 ml-2 text-[14px] text-gray-600">
              SDR
              <select value={filtroSdr} onChange={(e) => setFiltroSdr(e.target.value)}
                      className="h-10 px-3 rounded-lg border bg-white text-[14px]" style={{ borderColor: LINHA }}>
                <option value="">Todos</option>
                {f.sdrs.map((s) => <option key={s.sdr_id} value={s.sdr_id}>{s.nome}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      {erro && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-700">{erro}</div>}
      {!f && !erro && <div className="text-[14px] text-gray-400">Carregando…</div>}

      {f && (gestor
        ? <VisaoGestor f={f} filtroSdr={filtroSdr} extras={extras} de={intervalo.de} ate={intervalo.ate} />
        : <VisaoSdr f={f} onIrParaPainel={onIrParaPainel} extras={extras} de={intervalo.de} ate={intervalo.ate} euId={currentUser?.id ?? null} />)}
    </div>
  );
}
