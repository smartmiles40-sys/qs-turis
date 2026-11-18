// src/components/sdr/sla/SlaQuadro.tsx
// -----------------------------------------------------------------------------
// Quadro de SLA do 1º atendimento no Desempenho (Bruno, 17/11): cada SDR com
// HOJE · SEMANA · MÊS lado a lado — mediana, % no prazo e quem ainda espera.
// Mesma resposta (qs_sla_painel, 0400) da Fila de hoje. SDR vê só a linha dele.
// Usa as variáveis de cor do Desempenho (.dsp) quando está dentro dele.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import SlaDetalhe from "./SlaDetalhe";
import {
  farolSla, fetchPainelSla, minutosTxt, pctNaMeta, pctSla, tomSla,
  type BlocoSla, type PainelSla, type PeriodoSla, type TomSla,
} from "@/lib/qs/sla";

const PERIODOS: { id: PeriodoSla; rot: string }[] = [
  { id: "hoje", rot: "Hoje" }, { id: "semana", rot: "Semana" }, { id: "mes", rot: "Mês" },
];
const COR: Record<TomSla, string> = { ok: "var(--ok, #15803D)", warn: "var(--warn)", danger: "var(--danger, #B91C1C)", neutro: "var(--muted)" };

function Celula({ b, meta, onAbrir }: { b: BlocoSla; meta: number; onAbrir: () => void }) {
  if (b.recebidos === 0) return <td className="dsp-mut">—</td>;
  const tom = tomSla(b, meta);
  return (
    <td onClick={onAbrir} style={{ cursor: "pointer" }} title="Ver o tempo de cada cliente">
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-bold" style={{ color: COR[tom] }}>{minutosTxt(b.mediana_min)}</span>
        <span className="text-[12px] dsp-mut">
          {pctSla(pctNaMeta(b))} no prazo · {b.atendidos}/{b.recebidos}
          {b.aguardando > 0 && <span style={{ color: "var(--warn)", fontWeight: 600 }}> · {b.aguardando} esperando</span>}
        </span>
      </div>
    </td>
  );
}

// Farol do atendimento (sugestão do Everton, 18/11): um cartão por SDR com a
// luz (Bom/Médio/Ruim), o tempo e o % no prazo do período escolhido. Mesma
// régua de cor das células da tabela (tomSla) — nada de conta nova.
function CartaoFarol({ nome, b, meta, destaque, onAbrir }: { nome: string; b: BlocoSla; meta: number; destaque?: boolean; onAbrir: () => void }) {
  const tom = b.recebidos === 0 ? "neutro" : tomSla(b, meta);
  return (
    <button type="button" onClick={onAbrir} disabled={b.recebidos === 0} title="Ver o tempo de cada cliente"
      className="flex flex-col gap-1 rounded-[12px] p-3 text-left"
      style={{ border: "1px solid var(--border)", borderLeft: `4px solid ${COR[tom]}`, background: destaque ? "var(--card2)" : "var(--card)", color: "var(--text)", cursor: b.recebidos ? "pointer" : "default" }}>
      <span className="flex items-center justify-between gap-2">
        <span className={`truncate text-[14px] ${destaque ? "font-bold" : "font-semibold"}`}>{nome}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-bold" style={{ color: COR[tom] }}>
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COR[tom] }} />
          {b.recebidos === 0 ? "Sem leads" : farolSla(b, meta)}
        </span>
      </span>
      <span className="text-[22px] font-bold leading-tight" style={{ color: COR[tom] }}>{b.recebidos === 0 ? "—" : minutosTxt(b.mediana_min)}</span>
      <span className="text-[12px] dsp-mut">
        {b.recebidos === 0 ? "nenhum lead no período" : <>{pctSla(pctNaMeta(b))} no prazo · {b.atendidos}/{b.recebidos} atendidos</>}
        {b.aguardando > 0 && <span style={{ color: "var(--warn)", fontWeight: 600 }}> · {b.aguardando} esperando</span>}
      </span>
    </button>
  );
}

export default function SlaQuadro({ onOpenLead }: { onOpenLead?: (leadId: string) => void }) {
  const [p, setP] = useState<PainelSla | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abrir, setAbrir] = useState<{ periodo: PeriodoSla; sdr: string } | null>(null);
  const [farolP, setFarolP] = useState<PeriodoSla>("hoje");

  const carregar = useCallback(async () => {
    try { setP(await fetchPainelSla()); setErro(null); }
    catch (e) { setErro((e as Error)?.message ?? "Não consegui carregar o SLA."); }
  }, []);
  useEffect(() => {
    void carregar();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void carregar(); }, 120_000);
    return () => window.clearInterval(id);
  }, [carregar]);

  if (erro) return <div className="dsp-card p-5 text-sm" style={{ color: "var(--warn)" }}>SLA: {erro}</div>;
  if (!p) return <div className="dsp-card p-5 text-sm dsp-mut">Carregando o SLA…</div>;

  const meta = p.meta_min;
  // Ordena do melhor pro pior pela mediana do mês (sem medida vai pro fim).
  const linhas = [...p.sdrs].sort((a, b) => (a.mes.mediana_min ?? 1e9) - (b.mes.mediana_min ?? 1e9));
  const estourados = p.aguardando.filter((a) => a.minutos > meta);

  return (
    <section className="dsp-card flex flex-col gap-4 p-5" aria-label="SLA do primeiro atendimento por SDR">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="dsp-lbl">SLA do 1º atendimento</div>
          <div className="mt-1 text-[13px] dsp-mut">
            Tempo útil da chegada do lead até a 1ª ligação, WhatsApp ou tarefa concluída (mediana). Meta: <b>{minutosTxt(meta)}</b>.
            {" "}"No prazo" conta também quem ainda espera e já passou da meta.
          </div>
        </div>
        <button type="button" className="dsp-chip" onClick={() => setAbrir({ periodo: "hoje", sdr: "" })}>Ver cada cliente</button>
        <span className="text-[13px] dsp-mut">Atualizado {new Date(p.gerado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>

      {linhas.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px] font-semibold">Farol do atendimento</div>
            <div className="flex gap-1.5" role="group" aria-label="Período do farol">
              {PERIODOS.map((x) => (
                <button key={x.id} type="button" className="dsp-chip" style={{ minHeight: 32, padding: "0 12px", fontSize: 13 }}
                  aria-pressed={farolP === x.id} onClick={() => setFarolP(x.id)}>{x.rot}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {linhas.map((s) => (
              <CartaoFarol key={s.sdr_id} nome={s.nome} b={s[farolP]} meta={meta}
                onAbrir={() => setAbrir({ periodo: farolP, sdr: p.gestor ? s.sdr_id : "" })} />
            ))}
            {p.gestor && linhas.length > 1 && (
              <CartaoFarol nome="Time" destaque b={p.time[farolP]} meta={meta} onAbrir={() => setAbrir({ periodo: farolP, sdr: "" })} />
            )}
          </div>
          <div className="text-[12px] dsp-mut">
            <b style={{ color: COR.ok }}>Bom</b>: tempo até {minutosTxt(meta)} e 70% ou mais no prazo ·{" "}
            <b style={{ color: COR.warn }}>Médio</b>: entre 50% e 70% no prazo ·{" "}
            <b style={{ color: COR.danger }}>Ruim</b>: tempo acima de {minutosTxt(meta)} ou menos da metade no prazo.
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[14px]">
          <thead>
            <tr>
              <th>SDR</th>
              {PERIODOS.map((x) => <th key={x.id}>{x.rot}</th>)}
            </tr>
          </thead>
          <tbody>
            {linhas.map((s) => (
              <tr key={s.sdr_id}>
                <td className="font-semibold">{s.nome}</td>
                {PERIODOS.map((x) => <Celula key={x.id} b={s[x.id]} meta={meta} onAbrir={() => setAbrir({ periodo: x.id, sdr: p.gestor ? s.sdr_id : "" })} />)}
              </tr>
            ))}
            {p.gestor && linhas.length > 1 && (
              <tr style={{ background: "var(--card2)" }}>
                <td className="font-bold">Time</td>
                {PERIODOS.map((x) => <Celula key={x.id} b={p.time[x.id]} meta={meta} onAbrir={() => setAbrir({ periodo: x.id, sdr: "" })} />)}
              </tr>
            )}
            {linhas.length === 0 && (
              <tr><td colSpan={4} className="dsp-mut">Nenhum SDR com leads no período.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {p.aguardando.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold">
            Esperando o 1º atendimento agora: {p.aguardando.length}
            {estourados.length > 0 && <span style={{ color: COR.danger }}> · {estourados.length} fora do prazo</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {p.aguardando.slice(0, 30).map((a) => {
              const fora = a.minutos > meta;
              return (
                <button key={a.lead_id} type="button" disabled={!onOpenLead} onClick={() => onOpenLead?.(a.lead_id)}
                  className="rounded-[10px] px-2.5 py-1.5 text-[13px]"
                  style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)" }}>
                  {a.nome || "Sem nome"}{p.gestor ? <span className="dsp-mut"> · {a.sdr_nome.split(" ")[0]}</span> : null}
                  {" "}<b style={{ color: fora ? COR.danger : "var(--warn)" }}>{minutosTxt(a.minutos)}</b>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {abrir && <SlaDetalhe painel={p} periodoInicial={abrir.periodo} sdrInicial={abrir.sdr} onFechar={() => setAbrir(null)} onOpenLead={onOpenLead} />}
    </section>
  );
}
