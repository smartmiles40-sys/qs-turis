// src/components/sdr/chatapp/ChatAppDock.tsx
// -----------------------------------------------------------------------------
// LANÇADOR do ChatApp (cockpit de conversa) — painel lateral estreito com tudo
// que o SDR precisa pra atender no WhatsApp: telefone do lead copiado, templates
// de mensagem preenchidos e o botão que abre/foca a JANELA do ChatApp.
//
// Por que não é mais um iframe: o cookie de sessão do ChatApp é SameSite=Lax e
// o login usa reCAPTCHA — NUNCA autentica dentro de iframe de outro domínio
// (limitação do navegador, não nossa). Em janela própria (first-party) o login
// funciona normal e a sessão dura. O botão reusa sempre a MESMA janela nomeada.
// -----------------------------------------------------------------------------

import { useState } from "react";
import { useChatAppDock } from "@/contexts/ChatAppDockContext";
import { getChatAppUrl, fillTemplate, WA_TEMPLATES, formatPhoneDisplay } from "@/lib/whatsapp";
import { notifyError } from "@/lib/qs/notify";

const WA_GREEN = "#12A18A"; // --green da paleta Turis
const PANEL_W = 320;

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
function IconExternal({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

export default function ChatAppDock() {
  const { isOpen, target, copiedPhone, open, close, recopyPhone } = useChatAppDock();
  const chatUrl = getChatAppUrl();

  // Template copiado por último (feedback "Copiado!" no chip)
  const [copiedTpl, setCopiedTpl] = useState<string | null>(null);

  async function copyTemplate(label: string, text: string) {
    const filled = fillTemplate(text, { name: target?.name ?? null });
    try {
      await navigator.clipboard.writeText(filled);
      setCopiedTpl(label);
      setTimeout(() => setCopiedTpl(null), 2000);
    } catch {
      // Clipboard bloqueado pelo navegador — sem feedback o toque parece quebrado.
      notifyError("Não consegui copiar — selecione e copie o texto manualmente.");
    }
  }

  function openChatWindow() {
    // Sempre a MESMA janela nomeada: clicar de novo foca em vez de abrir outra.
    const w = window.open(chatUrl, "chatapp_window");
    w?.focus();
  }

  return (
    <>
      {/* ── FAB (botão flutuante) — some quando o painel está aberto ────────── */}
      {!isOpen && (
        <button
          onClick={open}
          title="Abrir ChatApp"
          aria-label="Abrir ChatApp"
          className="fixed z-[45] right-4 sm:right-6 flex items-center gap-2 h-12 pl-3.5 pr-4 rounded-full text-white font-bold text-[13px] shadow-lg transition-transform hover:scale-105"
          style={{ background: WA_GREEN, boxShadow: "0 10px 24px -8px rgba(18,161,138,.7)", bottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
        >
          <IconChat size={20} />
          ChatApp
        </button>
      )}

      {/* ── PAINEL lateral (cockpit) — encolhe pra 0 quando fechado.
          No CELULAR vira overlay em tela cheia: como coluna de 320px ele
          esmagava o conteúdo principal para ~40px e o app ficava inutilizável. */}
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
            <p className="text-[13px] font-bold leading-tight">ChatApp</p>
            <p className="text-[10.5px] opacity-90 leading-tight truncate">
              {target?.name ? `Atendendo ${target.name}` : "WhatsApp dos leads"}
            </p>
          </div>
          <button onClick={close} title="Fechar" className="p-1.5 rounded-lg hover:bg-white/15 transition-colors" aria-label="Fechar">
            <IconClose size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4" style={{ minWidth: PANEL_W }}>
          {/* Ação principal: abrir a janela do ChatApp */}
          <button
            onClick={openChatWindow}
            className="flex items-center justify-center gap-2 h-12 rounded-xl text-white font-bold text-[14px] transition-transform hover:scale-[1.02]"
            style={{ background: WA_GREEN, boxShadow: "0 10px 22px -10px rgba(18,161,138,.75)" }}
          >
            <IconExternal size={17} />
            Abrir ChatApp
          </button>
          <p className="text-[11px] leading-snug -mt-2" style={{ color: "var(--ink3, #8B95A4)" }}>
            Abre em janela própria (o login do ChatApp só funciona assim). Clicar de novo <b>foca a mesma janela</b> — a conversa continua de onde parou.
          </p>

          {/* Lead em atendimento: telefone pra colar na busca */}
          {target && (
            <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--line, #E8EBF0)", background: "#F7FBFA" }}>
              <p className="text-[10.5px] font-bold uppercase tracking-wider mb-1.5" style={{ color: "#0E7C6A" }}>
                Lead em atendimento
              </p>
              <p className="text-[14px] font-bold truncate" style={{ color: "var(--ink, #17202E)" }}>{target.name || "Lead"}</p>
              {target.phone && (
                <button
                  onClick={recopyPhone}
                  className="mt-1 flex items-center gap-1.5 text-[13px] font-bold hover:underline"
                  style={{ color: "#0E7C6A", fontVariantNumeric: "tabular-nums" }}
                  title="Copiar o telefone de novo"
                >
                  {formatPhoneDisplay(target.phone)}
                  <IconCopy size={13} />
                </button>
              )}
              <p className="text-[10.5px] mt-1.5" style={{ color: "var(--ink3, #8B95A4)" }}>
                {copiedPhone ? "Número copiado — cole na busca do ChatApp (Ctrl+V)." : "Clique no número pra copiar."}
              </p>
            </div>
          )}

          {/* Templates — copia a mensagem preenchida com o nome do lead */}
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--ink3, #8B95A4)" }}>
              Mensagens rápidas
            </p>
            <div className="flex flex-col gap-2">
              {WA_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  onClick={() => copyTemplate(t.label, t.text)}
                  className="text-left rounded-xl border px-3 py-2.5 transition-colors"
                  style={
                    copiedTpl === t.label
                      ? { background: "#0E7C6A", borderColor: "#0E7C6A" }
                      : { background: "#fff", borderColor: "var(--line, #E8EBF0)" }
                  }
                  title="Copiar a mensagem preenchida"
                >
                  <span className="block text-[12px] font-bold" style={{ color: copiedTpl === t.label ? "#fff" : "var(--ink, #17202E)" }}>
                    {copiedTpl === t.label ? "Copiado! É só colar na conversa." : t.label}
                  </span>
                  {copiedTpl !== t.label && (
                    <span className="block text-[11px] leading-snug mt-0.5 line-clamp-2" style={{ color: "var(--ink3, #8B95A4)" }}>
                      {fillTemplate(t.text, { name: target?.name ?? null })}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
