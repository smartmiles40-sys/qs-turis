// src/rel/atendimento/BlocoDeNotas.tsx
// -----------------------------------------------------------------------------
// BLOCO DE NOTAS PARTICULAR do Atendimento (Bruno, 14/10/2026 — 0121).
//
// Painel à direita da conversa, no jeito do WhatsApp Web. Cada pessoa tem o
// seu: só o dono lê (a RLS de rel_notas não abre nem pro admin). Serve pra
// anotar coisas soltas e pra GUARDAR MENSAGENS — botão direito na bolha →
// "Guardar no bloco de notas" grava uma cópia da mensagem, então a nota
// continua de pé mesmo que a conversa suma.
//
// O editor salva sozinho (600 ms depois de parar de digitar). Trocar de nota,
// voltar pra lista ou fechar o painel sempre grava o que estava pendente antes.
// Nota nova que ficou vazia é apagada ao sair dela — não sobra lixo na lista.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { apagarNota, listarNotas, salvarNota, type Nota } from "../lib/whatsapp";
import { TextoWa } from "./waUi";

type Filtro = "todas" | "conversa" | "mensagens" | "fixadas";
type EstadoSalvar = "parado" | "salvando" | "salvo" | "erro";
type Rascunho = Pick<Nota, "titulo" | "texto" | "cor" | "fixada">;

// Tons translúcidos: funcionam no claro e no escuro sem trocar a cor do texto.
const CORES: { chave: string; nome: string; fundo: string; borda: string }[] = [
  { chave: "amarelo", nome: "Amarelo", fundo: "rgba(255,188,56,.16)", borda: "rgba(255,188,56,.55)" },
  { chave: "verde", nome: "Verde", fundo: "rgba(0,168,132,.14)", borda: "rgba(0,168,132,.5)" },
  { chave: "azul", nome: "Azul", fundo: "rgba(83,189,235,.16)", borda: "rgba(83,189,235,.55)" },
  { chave: "rosa", nome: "Rosa", fundo: "rgba(255,92,138,.14)", borda: "rgba(255,92,138,.5)" },
  { chave: "roxo", nome: "Roxo", fundo: "rgba(167,139,250,.16)", borda: "rgba(167,139,250,.55)" },
  { chave: "cinza", nome: "Cinza", fundo: "rgba(127,127,127,.12)", borda: "rgba(127,127,127,.45)" },
];
const corDe = (c: string | null) => CORES.find((x) => x.chave === c) || null;

function quandoCurto(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const ontem = new Date(hoje.getTime() - 86_400_000);
  if (d.toDateString() === ontem.toDateString()) return "ontem";
  return d.toLocaleDateString("pt-BR", d.getFullYear() === hoje.getFullYear() ? { day: "2-digit", month: "2-digit" } : { day: "2-digit", month: "2-digit", year: "2-digit" });
}

const vazia = (n: Pick<Nota, "titulo" | "texto" | "mensagem">) => !n.titulo.trim() && !n.texto.trim() && !n.mensagem;

function ordenar(l: Nota[]): Nota[] {
  return [...l].sort((a, b) => Number(b.fixada) - Number(a.fixada) || b.atualizado_em.localeCompare(a.atualizado_em));
}

// ── Ícones ──────────────────────────────────────────────────────────────────

const Svg = ({ children, t = 20 }: { children: ReactNode; t?: number }) => (
  <svg width={t} height={t} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);
const IcFechar = () => <Svg><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Svg>;
const IcVoltar = () => <Svg><polyline points="15 18 9 12 15 6" /></Svg>;
const IcCadeado = () => <Svg t={12}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>;
const IcBusca = () => <Svg t={16}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.6" y2="16.6" /></Svg>;
const IcMais = () => <Svg><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>;
const IcLixo = () => <Svg t={18}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></Svg>;
const IcFixar = ({ cheio }: { cheio?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={cheio ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 17v5" /><path d="M9 10.76V6h6v4.76a2 2 0 0 0 1.11 1.79l1.78.9A2 2 0 0 1 19 15.24V17H5v-1.76a2 2 0 0 1 1.11-1.79l1.78-.9A2 2 0 0 0 9 10.76z" /><path d="M8 2h8" />
  </svg>
);

// ── Painel ──────────────────────────────────────────────────────────────────

export default function BlocoDeNotas({ conversaAtual, onAbrirConversa, onFechar, sinal }: {
  conversaAtual: { id: string; nome: string } | null;
  onAbrirConversa: (id: string) => void;
  onFechar: () => void;
  /** Muda quando o pai guardou uma mensagem nova aqui → recarrega. */
  sinal: number;
}) {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [estado, setEstado] = useState<EstadoSalvar>("parado");
  const [confirmarApagar, setConfirmarApagar] = useState(false);

  // O que falta gravar, POR NOTA (id → campos). Cada nota tem a sua fila de
  // gravação: um save só começa quando o anterior da mesma nota terminou, e
  // sempre pega o pendente mais novo — o PATCH antigo nunca chega por último.
  const pendentes = useRef(new Map<string, Partial<Rascunho>>());
  const filas = useRef(new Map<string, Promise<boolean>>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textoRef = useRef<HTMLTextAreaElement>(null);
  const tituloRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    try { setNotas(ordenar(await listarNotas())); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não consegui abrir o bloco de notas."); }
    finally { setCarregando(false); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar, sinal]);

  // Sem conversa aberta, o filtro "Desta conversa" não faz sentido.
  useEffect(() => { if (!conversaAtual && filtro === "conversa") setFiltro("todas"); }, [conversaAtual, filtro]);

  const gravar = useCallback((id: string): Promise<boolean> => {
    const anterior = filas.current.get(id) ?? Promise.resolve(true);
    const prox = anterior.then(async () => {
      const campos = pendentes.current.get(id);
      if (!campos) return true;
      pendentes.current.delete(id);
      try {
        const salva = await salvarNota({ id, ...campos });
        setNotas((l) => ordenar(l.map((n) => (n.id === salva.id ? salva : n))));
        return true;
      } catch (e) {
        // Devolve pro pendente (sem pisar no que foi digitado enquanto isso).
        pendentes.current.set(id, { ...campos, ...(pendentes.current.get(id) || {}) });
        setErro(e instanceof Error ? e.message : "Não salvei a nota.");
        return false;
      }
    });
    filas.current.set(id, prox);
    return prox;
  }, []);

  /** Grava tudo o que está pendente. true = gravou tudo. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const ids = [...pendentes.current.keys()];
    if (!ids.length) { await Promise.all([...filas.current.values()]); return true; }
    setEstado("salvando");
    const ok = (await Promise.all(ids.map(gravar))).every(Boolean);
    if (ok) { setEstado(pendentes.current.size ? "salvando" : "salvo"); setErro(null); }
    else {
      setEstado("erro");
      // Tenta de novo sozinho daqui a pouco — o texto continua guardado aqui.
      timer.current = setTimeout(() => { void flush(); }, 5000);
    }
    return ok;
  }, [gravar]);

  // Fechar o painel (desmontar) grava o pendente.
  useEffect(() => () => { void flush(); }, [flush]);

  function mudar(campos: Partial<Rascunho>, imediato = false) {
    if (!abertaId || !rascunho) return;
    setRascunho({ ...rascunho, ...campos });
    pendentes.current.set(abertaId, { ...(pendentes.current.get(abertaId) || {}), ...campos });
    setEstado("salvando");
    if (timer.current) clearTimeout(timer.current);
    if (imediato) void flush();
    else timer.current = setTimeout(() => { void flush(); }, 600);
  }

  /** Sai do editor: grava o pendente e apaga a nota se ela ficou vazia. Não sai se não gravou. */
  async function sairDaNota(): Promise<boolean> {
    const id = abertaId;
    const r = rascunho;
    if (!(await flush())) { setErro("Não salvou — tente de novo."); return false; }
    setAbertaId(null); setRascunho(null); setConfirmarApagar(false); setEstado("parado");
    const n = notas.find((x) => x.id === id);
    if (id && r && n && vazia({ titulo: r.titulo, texto: r.texto, mensagem: n.mensagem })) {
      setNotas((l) => l.filter((x) => x.id !== id));
      await apagarNota(id).catch(() => undefined);
    }
    return true;
  }

  async function abrir(n: Nota) {
    if (abertaId && !(await sairDaNota())) return;
    setAbertaId(n.id);
    // Se ficou algo sem gravar desta nota, o rascunho começa dele (não do servidor).
    setRascunho({ titulo: n.titulo, texto: n.texto, cor: n.cor, fixada: n.fixada, ...(pendentes.current.get(n.id) || {}) });
    setConfirmarApagar(false);
    setEstado(pendentes.current.has(n.id) ? "erro" : "parado");
  }

  async function nova(daConversa: boolean) {
    if (abertaId && !(await sairDaNota())) return;
    setErro(null);
    try {
      const n = await salvarNota({ titulo: "", texto: "", conversa_id: daConversa && conversaAtual ? conversaAtual.id : null });
      setNotas((l) => ordenar([n, ...l]));
      setAbertaId(n.id);
      setRascunho({ titulo: n.titulo, texto: n.texto, cor: n.cor, fixada: n.fixada });
      setEstado("parado");
      requestAnimationFrame(() => tituloRef.current?.focus());
    } catch (e) { setErro(e instanceof Error ? e.message : "Não criei a nota."); }
  }

  async function apagar() {
    if (!abertaId) return;
    const id = abertaId;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    pendentes.current.delete(id);
    try {
      await apagarNota(id);
      setNotas((l) => l.filter((x) => x.id !== id));
      setAbertaId(null); setRascunho(null); setConfirmarApagar(false); setEstado("parado");
    } catch (e) { setErro(e instanceof Error ? e.message : "Não apaguei a nota."); }
  }

  async function alternarFixada(n: Nota) {
    try {
      const salva = await salvarNota({ id: n.id, fixada: !n.fixada });
      setNotas((l) => ordenar(l.map((x) => (x.id === salva.id ? salva : x))));
    } catch (e) { setErro(e instanceof Error ? e.message : "Não consegui fixar."); }
  }

  // Campo de texto cresce com o conteúdo.
  useEffect(() => {
    const el = textoRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 120)}px`;
  }, [rascunho?.texto, abertaId]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return notas.filter((n) => {
      if (filtro === "conversa" && n.conversa_id !== conversaAtual?.id) return false;
      if (filtro === "mensagens" && !n.mensagem) return false;
      if (filtro === "fixadas" && !n.fixada) return false;
      if (!t) return true;
      return [n.titulo, n.texto, n.mensagem?.texto || "", n.mensagem?.de || ""].some((x) => x.toLowerCase().includes(t));
    });
  }, [notas, busca, filtro, conversaAtual?.id]);

  const aberta = abertaId ? notas.find((n) => n.id === abertaId) || null : null;

  const chips: [Filtro, string][] = [
    ["todas", "Todas"],
    ...(conversaAtual ? [["conversa", "Desta conversa"] as [Filtro, string]] : []),
    ["mensagens", "Mensagens guardadas"],
    ["fixadas", "Fixadas"],
  ];

  return (
    <div className="flex flex-col h-full min-h-0 wa-lista" style={{ borderLeft: "1px solid var(--wa-line)" }}>
      {/* Cabeçalho */}
      <div className="wa-cab flex items-center gap-2 px-2 h-[60px] flex-shrink-0" style={{ borderBottom: "1px solid var(--wa-line)" }}>
        {aberta ? (
          <button onClick={() => void sairDaNota()} className="wa-icone w-10 h-10 inline-flex items-center justify-center" aria-label="Voltar para a lista de notas"><IcVoltar /></button>
        ) : (
          <button onClick={onFechar} className="wa-icone w-10 h-10 inline-flex items-center justify-center" aria-label="Fechar o bloco de notas"><IcFechar /></button>
        )}
        <span className="flex-1 min-w-0">
          <span className="block text-[16px] truncate" style={{ color: "var(--wa-txt)" }}>Bloco de notas</span>
          <span className="flex items-center gap-1 text-[12px]" style={{ color: "var(--wa-meta)" }}><IcCadeado /> Só você vê</span>
        </span>
        {aberta ? (
          <span className="text-[12px] pr-2" style={{ color: estado === "erro" ? "var(--err-ink, #D93025)" : "var(--wa-meta)" }} aria-live="polite">
            {estado === "salvando" ? "Salvando…" : estado === "salvo" ? "Salvo" : estado === "erro" ? "Não salvou" : ""}
          </span>
        ) : (
          <button onClick={() => void nova(false)} className="wa-icone w-10 h-10 inline-flex items-center justify-center" aria-label="Nova nota" title="Nova nota"><IcMais /></button>
        )}
      </div>

      {erro && (
        <div className="px-3 py-2 text-[12.5px] flex items-center gap-2" style={{ background: "var(--err-bg, rgba(217,48,37,.1))", color: "var(--err-ink, #D93025)" }} role="alert">
          <span className="flex-1">{erro}</span>
          <button className="underline font-semibold" onClick={() => setErro(null)}>Ok</button>
        </div>
      )}

      {aberta && rascunho ? (
        <Editor
          nota={aberta} r={rascunho} mudar={mudar} tituloRef={tituloRef} textoRef={textoRef}
          confirmarApagar={confirmarApagar} setConfirmarApagar={setConfirmarApagar} apagar={() => void apagar()}
          sair={() => void sairDaNota()}
          abrirConversa={aberta.conversa_id ? () => { void flush(); onAbrirConversa(aberta.conversa_id!); } : null}
          ehDestaConversa={!!conversaAtual && aberta.conversa_id === conversaAtual.id}
        />
      ) : (
        <>
          <div className="px-3 pt-2.5 pb-2 space-y-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--wa-line)" }}>
            <label className="flex items-center gap-2.5 px-3 h-9 rounded-lg" style={{ background: "var(--wa-head)", color: "var(--wa-meta)" }}>
              <IcBusca />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar nas notas" aria-label="Pesquisar nas notas"
                className="wa-campo flex-1 min-w-0 text-[14px]" style={{ background: "transparent" }} />
            </label>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar notas">
              {chips.map(([f, r]) => (
                <button key={f} role="tab" aria-selected={filtro === f} onClick={() => setFiltro(f)}
                  className="h-7 px-3 rounded-full text-[12.5px] font-medium"
                  style={filtro === f
                    ? { background: "var(--wa-green)", color: "#fff" }
                    : { background: "var(--wa-head)", color: "var(--wa-meta)" }}>{r}</button>
              ))}
            </div>
            {conversaAtual && (
              <button onClick={() => void nova(true)} className="w-full h-9 rounded-lg text-[13px] font-semibold flex items-center justify-center gap-1.5"
                style={{ border: "1px dashed var(--wa-line)", color: "var(--wa-green-ink)" }}>
                <Svg t={16}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>
                <span className="truncate">Nova nota sobre {conversaAtual.nome}</span>
              </button>
            )}
          </div>

          <ul className="flex-1 overflow-y-auto min-h-0 p-2 space-y-1.5" aria-busy={carregando}>
            {carregando && notas.length === 0 && [0, 1, 2].map((i) => (
              <li key={`esq${i}`} className="rounded-lg p-3 space-y-2" aria-hidden style={{ background: "var(--wa-head)" }}>
                <span className="block h-3 w-2/5 rounded animate-pulse" style={{ background: "var(--wa-line)" }} />
                <span className="block h-3 w-4/5 rounded animate-pulse" style={{ background: "var(--wa-line)" }} />
              </li>
            ))}
            {!carregando && visiveis.length === 0 && (
              <li className="px-5 py-10 text-center text-[13px] space-y-2" style={{ color: "var(--wa-meta)" }}>
                {notas.length === 0 || (!busca && filtro === "todas") ? (
                  <>
                    <p className="text-[15px]" style={{ color: "var(--wa-txt)" }}>Seu bloco de notas está vazio</p>
                    <p>Anote o que quiser com o <b>+</b> lá em cima.</p>
                    <p>Guarde mensagens clicando com o botão direito nelas → <b>Guardar no bloco de notas</b>.</p>
                  </>
                ) : busca ? "Nenhuma nota com essa busca." : "Nenhuma nota aqui."}
              </li>
            )}
            {visiveis.map((n) => <ItemNota key={n.id} n={n} abrir={() => void abrir(n)} fixar={() => void alternarFixada(n)} />)}
          </ul>
        </>
      )}
    </div>
  );
}

// ── Item da lista ───────────────────────────────────────────────────────────

function ItemNota({ n, abrir, fixar }: { n: Nota; abrir: () => void; fixar: () => void }) {
  const cor = corDe(n.cor);
  const titulo = n.titulo.trim() || (n.mensagem ? `Mensagem de ${n.mensagem.de}` : n.texto.trim().split("\n")[0] || "Nota sem título");
  const resumo = n.mensagem ? n.mensagem.texto || (n.mensagem.anexos?.length ? "📎 anexo" : "") : n.texto;
  return (
    <li className="group relative">
      <button onClick={abrir} className="wa-item w-full text-left rounded-lg px-3 py-2.5"
        style={{ background: cor?.fundo || "var(--wa-head)", border: `1px solid ${cor?.borda || "transparent"}` }}>
        <span className="flex items-baseline gap-2 pr-7">
          <span className="flex-1 truncate text-[14.5px] font-medium" style={{ color: "var(--wa-txt)" }}>{titulo}</span>
          <span className="text-[11.5px] flex-shrink-0" style={{ color: "var(--wa-meta)" }}>{quandoCurto(n.atualizado_em)}</span>
        </span>
        {resumo && (
          <span className="flex items-center gap-1 mt-0.5 text-[13px]" style={{ color: "var(--wa-meta)" }}>
            {n.mensagem && <span aria-label="Mensagem guardada" title="Mensagem guardada">💬</span>}
            <span className="truncate">{resumo}</span>
          </span>
        )}
      </button>
      <button onClick={fixar} aria-label={n.fixada ? "Desafixar nota" : "Fixar nota no topo"} title={n.fixada ? "Desafixar" : "Fixar no topo"} aria-pressed={n.fixada}
        className={`wa-icone absolute top-1.5 right-1.5 w-8 h-8 inline-flex items-center justify-center ${n.fixada ? "" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
        style={n.fixada ? { color: "var(--wa-green-ink)" } : undefined}>
        <IcFixar cheio={n.fixada} />
      </button>
    </li>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────

function Editor({ nota, r, mudar, tituloRef, textoRef, confirmarApagar, setConfirmarApagar, apagar, sair, abrirConversa, ehDestaConversa }: {
  nota: Nota; r: Rascunho; mudar: (c: Partial<Rascunho>, imediato?: boolean) => void;
  tituloRef: RefObject<HTMLInputElement>; textoRef: RefObject<HTMLTextAreaElement>;
  confirmarApagar: boolean; setConfirmarApagar: (v: boolean) => void; apagar: () => void; sair: () => void;
  abrirConversa: (() => void) | null; ehDestaConversa: boolean;
}) {
  const cor = corDe(r.cor);
  const m = nota.mensagem;
  const foto = m?.anexos?.find((a) => a.type === "image");
  return (
    <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (confirmarApagar) setConfirmarApagar(false); else sair(); } }}>
      <div className="rounded-xl p-3 space-y-2" style={{ background: cor?.fundo || "var(--wa-head)", border: `1px solid ${cor?.borda || "var(--wa-line)"}` }}>
        <input ref={tituloRef} value={r.titulo} onChange={(e) => mudar({ titulo: e.target.value })} placeholder="Título"
          aria-label="Título da nota" className="wa-campo w-full text-[16px] font-semibold px-1 py-1" style={{ background: "transparent" }} />

        {m && (
          <figure className="rounded-lg p-2" style={{ background: "var(--wa-list)", boxShadow: "0 1px .5px rgba(11,20,26,.13)" }}>
            <figcaption className="flex items-baseline gap-2 text-[12px] mb-1" style={{ color: "var(--wa-meta)" }}>
              <b className="truncate" style={{ color: "var(--wa-green-ink)" }}>{m.de}</b>
              <span className="flex-shrink-0">{new Date(m.quando).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            </figcaption>
            {foto && <img src={foto.url} alt="Imagem da mensagem" loading="lazy" className="w-full max-h-48 object-cover rounded-md mb-1" />}
            {!foto && !!m.anexos?.length && <p className="text-[13px] mb-1" style={{ color: "var(--wa-meta)" }}>📎 {m.anexos[0].nome || "anexo"}</p>}
            {m.texto && <p className="text-[14px] leading-5" style={{ color: "var(--wa-txt)" }}><TextoWa texto={m.texto} /></p>}
          </figure>
        )}

        <textarea ref={textoRef} value={r.texto} onChange={(e) => mudar({ texto: e.target.value })}
          placeholder={m ? "Seu comentário sobre essa mensagem…" : "Escreva sua nota…"}
          aria-label={m ? "Comentário sobre a mensagem guardada" : "Texto da nota"}
          className="wa-campo w-full resize-none text-[14px] leading-5 px-1 py-1" style={{ background: "transparent", minHeight: 120 }} />
      </div>

      {abrirConversa && !ehDestaConversa && (
        <button onClick={abrirConversa} className="w-full h-9 rounded-lg text-[13px] font-semibold wa-verde">
          Abrir conversa
        </button>
      )}

      <div className="flex items-center gap-1.5 flex-wrap" role="radiogroup" aria-label="Cor da nota">
        <button role="radio" aria-checked={!r.cor} aria-label="Sem cor" title="Sem cor" onClick={() => mudar({ cor: null }, true)}
          className="w-7 h-7 rounded-full" style={{ background: "var(--wa-head)", border: `2px solid ${!r.cor ? "var(--wa-green)" : "var(--wa-line)"}` }} />
        {CORES.map((c) => (
          <button key={c.chave} role="radio" aria-checked={r.cor === c.chave} aria-label={c.nome} title={c.nome} onClick={() => mudar({ cor: c.chave }, true)}
            className="w-7 h-7 rounded-full" style={{ background: c.fundo, border: `2px solid ${r.cor === c.chave ? "var(--wa-green)" : c.borda}` }} />
        ))}
        <span className="flex-1" />
        <button onClick={() => mudar({ fixada: !r.fixada }, true)} aria-pressed={r.fixada} aria-label={r.fixada ? "Desafixar nota" : "Fixar nota no topo"}
          title={r.fixada ? "Desafixar" : "Fixar no topo"} className="wa-icone w-9 h-9 inline-flex items-center justify-center"
          style={r.fixada ? { color: "var(--wa-green-ink)" } : undefined}>
          <IcFixar cheio={r.fixada} />
        </button>
        <button onClick={() => setConfirmarApagar(true)} aria-label="Apagar nota" title="Apagar" className="wa-icone w-9 h-9 inline-flex items-center justify-center"><IcLixo /></button>
      </div>

      {confirmarApagar && (
        <div className="rounded-lg p-3 text-[13px] space-y-2" role="alertdialog" aria-label="Confirmar apagar nota"
          style={{ background: "var(--err-bg, rgba(217,48,37,.1))", color: "var(--err-ink, #D93025)" }}>
          <p>Apagar esta nota? Não dá pra desfazer.</p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setConfirmarApagar(false)} className="h-8 px-3 rounded-full font-semibold" style={{ color: "var(--wa-txt)", background: "var(--wa-head)" }}>Cancelar</button>
            <button onClick={apagar} autoFocus className="h-8 px-3 rounded-full font-semibold" style={{ background: "#D93025", color: "#fff" }}>Apagar</button>
          </div>
        </div>
      )}

      <p className="text-[11.5px] text-center" style={{ color: "var(--wa-meta)" }}>
        Criada {quandoCurto(nota.criado_em)} · salva sozinha · Esc volta pra lista
      </p>
    </div>
  );
}
