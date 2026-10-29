// src/expedicoes/lista/central/VisaoTabela.tsx
// Visão "Tabela" da Central (spec §2.6): Expedição, Código, Datas, Fase, Pax,
// Aptos — ordenável por coluna (ordem vai pra URL). Guarda também as ações da
// tabela antiga: status direto na célula, editar, excluir e ARRASTAR pra
// reordenar (só quando a ordenação é "Ordem manual", a coluna #).
import type { KeyboardEvent as KE } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { META_FASE } from "../../lib/fase.ts";
import { STATUS_EXPEDICAO } from "../../lib/constants";
import type { StatusExpedicao } from "../../lib/database";
import { CelulaEscolha, PilulaStatus } from "../../ui";
import { periodo, porInicio, type ColTabela, type LinhaExp, type Ordenacao } from "./linhas";
import type { AcoesDaLinha } from "./menu";

const PESO_FASE = { em_viagem: 0, embarque: 1, preparacao: 2, vendendo: 3, concluida: 4 } as const;

function comparar(col: ColTabela, ordemDe: Map<string, number>) {
  return (a: LinhaExp, b: LinhaExp): number => {
    switch (col) {
      case "ordem": return (ordemDe.get(a.e.id) ?? 0) - (ordemDe.get(b.e.id) ?? 0);
      case "nome": return a.base.localeCompare(b.base, "pt-BR") || (a.grupo ?? "").localeCompare(b.grupo ?? "", undefined, { numeric: true });
      case "codigo": return a.e.codigo.localeCompare(b.e.codigo);
      case "datas": return porInicio(a, b);
      case "fase": return (a.cancelada ? 9 : PESO_FASE[a.fase]) - (b.cancelada ? 9 : PESO_FASE[b.fase]) || porInicio(a, b);
      case "status": return a.e.status.localeCompare(b.e.status, "pt-BR") || porInicio(a, b);
      case "pax": return a.e.pax_confirmados - b.e.pax_confirmados || a.ocupacao - b.ocupacao;
      case "aptos": return (a.aptos ?? -1) - (b.aptos ?? -1) || a.e.prontidao_aptos - b.e.prontidao_aptos;
    }
  };
}

export default function VisaoTabela({ linhas, ordemDe, ordenacao, onOrdenar, abrir, acoes, proximaId, onReordenar, podeArrastar }: {
  linhas: LinhaExp[];
  /** Posição de cada expedição na ordem manual (coluna `ordem`). */
  ordemDe: Map<string, number>;
  ordenacao: Ordenacao;
  onOrdenar: (o: Ordenacao) => void;
  abrir: (id: string) => void;
  acoes: AcoesDaLinha | null;
  proximaId: string | null;
  onReordenar: (idsVisiveis: string[]) => void;
  /** Arrastar só faz sentido sem busca/filtro (senão a ordem global fica estranha). */
  podeArrastar: boolean;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const cmp = comparar(ordenacao.col, ordemDe);
  const ordenadas = [...linhas].sort((a, b) => (ordenacao.dir === "asc" ? cmp(a, b) : -cmp(a, b)));
  const arrastavel = !!acoes && ordenacao.col === "ordem" && ordenacao.dir === "asc" && podeArrastar;
  const ids = ordenadas.map((l) => l.e.id);
  const fimArraste = (ev: DragEndEvent) => {
    if (!ev.over || ev.active.id === ev.over.id) return;
    onReordenar(arrayMove(ids, ids.indexOf(String(ev.active.id)), ids.indexOf(String(ev.over.id))));
  };

  const Cab = ({ col, children }: { col: ColTabela; children: string }) => {
    const ativa = ordenacao.col === col;
    return (
      <th aria-sort={ativa ? (ordenacao.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => onOrdenar({ col, dir: ativa && ordenacao.dir === "asc" ? "desc" : "asc" })}>
          {children}<span aria-hidden style={{ opacity: ativa ? 1 : 0.3 }}>{ativa && ordenacao.dir === "desc" ? "▼" : "▲"}</span>
        </button>
      </th>
    );
  };

  if (!ordenadas.length) return <div className="cx-tab cx-vazio">Nenhuma expedição com os filtros atuais.</div>;
  return (
    <>
      {ordenacao.col === "ordem" && acoes && !podeArrastar && (
        <p className="cx-nota">Pra arrastar e mudar a ordem manual, limpe a busca e os filtros.</p>
      )}
      <div className="cx-tab">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={fimArraste}>
          <table>
            <thead>
              <tr>
                <Cab col="ordem">#</Cab>
                <Cab col="nome">Expedição</Cab>
                <Cab col="codigo">Código</Cab>
                <Cab col="datas">Datas</Cab>
                <Cab col="fase">Fase</Cab>
                <Cab col="status">Status</Cab>
                <Cab col="pax">Pax</Cab>
                <Cab col="aptos">Aptos</Cab>
                {acoes && <th><span className="sr-only">Ações</span></th>}
              </tr>
            </thead>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <tbody>
                {ordenadas.map((l) => (
                  <LinhaTabela key={l.e.id} l={l} n={(ordemDe.get(l.e.id) ?? 0) + 1} arrastavel={arrastavel} abrir={abrir} acoes={acoes} proxima={l.e.id === proximaId} />
                ))}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      </div>
    </>
  );
}

function LinhaTabela({ l, n, arrastavel, abrir, acoes, proxima }: {
  l: LinhaExp; n: number; arrastavel: boolean; abrir: (id: string) => void; acoes: AcoesDaLinha | null; proxima: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: l.e.id, disabled: !arrastavel });
  const m = META_FASE[l.fase];
  const tecla = (ev: KE) => { if (ev.key === "Enter" && ev.target === ev.currentTarget) abrir(l.e.id); };
  const pare = (ev: { stopPropagation: () => void }) => ev.stopPropagation();
  return (
    <tr ref={setNodeRef} tabIndex={0} onClick={() => abrir(l.e.id)} onKeyDown={tecla}
      style={{ transform: CSS.Transform.toString(transform), transition }}>
      <td style={{ width: 56, color: "var(--subtle)" }} onClick={arrastavel ? pare : undefined}>
        {arrastavel
          ? <span {...attributes} {...listeners} className="cx-arrasta" aria-label={`Arrastar ${l.e.nome}`}>⠿ {n}</span>
          : n}
      </td>
      <td style={{ fontWeight: 600 }}>
        {l.base}{l.grupo && <span className="cx-gr" style={{ marginLeft: 8 }}>{l.grupo}</span>}
        {proxima && <span className="cx-prox" style={{ marginLeft: 8 }}>★ Próxima</span>}
      </td>
      <td className="cx-cod">{l.e.codigo}</td>
      <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{periodo(l)}</td>
      <td>
        {l.cancelada
          ? <span className="cx-chip" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>Cancelada</span>
          : <span className="cx-chip" style={{ background: m.bg, color: m.fg }}>{m.curto}</span>}
      </td>
      <td onClick={pare}>
        {acoes
          ? <CelulaEscolha valor={l.e.status as StatusExpedicao} opcoes={STATUS_EXPEDICAO} rotulo="Mudar status"
              onSalvar={async (s) => acoes.onStatus(l, s)} render={(v) => <PilulaStatus status={v ?? ""} />} />
          : <PilulaStatus status={l.e.status} />}
      </td>
      <td style={{ whiteSpace: "nowrap" }}>{l.e.pax_confirmados}/{l.e.pax_planejados}</td>
      <td style={{ whiteSpace: "nowrap" }}>{l.e.prontidao_total ? `${l.e.prontidao_aptos}/${l.e.prontidao_total}` : "—"}</td>
      {acoes && (
        <td onClick={pare} style={{ width: 80 }}>
          <span className="cx-acoes">
            <button type="button" className="cx-ico" aria-label={`Editar ${l.e.nome}`} title="Editar" onClick={() => acoes.onEditar(l)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
            </button>
            <button type="button" className="cx-ico" aria-label={`Excluir ${l.e.nome}`} title="Excluir" onClick={() => acoes.onExcluir(l)} style={{ color: "var(--danger)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
            </button>
          </span>
        </td>
      )}
    </tr>
  );
}
