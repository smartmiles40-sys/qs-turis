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
import { ORDEM_ANOS, ROTULO_ANO, grupoAno, periodo, porInicio, type GrupoAno, type LinhaExp } from "./linhas";

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
  // Bruno, 29/10: "as que já foram precisam ir para Concluídas" e "aparecer
  // todas, não só 2026". Em cima, as que vêm pela frente separadas por ano
  // (2026, 2027, Futuras); embaixo, o bloco Concluídas (mais recente primeiro,
  // também por ano: 2026, 2025, Anteriores); por último, as canceladas.
  const ordenadas = ordenar(linhas);
  const pelaFrente = ordenadas.filter((l) => !l.cancelada && l.fase !== "concluida");
  const concluidas = ordenadas.filter((l) => !l.cancelada && l.fase === "concluida");
  const canceladas = ordenadas.filter((l) => l.cancelada);
  const cartoes = (ls: LinhaExp[]) => (
    <ul className="cx-cards">
      {ls.map((l) => <Cartao key={l.e.id} l={l} proxima={l.e.id === proximaId} abrir={abrir} acoes={acoes} />)}
    </ul>
  );
  return (
    <div className="cx-anos">
      {porAno(pelaFrente, ORDEM_ANOS).map(([g, ls]) => (
        <section key={g} className="cx-ano" aria-label={ROTULO_ANO[g]}>
          <h2 className="cx-ano__h">{ROTULO_ANO[g]}<span className="cx-sec__n">{ls.length}</span></h2>
          {cartoes(ls)}
        </section>
      ))}
      {concluidas.length > 0 && (
        <section className="cx-ano cx-ano--fim" aria-label="Expedições concluídas">
          <h2 className="cx-ano__h">Concluídas<span className="cx-sec__n">{concluidas.length}</span></h2>
          {porAno(concluidas, ["futuras", "2027", "2026", "2025", "anteriores", "sem_data"]).map(([g, ls]) => (
            <div key={g} className="cx-ano">
              <h3 className="cx-ano__sub">{ROTULO_ANO[g]} · {ls.length}</h3>
              {cartoes(ls)}
            </div>
          ))}
        </section>
      )}
      {canceladas.length > 0 && (
        <section className="cx-ano cx-ano--fim" aria-label="Expedições canceladas">
          <h2 className="cx-ano__h">Canceladas<span className="cx-sec__n">{canceladas.length}</span></h2>
          {cartoes(canceladas)}
        </section>
      )}
    </div>
  );
}

/** Agrupa por ano de embarque, na ordem pedida, pulando anos vazios. */
function porAno(ls: LinhaExp[], ordem: GrupoAno[]): [GrupoAno, LinhaExp[]][] {
  const m = new Map<GrupoAno, LinhaExp[]>();
  for (const l of ls) m.set(grupoAno(l), [...(m.get(grupoAno(l)) ?? []), l]);
  return ordem.filter((g) => m.has(g)).map((g) => [g, m.get(g)!]);
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
