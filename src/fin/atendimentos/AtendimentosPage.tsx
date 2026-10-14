// src/fin/atendimentos/AtendimentosPage.tsx
// -----------------------------------------------------------------------------
// A FILA DO FINANCEIRO (0127, 14/10/2026).
//
// Cada cliente que o Comercial, o Relacionamento ou Operações mandou vira um
// cartão. Colunas por status (novo → em atendimento → aguardando cliente →
// resolvido), o mais antigo em cima — quem espera há mais tempo é atendido
// primeiro. Clicar abre o detalhe: quem é o cliente, as viagens e valores dele,
// o histórico, e os botões pra assumir, conversar no WhatsApp e mudar o status.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { supabase } from "@/lib/supabase";
import { Aviso, Botao, Entrada, Etiqueta, Modal } from "../../rel/ui";
import ModeloModal from "../../rel/atendimento/ModeloModal";
import NovoAtendimento from "./NovoAtendimento";
import { carregarCliente, formatarCpf, formatarTelefone, moeda, type Cliente } from "../../rel/lib/clientes";
import { periodo, viagensDoCliente, type Viagem } from "../../rel/lib/viagens";
import {
  ABERTOS, atendimentosDe, MOTIVO_FIN, ORIGEM_FIN, PRIORIDADE_FIN, STATUS_FIN, TOM_STATUS, carregarAtendimento, haQuanto, ligarConversa,
  listarAtendimentos, mudarAtendimento, type AtendimentoFin, type EventoFin, type StatusFin,
} from "../lib/atendimentos";

const COLUNAS: StatusFin[] = ["novo", "em_atendimento", "aguardando_cliente", "resolvido"];
const COR_PRIORIDADE: Record<string, string> = { urgente: "var(--err-ink)", alta: "var(--warn-ink)" };

function useRepetir(fn: () => void, ms: number) {
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) fn(); }, ms);
    return () => clearInterval(t);
  }, [fn, ms]);
}

// ── Cartão ──────────────────────────────────────────────────────────────────

function Cartao({ a, meuId, onAbrir }: { a: AtendimentoFin; meuId: string; onAbrir: () => void }) {
  return (
    <button onClick={onAbrir} className="rel-card rel-linha w-full text-left p-3 space-y-1.5"
      style={a.prioridade === "urgente" ? { borderColor: "var(--err-line)" } : undefined}>
      <span className="flex items-center gap-2 text-[12px]" style={{ color: "var(--ink3)" }}>
        <b>#{a.numero}</b>
        <span>{ORIGEM_FIN[a.origem]}</span>
        <span className="ml-auto">{haQuanto(a.criado_em)}</span>
      </span>
      <span className="block text-[14px] font-semibold truncate" style={{ color: "var(--ink)" }}>{a.nome || formatarTelefone(a.telefone) || "Sem nome"}</span>
      <span className="block text-[12.5px]" style={{ color: "var(--ink2)" }}>{MOTIVO_FIN[a.motivo]}</span>
      {a.descricao && <span className="block text-[12.5px] line-clamp-2" style={{ color: "var(--ink3)" }}>{a.descricao}</span>}
      <span className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        {a.prioridade !== "normal" && <span className="font-bold" style={{ color: COR_PRIORIDADE[a.prioridade] ?? "var(--ink3)" }}>{PRIORIDADE_FIN[a.prioridade]}</span>}
        {a.conversa_id && <span title="Tem conversa no WhatsApp">💬</span>}
        <span style={{ color: "var(--ink3)" }}>
          {a.responsavel_id ? (a.responsavel_id === meuId ? "com você" : `com ${a.responsavel_nome?.split(" ")[0] ?? "alguém"}`) : "ninguém assumiu"}
        </span>
      </span>
    </button>
  );
}

// ── Detalhe ─────────────────────────────────────────────────────────────────

const ROTULO_EVENTO: Record<EventoFin["tipo"], string> = {
  criado: "Enviado ao Financeiro", status: "Status", responsavel: "Assumiu", nota: "Nota", conversa: "WhatsApp", devolvido: "Conversa devolvida",
};

export function AtendimentoDetalhe({ id, onFechar, onMudou, onAbrirConversa, chamarAoAbrir = false }: {
  id: string | null; onFechar: () => void; onMudou: () => void; onAbrirConversa: (id: string) => void;
  /** Veio do "+ Novo atendimento": já abre a escolha do modelo. */
  chamarAoAbrir?: boolean;
}) {
  const { currentUser } = useQsAuth();
  const meuId = currentUser?.id ?? "";
  const [at, setAt] = useState<AtendimentoFin | null>(null);
  const [eventos, setEventos] = useState<EventoFin[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [viagens, setViagens] = useState<Viagem[]>([]);
  const [nota, setNota] = useState("");
  const [resolvendo, setResolvendo] = useState(false);
  const [resolucao, setResolucao] = useState("");
  const [modelo, setModelo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // A conversa ligada ainda está com o Financeiro? (Se voltou pro Rel, a RLS esconde.)
  const [convComFin, setConvComFin] = useState(false);

  const carregar = useCallback(async () => {
    if (!id) return;
    try {
      const r = await carregarAtendimento(id);
      setAt(r.at); setEventos(r.eventos);
      if (r.at?.conversa_id) {
        const { data } = await supabase.from("rel_wa_fila").select("id").eq("id", r.at.conversa_id).eq("setor", "financeiro").maybeSingle();
        setConvComFin(!!data);
      } else setConvComFin(false);
      if (r.at?.cliente_id) {
        carregarCliente(r.at.cliente_id).then(setCliente).catch(() => setCliente(null));
        viagensDoCliente(r.at.cliente_id).then(setViagens).catch(() => setViagens([]));
      } else { setCliente(null); setViagens([]); }
    } catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); }
  }, [id]);
  useEffect(() => { setAt(null); setEventos([]); setNota(""); setErro(null); setResolvendo(false); void carregar(); }, [carregar]);
  // "+ Novo atendimento" → cai direto no modelo (1x por atendimento).
  const [jaChamou, setJaChamou] = useState<string | null>(null);
  useEffect(() => {
    if (chamarAoAbrir && at && at.id === id && jaChamou !== at.id && !at.conversa_id && at.telefone) { setJaChamou(at.id); setModelo(true); }
  }, [chamarAoAbrir, at, id, jaChamou]);

  async function rodar(fn: () => Promise<unknown>) {
    setOcupado(true); setErro(null);
    try { await fn(); await carregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
    finally { setOcupado(false); }
  }

  if (!id) return null;
  const aberto = at ? ABERTOS.includes(at.status) : false;
  const meu = at?.responsavel_id === meuId;

  return (
    <Modal aberto={!!id} titulo={at ? `Atendimento #${at.numero} · ${at.nome || formatarTelefone(at.telefone)}` : "Atendimento"} onFechar={onFechar} largura={720}>
      {!at ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>{erro ?? "Carregando…"}</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Etiqueta tom={TOM_STATUS[at.status]}>{STATUS_FIN[at.status]}</Etiqueta>
            <span className="text-[13px]" style={{ color: "var(--ink2)" }}>{MOTIVO_FIN[at.motivo]}</span>
            {at.prioridade !== "normal" && <span className="text-[12px] font-bold" style={{ color: COR_PRIORIDADE[at.prioridade] ?? "var(--ink3)" }}>{PRIORIDADE_FIN[at.prioridade]}</span>}
            <span className="text-[12.5px] ml-auto" style={{ color: "var(--ink3)" }}>
              Enviado por {at.enviado_por_nome?.split(" ")[0] ?? "?"} ({ORIGEM_FIN[at.origem]}) · {haQuanto(at.criado_em)}
            </span>
          </div>
          {at.descricao && <div className="rel-card p-3 text-[14px] whitespace-pre-wrap" style={{ color: "var(--ink)" }}>{at.descricao}</div>}

          {/* Ações */}
          <div className="flex flex-wrap gap-2">
            {!meu && aberto && <Botao variante="primario" disabled={ocupado} onClick={() => void rodar(() => mudarAtendimento(at.id, { assumir: true }))}>Assumir</Botao>}
            {at.conversa_id && convComFin && <Botao variante={meu ? "primario" : "secundario"} onClick={() => onAbrirConversa(at.conversa_id!)}>💬 Abrir conversa</Botao>}
            {at.conversa_id && !convComFin && <span className="text-[12.5px] self-center" style={{ color: "var(--ink3)" }}>A conversa está com o Relacionamento — peça pra eles enviarem de novo (💰 na conversa).</span>}
            {!at.conversa_id && at.telefone && aberto && <Botao variante={meu ? "primario" : "secundario"} onClick={() => setModelo(true)}>💬 Chamar no WhatsApp</Botao>}
            {aberto && at.status !== "aguardando_cliente" && <Botao disabled={ocupado} onClick={() => void rodar(() => mudarAtendimento(at.id, { status: "aguardando_cliente" }))}>Aguardando cliente</Botao>}
            {aberto && at.status === "aguardando_cliente" && <Botao disabled={ocupado} onClick={() => void rodar(() => mudarAtendimento(at.id, { status: "em_atendimento" }))}>Voltar pra em atendimento</Botao>}
            {aberto && <Botao disabled={ocupado} onClick={() => { setResolvendo(true); setResolucao(""); }}>✓ Resolver</Botao>}
            {!aberto && <Botao disabled={ocupado} onClick={() => void rodar(() => mudarAtendimento(at.id, { status: "em_atendimento" }))}>Reabrir</Botao>}
            {aberto && <Botao variante="fantasma" disabled={ocupado} onClick={() => void rodar(() => mudarAtendimento(at.id, { status: "cancelado", resolucao: "Cancelado pelo Financeiro" }))}>Cancelar</Botao>}
          </div>
          {resolvendo && (
            <div className="rel-card p-3 space-y-2">
              <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Como foi resolvido? (quem mandou vai ler)</p>
              <Entrada value={resolucao} onChange={(e) => setResolucao(e.target.value)} placeholder="Ex.: 2ª via enviada; Pix baixado em 14/10" autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && resolucao.trim()) { setResolvendo(false); void rodar(() => mudarAtendimento(at.id, { status: "resolvido", resolucao })); } }} />
              <div className="flex gap-2 justify-end">
                <Botao variante="fantasma" onClick={() => setResolvendo(false)}>Voltar</Botao>
                <Botao variante="primario" disabled={!resolucao.trim() || ocupado} onClick={() => { setResolvendo(false); void rodar(() => mudarAtendimento(at.id, { status: "resolvido", resolucao })); }}>Marcar como resolvido</Botao>
              </div>
            </div>
          )}
          {at.resolucao && !aberto && <Aviso>Solução: {at.resolucao}</Aviso>}
          {erro && <Aviso tom="erro">{erro}</Aviso>}

          <div className="grid md:grid-cols-2 gap-4">
            {/* Cliente e viagens */}
            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Cliente</p>
              <div className="rel-card p-3 text-[13px] space-y-1" style={{ color: "var(--ink2)" }}>
                <p className="font-semibold text-[14px]" style={{ color: "var(--ink)" }}>{cliente?.nome || at.nome || "—"}</p>
                <p>📞 {formatarTelefone(cliente?.telefone || at.telefone) || "—"}</p>
                {cliente?.email && <p>✉️ {cliente.email}</p>}
                {cliente?.cpf && <p>CPF {formatarCpf(cliente.cpf)}</p>}
                {!at.cliente_id && <p style={{ color: "var(--ink3)" }}>{at.lead_id ? "Lead do Comercial — ainda sem ficha de cliente." : "Sem ficha ligada."}</p>}
              </div>
              {viagens.length > 0 && (
                <div className="rel-card overflow-hidden">
                  {viagens.slice(0, 8).map((v) => (
                    <div key={v.id} className="px-3 py-2 text-[12.5px] flex gap-2" style={{ borderBottom: "1px solid var(--line2)", color: "var(--ink2)" }}>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate font-semibold" style={{ color: v.status === "cancelada" ? "var(--ink3)" : "var(--ink)", textDecoration: v.status === "cancelada" ? "line-through" : undefined }}>{v.titulo}</span>
                        <span className="block" style={{ color: "var(--ink3)" }}>{periodo(v)}</span>
                      </span>
                      <span className="font-semibold flex-shrink-0">{v.valor ? moeda(v.valor) : "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Histórico */}
            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Histórico</p>
              <ol className="space-y-2 max-h-72 overflow-y-auto">
                {eventos.map((e) => (
                  <li key={e.id} className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
                    <span className="font-semibold" style={{ color: "var(--ink)" }}>{ROTULO_EVENTO[e.tipo]}</span>
                    {e.tipo === "status" && e.para && <> → {STATUS_FIN[e.para as StatusFin] ?? e.para}</>}
                    <span style={{ color: "var(--ink3)" }}> · {e.autor_nome?.split(" ")[0]} · {new Date(e.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</span>
                    {e.texto && <span className="block whitespace-pre-wrap">{e.texto}</span>}
                  </li>
                ))}
              </ol>
              <div className="flex gap-2">
                <Entrada value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Anotar (só a equipe vê)"
                  onKeyDown={(e) => { if (e.key === "Enter" && nota.trim()) { const t = nota; setNota(""); void rodar(() => mudarAtendimento(at.id, { nota: t })); } }} />
                <Botao disabled={!nota.trim() || ocupado} onClick={() => { const t = nota; setNota(""); void rodar(() => mudarAtendimento(at.id, { nota: t })); }}>Anotar</Botao>
              </div>
            </div>
          </div>
        </div>
      )}
      {at && (
        <ModeloModal aberto={modelo} alvo={{ telefone: at.telefone ?? undefined }} nomeCliente={at.nome}
          onFechar={() => setModelo(false)}
          onEnviado={(conversaId) => {
            setModelo(false);
            if (conversaId) void rodar(async () => { await ligarConversa(at.id, conversaId); if (!meu) await mudarAtendimento(at.id, { assumir: true }); });
          }} />
      )}
    </Modal>
  );
}

// ── Faixa na conversa (o status sem sair do WhatsApp) ───────────────────────

export function FaixaDoAtendimento({ conversaId, onAbrir, onMudou }: { conversaId: string; onAbrir: (id: string) => void; onMudou: () => void }) {
  const { currentUser } = useQsAuth();
  const [lista, setLista] = useState<AtendimentoFin[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => {
    atendimentosDe({ conversaId }).then((l) => setLista(l.filter((a) => ABERTOS.includes(a.status)))).catch(() => setLista([]));
  }, [conversaId]);
  useEffect(() => { carregar(); }, [carregar]);
  const a = lista[0];
  if (!a) return <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Nenhum atendimento aberto ligado a esta conversa.</span>;
  async function mudar(m: Parameters<typeof mudarAtendimento>[1]) {
    setErro(null);
    try { await mudarAtendimento(a.id, m); carregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-[12.5px]" style={{ color: "var(--ink2)" }}>
      <span aria-hidden>💰</span>
      <button className="font-bold underline" style={{ color: "var(--ink)" }} onClick={() => onAbrir(a.id)}>#{a.numero}</button>
      <span>{MOTIVO_FIN[a.motivo]}</span>
      <select value={a.status} onChange={(e) => void mudar(e.target.value === "resolvido" ? { status: "resolvido", resolucao: "Resolvido pela conversa" } : { status: e.target.value as StatusFin })}
        aria-label="Status do atendimento" className="h-7 rounded-md px-1.5 text-[12.5px] border" style={{ borderColor: "var(--line)", background: "var(--card)", color: "var(--ink)" }}>
        {(["novo", "em_atendimento", "aguardando_cliente", "resolvido"] as StatusFin[]).map((s) => <option key={s} value={s}>{STATUS_FIN[s]}</option>)}
      </select>
      {a.responsavel_id !== currentUser?.id && <button className="underline font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => void mudar({ assumir: true })}>Assumir</button>}
      {a.descricao && <span className="truncate max-w-[360px]" style={{ color: "var(--ink3)" }} title={a.descricao}>— {a.descricao}</span>}
      {erro && <span style={{ color: "var(--err-ink)" }}>{erro}</span>}
    </span>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function AtendimentosPage({ onAbrirConversa, abrirId, onAbrirId }: {
  onAbrirConversa: (id: string) => void;
  /** Atendimento aberto (controlado pelo FinApp, pra dar link). */
  abrirId?: string | null;
  onAbrirId?: (id: string | null) => void;
}) {
  const { currentUser } = useQsAuth();
  const meuId = currentUser?.id ?? "";
  const [lista, setLista] = useState<AtendimentoFin[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [so, setSo] = useState<"todos" | "meus" | "sem_dono">("todos");
  const [aberto, setAbertoLocal] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [chamar, setChamar] = useState<string | null>(null);
  const atual = abrirId !== undefined ? abrirId : aberto;
  const abrir = (id: string | null) => { if (onAbrirId) onAbrirId(id); else setAbertoLocal(id); };

  const carregar = useCallback(async () => {
    try { setLista(await listarAtendimentos({ busca })); }
    catch { /* tenta de novo no próximo ciclo */ }
    finally { setCarregando(false); }
  }, [busca]);
  useEffect(() => { const t = setTimeout(() => { void carregar(); }, busca ? 300 : 0); return () => clearTimeout(t); }, [carregar, busca]);
  useRepetir(carregar, 15_000);

  const filtrada = useMemo(() => lista.filter((a) => so === "todos" || (so === "meus" ? a.responsavel_id === meuId : !a.responsavel_id)), [lista, so, meuId]);
  const porStatus = (s: StatusFin) => filtrada
    .filter((a) => a.status === s)
    .sort((x, y) => (s === "resolvido" ? (y.resolvido_em || "").localeCompare(x.resolvido_em || "") : x.criado_em.localeCompare(y.criado_em)));
  const novos = lista.filter((a) => a.status === "novo").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Atendimentos</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            Clientes que o Comercial, o Relacionamento e Operações mandaram pro Financeiro.
            {novos > 0 && <b style={{ color: "var(--warn-ink)" }}> {novos} esperando alguém assumir.</b>}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--line)" }} role="radiogroup" aria-label="Mostrar">
            {([["todos", "Todos"], ["meus", "Meus"], ["sem_dono", "Sem dono"]] as const).map(([k, r]) => (
              <button key={k} role="radio" aria-checked={so === k} onClick={() => setSo(k)} className="px-3 h-9 text-[13px] font-semibold"
                style={so === k ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>{r}</button>
            ))}
          </div>
          <div className="w-64"><Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, telefone ou #número" /></div>
          <Botao variante="primario" onClick={() => setNovo(true)}>+ Novo atendimento</Botao>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 items-start">
        {COLUNAS.map((s) => {
          const itens = porStatus(s);
          return (
            <section key={s} className="rounded-xl p-2 space-y-2 min-h-[120px]" style={{ background: "var(--card2)" }} aria-label={STATUS_FIN[s]}>
              <h2 className="flex items-center gap-2 px-1 pt-1 text-[13px] font-bold" style={{ color: "var(--ink2)" }}>
                {STATUS_FIN[s]} <span className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>{itens.length}</span>
                {s === "resolvido" && <span className="text-[11px] font-normal ml-auto" style={{ color: "var(--ink3)" }}>mais recentes</span>}
              </h2>
              {carregando && !lista.length && [0, 1].map((i) => <div key={i} className="rel-card h-24 animate-pulse" aria-hidden />)}
              {!carregando && itens.length === 0 && <p className="px-1 pb-2 text-[12.5px]" style={{ color: "var(--ink3)" }}>{s === "novo" ? "Nada novo. 🎉" : "—"}</p>}
              {(s === "resolvido" ? itens.slice(0, 20) : itens).map((a) => <Cartao key={a.id} a={a} meuId={meuId} onAbrir={() => abrir(a.id)} />)}
            </section>
          );
        })}
      </div>

      <NovoAtendimento aberto={novo} onFechar={() => setNovo(false)} onCriado={(id) => { setNovo(false); void carregar(); setChamar(id); abrir(id); }} />
      <AtendimentoDetalhe id={atual} chamarAoAbrir={!!atual && chamar === atual} onFechar={() => { setChamar(null); abrir(null); }} onMudou={() => void carregar()}
        onAbrirConversa={(id) => { abrir(null); onAbrirConversa(id); }} />
    </div>
  );
}
