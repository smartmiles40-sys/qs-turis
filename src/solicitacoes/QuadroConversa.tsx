// src/solicitacoes/QuadroConversa.tsx
// -----------------------------------------------------------------------------
// QUADRO + CONVERSA (05/11/2026, mockup "G · Quadro + conversa"). Substitui a
// lista principal de Recebidas / Pedidas por nós:
//
//   • Colunas: Novas · Com alguém · Voltou para quem pediu (regras em
//     conversa.ts). "Concluídas" (últimos 7 dias) fica RECOLHIDA por padrão —
//     botão "Ver concluídas (N)"; a escolha fica guardada por pessoa.
//     Cartão: miniatura da 1ª foto anexada, chip de prazo, Urgente, #, título,
//     cliente · viagem, 📎 N, última mensagem + não lidas, responsável ou
//     "Pegar para mim".
//   • O pedido abre AO CENTRO DA TELA (modal largo, fundo escurecido; Esc ou
//     clique fora fecha; no celular, tela cheia). O ?s=<id> da URL continua.
//     Dentro: cabeçalho visual (tipo com cor/ícone, quem pediu → setor/pessoa,
//     andamento, prazo com contagem, cliente/viagem), os dados do formulário em
//     cartões, a GALERIA de anexos, quem participa; à direita a conversa
//     (pílulas + bolhas com os arquivos), respostas rápidas e o campo de
//     mensagem com 📎, arrastar-e-soltar e colar print (0316).
//   • "Ver tudo e mais ações" abre o modal completo (SolicitacaoDetalhe): passar
//     pra outra pessoa, esperando cliente, prazo, desfecho, pagamento, propostas…
//
// Avisos: quem participa recebe toast/notificação pelo qs_avisos (0315). A
// conversa aberta se recarrega com o Realtime (aoMudarSolicitacao) e a cada 15 s.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { setoresDe, useQsAuth } from "@/contexts/QsAuthContext";
import { VerCotacao } from "./FormCotacao";
import { VerPagamento } from "./FormPagamento";
import { lerCotacao } from "./cotacao";
import { lerServico, linhasDoServico } from "./servico";
import { TIPO_PAG_DO, lerPagamento } from "./pagamento";
import type { LinksSol } from "./SolicitacaoDetalhe";
import {
  COR_SETOR, NOME_SETOR, agir, ajustarSolicitacao, aoMudarSolicitacao, carregarSolicitacao, definirPedidoEmFoco, marcarVisto, participantesDe, primeiroNome, seguir,
  type AcaoSol, type EventoSol, type Participante, type Setor, type Solicitacao,
} from "./lib";
import { clienteDo, ordenar } from "./visao";
import {
  COLUNAS_Q, DIAS_CONCLUIDAS, RESPOSTAS_RAPIDAS, camposDaDescricao, chipDePrazo, colunaDoQuadro, colunasVisiveis, contagemDoPrazo, iniciais, itensDaConversa,
  podeAcompanhar, previaDoUltimo, type ColunaQ,
} from "./conversa";
import { anexosPorEvento, podeApagarAnexo, tipoDePrevia, type AnexoSol } from "./anexos";
import { apagarAnexo, listarAnexos, resumoDosAnexos, type ResumoAnexos } from "./anexosApi";
import {
  AnexosDaMensagem, BotaoClipe, FilaDeAnexos, GaleriaAnexos, IconeClipe, Visualizador, ZonaDeSoltar, useFilaDeAnexos, useLinks, useVisualizador,
} from "./AnexosTela";
import "./quadro.css";

const NOME_CURTO: Record<Setor, string> = { comercial: "Comercial", relacionamento: "Relacionamento", financeiro: "Financeiro", operacional: "Operações", marketing: "Marketing" };
const CHAVE_CONCLUIDAS = "qs_sol_ver_concluidas";

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

/** Ícone do tipo de pedido: cotação (avião), pagamento ($), serviço (ferramenta), outro (documento). */
function IconeTipo({ s }: { s: Solicitacao }) {
  const d = s.cotacao ? "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"
    : TIPO_PAG_DO[s.tipo_id ?? ""] ? "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
    : s.formulario != null ? "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
    : "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8";
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
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
  // Concluídas recolhidas por padrão; a escolha fica guardada por pessoa.
  const chave = `${CHAVE_CONCLUIDAS}_${meuId}`;
  const [verConcluidas, setVerConcluidasEstado] = useState(() => { try { return localStorage.getItem(chave) === "1"; } catch { return false; } });
  const setVerConcluidas = (v: boolean) => { setVerConcluidasEstado(v); try { localStorage.setItem(chave, v ? "1" : "0"); } catch { /* navegador sem storage */ } };

  const porColuna = useMemo(() => {
    const m: Record<ColunaQ, Solicitacao[]> = { nova: [], com_alguem: [], voltou: [], concluida: [] };
    for (const s of itens) { const c = colunaDoQuadro(s, agora); if (c) m[c].push(s); }
    return m;
  }, [itens, agora]);
  const nConcluidas = porColuna.concluida.length;
  const colunas = useMemo(() => colunasVisiveis(verConcluidas).map((c) => ({ ...c, itens: [...porColuna[c.id]].sort(ordenar) })), [porColuna, verConcluidas]);

  // 0316: 📎 N + miniatura da 1ª foto de cada cartão (uma chamada pra todos).
  const visiveis = useMemo(() => colunas.flatMap((c) => c.itens), [colunas]);
  const chaveIds = visiveis.map((s) => `${s.id}:${s.atualizado_em}`).join(",");
  const [anexos, setAnexos] = useState<Record<string, ResumoAnexos>>({});
  useEffect(() => {
    let vivo = true;
    const ids = visiveis.map((s) => s.id);
    void resumoDosAnexos(ids).then((r) => { if (vivo) setAnexos(r); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveIds]);
  const capas = useLinks(Object.values(anexos).map((a) => a.capa));

  return (
    <div className="solq-quadro">
      <div className="solq-quadro__barra">
        {verConcluidas ? (
          <button type="button" className="solq-concl" aria-pressed onClick={() => setVerConcluidas(false)}>Esconder concluídas</button>
        ) : (
          <button type="button" className="solq-concl" aria-pressed={false} onClick={() => setVerConcluidas(true)}>
            <span className="solq-col__p" style={{ background: "var(--ok)" }} aria-hidden />
            Ver concluídas ({nConcluidas})
          </button>
        )}
        <button type="button" className="solq-hist" onClick={onHistorico}>Histórico completo</button>
      </div>
      <div className="solq-grade" data-cols={colunas.length}>
        {colunas.map((c) => (
          <section key={c.id} className="solq-col" aria-label={`${c.rotulo}: ${c.itens.length}`} data-col={c.id}>
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
                anexos={anexos[s.id]} capa={anexos[s.id]?.capa ? capas[anexos[s.id].capa!] : undefined}
                onAbrir={() => onAbrir(s.id)} onPegar={() => onPegar(s.id)} />
            ))}
            {c.itens.length === 0 && <p className="solq-vazio">{c.vazio}</p>}
            {c.id === "concluida" && <button type="button" className="solq-hist" onClick={onHistorico}>Mais antigas que {DIAS_CONCLUIDAS} dias: histórico completo</button>}
          </section>
        ))}
      </div>
    </div>
  );
}

function CartaoQ({ s, meuId, sel, agora, podePegar, anexos, capa, onAbrir, onPegar }: {
  s: Solicitacao; meuId: string; sel: boolean; agora: number; podePegar: boolean;
  anexos?: ResumoAnexos; capa?: string;
  onAbrir: () => void; onPegar: () => Promise<void>;
}) {
  const [pegando, setPegando] = useState(false);
  const cli = textoCliente(s);
  const ehEu = s.responsavel_id === meuId;
  const previa = previaDoUltimo(s.ultimo_evento, meuId, s.criado_por_nome) || s.descricao || s.titulo;
  const n = s.nao_lidas ?? (s.novidade ? 1 : 0);
  const nAnx = anexos?.n ?? 0;
  return (
    <div className="solq-card" data-sel={sel ? "" : undefined} data-feito={s.status === "concluida" ? "" : undefined}>
      <button type="button" className="solq-card__abrir" onClick={onAbrir} data-sol={s.id}
        aria-label={`Abrir o pedido ${s.numero}: ${s.titulo}${n ? ` — ${n} não lida${n > 1 ? "s" : ""}` : ""}${nAnx ? ` — ${nAnx} anexo${nAnx > 1 ? "s" : ""}` : ""}`}>
        {capa && <img className="solq-card__capa" src={capa} alt="" loading="lazy" />}
        <span className="solq-card__l1">
          <Chip s={s} agora={agora} />
          {s.prioridade === "urgente" && s.aberta && <Urgente />}
          <span className="solq-card__num">#{s.numero}</span>
        </span>
        <span className="solq-card__titulo">{s.titulo}</span>
        <span className="solq-card__cli" data-tem={cli.tem ? "" : undefined}>
          {cli.texto}
          {nAnx > 0 && <span className="solq-card__anx" title={`${nAnx} anexo${nAnx > 1 ? "s" : ""}`}><IconeClipe tam={11} />{nAnx}</span>}
        </span>
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

// ── O pedido aberto (modal central) ─────────────────────────────────────────

type Pedindo = { acao: "concluir" | "ajuste" | "reabrir" | "devolver_ajustes"; titulo: string; dica: string; botao: string };

/** Os dados do formulário em cartões legíveis. */
function CartoesDoPedido({ s }: { s: Solicitacao }) {
  const pag = TIPO_PAG_DO[s.tipo_id ?? ""] ? lerPagamento(s.formulario) : null;
  if (pag) return <VerPagamento f={pag} />;
  const cot = s.cotacao ? lerCotacao(s.formulario) : null;
  if (cot) return <VerCotacao f={cot} />;
  const serv = lerServico(s.formulario);
  const linhas: [string, string][] = serv && s.tipo_id ? linhasDoServico(s.tipo_id, serv) : [];
  const desc = linhas.length ? { campos: linhas, resto: "" } : camposDaDescricao(s.descricao);
  if (!desc.campos.length && !desc.resto) return <p className="solq-vazio" style={{ textAlign: "left" }}>Sem descrição.</p>;
  return (
    <>
      {desc.campos.length > 0 && (
        <dl className="solq-cards">
          {desc.campos.map(([r, v], i) => (
            <div key={`${r}-${i}`} className="solq-cardinho" data-largo={v.length > 40 || v.includes("\n") ? "" : undefined}>
              <dt>{r}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {desc.resto && <p className="solq-texto">{desc.resto}</p>}
    </>
  );
}

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
  const [anexos, setAnexos] = useState<AnexoSol[]>([]);
  const [texto, setTexto] = useState("");
  const [pedindo, setPedindo] = useState<Pedindo | null>(null);
  const [textoPedido, setTextoPedido] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const tl = useRef<HTMLDivElement>(null);
  const nEventos = useRef(-1);
  const titulo = useRef<HTMLHeadingElement>(null);
  const tituloId = useId();
  const fila = useFilaDeAnexos();
  const vis = useVisualizador();

  const carregar = useCallback(async () => {
    try {
      const [r, p, a] = await Promise.all([carregarSolicitacao(id), participantesDe(id), listarAnexos(id).catch(() => [] as AnexoSol[])]);
      setS(r.s); setEventos(r.eventos); setParticipantes(p); setAnexos(a); setAgora(Date.now()); setErro(null);
      // Chegou coisa nova com a conversa aberta e à vista: já conta como lida.
      if (r.eventos.length !== nEventos.current && !document.hidden) {
        nEventos.current = r.eventos.length;
        void marcarVisto(id).then(onMudou);
      }
    } catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); }
  }, [id, onMudou]);

  useEffect(() => {
    setS(null); setEventos([]); setParticipantes([]); setAnexos([]); setTexto(""); setPedindo(null); setErro(null); nEventos.current = -1;
    fila.limpar();
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

  // Modal: trava a rolagem da página por trás e devolve o foco ao cartão ao fechar.
  useEffect(() => {
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = antes;
      document.querySelector<HTMLElement>(`[data-sol="${id}"]`)?.focus();
    };
  }, [id]);

  // Esc fecha (sem ação aberta; o modal completo e o visualizador fecham primeiro)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".sol-modal, .solq-lb")) return;
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
  const gestorDoPedido = !!s && (currentUser?.role === "admin" || (currentUser?.role === "gestor" && (meusSetores.includes(s.de_setor) || meusSetores.includes(s.para_setor))));
  const pediu = !!s && (s.criado_por === meuId || gestorQuePediu);
  const coluna = s ? colunaDoQuadro(s, agora) : null;
  const ehPagamento = !!s && !!TIPO_PAG_DO[s.tipo_id ?? ""];
  const temFormulario = !!s && s.formulario != null;
  const quemPediu = primeiroNome(s?.criado_por_nome) || (s ? NOME_CURTO[s.de_setor] : "quem pediu");

  const itens = useMemo(() => (s ? itensDaConversa(eventos, meuId, {
    quemPediu: s.criado_por_nome, descricaoInicial: temFormulario ? null : s.descricao, agora,
  }) : []), [eventos, meuId, s, temFormulario, agora]);
  const doEvento = useMemo(() => anexosPorEvento(anexos), [anexos]);
  // links: miniatura (ou a própria foto quando não tem miniatura)
  const linksAnx = useLinks(anexos.filter((a) => tipoDePrevia(a) === "imagem").map((a) => a.miniatura ?? a.path));

  async function rodar(fn: () => Promise<void>) {
    setOcupado(true); setErro(null);
    try { await fn(); setPedindo(null); setTextoPedido(""); await carregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não deu certo."); }
    finally { setOcupado(false); }
  }
  const acao = (a: AcaoSol, t?: string | null) => rodar(() => agir(id, a, t ?? null));
  const enviar = (t: string) => {
    const v = t.trim();
    if (ocupado || fila.enviando) return;
    if (fila.fila.length) {
      // texto + arquivos viram UMA mensagem (qs_sol_anexar)
      setOcupado(true); setErro(null);
      void fila.enviar(id, v || null).then(async (ok) => {
        if (ok) { setTexto(""); await carregar(); onMudou(); }
      }).finally(() => setOcupado(false));
      return;
    }
    if (!v) return;
    void rodar(async () => { await agir(id, "comentar", v); setTexto(""); });
  };

  function confirmarPedido() {
    if (!pedindo || !s || !textoPedido.trim()) return;
    if (pedindo.acao === "devolver_ajustes") {
      void rodar(() => ajustarSolicitacao(id, { titulo: s.titulo, descricao: s.descricao, prioridade: s.prioridade, texto: textoPedido }));
    } else void acao(pedindo.acao, textoPedido);
  }

  const fundo = (e: ReactMouseEvent) => { if (e.target === e.currentTarget) onFechar(); };

  if (!s) {
    return (
      <div className="solq-ov" onMouseDown={fundo}>
        <section className="solq-conv" role="dialog" aria-modal="true" aria-label="Pedido">
          <div className="solq-conv__h">
            <div className="solq-conv__l1">
              <p className="solq-conv__meta" style={{ flex: 1 }}>{erro ?? "Carregando…"}</p>
              <BotaoFechar onFechar={onFechar} />
            </div>
          </div>
        </section>
      </div>
    );
  }

  const cli = textoCliente(s);
  const colRotulo = coluna ? COLUNAS_Q.find((c) => c.id === coluna)?.rotulo : s.status === "recusada" ? "Recusada" : s.status === "cancelada" ? "Cancelada" : "Concluída";
  const resp = s.responsavel_id ? (s.responsavel_id === meuId ? "Você" : s.responsavel_nome ?? "—") : null;
  const pede = (p: Pedindo) => { setPedindo(p); setTextoPedido(""); setErro(null); };
  const prazo = contagemDoPrazo(s, agora);
  const cor = COR_SETOR[s.para_setor];

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
  botoes.push(<button key="tudo" type="button" className="solq-btn" onClick={() => onVerTudo(id)}>Mais ações</button>);

  const acompanham = participantes.filter((p) => p.papel === "acompanha");
  const posso = podeAcompanhar(s, meuId);
  const podeEnviar = !ocupado && !fila.enviando && (!!texto.trim() || fila.fila.length > 0);
  const aberto = vis.aberto ? anexos.find((a) => a.id === vis.aberto) : null;

  return (
    <div className="solq-ov" onMouseDown={fundo}>
      <section className="solq-conv" role="dialog" aria-modal="true" aria-labelledby={tituloId} style={{ ["--q-tipo" as string]: cor }}>
        {/* ── Cabeçalho ── */}
        <header className="solq-conv__h">
          <div className="solq-conv__l1">
            <div className="solq-conv__tags">
              <span className="solq-tipo"><IconeTipo s={s} />{s.tipo_rotulo ?? "Pedido"}</span>
              <span className="solq-and" data-col={coluna ?? s.status}>{colRotulo}</span>
              {s.prioridade === "urgente" && s.aberta && <Urgente />}
              <span className="solq-conv__meta">#{s.numero}</span>
            </div>
            <BotaoFechar onFechar={onFechar} />
          </div>
          <h2 id={tituloId} ref={titulo} tabIndex={-1}>{s.titulo}</h2>

          <div className="solq-faixa">
            <div className="solq-faixa__b">
              <small>Quem pediu → quem faz</small>
              <span className="solq-quem">
                <span className="solq-ava" aria-hidden>{iniciais(s.criado_por_nome, s.criado_por === meuId)}</span>
                <span><b>{s.criado_por === meuId ? "Você" : s.criado_por_nome ?? "Alguém"}</b><small>{NOME_CURTO[s.de_setor]}</small></span>
                <span className="solq-seta" aria-hidden>→</span>
                <span className="solq-ava" aria-hidden style={{ borderColor: cor }}>{resp ? iniciais(s.responsavel_nome, s.responsavel_id === meuId) : "?"}</span>
                <span><b>{resp ?? "Ninguém pegou"}</b><small style={{ color: cor }}>{NOME_CURTO[s.para_setor]}</small></span>
              </span>
            </div>
            <div className="solq-faixa__b solq-prazo" data-tom={prazo.tom}>
              <small>Prazo</small>
              <b>{prazo.grande}</b>
              {prazo.sub && <span>{prazo.sub}</span>}
            </div>
            <div className="solq-faixa__b">
              <small>Cliente · viagem</small>
              <b className={cli.tem ? undefined : "solq-apagado"}>{cli.texto}</b>
              <span className="solq-links">
                {s.cliente_id && links?.onAbrirCliente && <button type="button" className="solq-link" onClick={() => links.onAbrirCliente?.(s.cliente_id!)}>Ficha</button>}
                {s.viagem_id && links?.onAbrirViagem && <button type="button" className="solq-link" onClick={() => links.onAbrirViagem?.(s.viagem_id!)}>Venda</button>}
                {s.lead_id && links?.onAbrirLead && <button type="button" className="solq-link" onClick={() => links.onAbrirLead?.(s.lead_id!)}>Lead</button>}
                {s.conversa_id && links?.onAbrirConversa && <button type="button" className="solq-link" onClick={() => links.onAbrirConversa?.(s.conversa_id!)}>Conversa</button>}
              </span>
            </div>
          </div>

          {!pedindo && <div className="solq-conv__acoes">{botoes}</div>}
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
        </header>

        <div className="solq-conv__corpo">
          {/* ── Esquerda: o pedido, anexos, quem participa ── */}
          <div className="solq-conv__info">
            <section aria-labelledby={`${tituloId}-ped`}>
              <h3 className="solq-rot" id={`${tituloId}-ped`}>O pedido</h3>
              <CartoesDoPedido s={s} />
              {s.resolucao && (s.status === "concluida" || s.status === "recusada") && (
                <p className="solq-resol" data-tom={s.status === "concluida" ? "ok" : "r"}>
                  <b>{s.status === "concluida" ? (s.cotacao ? "Como foi entregue" : "O que foi feito") : "Por que não deu"}</b>{s.resolucao}
                </p>
              )}
            </section>

            <section aria-labelledby={`${tituloId}-anx`}>
              <h3 className="solq-rot" id={`${tituloId}-anx`}>
                Anexos {anexos.length > 0 && <span className="solq-col__n">{anexos.length}</span>}
                <BotaoClipe api={fila} className="solq-rot__btn" rotulo="Anexar ao pedido" />
              </h3>
              <GaleriaAnexos anexos={anexos} links={linksAnx} onAbrir={vis.abrir}
                vazio={<p className="solq-vazio solq-vazio--anx">Nenhum arquivo ainda. Use o <IconeClipe tam={12} />, arraste aqui ou cole um print (Ctrl+V) no campo de mensagem.</p>} />
            </section>

            <section aria-labelledby={`${tituloId}-quem`}>
              <h3 className="solq-rot" id={`${tituloId}-quem`}>Quem está no pedido</h3>
              <ul className="solq-part">
                <li><span className="solq-ava" aria-hidden>{iniciais(s.criado_por_nome)}</span>{s.criado_por_nome ?? "—"}<small>pediu</small></li>
                {s.responsavel_id && <li><span className="solq-ava" aria-hidden>{iniciais(s.responsavel_nome)}</span>{s.responsavel_nome}<small>responsável</small></li>}
                {acompanham.map((p) => <li key={p.user_id}><span className="solq-ava" aria-hidden>{iniciais(p.nome)}</span>{p.nome}<small>acompanha</small></li>)}
              </ul>
              {posso && (
                <div className="solq-seguir">
                  <span>{s.seguindo ? "Você acompanha e é avisado de cada resposta." : "Quer ser avisado das respostas deste pedido?"}</span>
                  <button type="button" className="solq-link" disabled={ocupado} onClick={() => void rodar(() => seguir(id, !s.seguindo))}>
                    {s.seguindo ? "Deixar de acompanhar" : "Acompanhar"}
                  </button>
                </div>
              )}
            </section>
          </div>

          {/* ── Direita: a conversa ── */}
          <ZonaDeSoltar api={fila} className="solq-conv__chat">
            <div className="solq-tl" ref={tl} aria-live="polite">
              {itens.map((m) => {
                if (m.tipo === "evento") return <p key={m.id} className="solq-ev">{m.texto}</p>;
                const anx = doEvento.get(m.evento) ?? [];
                if (m.auto && !anx.length) return <p key={m.id} className="solq-ev">{m.quem} {m.texto} (arquivo removido) · {m.hora}</p>;
                return (
                  <div key={m.id} className="solq-msg" data-eu={m.eu ? "" : undefined}>
                    <span>{m.quem} · {m.hora}</span>
                    <div className="solq-bolha">
                      {!m.auto && <p>{m.texto}</p>}
                      <AnexosDaMensagem anexos={anx} links={linksAnx} onAbrir={vis.abrir} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="solq-rodape">
              <div className="solq-rapidas">
                {RESPOSTAS_RAPIDAS.map((r) => (
                  <button key={r.rotulo} type="button" disabled={ocupado || fila.fila.length > 0} onClick={() => enviar(r.texto)}>{r.rotulo}</button>
                ))}
              </div>
              <FilaDeAnexos api={fila} />
              <div className="solq-campo">
                <BotaoClipe api={fila} disabled={ocupado} />
                <label htmlFor={`solq-msg-${id}`} className="sr-only">Mensagem</label>
                <textarea id={`solq-msg-${id}`} rows={1} value={texto} maxLength={4000}
                  placeholder={fila.fila.length ? "Escreva algo sobre os arquivos (opcional)" : `Escreva para ${recebe ? quemPediu : s.responsavel_id && s.responsavel_id !== meuId ? primeiroNome(s.responsavel_nome) : NOME_SETOR[s.para_setor]}`}
                  onChange={(e) => setTexto(e.target.value)} onPaste={fila.aoColar}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(texto); } }} />
                <button type="button" className="solq-enviar" aria-label={fila.fila.length ? "Enviar mensagem com os anexos" : "Enviar mensagem"} disabled={!podeEnviar} onClick={() => enviar(texto)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              </div>
            </div>
          </ZonaDeSoltar>
        </div>
      </section>

      {aberto && (
        <Visualizador anexos={anexos} inicial={aberto.id} onFechar={vis.fechar}
          podeApagar={(a) => podeApagarAnexo(a, meuId, gestorDoPedido)}
          onApagar={async (a) => { await apagarAnexo(a.id); await carregar(); onMudou(); }} />
      )}
    </div>
  );
}

function BotaoFechar({ onFechar }: { onFechar: () => void }) {
  return (
    <button type="button" className="solq-x" aria-label="Fechar o pedido" onClick={onFechar}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
    </button>
  );
}
