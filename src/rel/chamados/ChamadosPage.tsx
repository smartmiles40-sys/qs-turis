// src/rel/chamados/ChamadosPage.tsx
// -----------------------------------------------------------------------------
// CHAMADOS em KANBAN (sprint de 13/10): cada protocolo é um cartão que anda
// pelas colunas Aberto → Em andamento → Aguardando → Resolvido.
//
// Arrastar o cartão muda a situação (ou use as setinhas do cartão, pra quem
// não arrasta / no celular). Ir pra "Resolvido" pede como foi resolvido.
// Dentro de cada coluna, o que vence primeiro fica em cima; vencido em
// vermelho. Clicar no cartão abre o detalhe (próximo passo, tarefas e a
// evolução do protocolo).
//
// Mora dentro do Atendimento (visão "Chamados") e também na rota antiga
// #rel/chamados.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { AGUARDANDO, COLUNAS, listarKanban, mudarChamado, type ChamadoK } from "../lib/chamados";
import { PRIORIDADES, situacaoDoPrazo, type Prioridade, type StatusChamado } from "../lib/pos";
import { Aviso, Botao, Campo, Etiqueta, Modal } from "../ui";
import ChamadoModal from "./ChamadoModal";
import ChamadoDetalhe from "./ChamadoDetalhe";

const TOM_PRIORIDADE = { urgente: "erro", alta: "aviso", normal: "neutro", baixa: "neutro" } as const;
const PESO_PRIORIDADE: Record<Prioridade, number> = { urgente: 0, alta: 1, normal: 2, baixa: 3 };

type Quem = "todos" | "meus";

// Cartão: leve "levantar" no hover (só desktop com mouse) e afundar no toque.
const CSS_KANBAN = `
.rel-cartao { transition: transform .18s cubic-bezier(.25,1,.5,1), box-shadow .18s cubic-bezier(.25,1,.5,1); }
@media (hover: hover) { .rel-cartao:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(15,20,26,.08); } }
.rel-cartao:active { transform: scale(.985); }
.rel-kanban { scroll-snap-type: x mandatory; }
.rel-kanban > section { scroll-snap-align: start; }
@media (min-width: 1024px) { .rel-kanban { scroll-snap-type: none; } }
`;

function Cartao({ c, onAbrir, onMover, arrastando }: {
  c: ChamadoK;
  onAbrir: () => void;
  onMover: (para: StatusChamado) => void;
  arrastando: (id: string | null) => void;
}) {
  const p = situacaoDoPrazo(c.prazo, c.status);
  const i = COLUNAS.findIndex((x) => x.id === c.status);
  const antes = COLUNAS[i - 1];
  const depois = COLUNAS[i + 1];
  const lista = Array.isArray(c.checklist) ? c.checklist : [];
  const feitos = lista.filter((x) => x.feito).length;
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; arrastando(c.id); }}
      onDragEnd={() => arrastando(null)}
      className="rel-card rel-cartao p-3 cursor-grab active:cursor-grabbing"
      style={p.tom === "erro" ? { borderColor: "var(--err-line)", boxShadow: "inset 3px 0 0 var(--err-ink)" } : undefined}
    >
      <button className="block w-full text-left rounded-md" onClick={onAbrir} aria-label={`Chamado #${c.numero}: ${c.assunto}${p.tom === "erro" ? " — vencido" : ""}. Abrir detalhe`}>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--ink3)" }}>
          #{c.numero}
          <span className="flex-1" />
          <Etiqueta tom={TOM_PRIORIDADE[c.prioridade]}>{PRIORIDADES[c.prioridade].rotulo}</Etiqueta>
        </span>
        {c.categoria && <span className="block text-[11px] font-semibold uppercase tracking-wide mt-1" style={{ color: "var(--ink2)" }}>{c.categoria}</span>}
        <span className="block text-[13px] font-semibold mt-1 leading-snug" style={{ color: "var(--ink)" }}>{c.assunto}</span>
        {c.cliente?.nome && <span className="block text-[12px] mt-0.5" style={{ color: "var(--rel-ink)" }}>{c.cliente.nome}</span>}
        {c.proximo_passo && c.status !== "resolvido" && (
          <span className="block text-[12px] mt-1.5 rounded-md px-2 py-1" style={{ background: "var(--card2)", color: "var(--ink2)" }}>
            → {c.proximo_passo}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-1 mt-2">
          {c.status !== "resolvido" && <Etiqueta tom={p.tom}>⏱ {p.texto}</Etiqueta>}
          {c.aguardando_quem && c.status !== "resolvido" && <Etiqueta>espera: {AGUARDANDO[c.aguardando_quem]}</Etiqueta>}
          {lista.length > 0 && <Etiqueta tom={feitos === lista.length ? "rel" : "neutro"}>☑ {feitos}/{lista.length}</Etiqueta>}
        </span>
      </button>
      <div className="flex items-center gap-1 mt-2 pt-2" style={{ borderTop: "1px solid var(--line2)" }}>
        <span className="flex-1 text-[11px] truncate" style={{ color: "var(--ink3)" }}>
          {c.responsavel?.name ? c.responsavel.name.split(" ")[0] : "sem responsável"}
        </span>
        {antes && (
          <button className="rel-linha min-w-[32px] h-8 px-2 rounded-md text-[13px]" style={{ color: "var(--ink2)" }}
            title={`Voltar para ${antes.rotulo}`} aria-label={`Voltar #${c.numero} para ${antes.rotulo}`} onClick={() => onMover(antes.id)}>←</button>
        )}
        {depois && (
          <button className="rel-linha h-8 px-2 rounded-md text-[12px] font-semibold" style={{ color: "var(--rel-ink)" }}
            title={`Mover para ${depois.rotulo}`} aria-label={`Mover #${c.numero} para ${depois.rotulo}`} onClick={() => onMover(depois.id)}>
            {depois.rotulo} →
          </button>
        )}
      </div>
    </div>
  );
}

export default function ChamadosPage({ onAbrirCliente, onAbrirViagem, onAbrirConversa, embutido = false }: {
  onAbrirCliente: (id: string) => void;
  onAbrirViagem?: (id: string) => void;
  onAbrirConversa: (id: string) => void;
  /** Dentro do Atendimento: sem o título grande da página. */
  embutido?: boolean;
}) {
  const { currentUser } = useQsAuth();
  const meuId = currentUser?.id ?? "";
  const [lista, setLista] = useState<ChamadoK[] | null>(null);
  // Dois erros separados: o do carregamento (some quando carregar dá certo) e o
  // de uma AÇÃO (arrastar, resolver) — esse fica até o X ou ~6s, senão o
  // recarregamento logo em seguida apagava o aviso e o cartão "voltava" calado.
  const [erro, setErro] = useState<string | null>(null);
  const [erroAcao, setErroAcaoBruto] = useState<string | null>(null);
  const [quem, setQuem] = useState<Quem>(() => (localStorage.getItem("rel_kanban_quem") as Quem) || "todos");
  const [prioridade, setPrioridade] = useState<Prioridade | "">("");
  const [soVencidos, setSoVencidos] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [arrastado, setArrastado] = useState<string | null>(null);
  const [sobre, setSobre] = useState<StatusChamado | null>(null);
  const [resolvendo, setResolvendo] = useState<ChamadoK | null>(null);
  const [resolucao, setResolucao] = useState("");
  const vivo = useRef(true);
  // Só a resposta da ÚLTIMA leitura vale (uma leitura antiga que chega depois
  // de um arraste não desfaz o arraste) e o relógio de 30s espera as mudanças
  // pendentes terminarem.
  const pedido = useRef(0);
  const pendentes = useRef(0);
  const timerErro = useRef<number | undefined>(undefined);

  const setErroAcao = useCallback((m: string | null) => {
    window.clearTimeout(timerErro.current);
    setErroAcaoBruto(m);
    if (m) timerErro.current = window.setTimeout(() => setErroAcaoBruto(null), 6000);
  }, []);

  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    try {
      const l = await listarKanban();
      if (vivo.current && meu === pedido.current) { setLista(l); setErro(null); }
    } catch (e) {
      if (vivo.current && meu === pedido.current) { setErro(e instanceof Error ? e.message : "Não consegui carregar os chamados."); setLista((x) => x ?? []); }
    }
  }, []);

  useEffect(() => {
    vivo.current = true;
    void carregar();
    const t = setInterval(() => { if (!document.hidden && pendentes.current === 0) void carregar(); }, 30_000);
    return () => { vivo.current = false; clearInterval(t); window.clearTimeout(timerErro.current); };
  }, [carregar]);
  useEffect(() => { localStorage.setItem("rel_kanban_quem", quem); }, [quem]);

  const filtrados = useMemo(() => {
    const agora = Date.now();
    return (lista ?? []).filter((c) =>
      (quem === "todos" || c.responsavel_id === meuId)
      && (!prioridade || c.prioridade === prioridade)
      && (!soVencidos || (c.status !== "resolvido" && !!c.prazo && new Date(c.prazo).getTime() < agora)));
  }, [lista, quem, meuId, prioridade, soVencidos]);

  const porColuna = useMemo(() => {
    const m = new Map<StatusChamado, ChamadoK[]>(COLUNAS.map((c) => [c.id, []]));
    filtrados.forEach((c) => m.get(c.status)?.push(c));
    // Dentro da coluna: o que vence primeiro em cima; empate, a mais urgente.
    m.forEach((l, s) => {
      if (s === "resolvido") return;
      l.sort((a, b) => (a.prazo ? new Date(a.prazo).getTime() : Infinity) - (b.prazo ? new Date(b.prazo).getTime() : Infinity)
        || PESO_PRIORIDADE[a.prioridade] - PESO_PRIORIDADE[b.prioridade]);
    });
    return m;
  }, [filtrados]);

  const vencidos = (lista ?? []).filter((c) => c.status !== "resolvido" && c.prazo && new Date(c.prazo).getTime() < Date.now()).length;

  async function mover(c: ChamadoK, para: StatusChamado) {
    if (c.status === para) return;
    if (para === "resolvido") { setResolvendo(c); setResolucao(""); return; }
    // Muda na tela antes (o cartão não "pula de volta" enquanto o banco responde).
    pedido.current++; // invalida qualquer leitura que já estava a caminho
    setLista((l) => l?.map((x) => (x.id === c.id ? { ...x, status: para } : x)) ?? l);
    pendentes.current++;
    try { await mudarChamado(c.id, { status: para }); }
    catch (e) { setErroAcao(`#${c.numero}: ${e instanceof Error ? e.message : "não mudou a situação."}`); }
    finally { pendentes.current--; }
    if (pendentes.current === 0) void carregar();
  }

  async function confirmarResolver() {
    if (!resolvendo || !resolucao.trim()) return;
    pendentes.current++;
    try { await mudarChamado(resolvendo.id, { status: "resolvido", resolucao }); setResolvendo(null); }
    catch (e) { setErroAcao(e instanceof Error ? e.message : "Não resolveu."); }
    finally { pendentes.current--; }
    if (pendentes.current === 0) void carregar();
  }

  function soltar(status: StatusChamado) {
    setSobre(null);
    const c = (lista ?? []).find((x) => x.id === arrastado);
    setArrastado(null);
    if (c) void mover(c, status);
  }

  return (
    <div className={embutido ? "" : "max-w-[1400px] mx-auto"}>
      <style>{CSS_KANBAN}</style>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        {!embutido ? (
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Chamados</h1>
            <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Cada protocolo anda pelas colunas. Arraste o cartão ou use as setas.</p>
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Arraste o cartão entre as colunas ou use as setas. Clique pra ver a evolução.</p>
        )}
        <Botao variante="primario" onClick={() => setNovo(true)}>+ Novo chamado</Botao>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1 rounded-lg p-0.5" style={{ background: "var(--card2)", border: "1px solid var(--line)" }} role="group" aria-label="De quem">
          {(["todos", "meus"] as Quem[]).map((q) => (
            <button key={q} onClick={() => setQuem(q)} aria-pressed={quem === q} className="px-3 py-1.5 rounded-md text-[12.5px] font-semibold"
              style={quem === q ? { background: "var(--card)", color: "var(--rel-ink)", boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { color: "var(--ink2)" }}>
              {q === "todos" ? "Todos" : "Meus"}
            </button>
          ))}
        </div>
        <select className="rel-input" aria-label="Filtrar por prioridade" style={{ width: "auto", padding: "7px 10px", fontSize: 12.5 }} value={prioridade} onChange={(e) => setPrioridade(e.target.value as Prioridade | "")}>
          <option value="">Toda prioridade</option>
          {(Object.keys(PRIORIDADES) as Prioridade[]).map((p) => <option key={p} value={p}>{PRIORIDADES[p].rotulo}</option>)}
        </select>
        <button onClick={() => setSoVencidos((v) => !v)} aria-pressed={soVencidos} className="rel-linha px-3 py-2 rounded-lg text-[12.5px] font-semibold"
          style={soVencidos ? { background: "var(--err-bg)", color: "var(--err-ink)", border: "1px solid var(--err-line)" } : { color: "var(--ink2)", border: "1px solid var(--line)" }}>
          Vencidos{vencidos ? ` (${vencidos})` : ""}
        </button>
      </div>

      {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}
      {erroAcao && (
        <div className="mb-3 flex items-start gap-2" role="alert">
          <div className="flex-1"><Aviso tom="erro">{erroAcao}</Aviso></div>
          <button type="button" className="rel-linha min-w-[32px] h-8 rounded-md text-[14px]" style={{ color: "var(--ink2)" }}
            aria-label="Fechar aviso" onClick={() => setErroAcao(null)}>✕</button>
        </div>
      )}

      {lista === null ? (
        <div className="grid gap-3 overflow-hidden" style={{ gridTemplateColumns: "repeat(4, minmax(250px, 1fr))" }} aria-busy="true" aria-label="Carregando os chamados">
          {COLUNAS.map((col) => (
            <div key={col.id} className="rounded-2xl p-2.5 min-h-[320px] space-y-2" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
              <span className="block text-[13px] font-bold px-1 pb-1" style={{ color: "var(--ink)" }}>{col.rotulo}</span>
              {[0, 1].map((i) => <div key={i} className="rel-card h-[92px] animate-pulse" />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="rel-kanban grid gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ gridTemplateColumns: "repeat(4, minmax(250px, 1fr))" }}>
          {COLUNAS.map((col) => {
            const cards = porColuna.get(col.id) ?? [];
            const alvo = sobre === col.id && arrastado;
            return (
              <section
                key={col.id}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (sobre !== col.id) setSobre(col.id); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobre(null); }}
                onDrop={(e) => { e.preventDefault(); soltar(col.id); }}
                className="rounded-2xl p-2.5 flex flex-col min-h-[320px]"
                aria-label={`${col.rotulo}: ${cards.length} chamado${cards.length === 1 ? "" : "s"}`}
                style={{
                  background: alvo ? "var(--rel-soft)" : "var(--card2)",
                  // contorno (não borda) pra coluna não "pular" 1px quando vira alvo
                  border: "1px solid var(--line)",
                  outline: alvo ? "2px dashed var(--rel)" : "2px dashed transparent",
                  outlineOffset: -2,
                  transition: "background-color .15s cubic-bezier(.25,1,.5,1), outline-color .15s cubic-bezier(.25,1,.5,1)",
                }}
              >
                <header className="flex items-baseline gap-2 px-1 pb-2">
                  <span className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>{col.rotulo}</span>
                  <span className="text-[12px] font-semibold tabular-nums px-1.5 rounded-full" style={{ color: "var(--ink2)", background: "var(--card)" }}>{cards.length}</span>
                  <span className="flex-1 text-right text-[11px] truncate" style={{ color: "var(--ink3)" }}>{col.dica}</span>
                </header>
                <div className="flex-1 space-y-2">
                  {cards.length === 0 && (
                    <p className="text-[12px] text-center py-6 rounded-xl" style={{ color: "var(--ink3)", border: "1px dashed var(--line)" }}>
                      {col.id === "aberto" ? "Nenhum chamado novo." : "Nenhum chamado aqui."}
                    </p>
                  )}
                  {cards.map((c) => (
                    <Cartao key={c.id} c={c} onAbrir={() => setAberto(c.id)} onMover={(s) => void mover(c, s)} arrastando={setArrastado} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <ChamadoDetalhe
        id={aberto}
        onFechar={() => setAberto(null)}
        onMudou={() => void carregar()}
        onAbrirCliente={onAbrirCliente}
        onAbrirViagem={onAbrirViagem}
        onAbrirConversa={onAbrirConversa}
      />

      <ChamadoModal
        aberto={novo}
        onFechar={() => setNovo(false)}
        onSalvo={() => { setNovo(false); void carregar(); }}
      />

      <Modal
        aberto={!!resolvendo}
        titulo={resolvendo ? `Resolver #${resolvendo.numero}` : "Resolver"}
        onFechar={() => setResolvendo(null)}
        rodape={<><Botao variante="fantasma" onClick={() => setResolvendo(null)}>Cancelar</Botao><Botao variante="primario" disabled={!resolucao.trim()} onClick={() => void confirmarResolver()}>Resolver</Botao></>}
      >
        <Campo rotulo="Como foi resolvido?" dica="Fica no histórico do cliente.">
          <textarea className="rel-input" rows={3} value={resolucao} onChange={(e) => setResolucao(e.target.value)} autoFocus />
        </Campo>
      </Modal>
    </div>
  );
}
