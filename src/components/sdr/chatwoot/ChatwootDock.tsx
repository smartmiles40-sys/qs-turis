// src/components/sdr/chatwoot/ChatwootDock.tsx
// -----------------------------------------------------------------------------
// Cockpit de atendimento NOVO: o painel do Chatwoot self-hosted EMBEDADO num
// iframe dentro do QS (substitui o ChatAppDock, que só abria janela externa).
//
// Por que agora dá pra embedar (e o ChatApp não dava): o Chatwoot é nosso, então
// (1) liberamos o frame via CSP frame-ancestors (middleware Traefik `cw-embed`) e
// (2) o QS roda no mesmo domínio-pai (qs.* e chat.* = same-site), então o cookie
// de sessão SameSite=Lax gruda dentro do iframe. Provado no spike 2026-07-23.
//
// O iframe é montado UMA vez e nunca desmonta (só encolhe pra width:0 quando
// fechado) → a sessão do Chatwoot sobrevive à sessão inteira do QS. Ao abrir um
// lead, o dock tenta achar a conversa dele pelo telefone (deep-link) e navega o
// iframe direto pra ela; se não achar, fica no inbox (o telefone já vai copiado).
// -----------------------------------------------------------------------------

import { useState, useRef, useEffect, useCallback } from "react";
import { useChatAppDock } from "@/contexts/ChatAppDockContext";
import { formatPhoneDisplay } from "@/lib/whatsapp";
import {
  chatwootInboxUrl,
  chatwootConversationUrl,
  lookupChatwootConversation,
  getChatwootUrl,
} from "@/lib/qs/chatProvider";

const WA_GREEN = "#12A18A";
const PANEL_W = 440; // chat precisa de mais largura que o launcher antigo (320)

function IconChat({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z" />
    </svg>
  );
}
function IconClose({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function IconCopy({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function IconExternal({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

export default function ChatwootDock() {
  const { isOpen, target, copiedPhone, open, close, recopyPhone } = useChatAppDock();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // src inicial = inbox; muda pra conversa do lead quando o deep-link resolve.
  const [iframeSrc, setIframeSrc] = useState<string>(() => chatwootInboxUrl());
  // "resolvendo…" enquanto busca a conversa do lead pelo telefone.
  const [resolving, setResolving] = useState(false);
  // Aviso quando o lead não tem conversa ainda (some sozinho).
  const [noConversation, setNoConversation] = useState(false);
  // Evita reprocessar o MESMO lead (o efeito reage a target.leadId).
  const lastLeadRef = useRef<string | null>(null);

  // Deep-link: ao mirar um lead novo, acha a conversa dele e navega o iframe.
  useEffect(() => {
    const leadKey = target?.leadId ?? (target?.phone ? `phone:${target.phone}` : null);
    if (!leadKey || leadKey === lastLeadRef.current) return;
    lastLeadRef.current = leadKey;
    setNoConversation(false);

    let cancelled = false;
    (async () => {
      if (!target?.phone) return; // sem telefone não dá pra deep-linkar
      setResolving(true);
      const { conversationId } = await lookupChatwootConversation(target.phone);
      if (cancelled) return;
      setResolving(false);
      if (conversationId != null) {
        setIframeSrc(chatwootConversationUrl(conversationId));
      } else {
        // Sem conversa: fica no inbox e avisa (telefone já foi copiado no contexto).
        setNoConversation(true);
      }
    })();
    return () => { cancelled = true; };
  }, [target?.leadId, target?.phone]);

  const openInWindow = useCallback(() => {
    const w = window.open(iframeSrc || getChatwootUrl(), "chatwoot_window");
    w?.focus();
  }, [iframeSrc]);

  return (
    <>
      {/* ── FAB — some quando o painel está aberto ──────────────────────────── */}
      {!isOpen && (
        <button
          onClick={open}
          title="Abrir atendimento (WhatsApp)"
          aria-label="Abrir atendimento"
          className="fixed z-[45] right-4 sm:right-6 flex items-center gap-2 h-12 pl-3.5 pr-4 rounded-full text-white font-bold text-[13px] shadow-lg transition-transform hover:scale-105"
          style={{ background: WA_GREEN, boxShadow: "0 10px 24px -8px rgba(18,161,138,.7)", bottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
        >
          <IconChat size={20} />
          WhatsApp
        </button>
      )}

      {/* ── PAINEL lateral com o Chatwoot embedado ──────────────────────────── */}
      <aside
        className={`qs-chatdock shrink-0 h-full overflow-hidden flex flex-col bg-white ${isOpen ? "qs-chatdock-open" : ""}`}
        style={{
          width: isOpen ? PANEL_W : 0,
          transition: "width .28s cubic-bezier(.4,0,.2,1)",
          borderLeft: isOpen ? "1px solid var(--line)" : "none",
        }}
        aria-hidden={!isOpen}
      >
        <style>{`
          @media (max-width: 767px) {
            .qs-chatdock { position: fixed; inset: 0; z-index: 80; width: 0 !important; border-left: none !important; }
            .qs-chatdock:not(.qs-chatdock-open) { pointer-events: none; }
            .qs-chatdock-open { width: 100vw !important; }
          }
        `}</style>

        {/* Cabeçalho */}
        <div className="shrink-0 flex items-center gap-3 px-4 h-14 text-white" style={{ background: WA_GREEN, minWidth: PANEL_W }}>
          <IconChat size={20} />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold leading-tight">Atendimento</p>
            <p className="text-[10.5px] opacity-90 leading-tight truncate">
              {target?.name ? `Conversa: ${target.name}` : "WhatsApp dos leads (Chatwoot)"}
            </p>
          </div>
          <button onClick={openInWindow} title="Abrir em janela" className="p-1.5 rounded-lg hover:bg-white/15 transition-colors" aria-label="Abrir em janela">
            <IconExternal size={15} />
          </button>
          <button onClick={close} title="Fechar" className="p-1.5 rounded-lg hover:bg-white/15 transition-colors" aria-label="Fechar">
            <IconClose size={18} />
          </button>
        </div>

        {/* Faixa de contexto do lead (telefone copiado / estado do deep-link) */}
        {target && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 text-[11.5px] border-b" style={{ borderColor: "var(--line, #E8EBF0)", background: "#F7FBFA", minWidth: PANEL_W }}>
            <span className="font-bold truncate" style={{ color: "var(--ink, #17202E)" }}>{target.name || "Lead"}</span>
            {target.phone && (
              <button onClick={recopyPhone} className="flex items-center gap-1 font-bold hover:underline shrink-0" style={{ color: "#0E7C6A" }} title="Copiar o telefone">
                {formatPhoneDisplay(target.phone)}<IconCopy size={12} />
              </button>
            )}
            <span className="ml-auto shrink-0" style={{ color: "var(--ink3, #8B95A4)" }}>
              {resolving ? "abrindo conversa…"
                : noConversation ? (copiedPhone ? "sem conversa — busque pelo nº copiado" : "sem conversa ainda")
                : ""}
            </span>
          </div>
        )}

        {/* Chatwoot embedado — montado 1x, persistente (só muda o src no deep-link) */}
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          title="Chatwoot"
          className="flex-1 w-full border-0"
          style={{ minWidth: PANEL_W }}
          allow="microphone; camera; clipboard-write; clipboard-read; autoplay"
        />
      </aside>
    </>
  );
}
