// src/components/sdr/chatapp/ChatAppDock.tsx
// -----------------------------------------------------------------------------
// Painel do ChatApp em TELA DIVIDIDA (não sobrepõe a fila): é uma coluna à direita
// que "empurra" a fila para a esquerda, dando visibilidade às duas ao mesmo tempo.
// Largura ajustável (arraste a alça à esquerda). O <iframe> é montado UMA vez e
// nunca desmonta — quando fechado, a coluna encolhe para 0 mas o iframe continua
// carregado e logado (a sessão do ChatApp dura a sessão do QS).
// -----------------------------------------------------------------------------

import { useState, useRef, useCallback, useEffect } from "react";
import { useChatAppDock } from "@/contexts/ChatAppDockContext";
import { getChatAppUrl, fillTemplate, WA_TEMPLATES } from "@/lib/whatsapp";

const WA_GREEN = "#12A18A"; // --green da paleta Turis
const MIN_W = 360;
const MAX_W = 900;
const DEFAULT_W = 620;

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
function IconCopy({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function IconExternal({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}
function IconReload({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

export default function ChatAppDock() {
  const { isOpen, target, copiedPhone, open, close, recopyPhone } = useChatAppDock();
  const chatUrl = getChatAppUrl();

  const [width, setWidth] = useState<number>(() => {
    const saved = Number(typeof localStorage !== "undefined" ? localStorage.getItem("qs_chatdock_w") : 0);
    return saved >= MIN_W && saved <= MAX_W ? saved : DEFAULT_W;
  });
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  // Template copiado por último (feedback "Copiado!" no chip)
  const [copiedTpl, setCopiedTpl] = useState<string | null>(null);

  // iframe + aviso de login (reCAPTCHA não roda embutido — ver banner)
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [helpSeen, setHelpSeen] = useState<boolean>(() => {
    try { return localStorage.getItem("qs_chatdock_help_seen") === "1"; } catch { return false; }
  });
  const reloadIframe = useCallback(() => {
    // Reatribuir o src força o reload (não dá pra tocar no contentWindow: cross-origin).
    if (iframeRef.current) iframeRef.current.src = chatUrl;
  }, [chatUrl]);
  function dismissHelp() {
    setHelpSeen(true);
    try { localStorage.setItem("qs_chatdock_help_seen", "1"); } catch { /* ignore */ }
  }

  async function copyTemplate(label: string, text: string) {
    const filled = fillTemplate(text, { name: target?.name ?? null });
    try {
      await navigator.clipboard.writeText(filled);
      setCopiedTpl(label);
      setTimeout(() => setCopiedTpl(null), 2000);
    } catch { /* clipboard bloqueado — ignora */ }
  }

  const startDrag = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    setDragging(true);
    e.preventDefault();
  }, []);

  useEffect(() => {
    function move(e: PointerEvent) {
      if (!draggingRef.current) return;
      const w = Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - e.clientX));
      setWidth(w);
    }
    function up() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      try { localStorage.setItem("qs_chatdock_w", String(width)); } catch { /* ignore */ }
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [width]);

  function openInWindow() {
    // Reusa sempre a MESMA aba/janela nomeada — clicar de novo foca, não abre nova.
    // (Sem "noopener": ele zera a referência e impede o foco/reuso da janela.)
    const w = window.open(chatUrl, "chatapp_window");
    w?.focus();
  }

  return (
    <>
      {/* ── FAB (botão flutuante) — some quando o dock está aberto ─────────── */}
      {!isOpen && (
        <button
          onClick={open}
          title="Abrir ChatApp"
          aria-label="Abrir ChatApp"
          className="fixed z-[45] bottom-6 right-6 flex items-center gap-2 h-12 pl-3.5 pr-4 rounded-full text-white font-bold text-[13px] shadow-lg transition-transform hover:scale-105"
          style={{ background: WA_GREEN, boxShadow: "0 10px 24px -8px rgba(18,161,138,.7)" }}
        >
          <IconChat size={20} />
          ChatApp
        </button>
      )}

      {/* ── COLUNA DE SPLIT — sempre montada; encolhe pra 0 quando fechada ─── */}
      <aside
        className="shrink-0 h-full overflow-hidden flex bg-white"
        style={{
          width: isOpen ? width : 0,
          transition: dragging ? "none" : "width .28s cubic-bezier(.4,0,.2,1)",
          borderLeft: isOpen ? "1px solid var(--line)" : "none",
        }}
        aria-hidden={!isOpen}
      >
        {/* Alça de redimensionar */}
        <div
          onPointerDown={startDrag}
          title="Arraste para redimensionar"
          className="shrink-0 h-full cursor-col-resize"
          style={{ width: 6, background: dragging ? "rgba(18,161,138,.35)" : "transparent" }}
        />

        <div className="flex-1 min-w-0 flex flex-col">
          {/* Cabeçalho */}
          <div className="shrink-0 flex items-center gap-3 px-4 h-14 text-white" style={{ background: WA_GREEN }}>
            <IconChat size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold leading-tight">ChatApp</p>
              <p className="text-[10.5px] opacity-90 leading-tight truncate">
                {target?.name ? `Conversando com ${target.name}` : "WhatsApp dos leads"}
              </p>
            </div>
            <button onClick={reloadIframe} title="Recarregar o ChatApp (após logar em janela)" className="p-1.5 rounded-lg hover:bg-white/15 transition-colors" aria-label="Recarregar">
              <IconReload size={16} />
            </button>
            <button onClick={openInWindow} title="Abrir em janela separada" className="p-1.5 rounded-lg hover:bg-white/15 transition-colors" aria-label="Abrir em janela">
              <IconExternal size={16} />
            </button>
            <button onClick={close} title="Fechar" className="p-1.5 rounded-lg hover:bg-white/15 transition-colors" aria-label="Fechar">
              <IconClose size={18} />
            </button>
          </div>

          {/* Faixa do número copiado */}
          {copiedPhone && (
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-[#F0FBF8] border-b" style={{ borderColor: "var(--line2)" }}>
              <span className="text-[11px] font-semibold" style={{ color: "#0E7C6A" }}>Número copiado</span>
              <button onClick={recopyPhone} className="flex items-center gap-1.5 text-[12px] font-bold text-[#0E7C6A] hover:underline" title="Copiar de novo">
                {copiedPhone}
                <IconCopy size={13} />
              </button>
              <span className="ml-auto text-[10.5px] text-[#6B7280]">cole na busca · Ctrl+V</span>
            </div>
          )}

          {/* Templates rápidos — copia a mensagem preenchida com o nome do lead */}
          {target && (
            <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b flex-wrap bg-white" style={{ borderColor: "var(--line2)" }}>
              <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "var(--ink3, #8B95A4)" }}>Mensagens</span>
              {WA_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  onClick={() => copyTemplate(t.label, t.text)}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors"
                  style={
                    copiedTpl === t.label
                      ? { background: "#0E7C6A", color: "#fff", borderColor: "#0E7C6A" }
                      : { background: "#fff", color: "#586274", borderColor: "var(--line, #E8EBF0)" }
                  }
                  title={`Copiar: ${fillTemplate(t.text, { name: target.name ?? null })}`}
                >
                  {copiedTpl === t.label ? "Copiado!" : t.label}
                </button>
              ))}
            </div>
          )}

          {/* Aviso de login (reCAPTCHA não roda em iframe cross-origin) */}
          {!helpSeen && (
            <div className="shrink-0 flex items-start gap-2 px-4 py-2.5 border-b" style={{ background: "#FFF7ED", borderColor: "var(--line2)" }}>
              <span className="text-[14px] leading-none mt-0.5">⚠️</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold leading-snug" style={{ color: "#9A3412" }}>
                  O login do ChatApp (reCAPTCHA) não funciona embutido.
                </p>
                <p className="text-[10.5px] leading-snug mt-0.5" style={{ color: "#B45309" }}>
                  1) <button onClick={openInWindow} className="font-bold underline">entre em janela separada</button> ·
                  2) libere <b>cookies de terceiros</b> para <b>chatapp.online</b> ·
                  3) volte e <button onClick={reloadIframe} className="font-bold underline">recarregue aqui</button>.
                </p>
              </div>
              <button onClick={dismissHelp} title="Entendi" aria-label="Dispensar aviso" className="shrink-0 p-0.5 rounded hover:bg-black/5" style={{ color: "#9A3412" }}>
                <IconClose size={14} />
              </button>
            </div>
          )}

          {/* IFRAME persistente — nunca desmonta (só recarrega no botão) */}
          <div className="flex-1 min-h-0 relative bg-[#F5F6F8]">
            <iframe
              ref={iframeRef}
              src={chatUrl}
              title="ChatApp"
              className="absolute inset-0 w-full h-full border-0"
              allow="clipboard-read; clipboard-write; microphone; camera; autoplay"
            />
          </div>

          {/* Rodapé de ajuda / fallback */}
          <div className="shrink-0 px-4 py-2 border-t bg-white" style={{ borderColor: "var(--line2)" }}>
            <p className="text-[10.5px] text-[#8B95A4] leading-snug">
              Pediu login de novo?{" "}
              <button onClick={openInWindow} className="font-semibold text-[#0E7C6A] hover:underline">abra em janela</button>,
              faça login, e{" "}
              <button onClick={reloadIframe} className="font-semibold text-[#0E7C6A] hover:underline">recarregue aqui</button>.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
