// src/solicitacoes/QuadroConversa.tsx
// -----------------------------------------------------------------------------
// QUADRO + CONVERSA (05/11/2026, mockup "G · Quadro + conversa"). Substitui a
// lista principal de Recebidas / Pedidas por nós:
//
//   • 4 colunas: Novas · Com alguém · Voltou para quem pediu · Concluídas
//     (regras em conversa.ts). Cartão: chip de prazo, Urgente, #, título,
//     cliente · viagem, última mensagem + não lidas, responsável ou "Pegar
//     para mim".
//   • Painel da CONVERSA do pedido: prazo, "quem pediu (setor) → responsável",
//     Pegar / Concluir / Devolver para X (exige o que falta, pausa o prazo) /
//     Retomar / Reabrir, "Detalhes do pedido" recolhível (formulário, cliente,
//     quem acompanha), linha do tempo (pílulas + bolhas), respostas rápidas e o
//     campo de mensagem (grava comentário: qs_sol_acao 'comentar').
//   • "Ver tudo e mais ações" abre o modal completo (SolicitacaoDetalhe): passar
//     pra outra pessoa, esperando cliente, prazo, desfecho, pagamento, propostas…
//
// Avisos: quem participa recebe toast/notificação pelo qs_avisos (0315). A
// conversa aberta se recarrega com o Realtime (aoMudarSolicitacao) e a cada 15 s.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { setoresDe, useQsAuth } from "@/contexts/QsAuthContext";
import { VerCotacao } from "./FormCotacao";
import { VerPagamento } from "./FormPagamento";
import { VerServico } from "./FormServico";
import { lerCotacao } from "./cotacao";
import { lerServico } from "./servico";
import { TIPO_PAG_DO, lerPagamento } from "./pagamento";
import type { LinksSol } from "./SolicitacaoDetalhe";
import {
  NOME_SETOR, agir, ajustarSolicitacao, aoMudarSolicitacao, carregarSolicitacao, definirPedidoEmFoco, marcarVisto, participantesDe, primeiroNome, seguir,
  type AcaoSol, type EventoSol, type Participante, type Setor, type Solicitacao,
} from "./lib";
import { clienteDo, ordenar } from "./visao";
import {
  COLUNAS_Q, RESPOSTAS_RAPIDAS, chipDePrazo, colunaDoQuadro, iniciais, itensDaConversa, podeAcompanhar, previaDoUltimo, type ColunaQ,
} from "./conversa";
import "./quadro.css";

const NOME_CURTO: Record<Setor, string> = { comercial: "Comercial", relacionamento: "Relacionamento", financeiro: "Financeiro", operacional: "Operações", marketing: "Marketing" };

function textoCliente(s: Solicitacao): { texto: string; tem: boolean } {
  const c = clienteDo(s);
  if (c) return { texto: c.viagem ? `${c.nome} · ${c.viagem}` : c.nome, tem: true };
  return { texto: "Sem cliente vinculado", tem: false };
}

function Chip({ s, agora }: { s: Solicitacao; agora: number }) {
  const c = chipDePrazo(s, agora);
  return <span className="solq-chip" data-tom={c.tom}>{c.texto}</span>;
}

function Urgente() {
  return (
    <span className="solq-urg">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 22V4M4 4h13l-2 4 2 4H4" /></svg>
      Urgente
    </span>
  );
}

// ── Quadro ──────────────────────────────────────────────────────────────────

export function QuadroQ({ itens, meuId, recebo, aberta, agora, onAbrir, onPegar, onHistorico }: {
  itens: Solicitacao[];
  meuId: string;
  /** Este usuário é do setor que recebe o pedido (pode pegar)? */
  recebo: (s: Solicitacao) => boolean;
  aberta: string | null;
  agora: number;
  onAbrir: (id: string) => void;
  onPegar: (id: string) => Promise<void>;
  onHistorico: () => void;
}) {
  const colunas = useMemo(() => {
    const m: Record<ColunaQ, Solicitacao[]> = { nova: [], com_alguem: [], voltou: [], concluida: [] };
    for (const s of itens) { const c = colunaDoQuadro(s, agora); if (c) m[c].push(s); }
    return COLUNAS_Q.map((c) => ({ ...c, itens: m[c.id].sort(ordenar) }));
  }, [itens, agora]);

  return (
    <div className="solq-quadro">
      <div className="solq-grade">
        {colunas.map((c) => (
          <section key={c.id} className="solq-col" aria-label={`${c.rotulo}: ${c.itens.length}`}>
            <div className="solq-col__h">
              <h2 className="solq-col__t">
                <span className="solq-col__p" style={{ background: c.ponto }} aria-hidden />
                {c.rotulo}
                <span className="solq-col__n">{c.itens.length}</span>
              </h2>
              <span className="solq-col__d">{c.dica}</span>
            </div>
            {c.itens.map((s) => (
              <CartaoQ key={s.id} s={s} meuId={meuId} sel={s.id === aberta} agora={agora} podePegar={recebo(s)}
                onAbrir={() => onAbrir(s.id)} onPegar={() => onPegar(s.id)} />
            ))}
            {c.itens.length === 0 && <p className="solq-vazio">{c.vazio}</p>}
            {c.id === "concluida" && <button type="button" className="solq-hist" onClick={onHistorico}>Ver histórico completo</button>}
          </section>
        ))}
      </div>
    </div>
  );
}

function CartaoQ({ s, meuId, sel, agora, podePegar, onAbrir, onPegar }: {
  s: Solicitacao; meuId: string; sel: boolean; agora: number; podePegar: boolean; onAbrir: () => void; onPegar: () => Promise<void>;
}) {
  const [pegando, setPegando] = useState(false);
  const cli = textoCliente(s);
  const ehEu = s.responsavel_id === meuId;
  const previa = previaDoUltimo(s.ultimo_evento, meuId, s.criado_por_nome) || s.descricao || s.titulo;
  const n = s.nao_lidas ?? (s.novidade ? 1 : 0);
  return (
    <div className="solq-card" data-sel={sel ? "" : undefined} data-feito={s.status === "concluida" ? "" : undefined}>
      <button type="button" className="solq-card__abrir" onClick={onAbrir} data-sol={s.id}
        aria-label={`Abrir conversa do pedido ${s.numero}: ${s.titulo}${n ? ` — ${n} não lida${n > 1 ? "s" : ""}` : ""}`}>
        <span className="solq-card__l1">
          <Chip s={s} agora={agora} />
          {s.prioridade === "urgente" && s.aberta && <Urgente />}
          <span className="solq-card__num">#{s.numero}</span>
        </span>
        <span className="solq-card__titulo">{s.titulo}</span>
        <span className="solq-card__cli" data-tem={cli.tem ? "" : undefined}>{cli.texto}</span>
        <span className="solq-card__msg">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          <span>{previa}</span>
          {n > 0 && <span className="solq-badge" aria-hidden>{n > 99 ? "99+" : n}</span>}
        </span>
      </button>
      <div className="solq-card__pe">
        {s.responsavel_id ? (
          <>
            <span className="solq-ava" aria-hidden>{iniciais(s.responsavel_nome, ehEu)}</span>
            <span style={{ fontSize: 12 }}>{ehEu ? "Você" : primeiroNome(s.responsavel_nome)}</span>
            <small>de {primeiroNome(s.criado_por_nome) || NOME_CURTO[s.de_setor]}</small>
          </>
        ) : podePegar && s.status === "nova" ? (
          <button type="button" className="solq-card__pegar" disabled={pegando}
            onClick={() => { setPegando(true); void onPegar().finally(() => setPegando(false)); }}>
            {pegando ? "Pegando…" : "Pegar para mim"}
          </button>
        ) : (
          <>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Ninguém pegou ainda</span>
            <small>de {primeiroNome(s.criado_por_nome) || NOME_CURTO[s.de_setor]}</small>
          </>
        )}
      </div>
    </div>
  );
}

// ── Conversa ────────────────────────────────────────────────────────────────

type Pedindo = { acao: "concluir" | "ajuste" | "reabrir" | "devolver_ajustes"; titulo: string; dica: string; botao: string };

export function PainelConversa({ id, onFechar, onMudou, onVerTudo, links }: {
  id: string;
  onFechar: () => void;
  onMudou: () => void;
  /** Abre o modal completo (SolicitacaoDetalhe) com todas as ações. */
  onVerTudo: (id: string) => void;
  links?: LinksSol;
}) {
  const { currentUser } = useQsAuth();
  const meuId = currentUser?.id ?? "";
  const meusSetores = setoresDe(currentUser);
  const [s, setS] = useState<Solicitacao | null>(null);
  const [eventos, setEventos] = useState<EventoSol[]>([]);
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [texto, setTexto] = useState("");
  const [pedindo, setPedindo] = useState<Pedindo | null>(null);
  const [textoPedido, setTextoPedido] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const tl = useRef<HTMLDivElement>(null);
  const nEventos = useRef(-1);
  const titulo = useRef<HTMLHeadingElement>(null);

  const carregar = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([carregarSolicitacao(id), participantesDe(id)]);
      setS(r.s); setEventos(r.eventos); setParticipantes(p); setAgora(Date.now()); setErro(null);
      // Chegou coisa nova com a conversa aberta e à vista: já conta como lida.
      if (r.eventos.length !== nEventos.current && !document.hidden) {
        nEventos.current = r.eventos.length;
        void marcarVisto(id).then(onMudou);
      }
    } catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); }
  }, [id, onMudou]);

  useEffect(() => {
    setS(null); setEventos([]); setParticipantes([]); setTexto(""); setPedindo(null); setErro(null); nEventos.current = -1;
    void carregar();
    definirPedidoEmFoco(id);
    const t = setInterval(() => { if (!document.hidden) void carregar(); }, 15_000);
    const desliga = aoMudarSolicitacao(() => { void carregar(); });
    const volta = () => { if (!document.hidden) void carregar(); };
    document.addEventListener("visibilitychange", volta);
    requestAnimationFrame(() => titulo.current?.focus());
    return () => { clearInterval(t); desliga(); document.removeEventListener("visibilitychange", volta); definirPedidoEmFoco(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Esc fecha (sem ação aberta)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".sol-modal")) return;
      if (pedindo) { setPedindo(null); return; }
      onFechar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [pedindo, onFechar]);

  // Rola pro fim quando chega mensagem
  useEffect(() => { tl.current?.scrollTo({ top: tl.current.scrollHeight }); }, [eventos.length]);

  const recebe = !!s && meusSetores.includes(s.para_setor);
  const gestorQuePediu = !!s && (currentUser?.role === "admin" || (currentUser?.role === "gestor" && meusSetores.includes(s.de_setor)));
  const pediu = !!s && (s.criado_por === meuId || gestorQuePediu);
  const coluna = s ? colunaDoQuadro(s, agora) : null;
  const ehPagamento = !!s && !!TIPO_PAG_DO[s.tipo_id ?? ""];
  const temFormulario = !!s && s.formulario != null;
  const quemPediu = primeiroNome(s?.criado_por_nome) || (s ? NOME_CURTO[s.de_setor] : "quem pediu");

  const itens = useMemo(() => (s ? itensDaConversa(eventos, meuId, {
    quemPediu: s.criado_por_nome, descricaoInicial: temFormulario ? null : s.descricao, agora,
  }) : []), [eventos, meuId, s, temFormulario, agora]);

  async function rodar(fn: () => Promise<void>) {
    setOcupado(true); setErro(null);
    try { await fn(); setPedindo(null); setTextoPedido(""); await carregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não deu certo."); }
    finally { setOcupado(false); }
  }
  const acao = (a: AcaoSol, t?: string | null) => rodar(() => agir(id, a, t ?? null));
  const enviar = (t: string) => { const v = t.trim(); if (!v || ocupado) return; void rodar(async () => { await agir(id, "comentar", v); setTexto(""); }); };

  function confirmarPedido() {
    if (!pedindo || !s || !textoPedido.trim()) return;
    if (pedindo.acao === "devolver_ajustes") {
      void rodar(() => ajustarSolicitacao(id, { titulo: s.titulo, descricao: s.descricao, prioridade: s.prioridade, texto: textoPedido }));
    } else void acao(pedindo.acao, textoPedido);
  }

  if (!s) {
    return (
      <aside className="solq-conv" aria-label="Conversa do pedido">
        <div className="solq-conv__h">
          <div className="solq-conv__l1">
            <p className="solq-conv__meta" style={{ flex: 1 }}>{erro ?? "Carregando…"}</p>
            <BotaoFechar onFechar={onFechar} />
          </div>
        </div>
      </aside>
    );
  }

  const cli = textoCliente(s);
  const colRotulo = coluna ? COLUNAS_Q.find((c) => c.id === coluna)?.rotulo : s.status === "recusada" ? "Recusada" : s.status === "cancelada" ? "Cancelada" : "Concluída";
  const resp = s.responsavel_id ? (s.responsavel_id === meuId ? "você" : primeiroNome(s.responsavel_nome)) : "sem responsável";
  const pede = (p: Pedindo) => { setPedindo(p); setTextoPedido(""); setErro(null); };

  // Botões do cabeçalho (os do mockup; o resto fica em "Ver tudo")
  const botoes: ReactNode[] = [];
  if (coluna === "nova" && recebe) botoes.push(<button key="pegar" type="button" className="solq-btn solq-btn--pri" disabled={ocupado} onClick={() => void acao("aceitar")}>{s.cotacao ? "Aprovar e pegar" : "Pegar para mim"}</button>);
  if (coluna === "com_alguem" && recebe && s.responsavel_id && !ehPagamento) {
    botoes.push(<button key="concluir" type="button" className="solq-btn solq-btn--pri" disabled={ocupado}
      onClick={() => pede({ acao: "concluir", titulo: s.cotacao ? "Como foi entregue a cotação?" : "O que foi feito?", dica: `${quemPediu} recebe isso. Ex.: emitido o localizador ABC123.`, botao: s.cotacao ? "Entregar cotação" : "Concluir" })}>
      {s.cotacao ? "Entregar cotação" : "Concluir"}</button>);
  }
  if ((coluna === "com_alguem" || coluna === "nova") && recebe) {
    botoes.push(<button key="devolver" type="button" className="solq-btn" disabled={ocupado}
      onClick={() => pede({ acao: "ajuste", titulo: `O que falta para ${quemPediu}?`, dica: "Ex.: falta a idade das crianças. O prazo fica pausado até a resposta.", botao: `Devolver para ${quemPediu}` })}>
      Devolver para {quemPediu}</button>);
  }
  if (coluna === "voltou" && recebe) botoes.push(<button key="retomar" type="button" className="solq-btn" disabled={ocupado} onClick={() => void acao("retomar")}>Retomar pedido</button>);
  if (coluna === "voltou" && pediu) {
    botoes.push(temFormulario
      ? <button key="ajustes" type="button" className="solq-btn solq-btn--pri" onClick={() => onVerTudo(id)}>Completar o pedido</button>
      : <button key="ajustes" type="button" className="solq-btn solq-btn--pri" disabled={ocupado}
          onClick={() => pede({ acao: "devolver_ajustes", titulo: "Responda o que falta", dica: "O pedido volta para a fila e o prazo volta a contar.", botao: "Enviar e devolver" })}>Responder o que falta</button>);
  }
  if (s.status === "concluida" && pediu && s.falta_desfecho && !s.desfecho) botoes.push(<button key="desf" type="button" className="solq-btn solq-btn--pri" onClick={() => onVerTudo(id)}>Dar o desfecho</button>);
  if (s.status === "concluida" && pediu && !s.confirmado_em && !s.cotacao) botoes.push(<button key="ok" type="button" className="solq-btn" disabled={ocupado} onClick={() => void acao("confirmar")}>Resolveu, obrigado</button>);
  if ((s.status === "concluida" || s.status === "recusada") && pediu) {
    botoes.push(<button key="reabrir" type="button" className="solq-btn" disabled={ocupado}
      onClick={() => pede({ acao: "reabrir", titulo: "O que ainda falta?", dica: "Volta para a fila de quem recebeu.", botao: "Reabrir" })}>Reabrir</button>);
  }

  const cot = s.cotacao ? lerCotacao(s.formulario) : null;
  const pag = ehPagamento ? lerPagamento(s.formulario) : null;
  const serv = !cot && !pag ? lerServico(s.formulario) : null;
  const acompanham = participantes.filter((p) => p.papel === "acompanha");
  const posso = podeAcompanhar(s, meuId);

  return (
    <aside className="solq-conv" aria-label="Conversa do pedido">
      <div className="solq-conv__h">
        <div className="solq-conv__l1">
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="solq-conv__meta">#{s.numero} · {s.tipo_rotulo ?? "Pedido"} · {colRotulo}</p>
            <h2 ref={titulo} tabIndex={-1}>{s.titulo}</h2>
            <p className="solq-conv__cli">{cli.texto}</p>
          </div>
          <BotaoFechar onFechar={onFechar} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Chip s={s} agora={agora} />
          {s.prioridade === "urgente" && s.aberta && <Urgente />}
          <span className="solq-conv__quem">{primeiroNome(s.criado_por_nome) || "Alguém"} ({NOME_CURTO[s.de_setor]}) → {resp}</span>
        </div>
        {botoes.length > 0 && !pedindo && <div className="solq-conv__acoes">{botoes}</div>}
        {pedindo && (
          <div className="solq-pede">
            <label htmlFor={`solq-pede-${id}`}>{pedindo.titulo}</label>
            <textarea id={`solq-pede-${id}`} className="solq-ta" rows={3} autoFocus maxLength={4000} value={textoPedido}
              onChange={(e) => setTextoPedido(e.target.value)} placeholder={pedindo.dica} />
            <div className="solq-conv__acoes">
              <button type="button" className="solq-btn solq-btn--pri" disabled={ocupado || !textoPedido.trim()} onClick={confirmarPedido}>{ocupado ? "Salvando…" : pedindo.botao}</button>
              <button type="button" className="solq-btn" onClick={() => setPedindo(null)}>Voltar</button>
            </div>
          </div>
        )}
        {erro && <p className="solq-erro" role="alert">{erro}</p>}

        <details className="solq-det">
          <summary>Detalhes do pedido</summary>
          <div className="solq-det__corpo">
            {pag ? <VerPagamento f={pag} />
              : cot ? <VerCotacao f={cot} />
              : serv && s.tipo_id ? <VerServico tipoId={s.tipo_id} f={serv} />
              : <p className="solq-det__desc">{s.descricao || "Sem descrição."}</p>}
            {s.resolucao && (s.status === "concluida" || s.status === "recusada") && (
              <p className="solq-det__desc"><b>{s.status === "concluida" ? "O que foi feito: " : "Por que não deu: "}</b>{s.resolucao}</p>
            )}
            <div className="solq-seguir">
              <span>
                Pediu: {s.criado_por_nome ?? "—"} · Com: {s.responsavel_nome ?? "ninguém ainda"}
                {acompanham.length > 0 && <> · Acompanham: {acompanham.map((p) => primeiroNome(p.nome)).join(", ")}</>}
              </span>
            </div>
            <div className="solq-links">
              {s.cliente_id && links?.onAbrirCliente && <button type="button" className="solq-link" onClick={() => links.onAbrirCliente?.(s.cliente_id!)}>Abrir ficha</button>}
              {s.viagem_id && links?.onAbrirViagem && <button type="button" className="solq-link" onClick={() => links.onAbrirViagem?.(s.viagem_id!)}>Abrir venda</button>}
              {s.lead_id && links?.onAbrirLead && <button type="button" className="solq-link" onClick={() => links.onAbrirLead?.(s.lead_id!)}>Abrir lead</button>}
              {s.conversa_id && links?.onAbrirConversa && <button type="button" className="solq-link" onClick={() => links.onAbrirConversa?.(s.conversa_id!)}>Abrir conversa</button>}
              <button type="button" className="solq-link" onClick={() => onVerTudo(id)}>Ver tudo e mais ações</button>
            </div>
          </div>
        </details>
      </div>

      <div className="solq-tl" ref={tl} aria-live="polite">
        {itens.map((m) => m.tipo === "evento"
          ? <p key={m.id} className="solq-ev">{m.texto}</p>
          : (
            <div key={m.id} className="solq-msg" data-eu={m.eu ? "" : undefined}>
              <span>{m.quem} · {m.hora}</span>
              <p>{m.texto}</p>
            </div>
          ))}
      </div>

      <div className="solq-rodape">
        <div className="solq-rapidas">
          {RESPOSTAS_RAPIDAS.map((r) => (
            <button key={r.rotulo} type="button" disabled={ocupado} onClick={() => enviar(r.texto)}>{r.rotulo}</button>
          ))}
        </div>
        <div className="solq-campo">
          <label htmlFor={`solq-msg-${id}`} className="sr-only">Mensagem</label>
          <textarea id={`solq-msg-${id}`} rows={1} value={texto} maxLength={4000}
            placeholder={`Escreva para ${recebe ? quemPediu : s.responsavel_id && s.responsavel_id !== meuId ? primeiroNome(s.responsavel_nome) : NOME_SETOR[s.para_setor]}`}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(texto); } }} />
          <button type="button" className="solq-enviar" aria-label="Enviar mensagem" disabled={ocupado || !texto.trim()} onClick={() => enviar(texto)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>
        {posso && (
          <div className="solq-seguir">
            <span>{s.seguindo ? "Você acompanha este pedido e é avisado de cada resposta." : "Quer ser avisado das respostas deste pedido?"}</span>
            <button type="button" className="solq-link" disabled={ocupado} onClick={() => void rodar(() => seguir(id, !s.seguindo))}>
              {s.seguindo ? "Deixar de acompanhar" : "Acompanhar"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function BotaoFechar({ onFechar }: { onFechar: () => void }) {
  return (
    <button type="button" className="solq-x" aria-label="Fechar conversa" onClick={onFechar}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
    </button>
  );
}
