// src/rel/atendimento/AtendimentoPage.tsx
// -----------------------------------------------------------------------------
// ATENDIMENTO PELO WHATSAPP do Relacionamento (Fase 2).
//
// Esquerda: a fila. "Esperando" vem primeiro e em ordem de QUEM ESPERA HÁ MAIS
// TEMPO — é a lista que o prazo (SLA) cobra. O relógio de cada um conta só o
// horário de atendimento (minutos úteis).
// Direita: a conversa. Assumir, responder (texto, resposta pronta, arquivo,
// modelo quando a janela de 24h fechou), ligar à ficha e resolver.
//
// Atualiza sozinho (a cada poucos segundos) enquanto a aba está aberta.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  assumirConversa, carregarConversa, carregarMensagens, duracao, enviarArquivo, enviarTexto, horaCurta,
  ligarAoCliente, listarConversas, listarRespostas, marcarLida, preencherResposta, reabrirConversa,
  resolverConversa, statusDoNumero, type Conversa, type Filtro, type Mensagem, type NumeroRel, type Resposta,
} from "../lib/whatsapp";
import { buscarClientes, formatarTelefone, type Cliente } from "../lib/clientes";
import { Aviso, Avatar, Botao, Entrada, Etiqueta, Modal, Vazio } from "../ui";
import ModeloModal from "./ModeloModal";

const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: "esperando", rotulo: "Esperando" },
  { id: "minhas", rotulo: "Minhas" },
  { id: "abertas", rotulo: "Em andamento" },
  { id: "resolvidas", rotulo: "Resolvidas" },
];

/** Enquanto a aba está visível, roda `fn` a cada `ms`. */
function useRepetir(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) ref.current(); }, ms);
    const volta = () => { if (!document.hidden) ref.current(); };
    document.addEventListener("visibilitychange", volta);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", volta); };
  }, [ms]);
}

const nomeDa = (c: Conversa) => c.cliente_nome || c.nome_contato || formatarTelefone(c.telefone);

function Relogio({ c }: { c: Conversa }) {
  if (!c.aguardando_desde) return null;
  const estourou = c.minutos_esperando > c.meta_min;
  const quase = !estourou && c.minutos_esperando >= c.meta_min * 0.7;
  return (
    <Etiqueta tom={estourou ? "erro" : quase ? "aviso" : "rel"}>
      ⏱ {duracao(c.minutos_esperando)}
    </Etiqueta>
  );
}

// ── Lista ───────────────────────────────────────────────────────────────────

function Lista({ filtro, setFiltro, busca, setBusca, conversas, selecionada, abrir, carregando }: {
  filtro: Filtro; setFiltro: (f: Filtro) => void; busca: string; setBusca: (s: string) => void;
  conversas: Conversa[]; selecionada: string | null; abrir: (id: string) => void; carregando: boolean;
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 space-y-2.5 border-b" style={{ borderColor: "var(--line)" }}>
        <div className="flex gap-1 overflow-x-auto">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className="px-2.5 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap"
              style={filtro === f.id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink3)" }}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
        <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome, telefone ou mensagem" style={{ padding: "7px 10px", fontSize: 13 }} />
      </div>
      <ul className="flex-1 overflow-y-auto min-h-0">
        {conversas.length === 0 && !carregando && (
          <li className="p-6 text-center text-[13px]" style={{ color: "var(--ink3)" }}>
            {filtro === "esperando" ? "Ninguém esperando resposta. 🎉" : "Nenhuma conversa aqui."}
          </li>
        )}
        {conversas.map((c) => {
          const sel = c.id === selecionada;
          return (
            <li key={c.id}>
              <button
                onClick={() => abrir(c.id)}
                className="rel-linha w-full text-left px-3 py-2.5 flex gap-2.5 items-start"
                style={{ background: sel ? "var(--rel-soft)" : undefined, borderBottom: "1px solid var(--line2)" }}
              >
                <Avatar nome={nomeDa(c)} tamanho={36} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="flex-1 truncate text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{nomeDa(c)}</span>
                    <span className="text-[11px] flex-shrink-0" style={{ color: "var(--ink3)" }}>{horaCurta(c.ultima_entrada_em || c.atualizado_em)}</span>
                  </span>
                  <span className="block truncate text-[12px]" style={{ color: "var(--ink3)" }}>{c.ultima_mensagem || "—"}</span>
                  <span className="flex flex-wrap items-center gap-1 mt-1">
                    <Relogio c={c} />
                    {c.nao_lidas > 0 && <Etiqueta tom="rel">{c.nao_lidas} nova{c.nao_lidas > 1 ? "s" : ""}</Etiqueta>}
                    {!c.cliente_id && <Etiqueta>sem ficha</Etiqueta>}
                    {c.atendente_nome && <span className="text-[11px]" style={{ color: "var(--ink3)" }}>· {c.atendente_nome.split(" ")[0]}</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Bolha ───────────────────────────────────────────────────────────────────

const VISTO: Record<string, string> = { sent: "✓", delivered: "✓✓", read: "✓✓", failed: "✗ não entregue" };

function Bolha({ m }: { m: Mensagem }) {
  const minha = m.direcao === "out";
  const auto = m.origem === "automatica";
  return (
    <div className={`flex ${minha ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-2 text-[14px] leading-snug"
        style={minha
          ? { background: auto ? "var(--card2)" : "var(--wa-soft)", color: auto ? "var(--ink2)" : "var(--wa-ink)", borderBottomRightRadius: 6 }
          : { background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)", borderBottomLeftRadius: 6 }}
      >
        {minha && (m.origem === "celular" || auto) && (
          <span className="block text-[11px] font-semibold mb-0.5" style={{ opacity: 0.7 }}>
            {auto ? "Mensagem automática" : "Pelo celular"}
          </span>
        )}
        {m.anexos?.map((a, i) => (
          <div key={i} className="mb-1">
            {a.type === "image" ? (
              <a href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt="Imagem enviada" className="rounded-lg max-h-64" /></a>
            ) : a.type === "audio" ? (
              <audio src={a.url} controls className="max-w-full" />
            ) : a.type === "video" ? (
              <video src={a.url} controls className="rounded-lg max-h-64" />
            ) : (
              <a href={a.url} target="_blank" rel="noreferrer" className="underline font-semibold">📄 {a.nome || "Arquivo"}</a>
            )}
          </div>
        ))}
        {m.texto && <p className="whitespace-pre-wrap break-words">{m.texto}</p>}
        <span className="flex justify-end gap-1.5 text-[10px] mt-0.5" style={{ opacity: 0.65 }}>
          {minha && m.origem === "qs" && m.autor_nome && <span>{m.autor_nome.split(" ")[0]}</span>}
          <span>{new Date(m.enviada_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
          {minha && m.status && <span style={m.status === "read" ? { color: "#2B8AE6", opacity: 1 } : m.status === "failed" ? { color: "var(--err-ink)", opacity: 1 } : undefined}>{VISTO[m.status]}</span>}
        </span>
      </div>
    </div>
  );
}

// ── Ligar à ficha ───────────────────────────────────────────────────────────

function LigarFicha({ aberto, conversa, onFechar, onLigado }: { aberto: boolean; conversa: Conversa; onFechar: () => void; onLigado: () => void }) {
  const [termo, setTermo] = useState("");
  const [lista, setLista] = useState<Cliente[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { if (aberto) setTermo(conversa.telefone.slice(-8)); }, [aberto, conversa.telefone]);
  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(() => { buscarClientes(termo, 10).then(setLista).catch(() => setLista([])); }, 250);
    return () => clearTimeout(t);
  }, [termo, aberto]);
  async function ligar(id: string) {
    try { await ligarAoCliente(conversa.id, id); onLigado(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }
  return (
    <Modal aberto={aberto} titulo="Ligar a conversa a uma ficha" onFechar={onFechar}>
      <div className="space-y-3">
        <Entrada value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Nome, CPF ou telefone" autoFocus />
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <ul className="rel-card overflow-hidden">
          {lista.length === 0 && <li className="p-3 text-[13px]" style={{ color: "var(--ink3)" }}>Ninguém encontrado. Crie a ficha em Clientes e volte aqui — se o telefone for o mesmo, a conversa liga sozinha.</li>}
          {lista.map((c) => (
            <li key={c.id}>
              <button onClick={() => ligar(c.id)} className="rel-linha w-full text-left px-3 py-2 text-[13px] flex justify-between gap-2" style={{ color: "var(--ink)" }}>
                <span className="font-semibold">{c.nome}</span>
                <span style={{ color: "var(--ink3)" }}>{formatarTelefone(c.telefone)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

// ── Conversa ────────────────────────────────────────────────────────────────

function Painel({ id, meuId, onVoltar, onMudou, onAbrirCliente }: {
  id: string; meuId: string; onVoltar: () => void; onMudou: () => void; onAbrirCliente: (id: string) => void;
}) {
  const [c, setC] = useState<Conversa | null>(null);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [respostas, setRespostas] = useState<Resposta[]>([]);
  const [verRespostas, setVerRespostas] = useState(false);
  const [modelo, setModelo] = useState(false);
  const [ligar, setLigar] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const qtdAnterior = useRef(0);

  const recarregar = useCallback(async () => {
    try {
      const [cv, ms] = await Promise.all([carregarConversa(id), carregarMensagens(id)]);
      setC(cv);
      setMsgs(ms);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar a conversa.");
    }
  }, [id]);

  useEffect(() => {
    setC(null); setMsgs([]); setTexto(""); setErro(null); qtdAnterior.current = 0;
    void recarregar().then(() => { void marcarLida(id).then(onMudou); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { listarRespostas().then(setRespostas); }, []);
  useRepetir(() => { void recarregar(); }, 5000);

  // Desce pro fim quando chega mensagem nova.
  useEffect(() => {
    if (msgs.length !== qtdAnterior.current) {
      fimRef.current?.scrollIntoView({ block: "end" });
      if (qtdAnterior.current && c?.nao_lidas) void marcarLida(id);
      qtdAnterior.current = msgs.length;
    }
  }, [msgs.length, c?.nao_lidas, id]);

  if (!c) return <div className="flex-1 flex items-center justify-center text-[13px]" style={{ color: "var(--ink3)" }}>{erro || "Carregando…"}</div>;

  async function acao(fn: () => Promise<unknown>) {
    setErro(null);
    try { await fn(); await recarregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await enviarTexto(c!.id, t);
      setTexto("");
      await recarregar();
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não enviou.");
    } finally {
      setEnviando(false);
    }
  }

  async function anexar(f: File | undefined) {
    if (!f) return;
    setEnviando(true);
    setErro(null);
    try { await enviarArquivo(c!.id, f, texto.trim()); setTexto(""); await recarregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Arquivo não enviado."); }
    finally { setEnviando(false); if (arquivoRef.current) arquivoRef.current.value = ""; }
  }

  const minha = c.atendente_id === meuId;
  const nome = nomeDa(c);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2.5 border-b" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        <button onClick={onVoltar} className="lg:hidden p-1 -ml-1" aria-label="Voltar" style={{ color: "var(--ink2)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <Avatar nome={nome} tamanho={34} />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold truncate" style={{ color: "var(--ink)" }}>{nome}</p>
          <p className="text-[12px] truncate" style={{ color: "var(--ink3)" }}>
            {formatarTelefone(c.telefone)}
            {c.cliente_id
              ? <> · <button className="underline" onClick={() => onAbrirCliente(c.cliente_id!)}>abrir ficha</button></>
              : <> · <button className="underline font-semibold" style={{ color: "var(--warn-ink)" }} onClick={() => setLigar(true)}>ligar à ficha</button></>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {!minha && (
            <Botao onClick={() => acao(() => assumirConversa(c.id, meuId))}>
              {c.atendente_id ? `Assumir (era de ${c.atendente_nome?.split(" ")[0] ?? "outro"})` : "Assumir"}
            </Botao>
          )}
          {c.estado !== "resolvida"
            ? <Botao variante="primario" onClick={() => acao(() => resolverConversa(c.id))}>Resolver</Botao>
            : <Botao onClick={() => acao(() => reabrirConversa(c.id))}>Reabrir</Botao>}
        </div>
      </div>

      {c.aguardando_desde && (
        <div className="px-4 py-1.5 text-[12px] flex items-center gap-2" style={{ background: c.minutos_esperando > c.meta_min ? "var(--err-bg)" : "var(--warn-bg)", color: c.minutos_esperando > c.meta_min ? "var(--err-ink)" : "var(--warn-ink)" }}>
          ⏱ Esperando resposta há <b>{duracao(c.minutos_esperando)}</b> úteis · prazo {duracao(c.meta_min)}
          {c.minutos_esperando > c.meta_min && " — fora do prazo"}
        </div>
      )}

      {/* Mensagens */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 sm:px-5 py-4 space-y-2" style={{ background: "var(--bg)" }}>
        {msgs.length === 0 && <p className="text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma mensagem ainda.</p>}
        {msgs.map((m) => <Bolha key={m.id} m={m} />)}
        <div ref={fimRef} />
      </div>

      {/* Escrever */}
      <div className="border-t p-2.5 sm:p-3 space-y-2" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        {!c.janela_aberta ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 text-[13px]" style={{ color: "var(--ink2)" }}>
              O cliente não escreve há mais de 24h. A Meta só deixa mandar um <b>modelo aprovado</b> — quando ele responder, a conversa libera.
            </p>
            <Botao variante="primario" onClick={() => setModelo(true)}>Mandar modelo</Botao>
          </div>
        ) : (
          <>
            {verRespostas && (
              <div className="rel-card max-h-48 overflow-y-auto">
                {respostas.length === 0 && <p className="p-3 text-[12px]" style={{ color: "var(--ink3)" }}>Nenhuma resposta pronta. Crie em Configurações.</p>}
                {respostas.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => { setTexto(preencherResposta(r.texto, c.cliente_nome || c.nome_contato)); setVerRespostas(false); }}
                    className="rel-linha w-full text-left px-3 py-2"
                    style={{ borderBottom: "1px solid var(--line2)" }}
                  >
                    <span className="block text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{r.titulo}</span>
                    <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>{r.texto}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <button title="Respostas prontas" onClick={() => setVerRespostas((v) => !v)} className="p-2 rounded-lg" style={{ color: verRespostas ? "var(--rel-ink)" : "var(--ink3)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
              </button>
              <button title="Anexar arquivo (JPG, PNG, PDF, MP4 — até 3 MB)" onClick={() => arquivoRef.current?.click()} className="p-2 rounded-lg" style={{ color: "var(--ink3)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
              </button>
              <input ref={arquivoRef} type="file" hidden accept="image/jpeg,image/png,application/pdf,video/mp4,audio/mpeg,audio/ogg" onChange={(e) => void anexar(e.target.files?.[0])} />
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
                rows={Math.min(5, Math.max(1, texto.split("\n").length))}
                placeholder="Escreva… (Enter envia, Shift+Enter pula linha)"
                className="rel-input flex-1 resize-none"
              />
              <Botao variante="primario" onClick={() => void enviar()} disabled={enviando || !texto.trim()}>
                {enviando ? "…" : "Enviar"}
              </Botao>
            </div>
          </>
        )}
      </div>

      <ModeloModal
        aberto={modelo}
        alvo={{ conversaId: c.id }}
        nomeCliente={c.cliente_nome || c.nome_contato}
        onFechar={() => setModelo(false)}
        onEnviado={() => { setModelo(false); void recarregar(); onMudou(); }}
      />
      <LigarFicha aberto={ligar} conversa={c} onFechar={() => setLigar(false)} onLigado={() => { setLigar(false); void recarregar(); onMudou(); }} />
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function AtendimentoPage({ conversaId, abrir, onAbrirCliente, onMudou }: {
  conversaId: string | null;
  abrir: (id: string | null) => void;
  onAbrirCliente: (id: string) => void;
  onMudou: () => void;
}) {
  const { currentUser } = useQsAuth();
  const [filtro, setFiltro] = useState<Filtro>("esperando");
  const [busca, setBusca] = useState("");
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [numero, setNumero] = useState<NumeroRel | null>(null);
  const meuId = currentUser?.id ?? "";

  const carregar = useCallback(async () => {
    try { setConversas(await listarConversas(filtro, meuId, busca)); }
    catch { /* mantém a lista anterior; tenta de novo no próximo ciclo */ }
    finally { setCarregando(false); }
  }, [filtro, meuId, busca]);

  useEffect(() => {
    setCarregando(true);
    const t = setTimeout(() => { void carregar(); }, busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca]);
  useRepetir(() => { void carregar(); }, 10_000);
  useEffect(() => { statusDoNumero().then(setNumero).catch(() => setNumero(null)); }, []);

  const mudou = () => { void carregar(); onMudou(); };

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -my-6 lg:-my-8">
      {numero && !numero.conectado && (
        <div className="px-4 py-2 text-[13px]" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
          O número de WhatsApp do Relacionamento ainda não está conectado. O admin conecta no Comercial em
          <b> Configurações → WhatsApp (Meta) → Conectar → "Número do Relacionamento"</b>.
        </div>
      )}
      {/* Altura da tela inteira (no celular, menos a barra do topo de 56px). */}
      <div className="flex h-[calc(100dvh-56px)] lg:h-[100dvh]">
        <aside
          className={`${conversaId ? "hidden lg:flex" : "flex"} flex-col w-full lg:w-[340px] lg:flex-shrink-0 border-r min-h-0`}
          style={{ borderColor: "var(--line)", background: "var(--card)" }}
        >
          <Lista
            filtro={filtro} setFiltro={setFiltro} busca={busca} setBusca={setBusca}
            conversas={conversas} selecionada={conversaId} abrir={(id) => abrir(id)} carregando={carregando}
          />
        </aside>
        <section className={`${conversaId ? "flex" : "hidden lg:flex"} flex-1 flex-col min-w-0 min-h-0`}>
          {conversaId ? (
            <Painel id={conversaId} meuId={meuId} onVoltar={() => abrir(null)} onMudou={mudou} onAbrirCliente={onAbrirCliente} />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <Vazio titulo="Escolha uma conversa" texto="Comece por quem está esperando há mais tempo — é o que conta no prazo de resposta." />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
