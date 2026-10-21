// src/expedicoes/checklist/Visoes.tsx
// As visões do checklist (app antigo: ChecklistTabela.tsx): triagem "Precisa de
// atenção", chips das fases, Timeline (tabela por fase com subtarefas), Gráfico
// (uma coluna por fase) e Kanban (por status, só leitura como no antigo).
// Novo no QS: arrastar pra reordenar processos dentro da fase e subtarefas dentro
// do processo; editar responsável, prazo, prioridade e tarefa direto na linha.
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar } from "@/rel/ui";
import { useExp } from "../contexto";
import { BotaoExcluir, CelulaEditavel, CelulaEscolha, Selo } from "../ui";
import { ETAPA_CHECKLIST, FASES_CHECKLIST, PRIORIDADE, STATUS_CHECKLIST } from "../lib/constants";
import { daysUntil, formatDate } from "../lib/utils";
import type { ChecklistItemRow, EtapaChecklist, Prioridade, StatusChecklist, UsuarioRow } from "../lib/database";
import { COR_PONTO, KANBAN_COLUNAS, TOM_PRIORIDADE, TOM_STATUS, excluirTarefa, salvarCampo } from "./dados";

type MapaUsuarios = Map<string, UsuarioRow>;

const primeiroNome = (u?: UsuarioRow) => (u?.nome ?? "?").split(" ")[0];

/* ───────────── Triagem ───────────── */

export function Triagem({ itens, usuarios }: { itens: ChecklistItemRow[]; usuarios: MapaUsuarios }) {
  const ativos = itens.filter((i) => i.status !== "Concluído");
  const comDias = ativos.map((it) => ({ it, dias: daysUntil(it.prazo) }));
  const atrasados = comDias.filter((a) => a.dias != null && a.dias < 0).sort((a, b) => (a.dias ?? 0) - (b.dias ?? 0));
  const vencendo = comDias.filter((a) => a.dias != null && a.dias >= 0 && a.dias <= 3).sort((a, b) => (a.dias ?? 0) - (b.dias ?? 0));
  const bloqueados = ativos.filter((i) => i.status === "Bloqueado");

  if (atrasados.length + vencendo.length + bloqueados.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold" style={{ background: "#DCFCE7", color: "#166534" }}>
        ✓ Tudo em dia — nenhum processo atrasado ou vencendo nos próximos dias. 🎉
      </div>
    );
  }
  const urgentes = [...atrasados, ...vencendo];
  const lista = urgentes.slice(0, 6);
  return (
    <section className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--err-line)", background: "var(--err-bg)" }}>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <span aria-hidden>⚠️</span>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>Precisa de atenção</h3>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {atrasados.length > 0 && <Selo tom="erro">{atrasados.length} atrasados</Selo>}
          {vencendo.length > 0 && <Selo tom="aviso">{vencendo.length} vencendo</Selo>}
          {bloqueados.length > 0 && <Selo tom="erro">{bloqueados.length} bloqueados</Selo>}
        </div>
      </div>
      <div className="mt-2 pb-1">
        {lista.map(({ it, dias }) => {
          const atrasado = dias != null && dias < 0;
          const resp = it.responsavel_id ? usuarios.get(it.responsavel_id) : undefined;
          return (
            <div key={it.id} className="flex items-center gap-2.5 px-4 py-1.5 text-[12.5px]" style={{ borderTop: "1px solid var(--line)" }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: atrasado ? "#DC2626" : "#D97706" }} />
              <span className="flex-1 min-w-0 truncate font-semibold" style={{ color: "var(--ink)" }}>{it.tarefa}</span>
              <span className="hidden sm:inline-flex"><Selo tom="lista">{it.etapa}</Selo></span>
              {resp && <span className="hidden sm:inline-flex"><Avatar nome={resp.nome} tamanho={20} /></span>}
              <span className="flex-shrink-0 font-bold tabular-nums" style={{ color: atrasado ? "var(--err-ink)" : "var(--warn-ink)" }}>
                {atrasado ? `${-(dias ?? 0)}d de atraso` : dias === 0 ? "vence hoje" : `vence em ${dias}d`}
              </span>
            </div>
          );
        })}
      </div>
      {urgentes.length > lista.length && <div className="px-4 pb-2 text-[11.5px]" style={{ color: "var(--ink3)" }}>+ {urgentes.length - lista.length} outro(s) na lista abaixo</div>}
    </section>
  );
}

/* ───────────── Chips das fases ───────────── */

export function ChipsFases({ itens, faseAtual }: { itens: ChecklistItemRow[]; faseAtual: EtapaChecklist | null }) {
  const idxAtual = faseAtual ? ETAPA_CHECKLIST.indexOf(faseAtual) : -1;
  const fases = FASES_CHECKLIST.filter((f) => itens.some((i) => i.etapa === f.etapa));
  if (!fases.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {fases.map((f) => {
        const its = itens.filter((i) => i.etapa === f.etapa);
        const feitos = its.filter((i) => i.status === "Concluído").length;
        const atual = f.etapa === faseAtual;
        const completa = feitos === its.length;
        const passada = idxAtual >= 0 && ETAPA_CHECKLIST.indexOf(f.etapa) < idxAtual;
        const estilo = atual ? { borderColor: "var(--rel)", background: "var(--rel-soft)", color: "var(--rel-ink)" }
          : completa ? { borderColor: "#86EFAC", background: "#DCFCE7", color: "#166534" }
            : passada ? { borderColor: "var(--line)", background: "var(--card2)", color: "var(--ink3)" }
              : { borderColor: "var(--line)", color: "var(--ink3)" };
        return (
          <span key={f.etapa} title={f.descricao} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px]" style={estilo}>
            {completa ? "✓" : <span className="w-1.5 h-1.5 rounded-full" style={{ background: atual ? "var(--rel)" : "var(--ink3)" }} />}
            <span className="font-semibold">{f.etapa}</span>
            <span className="tabular-nums opacity-75">{feitos}/{its.length}</span>
            {atual && <span className="rounded px-1 text-[9px] font-bold uppercase text-white" style={{ background: "var(--rel)" }}>agora</span>}
          </span>
        );
      })}
    </div>
  );
}

/* ───────────── Timeline (tabela) ───────────── */

function Barra({ feito, total }: { feito: number; total: number }) {
  const pct = total ? Math.round((feito / total) * 100) : 0;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-20 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: pct === 100 ? "#16A34A" : "var(--rel)" }} />
      </span>
      <span className="text-[10.5px] tabular-nums" style={{ color: "var(--ink3)" }}>{pct}%</span>
    </span>
  );
}

export function Tabela({ itens, usuarios, faseAtual, onMudou, onReordenar, onEditar, onSubtarefa }: {
  itens: ChecklistItemRow[]; usuarios: MapaUsuarios; faseAtual: EtapaChecklist | null; onMudou: () => void;
  onReordenar: (ids: string[]) => void; onEditar: (i: ChecklistItemRow) => void; onSubtarefa: (pai: ChecklistItemRow) => void;
}) {
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const filhosDe = useMemo(() => {
    const m = new Map<string, ChecklistItemRow[]>();
    for (const it of itens) if (it.parent_id) { const a = m.get(it.parent_id) ?? []; a.push(it); m.set(it.parent_id, a); }
    for (const a of m.values()) a.sort((x, y) => x.ordem - y.ordem || x.created_at.localeCompare(y.created_at));
    return m;
  }, [itens]);
  const grupos = useMemo(() => ETAPA_CHECKLIST.map((etapa) => ({
    etapa,
    descricao: FASES_CHECKLIST.find((f) => f.etapa === etapa)?.descricao ?? "",
    pais: itens.filter((i) => !i.parent_id && i.etapa === etapa).sort((a, b) => a.ordem - b.ordem || a.created_at.localeCompare(b.created_at)),
  })).filter((g) => g.pais.length > 0), [itens]);

  const alternar = (id: string) => setAbertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const todosAbertos = grupos.every((g) => g.pais.every((p) => !filhosDe.get(p.id)?.length || abertos.has(p.id)));

  const fimArraste = (ev: DragEndEvent) => {
    if (!ev.over || ev.active.id === ev.over.id) return;
    const a = itens.find((i) => i.id === ev.active.id);
    const b = itens.find((i) => i.id === ev.over!.id);
    if (!a || !b || a.parent_id !== b.parent_id || (!a.parent_id && a.etapa !== b.etapa)) return; // só dentro do mesmo grupo
    const irmaos = a.parent_id ? filhosDe.get(a.parent_id) ?? [] : grupos.find((g) => g.etapa === a.etapa)?.pais ?? [];
    const ids = irmaos.map((i) => i.id);
    onReordenar(arrayMove(ids, ids.indexOf(a.id), ids.indexOf(b.id)));
  };

  return (
    <div className="rel-card overflow-hidden">
      <div className="flex justify-end px-3 py-1.5" style={{ borderBottom: "1px solid var(--line)" }}>
        <button className="text-[11.5px] font-semibold" style={{ color: "var(--rel-ink)" }}
          onClick={() => setAbertos(todosAbertos ? new Set() : new Set(itens.filter((i) => filhosDe.get(i.id)?.length).map((i) => i.id)))}>
          {todosAbertos ? "Recolher subtarefas" : "Abrir todas as subtarefas"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={fimArraste}>
          <table className="w-full text-[12.5px]" style={{ minWidth: 980 }}>
            <thead style={{ background: "var(--card2)" }}>
              <tr>
                {["", "Processo", "Responsável", "Prazo", "Dias", "Prioridade", "Status", "Observações", ""].map((h, i) => (
                  <th key={i} className={`px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${h === "Dias" ? "text-right" : "text-left"}`} style={{ color: "var(--ink3)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos.map(({ etapa, descricao, pais }) => {
                const feitos = pais.filter((i) => i.status === "Concluído").length;
                const atual = etapa === faseAtual;
                return (
                  <Fragment key={etapa}>
                    <tr style={{ background: atual ? "var(--rel-soft)" : "var(--card2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
                      <td colSpan={9} className="px-2.5 py-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-[12.5px]" style={{ color: "var(--ink)" }}>{etapa}</span>
                            {atual && <Selo tom="ok">fase atual</Selo>}
                            <span className="truncate text-[11.5px]" style={{ color: "var(--ink3)" }}>{descricao}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[11px] tabular-nums" style={{ color: "var(--ink3)" }}>{feitos}/{pais.length}</span>
                            <Barra feito={feitos} total={pais.length} />
                          </div>
                        </div>
                      </td>
                    </tr>
                    <SortableContext items={pais.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                      {pais.map((it) => {
                        const filhos = filhosDe.get(it.id) ?? [];
                        const aberto = abertos.has(it.id);
                        return (
                          <Fragment key={it.id}>
                            <Linha it={it} filhos={filhos} aberto={aberto} onAlternar={() => alternar(it.id)} usuarios={usuarios}
                              onMudou={onMudou} onEditar={onEditar} onSubtarefa={onSubtarefa} />
                            {aberto && (
                              <SortableContext items={filhos.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                                {filhos.map((s) => (
                                  <Linha key={s.id} it={s} filhos={[]} aberto={false} onAlternar={() => {}} usuarios={usuarios}
                                    onMudou={onMudou} onEditar={onEditar} onSubtarefa={onSubtarefa} sub />
                                ))}
                              </SortableContext>
                            )}
                          </Fragment>
                        );
                      })}
                    </SortableContext>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </DndContext>
      </div>
    </div>
  );
}

function Linha({ it, filhos, aberto, onAlternar, usuarios, onMudou, onEditar, onSubtarefa, sub = false }: {
  it: ChecklistItemRow; filhos: ChecklistItemRow[]; aberto: boolean; onAlternar: () => void; usuarios: MapaUsuarios;
  onMudou: () => void; onEditar: (i: ChecklistItemRow) => void; onSubtarefa: (pai: ChecklistItemRow) => void; sub?: boolean;
}) {
  const { somenteLeitura, avisar } = useExp();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: it.id, disabled: somenteLeitura });
  const dias = daysUntil(it.prazo);
  const concluido = it.status === "Concluído";
  const vencido = dias != null && dias < 0 && !concluido;
  const subFeitas = filhos.filter((f) => f.status === "Concluído").length;
  const salvar = async (campo: Parameters<typeof salvarCampo>[1], valor: unknown) => {
    try { await salvarCampo(it.id, campo, valor); onMudou(); } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao salvar", "erro"); }
  };
  const resp = it.responsavel_id ? usuarios.get(it.responsavel_id) : undefined;
  return (
    <tr ref={setNodeRef} style={{
      transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1,
      borderBottom: "1px solid var(--line)",
      background: vencido ? "var(--err-bg)" : sub ? "var(--card2)" : "var(--card)",
    }}>
      <td className="px-2 align-middle">
        <div className={`flex items-center gap-0.5 ${sub ? "pl-4" : ""}`}>
          {!somenteLeitura && (
            <button {...attributes} {...listeners} aria-label="Arrastar pra reordenar" title="Arrastar pra reordenar"
              className="cursor-grab px-0.5 text-[13px] leading-none" style={{ color: "var(--ink3)" }}>⠿</button>
          )}
          {!sub && filhos.length > 0 ? (
            <button type="button" onClick={onAlternar} aria-label={aberto ? "Recolher subtarefas" : "Expandir subtarefas"}
              className="rounded p-0.5" style={{ color: "var(--ink3)" }}>
              <span className="inline-block transition-transform" style={{ transform: aberto ? "rotate(90deg)" : undefined }}>›</span>
            </button>
          ) : <span className="w-[16px]" />}
          <input type="checkbox" checked={concluido} disabled={somenteLeitura} aria-label="Concluir"
            onChange={(e) => void salvar("status", e.target.checked ? "Concluído" : "Pendente")}
            className={somenteLeitura ? "opacity-60" : "cursor-pointer"} style={{ accentColor: "#16A34A" }} />
        </div>
      </td>
      <td className="px-2.5 py-1.5 min-w-[240px]">
        <div className="flex items-center gap-2">
          <span className={`flex-1 ${concluido ? "line-through" : ""}`} style={{ color: concluido || sub ? "var(--ink3)" : "var(--ink)", fontSize: sub ? 12 : undefined }}>
            <CelulaEditavel valor={it.tarefa} onSalvar={async (v) => { await salvarCampo(it.id, "tarefa", String(v ?? "").trim()); onMudou(); }} />
          </span>
          {!sub && filhos.length > 0 && (
            <span className="rounded px-1 text-[10.5px] tabular-nums" style={{ background: "var(--card2)", color: "var(--ink3)" }}>{subFeitas}/{filhos.length}</span>
          )}
        </div>
      </td>
      <td className="px-2.5 whitespace-nowrap">
        <span className="relative inline-flex items-center gap-1.5">
          {resp ? <><Avatar nome={resp.nome} tamanho={20} /><span className="text-[12px]" style={{ color: "var(--ink2)" }}>{primeiroNome(resp)}</span></>
            : <span style={{ color: "var(--ink3)" }}>—</span>}
          {!somenteLeitura && (
            <select aria-label="Responsável" className="absolute inset-0 opacity-0 cursor-pointer" value={it.responsavel_id ?? ""}
              onChange={(e) => void salvar("responsavel_id", e.target.value || null)}>
              <option value="">— sem responsável —</option>
              {[...usuarios.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          )}
        </span>
      </td>
      <td className="px-2.5 tabular-nums text-[12px] whitespace-nowrap">
        <CelulaEditavel tipo="date" valor={it.prazo} formatar={(v) => formatDate(String(v))} largura={150}
          onSalvar={async (v) => { await salvarCampo(it.id, "prazo", v); onMudou(); }} />
      </td>
      <td className="px-2.5 text-right tabular-nums text-[12px] whitespace-nowrap">
        {dias == null ? <span style={{ color: "var(--ink3)" }}>—</span> : (
          <span style={{ color: vencido ? "var(--err-ink)" : dias < 7 && !concluido ? "var(--warn-ink)" : "var(--ink2)", fontWeight: vencido ? 600 : 400 }}>
            {dias < 0 ? `${-dias}d atraso` : `${dias}d`}
          </span>
        )}
      </td>
      <td className="px-2.5">
        <CelulaEscolha<Prioridade> valor={it.prioridade} opcoes={PRIORIDADE} rotulo="Prioridade"
          render={(v) => <Selo tom={TOM_PRIORIDADE[v ?? "Média"]}>{v}</Selo>}
          onSalvar={async (v) => { await salvarCampo(it.id, "prioridade", v); onMudou(); }} />
      </td>
      <td className="px-2.5">
        <CelulaEscolha<StatusChecklist> valor={it.status} opcoes={STATUS_CHECKLIST} rotulo="Status"
          render={(v) => <Selo tom={TOM_STATUS[v ?? "Pendente"]}>{v}</Selo>}
          onSalvar={async (v) => { await salvarCampo(it.id, "status", v); onMudou(); }} />
      </td>
      <td className="px-2.5 min-w-[160px]">
        <CelulaEditavel valor={it.observacoes} onSalvar={async (v) => { await salvarCampo(it.id, "observacoes", v); onMudou(); }} />
      </td>
      <td className="px-1 whitespace-nowrap text-right">
        {!somenteLeitura && (
          <span className="inline-flex items-center">
            {!sub && <BotaoIcone titulo="Nova subtarefa" onClick={() => onSubtarefa(it)}>＋</BotaoIcone>}
            <BotaoIcone titulo="Editar" onClick={() => onEditar(it)}>✎</BotaoIcone>
            <BotaoExcluir titulo={`Excluir "${it.tarefa}"?`} sucesso="Tarefa excluída"
              descricao={filhos.length > 0 ? `Isto remove também ${filhos.length} subtarefa(s).` : "Esta ação não pode ser desfeita."}
              onConfirmar={async () => { await excluirTarefa(it.id); onMudou(); }} />
          </span>
        )}
      </td>
    </tr>
  );
}

function BotaoIcone({ titulo, onClick, children }: { titulo: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={titulo} aria-label={titulo} onClick={onClick}
      className="px-1.5 py-1 rounded-md text-[13px] hover:bg-[var(--card2)]" style={{ color: "var(--ink2)" }}>{children}</button>
  );
}

/* ───────────── Gráfico (uma coluna por fase) ───────────── */

export function Grafico({ itens, usuarios, faseAtual, onMudou }: { itens: ChecklistItemRow[]; usuarios: MapaUsuarios; faseAtual: EtapaChecklist | null; onMudou: () => void }) {
  const doFase = (f: EtapaChecklist) => itens.filter((i) => i.etapa === f)
    .sort((a, b) => a.ordem - b.ordem || (a.prazo ?? "").localeCompare(b.prazo ?? ""));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ border: "1px solid var(--line)", background: "var(--card2)" }}>
        <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
          Cada <b style={{ color: "var(--ink)" }}>coluna é um prazo</b> (fase antes do embarque, da esquerda pra direita).
          As <b style={{ color: "var(--ink)" }}>tarefas daquele prazo</b> ficam abaixo. Clique no status pra mudar.
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          {STATUS_CHECKLIST.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 text-[10.5px]" style={{ color: "var(--ink3)" }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: COR_PONTO[s] }} /> {s}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3">
          {ETAPA_CHECKLIST.map((fase) => {
            const tarefas = doFase(fase);
            const feitas = tarefas.filter((t) => t.status === "Concluído").length;
            const atual = fase === faseAtual;
            return (
              <div key={fase} className="w-60 flex-shrink-0 rounded-xl" style={{ border: `1px solid ${atual ? "var(--rel)" : "var(--line)"}`, background: "var(--card)", boxShadow: atual ? "0 0 0 3px var(--rel-soft)" : undefined }}>
                <div className="rounded-t-xl px-3 py-2" style={{ background: atual ? "var(--rel-soft)" : "var(--card2)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-bold leading-tight" style={{ color: "var(--ink)" }}>{fase}</span>
                    {atual && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: "var(--rel)" }}>AGORA</span>}
                  </div>
                  <div className="mt-0.5 text-[10.5px]" style={{ color: "var(--ink3)" }}>{feitas}/{tarefas.length} concluída{tarefas.length === 1 ? "" : "s"}</div>
                </div>
                <div className="min-h-[44px] space-y-1.5 p-2">
                  {tarefas.length === 0 ? <p className="py-2 text-center text-[10.5px]" style={{ color: "var(--ink3)" }}>Nada aqui</p> : tarefas.map((it) => {
                    const dias = daysUntil(it.prazo);
                    const atrasada = it.status !== "Concluído" && dias != null && dias < 0;
                    const resp = it.responsavel_id ? usuarios.get(it.responsavel_id) : undefined;
                    return (
                      <div key={it.id} className="rounded-lg p-2" style={{ border: `1px solid ${atrasada ? "var(--err-line)" : "var(--line)"}`, background: atrasada ? "var(--err-bg)" : "var(--card)" }}>
                        <div className="text-[12px] font-semibold leading-tight line-clamp-2" style={{ color: "var(--ink)" }}>{it.tarefa}</div>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-[10.5px]" style={{ color: atrasada ? "var(--err-ink)" : "var(--ink3)" }}>
                            {it.prazo && formatDate(it.prazo)}
                            {resp && <Avatar nome={resp.nome} tamanho={14} />}
                          </span>
                          <CelulaEscolha<StatusChecklist> valor={it.status} opcoes={STATUS_CHECKLIST} rotulo="Status"
                            render={(v) => (
                              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: "var(--ink2)" }}>
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: COR_PONTO[v ?? "Pendente"] }} />{v}
                              </span>
                            )}
                            onSalvar={async (v) => { await salvarCampo(it.id, "status", v); onMudou(); }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Kanban (por status, só leitura) ───────────── */

export function Kanban({ itens, usuarios }: { itens: ChecklistItemRow[]; usuarios: MapaUsuarios }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      {KANBAN_COLUNAS.map((col) => {
        const its = itens.filter((i) => col.statuses.includes(i.status));
        return (
          <div key={col.titulo} className="rounded-xl p-2" style={{ border: "1px solid var(--line)", background: "var(--card2)" }}>
            <div className="flex items-center justify-between mb-2 px-1">
              <h3 className="text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{col.titulo}</h3>
              <Selo>{its.length}</Selo>
            </div>
            <div className="space-y-1.5">
              {its.length === 0 ? <p className="text-[11.5px] text-center py-4" style={{ color: "var(--ink3)" }}>Vazio</p> : its.map((it) => {
                const dias = daysUntil(it.prazo);
                const vencido = dias != null && dias < 0 && it.status !== "Concluído";
                const resp = it.responsavel_id ? usuarios.get(it.responsavel_id) : undefined;
                return (
                  <div key={it.id} className="rounded-lg p-2" style={{ border: `1px solid ${vencido ? "#DC2626" : "var(--line)"}`, background: "var(--card)" }}>
                    <div className="text-[12px] font-semibold leading-tight mb-1" style={{ color: "var(--ink)" }}>{it.tarefa}</div>
                    <div className="flex items-center justify-between gap-1">
                      <Selo tom="lista">{it.etapa}</Selo>
                      <span className="text-[10.5px]" style={{ color: "var(--ink3)" }}>{formatDate(it.prazo)}</span>
                    </div>
                    {resp && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <Avatar nome={resp.nome} tamanho={16} />
                        <span className="text-[10.5px]" style={{ color: "var(--ink3)" }}>{primeiroNome(resp)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
