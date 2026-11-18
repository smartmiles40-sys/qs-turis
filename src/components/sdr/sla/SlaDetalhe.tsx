// src/components/sdr/sla/SlaDetalhe.tsx
// -----------------------------------------------------------------------------
// Detalhe do SLA (Bruno, 17/11): "quando clicar no card, mostrar quanto tempo
// demorou pra atender cada cliente". Abre por cima da tela, com Hoje / Semana /
// Mês, filtro de SDR (gestor), quem ainda espera e cada atendido: chegou, 1º
// contato, por onde e quanto tempo útil levou. Clique na linha abre o lead.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import {
  ROTULO_CANAL, atendidosDaFaixa, atendidosDoPeriodo, minutosTxt, tomEspera,
  type PainelSla, type PeriodoSla, type TomSla,
} from "@/lib/qs/sla";

const COR: Record<TomSla, string> = { ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)", neutro: "var(--muted)" };
const PERIODOS: { id: PeriodoSla; rot: string }[] = [{ id: "hoje", rot: "Hoje" }, { id: "semana", rot: "Semana" }, { id: "mes", rot: "Mês" }];
// Com dia da semana: o tempo conta só seg–sex no expediente, então pra refazer a
// conta à mão é preciso saber se passou por noite ou fim de semana.
const dataHora = (iso: string) => {
  const d = new Date(iso);
  const sem = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short" }).replace(".", "");
  const resto = d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
  return `${sem} ${resto}`;
};
/** Diferença de relógio (24h, com noite e fim de semana) — pra comparar com o tempo útil. */
const corridoMin = (de: string, ate: string) => Math.max(0, (new Date(ate).getTime() - new Date(de).getTime()) / 60000);
const corridoTxt = (min: number) => (min < 60 ? `${Math.round(min)} min` : min < 48 * 60 ? minutosTxt(min) : `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`);

const CSS = `
.slad-fundo{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow-y:auto}
.slad{width:100%;max-width:980px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;max-height:calc(100vh - 48px)}
.slad-cab{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid var(--border)}
.slad-corpo{overflow-y:auto;padding:12px 20px 20px;display:flex;flex-direction:column;gap:16px}
.slad-chip{min-height:34px;padding:0 14px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;font-weight:500;cursor:pointer}
.slad-chip[aria-pressed=true]{background:var(--primary);color:var(--on-primary);border-color:var(--primary);font-weight:600}
.slad-sub{font-size:12px;color:var(--subtle)}
.slad table{width:100%;border-collapse:collapse;font-size:13.5px;font-variant-numeric:tabular-nums}
.slad th{padding:8px 8px;text-align:left;font-size:11.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--subtle);position:sticky;top:0;background:var(--surface)}
.slad td{padding:9px 8px;border-top:1px solid var(--border)}
.slad tbody tr{cursor:pointer}
.slad tbody tr:hover{background:var(--surface-2)}
.slad-th-btn{background:none;border:0;padding:0;font:inherit;color:inherit;text-transform:inherit;letter-spacing:inherit;cursor:pointer}
.slad-selo{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn);vertical-align:middle}
@media (max-width:640px){.slad-esconde{display:none}}
`;

type Ordem = "recentes" | "demorados";

export default function SlaDetalhe({ painel, onFechar, onOpenLead, periodoInicial = "hoje", sdrInicial = "", faixa }: {
  painel: PainelSla;
  /** Desempenho (18/11): intervalo do filtro da página — some a escolha Hoje/Semana/Mês daqui. */
  faixa?: { de: string; ate: string; rotulo: string };
  onFechar: () => void;
  onOpenLead?: (leadId: string) => void;
  periodoInicial?: PeriodoSla;
  sdrInicial?: string;
}) {
  const [periodo, setPeriodo] = useState<PeriodoSla>(periodoInicial);
  const [sdr, setSdr] = useState<string>(sdrInicial);
  const [ordem, setOrdem] = useState<Ordem>("recentes");
  const meta = painel.meta_min;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  const atendidos = useMemo(() => {
    const l = faixa ? atendidosDaFaixa(painel.atendidos, faixa.de, faixa.ate, sdr || null) : atendidosDoPeriodo(painel.atendidos, periodo, sdr || null);
    return ordem === "demorados" ? [...l].sort((a, b) => b.minutos - a.minutos) : l;
  }, [painel.atendidos, periodo, sdr, ordem, faixa]);
  // Quem ainda espera aparece em qualquer período: é o que precisa de ação agora.
  const esperando = useMemo(() => painel.aguardando.filter((a) => !sdr || a.sdr_id === sdr), [painel.aguardando, sdr]);
  // 0405: ligação marcada pelo cliente que ainda não chegou na hora — não é espera.
  const marcadas = useMemo(() => painel.marcadas.filter((a) => !sdr || a.sdr_id === sdr), [painel.marcadas, sdr]);
  const noPrazo = atendidos.filter((a) => a.minutos <= meta).length;
  const abrir = (id: string) => { if (onOpenLead) { onOpenLead(id); onFechar(); } };

  return (
    <div className="slad-fundo" role="presentation" onClick={onFechar}>
      <style>{CSS}</style>
      <div className="slad" role="dialog" aria-modal="true" aria-label="Tempo de atendimento de cada cliente" onClick={(e) => e.stopPropagation()}>
        <div className="slad-cab">
          <div>
            <div className="text-[17px] font-bold">Quanto cada lead esperou, cliente a cliente</div>
            <div className="slad-sub">Da chegada até a 1ª interação do SDR (ligação, WhatsApp ou tarefa concluída). Se o cliente marcou a ligação, conta a partir da hora marcada. "Espera útil" conta só seg–sex no expediente; "relógio" é a diferença direta entre as duas horas · meta {minutosTxt(meta)}</div>
          </div>
          <button type="button" className="slad-chip" onClick={onFechar} aria-label="Fechar">Fechar</button>
        </div>

        <div className="slad-corpo">
          <div className="flex flex-wrap items-center gap-2">
            {faixa
              ? <span className="text-[13px] font-semibold">Leads que chegaram {faixa.rotulo}</span>
              : PERIODOS.map((p) => (
                <button key={p.id} type="button" className="slad-chip" aria-pressed={periodo === p.id} onClick={() => setPeriodo(p.id)}>{p.rot}</button>
              ))}
            {painel.gestor && painel.sdrs.length > 1 && (
              <select value={sdr} onChange={(e) => setSdr(e.target.value)} className="slad-chip" aria-label="Filtrar por SDR">
                <option value="">Time todo</option>
                {painel.sdrs.map((s) => <option key={s.sdr_id} value={s.sdr_id}>{s.nome}</option>)}
              </select>
            )}
            <span className="slad-sub" style={{ marginLeft: "auto" }}>
              {atendidos.length} atendido{atendidos.length !== 1 ? "s" : ""} · {noPrazo} no prazo
              {esperando.length > 0 && <> · <b style={{ color: "var(--danger)" }}>{esperando.length} esperando</b></>}
              {marcadas.length > 0 && <> · {marcadas.length} com ligação marcada</>}
            </span>
          </div>

          {esperando.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-[13px] font-semibold" style={{ color: "var(--danger)" }}>Ainda sem nenhuma interação</div>
              <table>
                <thead><tr><th>Cliente</th>{painel.gestor && <th>SDR</th>}<th>Chegou</th><th>Esperando há</th></tr></thead>
                <tbody>
                  {esperando.map((a) => {
                    const t = tomEspera(a.minutos, meta);
                    return (
                      <tr key={a.lead_id} onClick={() => abrir(a.lead_id)}>
                        <td className="font-medium">
                          {a.nome || "Sem nome"}
                          {a.sem_tarefa && (
                            <span className="slad-selo" title="Este lead não tem nenhuma tarefa aberta, então não aparece na Fila do SDR. Abra o lead e crie uma tarefa ou dê o desfecho.">sem tarefa</span>
                          )}
                        </td>
                        {painel.gestor && <td>{a.sdr_nome}</td>}
                        <td>
                          {dataHora(a.chegou_em)}
                          {a.marcada_para && <div className="slad-sub">ligação marcada {dataHora(a.marcada_para)}</div>}
                        </td>
                        <td><b style={{ color: COR[t] }}>{minutosTxt(a.minutos)}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {marcadas.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-[13px] font-semibold">Ligação marcada pelo cliente (a hora ainda não chegou)</div>
              <div className="slad-sub">Não conta como espera. Se ninguém ligar até a hora marcada, o lead passa para a lista de cima.</div>
              <table>
                <thead><tr><th>Cliente</th>{painel.gestor && <th>SDR</th>}<th>Chegou</th><th>Marcou para</th></tr></thead>
                <tbody>
                  {marcadas.map((a) => (
                    <tr key={a.lead_id + a.chegou_em} onClick={() => abrir(a.lead_id)}>
                      <td className="font-medium">{a.nome || "Sem nome"}</td>
                      {painel.gestor && <td>{a.sdr_nome}</td>}
                      <td>{dataHora(a.chegou_em)}</td>
                      <td><b>{dataHora(a.marcada_para)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <div className="text-[13px] font-semibold">Atendidos</div>
            {atendidos.length === 0 ? (
              <div className="slad-sub py-4">Nenhum lead novo atendido neste período.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    {painel.gestor && <th>SDR</th>}
                    <th>
                      <button type="button" className="slad-th-btn" onClick={() => setOrdem("recentes")} aria-pressed={ordem === "recentes"}>
                        Chegou{ordem === "recentes" ? " ↓" : ""}
                      </button>
                    </th>
                    <th>1ª interação</th>
                    <th className="slad-esconde">Por onde</th>
                    <th>
                      <button type="button" className="slad-th-btn" onClick={() => setOrdem("demorados")} aria-pressed={ordem === "demorados"}>
                        Espera útil{ordem === "demorados" ? " ↓" : ""}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {atendidos.map((a) => {
                    const t: TomSla = a.minutos > meta ? "danger" : "ok";
                    return (
                      <tr key={a.lead_id + a.chegou_em} onClick={() => abrir(a.lead_id)}>
                        <td className="font-medium">{a.nome || "Sem nome"}</td>
                        {painel.gestor && <td>{a.sdr_nome}</td>}
                        <td>{dataHora(a.chegou_em)}</td>
                        <td>{dataHora(a.atendido_em)}</td>
                        <td className="slad-esconde">{ROTULO_CANAL[a.canal] ?? a.canal}</td>
                        <td>
                          <b style={{ color: COR[t] }}>{minutosTxt(a.minutos)}</b>
                          <div className="slad-sub">
                            {a.marcada_para
                              ? new Date(a.atendido_em) < new Date(a.marcada_para) ? "antes da hora marcada" : "desde a hora marcada"
                              : `relógio ${corridoTxt(corridoMin(a.chegou_em, a.atendido_em))}`}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
