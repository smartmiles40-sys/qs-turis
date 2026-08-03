// src/components/sdr/wa/WaConversation.tsx
// -----------------------------------------------------------------------------
// A conversa de WhatsApp de UM lead, renderizada pelo próprio QS.
//
// Lê as mensagens direto do Supabase (a RLS de 0024/0025 garante que só aparecem
// as dos leads deste SDR) e escuta o realtime pra mensagem nova cair na tela sem
// F5. Ao abrir, sincroniza com o Chatwoot pra trazer o histórico recente.
//
// Escrever manda por /api/wa-send; áudio/imagem/arquivo por /api/wa-send-media.
// Nenhum dos dois confia no navegador: o servidor revalida a posse do lead.
// -----------------------------------------------------------------------------

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  listMessages, markThreadRead, sendWaMessage, sendWaMedia, subscribeToMessages, syncThread,
  listCanned, preencherCanned, comprimirImagem, downloadHistory, listWaNumeros, getThreadInbox,
  type WaMessage, type CannedResponse, type WaNumero,
} from "@/lib/qs/waInbox";
import { formatPhoneDisplay } from "@/lib/whatsapp";
import { loadSignatureName } from "@/lib/qs/waSignature";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { WaAudio, WaAvatar } from "./WaBits";
import { WaTexto, tamanhoEmojiSolto } from "./waFormat";

// O seletor carrega junto com a lista de emojis, e só quando a SDR abre pela
// primeira vez — não é peso que todo mundo paga pra ver a conversa.
const WaEmojiPicker = lazy(() => import("./WaEmojiPicker"));


interface Props {
  leadId: string;
  leadName?: string | null;
  phone?: string | null;
  /** Roteiro da atividade da cadência, quando o SDR veio de uma tarefa. */
  initialText?: string | null;
}

function DiaSeparador({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-3">
      <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
            style={{ color: "var(--ink3)", background: "var(--card2)" }}>
        {label}
      </span>
      <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
    </div>
  );
}

function diaLabel(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

function hora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function mmss(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function Anexo({ a, meu }: { a: { type: string; url: string }; meu: boolean }) {
  if (a.type === "image") {
    // minHeight reserva o espaço: sem isso a imagem empurra a conversa ao
    // carregar, e o auto-scroll joga o SDR pra cima justo quando chega foto.
    return (
      <a href={a.url} target="_blank" rel="noreferrer"
         className="block mb-1 rounded-xl overflow-hidden"
         style={{ background: "var(--card2)", minHeight: 120, maxWidth: 240 }}>
        <img src={a.url} alt="Imagem enviada na conversa" loading="lazy" decoding="async"
             className="block w-full h-auto max-h-56 object-cover" />
      </a>
    );
  }
  if (a.type === "audio") return <WaAudio url={a.url} meu={meu} />;
  if (a.type === "video") {
    return <video src={a.url} controls preload="none" className="mb-1 rounded-xl max-h-56" />;
  }
  return (
    <a href={a.url} target="_blank" rel="noreferrer"
       className="inline-flex items-center gap-1.5 mb-1 text-[12px] font-semibold underline"
       style={{ color: meu ? "var(--wa-ink)" : "var(--wa)" }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.2a3.67 3.67 0 1 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 1 1-2.6-2.6l8.5-8.48" />
      </svg>
      Abrir anexo
    </a>
  );
}

export default function WaConversation({ leadId, leadName, phone, initialText }: Props) {
  const { currentUser } = useQsAuth();
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [semConversa, setSemConversa] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // Nome com que este SDR assina. Quem carimba é o /api/wa-send; isto aqui é só
  // pra ele não descobrir depois, olhando a conversa do cliente.
  const [assinatura, setAssinatura] = useState("");

  // Respostas prontas (/atalho)
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [mostrarCanned, setMostrarCanned] = useState(false);

  // Emojis
  const [mostrarEmojis, setMostrarEmojis] = useState(false);
  // Onde estava o cursor no campo de escrever. Precisa ser lembrado por fora
  // porque escolher um emoji NÃO devolve o foco pro textarea — quem clicou em
  // três emojis seguidos, ou buscou "aviao", perderia o lugar a cada clique.
  const caretRef = useRef<number | null>(null);

  // Por qual dos NOSSOS números esta conversa acontece. É informação, não
  // escolha: quem decide é a conversa que já existe no Chatwoot. O SDR precisa
  // saber disso antes de escrever, porque é o número que o cliente vê chegando.
  const [numeros, setNumeros] = useState<WaNumero[]>([]);
  const [inboxAtual, setInboxAtual] = useState<number | null>(null);
  const [avatarLead, setAvatarLead] = useState<string | null>(null);

  // Gravação de áudio
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  // Espelho em ref: o onstop do MediaRecorder é criado uma vez e enxergaria o
  // `segundos` congelado em 0 — todo áudio seria descartado como "muito curto".
  const segundosRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelarRef = useRef(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Só rola sozinho se o SDR já estava no fim — senão atrapalha quem está lendo
  // uma mensagem antiga lá em cima.
  const stickToBottom = useRef(true);

  const recarregar = useCallback(async () => {
    const list = await listMessages(leadId);
    setMessages(list);
    return list;
  }, [leadId]);

  useEffect(() => { listCanned().then(setCanned); }, []);
  useEffect(() => { listWaNumeros().then(setNumeros); }, []);
  useEffect(() => { void loadSignatureName(currentUser).then(setAssinatura); }, [currentUser]);

  // Carga inicial + sincronização com o Chatwoot.
  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setErro(null);
    setAviso(null);
    setSemConversa(false);
    setMostrarEmojis(false);
    stickToBottom.current = true;
    caretRef.current = null;
    setText(initialText || "");

    (async () => {
      const local = await listMessages(leadId);
      if (!vivo) return;
      setMessages(local);
      setLoading(false);

      setSyncing(true);
      const r = await syncThread(leadId);
      if (!vivo) return;
      setSyncing(false);
      if (r.importadas > 0) await recarregar();
      if (!r.conversationId && local.length === 0) setSemConversa(true);
      markThreadRead(leadId);
      // Depois do sync, porque é ele que descobre/grava a caixa da conversa.
      getThreadInbox(leadId).then((m) => {
        if (!vivo) return;
        setInboxAtual(m.inbox);
        setAvatarLead(m.avatar);
      });
    })();

    return () => { vivo = false; };
  }, [leadId, recarregar, initialText]);

  // Realtime: mensagem nova (dos dois lados) entra sem recarregar.
  useEffect(() => {
    const off = subscribeToMessages(leadId, (nova) => {
      setMessages((prev) => (prev.some((m) => m.id === nova.id) ? prev : [...prev, nova]));
      markThreadRead(leadId);
    });
    return off;
  }, [leadId]);

  useLayoutEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // Cresce com o texto. Zera a altura antes de medir, senão o campo só aumenta
  // e nunca volta ao encolher.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  }, [text]);

  // Solta o microfone se o componente sumir no meio de uma gravação.
  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const enviar = useCallback(async () => {
    const corpo = text.trim();
    if (!corpo || sending) return;
    setSending(true);
    setErro(null);
    const r = await sendWaMessage(leadId, corpo);
    setSending(false);
    if (!r.ok) { setErro(r.error || "Não consegui enviar."); return; }
    setText("");
    setMostrarCanned(false);
    setMostrarEmojis(false);
    caretRef.current = null;
    setSemConversa(false);
    stickToBottom.current = true;
    await recarregar();
  }, [text, sending, leadId, recarregar]);

  const enviarMidia = useCallback(async (blob: Blob, nome: string, legenda = "", notaDeVoz = false) => {
    setSending(true);
    setErro(null);
    const r = await sendWaMedia(leadId, blob, nome, legenda, notaDeVoz);
    setSending(false);
    if (!r.ok) { setErro(r.error || "Não consegui enviar o arquivo."); return; }
    setSemConversa(false);
    stickToBottom.current = true;
    await recarregar();
  }, [leadId, recarregar]);

  const escolherArquivo = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";              // permite escolher o mesmo arquivo de novo
    if (!f) return;
    const blob = await comprimirImagem(f);
    const nome = blob === f ? f.name : f.name.replace(/\.[^.]+$/, "") + ".jpg";
    await enviarMidia(blob, nome, text.trim());
    setText("");
  }, [enviarMidia, text]);

  // ── Áudio ──────────────────────────────────────────────────────────────────
  const pararGravacao = useCallback((cancelar: boolean) => {
    cancelarRef.current = cancelar;
    recorderRef.current?.stop();
  }, []);

  const iniciarGravacao = useCallback(async () => {
    setErro(null);
    try {
      // Mono não é capricho: nota de voz em estéreo é causa clássica de áudio
      // que chega e não toca no WhatsApp.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      // OGG primeiro: é o formato que o WhatsApp entende como nota de voz. Só o
      // Firefox grava OGG nativo; Chrome/Edge/Safari caem no WebM, e aí quem
      // converte é o ffmpeg da Evolution (por isso a extensão certa importa —
      // ver nomeComExtensaoCerta em api/wa-send-media.js).
      const preferidos = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mime = preferidos.find((t) => MediaRecorder.isTypeSupported?.(t));
      const mr = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 32000,   // voz mono: 3 min ≈ 720 KB, longe do teto de 3 MB
      });

      chunksRef.current = [];
      cancelarRef.current = false;
      mr.ondataavailable = (ev) => { if (ev.data?.size) chunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        if (timerRef.current) window.clearInterval(timerRef.current);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setGravando(false);
        const dur = segundosRef.current;
        setSegundos(0);
        segundosRef.current = 0;
        if (cancelarRef.current) return;
        // Alguns navegadores reportam "video/webm" num stream que só tem áudio;
        // normaliza pra não ser recusado como tipo inválido no servidor.
        let tipo = (mr.mimeType || "audio/webm").split(";")[0].trim();
        if (tipo === "video/webm") tipo = "audio/webm";

        const blob = new Blob(chunksRef.current, { type: tipo });
        if (blob.size < 1200 || dur < 1) { setErro("Áudio muito curto."); return; }

        // ".weba" (e não ".webm") é o que faz a Evolution tratar como ÁUDIO e
        // converter pra nota de voz. O servidor reforça isso de qualquer jeito.
        const ext = tipo.includes("ogg") ? "ogg" : tipo.includes("mp4") ? "m4a" : "weba";
        await enviarMidia(blob, `audio-${Date.now()}.${ext}`, "", true);
      };

      recorderRef.current = mr;
      mr.start();
      setGravando(true);
      setSegundos(0);
      segundosRef.current = 0;
      timerRef.current = window.setInterval(() => {
        segundosRef.current += 1;
        setSegundos(segundosRef.current);
        if (segundosRef.current >= 180) pararGravacao(false);   // teto de 3 min
      }, 1000);
    } catch {
      setErro("Não consegui acessar o microfone. Autorize o acesso no navegador.");
    }
  }, [enviarMidia, pararGravacao]);

  // ── Respostas prontas ─────────────────────────────────────────────────────
  const cannedFiltradas = useMemo(() => {
    if (!mostrarCanned) return [];
    const q = text.startsWith("/") ? text.slice(1).toLowerCase().trim() : "";
    return canned.filter((c) => !q || c.atalho.toLowerCase().includes(q)).slice(0, 6);
  }, [canned, text, mostrarCanned]);

  // Qual dos nossos números atende esta conversa. Sem conversa ainda, mostra por
  // onde ela VAI sair (o padrão do servidor) — é a mesma pergunta do SDR.
  const numeroDaConversa = useMemo(() => {
    if (!numeros.length) return null;
    if (inboxAtual != null) {
      return numeros.find((n) => n.id === inboxAtual) ?? null;
    }
    return numeros.find((n) => n.padrao) ?? (numeros.length === 1 ? numeros[0] : null);
  }, [numeros, inboxAtual]);

  const aplicarCanned = useCallback((c: CannedResponse) => {
    setText(preencherCanned(c.texto, { nome: leadName }));
    setMostrarCanned(false);
    caretRef.current = null;   // o texto trocou inteiro; o cursor velho não vale mais
  }, [leadName]);

  // ── Emojis ────────────────────────────────────────────────────────────────
  // Entra ONDE O CURSOR ESTÁ, não no fim: emoji quase sempre é no meio da frase
  // ("bom dia 👋, tudo bem?"). Se o campo estiver focado, o cursor volta pra
  // depois do emoji — senão o navegador o jogaria pro fim do texto.
  const inserirEmoji = useCallback((emoji: string) => {
    const el = taRef.current;
    const focado = !!el && document.activeElement === el;
    const ini = Math.min(focado ? el.selectionStart ?? text.length : caretRef.current ?? text.length, text.length);
    const fim = Math.min(focado ? el.selectionEnd ?? ini : ini, text.length);
    const depois = ini + emoji.length;
    caretRef.current = depois;
    setText(text.slice(0, ini) + emoji + text.slice(Math.max(ini, fim)));
    if (focado) requestAnimationFrame(() => el.setSelectionRange(depois, depois));
  }, [text]);

  // Os dois painéis dividem o mesmo espaço acima do campo; abrir um fecha o outro.
  const alternarEmojis = useCallback(() => {
    setMostrarEmojis((v) => !v);
    setMostrarCanned(false);
  }, []);

  const marcarCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    caretRef.current = e.currentTarget.selectionStart;
  };

  const aoDigitar = (v: string) => {
    setText(v);
    const abreCanned = v.startsWith("/") && canned.length > 0;
    setMostrarCanned(abreCanned);
    if (abreCanned) setMostrarEmojis(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && mostrarCanned) { setMostrarCanned(false); return; }
    if (e.key === "Escape" && mostrarEmojis) { setMostrarEmojis(false); return; }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (mostrarCanned && cannedFiltradas.length === 1) { aplicarCanned(cannedFiltradas[0]); return; }
      enviar();
    }
  };

  const baixarTudo = useCallback(async () => {
    setAviso("baixando histórico…");
    const r = await downloadHistory(leadId);
    if (r.error) { setAviso(null); setErro(r.error); return; }
    await recarregar();
    setAviso(r.importadas > 0
      ? `${r.importadas} mensagem${r.importadas > 1 ? "ns" : ""} trazida${r.importadas > 1 ? "s" : ""} do histórico.`
      : "Nada novo no histórico.");
    window.setTimeout(() => setAviso(null), 4000);
  }, [leadId, recarregar]);

  let ultimoDia = "";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Mensagens */}
      <div ref={scrollRef} onScroll={onScroll}
           className="flex-1 min-h-0 overflow-y-auto px-3 py-3" style={{ background: "var(--bg)" }}>
        {/* Trazer tudo que já foi conversado com este cliente */}
        {!loading && (
          <div className="text-center mb-3">
            <button onClick={baixarTudo}
                    className="wa-chip text-[11px] font-semibold px-3 py-1.5 rounded-lg"
                    style={{ background: "transparent", color: "var(--ink3)", border: "1px solid var(--line)" }}>
              Baixar histórico completo
            </button>
          </div>
        )}

        {loading ? (
          // Esqueleto no formato das bolhas: carregar mostra a FORMA do
          // conteúdo, não a palavra "carregando".
          <div className="space-y-2 pt-2">
            {[62, 44, 70, 38].map((w, i) => (
              <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
                <span className="wa-sk rounded-2xl" style={{ width: `${w}%`, height: i % 2 ? 34 : 48 }} />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-10 px-6">
            <p className="text-[14px] font-semibold" style={{ color: "var(--ink2)" }}>
              {semConversa ? "Nenhuma conversa ainda" : "Sem mensagens"}
            </p>
            <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: "var(--ink3)" }}>
              {semConversa
                ? "Mande a primeira mensagem aqui embaixo — ela abre a conversa no WhatsApp."
                : "As mensagens aparecem aqui assim que chegarem."}
            </p>
          </div>
        ) : (
          messages.map((m, i) => {
            const dia = diaLabel(m.sent_at);
            const mostraDia = dia !== ultimoDia;
            ultimoDia = dia;
            const meu = m.direction === "out";

            // Agrupamento: mensagens seguidas do mesmo lado, dentro de 5 min,
            // formam um bloco. É o que faz parecer conversa em vez de lista de
            // itens — só a ÚLTIMA do bloco tem rabinho, hora e avatar.
            // Mensagem que é só emoji sai da bolha e cresce, como no celular.
            const emojiPx = !m.attachments?.length && m.content ? tamanhoEmojiSolto(m.content) : null;

            const prox = messages[i + 1];
            const fimDoBloco =
              !prox ||
              prox.direction !== m.direction ||
              diaLabel(prox.sent_at) !== dia ||
              Math.abs(+new Date(prox.sent_at) - +new Date(m.sent_at)) > 5 * 60_000;

            return (
              <div key={m.id}>
                {mostraDia && <DiaSeparador label={dia} />}
                <div className={`flex items-end gap-2 ${meu ? "justify-end" : "justify-start"} ${fimDoBloco ? "mb-3" : "mb-[3px]"}`}>
                  {!meu && (
                    fimDoBloco
                      ? <WaAvatar nome={leadName || "Lead"} url={avatarLead} size={26} />
                      : <span className="w-[26px] shrink-0" />   /* alinha o bloco */
                  )}
                  <div className={emojiPx ? "max-w-[78%] px-1 py-0.5" : "max-w-[78%] px-3 py-2"}
                       style={emojiPx ? { color: "var(--ink)" } : {
                         background: meu ? "var(--wa-soft)" : "var(--card)",
                         color: meu ? "var(--wa-ink)" : "var(--ink)",
                         border: meu ? "none" : "1px solid var(--line)",
                         borderRadius: 16,
                         borderBottomRightRadius: meu && fimDoBloco ? 5 : 16,
                         borderBottomLeftRadius: !meu && fimDoBloco ? 5 : 16,
                       }}>
                    {m.attachments?.map((a, k) => <Anexo key={k} a={a} meu={meu} />)}
                    {m.content && (
                      <p className="whitespace-pre-wrap break-words"
                         style={emojiPx
                           ? { fontSize: emojiPx, lineHeight: 1.15 }
                           : { fontSize: 14, lineHeight: 1.45 }}>
                        {/* Com a formatação do WhatsApp aplicada: o SDR vê a
                            mensagem como ela chega no celular do cliente — a
                            assinatura em negrito, e não `*Victor Hugo*` cru. */}
                        <WaTexto texto={m.content} />
                      </p>
                    )}
                    {fimDoBloco && (
                      <p className="text-[11px] mt-1 text-right tabular-nums"
                         style={emojiPx
                           ? { color: "var(--ink3)" }
                           : { color: meu ? "var(--wa-ink)" : "var(--ink3)", opacity: meu ? .65 : 1 }}>
                        {hora(m.sent_at)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        {syncing && (
          <p className="text-center text-[11px] py-2" style={{ color: "var(--ink3)" }}>Buscando histórico…</p>
        )}
        <div ref={bottomRef} />
      </div>

      {aviso && (
        <div className="px-3 py-1.5 text-[11.5px] font-bold" style={{ background: "var(--wa-ok-bg)", color: "var(--wa)" }}>
          {aviso}
        </div>
      )}
      {erro && (
        <div className="px-3 py-2 text-[12px] font-semibold" style={{ background: "var(--wa-err-bg)", color: "var(--wa-err-ink)" }}>
          {erro}
        </div>
      )}

      {/* Respostas prontas */}
      {mostrarCanned && cannedFiltradas.length > 0 && (
        <div className="shrink-0 border-t max-h-40 overflow-y-auto"
             style={{ borderColor: "var(--line)", background: "var(--card)" }}>
          {cannedFiltradas.map((c) => (
            <button key={c.atalho} onClick={() => aplicarCanned(c)}
                    className="wa-row wa-row-btn w-full text-left px-3 py-2">
              <span className="text-[12px] font-semibold" style={{ color: "var(--wa)" }}>/{c.atalho}</span>
              <span className="block text-[12px] truncate mt-0.5" style={{ color: "var(--ink3)" }}>{c.texto}</span>
            </button>
          ))}
        </div>
      )}

      {/* Emojis. Fica gravando de fora: durante uma nota de voz o campo de
          escrever nem existe, e o painel ficaria pendurado sem dono. */}
      {mostrarEmojis && !gravando && (
        <Suspense fallback={
          <div className="shrink-0 border-t" style={{ borderColor: "var(--line)", background: "var(--card)", height: 248 }}>
            <div className="grid gap-1.5 p-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(34px, 1fr))" }}>
              {Array.from({ length: 24 }, (_, i) => <span key={i} className="wa-sk rounded-lg" style={{ height: 34 }} />)}
            </div>
          </div>
        }>
          <WaEmojiPicker onPick={inserirEmoji} onClose={() => setMostrarEmojis(false)} />
        </Suspense>
      )}

      {/* De qual WhatsApp esta conversa é — informação, não escolha.
          O cliente vê a mensagem chegando DESTE número; o SDR precisa saber
          disso antes de escrever, e não pode trocar sem querer. */}
      {numeroDaConversa && !gravando && (
        <div className="shrink-0 flex items-center gap-1.5 px-3 pt-2" style={{ background: "var(--card)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" style={{ color: "var(--ink3)" }}>
            <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z" />
          </svg>
          <span className="text-[11px] min-w-0 truncate" style={{ color: "var(--ink3)" }}>
            {inboxAtual == null ? "Vai sair pelo " : "Conversa pelo "}
            <b style={{ color: "var(--ink2)" }}>{numeroDaConversa.nome}</b>
          </span>
          <span
            className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold"
            style={numeroDaConversa.tipo === "api"
              ? { background: "var(--wa-ok-bg)", color: "var(--wa-ok-ink)" }
              : { background: "var(--card2)", color: "var(--ink3)", border: "1px solid var(--line)" }}
            title={numeroDaConversa.tipo === "api" ? "Número oficial (API da Meta)" : "WhatsApp normal"}
          >
            {numeroDaConversa.tipo === "api" ? "API oficial" : "normal"}
          </span>
          {/* Como o cliente vai ver quem está falando. O carimbo é feito no
              servidor no momento do envio — aqui é só o SDR saber de antemão. */}
          {assinatura && (
            <span className="shrink-0 text-[11px] truncate" style={{ color: "var(--ink3)" }}>
              · assina como <b style={{ color: "var(--ink2)" }}>{assinatura}</b>
            </span>
          )}
        </div>
      )}

      {/* Escrever */}
      <div className="wa-composer shrink-0 border-t px-3 py-2.5" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        {gravando ? (
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: "var(--red)" }} />
            <span className="text-[14px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
              Gravando {mmss(segundos)}
            </span>
            <button onClick={() => pararGravacao(true)}
                    className="wa-chip ml-auto px-3 h-9 rounded-lg text-[13px] font-semibold"
                    style={{ background: "transparent", color: "var(--ink2)", border: "1px solid var(--line)" }}>
              Cancelar
            </button>
            <button onClick={() => pararGravacao(false)}
                    className="wa-send px-4 h-9 rounded-lg text-white text-[13px] font-semibold">
              Enviar
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5">
            <input ref={fileRef} type="file" className="hidden" onChange={escolherArquivo}
                   accept="image/*,audio/*,video/mp4,application/pdf" />
            <button onClick={alternarEmojis} disabled={sending}
                    data-wa-emoji-toggle
                    aria-expanded={mostrarEmojis} aria-label="Emojis"
                    title="Emojis" data-aberto={mostrarEmojis || undefined}
                    className="wa-icon-btn wa-emoji-toggle shrink-0 w-9 h-9 grid place-items-center rounded-lg">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <circle cx="12" cy="12" r="9.25" />
                <path d="M8.6 14.2a4.3 4.3 0 0 0 6.8 0" />
                <path d="M9.2 9.4h.01M14.8 9.4h.01" strokeWidth="2.4" />
              </svg>
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={sending}
                    title="Enviar imagem, figurinha ou arquivo" aria-label="Anexar"
                    className="wa-icon-btn shrink-0 w-9 h-9 grid place-items-center rounded-lg">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.2a3.67 3.67 0 1 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 1 1-2.6-2.6l8.5-8.48" />
              </svg>
            </button>
            <button onClick={iniciarGravacao} disabled={sending}
                    title="Gravar áudio" aria-label="Gravar áudio"
                    className="wa-icon-btn shrink-0 w-9 h-9 grid place-items-center rounded-lg">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
              </svg>
            </button>
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => aoDigitar(e.target.value)}
              onKeyDown={onKeyDown}
              onSelect={marcarCaret}
              rows={1}
              placeholder={`Mensagem para ${leadName || formatPhoneDisplay(phone) || "o lead"}…  (/ para atalhos)`}
              className="flex-1 min-w-0 resize-none rounded-xl px-3 py-2 text-[14px] leading-[1.45] outline-none"
              style={{ border: "1px solid var(--line)", background: "var(--card2)", color: "var(--ink)", maxHeight: 128 }}
            />
            {/* Com o dock estreito a palavra "Enviar" some e sobra o ícone —
                ver .wa-composer no index.css. */}
            <button onClick={enviar} disabled={!text.trim() || sending} title="Enviar (Enter)" aria-label="Enviar"
                    className="wa-send wa-send-btn shrink-0 h-9 rounded-xl text-white text-[13px] font-semibold grid place-items-center">
              {sending
                ? <span className="w-4 h-4 rounded-full animate-spin"
                        style={{ border: "2px solid rgba(255,255,255,.35)", borderTopColor: "#fff" }}
                        aria-label="enviando" />
                : (
                  <>
                    <span className="wa-send-label">Enviar</span>
                    <svg className="wa-send-icone" width="17" height="17" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.5 12 3 4.5l3 7.5-3 7.5z" /><path d="M6 12h15.5" />
                    </svg>
                  </>
                )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
