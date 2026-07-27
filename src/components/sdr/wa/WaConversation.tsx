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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  listMessages, markThreadRead, sendWaMessage, sendWaMedia, subscribeToMessages, syncThread,
  listCanned, preencherCanned, comprimirImagem, downloadHistory,
  type WaMessage, type CannedResponse,
} from "@/lib/qs/waInbox";
import { formatPhoneDisplay } from "@/lib/whatsapp";

const GREEN = "#12A18A";

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
      <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full"
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

function Anexo({ a }: { a: { type: string; url: string } }) {
  if (a.type === "image") {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="block mb-1">
        <img src={a.url} alt="imagem" className="rounded-lg max-h-56 w-auto" loading="lazy" />
      </a>
    );
  }
  if (a.type === "audio") {
    return <audio src={a.url} controls preload="none" className="mb-1 w-full max-w-[240px]" />;
  }
  if (a.type === "video") {
    return <video src={a.url} controls preload="none" className="mb-1 rounded-lg max-h-56" />;
  }
  return (
    <a href={a.url} target="_blank" rel="noreferrer"
       className="block mb-1 text-[11.5px] font-bold underline" style={{ color: "#0E7C6A" }}>
      📎 abrir anexo
    </a>
  );
}

export default function WaConversation({ leadId, leadName, phone, initialText }: Props) {
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [semConversa, setSemConversa] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Respostas prontas (/atalho)
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [mostrarCanned, setMostrarCanned] = useState(false);

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

  // Carga inicial + sincronização com o Chatwoot.
  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setErro(null);
    setAviso(null);
    setSemConversa(false);
    stickToBottom.current = true;
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
    setSemConversa(false);
    stickToBottom.current = true;
    await recarregar();
  }, [text, sending, leadId, recarregar]);

  const enviarMidia = useCallback(async (blob: Blob, nome: string, legenda = "") => {
    setSending(true);
    setErro(null);
    const r = await sendWaMedia(leadId, blob, nome, legenda);
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const preferidos = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
      const mime = preferidos.find((t) => MediaRecorder.isTypeSupported?.(t));
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

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
        const tipo = (mr.mimeType || "audio/webm").split(";")[0];
        const blob = new Blob(chunksRef.current, { type: tipo });
        if (blob.size < 1200 || dur < 1) { setErro("Áudio muito curto."); return; }
        const ext = tipo.includes("ogg") ? "ogg" : tipo.includes("mp4") ? "m4a" : "webm";
        await enviarMidia(blob, `audio-${Date.now()}.${ext}`);
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

  const aplicarCanned = useCallback((c: CannedResponse) => {
    setText(preencherCanned(c.texto, { nome: leadName }));
    setMostrarCanned(false);
  }, [leadName]);

  const aoDigitar = (v: string) => {
    setText(v);
    setMostrarCanned(v.startsWith("/") && canned.length > 0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && mostrarCanned) { setMostrarCanned(false); return; }
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
          <div className="text-center mb-2">
            <button onClick={baixarTudo}
                    className="text-[10.5px] font-bold px-2.5 py-1 rounded-full"
                    style={{ background: "var(--card2)", color: "var(--ink3)", border: "1px solid var(--line)" }}>
              Baixar histórico completo
            </button>
          </div>
        )}

        {loading ? (
          <p className="text-center text-[12px] py-6" style={{ color: "var(--ink3)" }}>carregando conversa…</p>
        ) : messages.length === 0 ? (
          <div className="text-center py-8 px-4">
            <p className="text-[12.5px] font-bold" style={{ color: "var(--ink2)" }}>
              {semConversa ? "Nenhuma conversa ainda" : "Sem mensagens"}
            </p>
            <p className="text-[11.5px] mt-1" style={{ color: "var(--ink3)" }}>
              {semConversa
                ? "Mande a primeira mensagem aqui embaixo — ela abre a conversa no WhatsApp."
                : "As mensagens aparecem aqui assim que chegarem."}
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const dia = diaLabel(m.sent_at);
            const mostraDia = dia !== ultimoDia;
            ultimoDia = dia;
            const meu = m.direction === "out";
            return (
              <div key={m.id}>
                {mostraDia && <DiaSeparador label={dia} />}
                <div className={`flex mb-1.5 ${meu ? "justify-end" : "justify-start"}`}>
                  <div className="max-w-[82%] rounded-2xl px-3 py-2 shadow-sm"
                       style={{
                         background: meu ? "#DCF8C6" : "var(--card)",
                         border: meu ? "none" : "1px solid var(--line)",
                         borderBottomRightRadius: meu ? 6 : undefined,
                         borderBottomLeftRadius: meu ? undefined : 6,
                       }}>
                    {m.attachments?.map((a, i) => <Anexo key={i} a={a} />)}
                    {m.content && (
                      <p className="text-[13px] whitespace-pre-wrap break-words" style={{ color: "#17202E" }}>
                        {m.content}
                      </p>
                    )}
                    <p className="text-[10px] mt-0.5 text-right" style={{ color: "#7A8593" }}>
                      {hora(m.sent_at)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {syncing && (
          <p className="text-center text-[10.5px] py-2" style={{ color: "var(--ink3)" }}>buscando histórico…</p>
        )}
        <div ref={bottomRef} />
      </div>

      {aviso && (
        <div className="px-3 py-1.5 text-[11.5px] font-bold" style={{ background: "#E1F5F0", color: "#0E7C6A" }}>
          {aviso}
        </div>
      )}
      {erro && (
        <div className="px-3 py-1.5 text-[11.5px] font-bold" style={{ background: "#FDECEC", color: "#B4242A" }}>
          {erro}
        </div>
      )}

      {/* Respostas prontas */}
      {mostrarCanned && cannedFiltradas.length > 0 && (
        <div className="shrink-0 border-t max-h-40 overflow-y-auto"
             style={{ borderColor: "var(--line)", background: "var(--card)" }}>
          {cannedFiltradas.map((c) => (
            <button key={c.atalho} onClick={() => aplicarCanned(c)}
                    className="w-full text-left px-3 py-2 border-b hover:opacity-80 transition-opacity"
                    style={{ borderColor: "var(--line2)" }}>
              <span className="text-[11.5px] font-bold" style={{ color: "#0E7C6A" }}>/{c.atalho}</span>
              <span className="block text-[11px] truncate" style={{ color: "var(--ink3)" }}>{c.texto}</span>
            </button>
          ))}
        </div>
      )}

      {/* Escrever */}
      <div className="shrink-0 border-t p-2" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        {gravando ? (
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: "#E5484D" }} />
            <span className="text-[13px] font-bold tabular-nums" style={{ color: "var(--ink)" }}>
              gravando {mmss(segundos)}
            </span>
            <button onClick={() => pararGravacao(true)}
                    className="ml-auto px-3 h-9 rounded-full text-[12.5px] font-bold"
                    style={{ background: "var(--card2)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
              Cancelar
            </button>
            <button onClick={() => pararGravacao(false)}
                    className="px-4 h-9 rounded-full text-white text-[12.5px] font-bold" style={{ background: GREEN }}>
              Enviar
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5">
            <input ref={fileRef} type="file" className="hidden" onChange={escolherArquivo}
                   accept="image/*,audio/*,video/mp4,application/pdf" />
            <button onClick={() => fileRef.current?.click()} disabled={sending}
                    title="Enviar imagem, figurinha ou arquivo" aria-label="Anexar"
                    className="shrink-0 w-9 h-9 grid place-items-center rounded-full disabled:opacity-40"
                    style={{ color: "var(--ink3)" }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.2a3.67 3.67 0 1 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 1 1-2.6-2.6l8.5-8.48" />
              </svg>
            </button>
            <button onClick={iniciarGravacao} disabled={sending}
                    title="Gravar áudio" aria-label="Gravar áudio"
                    className="shrink-0 w-9 h-9 grid place-items-center rounded-full disabled:opacity-40"
                    style={{ color: "var(--ink3)" }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
              </svg>
            </button>
            <textarea
              value={text}
              onChange={(e) => aoDigitar(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={`Mensagem para ${leadName || formatPhoneDisplay(phone) || "o lead"}…  (/ para atalhos)`}
              className="flex-1 resize-none rounded-2xl px-3 py-2 text-[13px] outline-none max-h-28"
              style={{ border: "1px solid var(--line)", background: "var(--card2)", color: "var(--ink)" }}
            />
            <button onClick={enviar} disabled={!text.trim() || sending} title="Enviar (Enter)"
                    className="shrink-0 h-9 px-4 rounded-full text-white text-[12.5px] font-bold transition-opacity disabled:opacity-40"
                    style={{ background: GREEN }}>
              {sending ? "…" : "Enviar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
