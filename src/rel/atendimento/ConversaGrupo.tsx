// src/rel/atendimento/ConversaGrupo.tsx
// -----------------------------------------------------------------------------
// CONVERSA DE GRUPO "IGUAL AO WHATSAPP" (0144, 16/10/2026). Bruno: "conseguir
// fazer as mesmas coisas que no WhatsApp da Meta". Pela Evolution o grupo tem:
//   • emoji e figurinhas (mesmo painel das conversas)
//   • responder citando, reagir, copiar (botão direito / toque longo)
//   • marcar pessoas com @ (lista de participantes ao digitar "@")
//   • foto (com o editor), vídeo e documento · áudio gravado (voz)
//   • editar (até 15 min) e apagar pra todos as mensagens do número
//   • negrito/itálico/tachado pelos atalhos (Ctrl+B, Ctrl+I, Ctrl+Shift+X)
// Fixar mensagem não existe nesta versão da Evolution.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent } from "react";
import { AvatarWa, MidiaDaMensagem, TextoWa, Visualizador, corDoNome, rotuloDoDia } from "./waUi";
import { limiteArquivoMB, salvarFigurinha, salvarTranscricao, type Anexo } from "../lib/whatsapp";
import {
  apagarNoGrupo, editarNoGrupo, enviarFigurinhaNoGrupo, enviarMidiaNoGrupo, enviarNoGrupo, enviarVozNoGrupo, mensagensDoGrupo,
  participantesDoGrupo, reagirNoGrupo, type Grupo, type MensagemGrupo, type Participante,
} from "../lib/grupos";
import PainelExpressoes from "./PainelExpressoes";
import MenuContexto, { ICO, posicaoDoEvento, type ItemMenu, type PosicaoMenu } from "./MenuContexto";
import { envolver, marcaDoEvento } from "./atalhos";
import EditorFoto from "./EditorFoto";

const REACOES = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const TIPO_ANEXO: Record<string, Anexo["type"]> = { imagem: "image", figurinha: "image", video: "video", audio: "audio", arquivo: "file" };
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const nomeDoGrupo = (g: Grupo) => g.nome?.trim() || "Grupo sem nome";
const ASSINATURA = /^\*[^*\n]{1,80}:\*\n/;

function useRepetir(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) ref.current(); }, ms);
    return () => clearInterval(t);
  }, [ms]);
}

export default function ConversaGrupo({ grupo, onVoltar, onMudou }: { grupo: Grupo; onVoltar: () => void; onMudou: () => void }) {
  const [msgs, setMsgs] = useState<MensagemGrupo[]>([]);
  const [part, setPart] = useState<Participante[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [foto, setFoto] = useState<number | null>(null);
  const [respondendo, setRespondendo] = useState<MensagemGrupo | null>(null);
  const [editandoMsg, setEditandoMsg] = useState<MensagemGrupo | null>(null);
  const [expressoes, setExpressoes] = useState<"emoji" | "figurinha" | null>(null);
  const [menuMsg, setMenuMsg] = useState<{ m: MensagemGrupo; pos: PosicaoMenu } | null>(null);
  const [anexoMenu, setAnexoMenu] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [legenda, setLegenda] = useState("");
  const [editandoFoto, setEditandoFoto] = useState(false);
  const [previa, setPrevia] = useState<string | null>(null);
  // @menções escolhidas na lista: o texto mostra "@Nome", o envio troca por "@telefone"
  const [mencoes, setMencoes] = useState<{ rotulo: string; tel: string }[]>([]);
  const [busca, setBusca] = useState<string | null>(null);
  const [busIdx, setBusIdx] = useState(0);
  const [gravando, setGravando] = useState<{ ini: number; rec: MediaRecorder } | null>(null);
  const [agora, setAgora] = useState(Date.now());
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const midiaRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const ultimoId = useRef<string | null>(null);
  const partes = useRef<Blob[]>([]);
  const descartar = useRef(false);

  const carregar = useCallback(async () => {
    try { setMsgs(await mensagensDoGrupo(grupo.jid)); } catch { /* mantém */ }
  }, [grupo.jid]);
  useEffect(() => { void carregar(); }, [carregar]);
  useRepetir(carregar, 5000);
  useEffect(() => { participantesDoGrupo(grupo.jid).then(setPart).catch(() => setPart([])); }, [grupo.jid]);
  useEffect(() => {
    const ult = msgs[msgs.length - 1]?.id ?? null;
    if (ult && ult !== ultimoId.current) fimRef.current?.scrollIntoView({ block: "end" });
    ultimoId.current = ult;
  }, [msgs]);
  useEffect(() => { if (!arquivo) { setPrevia(null); return; } const u = URL.createObjectURL(arquivo); setPrevia(u); return () => URL.revokeObjectURL(u); }, [arquivo]);
  useEffect(() => { if (!gravando) return; const t = setInterval(() => setAgora(Date.now()), 250); return () => clearInterval(t); }, [gravando]);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 2500); return () => clearTimeout(t); }, [aviso]);

  // nome de quem escreveu: ficha/participante > nome do WhatsApp > telefone
  const nomePorTel = useMemo(() => new Map(part.map((p) => [p.telefone, p.nome])), [part]);
  const autorDe = useCallback((m: Pick<MensagemGrupo, "autor_jid" | "autor_nome">) => {
    const tel = String(m.autor_jid || "").split("@")[0];
    return m.autor_nome || nomePorTel.get(tel) || (tel ? `+${tel}` : "Participante");
  }, [nomePorTel]);
  const autorCitado = (j: string | null | undefined) => (j === "eu" ? "Você" : j ? autorDe({ autor_jid: j, autor_nome: null }) : "");
  /** "@5511…" vira "@Nome" na tela. */
  const comNomes = useCallback((t: string) => t.replace(/@(\d{10,15})/g, (x, d) => (nomePorTel.get(d) ? `*@${nomePorTel.get(d)}*` : x)), [nomePorTel]);

  const fotos = useMemo(() => msgs.filter((m) => m.anexo_url && m.tipo === "imagem" && !m.apagada_em)
    .map((m) => ({ url: m.anexo_url!, legenda: m.texto, quando: m.criado_em, de: m.de_mim ? "Você" : autorDe(m) })), [msgs, autorDe]);
  const porMsgId = useMemo(() => new Map(msgs.map((m) => [m.msg_id, m])), [msgs]);

  async function acao(fn: () => Promise<unknown>, ok?: string) {
    setErro(null);
    try { await fn(); if (ok) setAviso(ok); await carregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }

  // ── enviar texto (com citação, @, edição) ──
  async function enviar() {
    let t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true); setErro(null);
    try {
      if (editandoMsg) {
        await editarNoGrupo(editandoMsg.id, t);
        setEditandoMsg(null);
      } else {
        const tels: string[] = [];
        for (const mm of mencoes) if (t.includes(mm.rotulo)) { t = t.split(mm.rotulo).join(`@${mm.tel}`); tels.push(mm.tel); }
        await enviarNoGrupo(grupo.jid, t, { respondendoA: respondendo?.id, mencoes: tels });
        setRespondendo(null);
      }
      setTexto(""); setMencoes([]); setBusca(null);
      await carregar(); onMudou();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não enviou."); }
    setEnviando(false);
  }

  // ── @ menções ──
  const sugestoes = useMemo(() => {
    if (busca === null) return [];
    const q = busca.toLowerCase();
    return part.filter((p) => !q || p.nome.toLowerCase().includes(q) || p.telefone.includes(q)).slice(0, 8);
  }, [busca, part]);
  function aoDigitar(v: string) {
    setTexto(v);
    const el = campoRef.current;
    const ate = v.slice(0, el?.selectionStart ?? v.length);
    const m = ate.match(/(?:^|\s)@([^\s@]{0,30})$/);
    setBusca(m ? m[1] : null); setBusIdx(0);
  }
  function marcar(p: Participante) {
    const el = campoRef.current;
    const pos = el?.selectionStart ?? texto.length;
    const antes = texto.slice(0, pos).replace(/@([^\s@]{0,30})$/, "");
    const rotulo = `@${p.nome.split(" ").slice(0, 2).join(" ")}`;
    const novo = `${antes}${rotulo} ${texto.slice(pos)}`;
    setTexto(novo); setMencoes((l) => [...l.filter((x) => x.rotulo !== rotulo), { rotulo, tel: p.telefone }]); setBusca(null);
    requestAnimationFrame(() => { el?.focus(); const c = (antes + rotulo + " ").length; el?.setSelectionRange(c, c); });
  }

  function aoTeclar(e: RKeyboardEvent<HTMLTextAreaElement>) {
    if (sugestoes.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setBusIdx((i) => (i + 1) % sugestoes.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setBusIdx((i) => (i - 1 + sugestoes.length) % sugestoes.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); marcar(sugestoes[busIdx]); return; }
      if (e.key === "Escape") { e.preventDefault(); setBusca(null); return; }
    }
    const marca = marcaDoEvento(e);
    if (marca && campoRef.current) {
      e.preventDefault();
      const r = envolver(campoRef.current, texto, marca);
      setTexto(r.texto);
      requestAnimationFrame(() => campoRef.current?.setSelectionRange(r.ini, r.fim));
      return;
    }
    if (e.key === "Escape" && (respondendo || editandoMsg)) { setRespondendo(null); setEditandoMsg(null); if (editandoMsg) setTexto(""); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); }
  }

  // ── anexos ──
  function escolher(f: File | undefined, ref: HTMLInputElement | null) {
    if (ref) ref.value = "";
    setAnexoMenu(false);
    if (!f) return;
    const limite = limiteArquivoMB(f.type);
    if (f.size > limite * 1024 * 1024) { setErro(`Arquivo maior que ${limite} MB.`); return; }
    setErro(null); setArquivo(f); setLegenda(texto.trim());
    if (/^image\/(jpeg|png|webp)$/.test(f.type)) setEditandoFoto(true);
  }
  async function enviarArquivo() {
    if (!arquivo || enviando) return;
    setEnviando(true); setErro(null);
    try { await enviarMidiaNoGrupo(grupo.jid, arquivo, legenda.trim()); setArquivo(null); setLegenda(""); setTexto(""); await carregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não enviou."); }
    setEnviando(false);
  }

  // ── áudio gravado (voz) ──
  async function gravar() {
    setErro(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tipo = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      partes.current = []; descartar.current = false;
      rec.ondataavailable = (ev) => { if (ev.data.size) partes.current.push(ev.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(null);
        if (descartar.current) return;
        const blob = new Blob(partes.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 1500) { setErro("Áudio curto demais."); return; }
        setEnviando(true);
        try { await enviarVozNoGrupo(grupo.jid, blob); await carregar(); onMudou(); }
        catch (e) { setErro(e instanceof Error ? e.message : "Áudio não enviado."); }
        setEnviando(false);
      };
      rec.start(250);
      setGravando({ ini: Date.now(), rec }); setAgora(Date.now());
    } catch { setErro("Não consegui usar o microfone. Libere o acesso no navegador."); }
  }
  const pararGravacao = (enviarAudio: boolean) => { if (!gravando) return; descartar.current = !enviarAudio; gravando.rec.stop(); };

  // ── menu da mensagem ──
  function itensDaMensagem(m: MensagemGrupo): ItemMenu[] {
    const itens: ItemMenu[] = [];
    if (m.apagada_em) return [{ rotulo: "Mensagem apagada", desligado: true, onClick: () => {} }];
    const minha = (m.reacoes || []).find((r) => r.de === "eu")?.emoji ?? null;
    itens.push({ tipo: "reacoes", emojis: REACOES, atual: minha, onEscolher: (e) => void acao(() => reagirNoGrupo(m.id, e === minha ? "" : e)) });
    itens.push({ rotulo: "Responder", icone: ICO.responder, onClick: () => { setEditandoMsg(null); setRespondendo(m); campoRef.current?.focus(); } });
    if (m.texto) itens.push({ rotulo: "Copiar", icone: ICO.copiar, onClick: () => { void navigator.clipboard?.writeText(m.texto.replace(ASSINATURA, "")).then(() => setAviso("Mensagem copiada.")); } });
    if (!m.de_mim && m.autor_jid) {
      const tel = String(m.autor_jid).split("@")[0];
      if (/^\d{10,15}$/.test(tel)) itens.push({ rotulo: `Marcar ${autorDe(m).split(" ")[0]} com @`, icone: ICO.responder, onClick: () => marcar({ telefone: tel, nome: autorDe(m), admin: null }) });
    }
    if (m.tipo === "figurinha" && m.anexo_url) itens.push({ rotulo: "Salvar nas figurinhas do time", icone: ICO.figurinha, onClick: () => void salvarFigurinha({ url: m.anexo_url! }).then(() => setAviso("Figurinha salva.")).catch((e) => setErro(e instanceof Error ? e.message : "Não salvou.")) });
    if (m.de_mim) {
      itens.push({ tipo: "separador" });
      const podeEditar = m.tipo === "texto" && Date.now() - new Date(m.criado_em).getTime() < 15 * 60_000;
      if (podeEditar) itens.push({ rotulo: "Editar", icone: ICO.nota, onClick: () => { setRespondendo(null); setEditandoMsg(m); setTexto(m.texto.replace(ASSINATURA, "")); campoRef.current?.focus(); } });
      itens.push({ rotulo: "Apagar para todos", icone: ICO.resolver, perigo: true, onClick: () => { if (window.confirm("Apagar esta mensagem para todos no grupo?")) void acao(() => apagarNoGrupo(m.id), "Mensagem apagada."); } });
    }
    return itens;
  }

  let diaAnterior = "";
  const segundos = gravando ? Math.floor((agora - gravando.ini) / 1000) : 0;
  return (
    <>
      <header className="wa-cab flex items-center gap-3 px-3 py-2.5 border-b" style={{ borderColor: "var(--wa-line)" }}>
        <button type="button" className="lg:hidden wa-icone p-2" onClick={onVoltar} aria-label="Voltar para a lista">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <AvatarWa nome={nomeDoGrupo(grupo)} tamanho={40} />
        <div className="min-w-0">
          <p className="truncate text-[16px]" style={{ color: "var(--wa-txt)" }}>{nomeDoGrupo(grupo)}</p>
          <p className="text-[13px] truncate" style={{ color: "var(--wa-meta)" }}>
            {part.length ? part.slice(0, 6).map((p) => p.nome.split(" ")[0]).join(", ") + (part.length > 6 ? ` e mais ${part.length - 6}` : "") : grupo.participantes ? `${grupo.participantes} participantes` : "Grupo"}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto min-h-0 wa-fundo px-3 sm:px-[6%] py-3" onClick={() => setAnexoMenu(false)}>
        {msgs.length === 0 && (
          <p className="text-center mt-8"><span className="wa-chip inline-block px-3 py-1.5 rounded-lg text-[12.5px]">As mensagens aparecem aqui a partir de quando a ligação dos grupos foi feita.</span></p>
        )}
        {msgs.map((m) => {
          const dia = new Date(m.criado_em).toDateString();
          const novoDia = dia !== diaAnterior;
          diaAnterior = dia;
          const anexo: Anexo | null = m.anexo_url && !m.apagada_em ? { type: TIPO_ANEXO[m.tipo] || "file", url: m.anexo_url, nome: m.anexo_nome || undefined } : null;
          const lado = m.de_mim ? "wa-out" : "wa-in";
          const citada = m.responde_a ? porMsgId.get(m.responde_a) : null;
          const reacoes = (m.reacoes || []).filter((r) => r.emoji);
          const abrirMenu = (e: React.MouseEvent) => { e.preventDefault(); setMenuMsg({ m, pos: posicaoDoEvento(e) }); };
          return (
            <div key={m.id}>
              {novoDia && <p className="text-center my-3"><span className="wa-chip inline-block px-3 py-1 rounded-lg text-[12.5px]">{rotuloDoDia(m.criado_em)}</span></p>}
              <div className={`group flex mb-1.5 ${m.de_mim ? "justify-end" : "justify-start"} ${reacoes.length ? "pb-3" : ""}`}>
                <div className={`wa-bolha wa-rabo ${lado} relative`} onContextMenu={abrirMenu}>
                  <button type="button" onClick={abrirMenu} aria-label="Opções da mensagem"
                    className="absolute top-1 right-1 w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex items-center justify-center" style={{ background: "var(--wa-chip)", color: "var(--wa-meta)" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
                  </button>
                  {!m.de_mim && <p className="text-[12.8px] font-medium mb-0.5" style={{ color: corDoNome(autorDe(m)) }}>{autorDe(m)}</p>}
                  {m.apagada_em ? (
                    <p className="italic text-[13.5px] pr-12" style={{ color: "var(--wa-meta)" }}>🚫 {m.de_mim ? "Você apagou esta mensagem" : "Esta mensagem foi apagada"}</p>
                  ) : (
                    <>
                      {(m.responde_a || m.citado_texto) && (
                        <div className="rounded-md px-2 py-1 mb-1 text-[12.5px]" style={{ background: "rgba(127,127,127,.12)", borderLeft: `4px solid ${corDoNome(autorCitado(citada ? (citada.de_mim ? "eu" : citada.autor_jid) : m.citado_autor))}` }}>
                          <span className="block font-semibold" style={{ color: corDoNome(autorCitado(citada ? (citada.de_mim ? "eu" : citada.autor_jid) : m.citado_autor)) }}>
                            {autorCitado(citada ? (citada.de_mim ? "eu" : citada.autor_jid) : m.citado_autor) || "Mensagem"}
                          </span>
                          <span className="block line-clamp-2" style={{ color: "var(--wa-meta)" }}>{(citada?.texto || m.citado_texto || "").replace(ASSINATURA, "") || "📎 mídia"}</span>
                        </div>
                      )}
                      {anexo && (
                        <MidiaDaMensagem a={anexo} texto={m.texto} minha={m.de_mim} nome={autorDe(m)}
                          onAbrirFoto={(url) => setFoto(Math.max(0, fotos.findIndex((f) => f.url === url)))}
                          hora={hora(m.criado_em)} transcricao={m.transcricao} onTranscrito={(t) => void salvarTranscricao("grupo", m.id, t)} />
                      )}
                      {m.texto && <TextoWa texto={comNomes(m.texto)} />}
                    </>
                  )}
                  <span className="wa-hora">{m.editada_em && !m.apagada_em ? "editada · " : ""}{hora(m.criado_em)}</span>
                  {reacoes.length > 0 && (
                    <span className="absolute -bottom-3 left-2 wa-chip rounded-full px-1.5 py-0.5 text-[13px] flex items-center gap-0.5" title={reacoes.map((r) => `${r.emoji} ${r.de === "eu" ? "Você" : r.nome || autorCitado(r.de)}`).join("\n")}>
                      {[...new Set(reacoes.map((r) => r.emoji))].slice(0, 3).join("")}{reacoes.length > 1 && <span className="text-[11px] ml-0.5" style={{ color: "var(--wa-meta)" }}>{reacoes.length}</span>}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={fimRef} />
      </div>

      <footer className="wa-cab px-3 py-2.5 relative">
        {erro && <p className="text-[12.5px] mb-1.5" style={{ color: "var(--red)" }}>{erro}</p>}
        {aviso && <p className="text-[12.5px] mb-1.5" style={{ color: "var(--wa-green-ink)" }}>{aviso}</p>}

        {arquivo ? (
          <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--wa-list)" }}>
            <div className="flex items-center gap-3">
              {previa && arquivo.type.startsWith("image/") && (
                <button type="button" onClick={() => setEditandoFoto(true)} className="relative flex-shrink-0 rounded-lg overflow-hidden" aria-label="Editar foto">
                  <img src={previa} alt="Prévia" className="w-20 h-20 object-cover" />
                  <span className="absolute inset-x-0 bottom-0 text-[10.5px] font-semibold py-0.5 text-center" style={{ background: "rgba(0,0,0,.55)", color: "#fff" }}>✏️ editar</span>
                </button>
              )}
              {previa && arquivo.type.startsWith("video/") && <video src={previa} className="w-28 h-20 rounded-lg object-cover bg-black" muted />}
              {!arquivo.type.startsWith("image/") && !arquivo.type.startsWith("video/") && <span className="w-14 h-16 rounded-md flex items-center justify-center text-[22px]" style={{ background: "var(--wa-head)" }} aria-hidden>📄</span>}
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[14px] font-semibold" style={{ color: "var(--wa-txt)" }}>{arquivo.name}</span>
                <span className="block text-[12px]" style={{ color: "var(--wa-meta)" }}>{(arquivo.size / 1024 / 1024).toFixed(2)} MB</span>
              </span>
              <button onClick={() => setArquivo(null)} className="wa-icone w-9 h-9 inline-flex items-center justify-center" aria-label="Cancelar anexo">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="flex items-end gap-2">
              <input value={legenda} onChange={(e) => setLegenda(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void enviarArquivo(); } }}
                placeholder="Adicione uma legenda…" aria-label="Legenda" className="wa-campo flex-1 h-10 px-3 text-[14px]" style={{ background: "var(--wa-head)" }} autoFocus />
              <button onClick={() => void enviarArquivo()} disabled={enviando} aria-label="Enviar anexo no grupo" className="w-11 h-11 rounded-full inline-flex items-center justify-center wa-verde flex-shrink-0 disabled:opacity-60">
                {enviando ? "…" : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>}
              </button>
            </div>
          </div>
        ) : gravando ? (
          <div className="flex items-center gap-3 h-11">
            <button onClick={() => pararGravacao(false)} className="wa-icone w-11 h-11 inline-flex items-center justify-center" aria-label="Descartar áudio">🗑</button>
            <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: "#DC2626" }} aria-hidden />
            <span className="flex-1 tabular-nums text-[15px]" style={{ color: "var(--wa-txt)" }}>{Math.floor(segundos / 60)}:{String(segundos % 60).padStart(2, "0")} gravando…</span>
            <button onClick={() => pararGravacao(true)} className="wa-verde rounded-full w-11 h-11 inline-flex items-center justify-center" aria-label="Enviar áudio">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
            </button>
          </div>
        ) : (
          <>
            {expressoes && (
              <div className="mb-2">
                <PainelExpressoes aba={expressoes} onAba={setExpressoes}
                  onEmoji={(e) => { const el = campoRef.current; const p = el?.selectionStart ?? texto.length; setTexto(texto.slice(0, p) + e + texto.slice(p)); requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(p + e.length, p + e.length); }); }}
                  onFigurinha={(f) => { setExpressoes(null); void acao(() => enviarFigurinhaNoGrupo(grupo.jid, f.id)); }} />
              </div>
            )}
            {(respondendo || editandoMsg) && (
              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 mb-2" style={{ background: "var(--wa-list)" }}>
                <div className="flex-1 min-w-0 rounded-md px-2 py-1" style={{ borderLeft: "4px solid var(--wa-green)", background: "rgba(127,127,127,.08)" }}>
                  <span className="block text-[12.5px] font-semibold" style={{ color: "var(--wa-green-ink)" }}>{editandoMsg ? "Editando mensagem" : `Respondendo a ${respondendo!.de_mim ? "Você" : autorDe(respondendo!)}`}</span>
                  <span className="block text-[13px] truncate" style={{ color: "var(--wa-meta)" }}>{((editandoMsg || respondendo)!.texto || "📎 mídia").replace(ASSINATURA, "")}</span>
                </div>
                <button onClick={() => { setRespondendo(null); if (editandoMsg) { setEditandoMsg(null); setTexto(""); } }} className="wa-icone w-8 h-8 inline-flex items-center justify-center" aria-label="Cancelar">✕</button>
              </div>
            )}
            {sugestoes.length > 0 && (
              <ul className="wa-lista rounded-xl overflow-hidden mb-2 max-h-64 overflow-y-auto shadow-lg" role="listbox" aria-label="Marcar participante">
                {sugestoes.map((p, i) => (
                  <li key={p.telefone}>
                    <button onMouseDown={(e) => { e.preventDefault(); marcar(p); }} className="wa-item w-full text-left flex items-center gap-2.5 px-3 py-2" aria-selected={i === busIdx} style={i === busIdx ? { background: "var(--wa-sel)" } : undefined}>
                      <AvatarWa nome={p.nome} tamanho={32} />
                      <span className="flex-1 min-w-0 truncate text-[14px]" style={{ color: "var(--wa-txt)" }}>{p.nome}</span>
                      {p.admin && <span className="text-[11px]" style={{ color: "var(--wa-meta)" }}>admin</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-end gap-1.5">
              <button type="button" onClick={() => setExpressoes((x) => (x ? null : "emoji"))} className="wa-icone w-11 h-11 inline-flex items-center justify-center flex-shrink-0" aria-label="Emoji e figurinhas" aria-pressed={!!expressoes}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><circle cx="9" cy="9.5" r="1" fill="currentColor" /><circle cx="15" cy="9.5" r="1" fill="currentColor" /></svg>
              </button>
              <div className="relative">
                <button type="button" onClick={(e) => { e.stopPropagation(); setAnexoMenu((x) => !x); }} className="wa-icone w-11 h-11 inline-flex items-center justify-center flex-shrink-0" aria-label="Anexar" aria-expanded={anexoMenu}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                </button>
                {anexoMenu && (
                  <div className="absolute bottom-12 left-0 wa-lista rounded-xl shadow-xl py-1.5 w-52 z-20">
                    <button onClick={() => midiaRef.current?.click()} className="wa-item w-full text-left px-4 py-2.5 text-[14px] flex items-center gap-3" style={{ color: "var(--wa-txt)" }}><span aria-hidden>🖼️</span>Fotos e vídeos</button>
                    <button onClick={() => docRef.current?.click()} className="wa-item w-full text-left px-4 py-2.5 text-[14px] flex items-center gap-3" style={{ color: "var(--wa-txt)" }}><span aria-hidden>📄</span>Documento</button>
                  </div>
                )}
                <input ref={midiaRef} type="file" hidden accept="image/jpeg,image/png,image/webp,video/mp4" onChange={(e) => escolher(e.target.files?.[0], midiaRef.current)} />
                <input ref={docRef} type="file" hidden accept="application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,audio/mpeg,audio/ogg,audio/mp4" onChange={(e) => escolher(e.target.files?.[0], docRef.current)} />
              </div>
              <textarea ref={campoRef} className="wa-campo wa-emoji flex-1 px-3 py-2.5 text-[15px] resize-none max-h-40 min-h-[44px]" rows={1}
                placeholder={editandoMsg ? "Edite a mensagem" : "Mensagem para o grupo (@ marca alguém)"} value={texto}
                onChange={(e) => aoDigitar(e.target.value)} onKeyDown={aoTeclar} aria-label="Mensagem para o grupo"
                onPaste={(e) => { const f = e.clipboardData.files?.[0]; if (f) { e.preventDefault(); escolher(f, null); } }} />
              {texto.trim() ? (
                <button type="button" className="wa-verde rounded-full w-11 h-11 flex items-center justify-center flex-shrink-0 disabled:opacity-60"
                  onClick={() => void enviar()} disabled={enviando} aria-label={editandoMsg ? "Salvar edição" : "Enviar no grupo"}>
                  {editandoMsg ? "✓" : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>}
                </button>
              ) : (
                <button type="button" className="wa-icone w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0" onClick={() => void gravar()} disabled={enviando} aria-label="Gravar áudio">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="19" x2="12" y2="22" /></svg>
                </button>
              )}
            </div>
            <p className="text-[11.5px] mt-1" style={{ color: "var(--wa-meta)" }}>Sai assinado com o seu nome · Ctrl+B negrito · Ctrl+I itálico · botão direito na mensagem: reagir, responder, editar, apagar</p>
          </>
        )}
        {editandoFoto && arquivo && <EditorFoto arquivo={arquivo} onCancelar={() => setEditandoFoto(false)} onPronto={(f) => { setEditandoFoto(false); setArquivo(f); }} />}
      </footer>

      <MenuContexto pos={menuMsg?.pos ?? null} itens={menuMsg ? itensDaMensagem(menuMsg.m) : []} onFechar={() => setMenuMsg(null)} rotulo="Opções da mensagem" />
      {foto !== null && fotos.length > 0 && <Visualizador fotos={fotos} indice={Math.min(foto, fotos.length - 1)} onFechar={() => setFoto(null)} onTrocar={setFoto} />}
    </>
  );
}
