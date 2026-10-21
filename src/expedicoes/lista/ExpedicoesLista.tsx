// src/expedicoes/lista/ExpedicoesLista.tsx
// Lista de Expedições (ou Pacotes — mesma tabela, tipo='pacote'), igual ao app
// antigo: busca "/", filtros (status, destino, período, resp. op), cards ou
// tabela, agrupada por ano, "★ Próxima", status direto na tabela, arrastar pra
// ordenar (tabela), "n" abre Nova. Atualiza sozinha (realtime em expedicoes).
import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Botao, Vazio } from "@/rel/ui";
import { useExp } from "../contexto";
import { Anel, BotaoExcluir, Busca, Carregando, CelulaEscolha, PilulaStatus, useAoVivo } from "../ui";
import { supabase, listarExpedicoes, traduzirErro } from "../lib/banco";
import { agregarExpedicoes } from "../lib/agregados";
import { daysUntil, formatDate, formatPercent } from "../lib/utils";
import { STATUS_EXPEDICAO } from "../lib/constants";
import type { ExpedicaoComAgregados, StatusExpedicao } from "../lib/database";
import { EditarExpedicao, NovaExpedicao, rotulosDoTipo, salvarCampoExpedicao } from "./FormExpedicao";

const ATIVA = (s: string) => s !== "Concluída" && s !== "Cancelada";
const PERIODOS = [
  { id: "todos", rotulo: "Todas" }, { id: "30", rotulo: "Próx. 30d" }, { id: "60", rotulo: "Próx. 60d" },
  { id: "90", rotulo: "Próx. 90d" }, { id: "ano", rotulo: "Este ano" },
] as const;
const anoDe = (d: string | null) => (d ? Number(d.slice(0, 4)) : null);

export default function ExpedicoesLista({ tipo }: { tipo: "expedicao" | "pacote" }) {
  const { somenteLeitura, usuarios, ir, avisar } = useExp();
  const r = rotulosDoTipo(tipo);
  const [lista, setLista] = useState<ExpedicaoComAgregados[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [destinos, setDestinos] = useState<string[]>([]);
  const [periodo, setPeriodo] = useState<string>("todos");
  const [respOp, setRespOp] = useState("");
  const [visao, setVisao] = useState<"cards" | "tabela">("cards");
  const [nova, setNova] = useState(false);
  const [editando, setEditando] = useState<ExpedicaoComAgregados | null>(null);

  const carregar = useCallback(async () => {
    try { setLista(await agregarExpedicoes(await listarExpedicoes(tipo))); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
  }, [tipo]);
  useEffect(() => { setLista(null); void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "expedicoes" }], carregar, 300);

  // atalho "n" = nova
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(alvo.tagName) && !somenteLeitura) setNova(true);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [somenteLeitura]);

  const todasDest = useMemo(() => [...new Set((lista ?? []).map((e) => e.destino).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [lista]);
  const responsaveis = useMemo(() => usuarios.filter((u) => u.papel === "operacional" || u.papel === "admin"), [usuarios]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const anoAtual = new Date().getFullYear();
    return (lista ?? []).filter((e) => {
      if (q && !`${e.codigo} ${e.nome} ${e.destino}`.toLowerCase().includes(q)) return false;
      if (status.length && !status.includes(e.status)) return false;
      if (destinos.length && !destinos.includes(e.destino)) return false;
      if (respOp && e.responsavel_operacional_id !== respOp) return false;
      if (periodo !== "todos") {
        if (periodo === "ano") return anoDe(e.data_embarque) === anoAtual;
        const d = daysUntil(e.data_embarque);
        if (d == null || d < 0 || d > Number(periodo)) return false;
      }
      return true;
    });
  }, [lista, busca, status, destinos, periodo, respOp]);

  const proximaId = useMemo(() => {
    let melhor: ExpedicaoComAgregados | null = null; let md = Infinity;
    for (const e of filtradas) {
      if (!ATIVA(e.status)) continue;
      const d = daysUntil(e.data_embarque);
      if (d != null && d >= 0 && d < md) { md = d; melhor = e; }
    }
    return melhor?.id ?? null;
  }, [filtradas]);

  const grupos = useMemo(() => {
    const m = new Map<string, ExpedicaoComAgregados[]>();
    for (const e of filtradas) {
      const k = anoDe(e.data_embarque)?.toString() ?? "sem-data";
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    for (const [k, arr] of m) m.set(k, [...arr.filter((e) => ATIVA(e.status)), ...arr.filter((e) => !ATIVA(e.status))]);
    const atual = new Date().getFullYear();
    const chaves = [...m.keys()].sort((a, b) => {
      if (a === "sem-data") return 1; if (b === "sem-data") return -1;
      const na = Number(a), nb = Number(b);
      const fa = na >= atual, fb = nb >= atual;
      if (fa !== fb) return fa ? -1 : 1;
      return fa ? na - nb : nb - na;
    });
    return chaves.map((k) => ({ chave: k, itens: m.get(k)! }));
  }, [filtradas]);

  const filtrosAtivos = status.length + destinos.length + (periodo !== "todos" ? 1 : 0) + (respOp ? 1 : 0);
  const abrir = (id: string) => ir(tipo === "pacote" ? "pacotes" : "expedicoes", id);

  const reordenarGrupo = async (chave: string, ids: string[]) => {
    const ordemGlobal = grupos.flatMap((g) => (g.chave === chave ? ids : g.itens.map((e) => e.id)));
    setLista((l) => l && [...l].sort((a, b) => ordemGlobal.indexOf(a.id) - ordemGlobal.indexOf(b.id)));
    const { error } = await supabase.rpc("exp_reordenar", { p_ids: ordemGlobal });
    if (error) { avisar("Erro ao salvar nova ordem", "erro"); void carregar(); }
  };

  const excluir = async (e: ExpedicaoComAgregados) => {
    const { error } = await supabase.from("expedicoes").delete().eq("id", e.id);
    if (error) throw new Error(traduzirErro(error.message));
    void carregar();
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-[22px] font-bold" style={{ color: "var(--ink)" }}>{r.titulo}</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            {lista ? `${filtradas.length} de ${lista.length} ${lista.length === 1 ? r.sing : r.plur}` : "…"}
            {filtrosAtivos > 0 && ` · ${filtrosAtivos} filtro${filtrosAtivos > 1 ? "s" : ""} ativo${filtrosAtivos > 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--line)" }} role="group" aria-label="Visão">
          {(["cards", "tabela"] as const).map((v) => (
            <button key={v} onClick={() => setVisao(v)} aria-pressed={visao === v} className="px-3 py-1.5 text-[12.5px] font-semibold"
              style={{ background: visao === v ? "var(--rel-soft)" : "var(--card)", color: visao === v ? "var(--rel-ink)" : "var(--ink2)" }}>
              {v === "cards" ? "Cards" : "Tabela"}
            </button>
          ))}
        </div>
        {!somenteLeitura && <Botao variante="primario" onClick={() => setNova(true)}>+ {r.novo} <kbd className="ml-1 text-[10px] opacity-70">n</kbd></Botao>}
      </header>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[220px]"><Busca valor={busca} onMudar={setBusca} placeholder="Buscar (código, nome, destino)…  [/]" /></div>
        <FiltroMulti rotulo="Status" opcoes={[...STATUS_EXPEDICAO]} valor={status} onMudar={setStatus} />
        {todasDest.length > 0 && <FiltroMulti rotulo="Destino" opcoes={todasDest} valor={destinos} onMudar={setDestinos} />}
        <select className="rel-input" style={{ width: "auto" }} value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
          {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.rotulo}</option>)}
        </select>
        <select className="rel-input" style={{ width: "auto" }} value={respOp} onChange={(e) => setRespOp(e.target.value)} aria-label="Responsável operacional">
          <option value="">Resp. Op: todos</option>
          {responsaveis.map((u) => <option key={u.id} value={u.id}>{u.nome.split(" ")[0]}</option>)}
        </select>
        {filtrosAtivos > 0 && <Botao variante="fantasma" onClick={() => { setStatus([]); setDestinos([]); setPeriodo("todos"); setRespOp(""); }}>Limpar filtros</Botao>}
      </div>

      {erro && <p className="text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
      {!lista ? <Carregando /> : lista.length === 0 ? (
        <Vazio titulo={tipo === "pacote" ? "Nenhum pacote ainda" : "Nenhuma expedição ainda"}
          texto={tipo === "pacote"
            ? "Crie seu primeiro pacote personalizado para organizar passageiros, roteiro, voos, hospedagem e vouchers — com acesso ao Portal do Viajante."
            : "Crie sua primeira viagem em grupo para começar a organizar passageiros, prazos, rooming e prontidão — tudo num lugar só."}
          acao={!somenteLeitura ? <Botao variante="primario" onClick={() => setNova(true)}>{tipo === "pacote" ? "Criar primeiro pacote" : "Criar primeira expedição"}</Botao> : undefined} />
      ) : filtradas.length === 0 ? (
        <Vazio titulo={tipo === "pacote" ? "Nenhum pacote com os filtros atuais." : "Nenhuma expedição com os filtros atuais."} />
      ) : (
        grupos.map((g) => (
          <section key={g.chave} className="space-y-2.5">
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 py-2" style={{ background: "var(--bg)" }}>
              <h2 className="text-[20px] font-bold" style={{ color: "var(--ink)" }}>{g.chave === "sem-data" ? "Sem data" : g.chave}</h2>
              <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>{g.itens.length} {g.itens.length === 1 ? r.sing : r.plur}</span>
              {STATUS_EXPEDICAO.map((s) => { const n = g.itens.filter((e) => e.status === s).length; return n ? <span key={s} className="flex items-center gap-1"><PilulaStatus status={s} /><span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{n}</span></span> : null; })}
            </div>
            {visao === "cards" ? (
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
                {g.itens.map((e) => <CardExpedicao key={e.id} e={e} proxima={e.id === proximaId} onAbrir={() => abrir(e.id)} onEditar={somenteLeitura ? undefined : () => setEditando(e)} />)}
              </div>
            ) : (
              <TabelaGrupo itens={g.itens} proximaId={proximaId} tipo={tipo} onAbrir={abrir} onEditar={setEditando} onExcluir={excluir}
                onReordenar={(ids) => reordenarGrupo(g.chave, ids)} onStatus={async (e, s) => { await salvarCampoExpedicao(e.id, "status", s); void carregar(); }} />
            )}
          </section>
        ))
      )}

      <NovaExpedicao aberta={nova} tipo={tipo} onFechar={() => setNova(false)} onCriada={(id) => { setNova(false); abrir(id); }} />
      <EditarExpedicao exp={editando} onFechar={() => setEditando(null)} onSalva={() => { setEditando(null); void carregar(); }} />
    </div>
  );
}

function FiltroMulti({ rotulo, opcoes, valor, onMudar }: { rotulo: string; opcoes: string[]; valor: string[]; onMudar: (v: string[]) => void }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="relative">
      <Botao onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>{rotulo}{valor.length ? ` (${valor.length})` : ""} ▾</Botao>
      {aberto && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setAberto(false)} />
          <div className="absolute z-30 mt-1 min-w-[200px] max-h-72 overflow-y-auto rounded-xl p-1.5 shadow-lg" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
            {opcoes.map((o) => (
              <label key={o} className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] cursor-pointer rel-linha" style={{ color: "var(--ink)" }}>
                <input type="checkbox" checked={valor.includes(o)} onChange={() => onMudar(valor.includes(o) ? valor.filter((x) => x !== o) : [...valor, o])} />{o}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function textoDias(d: number | null) {
  if (d == null) return "—";
  if (d === 0) return "embarca hoje";
  return d > 0 ? `${d}d` : "✈ Embarcou";
}

function CardExpedicao({ e, proxima, onAbrir, onEditar }: { e: ExpedicaoComAgregados; proxima: boolean; onAbrir: () => void; onEditar?: () => void }) {
  const d = daysUntil(e.data_embarque);
  const ocup = e.pax_planejados > 0 ? e.pax_confirmados / e.pax_planejados : 0;
  return (
    <article className="rel-card overflow-hidden cursor-pointer group" onClick={onAbrir} role="link" tabIndex={0}
      onKeyDown={(ev) => { if (ev.key === "Enter") onAbrir(); }}
      style={proxima ? { boxShadow: "0 0 0 2px var(--rel)" } : undefined}>
      <div className="px-4 py-3 text-white" style={{ background: "linear-gradient(135deg, #1F2937, #B45309)" }}>
        <div className="flex items-center gap-2 text-[11.5px]">
          <PilulaStatus status={e.status} />
          <span className="font-semibold opacity-90">{textoDias(d)}</span>
          {proxima && <span className="font-bold" style={{ color: "#FDE68A" }}>★ Próxima</span>}
          {onEditar && (
            <button className="ml-auto opacity-70 hover:opacity-100 p-1" aria-label="Editar" onClick={(ev) => { ev.stopPropagation(); onEditar(); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
            </button>
          )}
        </div>
        <h3 className="mt-1.5 text-[15px] font-bold leading-tight line-clamp-2">{e.nome}</h3>
        <p className="text-[12px] opacity-80">{e.destino}</p>
      </div>
      <div className="px-4 py-3 flex items-center gap-4">
        <span className="flex items-center gap-2"><Anel fracao={ocup} cor="#B45309" /><span className="text-[12px]" style={{ color: "var(--ink2)" }}>{e.pax_confirmados}/{e.pax_planejados} pax</span></span>
        <span className="flex items-center gap-2"><Anel fracao={e.prontidao_total ? e.prontidao_aptos / e.prontidao_total : 0} vazio={!e.prontidao_total} /><span className="text-[12px]" style={{ color: "var(--ink2)" }}>{e.prontidao_aptos}/{e.prontidao_total} aptos</span></span>
      </div>
      <div className="px-4 pb-3 flex items-center justify-between text-[11.5px]" style={{ color: "var(--ink3)" }}>
        <span>{formatDate(e.data_embarque)} → {formatDate(e.data_retorno)}</span>
        <span className="font-mono">{e.codigo}</span>
      </div>
    </article>
  );
}

function TabelaGrupo({ itens, proximaId, tipo, onAbrir, onEditar, onExcluir, onReordenar, onStatus }: {
  itens: ExpedicaoComAgregados[]; proximaId: string | null; tipo: "expedicao" | "pacote";
  onAbrir: (id: string) => void; onEditar: (e: ExpedicaoComAgregados) => void; onExcluir: (e: ExpedicaoComAgregados) => Promise<void>;
  onReordenar: (ids: string[]) => void; onStatus: (e: ExpedicaoComAgregados, s: StatusExpedicao) => Promise<void>;
}) {
  const { somenteLeitura } = useExp();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const ids = itens.map((e) => e.id);
  const fimArraste = (ev: DragEndEvent) => {
    if (!ev.over || ev.active.id === ev.over.id) return;
    onReordenar(arrayMove(ids, ids.indexOf(String(ev.active.id)), ids.indexOf(String(ev.over.id))));
  };
  return (
    <div className="rel-card overflow-x-auto">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={fimArraste}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11.5px]" style={{ color: "var(--ink3)" }}>
              {["", "Nome", "Destino", "Embarque", "Retorno", "Status", "Pax", "Checklist", "Prontidão", ""].map((h, i) => <th key={i} className="px-3 py-2 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <tbody>
              {itens.map((e) => (
                <LinhaTabela key={e.id} e={e} proxima={e.id === proximaId} tipo={tipo} arrastavel={!somenteLeitura}
                  onAbrir={() => onAbrir(e.id)} onEditar={() => onEditar(e)} onExcluir={() => onExcluir(e)} onStatus={(s) => onStatus(e, s)} />
              ))}
            </tbody>
          </SortableContext>
        </table>
      </DndContext>
    </div>
  );
}

function LinhaTabela({ e, proxima, tipo, arrastavel, onAbrir, onEditar, onExcluir, onStatus }: {
  e: ExpedicaoComAgregados; proxima: boolean; tipo: "expedicao" | "pacote"; arrastavel: boolean;
  onAbrir: () => void; onEditar: () => void; onExcluir: () => Promise<void>; onStatus: (s: StatusExpedicao) => Promise<void>;
}) {
  const { somenteLeitura } = useExp();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: e.id, disabled: !arrastavel });
  const d = daysUntil(e.data_embarque);
  return (
    <tr ref={setNodeRef} className="border-t rel-linha cursor-pointer" onClick={onAbrir}
      style={{ borderColor: "var(--line)", transform: CSS.Transform.toString(transform), transition, background: proxima ? "var(--rel-soft)" : undefined }}>
      <td className="px-2 py-2 w-6" onClick={(ev) => ev.stopPropagation()}>
        {arrastavel && <span {...attributes} {...listeners} className="cursor-grab select-none px-1" style={{ color: "var(--ink3)" }} aria-label="Arrastar">⠿</span>}
      </td>
      <td className="px-3 py-2 font-semibold" style={{ color: "var(--ink)" }}>
        {e.nome}{proxima && <span className="ml-2 text-[10.5px] font-bold" style={{ color: "var(--rel-ink)" }}>★ PRÓXIMA</span>}
        <div className="font-mono text-[11px] font-normal" style={{ color: "var(--ink3)" }}>{e.codigo}</div>
      </td>
      <td className="px-3 py-2">{e.destino}</td>
      <td className="px-3 py-2 whitespace-nowrap">{formatDate(e.data_embarque)}{d != null && d >= 0 && <span className="ml-1 text-[11.5px]" style={{ color: d < 30 ? "#EA580C" : "var(--ink3)" }}>em {d}d</span>}</td>
      <td className="px-3 py-2 whitespace-nowrap">{formatDate(e.data_retorno)}</td>
      <td className="px-3 py-2"><CelulaEscolha valor={e.status as StatusExpedicao} opcoes={STATUS_EXPEDICAO} onSalvar={onStatus} rotulo="Mudar status" render={(v) => <PilulaStatus status={v ?? ""} />} /></td>
      <td className="px-3 py-2"><b>{e.pax_confirmados}</b>/{e.pax_planejados}</td>
      <td className="px-3 py-2">
        {tipo === "pacote" ? "—" : (
          <span className="flex items-center gap-2">
            <span className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }}><span className="block h-full" style={{ width: `${e.checklist_pct * 100}%`, background: "var(--rel)" }} /></span>
            {formatPercent(e.checklist_pct, 0)}
          </span>
        )}
      </td>
      <td className="px-3 py-2">{e.prontidao_total ? <span style={{ color: e.prontidao_aptos === e.prontidao_total ? "#16A34A" : "#EA580C", fontWeight: 600 }}>{e.prontidao_aptos}/{e.prontidao_total}</span> : "—"}</td>
      <td className="px-2 py-2 whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
        {!somenteLeitura && <button className="p-1" aria-label="Editar" onClick={onEditar} style={{ color: "var(--ink3)" }}>✎</button>}
        <BotaoExcluir titulo={`Excluir "${e.nome}"?`} sucesso={tipo === "pacote" ? "Pacote excluído" : "Expedição excluída"} onConfirmar={onExcluir}
          descricao={tipo === "pacote" ? "Apaga também passageiros, custos e pagamentos deste pacote. Não dá pra desfazer." : "Apaga também passageiros, custos, pagamentos e checklist desta expedição. Não dá pra desfazer."} />
      </td>
    </tr>
  );
}
