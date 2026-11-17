// src/components/sdr/sla/SlaFilaHoje.tsx
// -----------------------------------------------------------------------------
// SLA do 1º atendimento na Fila de hoje (Bruno, 17/11): "na tela principal eles
// têm que ter o SLA do dia deles". Mostra o SLA de HOJE (do SDR; o gestor vê o
// time) e, logo abaixo, o ALERTA: leads que chegaram e ainda não tiveram o 1º
// toque, com o tempo útil correndo. Vermelho = já passou da meta.
// Atualiza sozinho a cada 60 s (e ao voltar pra aba).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import SlaDetalhe from "./SlaDetalhe";
import {
  fetchPainelSla, minutosTxt, pctNaMeta, pctSla, tomEspera, tomSla,
  type PainelSla, type TomSla,
} from "@/lib/qs/sla";

const COR: Record<TomSla, { fg: string; bg: string }> = {
  ok: { fg: "var(--ok)", bg: "var(--ok-bg)" },
  warn: { fg: "var(--warn)", bg: "var(--warn-bg)" },
  danger: { fg: "var(--danger)", bg: "var(--danger-bg)" },
  neutro: { fg: "var(--muted)", bg: "var(--surface-2)" },
};

const CSS = `
.sla-box{border:1px solid var(--border);background:var(--surface);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:12px;cursor:pointer;transition:border-color .15s,background .15s}
.sla-box:hover{background:var(--surface-2)}
.sla-box:focus-visible{outline:2px solid var(--info);outline-offset:2px}
.sla-ver{font-size:12px;font-weight:600;color:var(--info)}
.sla-box[data-tom=danger]{border-color:color-mix(in srgb,var(--danger) 45%,var(--border));box-shadow:inset 3px 0 0 var(--danger)}
.sla-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px 22px}
.sla-tit{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--subtle)}
.sla-num{display:flex;flex-direction:column;gap:2px;min-width:0}
.sla-val{font-size:20px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.sla-sub{font-size:12px;color:var(--subtle)}
.sla-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
.sla-lista{display:flex;flex-wrap:wrap;gap:8px}
.sla-lead{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:10px;border:1px solid var(--border);background:var(--surface);font-size:13px;cursor:pointer;max-width:100%}
.sla-lead:hover{background:var(--surface-2)}
.sla-lead b{font-variant-numeric:tabular-nums}
.sla-dot{width:8px;height:8px;border-radius:999px;flex:none}
@keyframes slaPulse{0%,100%{opacity:1}50%{opacity:.35}}
.sla-dot[data-tom=danger]{animation:slaPulse 1.4s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.sla-dot[data-tom=danger]{animation:none}}
`;

export default function SlaFilaHoje({ onOpenLead, onVerDesempenho }: {
  onOpenLead: (leadId: string) => void;
  onVerDesempenho?: () => void;
}) {
  const [p, setP] = useState<PainelSla | null>(null);
  const [erro, setErro] = useState(false);
  const [todos, setTodos] = useState(false);
  const [detalhe, setDetalhe] = useState(false);
  const parar = (e: MouseEvent) => e.stopPropagation();

  const carregar = useCallback(async () => {
    try { setP(await fetchPainelSla()); setErro(false); }
    catch (e) { console.warn("[sla] painel:", e); setErro(true); }
  }, []);

  useEffect(() => {
    void carregar();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void carregar(); }, 60_000);
    const vis = () => { if (document.visibilityState === "visible") void carregar(); };
    document.addEventListener("visibilitychange", vis);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [carregar]);

  if (!p) return erro ? null : <div className="sla-box" style={{ minHeight: 64 }}><style>{CSS}</style></div>;

  const meta = p.meta_min;
  // SDR vê a própria linha; gestor vê o time.
  const minha = !p.gestor && p.sdrs.length === 1 ? p.sdrs[0].hoje : p.time.hoje;
  const tom = tomSla(minha, meta);
  const pct = pctNaMeta(minha);
  const estourados = p.aguardando.filter((a) => a.minutos > meta);
  const lista = todos ? p.aguardando : p.aguardando.slice(0, 8);
  const tomBox: TomSla = estourados.length > 0 ? "danger" : tom;

  return (
    <>
    <section className="sla-box" data-tom={tomBox} aria-label="SLA do primeiro atendimento — clique para ver o tempo de cada cliente"
      role="button" tabIndex={0} onClick={() => setDetalhe(true)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetalhe(true); } }}>
      <style>{CSS}</style>
      <div className="sla-top">
        <span className="sla-tit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: COR[tom].fg }}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></svg>
          {p.gestor ? "SLA do time hoje" : "Seu SLA hoje"} · 1º atendimento
        </span>
        <div className="sla-num">
          <span className="sla-val" style={{ color: COR[tom].fg }}>{minutosTxt(minha.mediana_min)}</span>
          <span className="sla-sub">tempo médio (mediana) · meta {minutosTxt(meta)}</span>
        </div>
        <div className="sla-num">
          <span className="sla-val">{pctSla(pct)}</span>
          <span className="sla-sub">{minha.na_meta} de {minha.na_meta + minha.fora_meta} no prazo</span>
        </div>
        <div className="sla-num">
          <span className="sla-val">{minha.atendidos}<span className="sla-sub" style={{ fontWeight: 500 }}> / {minha.recebidos}</span></span>
          <span className="sla-sub">leads novos atendidos</span>
        </div>
        <span className="sla-pill" style={{ color: COR[p.aguardando.length ? (estourados.length ? "danger" : "warn") : "ok"].fg, background: COR[p.aguardando.length ? (estourados.length ? "danger" : "warn") : "ok"].bg }}>
          {p.aguardando.length === 0
            ? "Ninguém esperando o 1º atendimento"
            : `${p.aguardando.length} esperando${estourados.length ? ` · ${estourados.length} fora do prazo` : ""}`}
        </span>
        <span className="sla-ver" style={{ marginLeft: "auto" }}>Ver o tempo de cada cliente →</span>
        {onVerDesempenho && (
          <button type="button" className="sla-sub" style={{ textDecoration: "underline", background: "none", border: 0, cursor: "pointer" }} onClick={(e) => { parar(e); onVerDesempenho(); }}>
            Ver semana e mês
          </button>
        )}
      </div>

      {p.aguardando.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="sla-sub">Atenda primeiro — tempo útil desde a chegada (para quando você ligar, mandar WhatsApp ou concluir a tarefa):</span>
          <div className="sla-lista">
            {lista.map((a) => {
              const t = tomEspera(a.minutos, meta);
              return (
                <button key={a.lead_id} type="button" className="sla-lead" onClick={(e) => { parar(e); onOpenLead(a.lead_id); }}
                  title={`Chegou ${new Date(a.chegou_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}${p.gestor ? ` · ${a.sdr_nome}` : ""}`}>
                  <span className="sla-dot" data-tom={t} style={{ background: COR[t].fg }} />
                  <span className="truncate" style={{ maxWidth: 180 }}>{a.nome || "Sem nome"}</span>
                  {p.gestor && <span className="sla-sub">· {a.sdr_nome.split(" ")[0]}</span>}
                  <b style={{ color: COR[t].fg }}>{minutosTxt(a.minutos)}</b>
                </button>
              );
            })}
            {p.aguardando.length > 8 && (
              <button type="button" className="sla-lead" onClick={(e) => { parar(e); setTodos((v) => !v); }}>
                {todos ? "Mostrar menos" : `+${p.aguardando.length - 8}`}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
    {detalhe && <SlaDetalhe painel={p} onFechar={() => setDetalhe(false)} onOpenLead={onOpenLead} />}
    </>
  );
}
