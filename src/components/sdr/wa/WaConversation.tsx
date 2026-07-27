// src/components/sdr/wa/WaConversation.tsx
// -----------------------------------------------------------------------------
// A conversa de WhatsApp de UM lead, renderizada pelo próprio QS.
//
// Lê as mensagens direto do Supabase (a RLS de 0024 garante que só aparecem as
// dos leads deste SDR) e escuta o realtime pra mensagem nova cair na tela sem F5.
// Ao abrir, dispara um sync com o Chatwoot pra trazer o histórico anterior ao
// webhook — por isso a primeira abertura de um lead antigo demora um instante.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  listMessages, markThreadRead, sendWaMessage, subscribeToMessages, syncThread,
  type WaMessage,
} from "@/lib/qs/waInbox";
import { formatPhoneDisplay } from "@/lib/whatsapp";

const GREEN = "#12A18A";

interface Props {
  leadId: string;
  leadName?: string | null;
  phone?: string | null;
  /** Mostrado quando o lead é de outro SDR / sem permissão (não deve acontecer). */
  onBack?: () => void;
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

export default function WaConversation({ leadId, leadName, phone }: Props) {
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [semConversa, setSemConversa] = useState(false);

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

  // Carga inicial + backfill do histórico.
  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setErro(null);
    setSemConversa(false);
    stickToBottom.current = true;

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
  }, [leadId, recarregar]);

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
    if (!r.ok) {
      setErro(r.error || "Não consegui enviar.");
      return;
    }
    setText("");
    setSemConversa(false);
    stickToBottom.current = true;
    // O realtime normalmente já traz; recarregar cobre o caso de ele atrasar.
    await recarregar();
  }, [text, sending, leadId, recarregar]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  };

  let ultimoDia = "";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Mensagens */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3"
        style={{ background: "var(--bg)" }}
      >
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
                  <div
                    className="max-w-[82%] rounded-2xl px-3 py-2 shadow-sm"
                    style={{
                      background: meu ? "#DCF8C6" : "var(--card)",
                      border: meu ? "none" : "1px solid var(--line)",
                      borderBottomRightRadius: meu ? 6 : undefined,
                      borderBottomLeftRadius: meu ? undefined : 6,
                    }}
                  >
                    {m.attachments?.map((a, i) => (
                      <a key={i} href={a.url} target="_blank" rel="noreferrer"
                         className="block mb-1 text-[11.5px] font-bold underline"
                         style={{ color: "#0E7C6A" }}>
                        {a.type === "image" ? "📷 imagem" : a.type === "audio" ? "🎤 áudio" : "📎 anexo"}
                      </a>
                    ))}
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
          <p className="text-center text-[10.5px] py-2" style={{ color: "var(--ink3)" }}>
            buscando histórico…
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Erro de envio */}
      {erro && (
        <div className="px-3 py-1.5 text-[11.5px] font-bold" style={{ background: "#FDECEC", color: "#B4242A" }}>
          {erro}
        </div>
      )}

      {/* Escrever */}
      <div className="shrink-0 border-t p-2" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={`Mensagem para ${leadName || formatPhoneDisplay(phone) || "o lead"}…`}
            className="flex-1 resize-none rounded-2xl px-3 py-2 text-[13px] outline-none max-h-28"
            style={{ border: "1px solid var(--line)", background: "var(--card2)", color: "var(--ink)" }}
          />
          <button
            onClick={enviar}
            disabled={!text.trim() || sending}
            title="Enviar (Enter)"
            className="shrink-0 h-9 px-4 rounded-full text-white text-[12.5px] font-bold transition-opacity disabled:opacity-40"
            style={{ background: GREEN }}
          >
            {sending ? "…" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}
