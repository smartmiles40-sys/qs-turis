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
  fetchPainelSla, minutosTxt, pctNaMeta, pctSla, tomSla,
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

export default function SlaQuadro({ onOpenLead }: { onOpenLead?: (leadId: string) => void }) {
  const [p, setP] = useState<PainelSla | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abrir, setAbrir] = useState<{ periodo: PeriodoSla; sdr: string } | null>(null);

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
