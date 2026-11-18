// src/components/sdr/sla/SlaFilaHoje.tsx
// -----------------------------------------------------------------------------
// SLA do 1º atendimento na Fila de hoje (Bruno, 17/11): um QUADRADINHO na faixa
// das metas (mesmo formato .qsx-meta). Mostra o SLA de hoje (do SDR; o gestor vê
// o time) e, ao clicar, abre o tempo de resposta de cada lead que entrou
// (SlaDetalhe). Atualiza sozinho a cada 60 s e ao voltar pra aba.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import SlaDetalhe from "./SlaDetalhe";
import { fetchPainelSla, minutosTxt, tomSla, type PainelSla, type TomSla } from "@/lib/qs/sla";

const COR: Record<TomSla, string> = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)", neutro: "var(--text)" };

const CSS = `
.sla-tile{cursor:pointer;text-align:left;background:none;border:0;font:inherit;color:inherit;width:100%}
.sla-tile:hover{background:var(--surface-2)}
.sla-tile:focus-visible{outline:2px solid var(--info);outline-offset:-2px}
@keyframes slaPulse{0%,100%{opacity:1}50%{opacity:.35}}
.sla-pulse{display:inline-block;width:7px;height:7px;border-radius:999px;background:var(--danger);margin-right:5px;vertical-align:middle;animation:slaPulse 1.4s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.sla-pulse{animation:none}}
`;

export default function SlaFilaHoje({ onOpenLead }: { onOpenLead: (leadId: string) => void }) {
  const [p, setP] = useState<PainelSla | null>(null);
  const [erro, setErro] = useState(false);
  const [aberto, setAberto] = useState(false);

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

  const meta = p?.meta_min ?? 30;
  const hoje = p ? (!p.gestor && p.sdrs.length === 1 ? p.sdrs[0].hoje : p.time.hoje) : null;
  const tom: TomSla = hoje ? tomSla(hoje, meta) : "neutro";
  const estourados = p ? p.aguardando.filter((a) => a.minutos > meta).length : 0;

  return (
    <>
      <style>{CSS}</style>
      <button type="button" className="qsx-meta sla-tile" onClick={() => p && setAberto(true)} disabled={!p}
        title="Clique para ver o tempo de resposta de cada lead">
        <span className="qsx-mlab">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: tom === "neutro" ? "var(--info)" : COR[tom] }}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></svg>
          SLA 1º atendimento
        </span>
        <span className="qsx-mval" style={{ color: COR[tom] }}>
          {hoje ? minutosTxt(hoje.mediana_min) : erro ? "—" : "…"}
          <small>meta {minutosTxt(meta)}</small>
        </span>
        <span className="qsx-msub">
          {hoje ? `${hoje.na_meta} de ${hoje.na_meta + hoje.fora_meta} no prazo hoje` : erro ? "não carregou" : "carregando"}
        </span>
        {p && p.aguardando.length > 0 && (
          <span className="qsx-msub" style={{ color: estourados ? "var(--danger)" : "var(--warn)", fontWeight: 600 }}>
            {estourados > 0 && <span className="sla-pulse" aria-hidden />}
            {p.aguardando.length} esperando{estourados ? ` · ${estourados} fora do prazo` : ""}
          </span>
        )}
      </button>
      {aberto && p && <SlaDetalhe painel={p} onFechar={() => setAberto(false)} onOpenLead={onOpenLead} />}
    </>
  );
}
