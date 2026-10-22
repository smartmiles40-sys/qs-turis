// src/bolinha/Telas.tsx
// -----------------------------------------------------------------------------
// As telas do painel da Bolinha do QS (380×560): Avisos, Nova solicitação,
// Buscar, Hoje e Perguntar. Cada uma carrega o que precisa QUANDO abre — nada
// de recontar de tempos em tempos (lição do egress de 19/10). Os avisos já
// chegam ao vivo pelo AvisosProvider (Realtime filtrado pela pessoa).
// -----------------------------------------------------------------------------
import { useEffect, useRef, useState, type ReactNode } from "react";
import { setoresDe } from "@/contexts/QsAuthContext";
import type { SdrUser } from "@/components/sdr/types";
import { useAvisos } from "@/avisos/AvisosProvider";
import { COR_TIPO, haQuanto, ROTULO_TIPO, type Aviso } from "@/avisos/lib";
import NovaSolicitacao from "@/solicitacoes/NovaSolicitacao";
import { ComCoresDaCentral } from "@/solicitacoes/cores";
import {
  acharClientes, agir, carregarSolicitacao, STATUS_CURTO, textoPrazo,
  type ClienteAchado, type EventoSol, type Solicitacao,
} from "@/solicitacoes/lib";
import {
  abrirNoQS, buscarLeads, carregarHoje, horaSP, perguntar, rotas, solicitacaoDoLink,
  type Hoje, type LeadAchado, type MensagemChat,
} from "./lib";

// ── Peças ───────────────────────────────────────────────────────────────────

function Secao({ titulo, children, extra }: { titulo: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="mb-4">
      <div className="flex items-center justify-between mb-1.5 px-1">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{titulo}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Linha({ onClick, children, titulo }: { onClick?: () => void; children: ReactNode; titulo?: string }) {
  const cls = "w-full text-left px-3 py-2.5 rounded-xl border border-slate-200 bg-white mb-1.5 block";
  if (!onClick) return <div className={cls}>{children}</div>;
  return (
    <button type="button" onClick={onClick} title={titulo ?? "Abrir no QS"} className={`${cls} hover:border-[#0147FF] hover:bg-[#F4F7FF] transition-colors`}>
      {children}
    </button>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-slate-500 px-1 py-2">{children}</p>;
}

function Erro({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 my-2">{children}</p>;
}

const msgErro = (e: unknown) => (e instanceof Error ? e.message : "Não deu certo. Tente de novo.");

// ── Avisos ──────────────────────────────────────────────────────────────────

/** O aviso é de uma solicitação? Devolve o id dela (o de evento traz o id do EVENTO; o da solicitação vem no link). */
function solDoAviso(a: Aviso): string | null {
  if (a.origem === "qs_solicitacoes" && a.origem_id) return a.origem_id;
  if (a.origem === "qs_solicitacao_eventos") return solicitacaoDoLink(a.link);
  return null;
}

export function TelaAvisos() {
  const ctx = useAvisos();
  const [aberto, setAberto] = useState<number | null>(null);
  if (!ctx) return null;
  return (
    <div>
      {ctx.avisos.length > 0 && (
        <div className="flex justify-end mb-2">
          <button type="button" onClick={ctx.marcarTodos} className="text-[12px] font-semibold text-slate-500 hover:text-slate-800">
            Marcar todos como lidos
          </button>
        </div>
      )}
      {ctx.avisos.length === 0 ? (
        <Vazio>Nenhum aviso novo. Quando chegar solicitação, prazo ou reunião, a bolinha fica azul e toca um bip.</Vazio>
      ) : (
        ctx.avisos.map((a) => (
          <ItemAviso key={a.id} a={a} expandido={aberto === a.id} onExpandir={() => setAberto((v) => (v === a.id ? null : a.id))} />
        ))
      )}
      {ctx.maisQueLimite && <Vazio>Tem mais avisos — abra o QS pra ver todos.</Vazio>}
    </div>
  );
}

function ItemAviso({ a, expandido, onExpandir }: { a: Aviso; expandido: boolean; onExpandir: () => void }) {
  const ctx = useAvisos();
  const cor = COR_TIPO[a.tipo] ?? "#0147FF";
  const solId = solDoAviso(a);
  if (!ctx) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white mb-2 overflow-hidden">
      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-start gap-2">
          <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" style={{ background: cor }} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-snug text-slate-900">{a.titulo}</p>
            {a.texto && <p className="text-[12px] leading-snug mt-0.5 text-slate-600 line-clamp-3">{a.texto}</p>}
            <p className="text-[11px] mt-0.5 text-slate-400">
              <span style={{ color: cor, fontWeight: 700 }}>{ROTULO_TIPO[a.tipo] ?? "Aviso"}</span> · {haQuanto(a.criado_em)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2 pl-4">
          {a.link && (
            <button type="button" onClick={() => ctx.abrir(a)} className="px-2.5 py-1 rounded-lg text-[12px] font-semibold bg-[#0147FF] text-white hover:opacity-90">
              Abrir no QS
            </button>
          )}
          {solId && (
            <button type="button" onClick={onExpandir} aria-expanded={expandido}
              className="px-2.5 py-1 rounded-lg text-[12px] font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50">
              {expandido ? "Fechar" : "Responder aqui"}
            </button>
          )}
          <button type="button" onClick={() => ctx.marcar([a.id])} className="px-2.5 py-1 rounded-lg text-[12px] font-semibold text-slate-500 hover:text-slate-800">
            Já vi
          </button>
        </div>
      </div>
      {expandido && solId && <SolRapida id={solId} />}
    </div>
  );
}

const VERBO_EVENTO: Record<string, string> = {
  criada: "abriu o pedido", aceita: "assumiu", passada: "passou adiante", status: "mudou o andamento",
  comentario: "comentou", prazo: "mudou o prazo", concluida: "concluiu", confirmada: "confirmou",
  reaberta: "reabriu", recusada: "recusou", cancelada: "cancelou", vinculada: "ligou ao cliente",
  ajuste: "pediu ajuste", ajustada: "ajustou o pedido", desfecho: "deu o desfecho",
};

/** Responder / assumir uma solicitação sem abrir o QS. */
// (não marca o aviso como lido sozinho: ele sumiria da lista antes de a pessoa
// ver o "Resposta enviada" — o "Já vi" fica com ela)
function SolRapida({ id }: { id: string }) {
  const [s, setS] = useState<Solicitacao | null>(null);
  const [eventos, setEventos] = useState<EventoSol[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function recarregar() {
    return carregarSolicitacao(id)
      .then((r) => { setS(r.s); setEventos(r.eventos); })
      .catch((e) => setErro(msgErro(e)))
      .finally(() => setCarregando(false));
  }
  useEffect(() => { void recarregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function fazer(acao: "aceitar" | "comentar") {
    if (acao === "comentar" && !texto.trim()) { setErro("Escreva a resposta."); return; }
    setEnviando(true); setErro(null); setOk(null);
    try {
      await agir(id, acao, acao === "comentar" ? texto.trim() : null);
      setOk(acao === "aceitar" ? "Pronto: agora é com você." : "Resposta enviada.");
      if (acao === "comentar") setTexto("");
      await recarregar();
    } catch (e) { setErro(msgErro(e)); }
    finally { setEnviando(false); }
  }

  if (carregando) return <p className="px-3 pb-3 text-[12px] text-slate-500">Carregando o pedido…</p>;
  if (!s) return <p className="px-3 pb-3 text-[12px] text-slate-500">{erro ?? "Não achei esse pedido (pode ter sido apagado ou não ser do seu setor)."}</p>;
  const prazo = textoPrazo(s);
  const ultimos = eventos.slice(-2).reverse();
  const podeAssumir = s.status === "nova" && !s.responsavel_id;

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-3 py-2.5">
      <p className="text-[12px] text-slate-700">
        <b>#{s.numero}</b> · {STATUS_CURTO[s.status]} · <span className={prazo.tom === "erro" ? "text-red-600 font-semibold" : ""}>{prazo.texto}</span>
        {s.responsavel_nome ? <> · com {s.responsavel_nome.split(" ")[0]}</> : null}
      </p>
      <p className="text-[12.5px] font-semibold text-slate-900 mt-0.5">{s.titulo}</p>
      {ultimos.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {ultimos.map((e) => (
            <li key={e.id} className="text-[12px] leading-snug text-slate-600">
              <b className="text-slate-800">{(e.autor_nome ?? "Alguém").split(" ")[0]}</b> {VERBO_EVENTO[e.tipo] ?? e.tipo}
              {e.texto ? <>: “{e.texto.length > 160 ? `${e.texto.slice(0, 160)}…` : e.texto}”</> : null}
              <span className="text-slate-400"> · {haQuanto(e.criado_em)}</span>
            </li>
          ))}
        </ul>
      )}
      {s.aberta && (
        <div className="mt-2">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={2000}
            placeholder="Escreva a resposta…" aria-label="Resposta"
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 focus:outline-none focus:border-[#0147FF]" />
          <div className="flex gap-1.5 mt-1.5">
            <button type="button" disabled={enviando} onClick={() => void fazer("comentar")}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#0147FF] text-white disabled:opacity-50">
              {enviando ? "Enviando…" : "Responder"}
            </button>
            {podeAssumir && (
              <button type="button" disabled={enviando} onClick={() => void fazer("aceitar")}
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-[#0147FF] text-[#0147FF] bg-white disabled:opacity-50">
                Assumir
              </button>
            )}
          </div>
        </div>
      )}
      {ok && <p className="text-[12px] text-emerald-700 mt-1.5">{ok}</p>}
      {erro && <Erro>{erro}</Erro>}
    </div>
  );
}

// ── Nova solicitação ───────────────────────────────────────────────────────

export function TelaNova({ user, onFechar }: { user: SdrUser; onFechar: () => void }) {
  const deSetor = setoresDe(user)[0] ?? "comercial";
  const [criada, setCriada] = useState<string | null>(null);
  if (criada) {
    const hash = rotas.solicitacao({ id: criada, de_setor: deSetor, para_setor: deSetor, criado_por: user.id }, user);
    return (
      <div className="text-center py-8 px-2">
        <p className="text-[15px] font-bold text-slate-900">Pedido enviado ✓</p>
        <p className="text-[13px] text-slate-600 mt-1">Ele entrou na fila do outro setor. Você recebe um aviso aqui quando responderem.</p>
        <div className="flex justify-center gap-2 mt-4">
          <button type="button" onClick={() => abrirNoQS(hash)} className="px-3 py-2 rounded-lg text-[13px] font-semibold bg-[#0147FF] text-white">Ver no QS</button>
          <button type="button" onClick={() => setCriada(null)} className="px-3 py-2 rounded-lg text-[13px] font-semibold border border-slate-300 text-slate-700">Fazer outro</button>
        </div>
      </div>
    );
  }
  return (
    <>
      <p className="text-[13px] text-slate-500 px-1">Preenchendo o pedido…</p>
      <ComCoresDaCentral>
        <NovaSolicitacao aberto deSetor={deSetor} onFechar={onFechar} onCriada={(id) => setCriada(id)} />
      </ComCoresDaCentral>
    </>
  );
}

// ── Buscar ──────────────────────────────────────────────────────────────────

export function TelaBuscar({ user }: { user: SdrUser }) {
  const setores = setoresDe(user);
  const veFicha = setores.includes("relacionamento");
  const veLeads = setores.includes("comercial");
  const [termo, setTermo] = useState("");
  const [clientes, setClientes] = useState<ClienteAchado[] | null>(null);
  const [leads, setLeads] = useState<LeadAchado[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const vez = useRef(0);

  useEffect(() => {
    const t = termo.trim();
    if (t.length < 2) { setClientes(null); setLeads(null); setErro(null); return; }
    const minha = ++vez.current;
    const timer = setTimeout(() => {
      setBuscando(true); setErro(null);
      Promise.all([
        acharClientes(t).then((l) => l.slice(0, 8)).catch((e) => { setErro(msgErro(e)); return [] as ClienteAchado[]; }),
        veLeads ? buscarLeads(t, 8).catch((e) => { setErro(msgErro(e)); return [] as LeadAchado[]; }) : Promise.resolve([] as LeadAchado[]),
      ]).then(([c, l]) => {
        if (minha !== vez.current) return; // chegou resposta de uma busca velha
        setClientes(c); setLeads(l);
      }).finally(() => { if (minha === vez.current) setBuscando(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [termo, veLeads]);

  return (
    <div>
      <input autoFocus value={termo} onChange={(e) => setTermo(e.target.value)} type="search"
        placeholder="Nome, telefone ou CPF…" aria-label="Buscar cliente ou lead"
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[14px] text-slate-800 focus:outline-none focus:border-[#0147FF] mb-3" />
      {buscando && <Vazio>Buscando…</Vazio>}
      {erro && <Erro>{erro}</Erro>}
      {termo.trim().length < 2 && <Vazio>Digite pelo menos 2 letras (ou os números do telefone/CPF).</Vazio>}
      {clientes && (
        <Secao titulo="Clientes">
          {clientes.length === 0 ? <Vazio>Nenhum cliente com isso.</Vazio> : clientes.map((c) => (
            <Linha key={c.id} onClick={veFicha ? () => abrirNoQS(rotas.cliente(c.id)) : undefined}>
              <span className="block text-[13px] font-semibold text-slate-900">{c.nome}</span>
              <span className="block text-[11.5px] text-slate-500">
                {[c.telefone_fim ? `tel. final ${c.telefone_fim}` : null, c.email_mascarado, c.vendas ? `${c.vendas} venda${c.vendas > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ") || "sem contato"}
                {!veFicha && " · a ficha fica no Relacionamento"}
              </span>
            </Linha>
          ))}
        </Secao>
      )}
      {veLeads && leads && (
        <Secao titulo="Leads">
          {leads.length === 0 ? <Vazio>Nenhum lead seu com isso.</Vazio> : leads.map((l) => (
            <Linha key={l.id} onClick={() => abrirNoQS(rotas.lead(l.id, user))}>
              <span className="block text-[13px] font-semibold text-slate-900">{l.nome}</span>
              <span className="block text-[11.5px] text-slate-500">
                {[l.telefone_fim ? `tel. final ${l.telefone_fim}` : null, l.status].filter(Boolean).join(" · ")}
              </span>
            </Linha>
          ))}
        </Secao>
      )}
    </div>
  );
}

// ── Hoje ────────────────────────────────────────────────────────────────────

export function TelaHoje({ user }: { user: SdrUser }) {
  const [h, setH] = useState<Hoje | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  function carregar() {
    setCarregando(true); setErro(null);
    carregarHoje(user).then(setH).catch((e) => setErro(msgErro(e))).finally(() => setCarregando(false));
  }
  useEffect(carregar, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const atualizar = (
    <button type="button" onClick={carregar} disabled={carregando} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50">
      {carregando ? "Carregando…" : "Atualizar"}
    </button>
  );
  if (!h) return <>{erro ? <Erro>{erro}</Erro> : <Vazio>Carregando o seu dia…</Vazio>}</>;

  return (
    <div>
      {erro && <Erro>{erro}</Erro>}
      {h.tarefas && (
        <Secao titulo="Atividades" extra={atualizar}>
          <Linha onClick={() => abrirNoQS(rotas.painel(user))}>
            <span className="block text-[13px] text-slate-800">
              <b>{h.tarefas.hoje}</b> pra hoje · <b className={h.tarefas.atrasadas ? "text-red-600" : ""}>{h.tarefas.atrasadas}</b> atrasada{h.tarefas.atrasadas === 1 ? "" : "s"}
            </span>
            <span className="block text-[11.5px] text-slate-500">Abrir o Painel</span>
          </Linha>
        </Secao>
      )}
      {h.tarefas !== null && (
        <Secao titulo="Reuniões de hoje" extra={h.tarefas ? undefined : atualizar}>
          {h.reunioes.length === 0 ? <Vazio>Nenhuma reunião hoje.</Vazio> : h.reunioes.map((m) => (
            <Linha key={m.id} onClick={() => abrirNoQS(m.lead_id && user.role !== "closer" ? rotas.lead(m.lead_id, user) : rotas.agenda(user))}>
              <span className="block text-[13px] text-slate-900"><b>{horaSP(m.scheduled_at)}</b> · {m.nome}</span>
              <span className="block text-[11.5px] text-slate-500">{m.status === "realizada" ? "Já aconteceu" : m.status === "confirmada" ? "Confirmada" : "Agendada"}</span>
            </Linha>
          ))}
        </Secao>
      )}
      <Secao titulo="Solicitações comigo" extra={h.tarefas === null ? atualizar : undefined}>
        {h.solicitacoes.length === 0 ? <Vazio>Nenhuma solicitação aberta com você.</Vazio> : h.solicitacoes.map((s) => {
          const p = textoPrazo({ prazo: s.prazo, aberta: true });
          return (
            <Linha key={s.id} onClick={() => abrirNoQS(rotas.solicitacao(s, user))}>
              <span className="block text-[13px] text-slate-900"><b>#{s.numero}</b> · {s.titulo}</span>
              <span className={`block text-[11.5px] ${p.tom === "erro" ? "text-red-600 font-semibold" : "text-slate-500"}`}>
                {[s.sobre_nome, p.texto].filter(Boolean).join(" · ")}
              </span>
            </Linha>
          );
        })}
      </Secao>
      {h.esteira && (
        <Secao titulo="Esteira (minhas viagens)">
          {h.esteira.length === 0 ? <Vazio>Nenhuma etapa vence hoje. 👏</Vazio> : <>
            {h.esteira.slice(0, 8).map((e) => (
              <Linha key={e.viagem_id} onClick={() => abrirNoQS(rotas.viagem(e.viagem_id))}>
                <span className="block text-[13px] text-slate-900">{e.titulo}</span>
                <span className={`block text-[11.5px] ${e.atrasada ? "text-red-600 font-semibold" : "text-slate-500"}`}>
                  {e.etapa} · {e.atrasada ? "atrasada" : "vence hoje"}
                </span>
              </Linha>
            ))}
            {h.esteira.length > 8 && (
              <Linha onClick={() => abrirNoQS(rotas.esteira())}>
                <span className="text-[12.5px] font-semibold text-[#0147FF]">Ver as {h.esteira.length} na Esteira</span>
              </Linha>
            )}
          </>}
        </Secao>
      )}
    </div>
  );
}

// ── Perguntar ──────────────────────────────────────────────────────────────

const SUGESTOES = ["O que eu tenho pra hoje?", "Quais solicitações estão comigo?", "Quando a Maria embarca?"];

export function TelaPerguntar({ conversa, setConversa }: { conversa: MensagemChat[]; setConversa: (f: (c: MensagemChat[]) => MensagemChat[]) => void }) {
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [conversa, pensando]);

  async function enviar(p: string) {
    const pergunta = p.trim();
    if (!pergunta || pensando) return;
    const antes = conversa;
    setConversa((c) => [...c, { de: "eu", texto: pergunta }]);
    setTexto("");
    setPensando(true);
    try {
      const r = await perguntar(pergunta, antes);
      setConversa((c) => [...c, { de: "qs", texto: r.resposta, links: r.links }]);
    } catch (e) {
      setConversa((c) => [...c, { de: "qs", texto: msgErro(e) }]);
    } finally { setPensando(false); }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto pr-0.5">
        {conversa.length === 0 && (
          <div className="px-1">
            <p className="text-[13px] text-slate-600 mb-2">Pergunte sobre seus clientes, leads, viagens, agenda ou solicitações. Eu só olho o que você já pode ver no QS.</p>
            <div className="flex flex-col gap-1.5">
              {SUGESTOES.map((s) => (
                <button key={s} type="button" onClick={() => void enviar(s)}
                  className="text-left px-3 py-2 rounded-xl border border-slate-200 bg-white text-[13px] text-slate-700 hover:border-[#0147FF]">{s}</button>
              ))}
            </div>
          </div>
        )}
        {conversa.map((m, i) => (
          <div key={i} className={`flex mb-2 ${m.de === "eu" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap ${m.de === "eu" ? "bg-[#0147FF] text-white rounded-br-md" : "bg-white border border-slate-200 text-slate-800 rounded-bl-md"}`}>
              {m.texto}
              {m.links && m.links.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {m.links.map((l, j) => (
                    <button key={j} type="button" onClick={() => abrirNoQS(l.hash)}
                      className="px-2 py-0.5 rounded-full text-[11.5px] font-semibold bg-[#EEF4FF] text-[#0147FF] hover:bg-[#dfe9ff]">
                      {l.rotulo} ↗
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {pensando && <p className="text-[12px] text-slate-500 px-1 mb-2">Procurando no QS…</p>}
        <div ref={fim} />
      </div>
      <form className="flex gap-1.5 pt-2" onSubmit={(e) => { e.preventDefault(); void enviar(texto); }}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={500} autoFocus
          placeholder="Escreva sua pergunta…" aria-label="Pergunta"
          className="flex-1 min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13.5px] text-slate-800 focus:outline-none focus:border-[#0147FF]" />
        <button type="submit" disabled={pensando || !texto.trim()} className="px-3 rounded-xl text-[13px] font-semibold bg-[#0147FF] text-white disabled:opacity-50">
          Enviar
        </button>
      </form>
    </div>
  );
}
