// src/mkt/conteudo/QuadroPage.tsx
// -----------------------------------------------------------------------------
// QUADRO DE CONTEÚDO (0240): um quadro só pro Orgânico e o Tráfego, estilo
// Trello. Três visões (Quadro / Lista / Calendário editorial) com os mesmos
// filtros. #mkt/quadro/<id> abre o card; ?ver=lista|calendario guarda a visão.
//
// Arrastar entre colunas obedece a regra da aprovação (regras.podeMover, espelho
// do banco): soltar em "Aprovado" vindo da aprovação aprova; em "Ajustes" pede
// o comentário da devolução.
// -----------------------------------------------------------------------------
import { useMemo, useState, type ReactNode } from "react";
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Avatar, Aviso, Botao, Campo, Entrada, Modal, Vazio } from "@/rel/ui";
import { gravarParamNoHash, lerParamDoHash } from "@/lib/hashQuery";
import { useMkt } from "../contexto";
import { irMkt, useRotaMkt } from "../navegacao";
import CardDetalhe from "./CardDetalhe";
import NovoCard from "./NovoCard";
import { aprovar, devolver, erroDe, moverCard } from "./dados";
import {
  DIA_CURTO, FILTROS_PADRAO, NOME_MES, colunaAceitaCardNovo, comentarioDeDevolucaoOk, contarFiltros, dataCurta, estaAtrasado,
  gradeDoMes, hojeSP, ordemAoSoltar, passaNoFiltro, podeMover, porDia, progressoChecklist, semanaDe, somarDias, type Filtros,
} from "./regras";
import { NOME_TIPO, TIPOS, type CardMkt, type Coluna, type Origem, type TipoConteudo } from "./tipos";
import { Cabecalho, ChipOrigem, ChipStatus, ChipTipo, useQuadro } from "./ui";

type Ver = "quadro" | "lista" | "calendario";

/** Engrenagem do cabeçalho (abre Ajustes › Colunas). Local: icones.tsx é compartilhado. */
function IconeEngrenagem() {
  return (
    <svg aria-hidden width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** Tela "Quadro" (contrato: sem props). A rota "calendario" abre direto no calendário. */
export default function QuadroPage({ verInicial }: { verInicial?: Ver }) {
  const rota = useRotaMkt();
  const { aprovador } = useMkt();
  const { colunas, cards, setCards, carregando, erro, recarregar } = useQuadro();
  const [ver, setVerState] = useState<Ver>(() => {
    const v = lerParamDoHash("ver");
    return v === "lista" || v === "calendario" || v === "quadro" ? v : verInicial ?? "quadro";
  });
  const setVer = (v: Ver) => { setVerState(v); gravarParamNoHash("ver", v === (verInicial ?? "quadro") ? null : v); };
  const [f, setF] = useState<Filtros>(FILTROS_PADRAO);
  const [novo, setNovo] = useState<null | { colunaId?: string; data?: string }>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [devolvendo, setDevolvendo] = useState<CardMkt | null>(null);

  const hoje = hojeSP();
  const ordenadas = useMemo(() => [...colunas].sort((a, b) => a.ordem - b.ordem), [colunas]);
  const colPorId = useMemo(() => new Map(colunas.map((k) => [k.id, k])), [colunas]);
  const visiveis = useMemo(
    () => cards.filter((c) => passaNoFiltro(c, f, colPorId.get(c.coluna_id)?.tipo, hoje)),
    [cards, f, colPorId, hoje],
  );
  const atrasados = useMemo(() => cards.filter((c) => estaAtrasado(c, colPorId.get(c.coluna_id)?.tipo, hoje)).length, [cards, colPorId, hoje]);
  const telaAtual = rota.tela === "inicio" ? "quadro" : rota.tela;
  const abrir = (id: string) => irMkt(telaAtual, id);

  if (carregando) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando o quadro…</p>;
  if (erro) return <Aviso tom="erro">{erro}</Aviso>;

  return (
    <div className="max-w-[1600px] mx-auto">
      <Cabecalho
        titulo="Quadro de conteúdo"
        texto={<>Orgânico e Tráfego no mesmo quadro. {atrasados > 0 && <b style={{ color: "var(--err-ink)" }}>{atrasados} atrasado{atrasados > 1 ? "s" : ""}.</b>}</>}
        acoes={<>
          <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--line)" }} role="tablist" aria-label="Visão">
            {(["quadro", "lista", "calendario"] as Ver[]).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={ver === v} onClick={() => setVer(v)}
                className="px-3 py-1.5 rounded-md text-[13px] font-semibold"
                style={ver === v ? { background: "var(--rel)", color: "#fff" } : { color: "var(--ink2)" }}>
                {v === "quadro" ? "Quadro" : v === "lista" ? "Lista" : "Calendário"}
              </button>
            ))}
          </div>
          {aprovador && (
            <Botao variante="fantasma" onClick={() => { window.location.hash = "#mkt/ajustes?aba=colunas"; }}
              aria-label="Ajustes do quadro (colunas e equipe)" title="Ajustes do quadro: colunas e equipe">
              <IconeEngrenagem />
            </Botao>
          )}
          <Botao variante="primario" onClick={() => setNovo({})}>+ Novo conteúdo</Botao>
        </>}
      />

      <BarraFiltros f={f} setF={setF} />
      {erroAcao && <div className="mb-3"><Aviso tom="erro">{erroAcao}</Aviso></div>}

      {colunas.length === 0 ? (
        <Vazio titulo="O quadro ainda não tem colunas" texto="Peça ao gestor de Marketing pra criar em Comum › Colunas do quadro (ou aplicar a migration 0240, que cria as 8 padrão)." />
      ) : ver === "quadro" ? (
        <Quadro colunas={ordenadas} cards={visiveis} todos={cards} hoje={hoje} onAbrir={abrir}
          onNovo={(colunaId) => setNovo({ colunaId })}
          onMover={async (card, dest, ordem, acao) => {
            setErroAcao(null);
            if (acao === "devolver") { setDevolvendo(card); return; }
            // Otimista: mexe na tela e confirma no banco (que pode recusar).
            const antes = cards;
            setCards((l) => l.map((c) => (c.id === card.id ? { ...c, coluna_id: dest.id, ordem } : c)));
            try {
              if (acao === "aprovar" && colPorId.get(card.coluna_id)?.tipo === "aprovacao") await aprovar(card.id);
              else await moverCard(card.id, dest.id, ordem);
              await recarregar();
            } catch (e) { setCards(antes); setErroAcao(erroDe(e)); }
          }}
          onRecusa={setErroAcao} />
      ) : ver === "lista" ? (
        <Lista cards={visiveis} colPorId={colPorId} hoje={hoje} onAbrir={abrir} />
      ) : (
        <Calendario cards={visiveis} colPorId={colPorId} hoje={hoje} onAbrir={abrir} onNovoNoDia={(d) => setNovo({ data: d })} />
      )}

      {novo && (
        <NovoCard modo="conteudo" colunas={colunas} colunaId={novo.colunaId} dataPublicacao={novo.data}
          onFechar={() => setNovo(null)} onCriado={(id) => { setNovo(null); void recarregar(); abrir(id); }} />
      )}
      {devolvendo && <Devolver card={devolvendo} onFechar={() => setDevolvendo(null)} onFeito={() => { setDevolvendo(null); void recarregar(); }} />}
      {rota.id && (
        <CardDetalhe key={rota.id} id={rota.id} colunas={colunas} onAbrir={abrir}
          onFechar={() => irMkt(telaAtual)} onMudou={() => void recarregar()} />
      )}
    </div>
  );
}

/** Tela "Calendário editorial" (mesmo quadro, aberto no calendário). */
export function CalendarioPage() {
  return <QuadroPage verInicial="calendario" />;
}

// ── Filtros ────────────────────────────────────────────────────────────────
function BarraFiltros({ f, setF }: { f: Filtros; setF: (f: Filtros) => void }) {
  const { pessoas } = useMkt();
  const n = contarFiltros(f);
  const sel = "rel-input !py-1.5 !text-[13px] !w-auto";
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <Entrada placeholder="Buscar título, destino, tema…" value={f.busca} onChange={(e) => setF({ ...f, busca: e.target.value })} className="!py-1.5 !text-[13px] sm:!w-64" aria-label="Buscar" />
      <select className={sel} aria-label="Área" value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value as Origem | "todas" })}>
        <option value="todas">Orgânico + Tráfego</option><option value="organico">Só Orgânico</option><option value="trafego">Só Tráfego</option>
      </select>
      <select className={sel} aria-label="Responsável" value={f.responsavel} onChange={(e) => setF({ ...f, responsavel: e.target.value })}>
        <option value="todos">Todos os responsáveis</option><option value="ninguem">Sem responsável</option>
        {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
      </select>
      <select className={sel} aria-label="Tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoConteudo | "todos" })}>
        <option value="todos">Todos os tipos</option>
        {TIPOS.map((t) => <option key={t} value={t}>{NOME_TIPO[t]}</option>)}
      </select>
      <select className={sel} aria-label="Prazo" value={f.prazo} onChange={(e) => setF({ ...f, prazo: e.target.value as Filtros["prazo"] })}>
        <option value="todos">Qualquer prazo</option><option value="hoje">Vence hoje</option><option value="semana">Até 7 dias</option>
        <option value="mes">Até 31 dias</option><option value="sem_prazo">Sem prazo</option>
      </select>
      <label className="inline-flex items-center gap-1.5 text-[13px] font-semibold cursor-pointer" style={{ color: f.soAtrasados ? "var(--err-ink)" : "var(--ink2)" }}>
        <input type="checkbox" checked={f.soAtrasados} onChange={(e) => setF({ ...f, soAtrasados: e.target.checked })} /> Só atrasados
      </label>
      {n > 0 && <button type="button" className="text-[13px] font-semibold underline" style={{ color: "var(--ink3)" }} onClick={() => setF(FILTROS_PADRAO)}>Limpar ({n})</button>}
    </div>
  );
}

// ── Cartão (miniatura) ─────────────────────────────────────────────────────
function Miniatura({ c, tipoColuna, hoje, onAbrir }: { c: CardMkt; tipoColuna: Coluna["tipo"] | undefined; hoje: string; onAbrir: () => void }) {
  const { nomeDe } = useMkt();
  const atrasado = estaAtrasado(c, tipoColuna, hoje);
  const ck = progressoChecklist(c.checklist);
  return (
    <button type="button" onClick={onAbrir} className="w-full text-left rel-card p-2.5 hover:shadow-sm transition-shadow block"
      style={{ borderLeft: `3px solid ${c.origem === "trafego" ? "var(--info)" : "var(--rel)"}` }}>
      {c.thumb && <img src={c.thumb} alt="" loading="lazy" className="w-full h-24 object-cover rounded-md mb-2" />}
      <p className="text-[13px] font-semibold leading-snug" style={{ color: "var(--ink)" }}>{c.titulo}</p>
      <div className="flex flex-wrap gap-1 mt-1.5">
        <ChipOrigem origem={c.origem} pedido={c.eh_pedido} />
        <ChipTipo tipo={c.tipo} />
        <ChipStatus status={c.status_aprovacao} rodada={c.rodada} />
      </div>
      <div className="flex items-center gap-2 mt-2 text-[11px]" style={{ color: "var(--ink3)" }}>
        {c.prazo && <span style={atrasado ? { color: "var(--err-ink)", fontWeight: 700 } : undefined}>{atrasado ? "Atrasado · " : "Prazo "}{dataCurta(c.prazo, hoje)}</span>}
        {c.destino && <span className="truncate">{c.destino}</span>}
        {ck.total > 0 && <span>☑ {ck.feitos}/{ck.total}</span>}
        {(c.n_comentarios ?? 0) > 0 && <span>💬 {c.n_comentarios}</span>}
        {(c.n_anexos ?? 0) > 0 && <span>📎 {c.n_anexos}</span>}
        {c.responsavel_id && <span className="ml-auto" title={nomeDe(c.responsavel_id)}><Avatar nome={nomeDe(c.responsavel_id)} tamanho={20} /></span>}
      </div>
    </button>
  );
}

// ── Quadro (kanban) ────────────────────────────────────────────────────────
function Quadro({ colunas, cards, todos, hoje, onAbrir, onNovo, onMover, onRecusa }: {
  colunas: Coluna[]; cards: CardMkt[]; todos: CardMkt[]; hoje: string;
  onAbrir: (id: string) => void; onNovo: (colunaId: string) => void;
  onMover: (c: CardMkt, dest: Coluna, ordem: number, acao: string) => void;
  onRecusa: (motivo: string) => void;
}) {
  const { aprovador } = useMkt();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  );
  const porColuna = useMemo(() => {
    const m = new Map<string, CardMkt[]>();
    for (const k of colunas) m.set(k.id, []);
    for (const c of cards) m.get(c.coluna_id)?.push(c);
    for (const l of m.values()) l.sort((a, b) => a.ordem - b.ordem);
    return m;
  }, [colunas, cards]);

  function soltar(e: DragEndEvent) {
    const card = todos.find((c) => c.id === e.active.id);
    const sobre = e.over?.id ? String(e.over.id) : null;
    if (!card || !sobre) return;
    const alvoCard = sobre.startsWith("card:") ? todos.find((c) => c.id === sobre.slice(5)) : null;
    const destId = alvoCard ? alvoCard.coluna_id : sobre.replace(/^col:/, "");
    const dest = colunas.find((k) => k.id === destId);
    const de = colunas.find((k) => k.id === card.coluna_id);
    if (!dest || !de) return;
    if (alvoCard?.id === card.id) return;
    const m = podeMover(de.tipo, dest.tipo, aprovador, card.status_aprovacao);
    if (!m.ok) { onRecusa(m.motivo); return; }
    const naColuna = (porColuna.get(dest.id) ?? []).filter((c) => c.id !== card.id);
    const ordem = ordemAoSoltar(naColuna, alvoCard?.id ?? null);
    if (dest.id === card.coluna_id && ordem === card.ordem) return;
    onMover(card, dest, ordem, m.acao);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={soltar}>
      {/* No celular: rolagem lateral com uma coluna por tela (snap). */}
      <div className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0">
        {colunas.map((k) => (
          <ColunaQuadro key={k.id} coluna={k} n={porColuna.get(k.id)?.length ?? 0}
            onNovo={colunaAceitaCardNovo(k.tipo) ? () => onNovo(k.id) : undefined}>
            {(porColuna.get(k.id) ?? []).map((c) => (
              <Arrastavel key={c.id} id={c.id}>
                <Miniatura c={c} tipoColuna={k.tipo} hoje={hoje} onAbrir={() => onAbrir(c.id)} />
              </Arrastavel>
            ))}
          </ColunaQuadro>
        ))}
      </div>
    </DndContext>
  );
}

const DICA_COLUNA: Partial<Record<Coluna["tipo"], string>> = {
  aprovacao: "O gestor recebe o aviso",
  ajustes: "Devolvidos com comentário",
  aprovado: "Vai pra Biblioteca",
};

function ColunaQuadro({ coluna, n, onNovo, children }: { coluna: Coluna; n: number; onNovo?: () => void; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${coluna.id}` });
  return (
    <section ref={setNodeRef} aria-label={coluna.nome}
      className="snap-start flex-shrink-0 w-[82vw] sm:w-[280px] rounded-xl p-2 flex flex-col max-h-[calc(100vh-240px)] min-h-[200px]"
      style={{ background: isOver ? "var(--rel-soft)" : "var(--card2)", border: "1px solid var(--line)" }}>
      <header className="flex items-center gap-2 px-1.5 py-1 mb-1">
        {coluna.cor && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: coluna.cor }} aria-hidden />}
        <h2 className="text-[13px] font-bold truncate" style={{ color: "var(--ink)" }}>{coluna.nome}</h2>
        <span className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>{n}</span>
        {onNovo && <button type="button" onClick={onNovo} aria-label={`Novo card em ${coluna.nome}`} className="ml-auto text-[18px] leading-none px-1.5 rounded" style={{ color: "var(--ink3)" }}>+</button>}
      </header>
      {DICA_COLUNA[coluna.tipo] && <p className="px-1.5 -mt-1 mb-1 text-[11px]" style={{ color: "var(--ink3)" }}>{DICA_COLUNA[coluna.tipo]}</p>}
      <div className="flex-1 overflow-y-auto space-y-2 p-0.5">{children}</div>
    </section>
  );
}

function Arrastavel({ id, children }: { id: string; children: ReactNode }) {
  const drag = useDraggable({ id });
  const drop = useDroppable({ id: `card:${id}` });
  return (
    <div ref={(n) => { drag.setNodeRef(n); drop.setNodeRef(n); }} {...drag.attributes} {...drag.listeners}
      style={{
        transform: CSS.Translate.toString(drag.transform), opacity: drag.isDragging ? 0.6 : 1, zIndex: drag.isDragging ? 20 : undefined,
        position: "relative", touchAction: "manipulation",
        boxShadow: drop.isOver && !drag.isDragging ? "0 -3px 0 0 var(--rel)" : undefined, borderRadius: 14,
      }}>
      {children}
    </div>
  );
}

// ── Lista ──────────────────────────────────────────────────────────────────
function Lista({ cards, colPorId, hoje, onAbrir }: { cards: CardMkt[]; colPorId: Map<string, Coluna>; hoje: string; onAbrir: (id: string) => void }) {
  const { nomeDe } = useMkt();
  const ordenados = useMemo(() => [...cards].sort((a, b) => (a.prazo ?? "9999").localeCompare(b.prazo ?? "9999") || a.titulo.localeCompare(b.titulo)), [cards]);
  if (!ordenados.length) return <Vazio titulo="Nada com esses filtros" />;
  return (
    <div className="rel-card overflow-hidden">
      <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
        {ordenados.map((c) => {
          const col = colPorId.get(c.coluna_id);
          const atrasado = estaAtrasado(c, col?.tipo, hoje);
          return (
            <li key={c.id}>
              <button type="button" onClick={() => onAbrir(c.id)} className="rel-linha w-full text-left px-3 sm:px-4 py-2.5 grid grid-cols-1 sm:grid-cols-[1fr_140px_150px_90px_90px] gap-1 sm:gap-3 items-center">
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{c.titulo}</span>
                  <span className="flex flex-wrap gap-1 mt-1"><ChipOrigem origem={c.origem} pedido={c.eh_pedido} /><ChipTipo tipo={c.tipo} /><ChipStatus status={c.status_aprovacao} rodada={c.rodada} /></span>
                </span>
                <span className="text-[12px]" style={{ color: "var(--ink2)" }}>{col?.nome}</span>
                <span className="text-[12px] truncate" style={{ color: "var(--ink2)" }}>{c.responsavel_id ? nomeDe(c.responsavel_id) : "Sem responsável"}</span>
                <span className="text-[12px]" style={{ color: atrasado ? "var(--err-ink)" : "var(--ink3)", fontWeight: atrasado ? 700 : 400 }}>{c.prazo ? `Prazo ${dataCurta(c.prazo, hoje)}` : "—"}</span>
                <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{c.data_publicacao ? `Pub. ${dataCurta(c.data_publicacao, hoje)}` : ""}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Calendário editorial ───────────────────────────────────────────────────
function Calendario({ cards, colPorId, hoje, onAbrir, onNovoNoDia }: {
  cards: CardMkt[]; colPorId: Map<string, Coluna>; hoje: string; onAbrir: (id: string) => void; onNovoNoDia: (d: string) => void;
}) {
  const [modo, setModo] = useState<"mes" | "semana">("mes");
  const [ref, setRef] = useState(hoje);
  const ano = Number(ref.slice(0, 4));
  const mes = Number(ref.slice(5, 7));
  const semanas = modo === "mes" ? gradeDoMes(ano, mes) : [semanaDe(ref)];
  const dias = porDia(cards);
  const semData = cards.filter((c) => !c.data_publicacao);
  const titulo = modo === "mes" ? `${NOME_MES[mes - 1]} de ${ano}` : `Semana de ${dataCurta(semanas[0][0], hoje)} a ${dataCurta(semanas[0][6], hoje)}`;
  function andar(n: number) {
    if (modo === "semana") { setRef(somarDias(ref, 7 * n)); return; }
    const d = new Date(Date.UTC(ano, mes - 1 + n, 1));
    setRef(d.toISOString().slice(0, 10));
  }
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px] gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Botao onClick={() => andar(-1)} aria-label="Anterior">‹</Botao>
          <Botao onClick={() => setRef(hoje)}>Hoje</Botao>
          <Botao onClick={() => andar(1)} aria-label="Próximo">›</Botao>
          <h2 className="text-[15px] font-bold capitalize ml-1" style={{ color: "var(--ink)" }}>{titulo}</h2>
          <div className="ml-auto inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--line)" }}>
            {(["mes", "semana"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setModo(m)} className="px-3 py-1 rounded-md text-[12px] font-semibold"
                style={modo === m ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink3)" }}>{m === "mes" ? "Mês" : "Semana"}</button>
            ))}
          </div>
        </div>
        {/* Celular: lista por dia. Computador: grade de 7 colunas. */}
        <div className="hidden sm:grid grid-cols-7 gap-px rounded-xl overflow-hidden" style={{ background: "var(--line)", border: "1px solid var(--line)" }}>
          {DIA_CURTO.map((d) => <div key={d} className="text-[11px] font-bold uppercase text-center py-1.5" style={{ background: "var(--card2)", color: "var(--ink3)" }}>{d}</div>)}
          {semanas.flat().map((d) => {
            const fora = modo === "mes" && Number(d.slice(5, 7)) !== mes;
            const l = dias.get(d) ?? [];
            return (
              <div key={d} className={`p-1.5 ${modo === "semana" ? "min-h-[300px]" : "min-h-[110px]"}`} style={{ background: fora ? "var(--card2)" : "var(--card)" }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] font-bold w-6 h-6 inline-flex items-center justify-center rounded-full"
                    style={d === hoje ? { background: "var(--rel)", color: "#fff" } : { color: fora ? "var(--ink3)" : "var(--ink2)" }}>{Number(d.slice(8))}</span>
                  <button type="button" onClick={() => onNovoNoDia(d)} aria-label={`Novo conteúdo em ${dataCurta(d, hoje)}`} className="text-[14px] leading-none px-1" style={{ color: "var(--ink3)" }}>+</button>
                </div>
                <div className="space-y-1">
                  {l.map((c) => <ItemDia key={c.id} c={c} col={colPorId.get(c.coluna_id)} onAbrir={() => onAbrir(c.id)} />)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="sm:hidden space-y-2">
          {semanas.flat().filter((d) => modo === "semana" || Number(d.slice(5, 7)) === mes).map((d) => {
            const l = dias.get(d) ?? [];
            if (!l.length && d !== hoje) return null;
            return (
              <div key={d} className="rel-card p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] font-bold" style={{ color: d === hoje ? "var(--rel-ink)" : "var(--ink)" }}>{DIA_CURTO[new Date(`${d}T12:00:00Z`).getUTCDay()]} {dataCurta(d, hoje)}{d === hoje ? " · hoje" : ""}</span>
                  <button type="button" onClick={() => onNovoNoDia(d)} className="text-[12px] font-semibold" style={{ color: "var(--rel-ink)" }}>+ novo</button>
                </div>
                <div className="space-y-1">{l.length ? l.map((c) => <ItemDia key={c.id} c={c} col={colPorId.get(c.coluna_id)} onAbrir={() => onAbrir(c.id)} />) : <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Nada marcado.</p>}</div>
              </div>
            );
          })}
        </div>
      </div>
      <aside className="rel-card p-3 h-fit">
        <h3 className="text-[13px] font-bold mb-1" style={{ color: "var(--ink)" }}>Sem data de publicação ({semData.length})</h3>
        <p className="text-[11px] mb-2" style={{ color: "var(--ink3)" }}>Abra o card e escolha a data pra ele entrar no calendário.</p>
        <div className="space-y-1 max-h-[420px] overflow-y-auto">
          {semData.map((c) => <ItemDia key={c.id} c={c} col={colPorId.get(c.coluna_id)} onAbrir={() => onAbrir(c.id)} />)}
        </div>
      </aside>
    </div>
  );
}

function ItemDia({ c, col, onAbrir }: { c: CardMkt; col: Coluna | undefined; onAbrir: () => void }) {
  return (
    <button type="button" onClick={onAbrir} className="w-full text-left rounded-md px-1.5 py-1 text-[11px] leading-tight block"
      style={{ background: c.origem === "trafego" ? "var(--info-bg)" : "var(--rel-soft)", color: "var(--ink)" }} title={`${c.titulo} · ${col?.nome ?? ""}`}>
      <span className="font-semibold block truncate">{c.titulo}</span>
      <span style={{ color: "var(--ink3)" }}>{NOME_TIPO[c.tipo]} · {col?.nome}</span>
    </button>
  );
}

// ── Devolver (soltou em Ajustes vindo da aprovação) ────────────────────────
export function Devolver({ card, onFechar, onFeito }: { card: CardMkt; onFechar: () => void; onFeito: () => void }) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal aberto titulo="Devolver pra ajustes" onFechar={onFechar}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="perigo" disabled={ocupado || !comentarioDeDevolucaoOk(texto)} onClick={async () => {
          setOcupado(true); setErro(null);
          try { await devolver(card.id, texto); onFeito(); } catch (e) { setErro(erroDe(e)); setOcupado(false); }
        }}>Devolver</Botao>
      </>}>
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}><b>{card.titulo}</b> volta pra Ajustes e quem fez recebe o aviso com o seu comentário.</p>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <Campo rotulo="O que precisa ajustar? (obrigatório)">
          <textarea className="rel-input" rows={4} autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Campo>
      </div>
    </Modal>
  );
}
