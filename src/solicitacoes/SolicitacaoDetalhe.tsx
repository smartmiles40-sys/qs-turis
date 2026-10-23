// src/solicitacoes/SolicitacaoDetalhe.tsx
// -----------------------------------------------------------------------------
// O cartão aberto (0149): o que foi pedido, de quem pra quem, prazo, os botões
// de cada lado e a conversa/histórico — a troca sobre o pedido fica AQUI, não
// no WhatsApp pessoal.
//
//   quem RECEBE: Assumir · Escolher quem faz / Passar pra outra pessoa… · Aguardando… · Concluir · Recusar
//   quem PEDIU:  Confirmar ✔ · Reabrir ↺ · Cancelar
//   todo mundo:  comentar
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
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { setoresDe, useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao, Etiqueta, Modal } from "@/rel/ui";
import EscolherClienteVenda, { type Escolha } from "./EscolherClienteVenda";
import PropostasDaSolicitacao from "@/propostas/PropostasDaSolicitacao";
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

export interface LinksSol {
  onAbrirViagem?: (id: string) => void;
  onAbrirCliente?: (id: string) => void;
  onAbrirLead?: (id: string) => void;
  onAbrirConversa?: (id: string) => void;
  /** Propostas (0156): o editor, nas áreas que têm a tela de Propostas. Sem isso, a
   *  solicitação ainda mostra as propostas e quem pediu abre/envia por cima (0157). */
  onAbrirProposta?: (id: string) => void;
}

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

function Evento({ e }: { e: EventoSol }) {
  const comentario = e.tipo === "comentario";
  let extra = "";
  if (e.tipo === "passada" && e.para) extra = ` ${e.para}`;
  if (e.tipo === "status" && e.para?.startsWith("aguardando:")) extra = `: aguardando ${AGUARDANDO[e.para.split(":")[1] as AguardandoQuem] ?? ""}`;
  if (e.tipo === "status" && e.para === "em_andamento") extra = ": voltou pra em andamento";
  if (e.tipo === "prazo" && e.para) extra = ` pra ${quando(e.para)}`;
  if (e.tipo === "vinculada" && e.para) extra = ` ${e.para}`;
  if (e.tipo === "desfecho") extra = textoDesfecho(e.para);
  return (
    <li className="flex gap-2.5">
      <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" aria-hidden
        style={{ background: e.tipo === "concluida" || e.tipo === "confirmada" || e.para === "fechou" ? "var(--rel)" : e.tipo === "recusada" || e.tipo === "reaberta" ? "var(--err-ink)" : e.tipo === "ajuste" ? "var(--warn-ink)" : "var(--line)" }} />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
          <b style={{ color: "var(--ink2)" }}>{e.autor_nome ?? "Alguém"}</b> {ROTULO_EVENTO[e.tipo]}{extra} · {quando(e.criado_em)}
        </p>
        {e.texto && (
          <p className={`text-[13.5px] whitespace-pre-wrap mt-0.5 ${comentario ? "rounded-lg px-3 py-2" : ""}`}
            style={{ color: "var(--ink)", ...(comentario ? { background: "var(--card2)" } : {}) }}>{e.texto}</p>
        )}
      </div>
    </li>
  );
}

type Pedindo = { acao: AcaoSol; titulo: string; dica: string; obrigatorio: boolean; botao: string; perigo?: boolean; extra?: string };

export default function SolicitacaoDetalhe({ id, onFechar, onMudou, links }: {
  id: string | null;
  onFechar: () => void;
  onMudou: () => void;
  links?: LinksSol;
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
  // 0158
  const [ajustando, setAjustando] = useState<{ f: FormCotacao | null; p?: FormPagamento | null; sv?: FormServico | null; prioridade: PrioridadeSol; texto: string } | null>(null);
  const [desfechando, setDesfechando] = useState<{ tipo: "fechou" | "nao_seguiu" | null; motivo: string; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    if (!id) return;
    try { const r = await carregarSolicitacao(id); setS(r.s); setEventos(r.eventos); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); }
  }, [id]);
  useEffect(() => {
    setS(null); setEventos([]); setComentario(""); setPedindo(null); setPessoas(null); setMudandoPrazo(false); setAmarrando(false); setErro(null);
    setAjustando(null); setDesfechando(null);
    if (id) { void carregar(); void marcarVisto(id).then(onMudou); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    setZapDeQuemPediu(null);
    if (s?.criado_por && s.criado_por !== meuId) void whatsappDe(s.criado_por).then(setZapDeQuemPediu).catch(() => {});
  }, [s?.criado_por, meuId]);

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
  const prazo = s ? textoPrazo(s) : null;
  const cot = s ? lerCotacao(s.formulario) : null;
  const ehCotacao = !!s?.cotacao;
  const ehPagamento = !!s && !!TIPO_PAG_DO[s.tipo_id ?? ""];
  const pag = ehPagamento && s ? lerPagamento(s.formulario) : null;
  // 0203: pedido de serviço (assento, remarcação, emissão…) com os campos do tipo
  const serv = s && !ehPagamento && !ehCotacao ? lerServico(s.formulario) : null;
  const esperandoAjuste = !!s && s.status === "aguardando" && s.aguardando_quem === "solicitante";
  const ultimoAjuste = [...eventos].reverse().find((e) => e.tipo === "ajuste");
  const faltaDesfecho = !!s && s.falta_desfecho && !s.desfecho;

  const pedir = (p: Pedindo) => { setPedindo(p); setTexto(""); setErro(null); };

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

  return (
    <Modal aberto={!!id} titulo={s ? `${ehCotacao ? "Cotação" : "Solicitação"} #${s.numero}` : "Solicitação"} onFechar={onFechar} largura={ehCotacao || ehPagamento ? 760 : 680}>
      {!s ? (
        erro ? <Aviso tom="erro">{erro}</Aviso> : <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : (
        <div className="space-y-4">
          {/* De → Para */}
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]" style={{ color: "var(--ink2)" }}>
            <SetorChip s={s.de_setor} /> <span aria-hidden>→</span> <SetorChip s={s.para_setor} />
            <Etiqueta tom={tomStatus(s)}>{ehPagamento ? rotuloPagamento(s) : rotuloStatus(s)}</Etiqueta>
            {s.prioridade !== "normal" && <Etiqueta tom={s.prioridade === "urgente" ? "erro" : "aviso"}>{PRIORIDADE_SOL[s.prioridade]}</Etiqueta>}
            {s.sem_dono_atrasada && <Etiqueta tom="erro">Ninguém pegou há +2h úteis</Etiqueta>}
          </div>

          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{s.tipo_rotulo ?? "Pedido"}</p>
            <h3 className="text-[17px] font-bold leading-snug mt-0.5" style={{ color: "var(--ink)" }}>{s.titulo}</h3>
            {pag ? <div className="mt-2.5"><VerPagamento f={pag} /></div>
              : cot && ehCotacao ? <div className="mt-2.5"><VerCotacao f={cot} /></div>
              : serv && s.tipo_id ? <div className="mt-2.5"><VerServico tipoId={s.tipo_id} f={serv} /></div>
              : s.descricao && <p className="text-[14px] whitespace-pre-wrap mt-2" style={{ color: "var(--ink2)" }}>{s.descricao}</p>}
          </div>

          {esperandoAjuste && (
            <Aviso>
              <b>{NOME_SETOR[s.para_setor]} pediu ajuste{ultimoAjuste?.autor_nome ? ` (${primeiroNome(ultimoAjuste.autor_nome)})` : ""}:</b> {ultimoAjuste?.texto ?? "falta informação de quem pediu."}
              {pediu && <span className="block mt-1 text-[12px]">Clique em “Enviar ajustes”, complete o que falta e o pedido volta pra aprovação.</span>}
            </Aviso>
          )}

          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
            <Linha rotulo="Pediu">{s.criado_por_nome ?? "—"} <span style={{ color: "var(--ink3)" }}>· {haQuanto(s.criado_em)}</span>
              {zapDeQuemPediu && (
                <a className="ml-2 underline text-[12px]" style={{ color: "var(--rel-ink)" }} href={`https://wa.me/${zapDeQuemPediu}`} target="_blank" rel="noreferrer">
                  falar com {primeiroNome(s.criado_por_nome) || "quem pediu"} no WhatsApp
                </a>
              )}
            </Linha>
            <Linha rotulo="Com quem está">{s.responsavel_nome ?? <span style={{ color: "var(--warn-ink)" }}>ninguém pegou ainda</span>}</Linha>
            <Linha rotulo="Prazo">
              <span style={{ color: prazo?.tom === "erro" ? "var(--err-ink)" : prazo?.tom === "aviso" ? "var(--warn-ink)" : "var(--ink)" }}>{prazo?.texto}</span>
              {s.aberta && (recebe || pediu) && !mudandoPrazo && (
                <button className="ml-2 underline text-[12px]" style={{ color: "var(--ink3)" }} onClick={() => { setMudandoPrazo(true); setNovoPrazo(paraInputLocal(s.prazo)); }}>mudar</button>
              )}
            </Linha>
            <Linha rotulo={s.viagem_id ? "Cliente · venda" : "Cliente"}>
              {s.cliente_id || s.sobre_nome ? <span>{s.sobre_nome ?? "cliente"}</span> : <span style={{ color: "var(--warn-ink)" }}>sem cliente</span>}
              {!s.viagem_id && s.cliente_id && <span style={{ color: "var(--ink3)" }}> · sem venda específica</span>}
              <span className="ml-2 inline-flex flex-wrap gap-2 text-[12px]">
                {s.viagem_id && links?.onAbrirViagem && <button className="underline" style={{ color: "var(--rel-ink)" }} onClick={() => links.onAbrirViagem?.(s.viagem_id!)}>abrir venda</button>}
                {s.cliente_id && links?.onAbrirCliente && <button className="underline" style={{ color: "var(--rel-ink)" }} onClick={() => links.onAbrirCliente?.(s.cliente_id!)}>abrir ficha</button>}
                {s.lead_id && links?.onAbrirLead && <button className="underline" style={{ color: "var(--rel-ink)" }} onClick={() => links.onAbrirLead?.(s.lead_id!)}>abrir lead</button>}
                {s.conversa_id && links?.onAbrirConversa && <button className="underline" style={{ color: "var(--rel-ink)" }} onClick={() => links.onAbrirConversa?.(s.conversa_id!)}>abrir conversa</button>}
                {(recebe || pediu || doSetorQuePediu) && !amarrando && (
                  <button className="underline" style={{ color: s.cliente_id ? "var(--ink3)" : "var(--rel-ink)", fontWeight: s.cliente_id ? 400 : 600 }}
                    onClick={() => { setAmarrando(true); setEscolha(s.cliente_id ? { clienteId: s.cliente_id, clienteNome: (s.sobre_nome ?? "").split(" · ")[0] || "Cliente", viagemId: s.viagem_id, vendaTexto: null } : null); }}>
                    {s.cliente_id ? "trocar cliente/venda" : "amarrar cliente"}
                  </button>
                )}
              </span>
            </Linha>
          </dl>

          {ehPagamento && (
            <PagamentoNoDetalhe s={s} f={pag} financeiro={recebe && s.para_setor === "financeiro"} onMudou={() => { void carregar(); onMudou(); }} />
          )}

          {/* Em toda solicitação (0157): quem pediu abre a proposta aqui mesmo pra enviar. */}
          <PropostasDaSolicitacao s={s} podeMontar={recebe && s.aberta && !!links?.onAbrirProposta}
            onAbrirEditor={links?.onAbrirProposta ? (pid) => { onFechar(); links.onAbrirProposta?.(pid); } : undefined}
            onMudou={() => { void carregar(); onMudou(); }} />


          {amarrando && (
            <div className="rel-card p-3 space-y-2">
              <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>De qual cliente e qual venda é esse pedido?</p>
              <EscolherClienteVenda valor={escolha} onMudar={setEscolha} />
              <div className="flex gap-2">
                <Botao variante="primario" disabled={ocupado || !escolha} onClick={() => void salvarAmarra()}>{ocupado ? "Salvando…" : "Salvar"}</Botao>
                <Botao variante="fantasma" onClick={() => setAmarrando(false)}>Cancelar</Botao>
              </div>
            </div>
          )}

          {mudandoPrazo && (
            <div className="flex flex-wrap items-center gap-2">
              <input type="datetime-local" className="rel-input" style={{ width: "auto" }} value={novoPrazo} onChange={(e) => setNovoPrazo(e.target.value)} />
              <Botao variante="primario" disabled={ocupado || !novoPrazo} onClick={() => void rodar("prazo", null, deInputLocal(novoPrazo))}>Salvar prazo</Botao>
              <Botao variante="fantasma" onClick={() => setMudandoPrazo(false)}>Cancelar</Botao>
            </div>
          )}

          {ehCotacao && s.status === "concluida" && (s.desfecho ? (
            <Aviso tom={s.desfecho === "fechou" ? "ok" : "aviso"}>
              <b>Desfecho: {s.desfecho === "fechou" ? "fechou ✅" : `não seguiu — ${NOME_MOTIVO[s.desfecho_motivo ?? ""] ?? "outro motivo"}`}</b>
              {s.desfecho_texto && <span className="block mt-0.5">{s.desfecho_texto}</span>}
              <span className="block mt-1 text-[12px]">{s.desfecho_por_nome ?? "Quem pediu"} · {s.desfecho_em ? quando(s.desfecho_em) : ""}</span>
            </Aviso>
          ) : s.desfecho_prazo && (
            <Aviso tom={s.desfecho_atrasado ? "erro" : "aviso"}>
              <b>{s.desfecho_atrasado ? "Desfecho atrasado" : "Falta o desfecho"}:</b> {primeiroNome(s.criado_por_nome) || "quem pediu"} precisa contar até <b>{quando(s.desfecho_prazo)}</b> se a cotação fechou ou por que não seguiu.
            </Aviso>
          ))}

          {(s.status === "concluida" || s.status === "recusada") && s.resolucao && (
            <Aviso tom={s.status === "concluida" ? "ok" : "erro"}>
              <b>{s.status === "concluida" ? (ehCotacao ? "Como foi entregue: " : "O que foi feito: ") : "Por que não deu: "}</b>{s.resolucao}
              {s.status === "concluida" && s.confirmado_em && <span className="block mt-1 text-[12px]">✔ Quem pediu confirmou {haQuanto(s.confirmado_em)}.</span>}
            </Aviso>
          )}

          {/* ── Botões ── */}
          {!pedindo && pessoas === null && !ajustando && !desfechando && (
            <div className="flex flex-wrap gap-2">
              {recebe && s.aberta && (s.responsavel_id !== meuId || (ehCotacao && s.status === "nova")) && (
                <Botao variante="primario" disabled={ocupado} onClick={() => void rodar("aceitar")}>
                  {ehCotacao && s.status === "nova" ? "Aprovar — começar a cotação" : s.responsavel_id ? `Assumir no lugar de ${primeiroNome(s.responsavel_nome) || "quem está"}` : "Assumir — eu faço"}
                </Botao>
              )}
              {recebe && s.aberta && !esperandoAjuste && (
                <Botao disabled={ocupado} onClick={() => pedir({ acao: "ajuste", titulo: "O que está faltando?", dica: "Ex.: falta a idade das crianças; confirmar se o aéreo sai de Campinas.", obrigatorio: true, botao: "Pedir ajuste" })}>Pedir ajuste</Botao>
              )}
              {recebe && s.aberta && <Botao disabled={ocupado} onClick={() => pessoasDoSetor(s.para_setor).then(setPessoas).catch(() => setPessoas([]))}>{s.responsavel_id === meuId ? "Passar pra outra pessoa…" : "Escolher quem faz…"}</Botao>}
              {recebe && s.aberta && s.responsavel_id && !ehPagamento && (
                <Botao variante={s.responsavel_id === meuId ? "primario" : "secundario"} disabled={ocupado}
                  onClick={() => pedir(ehCotacao
                    ? { acao: "concluir", titulo: "Como foi entregue a cotação?", dica: "Ex.: proposta nº 12 pronta aqui no QS com 2 opções.", obrigatorio: true, botao: "Entregar cotação" }
                    : { acao: "concluir", titulo: "O que foi feito?", dica: "Quem pediu recebe isso. Ex.: cotação enviada no e-mail, 3 opções; emitido o localizador ABC123.", obrigatorio: true, botao: "Concluir" })}>{ehCotacao ? "Entregar cotação" : "Concluir"}</Botao>
              )}
              {recebe && s.status !== "aguardando" && s.aberta && s.responsavel_id && (
                <select className="rel-input" style={{ width: "auto" }} value="" disabled={ocupado} aria-label="Aguardando quem"
                  onChange={(e) => e.target.value && pedir({ acao: "aguardar", extra: e.target.value, titulo: `Aguardando ${AGUARDANDO[e.target.value as AguardandoQuem]}`, dica: "O que falta (opcional).", obrigatorio: false, botao: "Marcar aguardando" })}>
                  <option value="">Aguardando…</option>
                  {(Object.entries(AGUARDANDO) as [AguardandoQuem, string][]).filter(([k]) => k !== "solicitante").map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                </select>
              )}
              {recebe && s.status === "aguardando" && <Botao disabled={ocupado} onClick={() => void rodar("retomar")}>{ehCotacao ? "Voltar pra em cotação" : "Voltar pra em andamento"}</Botao>}
              {recebe && s.aberta && <Botao variante="fantasma" disabled={ocupado} onClick={() => pedir({ acao: "recusar", titulo: "Por que não dá pra fazer?", dica: "Ex.: falta o passaporte; isso é com o Financeiro.", obrigatorio: true, botao: "Recusar", perigo: true })}>Recusar</Botao>}

              {pediu && esperandoAjuste && (
                <Botao variante="primario" disabled={ocupado} onClick={() => { setErro(null); setAjustando({ f: cot && ehCotacao ? { ...cot } : null, p: pag ? { ...pag } : null, sv: serv ? { ...serv, campos: { ...serv.campos } } : null, prioridade: s.prioridade, texto: "" }); }}>Enviar ajustes</Botao>
              )}
              {pediu && faltaDesfecho && <Botao variante="primario" disabled={ocupado} onClick={() => { setErro(null); setDesfechando({ tipo: null, motivo: "", texto: "" }); }}>Dar o desfecho</Botao>}
              {pediu && s.status === "concluida" && !s.confirmado_em && !ehCotacao && <Botao variante="primario" disabled={ocupado} onClick={() => void rodar("confirmar")}>✔ Resolveu, obrigado</Botao>}
              {pediu && (s.status === "concluida" || s.status === "recusada") && <Botao disabled={ocupado} onClick={() => pedir({ acao: "reabrir", titulo: "O que ainda falta?", dica: "Volta pra fila de quem recebeu.", obrigatorio: true, botao: "Reabrir" })}>↺ Reabrir</Botao>}
              {recebe && s.aberta && (
                <p className="basis-full text-[12px] leading-snug" style={{ color: "var(--ink3)" }}>
                  {s.responsavel_id === meuId
                    ? <>Este pedido está <b>com você</b>: você responde por ele e pelo prazo. Se outra pessoa de {NOME_SETOR[s.para_setor]} for fazer, use <b>Passar pra outra pessoa</b> — o pedido sai do seu nome e vai pro dela.</>
                    : <><b>Assumir</b>: o pedido fica no seu nome e você passa a responder por ele e pelo prazo{s.responsavel_id ? ` (sai do nome de ${primeiroNome(s.responsavel_nome) || "quem estava"})` : ""}. <b>Escolher quem faz</b>: você indica a pessoa de {NOME_SETOR[s.para_setor]} que vai fazer, e o pedido vai pro nome dela.</>}
                </p>
              )}
              {pediu && s.aberta && s.criado_por === meuId && <Botao variante="fantasma" disabled={ocupado} onClick={() => pedir({ acao: "cancelar", titulo: "Cancelar o pedido?", dica: "Motivo (opcional). Ex.: o cliente desistiu.", obrigatorio: false, botao: "Cancelar pedido", perigo: true })}>Cancelar pedido</Botao>}
            </div>
          )}

          {ajustando && (
            <div className="rel-card p-3 space-y-3">
              <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Ajuste o pedido</p>
              {ajustando.f && (
                <FormCotacaoCampos f={ajustando.f} onMudar={(f) => setAjustando({ ...ajustando, f })}
                  prioridade={ajustando.prioridade} onPrioridade={(p) => setAjustando({ ...ajustando, prioridade: p })} pedidoFixo={PEDIDO_DO_TIPO[s.tipo_id ?? ""] === ajustando.f.pedido ? ajustando.f.pedido || undefined : undefined} />
              )}
              {ajustando.sv && s.tipo_id && <FormServicoCampos tipoId={s.tipo_id} f={ajustando.sv} onMudar={(sv) => setAjustando({ ...ajustando, sv })} />}
              {ajustando.p && <FormPagamentoCampos f={ajustando.p} onMudar={(p) => setAjustando({ ...ajustando, p })} />}
              <textarea className="rel-input" rows={2} maxLength={2000} value={ajustando.texto} onChange={(e) => setAjustando({ ...ajustando, texto: e.target.value })}
                placeholder={ajustando.f ? "Recado pro Operações (opcional). Ex.: as crianças têm 4 e 9 anos." : "O que você ajustou ou respondeu"} />
              <div className="flex gap-2">
                <Botao variante="primario" disabled={ocupado} onClick={() => void enviarAjustes()}>{ocupado ? "Enviando…" : "Enviar ajustes"}</Botao>
                <Botao variante="fantasma" onClick={() => setAjustando(null)}>Voltar</Botao>
              </div>
            </div>
          )}

          {desfechando && (
            <div className="rel-card p-3 space-y-3">
              <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Qual foi o desfecho dessa cotação?</p>
              <div className="flex flex-wrap gap-1.5">
                <Botao variante={desfechando.tipo === "fechou" ? "primario" : "secundario"} onClick={() => setDesfechando({ ...desfechando, tipo: "fechou" })}>✅ Fechou</Botao>
                <Botao variante={desfechando.tipo === "nao_seguiu" ? "primario" : "secundario"} onClick={() => setDesfechando({ ...desfechando, tipo: "nao_seguiu" })}>✖ Não seguiu</Botao>
                <Botao variante="fantasma" disabled={ocupado} onClick={() => void rodar("desfecho", null, "negociando")}>⏳ Ainda negociando (adia o prazo)</Botao>
              </div>
              {desfechando.tipo === "nao_seguiu" && (
                <div>
                  <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Por que não seguiu?</p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Motivo">
                    {MOTIVOS_NAO_SEGUIU.map(([k, r]) => (
                      <button key={k} type="button" role="radio" aria-checked={desfechando.motivo === k} onClick={() => setDesfechando({ ...desfechando, motivo: k })}
                        className="rounded-full px-3 h-8 text-[12.5px] border"
                        style={desfechando.motivo === k ? { background: "var(--rel-soft)", color: "var(--rel-ink)", borderColor: "var(--rel)", fontWeight: 600 } : { borderColor: "var(--line)", color: "var(--ink2)" }}>{r}</button>
                    ))}
                  </div>
                </div>
              )}
              {desfechando.tipo && (
                <>
                  <textarea className="rel-input" rows={2} maxLength={2000} value={desfechando.texto} onChange={(e) => setDesfechando({ ...desfechando, texto: e.target.value })}
                    placeholder={desfechando.tipo === "fechou" ? "Comentário (opcional). Ex.: fechou a opção 2." : desfechando.motivo === "outro" ? "Conte o motivo" : "Detalhe (opcional). Ex.: achou R$ 3 mil mais barato em outro lugar."} />
                  <div className="flex gap-2">
                    <Botao variante="primario"
                      disabled={ocupado || (desfechando.tipo === "nao_seguiu" && (!desfechando.motivo || (desfechando.motivo === "outro" && !desfechando.texto.trim())))}
                      onClick={() => void rodar("desfecho", desfechando.texto, desfechando.tipo === "fechou" ? "fechou" : `nao_seguiu:${desfechando.motivo}`)}>
                      {ocupado ? "Salvando…" : "Salvar desfecho"}
                    </Botao>
                    <Botao variante="fantasma" onClick={() => setDesfechando(null)}>Voltar</Botao>
                  </div>
                </>
              )}
              {!desfechando.tipo && <Botao variante="fantasma" onClick={() => setDesfechando(null)}>Voltar</Botao>}
            </div>
          )}

          {pessoas !== null && (
            <div className="rel-card p-3 space-y-2">
              <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Quem de {NOME_SETOR[s.para_setor]} vai fazer este pedido?</p>
              <p className="text-[12px]" style={{ color: "var(--ink3)" }}>O pedido vai pro nome da pessoa escolhida: ela vê na fila dela e passa a responder pelo prazo.{s.responsavel_id ? ` Hoje está com ${primeiroNome(s.responsavel_nome) || "alguém"}.` : ""}</p>
              {pessoas.length === 0 && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Ninguém cadastrado nesse setor ainda.</p>}
              <div className="flex flex-wrap gap-1.5">
                {pessoas.map((p) => (
                  <Botao key={p.id} disabled={ocupado || p.id === s.responsavel_id} onClick={() => void rodar("passar", null, p.id)}>{p.name}{p.id === meuId ? " (eu)" : ""}{p.id === s.responsavel_id ? " · atual" : ""}</Botao>
                ))}
              </div>
              <Botao variante="fantasma" onClick={() => setPessoas(null)}>Voltar</Botao>
            </div>
          )}

          {pedindo && (
            <div className="rel-card p-3 space-y-2">
              <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{pedindo.titulo}</p>
              <textarea className="rel-input" rows={3} autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={pedindo.dica} maxLength={4000} />
              <div className="flex gap-2">
                <Botao variante={pedindo.perigo ? "perigo" : "primario"} disabled={ocupado || (pedindo.obrigatorio && !texto.trim())}
                  onClick={() => void rodar(pedindo.acao, texto, pedindo.extra)}>{ocupado ? "Salvando…" : pedindo.botao}</Botao>
                <Botao variante="fantasma" onClick={() => setPedindo(null)}>Voltar</Botao>
              </div>
            </div>
          )}

          {erro && <Aviso tom="erro">{erro}</Aviso>}

          {/* ── Conversa / histórico ── */}
          <div className="border-t pt-4" style={{ borderColor: "var(--line)" }}>
            <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ink3)" }}>Conversa e histórico</p>
            <ol className="space-y-3">{eventos.map((e) => <Evento key={e.id} e={e} />)}</ol>
            <div className="flex gap-2 mt-3">
              <textarea className="rel-input" rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={4000}
                placeholder={recebe ? `Pergunte ou avise ${primeiroNome(s.criado_por_nome) || "quem pediu"}…` : `Escreva pra ${NOME_SETOR[s.para_setor]}…`}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && comentario.trim()) void rodar("comentar", comentario); }} />
              <Botao variante="primario" disabled={ocupado || !comentario.trim()} onClick={() => void rodar("comentar", comentario)} style={{ alignSelf: "flex-end" }}>Enviar</Botao>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{rotulo}</dt>
      <dd style={{ color: "var(--ink)" }}>{children}</dd>
    </div>
  );
}

export function SetorChip({ s }: { s: Setor }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: "var(--ink)" }}>
      <span className="w-2 h-2 rounded-full" style={{ background: COR_SETOR[s] }} aria-hidden />{NOME_SETOR[s]}
    </span>
  );
}
