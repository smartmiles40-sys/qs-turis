// src/components/sdr/wa/QsWaDock.tsx
// -----------------------------------------------------------------------------
// O cockpit de atendimento do SDR — versão NATIVA (provider "qs").
//
// Diferença pro ChatwootDock (que embutia o painel do Chatwoot num iframe): aqui
// a conversa é do QS. O SDR não navega no Chatwoot, não precisa de conta lá, e
// não tem como abrir a caixa dos colegas — o banco só entrega as conversas dos
// leads dele (RLS da migration 0024).
//
// Mesma casca do dock antigo de propósito (mesma posição, mesma largura, mesmo
// atalho): pra quem usa, muda o conteúdo, não o hábito.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { useChatAppDock } from "@/contexts/ChatAppDockContext";
import { formatPhoneDisplay } from "@/lib/whatsapp";
import WaThreadList from "./WaThreadList";
import WaConversation from "./WaConversation";
import { countUnread, subscribeToThreads, type WaThread } from "@/lib/qs/waInbox";

const WA_GREEN = "#12A18A";
const PANEL_W = 440;

interface Alvo {
  leadId: string;
  name: string | null;
  phone: string | null;
}

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
function IconBack({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export default function QsWaDock() {
  const { isOpen, target, open, close } = useChatAppDock();
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [naoLidas, setNaoLidas] = useState(0);

  // Badge do botão: sem isso, mensagem nova só é descoberta abrindo o painel.
  // Roda mesmo com o dock fechado — é uma query leve e é o ponto todo do aviso.
  useEffect(() => {
    let vivo = true;
    const atualizar = () => { countUnread().then((n) => { if (vivo) setNaoLidas(n); }); };
    atualizar();
    const off = subscribeToThreads(atualizar);
    return () => { vivo = false; off(); };
  }, []);

  // Clicou no WhatsApp de um lead lá na fila → abre direto na conversa dele.
  useEffect(() => {
    if (target?.leadId) {
      setAlvo({ leadId: target.leadId, name: target.name ?? null, phone: target.phone ?? null });
    }
  }, [target?.leadId, target?.name, target?.phone]);

  const escolher = (t: WaThread) => {
    setAlvo({
      leadId: t.lead_id,
      name: t.lead?.full_name || t.lead?.first_name || null,
      phone: t.lead?.phone ?? null,
    });
  };

  return (
    <>
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
          {naoLidas > 0 && (
            <span
              className="ml-0.5 min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold grid place-items-center"
              style={{ background: "#fff", color: "#0E7C6A" }}
            >
              {naoLidas > 99 ? "99+" : naoLidas}
            </span>
          )}
        </button>
      )}

      <aside
        className={`qs-chatdock shrink-0 h-full overflow-hidden flex flex-col ${isOpen ? "qs-chatdock-open" : ""}`}
        style={{
          width: isOpen ? PANEL_W : 0,
          transition: "width .28s cubic-bezier(.4,0,.2,1)",
          borderLeft: isOpen ? "1px solid var(--line)" : "none",
          background: "var(--card)",
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
        <div className="shrink-0 flex items-center gap-2 px-3 h-14 text-white" style={{ background: WA_GREEN, minWidth: PANEL_W }}>
          {alvo ? (
            <button onClick={() => setAlvo(null)} title="Voltar para as conversas"
                    aria-label="Voltar" className="p-1.5 rounded-lg hover:bg-white/15 transition-colors">
              <IconBack size={18} />
            </button>
          ) : (
            <IconChat size={20} />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold leading-tight truncate">
              {alvo ? (alvo.name || "Lead") : "Minhas conversas"}
            </p>
            <p className="text-[10.5px] opacity-90 leading-tight truncate">
              {alvo ? (formatPhoneDisplay(alvo.phone) || "WhatsApp") : "Só os leads da sua carteira"}
            </p>
          </div>
          <button onClick={close} title="Fechar" className="p-1.5 rounded-lg hover:bg-white/15 transition-colors" aria-label="Fechar">
            <IconClose size={18} />
          </button>
        </div>

        {/* Conteúdo — só monta quando aberto (não gasta query com o dock fechado) */}
        <div className="flex-1 min-h-0" style={{ minWidth: PANEL_W }}>
          {isOpen && (
            alvo
              ? <WaConversation leadId={alvo.leadId} leadName={alvo.name} phone={alvo.phone} />
              : <WaThreadList selectedLeadId={null} onPick={escolher} />
          )}
        </div>
      </aside>
    </>
  );
}
