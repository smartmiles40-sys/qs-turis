// src/expedicoes/lista/central/VisaoFases.tsx
// Visão "Por fase" da Central (spec §2.4): uma seção recolhível por fase, na
// ordem Em viagem → Embarque → Preparação → Vendas abertas → Concluídas. Cada
// expedição é UMA linha (grid de 6 colunas + ações), e a linha inteira abre o
// cockpit. 29/10 (Bruno: "todas visíveis, sem poluir"): nenhuma seção começa
// recolhida (dá pra recolher, e isso fica no localStorage), Canceladas viram a
// última seção, e a coluna de alertas deu lugar ao STATUS da expedição.
import { useEffect, useRef, useState, type KeyboardEvent as KE } from "react";
import { META_FASE, ORDEM_FASES, type Fase } from "../../lib/fase.ts";
import { STATUS_EXPEDICAO } from "../../lib/constants";
import type { StatusExpedicao } from "../../lib/database";
import { porInicio, periodo, type LinhaExp } from "./linhas";

// Chave nova (v2): quem tinha "Concluídas" recolhida pela regra antiga volta a ver tudo.
const CHAVE_RECOLHIDAS = "qs:exp:central:recolhidas:v2";
type Secao = Fase | "cancelada";

function lerRecolhidas(): Set<Secao> {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_RECOLHIDAS) ?? "null");
    if (Array.isArray(v)) return new Set(v.filter((f): f is Secao => f === "cancelada" || ORDEM_FASES.includes(f)));
  } catch { /* sem localStorage: tudo aberto */ }
  return new Set();
}

const META_CANCELADA = { rotulo: "Canceladas", dica: "Não acontecem mais; ficam aqui pra consulta", cor: "var(--danger)", metrica: "Andamento" };

/** Tom do chip de status manual (Vendas Abertas, Em andamento, Concluída…). */
function tomDoStatus(status: string): { background: string; color: string } {
  const s = status.toLowerCase();
  if (s.includes("cancel")) return { background: "var(--danger-bg)", color: "var(--danger)" };
  if (s.includes("conclu")) return { background: "var(--fase-concluida-bg)", color: "var(--fase-concluida-fg)" };
  if (s.includes("andamento")) return { background: "var(--fase-viagem-bg)", color: "var(--fase-viagem-fg)" };
  return { background: "var(--surface-2)", color: "var(--muted)" };
}

export interface AcoesDaLinha {
  onEditar: (l: LinhaExp) => void;
  onStatus: (l: LinhaExp, s: StatusExpedicao) => void;
  onExcluir: (l: LinhaExp) => void;
}

export default function VisaoFases({ linhas, canceladas, proximaId, abrir, acoes }: {
  linhas: LinhaExp[];
  /** Vão na última seção, "Canceladas". */
  canceladas: LinhaExp[];
  proximaId: string | null;
  abrir: (id: string) => void;
  /** null = modo leitura (sem coluna de ações). */
  acoes: AcoesDaLinha | null;
}) {
  const [recolhidas, setRecolhidas] = useState<Set<Secao>>(lerRecolhidas);
  const alternar = (f: Secao) => setRecolhidas((r) => {
    const n = new Set(r);
    if (n.has(f)) n.delete(f); else n.add(f);
    try { localStorage.setItem(CHAVE_RECOLHIDAS, JSON.stringify([...n])); } catch { /* ignora */ }
    return n;
  });

  const secoes: { fase: Secao; itens: LinhaExp[] }[] = [
    ...ORDEM_FASES.map((f) => ({ fase: f as Secao, itens: linhas.filter((l) => l.fase === f).sort(porInicio) })),
    { fase: "cancelada" as Secao, itens: [...canceladas].sort(porInicio) },
  ].filter((s) => s.itens.length);
  if (!secoes.length) return <div className="cx-sec cx-vazio">Nenhuma expedição com os filtros atuais.</div>;

  return (
    <div className="cx-secs">
      {secoes.map(({ fase, itens }) => {
        const m = fase === "cancelada" ? META_CANCELADA : META_FASE[fase];
        const aberta = !recolhidas.has(fase);
        const idCorpo = `cx-sec-${fase}`;
        return (
          <section key={fase} className="cx-sec" aria-label={m.rotulo}>
            <button type="button" className="cx-sec__h" onClick={() => alternar(fase)} aria-expanded={aberta} aria-controls={idCorpo}>
              <span className="cx-dot cx-dot--lg" style={{ background: m.cor }} aria-hidden />
              <span className="cx-sec__t">{m.rotulo}</span>
              <span className="cx-sec__n">{itens.length}</span>
              <span className="cx-sec__dica">{m.dica}</span>
              <span className="cx-sec__tg">{aberta ? "Recolher" : "Ver todas"}</span>
            </button>
            {aberta && (
              <div className="cx-scroll" id={idCorpo}>
                <div className="cx-wrap-grid" role="table" aria-label={`Expedições: ${m.rotulo}`}>
                  <div className={`cx-grid cx-grid--cab${acoes ? "" : " cx-grid--ro"}`} role="row">
                    {["Expedição", "Datas", "Saída", "Ocupação", m.metrica, "Status"].map((h) => <span key={h} role="columnheader">{h}</span>)}
                    {acoes && <span role="columnheader"><span className="sr-only">Ações</span></span>}
                  </div>
                  {itens.map((l) => (
                    <LinhaFase key={l.e.id} l={l} proxima={l.e.id === proximaId} abrir={abrir} acoes={acoes} />
                  ))}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Barra({ frac, cor }: { frac: number; cor: string }) {
  return <div className="cx-barra" aria-hidden><span style={{ width: `${Math.max(2, Math.round(frac * 100))}%`, background: cor }} /></div>;
}

/** Chip da coluna "Saída". */
export function ChipSaida({ l }: { l: LinhaExp }) {
  const { fase, inf } = l;
  if (fase === "em_viagem") return <span className="cx-chip" style={{ background: "var(--fase-viagem-bg)", color: "var(--fase-viagem-fg)" }}>Dia {inf.diaDaViagem} de {inf.totalDias}</span>;
  if (fase === "concluida") return <span className="cx-chip" style={{ background: "var(--fase-concluida-bg)", color: "var(--fase-concluida-fg)" }}>Voltou</span>;
  if (!l.e.data_embarque) return <span className="cx-chip">Sem data</span>;
  const estilo = fase === "embarque" ? { background: "var(--fase-embarque-bg)", color: "var(--fase-embarque-fg)" } : undefined;
  return <span className="cx-chip" style={estilo}>em {inf.diasParaInicio}d</span>;
}

function LinhaFase({ l, proxima, abrir, acoes }: {
  l: LinhaExp; proxima: boolean; abrir: (id: string) => void; acoes: AcoesDaLinha | null;
}) {
  const { e, fase, inf } = l;
  const tecla = (ev: KE) => { if (ev.key === "Enter" && ev.target === ev.currentTarget) abrir(e.id); };

  // 5ª coluna: métrica da fase
  let metrica: { v: string; s: string; frac: number | null; cor: string; vermelho?: boolean };
  if (l.cancelada) {
    metrica = { v: "Cancelada", s: e.pax_confirmados ? `${e.pax_confirmados} pax tinham fechado` : "", frac: null, cor: "" };
  } else if (fase === "em_viagem") {
    metrica = { v: inf.diasParaFim === 0 ? "Volta hoje" : `Volta em ${inf.diasParaFim} ${inf.diasParaFim === 1 ? "dia" : "dias"}`, s: `${inf.totalDias} dias no total`, frac: inf.progresso, cor: "var(--fase-viagem)" };
  } else if (fase === "embarque" || fase === "preparacao") {
    const total = e.prontidao_total;
    const vermelho = fase === "embarque" && (l.aptos ?? 0) < 0.5 && total > 0;
    metrica = total
      ? { v: `${e.prontidao_aptos} de ${total} aptos`, s: `${total - e.prontidao_aptos} pendentes`, frac: l.aptos ?? 0, cor: vermelho ? "var(--danger)" : "var(--fase-preparacao)", vermelho }
      : { v: "Sem passageiros", s: "", frac: null, cor: "" };
  } else if (fase === "vendendo") {
    metrica = { v: l.vagasLivres === 0 ? "Esgotada" : `${l.vagasLivres} ${l.vagasLivres === 1 ? "vaga" : "vagas"}`, s: l.vagasLivres === 0 ? "" : "para vender", frac: null, cor: "" };
  } else {
    metrica = { v: "Concluída", s: `${e.prontidao_total} embarcaram`, frac: null, cor: "" };
  }

  return (
    <div className={`cx-grid cx-row${acoes ? "" : " cx-grid--ro"}`} role="row" tabIndex={0} onClick={() => abrir(e.id)} onKeyDown={tecla}
      aria-label={`Abrir ${l.base}${l.grupo ? ` ${l.grupo}` : ""}`}>
      <div className="cx-nome" role="cell">
        <div className="cx-nome__l">
          <span className="cx-nome__t">{l.base}</span>
          {l.grupo && <span className="cx-gr">{l.grupo}</span>}
          {proxima && <span className="cx-prox" title="Próxima expedição a embarcar">★ Próxima</span>}
        </div>
        <span className="cx-cod">{e.codigo}</span>
      </div>
      <span className="cx-datas" role="cell">{periodo(l)}</span>
      <span role="cell"><ChipSaida l={l} /></span>
      <div className="cx-met" role="cell">
        <div className="cx-met__l"><span className="cx-met__v">{e.pax_confirmados}/{e.pax_planejados} pax</span><span className="cx-met__s">{Math.round(l.ocupacao * 100)}%</span></div>
        <Barra frac={l.ocupacao} cor="var(--text)" />
      </div>
      <div className="cx-met" role="cell">
        <div className="cx-met__l">
          <span className="cx-met__v" style={metrica.vermelho ? { color: "var(--danger)" } : undefined}>{metrica.v}</span>
          {metrica.s && <span className="cx-met__s">{metrica.s}</span>}
        </div>
        {metrica.frac != null && <Barra frac={metrica.frac} cor={metrica.cor} />}
      </div>
      <span role="cell">
        <span className="cx-alerta" style={tomDoStatus(e.status ?? "")}>{e.status || "Sem status"}</span>
      </span>
      {acoes && <span role="cell" onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}><MenuLinha l={l} acoes={acoes} /></span>}
    </div>
  );
}

/** "⋯" da linha: Editar, Mudar status, Excluir (as ações da lista antiga). */
export function MenuLinha({ l, acoes }: { l: LinhaExp; acoes: AcoesDaLinha }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    raiz.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);
  const item = (rotulo: string, f: () => void, perigo = false) => (
    <button type="button" role="menuitem" className="qs-menu__i" style={perigo ? { color: "var(--danger)" } : undefined}
      onClick={() => { setAberto(false); f(); }}>{rotulo}</button>
  );
  return (
    <span className="qs-menu" ref={raiz}>
      <button type="button" className="cx-ico" aria-haspopup="menu" aria-expanded={aberto} aria-label={`Ações de ${l.e.nome}`} onClick={() => setAberto((a) => !a)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {aberto && (
        <div role="menu" className="qs-menu__pop" style={{ minWidth: 200 }}>
          {item("Editar", () => acoes.onEditar(l))}
          <div role="group" aria-label="Status">
            <div className="qs-menu__g">Status (atual: {l.e.status})</div>
            {STATUS_EXPEDICAO.filter((s) => s !== l.e.status).map((s) => <span key={s}>{item(s, () => acoes.onStatus(l, s))}</span>)}
          </div>
          <div className="qs-menu__g">Outras</div>
          {item("Excluir…", () => acoes.onExcluir(l), true)}
        </div>
      )}
    </span>
  );
}
