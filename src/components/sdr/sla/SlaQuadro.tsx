// src/components/sdr/sla/SlaQuadro.tsx
// -----------------------------------------------------------------------------
// "Quanto tempo o lead espera pelo SDR" no Desempenho (SLA 0400/0401).
//   17/11 Bruno: tempo até a 1ª interação por SDR.
//   18/11 Everton: farol por SDR (Bom/Médio/Ruim + tempo).
//   18/11 Bruno: "o SLA e o pipe têm filtros que não andam juntos" → o quadro
//   NÃO tem mais filtro próprio: lê o intervalo do filtro da página (de/ate).
// SDR vê só o próprio cartão. Usa as variáveis de cor do Desempenho (.dsp).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import SlaDetalhe from "./SlaDetalhe";
import {
  farolSla, fetchPainelSla, minutosTxt, pctNaMeta, pctSla, tomSla,
  type BlocoSla, type PainelSla, type TomSla,
} from "@/lib/qs/sla";

const COR: Record<TomSla, string> = { ok: "var(--ok, #15803D)", warn: "var(--warn)", danger: "var(--danger, #B91C1C)", neutro: "var(--muted)" };

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

export default function SlaQuadro({ de, ate, rotPer, onOpenLead }: {
  /** Intervalo do filtro da página (YYYY-MM-DD, inclusivo). */
  de: string; ate: string;
  /** "de hoje", "da semana", "do mês", "de 01/11 a 15/11". */
  rotPer: string;
  onOpenLead?: (leadId: string) => void;
}) {
  const [p, setP] = useState<PainelSla | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abrir, setAbrir] = useState<{ sdr: string } | null>(null);

  const carregar = useCallback(async () => {
    try { setP(await fetchPainelSla(de, ate)); setErro(null); }
    catch (e) { setErro((e as Error)?.message ?? "Não consegui carregar a espera do lead."); }
  }, [de, ate]);
  useEffect(() => {
    setP(null);
    void carregar();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void carregar(); }, 120_000);
    return () => window.clearInterval(id);
  }, [carregar]);

  if (erro) return <div className="dsp-card p-5 text-sm" style={{ color: "var(--warn)" }}>Espera do lead: {erro}</div>;
  if (!p) return <div className="dsp-card p-5 text-sm dsp-mut">Carregando a espera do lead…</div>;

  const meta = p.meta_min;
  // Ordena do melhor pro pior pela mediana do período (sem medida vai pro fim).
  const linhas = [...p.sdrs].sort((a, b) => (a.faixa.mediana_min ?? 1e9) - (b.faixa.mediana_min ?? 1e9));
  const estourados = p.aguardando.filter((a) => a.minutos > meta);

  return (
    <section className="dsp-card flex flex-col gap-4 p-5" aria-label="Quanto tempo o lead espera pelo SDR">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="dsp-lbl">Quanto tempo o lead espera pelo SDR · {rotPer}</div>
          <div className="mt-1 text-[13px] dsp-mut">
            Da chegada do lead até a 1ª interação do SDR (ligação, WhatsApp ou tarefa concluída), contando só seg–sex no expediente.
            Tempo típico: metade dos leads espera menos que isso. Meta: <b>{minutosTxt(meta)}</b>.
          </div>
        </div>
        <button type="button" className="dsp-chip" onClick={() => setAbrir({ sdr: "" })}>Ver cada cliente</button>
      </div>

      {!p.faixa_ok && (
        <div className="rounded-xl px-3 py-2 text-[13px]" style={{ background: "var(--warnBg)", color: "var(--warn)" }}>
          O banco ainda não recebeu a atualização do filtro: este quadro está mostrando o <b>mês atual</b>, não {rotPer}.
        </div>
      )}

      {linhas.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {linhas.map((s) => (
              <CartaoFarol key={s.sdr_id} nome={s.nome} b={s.faixa} meta={meta} onAbrir={() => setAbrir({ sdr: p.gestor ? s.sdr_id : "" })} />
            ))}
            {p.gestor && linhas.length > 1 && (
              <CartaoFarol nome="Time" destaque b={p.time.faixa} meta={meta} onAbrir={() => setAbrir({ sdr: "" })} />
            )}
          </div>
          <div className="text-[12px] dsp-mut">
            <b style={{ color: COR.ok }}>Bom</b>: tempo até {minutosTxt(meta)} e 70% ou mais no prazo ·{" "}
            <b style={{ color: COR.warn }}>Médio</b>: entre 50% e 70% no prazo ·{" "}
            <b style={{ color: COR.danger }}>Ruim</b>: tempo acima de {minutosTxt(meta)} ou menos da metade no prazo.
            {" "}"No prazo" conta também quem ainda espera e já passou da meta.
          </div>
        </div>
      ) : (
        <div className="text-[13px] dsp-mut">Nenhum SDR com leads no período.</div>
      )}

      {p.aguardando.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[13px] font-semibold">
            Esperando a 1ª interação agora: {p.aguardando.length}
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
      {abrir && (
        <SlaDetalhe painel={p} sdrInicial={abrir.sdr} onFechar={() => setAbrir(null)} onOpenLead={onOpenLead}
          faixa={p.faixa_ok ? { de, ate, rotulo: rotPer } : undefined} periodoInicial={p.faixa_ok ? "hoje" : "mes"} />
      )}
    </section>
  );
}
