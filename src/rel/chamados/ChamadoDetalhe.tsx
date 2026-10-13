// src/rel/chamados/ChamadoDetalhe.tsx
// -----------------------------------------------------------------------------
// DETALHE DO CHAMADO (o protocolo aberto no kanban).
//
// Em cima, o que faz o chamado andar: situação, próximo passo, de quem depende
// agora, responsável, prioridade e prazo — tudo salva na hora. No meio, a
// lista de tarefas (checklist). Embaixo, a linha do tempo: cada mudança que o
// banco registrou + as notas do time.
//
// Assunto e detalhes se editam pelo botão "Editar assunto" (ChamadoModal).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGUARDANDO, COLUNAS, anotarNoChamado, carregarChamado, checklistDoChamado, eventosDoChamado, mudarChamado,
  type AguardandoQuem, type ChamadoK, type EventoChamado, type ItemChecklist, type MudancaChamado,
} from "../lib/chamados";
import {
  PRIORIDADES, STATUS_CHAMADO, deInputLocal, equipeRelacionamento, paraInputLocal, situacaoDoPrazo,
  type Prioridade, type StatusChamado,
} from "../lib/pos";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "../ui";
import ChamadoModal from "./ChamadoModal";

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

function textoDoEvento(e: EventoChamado): string {
  switch (e.tipo) {
    case "criado": return "Abriu o chamado";
    case "status": return `Moveu de ${STATUS_CHAMADO[e.de_status ?? "aberto"] ?? e.de_status} para ${STATUS_CHAMADO[e.para_status ?? "aberto"] ?? e.para_status}`;
    case "resolvido": return "Resolveu";
    case "proximo_passo": return "Próximo passo";
    case "responsavel": return e.texto ? `Responsável agora: ${e.texto}` : "Tirou o responsável";
    case "checklist": return "Checklist";
    default: return "Nota";
  }
}

export default function ChamadoDetalhe({ id, onFechar, onMudou, onAbrirCliente, onAbrirViagem, onAbrirConversa }: {
  id: string | null;
  onFechar: () => void;
  onMudou: () => void;
  onAbrirCliente?: (id: string) => void;
  onAbrirViagem?: (id: string) => void;
  onAbrirConversa?: (id: string) => void;
}) {
  const [c, setC] = useState<ChamadoK | null>(null);
  const [eventos, setEventos] = useState<EventoChamado[]>([]);
  const [equipe, setEquipe] = useState<{ id: string; name: string }[]>([]);
  const [passo, setPasso] = useState("");
  const [novoItem, setNovoItem] = useState("");
  const [nota, setNota] = useState("");
  const [resolucao, setResolucao] = useState("");
  const [pedindoResolucao, setPedindoResolucao] = useState(false);
  const [editar, setEditar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gravandoItem, setGravandoItem] = useState<number | "novo" | null>(null);
  // Só vale a resposta da leitura mais recente E do chamado aberto agora
  // (trocar de chamado rápido não mostra o anterior).
  const pedido = useRef(0);

  const recarregar = useCallback(async () => {
    if (!id) return;
    const meu = ++pedido.current;
    try {
      const [ch, ev] = await Promise.all([carregarChamado(id), eventosDoChamado(id)]);
      if (meu !== pedido.current) return;
      setC(ch);
      setEventos(ev);
      setPasso(ch?.proximo_passo ?? "");
    } catch (e) {
      if (meu !== pedido.current) return;
      setErro(e instanceof Error ? e.message : "Não consegui abrir o chamado.");
    }
  }, [id]);

  useEffect(() => {
    setC(null); setEventos([]); setErro(null); setNota(""); setNovoItem(""); setPedindoResolucao(false);
    if (id) { void recarregar(); equipeRelacionamento().then(setEquipe).catch(() => setEquipe([])); }
  }, [id, recarregar]);

  async function mudar(m: MudancaChamado) {
    if (!c) return;
    setErro(null);
    try { await mudarChamado(c.id, m); await recarregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
  }

  function trocarStatus(s: StatusChamado) {
    if (!c || s === c.status) return;
    if (s === "resolvido") { setResolucao(c.resolucao ?? ""); setPedindoResolucao(true); return; }
    void mudar({ status: s });
  }

  const checklist: ItemChecklist[] = Array.isArray(c?.checklist) ? c!.checklist! : [];

  /** Um item por vez, no banco. Muda na tela antes e aplica a lista que o banco devolveu. */
  async function mexerNoChecklist(
    acao: { tipo: "adicionar"; texto: string } | { tipo: "marcar"; indice: number; feito: boolean } | { tipo: "remover"; indice: number },
  ) {
    if (!c || gravandoItem !== null) return;
    setErro(null);
    setGravandoItem(acao.tipo === "adicionar" ? "novo" : acao.indice);
    const otimista = acao.tipo === "adicionar" ? [...checklist, { texto: acao.texto, feito: false }]
      : acao.tipo === "marcar" ? checklist.map((x, j) => (j === acao.indice ? { ...x, feito: acao.feito } : x))
      : checklist.filter((_, j) => j !== acao.indice);
    setC((x) => (x ? { ...x, checklist: otimista } : x));
    try {
      const lista = await checklistDoChamado(c.id, acao);
      setC((x) => (x ? { ...x, checklist: lista } : x));
      void recarregar(); // traz o evento "checklist" pra linha do tempo
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "A tarefa não salvou.");
      void recarregar();
    } finally {
      setGravandoItem(null);
    }
  }

  async function anotar() {
    if (!c || !nota.trim()) return;
    try { await anotarNoChamado(c.id, nota); setNota(""); await recarregar(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Nota não salva."); }
  }

  const prazo = c ? situacaoDoPrazo(c.prazo, c.status) : null;
  const feitos = checklist.filter((i) => i.feito).length;

  return (
    <>
      <Modal
        aberto={!!id}
        titulo={c ? `Protocolo #${c.numero}` : "Chamado"}
        onFechar={onFechar}
        largura={720}
        rodape={c ? (
          <>
            <Botao variante="fantasma" onClick={() => setEditar(true)}>Editar assunto e detalhes</Botao>
            <Botao variante="primario" onClick={onFechar}>Fechar</Botao>
          </>
        ) : undefined}
      >
        {!c ? (
          erro ? <Aviso tom="erro">{erro}</Aviso> : (
            <div className="space-y-3" aria-busy="true" aria-label="Carregando o chamado">
              <div className="h-5 w-2/3 rounded animate-pulse" style={{ background: "var(--card2)" }} />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg animate-pulse" style={{ background: "var(--card2)" }} />)}</div>
              <div className="h-28 rounded-xl animate-pulse" style={{ background: "var(--card2)" }} />
            </div>
          )
        ) : (
          <div className="space-y-5">
            {/* Assunto + ligações */}
            <div>
              <p className="text-[16px] font-bold" style={{ color: "var(--ink)" }}>{c.assunto}</p>
              {c.descricao && <p className="text-[13px] mt-1 whitespace-pre-wrap" style={{ color: "var(--ink2)" }}>{c.descricao}</p>}
              <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[12px]">
                {prazo && <Etiqueta tom={prazo.tom}>⏱ {prazo.texto}</Etiqueta>}
                {c.cliente_id && c.cliente && (
                  <button className="underline font-semibold py-1" style={{ color: "var(--rel-ink)" }} onClick={() => { onFechar(); onAbrirCliente?.(c.cliente_id!); }}>{c.cliente.nome}</button>
                )}
                {c.viagem_id && c.viagem && onAbrirViagem && (
                  <button className="underline py-1" style={{ color: "var(--ink2)" }} onClick={() => { onFechar(); onAbrirViagem(c.viagem_id!); }}><span aria-hidden>✈ </span>{c.viagem.titulo}</button>
                )}
                {c.conversa_id && onAbrirConversa && (
                  <button className="underline py-1" style={{ color: "var(--ink2)" }} onClick={() => { onFechar(); onAbrirConversa(c.conversa_id!); }}><span aria-hidden>💬 </span>abrir conversa</button>
                )}
              </div>
            </div>

            {/* Situação: as 4 etapas como trilha clicável */}
            <div>
              <p className="text-[12px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink2)" }}>Situação</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5" role="group" aria-label="Situação do chamado">
                {COLUNAS.map((col, i) => {
                  const atual = COLUNAS.findIndex((x) => x.id === c.status);
                  const ativo = col.id === c.status;
                  const passou = i < atual;
                  return (
                    <button key={col.id} onClick={() => trocarStatus(col.id)} aria-pressed={ativo}
                      className="rounded-lg px-2.5 py-2.5 text-left text-[12.5px] font-semibold transition-colors"
                      style={ativo
                        ? { background: "var(--rel)", color: "#fff", border: "1px solid var(--rel)" }
                        : { background: passou ? "var(--rel-soft)" : "var(--card2)", color: passou ? "var(--rel-ink)" : "var(--ink2)", border: "1px solid var(--line)" }}>
                      {passou ? "✓ " : ""}{col.rotulo}
                    </button>
                  );
                })}
              </div>
            </div>

            {pedindoResolucao && (
              <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--rel-soft)" }}>
                <Campo rotulo="Como foi resolvido? *" dica="Fica no histórico do cliente.">
                  <textarea className="rel-input" rows={2} value={resolucao} onChange={(e) => setResolucao(e.target.value)} autoFocus />
                </Campo>
                <div className="flex gap-2 justify-end">
                  <Botao variante="fantasma" onClick={() => setPedindoResolucao(false)}>Cancelar</Botao>
                  <Botao variante="primario" disabled={!resolucao.trim()} onClick={() => { setPedindoResolucao(false); void mudar({ status: "resolvido", resolucao }); }}>Resolver</Botao>
                </div>
              </div>
            )}
            {c.status === "resolvido" && c.resolucao && !pedindoResolucao && (
              <Aviso tom="ok">✓ {c.resolucao}</Aviso>
            )}

            {/* O que faz andar */}
            <div className="rounded-xl p-3.5 space-y-3" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
              <Campo rotulo="Próximo passo" dica="O que precisa acontecer pra este chamado andar. Salva ao sair do campo.">
                <textarea className="rel-input" rows={2} value={passo} onChange={(e) => setPasso(e.target.value)}
                  onBlur={() => { if ((passo.trim() || null) !== (c.proximo_passo ?? null)) void mudar({ proximo_passo: passo }); }}
                  placeholder="Ex.: cia aérea responder o pedido de remarcação até quinta" />
              </Campo>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Campo rotulo="Aguardando quem">
                  <select className="rel-input" value={c.aguardando_quem ?? ""} onChange={(e) => void mudar({ aguardando_quem: (e.target.value || null) as AguardandoQuem | null })}>
                    <option value="">—</option>
                    {(Object.keys(AGUARDANDO) as AguardandoQuem[]).map((k) => <option key={k} value={k}>{AGUARDANDO[k]}</option>)}
                  </select>
                </Campo>
                <Campo rotulo="Responsável">
                  <select className="rel-input" value={c.responsavel_id ?? ""} onChange={(e) => void mudar({ responsavel_id: e.target.value || null })}>
                    <option value="">Ninguém ainda</option>
                    {equipe.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </Campo>
                <Campo rotulo="Prioridade">
                  <select className="rel-input" value={c.prioridade} onChange={(e) => void mudar({ prioridade: e.target.value as Prioridade })}>
                    {(Object.keys(PRIORIDADES) as Prioridade[]).map((p) => <option key={p} value={p}>{PRIORIDADES[p].rotulo}</option>)}
                  </select>
                </Campo>
                <Campo rotulo="Prazo">
                  <Entrada type="datetime-local" defaultValue={paraInputLocal(c.prazo)} key={c.prazo ?? "sem"}
                    onBlur={(e) => { const v = deInputLocal(e.target.value); if (v !== c.prazo) void mudar({ prazo: v }); }} />
                </Campo>
              </div>
            </div>

            {/* Checklist */}
            <div>
              <p className="text-[12px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink2)" }}>
                Tarefas {checklist.length > 0 && <span style={{ color: "var(--ink3)" }}>· {feitos}/{checklist.length}</span>}
              </p>
              <ul className="space-y-1">
                {checklist.map((it, i) => (
                  <li key={i} className="flex items-center gap-2 text-[13px]">
                    <label className="flex-1 flex items-center gap-2 py-1.5 cursor-pointer min-w-0">
                      <input type="checkbox" className="w-4 h-4 flex-shrink-0" style={{ accentColor: "var(--rel)" }} checked={it.feito} disabled={gravandoItem !== null} onChange={() => void mexerNoChecklist({ tipo: "marcar", indice: i, feito: !it.feito })} />
                      <span className="flex-1 break-words" style={{ color: it.feito ? "var(--ink3)" : "var(--ink)", textDecoration: it.feito ? "line-through" : undefined }}>{it.texto}</span>
                    </label>
                    <button className="rel-linha w-8 h-8 inline-flex items-center justify-center rounded-md text-[13px] flex-shrink-0" style={{ color: "var(--ink3)" }} aria-label={`Tirar a tarefa "${it.texto}"`} disabled={gravandoItem !== null} onClick={() => void mexerNoChecklist({ tipo: "remover", indice: i })}>✕</button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-1.5 mt-1.5">
                <Entrada value={novoItem} onChange={(e) => setNovoItem(e.target.value)} placeholder="Nova tarefa (Enter adiciona)"
                  onKeyDown={(e) => { if (e.key === "Enter" && novoItem.trim() && gravandoItem === null) { void mexerNoChecklist({ tipo: "adicionar", texto: novoItem.trim() }); setNovoItem(""); } }} />
                <Botao disabled={!novoItem.trim() || gravandoItem !== null} onClick={() => { void mexerNoChecklist({ tipo: "adicionar", texto: novoItem.trim() }); setNovoItem(""); }}>Adicionar</Botao>
              </div>
            </div>

            {/* Linha do tempo */}
            <div>
              <p className="text-[12px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ink2)" }}>Evolução do protocolo</p>
              {eventos.length === 0 && <p className="text-[13px] mb-2" style={{ color: "var(--ink3)" }}>Nenhum registro ainda — as mudanças e notas aparecem aqui.</p>}
              <ol className="relative pl-5 space-y-3" style={{ borderLeft: eventos.length ? "2px solid var(--line)" : undefined }}>
                {eventos.map((e) => (
                  <li key={e.id} className="relative">
                    <span aria-hidden className="absolute -left-[27px] top-1 w-3 h-3 rounded-full"
                      style={{ background: e.tipo === "resolvido" ? "var(--rel)" : e.tipo === "nota" ? "var(--card)" : "var(--rel-soft)", border: "2px solid var(--rel)" }} />
                    <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
                      {quando(e.criado_em)}{e.autor?.name ? ` · ${e.autor.name.split(" ")[0]}` : ""}
                    </p>
                    <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{textoDoEvento(e)}</p>
                    {e.texto && e.tipo !== "responsavel" && e.tipo !== "criado" && (
                      <p className="text-[13px] whitespace-pre-wrap" style={{ color: "var(--ink2)" }}>{e.texto}</p>
                    )}
                  </li>
                ))}
              </ol>
              <div className="flex gap-1.5 mt-3 items-end">
                <textarea className="rel-input flex-1" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Escreva uma nota (o que foi feito, o que combinou…)" />
                <Botao variante="primario" disabled={!nota.trim()} onClick={() => void anotar()}>Anotar</Botao>
              </div>
            </div>

            {erro && <Aviso tom="erro">{erro}</Aviso>}
          </div>
        )}
      </Modal>

      <ChamadoModal
        aberto={editar}
        chamado={c}
        onFechar={() => setEditar(false)}
        onSalvo={() => { setEditar(false); void recarregar(); onMudou(); }}
      />
    </>
  );
}
