// src/expedicoes/lista/central/VisaoCartoes.tsx
// Visão "Cartões" da Central (Bruno, 29/10): "tem que ser algo de fácil acesso,
// entrar fácil e fazer as alterações de forma rápida — uma expedição do lado da
// outra, só com as informações principais". Grade de cartões: nome + grupo,
// código e destino, datas, andamento (fase) e ocupação. Clicar abre o cockpit;
// o "⋯" tem Editar, Status e Excluir (as mesmas ações da Tabela).
//
// Ordem: as que vêm pela frente (em viagem → embarque → preparação → vendendo,
// por data de saída), depois as concluídas (mais recente primeiro) e, por
// último, as canceladas.
import type { KeyboardEvent as KE } from "react";
import { META_FASE, ORDEM_FASES } from "../../lib/fase.ts";
import { MenuLinha, type AcoesDaLinha } from "./menu";
import { periodo, porInicio, type LinhaExp } from "./linhas";

function ordenar(linhas: LinhaExp[]): LinhaExp[] {
  const rank = (l: LinhaExp) => (l.cancelada ? 99 : ORDEM_FASES.indexOf(l.fase));
  return [...linhas].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    // Concluídas e canceladas: a mais recente primeiro.
    return a.fase === "concluida" || a.cancelada ? porInicio(b, a) : porInicio(a, b);
  });
}

/** Andamento em uma frase, na cor da fase. */
function andamento(l: LinhaExp): { t: string; bg: string; fg: string } {
  if (l.cancelada) return { t: "Cancelada", bg: "var(--danger-bg)", fg: "var(--danger)" };
  const m = META_FASE[l.fase];
  const { inf } = l;
  const cor = { bg: m.bg, fg: m.fg };
  if (l.fase === "em_viagem") return { t: `Em viagem · dia ${inf.diaDaViagem} de ${inf.totalDias}`, ...cor };
  if (l.fase === "concluida") return { t: "Concluída", ...cor };
  if (!l.e.data_embarque) return { t: `${m.curto} · sem data`, ...cor };
  const d = inf.diasParaInicio;
  const quando = d === 0 ? "embarca hoje" : `embarca em ${d} ${d === 1 ? "dia" : "dias"}`;
  return { t: l.fase === "vendendo" ? `Vendendo · ${quando}` : l.fase === "preparacao" ? `Preparação · ${quando}` : quando[0].toUpperCase() + quando.slice(1), ...cor };
}

export default function VisaoCartoes({ linhas, proximaId, abrir, acoes }: {
  linhas: LinhaExp[];
  proximaId: string | null;
  abrir: (id: string) => void;
  /** null = modo leitura (sem "⋯"). */
  acoes: AcoesDaLinha | null;
}) {
  if (!linhas.length) return <div className="cx-sec cx-vazio">Nenhuma expedição com essa busca.</div>;
  return (
    <ul className="cx-cards" aria-label="Expedições">
      {ordenar(linhas).map((l) => <Cartao key={l.e.id} l={l} proxima={l.e.id === proximaId} abrir={abrir} acoes={acoes} />)}
    </ul>
  );
}

function Cartao({ l, proxima, abrir, acoes }: { l: LinhaExp; proxima: boolean; abrir: (id: string) => void; acoes: AcoesDaLinha | null }) {
  const { e } = l;
  const a = andamento(l);
  const tecla = (ev: KE) => { if (ev.key === "Enter" && ev.target === ev.currentTarget) abrir(e.id); };
  const apagado = l.cancelada || l.fase === "concluida";
  return (
    <li className={`cx-card${apagado ? " cx-card--fim" : ""}`} tabIndex={0} onClick={() => abrir(e.id)} onKeyDown={tecla}
      aria-label={`Abrir ${l.base}${l.grupo ? ` ${l.grupo}` : ""}`}>
      <div className="cx-card__h">
        <div className="cx-card__nome">
          <span className="cx-card__t">{l.base}</span>
          {l.grupo && <span className="cx-gr">{l.grupo}</span>}
        </div>
        {acoes && <span onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}><MenuLinha l={l} acoes={acoes} /></span>}
      </div>
      <div className="cx-card__meta">
        <span className="cx-cod">{e.codigo}</span>
        {e.destino && <span>· {e.destino}</span>}
        {proxima && <span className="cx-prox" title="Próxima expedição a embarcar">★ Próxima</span>}
      </div>
      <div className="cx-card__datas">{periodo(l)}</div>
      <span className="cx-chip" style={{ background: a.bg, color: a.fg }}>{a.t}</span>
      <div className="cx-card__oc">
        <div className="cx-card__ocl">
          <span>{e.pax_confirmados}/{e.pax_planejados} pax</span>
          <span>{l.vagasLivres ? `${l.vagasLivres} ${l.vagasLivres === 1 ? "vaga" : "vagas"}` : e.pax_planejados ? "esgotada" : ""}</span>
        </div>
        <div className="cx-barra" aria-hidden><span style={{ width: `${Math.max(2, Math.round(l.ocupacao * 100))}%`, background: "var(--text)" }} /></div>
      </div>
    </li>
  );
}
