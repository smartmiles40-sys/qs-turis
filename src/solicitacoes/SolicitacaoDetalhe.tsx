// src/solicitacoes/SolicitacaoDetalhe.tsx
// -----------------------------------------------------------------------------
// O cartão aberto (0149): o que foi pedido, de quem pra quem, prazo, os botões
// de cada lado e a conversa/histórico — a troca sobre o pedido fica AQUI, não
// no WhatsApp pessoal.
//
//   quem RECEBE: Aceitar · Passar pra… · Aguardando… · Concluir · Recusar
//   quem PEDIU:  Confirmar ✔ · Reabrir ↺ · Cancelar
//   todo mundo:  comentar
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { setoresDe, useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao, Etiqueta, Modal } from "@/rel/ui";
import EscolherClienteVenda, { type Escolha } from "./EscolherClienteVenda";
import PropostasDaSolicitacao from "@/propostas/PropostasDaSolicitacao";
import {
  AGUARDANDO, COR_SETOR, NOME_SETOR, PRIORIDADE_SOL, STATUS_SOL, TOM_SOL, agir, carregarSolicitacao, deInputLocal, haQuanto, marcarVisto,
  paraInputLocal, pessoasDoSetor, primeiroNome, textoPrazo, vincular,
  type AcaoSol, type AguardandoQuem, type EventoSol, type Pessoa, type Setor, type Solicitacao,
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
  criada: "pediu", aceita: "aceitou", passada: "passou pra", status: "mudou o andamento", comentario: "comentou", prazo: "mudou o prazo",
  concluida: "concluiu", confirmada: "confirmou que resolveu", reaberta: "reabriu", recusada: "recusou", cancelada: "cancelou",
  vinculada: "amarrou a",
};

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
  return (
    <li className="flex gap-2.5">
      <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" aria-hidden
        style={{ background: e.tipo === "concluida" || e.tipo === "confirmada" ? "var(--rel)" : e.tipo === "recusada" || e.tipo === "reaberta" ? "var(--err-ink)" : "var(--line)" }} />
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
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!id) return;
    try { const r = await carregarSolicitacao(id); setS(r.s); setEventos(r.eventos); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); }
  }, [id]);
  useEffect(() => {
    setS(null); setEventos([]); setComentario(""); setPedindo(null); setPessoas(null); setMudandoPrazo(false); setAmarrando(false); setErro(null);
    if (id) { void carregar(); void marcarVisto(id).then(onMudou); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function rodar(acao: AcaoSol, t?: string | null, extra?: string | null) {
    if (!s) return;
    setOcupado(true); setErro(null);
    try { await agir(s.id, acao, t, extra); setPedindo(null); setTexto(""); setComentario(""); setPessoas(null); setMudandoPrazo(false); await carregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não deu certo."); }
    finally { setOcupado(false); }
  }

  if (!id) return null;
  const recebe = !!s && meusSetores.includes(s.para_setor);
  const pediu = !!s && (s.criado_por === meuId || meusSetores.includes(s.de_setor));
  const prazo = s ? textoPrazo(s) : null;

  const pedir = (p: Pedindo) => { setPedindo(p); setTexto(""); setErro(null); };

  async function salvarAmarra() {
    if (!s || !escolha) return;
    setOcupado(true); setErro(null);
    try { await vincular(s.id, escolha.clienteId, escolha.viagemId); setAmarrando(false); await carregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não amarrou."); }
    finally { setOcupado(false); }
  }

  return (
    <Modal aberto={!!id} titulo={s ? `Solicitação #${s.numero}` : "Solicitação"} onFechar={onFechar} largura={680}>
      {!s ? (
        erro ? <Aviso tom="erro">{erro}</Aviso> : <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : (
        <div className="space-y-4">
          {/* De → Para */}
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]" style={{ color: "var(--ink2)" }}>
            <SetorChip s={s.de_setor} /> <span aria-hidden>→</span> <SetorChip s={s.para_setor} />
            <Etiqueta tom={TOM_SOL[s.status]}>{s.status === "aguardando" && s.aguardando_quem ? `Aguardando ${AGUARDANDO[s.aguardando_quem]}` : STATUS_SOL[s.status]}</Etiqueta>
            {s.prioridade !== "normal" && <Etiqueta tom={s.prioridade === "urgente" ? "erro" : "aviso"}>{PRIORIDADE_SOL[s.prioridade]}</Etiqueta>}
            {s.sem_dono_atrasada && <Etiqueta tom="erro">Ninguém pegou há +2h úteis</Etiqueta>}
          </div>

          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{s.tipo_rotulo ?? "Pedido"}</p>
            <h3 className="text-[17px] font-bold leading-snug mt-0.5" style={{ color: "var(--ink)" }}>{s.titulo}</h3>
            {s.descricao && <p className="text-[14px] whitespace-pre-wrap mt-2" style={{ color: "var(--ink2)" }}>{s.descricao}</p>}
          </div>

          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
            <Linha rotulo="Pediu">{s.criado_por_nome ?? "—"} <span style={{ color: "var(--ink3)" }}>· {haQuanto(s.criado_em)}</span></Linha>
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
                {(recebe || pediu) && !amarrando && (
                  <button className="underline" style={{ color: s.cliente_id ? "var(--ink3)" : "var(--rel-ink)", fontWeight: s.cliente_id ? 400 : 600 }}
                    onClick={() => { setAmarrando(true); setEscolha(s.cliente_id ? { clienteId: s.cliente_id, clienteNome: (s.sobre_nome ?? "").split(" · ")[0] || "Cliente", viagemId: s.viagem_id, vendaTexto: null } : null); }}>
                    {s.cliente_id ? "trocar cliente/venda" : "amarrar cliente"}
                  </button>
                )}
              </span>
            </Linha>
          </dl>

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

          {(s.status === "concluida" || s.status === "recusada") && s.resolucao && (
            <Aviso tom={s.status === "concluida" ? "ok" : "erro"}>
              <b>{s.status === "concluida" ? "O que foi feito: " : "Por que não deu: "}</b>{s.resolucao}
              {s.status === "concluida" && s.confirmado_em && <span className="block mt-1 text-[12px]">✔ Quem pediu confirmou {haQuanto(s.confirmado_em)}.</span>}
            </Aviso>
          )}

          {/* ── Botões ── */}
          {!pedindo && pessoas === null && (
            <div className="flex flex-wrap gap-2">
              {recebe && s.aberta && s.responsavel_id !== meuId && <Botao variante="primario" disabled={ocupado} onClick={() => void rodar("aceitar")}>{s.responsavel_id ? "Pegar pra mim" : "Aceitar — é comigo"}</Botao>}
              {recebe && s.aberta && <Botao disabled={ocupado} onClick={() => pessoasDoSetor(s.para_setor).then(setPessoas).catch(() => setPessoas([]))}>Passar pra…</Botao>}
              {recebe && s.aberta && s.responsavel_id && (
                <Botao variante={s.responsavel_id === meuId ? "primario" : "secundario"} disabled={ocupado}
                  onClick={() => pedir({ acao: "concluir", titulo: "O que foi feito?", dica: "Quem pediu recebe isso. Ex.: cotação enviada no e-mail, 3 opções; emitido o localizador ABC123.", obrigatorio: true, botao: "Concluir" })}>Concluir</Botao>
              )}
              {recebe && s.status !== "aguardando" && s.aberta && s.responsavel_id && (
                <select className="rel-input" style={{ width: "auto" }} value="" disabled={ocupado} aria-label="Aguardando quem"
                  onChange={(e) => e.target.value && pedir({ acao: "aguardar", extra: e.target.value, titulo: `Aguardando ${AGUARDANDO[e.target.value as AguardandoQuem]}`, dica: "O que falta (opcional).", obrigatorio: false, botao: "Marcar aguardando" })}>
                  <option value="">Aguardando…</option>
                  {(Object.entries(AGUARDANDO) as [AguardandoQuem, string][]).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                </select>
              )}
              {recebe && s.status === "aguardando" && <Botao disabled={ocupado} onClick={() => void rodar("retomar")}>Voltar pra em andamento</Botao>}
              {recebe && s.aberta && <Botao variante="fantasma" disabled={ocupado} onClick={() => pedir({ acao: "recusar", titulo: "Por que não dá pra fazer?", dica: "Ex.: falta o passaporte; isso é com o Financeiro.", obrigatorio: true, botao: "Recusar", perigo: true })}>Recusar</Botao>}

              {pediu && s.status === "concluida" && !s.confirmado_em && <Botao variante="primario" disabled={ocupado} onClick={() => void rodar("confirmar")}>✔ Resolveu, obrigado</Botao>}
              {pediu && (s.status === "concluida" || s.status === "recusada") && <Botao disabled={ocupado} onClick={() => pedir({ acao: "reabrir", titulo: "O que ainda falta?", dica: "Volta pra fila de quem recebeu.", obrigatorio: true, botao: "Reabrir" })}>↺ Reabrir</Botao>}
              {pediu && s.aberta && s.criado_por === meuId && <Botao variante="fantasma" disabled={ocupado} onClick={() => pedir({ acao: "cancelar", titulo: "Cancelar o pedido?", dica: "Motivo (opcional). Ex.: o cliente desistiu.", obrigatorio: false, botao: "Cancelar pedido", perigo: true })}>Cancelar pedido</Botao>}
            </div>
          )}

          {pessoas !== null && (
            <div className="rel-card p-3 space-y-2">
              <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Passar pra quem de {NOME_SETOR[s.para_setor]}?</p>
              {pessoas.length === 0 && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Ninguém cadastrado nesse setor ainda.</p>}
              <div className="flex flex-wrap gap-1.5">
                {pessoas.map((p) => (
                  <Botao key={p.id} disabled={ocupado || p.id === s.responsavel_id} onClick={() => void rodar("passar", null, p.id)}>{p.name}</Botao>
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
