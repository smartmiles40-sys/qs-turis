// src/rel/atendimento/GruposPage.tsx
// -----------------------------------------------------------------------------
// GRUPOS do WhatsApp do Relacionamento (0137, 15/10/2026).
//
// Os grupos do número do Relacionamento chegam por uma ligação SEPARADA
// (Evolution, QR) — a API oficial da Meta não entrega grupo. Essa ligação só
// trata grupo: conversa com pessoa nunca entra aqui, e o envio só sai pra grupo.
// Mesmo visual do Atendimento (WA_CSS), sem SLA nem etiquetas.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarWa, MidiaDaMensagem, TextoWa, Visualizador, WA_CSS, corDoNome, horaDaLista, rotuloDoDia } from "./waUi";
import type { Anexo } from "../lib/whatsapp";
import {
  enviarNoGrupo, estadoDosGrupos, listarGrupos, mensagensDoGrupo, sincronizarGrupos,
  type Grupo, type MensagemGrupo,
} from "../lib/grupos";

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

const TIPO_ANEXO: Record<string, Anexo["type"]> = { imagem: "image", figurinha: "image", video: "video", audio: "audio", arquivo: "file" };
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const nomeDoGrupo = (g: Grupo) => g.nome?.trim() || "Grupo sem nome";
const autorDe = (m: MensagemGrupo) => m.autor_nome || (m.autor_jid ? m.autor_jid.split("@")[0] : "Participante");

export default function GruposPage({ grupoJid, abrir }: { grupoJid: string | null; abrir: (jid: string | null) => void }) {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [estado, setEstado] = useState<{ conectado: boolean; estado: string } | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try { setGrupos(await listarGrupos()); } catch { /* mantém a lista */ }
    setCarregando(false);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useRepetir(carregar, 10000);

  const conferirEstado = useCallback(async () => {
    try { setEstado(await estadoDosGrupos()); } catch { setEstado({ conectado: false, estado: "erro" }); }
  }, []);
  useEffect(() => { void conferirEstado(); }, [conferirEstado]);
  useRepetir(conferirEstado, 60000);

  const sincronizar = async () => {
    setSincronizando(true); setAviso(null);
    try {
      const r = await sincronizarGrupos();
      setAviso(`${r.grupos} grupo${r.grupos === 1 ? "" : "s"} encontrado${r.grupos === 1 ? "" : "s"}.`);
      await carregar();
    } catch (e) { setAviso((e as Error).message); }
    setSincronizando(false);
  };

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? grupos.filter((g) => nomeDoGrupo(g).toLowerCase().includes(q)) : grupos;
  }, [grupos, busca]);
  const aberto = grupos.find((g) => g.jid === grupoJid) || null;

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -my-6 lg:-my-8 wa">
      <style>{WA_CSS}</style>
      {estado && !estado.conectado && (
        <div className="px-4 py-2 text-[13px]" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
          A ligação dos grupos está fora do ar ({estado.estado}) — mensagens novas dos grupos não estão chegando.
        </div>
      )}
      <div className="flex relative h-[calc(100dvh-56px)] lg:h-[100dvh]">
        <aside className={`${grupoJid ? "hidden lg:flex" : "flex"} flex-col w-full lg:w-[380px] xl:w-[420px] lg:flex-shrink-0 border-r min-h-0 wa-lista`}
          style={{ borderColor: "var(--wa-line)" }}>
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <h1 className="text-[20px] font-bold flex-1" style={{ color: "var(--wa-txt)" }}>Grupos</h1>
            <button type="button" className="wa-icone px-3 py-1.5 text-[13px] font-medium" onClick={sincronizar} disabled={sincronizando}
              title="Buscar os grupos do número no WhatsApp">
              {sincronizando ? "Buscando…" : "Atualizar lista"}
            </button>
          </div>
          <div className="px-3 pb-2">
            <input className="wa-campo w-full px-3 py-2 text-[14px]" style={{ background: "var(--wa-head)" }} placeholder="Pesquisar grupo"
              value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Pesquisar grupo" />
          </div>
          {aviso && <p className="px-4 pb-2 text-[12.5px]" style={{ color: "var(--wa-meta)" }}>{aviso}</p>}
          <div className="flex-1 overflow-y-auto min-h-0">
            {carregando && <p className="px-4 py-6 text-[13px]" style={{ color: "var(--wa-meta)" }}>Carregando…</p>}
            {!carregando && visiveis.length === 0 && (
              <div className="px-6 py-10 text-center text-[13.5px]" style={{ color: "var(--wa-meta)" }}>
                {busca ? "Nenhum grupo com esse nome." : <>Nenhum grupo ainda. Clique em <strong>Atualizar lista</strong> para buscar os grupos do número.</>}
              </div>
            )}
            {visiveis.map((g) => (
              <button key={g.jid} type="button" onClick={() => abrir(g.jid)} aria-current={g.jid === grupoJid}
                className="wa-item w-full text-left flex items-center gap-3 px-3 py-2.5">
                <AvatarWa nome={nomeDoGrupo(g)} />
                <span className="flex-1 min-w-0 border-b pb-2.5 -mb-2.5" style={{ borderColor: "var(--wa-line)" }}>
                  <span className="flex items-baseline gap-2">
                    <span className="flex-1 truncate text-[16px]" style={{ color: "var(--wa-txt)" }}>{nomeDoGrupo(g)}</span>
                    <span className="text-[12px] flex-shrink-0" style={{ color: "var(--wa-meta)" }}>{horaDaLista(g.ultima_msg_em)}</span>
                  </span>
                  <span className="block truncate text-[14px]" style={{ color: "var(--wa-meta)" }}>{g.ultima_msg || (g.participantes ? `${g.participantes} participantes` : "")}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>
        <section className={`${grupoJid ? "flex" : "hidden lg:flex"} flex-1 flex-col min-w-0 min-h-0`}>
          {aberto ? <Conversa key={aberto.jid} grupo={aberto} onVoltar={() => abrir(null)} onMudou={carregar} />
            : (
              <div className="flex-1 flex items-center justify-center px-8 text-center wa-cab">
                <p className="text-[14px] max-w-sm" style={{ color: "var(--wa-meta)" }}>
                  Escolha um grupo à esquerda. Por aqui só passam <strong>grupos</strong> — conversas com pessoas continuam em Conversas.
                </p>
              </div>
            )}
        </section>
      </div>
    </div>
  );
}

function Conversa({ grupo, onVoltar, onMudou }: { grupo: Grupo; onVoltar: () => void; onMudou: () => void }) {
  const [msgs, setMsgs] = useState<MensagemGrupo[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [foto, setFoto] = useState<number | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const ultimoId = useRef<string | null>(null);

  const carregar = useCallback(async () => {
    try { setMsgs(await mensagensDoGrupo(grupo.jid)); } catch { /* mantém */ }
  }, [grupo.jid]);
  useEffect(() => { void carregar(); }, [carregar]);
  useRepetir(carregar, 5000);

  // Desce até o fim quando chega mensagem nova.
  useEffect(() => {
    const ult = msgs[msgs.length - 1]?.id ?? null;
    if (ult && ult !== ultimoId.current) fimRef.current?.scrollIntoView({ block: "end" });
    ultimoId.current = ult;
  }, [msgs]);

  const fotos = useMemo(() => msgs
    .filter((m) => m.anexo_url && (m.tipo === "imagem"))
    .map((m) => ({ url: m.anexo_url!, legenda: m.texto, quando: m.criado_em, de: m.de_mim ? "Você" : autorDe(m) })), [msgs]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true); setErro(null);
    try {
      await enviarNoGrupo(grupo.jid, t);
      setTexto("");
      await carregar();
      onMudou();
    } catch (e) { setErro((e as Error).message); }
    setEnviando(false);
  };

  let diaAnterior = "";
  return (
    <>
      <header className="wa-cab flex items-center gap-3 px-3 py-2.5 border-b" style={{ borderColor: "var(--wa-line)" }}>
        <button type="button" className="lg:hidden wa-icone p-2" onClick={onVoltar} aria-label="Voltar para a lista">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <AvatarWa nome={nomeDoGrupo(grupo)} tamanho={40} />
        <div className="min-w-0">
          <p className="truncate text-[16px]" style={{ color: "var(--wa-txt)" }}>{nomeDoGrupo(grupo)}</p>
          <p className="text-[13px]" style={{ color: "var(--wa-meta)" }}>{grupo.participantes ? `${grupo.participantes} participantes` : "Grupo"}</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto min-h-0 wa-fundo px-3 sm:px-[6%] py-3">
        {msgs.length === 0 && (
          <p className="text-center mt-8"><span className="wa-chip inline-block px-3 py-1.5 rounded-lg text-[12.5px]">
            As mensagens aparecem aqui a partir de quando a ligação dos grupos foi feita.
          </span></p>
        )}
        {msgs.map((m) => {
          const dia = new Date(m.criado_em).toDateString();
          const novoDia = dia !== diaAnterior;
          diaAnterior = dia;
          const anexo: Anexo | null = m.anexo_url ? { type: TIPO_ANEXO[m.tipo] || "file", url: m.anexo_url, nome: m.anexo_nome || undefined } : null;
          const lado = m.de_mim ? "wa-out" : "wa-in";
          return (
            <div key={m.id}>
              {novoDia && <p className="text-center my-3"><span className="wa-chip inline-block px-3 py-1 rounded-lg text-[12.5px]">{rotuloDoDia(m.criado_em)}</span></p>}
              <div className={`flex mb-1.5 ${m.de_mim ? "justify-end" : "justify-start"}`}>
                <div className={`wa-bolha wa-rabo ${lado}`}>
                  {!m.de_mim && <p className="text-[12.8px] font-medium mb-0.5" style={{ color: corDoNome(autorDe(m)) }}>{autorDe(m)}</p>}
                  {anexo && (
                    <MidiaDaMensagem a={anexo} texto={m.texto} minha={m.de_mim} nome={autorDe(m)}
                      onAbrirFoto={(url) => setFoto(Math.max(0, fotos.findIndex((f) => f.url === url)))}
                      hora={hora(m.criado_em)} />
                  )}
                  {m.texto && <TextoWa texto={m.texto} />}
                  <span className="wa-hora">{hora(m.criado_em)}</span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={fimRef} />
      </div>

      <footer className="wa-cab px-3 py-2.5">
        {erro && <p className="text-[12.5px] mb-1.5" style={{ color: "var(--red)" }}>{erro}</p>}
        <div className="flex items-end gap-2">
          <textarea className="wa-campo flex-1 px-3 py-2.5 text-[15px] resize-none max-h-40" rows={1} placeholder="Mensagem para o grupo"
            value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Mensagem para o grupo"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }} />
          <button type="button" className="wa-verde rounded-full w-11 h-11 flex items-center justify-center flex-shrink-0 disabled:opacity-60"
            onClick={() => void enviar()} disabled={enviando || !texto.trim()} aria-label="Enviar no grupo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
          </button>
        </div>
        <p className="text-[11.5px] mt-1" style={{ color: "var(--wa-meta)" }}>Sai assinado com o seu nome, como nas conversas.</p>
      </footer>

      {foto !== null && fotos.length > 0 && (
        <Visualizador fotos={fotos} indice={foto} onFechar={() => setFoto(null)} onTrocar={setFoto} />
      )}
    </>
  );
}
