// src/expedicoes/lista/central/VisaoLinha.tsx
// Visão "Linha do tempo" da Central (spec §2.5): Gantt com coluna fixa de nomes
// (280px), eixo de meses do mês atual até o fim do ano seguinte, uma linha por
// expedição NÃO concluída, barra pelas datas e na cor da fase, risco vermelho
// em hoje. Rola na horizontal por dentro.
// TODO (spec, não agora): agrupar por destino e marcar sobreposição de líderes.
import type { KeyboardEvent as KE } from "react";
import { META_FASE, diasEntre, type Fase } from "../../lib/fase.ts";
import { porInicio, periodo, type LinhaExp } from "./linhas";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const LEGENDA: Fase[] = ["em_viagem", "embarque", "preparacao", "vendendo"];
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export default function VisaoLinha({ linhas, hoje, abrir }: { linhas: LinhaExp[]; hoje: string; abrir: (id: string) => void }) {
  const ano = Number(hoje.slice(0, 4));
  const mes0 = Number(hoje.slice(5, 7)) - 1;
  const ini = iso(ano, mes0, 1);
  const fim = iso(ano + 1, 11, 31);
  const total = diasEntre(ini, fim) + 1;
  const pct = (d: string) => Math.max(0, Math.min(100, (diasEntre(ini, d) / total) * 100));

  // meses do eixo, cada um com a largura proporcional aos dias
  const meses: { rotulo: string; dias: number }[] = [];
  for (let y = ano, m = mes0; y < ano + 1 || (y === ano + 1 && m <= 11);) {
    const dias = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    meses.push({ rotulo: `${MESES[m]}${m === mes0 && y === ano ? ` ${String(y).slice(2)}` : m === 0 ? ` ${String(y).slice(2)}` : ""}`, dias });
    m++; if (m > 11) { m = 0; y++; }
  }

  const visiveis = linhas.filter((l) => l.fase !== "concluida" && l.e.data_embarque && !l.cancelada).sort(porInicio);
  const hojePct = pct(hoje);
  const tecla = (id: string) => (ev: KE) => { if (ev.key === "Enter") abrir(id); };

  return (
    <section className="qs-card2 cx-gantt" aria-label="Linha do tempo das expedições">
      <div className="cx-legenda">
        <b>Legenda</b>
        {LEGENDA.map((f) => <span key={f}><span className="cx-sw" style={{ background: META_FASE[f].cor }} aria-hidden />{META_FASE[f].rotulo}</span>)}
        <span><span aria-hidden style={{ width: 2, height: 14, background: "var(--danger)", display: "inline-block" }} />Hoje</span>
      </div>
      {!visiveis.length ? <p className="cx-vazio">Nenhuma expedição em aberto com os filtros atuais.</p> : (
        <div className="cx-gantt__sc">
          <div className="cx-gantt__in">
            <div className="cx-gantt__meses">
              <div className="cx-gantt__nomecol" />
              <div className="cx-gantt__eixo" style={{ gridTemplateColumns: meses.map((m) => `${m.dias}fr`).join(" ") }}>
                {meses.map((m, i) => <span key={i} className="cx-gantt__mes">{m.rotulo}</span>)}
              </div>
            </div>
            {visiveis.map((l) => {
              const a = pct(l.e.data_embarque), b = pct(l.e.data_retorno ?? l.e.data_embarque);
              const fora = diasEntre(fim, l.e.data_embarque) > 0;
              return (
                <div key={l.e.id} className="cx-gantt__row" role="link" tabIndex={0} onClick={() => abrir(l.e.id)} onKeyDown={tecla(l.e.id)}
                  aria-label={`Abrir ${l.base}${l.grupo ? ` ${l.grupo}` : ""}`}>
                  <div className="cx-gantt__nome">
                    <b>{l.base}{l.grupo ? ` ${l.grupo}` : ""}</b>
                    <span>{periodo(l)} · {l.e.pax_confirmados}/{l.e.pax_planejados} pax{fora ? " · depois do eixo" : ""}</span>
                  </div>
                  <div className="cx-gantt__pista">
                    <div className="cx-gantt__hoje" style={{ left: `${hojePct}%` }} aria-hidden />
                    {!fora && <div className="cx-gantt__barra" title={`${META_FASE[l.fase].curto}: ${periodo(l)}`}
                      style={{ left: `${a}%`, width: `${Math.max(0.6, b - a)}%`, background: META_FASE[l.fase].cor }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
