// src/solicitacoes/SolicitacaoDetalhe.tsx
// -----------------------------------------------------------------------------
// O cartão aberto (0149): o que foi pedido, de quem pra quem, prazo, os botões
// de cada lado e a conversa/histórico — a troca sobre o pedido fica AQUI, não
// no WhatsApp pessoal.
//
// Redesign 29/10 (docs/ref/qs-redesign-ficha-solicitacoes.md, seção 4): MODAL
// CENTRAL (não painel lateral) — fundo escuro, fecha no X, Esc e clique fora;
// o foco entra no modal e volta pro cartão ao fechar; "1 de 5" com setas
// (anterior/próximo em loop na lista filtrada; ← → no teclado). Cabeçalho com
// número, setores, tipo, status, Urgente e a faixa de prazo; à esquerda "O que
// foi pedido" + "Andamento" (histórico e comentário); à direita a cliente
// (abrir ficha / vincular), Prazo · Prioridade · Pediu · Com e as ações.
//
// Ações (nenhuma sumiu — só mudou de lugar):
//   quem RECEBE: Concluir solicitação · Assumir/Aprovar · Esperando cliente ·
//                Pedir ajuste a quem pediu · Passar para outra pessoa (ou
//                Escolher quem faz) · Voltar pra em andamento; em "Mais ações":
//                aguardando fornecedor/outro setor, assumir no lugar de alguém,
//                mudar prazo, recusar.
//   quem PEDIU:  Enviar ajustes · Dar o desfecho · Resolveu · Reabrir · Cancelar
//   todo mundo:  comentar · vincular/trocar cliente e venda · mudar prazo
//
// 0158 (cotação pro Operações): Aprovar — começar a cotação · Pedir ajuste ·
// Entregar cotação; quem pediu: Enviar ajustes (o formulário volta editável)
// e, depois de entregue, o DESFECHO no prazo (fechou / negociando / não seguiu
// + motivo).
//
// 0201 (pedidos de pagamento ao Financeiro): o resumo do pagamento + o quadro
// "Pagamento no Financeiro" (link pra copiar, pago em, parcelas, arquivos) e,
// pro Financeiro, os botões próprios (colar link · marcar pago · provisionar)
// no lugar do "Concluir" genérico.
//
// 0222: pedido distribuído no rodízio aparece como "distribuída automaticamente".
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { setoresDe, useQsAuth } from "@/contexts/QsAuthContext";
import { Avatar, Btn, Menu, SectorChip, StatusChip, Timeline, type ChipTone, type MenuGrupo, type TimelineItem } from "@/components/ui";
import EscolherClienteVenda, { type Escolha } from "./EscolherClienteVenda";
import PropostasDaSolicitacao from "@/propostas/PropostasDaSolicitacao";
import { PROPOSTAS_NO_QS } from "@/propostas/disponivel";
import FormCotacaoCampos, { VerCotacao } from "./FormCotacao";
import FormPagamentoCampos, { PagamentoNoDetalhe, VerPagamento } from "./FormPagamento";
import FormServicoCampos, { VerServico } from "./FormServico";
import { PEDIDO_DO_TIPO } from "./cotacao";
import { descricaoDoServico, faltaNoServico, lerServico, tituloDoServico, type FormServico } from "./servico";
import { TIPO_PAG_DO, descricaoDoPagamento, faltaNoPagamento, lerPagamento, paraBanco, rotuloPagamento, tituloDoPagamento, type FormPagamento } from "./pagamento";
import {
  MOTIVOS_NAO_SEGUIU, NOME_MOTIVO, descricaoDaCotacao, faltaNaCotacao, lerCotacao, rotuloStatus, tituloDaCotacao, tomStatus, type FormCotacao,
} from "./cotacao";
import {
  AGUARDANDO, COR_SETOR, NOME_SETOR, PRIORIDADE_SOL, agir, ajustarSolicitacao, carregarSolicitacao, deInputLocal, haQuanto, marcarVisto,
  paraInputLocal, pessoasDoSetor, primeiroNome, textoPrazo, vincular, whatsappDe,
  type AcaoSol, type AguardandoQuem, type EventoSol, type Pessoa, type PrioridadeSol, type Setor, type Solicitacao,
} from "./lib";
import { clienteDo, tomDoPrazo, venceHoje, atrasada } from "./visao";
import { anexosPorEvento, podeApagarAnexo, tipoDePrevia, type AnexoSol } from "./anexos";
import { apagarAnexo, listarAnexos } from "./anexosApi";
import { AnexosDaMensagem, BotaoClipe, FilaDeAnexos, GaleriaAnexos, Visualizador, ZonaDeSoltar, useFilaDeAnexos, useLinks, useVisualizador } from "./AnexosTela";
import "./solicitacoes.css";
import "./quadro.css";

export interface LinksSol {
  onAbrirViagem?: (id: string) => void;
  onAbrirCliente?: (id: string) => void;
  onAbrirLead?: (id: string) => void;
  onAbrirConversa?: (id: string) => void;
  /** Propostas (0156): o editor, nas áreas que têm a tela de Propostas. Sem isso, a
   *  solicitação ainda mostra as propostas e quem pediu abre/envia por cima (0157). */
  onAbrirProposta?: (id: string) => void;
}

/** Navegação na lista filtrada da Central ("3 de 12" + setas, em loop). */
export interface NavSol { pos: number; total: number; onIr: (delta: 1 | -1) => void }

const ROTULO_EVENTO: Record<EventoSol["tipo"], string> = {
  criada: "pediu", aceita: "assumiu o pedido", passada: "passou o pedido pra", status: "mudou o andamento", comentario: "comentou", prazo: "mudou o prazo",
  concluida: "concluiu", confirmada: "confirmou que resolveu", reaberta: "reabriu", recusada: "recusou", cancelada: "cancelou",
  vinculada: "amarrou a", ajuste: "pediu ajuste", ajustada: "enviou os ajustes", desfecho: "deu o desfecho",
};

function textoDesfecho(para: string | null): string {
  if (para === "fechou") return ": fechou ✅";
  if (para === "negociando") return ": ainda negociando (prazo adiado)";
  if (para?.startsWith("nao_seguiu:")) return `: não seguiu — ${NOME_MOTIVO[para.split(":")[1]] ?? "outro motivo"}`;
  return "";
}

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

/** 0222: o rodízio grava "passada" com autor "QS". */
const ehDistribuicao = (e: EventoSol) => e.tipo === "passada" && !e.autor_id && e.autor_nome === "QS";

/** Um evento do histórico no formato da Timeline. `anexos` = os arquivos que vieram nessa mensagem (0316). */
function itemDoEvento(e: EventoSol, anexos?: ReactNode): TimelineItem {
  let extra = "";
  if (e.tipo === "passada" && e.para) extra = ` ${e.para}`;
  if (e.tipo === "status" && e.para?.startsWith("aguardando:")) extra = `: aguardando ${AGUARDANDO[e.para.split(":")[1] as AguardandoQuem] ?? ""}`;
  if (e.tipo === "status" && e.para === "em_andamento") extra = ": voltou pra em andamento";
  if (e.tipo === "prazo" && e.para) extra = ` pra ${quando(e.para)}`;
  if (e.tipo === "vinculada" && e.para) extra = ` ${e.para}`;
  if (e.tipo === "desfecho") extra = textoDesfecho(e.para);
  const tone: TimelineItem["tone"] = e.tipo === "concluida" || e.tipo === "confirmada" || e.para === "fechou" ? "ok"
    : e.tipo === "recusada" || e.tipo === "reaberta" ? "danger" : e.tipo === "ajuste" ? "warn" : e.tipo === "comentario" ? "info" : undefined;
  const titulo = ehDistribuicao(e) ? `Distribuída automaticamente pra ${e.para ?? "alguém do setor"}` : `${e.autor_nome ?? "Alguém"} ${ROTULO_EVENTO[e.tipo]}${extra}`;
  return {
    id: String(e.id), when: quando(e.criado_em), title: titulo, tone,
    sub: anexos ? (
      <span className="sol-ev-texto solq-vars">
        {!(e.tipo === "comentario" && e.para === "anexos") && e.texto && <span style={{ display: "block", marginBottom: 6 }}>{e.texto}</span>}
        {anexos}
      </span>
    ) : e.texto && !ehDistribuicao(e) ? <span className={e.tipo === "comentario" ? "sol-ev-texto" : undefined}>{e.texto}{e.tipo === "comentario" && e.para === "anexos" ? " (arquivo removido)" : ""}</span> : undefined,
  };
}

/** Tom do chip de status (cor só pra estado). */
function tomChip(s: Solicitacao): ChipTone {
  const t = tomStatus(s);
  if (s.status === "em_andamento" || (s.status === "aguardando" && s.aguardando_quem !== "solicitante")) return s.status === "aguardando" ? "neutral" : "info";
  return t === "aviso" ? "warn" : t === "erro" ? "danger" : t === "rel" ? "ok" : "neutral";
}

/** Texto da faixa de prazo do cabeçalho. */
function faixaDoPrazo(s: Solicitacao): string {
  if (s.status === "concluida") return `Concluída ${s.concluido_em ? haQuanto(s.concluido_em) : ""}${s.prazo ? ` · ${textoPrazo(s).texto}` : ""}`;
  if (s.status === "recusada") return "Recusada";
  if (s.status === "cancelada") return "Cancelada";
  const p = textoPrazo(s);
  if (atrasada(s)) return `Atrasada — ${p.texto}`;
  if (venceHoje(s)) return `Vence hoje — ${p.texto.replace(/^vence /, "")}`;
  return s.prazo ? p.texto.replace(/^vence/, "Vence") : "Sem prazo";
}

type Pedindo = { acao: AcaoSol; titulo: string; dica: string; obrigatorio: boolean; botao: string; perigo?: boolean; extra?: string };

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const emCampo = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export default function SolicitacaoDetalhe({ id, onFechar, onMudou, links, nav }: {
  id: string | null;
  onFechar: () => void;
  onMudou: () => void;
  links?: LinksSol;
  /** Setas anterior/próximo (a Central passa; quem abre de outro lugar não). */
  nav?: NavSol;
}) {
  const { currentUser } = useQsAuth();
  const meuId = currentUser?.id ?? "";
  const meusSetores = setoresDe(currentUser);
  const [s, setS] = useState<Solicitacao | null>(null);
  const [eventos, setEventos] = useState<EventoSol[]>([]);
  const [comentario, setComentario] = useState("");
  const [pedindo, setPedindo] = useState<Pedindo | null>(null);
  const [texto, setTexto] = useState("");
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [mudandoPrazo, setMudandoPrazo] = useState(false);
  const [amarrando, setAmarrando] = useState(false);
  const [escolha, setEscolha] = useState<Escolha | null>(null);
  const [novoPrazo, setNovoPrazo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [zapDeQuemPediu, setZapDeQuemPediu] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // 0316: anexos
  const [anexos, setAnexos] = useState<AnexoSol[]>([]);
  const fila = useFilaDeAnexos();
  const vis = useVisualizador();
  const linksAnx = useLinks(anexos.filter((a) => tipoDePrevia(a) === "imagem").map((a) => a.miniatura ?? a.path));
  // 0158
  const [ajustando, setAjustando] = useState<{ f: FormCotacao | null; p?: FormPagamento | null; sv?: FormServico | null; prioridade: PrioridadeSol; texto: string } | null>(null);
  const [desfechando, setDesfechando] = useState<{ tipo: "fechou" | "nao_seguiu" | null; motivo: string; texto: string } | null>(null);

  const caixa = useRef<HTMLDivElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const voltarFoco = useRef<HTMLElement | null>(null);
  const idAnterior = useRef<string | null>(null);
  const tituloId = useId();

  const carregar = useCallback(async () => {
    if (!id) return;
    try {
      const [r, a] = await Promise.all([carregarSolicitacao(id), listarAnexos(id).catch(() => [] as AnexoSol[])]);
      setS(r.s); setEventos(r.eventos); setAnexos(a);
    }
    catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); }
  }, [id]);
  useEffect(() => {
    setS(null); setEventos([]); setComentario(""); setPedindo(null); setPessoas(null); setMudandoPrazo(false); setAmarrando(false); setErro(null);
    setAjustando(null); setDesfechando(null); setAnexos([]); fila.limpar();
    if (id) { void carregar(); void marcarVisto(id).then(onMudou); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    setZapDeQuemPediu(null);
    if (s?.criado_por && s.criado_por !== meuId) void whatsappDe(s.criado_por).then(setZapDeQuemPediu).catch(() => {});
  }, [s?.criado_por, meuId]);

  // Foco: entra no modal ao abrir; volta pro cartão (ou pra quem abriu) ao fechar.
  useEffect(() => {
    const antes = idAnterior.current;
    idAnterior.current = id;
    if (id && !antes) {
      voltarFoco.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => caixa.current?.focus());
    } else if (!id && antes) {
      const alvo = voltarFoco.current?.isConnected ? voltarFoco.current : document.querySelector<HTMLElement>(`[data-sol="${antes}"]`);
      alvo?.focus();
      voltarFoco.current = null;
    }
  }, [id]);
  // Trava a rolagem da página por trás.
  useEffect(() => {
    if (!id) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = antes; };
  }, [id]);
  // Esc fecha; ← → navegam (fora de campo de texto e sem menu aberto).
  const navRef = useRef(nav); navRef.current = nav;
  const fecharRef = useRef(onFechar); fecharRef.current = onFechar;
  useEffect(() => {
    if (!id) return;
    const tecla = (e: KeyboardEvent) => {
      // o Menu e os diálogos de dentro (proposta, avisos) fecham primeiro
      if (caixa.current?.querySelector("[role=menu], [role=dialog]") || document.querySelector(".solq-lb")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (painelRef.current) { painelRef.current(); return; } // com uma ação aberta, Esc volta (não perde o texto do modal todo)
        fecharRef.current(); return;
      }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && navRef.current && !emCampo(e.target) && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); navRef.current.onIr(e.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [id]);
  // Painel de ação aberto: rola até ele (no celular as colunas empilham).
  const temPainel = !!(pedindo || pessoas !== null || ajustando || desfechando || amarrando || mudandoPrazo);
  const painelRef = useRef<(() => void) | null>(null);
  painelRef.current = temPainel ? () => { setPedindo(null); setPessoas(null); setAjustando(null); setDesfechando(null); setAmarrando(false); setMudandoPrazo(false); } : null;
  useEffect(() => { if (temPainel) painel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [temPainel]);

  /** Comentário (com ou sem arquivos). Com arquivos vira UMA mensagem (qs_sol_anexar). */
  async function comentar() {
    if (!s) return;
    if (!fila.fila.length) { if (comentario.trim()) await rodar("comentar", comentario); return; }
    setOcupado(true); setErro(null);
    const ok = await fila.enviar(s.id, comentario.trim() || null);
    if (ok) { setComentario(""); await carregar(); onMudou(); }
    setOcupado(false);
  }

  async function rodar(acao: AcaoSol, t?: string | null, extra?: string | null) {
    if (!s) return;
    setOcupado(true); setErro(null);
    try { await agir(s.id, acao, t, extra); setPedindo(null); setTexto(""); setComentario(""); setPessoas(null); setMudandoPrazo(false); setDesfechando(null); await carregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não deu certo."); }
    finally { setOcupado(false); }
  }

  if (!id) return null;
  const recebe = !!s && meusSetores.includes(s.para_setor);
  // 0197: o pedido é DA PESSOA que pediu — confirmar, ajustar, desfecho, reabrir e
  // prazo são dela (ou do gestor do setor dela / admin). Os colegas do setor veem e comentam.
  const gestorDoSetor = !!s && (currentUser?.role === "admin" || (currentUser?.role === "gestor" && meusSetores.includes(s.de_setor)));
  const pediu = !!s && (s.criado_por === meuId || gestorDoSetor);
  const doSetorQuePediu = !!s && meusSetores.includes(s.de_setor);
  const cot = s ? lerCotacao(s.formulario) : null;
  const ehCotacao = !!s?.cotacao;
  const ehPagamento = !!s && !!TIPO_PAG_DO[s.tipo_id ?? ""];
  const pag = ehPagamento && s ? lerPagamento(s.formulario) : null;
  // 0203: pedido de serviço (assento, remarcação, emissão…) com os campos do tipo
  const serv = s && !ehPagamento && !ehCotacao ? lerServico(s.formulario) : null;
  const esperandoAjuste = !!s && s.status === "aguardando" && s.aguardando_quem === "solicitante";
  const ultimoAjuste = [...eventos].reverse().find((e) => e.tipo === "ajuste");
  const faltaDesfecho = !!s && s.falta_desfecho && !s.desfecho;
  const distribuida = !!s?.responsavel_id && [...eventos].reverse().find((e) => e.tipo === "passada" || e.tipo === "aceita");
  const foiDistribuida = !!distribuida && ehDistribuicao(distribuida) && distribuida.para === s?.responsavel_nome;
  const cli = s ? clienteDo(s) : null;
  const porEvento = anexosPorEvento(anexos);
  const gestorDoPedido = !!s && (currentUser?.role === "admin" || (currentUser?.role === "gestor" && (meusSetores.includes(s.de_setor) || meusSetores.includes(s.para_setor))));

  const pedir = (p: Pedindo) => { setPedindo(p); setTexto(""); setErro(null); };
  const escolherQuem = () => { if (s) pessoasDoSetor(s.para_setor).then(setPessoas).catch(() => setPessoas([])); };
  const aguardar = (k: AguardandoQuem) => pedir({ acao: "aguardar", extra: k, titulo: `Aguardando ${AGUARDANDO[k]}`, dica: "O que falta (opcional).", obrigatorio: false, botao: "Marcar aguardando" });
  const abrirAmarra = () => {
    if (!s) return;
    setAmarrando(true);
    setEscolha(s.cliente_id ? { clienteId: s.cliente_id, clienteNome: (s.sobre_nome ?? "").split(" · ")[0] || "Cliente", viagemId: s.viagem_id, vendaTexto: null } : null);
  };

  async function enviarAjustes() {
    if (!s || !ajustando) return;
    // Pagamento: a amarração não muda no ajuste (cliente/venda já está no pedido).
    const falta = ajustando.f ? faltaNaCotacao(ajustando.f) : ajustando.p ? faltaNoPagamento(ajustando.p, !!(s.cliente_id || s.viagem_id || s.lead_id))
      : ajustando.sv ? faltaNoServico(s.tipo_id ?? "", ajustando.sv) : null;
    if (falta) { setErro(falta); return; }
    if (!ajustando.f && !ajustando.sv && !ajustando.texto.trim()) { setErro("Escreva o que você ajustou ou respondeu."); return; }
    setOcupado(true); setErro(null);
    try {
      await ajustarSolicitacao(s.id, ajustando.f
        ? { titulo: tituloDaCotacao(ajustando.f), descricao: descricaoDaCotacao(ajustando.f), formulario: ajustando.f, prioridade: ajustando.prioridade, texto: ajustando.texto }
        : ajustando.p
          ? { titulo: tituloDoPagamento(ajustando.p), descricao: descricaoDoPagamento(ajustando.p), formulario: paraBanco(ajustando.p), prioridade: ajustando.prioridade, texto: ajustando.texto }
        : ajustando.sv
          ? { titulo: tituloDoServico(s.tipo_rotulo ?? "Pedido", ajustando.sv, (s.sobre_nome ?? "").split(" · ")[0] || null), descricao: descricaoDoServico(s.tipo_id ?? "", ajustando.sv), formulario: ajustando.sv, prioridade: ajustando.prioridade, texto: ajustando.texto }
          : { titulo: s.titulo, descricao: s.descricao, prioridade: ajustando.prioridade, texto: ajustando.texto });
      setAjustando(null); await carregar(); onMudou();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não enviou."); }
    finally { setOcupado(false); }
  }

  async function salvarAmarra() {
    if (!s || !escolha) return;
    setOcupado(true); setErro(null);
    try { await vincular(s.id, escolha.clienteId, escolha.viagemId); setAmarrando(false); await carregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não amarrou."); }
    finally { setOcupado(false); }
  }

  // Tab fica dentro do modal.
  function prenderTab(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !caixa.current) return;
    const f = [...caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const [primeiro, ultimo] = [f[0], f[f.length - 1]];
    if (e.shiftKey && (document.activeElement === primeiro || document.activeElement === caixa.current)) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  }

  // ── Ações (coluna direita) ──
  const acoes: ReactNode[] = [];
  const mais: MenuGrupo[] = [];
  if (s && !temPainel) {
    const assumirRotulo = ehCotacao && s.status === "nova" ? "Aprovar — começar a cotação"
      : s.responsavel_id ? `Assumir no lugar de ${primeiroNome(s.responsavel_nome) || "quem está"}` : "Assumir — eu faço";
    const podeAssumir = recebe && s.aberta && (s.responsavel_id !== meuId || (ehCotacao && s.status === "nova"));
    const assumirEmDestaque = podeAssumir && (!s.responsavel_id || (ehCotacao && s.status === "nova"));
    if (assumirEmDestaque) acoes.push(<Btn key="assumir" variant="primary" disabled={ocupado} onClick={() => void rodar("aceitar")}>{assumirRotulo}</Btn>);
    if (recebe && s.aberta && s.responsavel_id && !ehPagamento) {
      acoes.push(
        <Btn key="concluir" variant="positive" disabled={ocupado}
          onClick={() => pedir(ehCotacao
            ? { acao: "concluir", titulo: "Como foi entregue a cotação?", dica: PROPOSTAS_NO_QS ? "Ex.: proposta nº 12 pronta aqui no QS com 2 opções." : "Ex.: proposta em PDF com 2 opções, enviada por e-mail.", obrigatorio: true, botao: "Entregar cotação" }
            : { acao: "concluir", titulo: "O que foi feito?", dica: "Quem pediu recebe isso. Ex.: cotação enviada no e-mail, 3 opções; emitido o localizador ABC123.", obrigatorio: true, botao: "Concluir" })}>
          {ehCotacao ? "Entregar cotação" : "Concluir solicitação"}
        </Btn>,
      );
    }
    if (recebe && s.aberta && s.responsavel_id && s.status !== "aguardando") acoes.push(<Btn key="cliente" disabled={ocupado} onClick={() => aguardar("cliente")}>Esperando cliente</Btn>);
    if (recebe && s.status === "aguardando") acoes.push(<Btn key="retomar" disabled={ocupado} onClick={() => void rodar("retomar")}>{ehCotacao ? "Voltar pra em cotação" : "Voltar pra em andamento"}</Btn>);
    if (recebe && s.aberta && !esperandoAjuste) {
      acoes.push(<Btn key="ajuste" disabled={ocupado} onClick={() => pedir({ acao: "ajuste", titulo: "O que está faltando?", dica: "Ex.: falta a idade das crianças; confirmar se o aéreo sai de Campinas.", obrigatorio: true, botao: "Pedir ajuste" })}>Pedir ajuste a quem pediu</Btn>);
    }
    if (recebe && s.aberta) acoes.push(<Btn key="passar" disabled={ocupado} onClick={escolherQuem}>{s.responsavel_id === meuId ? "Passar para outra pessoa" : "Escolher quem faz"}</Btn>);

    // quem pediu
    if (pediu && esperandoAjuste) {
      acoes.push(<Btn key="ajustes" variant="primary" disabled={ocupado} onClick={() => { setErro(null); setAjustando({ f: cot && ehCotacao ? { ...cot } : null, p: pag ? { ...pag } : null, sv: serv ? { ...serv, campos: { ...serv.campos } } : null, prioridade: s.prioridade, texto: "" }); }}>Enviar ajustes</Btn>);
    }
    if (pediu && faltaDesfecho) acoes.push(<Btn key="desfecho" variant="primary" disabled={ocupado} onClick={() => { setErro(null); setDesfechando({ tipo: null, motivo: "", texto: "" }); }}>Dar o desfecho</Btn>);
    if (pediu && s.status === "concluida" && !s.confirmado_em && !ehCotacao) acoes.push(<Btn key="ok" variant="positive" disabled={ocupado} onClick={() => void rodar("confirmar")}>Resolveu, obrigado</Btn>);
    if (pediu && (s.status === "concluida" || s.status === "recusada")) acoes.push(<Btn key="reabrir" disabled={ocupado} onClick={() => pedir({ acao: "reabrir", titulo: "O que ainda falta?", dica: "Volta pra fila de quem recebeu.", obrigatorio: true, botao: "Reabrir" })}>Reabrir</Btn>);

    // Mais ações
    const doAndamento: MenuGrupo["itens"] = [];
    if (recebe && s.aberta && s.responsavel_id && s.status !== "aguardando") {
      doAndamento.push({ rotulo: "Aguardando o fornecedor", onClick: () => aguardar("fornecedor") });
      doAndamento.push({ rotulo: "Aguardando outro setor", onClick: () => aguardar("outro_setor") });
    }
    if (podeAssumir && !assumirEmDestaque) doAndamento.push({ rotulo: assumirRotulo, onClick: () => void rodar("aceitar") });
    if (s.aberta && (recebe || pediu)) doAndamento.push({ rotulo: "Mudar o prazo", onClick: () => { setMudandoPrazo(true); setNovoPrazo(paraInputLocal(s.prazo)); } });
    if (doAndamento.length) mais.push({ titulo: "Andamento", itens: doAndamento });
    const encerrar: MenuGrupo["itens"] = [];
    if (recebe && s.aberta) encerrar.push({ rotulo: "Recusar o pedido", onClick: () => pedir({ acao: "recusar", titulo: "Por que não dá pra fazer?", dica: "Ex.: falta o passaporte; isso é com o Financeiro.", obrigatorio: true, botao: "Recusar", perigo: true }) });
    if (pediu && s.aberta && s.criado_por === meuId) encerrar.push({ rotulo: "Cancelar o pedido", onClick: () => pedir({ acao: "cancelar", titulo: "Cancelar o pedido?", dica: "Motivo (opcional). Ex.: o cliente desistiu.", obrigatorio: false, botao: "Cancelar pedido", perigo: true }) });
    if (encerrar.length) mais.push({ titulo: "Encerrar", itens: encerrar });
  }

  const tomPrazo = s ? (s.status === "recusada" ? "danger" : tomDoPrazo(s)) : "neutral";

  return (
    <div className="sol-modal">
      <button type="button" className="sol-modal__fundo" aria-label="Fechar" tabIndex={-1} onClick={onFechar} />
      <div ref={caixa} className="sol-modal__caixa" role="dialog" aria-modal="true" aria-labelledby={tituloId} tabIndex={-1} onKeyDown={prenderTab}>
        {/* ── Cabeçalho ── */}
        <header className="sol-modal__h">
          <div className="sol-modal__l1">
            <div className="sol-modal__chips">
              {s ? (
                <>
                  <b style={{ color: "var(--text)", fontSize: 13 }}>#{s.numero}</b>
                  <SectorChip setor={s.de_setor} />
                  <span aria-label="para">→</span>
                  <SectorChip setor={s.para_setor} />
                  <span>{s.tipo_rotulo ?? (ehCotacao ? "Cotação" : "Pedido")}</span>
                  <StatusChip tone={tomChip(s)}>{ehPagamento ? rotuloPagamento(s) : rotuloStatus(s)}</StatusChip>
                  {s.prioridade === "urgente" && s.aberta && <StatusChip tone="danger">Urgente</StatusChip>}
                  {s.prioridade === "alta" && s.aberta && <StatusChip tone="warn">{PRIORIDADE_SOL.alta}</StatusChip>}
                  {s.sem_dono_atrasada && <StatusChip tone="danger">Ninguém pegou há +2h úteis</StatusChip>}
                </>
              ) : <span>Solicitação</span>}
            </div>
            <div className="sol-modal__nav">
              {nav && nav.total > 1 && (
                <>
                  <span className="sol-modal__pos" aria-live="polite">{nav.pos} de {nav.total}</span>
                  <Btn size="sm" aria-label="Solicitação anterior" title="Anterior (←)" onClick={() => nav.onIr(-1)}
                    icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>} />
                  <Btn size="sm" aria-label="Próxima solicitação" title="Próxima (→)" onClick={() => nav.onIr(1)}
                    icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>} />
                </>
              )}
              <Btn size="sm" variant="ghost" aria-label="Fechar" title="Fechar (Esc)" onClick={onFechar}
                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>} />
            </div>
          </div>
          <h2 id={tituloId} className="sol-modal__titulo">{s ? s.titulo : erro ? "Não abriu" : "Carregando…"}</h2>
          {s && (
            <div className={`sol-faixa-prazo${tomPrazo !== "neutral" ? ` sol-faixa-prazo--${tomPrazo}` : ""}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              <span>{faixaDoPrazo(s)}</span>
            </div>
          )}
        </header>

        {!s ? (
          <div className="sol-modal__corpo" style={{ display: "block" }}>
            {erro ? <div className="sol-aviso sol-aviso--danger" role="alert">{erro}</div> : <p className="sol-carregando">Carregando…</p>}
          </div>
        ) : (
          <div className="sol-modal__corpo">
            {/* ── Coluna esquerda ── */}
            <div className="sol-modal__esq">
              {/* Painel da ação escolhida (fica no topo pra não sumir no celular) */}
              {temPainel && (
                <div ref={painel} className="sol-painel">
                  {ajustando && (
                    <>
                      <p className="sol-painel__t">Ajuste o pedido</p>
                      {ajustando.f && (
                        <FormCotacaoCampos f={ajustando.f} onMudar={(f) => setAjustando({ ...ajustando, f })}
                          prioridade={ajustando.prioridade} onPrioridade={(p) => setAjustando({ ...ajustando, prioridade: p })} pedidoFixo={PEDIDO_DO_TIPO[s.tipo_id ?? ""] === ajustando.f.pedido ? ajustando.f.pedido || undefined : undefined} />
                      )}
                      {ajustando.sv && s.tipo_id && <FormServicoCampos tipoId={s.tipo_id} f={ajustando.sv} onMudar={(sv) => setAjustando({ ...ajustando, sv })} />}
                      {ajustando.p && <FormPagamentoCampos f={ajustando.p} onMudar={(p) => setAjustando({ ...ajustando, p })} />}
                      <textarea className="sol-ta" rows={2} maxLength={2000} value={ajustando.texto} onChange={(e) => setAjustando({ ...ajustando, texto: e.target.value })}
                        aria-label="Recado com os ajustes"
                        placeholder={ajustando.f ? "Recado pro Operações (opcional). Ex.: as crianças têm 4 e 9 anos." : "O que você ajustou ou respondeu"} />
                      <div className="sol-painel__bts">
                        <Btn variant="primary" disabled={ocupado} onClick={() => void enviarAjustes()}>{ocupado ? "Enviando…" : "Enviar ajustes"}</Btn>
                        <Btn variant="ghost" onClick={() => setAjustando(null)}>Voltar</Btn>
                      </div>
                    </>
                  )}

                  {desfechando && (
                    <>
                      <p className="sol-painel__t">Qual foi o desfecho dessa cotação?</p>
                      <div className="sol-painel__bts">
                        <Btn variant={desfechando.tipo === "fechou" ? "primary" : "secondary"} aria-pressed={desfechando.tipo === "fechou"} onClick={() => setDesfechando({ ...desfechando, tipo: "fechou" })}>Fechou</Btn>
                        <Btn variant={desfechando.tipo === "nao_seguiu" ? "primary" : "secondary"} aria-pressed={desfechando.tipo === "nao_seguiu"} onClick={() => setDesfechando({ ...desfechando, tipo: "nao_seguiu" })}>Não seguiu</Btn>
                        <Btn variant="ghost" disabled={ocupado} onClick={() => void rodar("desfecho", null, "negociando")}>Ainda negociando (adia o prazo)</Btn>
                      </div>
                      {desfechando.tipo === "nao_seguiu" && (
                        <div>
                          <p className="sol-painel__d" style={{ marginBottom: 6 }}>Por que não seguiu?</p>
                          <div className="sol-painel__bts" role="radiogroup" aria-label="Motivo">
                            {MOTIVOS_NAO_SEGUIU.map(([k, r]) => (
                              <button key={k} type="button" role="radio" aria-checked={desfechando.motivo === k} className="qs-pill" data-active={desfechando.motivo === k ? "" : undefined}
                                style={{ minHeight: 36, fontSize: 13 }} onClick={() => setDesfechando({ ...desfechando, motivo: k })}>{r}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      {desfechando.tipo && (
                        <>
                          <textarea className="sol-ta" rows={2} maxLength={2000} value={desfechando.texto} onChange={(e) => setDesfechando({ ...desfechando, texto: e.target.value })}
                            aria-label="Comentário do desfecho"
                            placeholder={desfechando.tipo === "fechou" ? "Comentário (opcional). Ex.: fechou a opção 2." : desfechando.motivo === "outro" ? "Conte o motivo" : "Detalhe (opcional). Ex.: achou R$ 3 mil mais barato em outro lugar."} />
                          <div className="sol-painel__bts">
                            <Btn variant="primary"
                              disabled={ocupado || (desfechando.tipo === "nao_seguiu" && (!desfechando.motivo || (desfechando.motivo === "outro" && !desfechando.texto.trim())))}
                              onClick={() => void rodar("desfecho", desfechando.texto, desfechando.tipo === "fechou" ? "fechou" : `nao_seguiu:${desfechando.motivo}`)}>
                              {ocupado ? "Salvando…" : "Salvar desfecho"}
                            </Btn>
                            <Btn variant="ghost" onClick={() => setDesfechando(null)}>Voltar</Btn>
                          </div>
                        </>
                      )}
                      {!desfechando.tipo && <div><Btn variant="ghost" onClick={() => setDesfechando(null)}>Voltar</Btn></div>}
                    </>
                  )}

                  {pessoas !== null && (
                    <>
                      <p className="sol-painel__t">Quem de {NOME_SETOR[s.para_setor]} vai fazer este pedido?</p>
                      <p className="sol-painel__d">O pedido vai pro nome da pessoa escolhida: ela vê na fila dela e passa a responder pelo prazo.{s.responsavel_id ? ` Hoje está com ${primeiroNome(s.responsavel_nome) || "alguém"}.` : ""}</p>
                      {pessoas.length === 0 && <p className="sol-painel__d">Ninguém cadastrado nesse setor ainda.</p>}
                      <div className="sol-painel__bts">
                        {pessoas.map((p) => (
                          <Btn key={p.id} size="sm" disabled={ocupado || p.id === s.responsavel_id} onClick={() => void rodar("passar", null, p.id)}>{p.name}{p.id === meuId ? " (eu)" : ""}{p.id === s.responsavel_id ? " · atual" : ""}</Btn>
                        ))}
                      </div>
                      <div><Btn variant="ghost" onClick={() => setPessoas(null)}>Voltar</Btn></div>
                    </>
                  )}

                  {pedindo && (
                    <>
                      <label className="sol-painel__t" htmlFor={`${tituloId}-txt`}>{pedindo.titulo}</label>
                      <textarea id={`${tituloId}-txt`} className="sol-ta" rows={3} autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={pedindo.dica} maxLength={4000} />
                      <div className="sol-painel__bts">
                        <Btn variant={pedindo.perigo ? "secondary" : pedindo.acao === "concluir" ? "positive" : "primary"} className={pedindo.perigo ? "sol-perigo" : undefined}
                          disabled={ocupado || (pedindo.obrigatorio && !texto.trim())}
                          onClick={() => void rodar(pedindo.acao, texto, pedindo.extra)}>{ocupado ? "Salvando…" : pedindo.botao}</Btn>
                        <Btn variant="ghost" onClick={() => setPedindo(null)}>Voltar</Btn>
                      </div>
                    </>
                  )}

                  {amarrando && (
                    <>
                      <p className="sol-painel__t">De qual cliente e qual venda é esse pedido?</p>
                      <EscolherClienteVenda valor={escolha} onMudar={setEscolha} />
                      <div className="sol-painel__bts">
                        <Btn variant="primary" disabled={ocupado || !escolha} onClick={() => void salvarAmarra()}>{ocupado ? "Salvando…" : "Salvar"}</Btn>
                        <Btn variant="ghost" onClick={() => setAmarrando(false)}>Cancelar</Btn>
                      </div>
                    </>
                  )}

                  {mudandoPrazo && (
                    <>
                      <label className="sol-painel__t" htmlFor={`${tituloId}-prazo`}>Novo prazo</label>
                      <input id={`${tituloId}-prazo`} type="datetime-local" className="sol-ta" style={{ width: "auto" }} value={novoPrazo} onChange={(e) => setNovoPrazo(e.target.value)} />
                      <div className="sol-painel__bts">
                        <Btn variant="primary" disabled={ocupado || !novoPrazo} onClick={() => void rodar("prazo", null, deInputLocal(novoPrazo))}>Salvar prazo</Btn>
                        <Btn variant="ghost" onClick={() => setMudandoPrazo(false)}>Cancelar</Btn>
                      </div>
                    </>
                  )}
                  {erro && <div className="sol-aviso sol-aviso--danger" role="alert">{erro}</div>}
                </div>
              )}

              <section aria-labelledby={`${tituloId}-pedido`}>
                <h3 className="sol-rot" id={`${tituloId}-pedido`}>O que foi pedido</h3>
                <div className="sol-bloco">
                  <div className="sol-quem">
                    <Avatar name={s.criado_por_nome ?? "?"} size={28} />
                    <b>{s.criado_por_nome ?? "Alguém"}</b>
                    <SectorChip setor={s.de_setor} />
                    <span style={{ color: "var(--subtle)" }}>· {haQuanto(s.criado_em)}</span>
                  </div>
                  {pag ? <VerPagamento f={pag} />
                    : cot && ehCotacao ? <VerCotacao f={cot} />
                    : serv && s.tipo_id ? <VerServico tipoId={s.tipo_id} f={serv} />
                    : s.descricao ? <p className="sol-desc">{s.descricao}</p>
                    : <p className="sol-desc" style={{ color: "var(--subtle)" }}>Sem descrição.</p>}
                </div>
              </section>

              {esperandoAjuste && (
                <div className="sol-aviso sol-aviso--warn">
                  <b>{NOME_SETOR[s.para_setor]} pediu ajuste{ultimoAjuste?.autor_nome ? ` (${primeiroNome(ultimoAjuste.autor_nome)})` : ""}:</b> {ultimoAjuste?.texto ?? "falta informação de quem pediu."}
                  {pediu && <small>Clique em “Enviar ajustes”, complete o que falta e o pedido volta pra aprovação.</small>}
                </div>
              )}

              {ehPagamento && (
                <PagamentoNoDetalhe s={s} f={pag} financeiro={recebe && s.para_setor === "financeiro"} onMudou={() => { void carregar(); onMudou(); }} />
              )}

              {/* Em toda solicitação (0157): quem pediu abre a proposta aqui mesmo pra enviar. */}
              <PropostasDaSolicitacao s={s} podeMontar={recebe && s.aberta && !!links?.onAbrirProposta}
                onAbrirEditor={links?.onAbrirProposta ? (pid) => { onFechar(); links.onAbrirProposta?.(pid); } : undefined}
                onMudou={() => { void carregar(); onMudou(); }} />

              {ehCotacao && s.status === "concluida" && (s.desfecho ? (
                <div className={`sol-aviso ${s.desfecho === "fechou" ? "sol-aviso--ok" : "sol-aviso--warn"}`}>
                  <b>Desfecho: {s.desfecho === "fechou" ? "fechou" : `não seguiu — ${NOME_MOTIVO[s.desfecho_motivo ?? ""] ?? "outro motivo"}`}</b>
                  {s.desfecho_texto && <span style={{ display: "block", marginTop: 2 }}>{s.desfecho_texto}</span>}
                  <small>{s.desfecho_por_nome ?? "Quem pediu"} · {s.desfecho_em ? quando(s.desfecho_em) : ""}</small>
                </div>
              ) : s.desfecho_prazo && (
                <div className={`sol-aviso ${s.desfecho_atrasado ? "sol-aviso--danger" : "sol-aviso--warn"}`}>
                  <b>{s.desfecho_atrasado ? "Desfecho atrasado" : "Falta o desfecho"}:</b> {primeiroNome(s.criado_por_nome) || "quem pediu"} precisa contar até <b>{quando(s.desfecho_prazo)}</b> se a cotação fechou ou por que não seguiu.
                </div>
              ))}

              {(s.status === "concluida" || s.status === "recusada") && s.resolucao && (
                <div className={`sol-aviso ${s.status === "concluida" ? "sol-aviso--ok" : "sol-aviso--danger"}`}>
                  <b>{s.status === "concluida" ? (ehCotacao ? "Como foi entregue: " : "O que foi feito: ") : "Por que não deu: "}</b>{s.resolucao}
                  {s.status === "concluida" && s.confirmado_em && <small>Quem pediu confirmou {haQuanto(s.confirmado_em)}.</small>}
                </div>
              )}

              {/* ── Andamento ── */}
              <section aria-labelledby={`${tituloId}-and`}>
                <h3 className="sol-rot" id={`${tituloId}-and`}>Andamento</h3>
                <Timeline items={eventos.map((e) => {
                  const anx = porEvento.get(e.id);
                  return itemDoEvento(e, anx?.length ? <AnexosDaMensagem anexos={anx} links={linksAnx} onAbrir={vis.abrir} /> : undefined);
                })} />
                <ZonaDeSoltar api={fila} className="sol-comentar solq-vars" >
                  <label htmlFor={`${tituloId}-com`}>Comentário</label>
                  <div className="sol-comentar__l">
                    <BotaoClipe api={fila} disabled={ocupado} />
                    <textarea id={`${tituloId}-com`} className="sol-ta" rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={4000}
                      placeholder={fila.fila.length ? "Escreva algo sobre os arquivos (opcional)" : recebe ? `Pergunte ou avise ${primeiroNome(s.criado_por_nome) || "quem pediu"}…` : `Escreva pra ${NOME_SETOR[s.para_setor]}…`}
                      onPaste={fila.aoColar}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && (comentario.trim() || fila.fila.length)) void comentar(); }} />
                    <Btn variant="primary" disabled={ocupado || fila.enviando || (!comentario.trim() && !fila.fila.length)} onClick={() => void comentar()}>Enviar</Btn>
                  </div>
                  <FilaDeAnexos api={fila} />
                </ZonaDeSoltar>
                {erro && !temPainel && <div className="sol-aviso sol-aviso--danger" role="alert" style={{ marginTop: 8 }}>{erro}</div>}
              </section>
            </div>

            {/* ── Coluna direita ── */}
            <aside className="sol-modal__dir" aria-label="Cliente e andamento">
              <div className="sol-bloco">
                {cli ? (
                  <div className="sol-cli">
                    <Avatar name={cli.nome} size={40} />
                    <div className="sol-cli__tx">
                      <span className="sol-cli__n">{cli.nome}</span>
                      <span className="sol-cli__v">{cli.viagem ?? (s.cliente_id ? "sem venda específica" : s.lead_id ? "lead" : "")}</span>
                      {cli.tags.length > 0 && <span className="sol-chips-r" style={{ marginTop: 4 }}>{cli.tags.map((t) => <StatusChip key={t}>{t}</StatusChip>)}</span>}
                    </div>
                  </div>
                ) : <span className="sol-tw" style={{ fontSize: 13 }}>Sem cliente vinculado</span>}
                {s.cliente_id && links?.onAbrirCliente && <Btn onClick={() => links.onAbrirCliente?.(s.cliente_id!)}>Abrir ficha da cliente</Btn>}
                {!s.cliente_id && (recebe || pediu || doSetorQuePediu) && !amarrando && <Btn variant="primary" onClick={abrirAmarra}>Vincular cliente</Btn>}
                <div className="sol-links">
                  {s.viagem_id && links?.onAbrirViagem && <button type="button" className="sol-link" onClick={() => links.onAbrirViagem?.(s.viagem_id!)}>Abrir venda</button>}
                  {s.lead_id && links?.onAbrirLead && <button type="button" className="sol-link" onClick={() => links.onAbrirLead?.(s.lead_id!)}>Abrir lead</button>}
                  {s.conversa_id && links?.onAbrirConversa && <button type="button" className="sol-link" onClick={() => links.onAbrirConversa?.(s.conversa_id!)}>Abrir conversa</button>}
                  {s.cliente_id && (recebe || pediu || doSetorQuePediu) && !amarrando && <button type="button" className="sol-link sol-link--fraco" onClick={abrirAmarra}>Trocar cliente/venda</button>}
                </div>
              </div>

              <section className="sol-bloco solq-vars" aria-label="Anexos">
                <h3 className="solq-rot">
                  Anexos {anexos.length > 0 && <span className="solq-col__n">{anexos.length}</span>}
                  <BotaoClipe api={fila} className="solq-rot__btn" rotulo="Anexar ao pedido" />
                </h3>
                <GaleriaAnexos anexos={anexos} links={linksAnx} onAbrir={vis.abrir}
                  vazio={<p className="sol-tw" style={{ fontSize: 12.5, margin: 0 }}>Nenhum arquivo. Use o clipe, arraste no campo de comentário ou cole um print.</p>} />
              </section>

              <dl className="sol-dl">
                <dt>Prazo</dt>
                <dd>
                  <span className={tomPrazo === "danger" ? "sol-td" : tomPrazo === "warn" ? "sol-tw" : undefined}>{textoPrazo(s).texto}</span>
                  {s.aberta && (recebe || pediu) && !mudandoPrazo && (
                    <> · <button type="button" className="sol-link sol-link--fraco" onClick={() => { setMudandoPrazo(true); setNovoPrazo(paraInputLocal(s.prazo)); }}>mudar</button></>
                  )}
                </dd>
                <dt>Prioridade</dt>
                <dd className={s.prioridade === "urgente" ? "sol-td" : s.prioridade === "alta" ? "sol-tw" : undefined}>{PRIORIDADE_SOL[s.prioridade]}</dd>
                <dt>Pediu</dt>
                <dd>
                  {s.criado_por_nome ?? "—"} · {NOME_SETOR[s.de_setor]}
                  {zapDeQuemPediu && (
                    <a className="sol-link" style={{ display: "block", marginTop: 2 }} href={`https://wa.me/${zapDeQuemPediu}`} target="_blank" rel="noreferrer">
                      Falar com {primeiroNome(s.criado_por_nome) || "quem pediu"} no WhatsApp
                    </a>
                  )}
                </dd>
                <dt>Com</dt>
                <dd>
                  {s.responsavel_nome ? <>{s.responsavel_id === meuId ? "Você" : s.responsavel_nome} · {NOME_SETOR[s.para_setor]}</> : <span className="sol-tw">Ninguém pegou ainda</span>}
                  {foiDistribuida && <span style={{ display: "block", fontSize: 12, color: "var(--subtle)" }}>distribuída automaticamente</span>}
                </dd>
              </dl>

              {(acoes.length > 0 || mais.length > 0) && (
                <div className="sol-acoes" aria-label="Ações">
                  {acoes}
                  {mais.length > 0 && <Menu rotulo="Mais ações" grupos={mais} />}
                  {recebe && s.aberta && (
                    <p className="sol-acoes__dica">
                      {s.responsavel_id === meuId
                        ? <>Este pedido está <b>com você</b>: você responde por ele e pelo prazo. Se outra pessoa de {NOME_SETOR[s.para_setor]} for fazer, use <b>Passar para outra pessoa</b>.</>
                        : <><b>Assumir</b>: o pedido fica no seu nome e você responde pelo prazo{s.responsavel_id ? ` (sai do nome de ${primeiroNome(s.responsavel_nome) || "quem estava"})` : ""}. <b>Escolher quem faz</b>: você indica a pessoa de {NOME_SETOR[s.para_setor]} que vai fazer.</>}
                    </p>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
      {vis.aberto && anexos.some((a) => a.id === vis.aberto) && (
        <Visualizador anexos={anexos} inicial={vis.aberto} onFechar={vis.fechar}
          podeApagar={(a) => podeApagarAnexo(a, meuId, gestorDoPedido)}
          onApagar={async (a) => { await apagarAnexo(a.id); await carregar(); onMudou(); }} />
      )}
    </div>
  );
}

/** Ponto + nome do setor (usado fora daqui; o redesign usa SectorChip). */
export function SetorChip({ s }: { s: Setor }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: "var(--ink)" }}>
      <span className="w-2 h-2 rounded-full" style={{ background: COR_SETOR[s] }} aria-hidden />{NOME_SETOR[s]}
    </span>
  );
}
