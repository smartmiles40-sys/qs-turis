// src/contexts/ChatAppDockContext.tsx
// -----------------------------------------------------------------------------
// Estado global do "dock" de ATENDIMENTO — o painel lateral fixo do WhatsApp.
// O nome "ChatApp" no arquivo é herança do cockpit legado (removido em 2026-08).
//
// Qualquer botão de WhatsApp chama `openForLead(lead)`: abre o painel na
// conversa do lead e registra a interação em qs_whatsapp_messages (best-effort).
// -----------------------------------------------------------------------------

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { normalizePhoneBR, logWhatsApp } from "@/lib/whatsapp";

export interface ChatAppTarget {
  leadId?: string | null;
  name?: string | null;
  phone?: string | null;
  ownerId?: string | null;
  /**
   * Texto pra já deixar escrito no campo de mensagem — é assim que o roteiro da
   * atividade da cadência chega no atendimento, em vez de o SDR ter que
   * copiar e colar.
   */
  draft?: string | null;
}

interface ChatAppDockContextType {
  /** Painel aberto? */
  isOpen: boolean;
  /** Lead atualmente "mirado" (nome + telefone exibidos no cabeçalho do dock). */
  target: ChatAppTarget | null;
  /** Abre o dock focando um lead e registra a interação. */
  openForLead: (target: ChatAppTarget) => void;
  /** Abre/foca o dock sem lead específico (ver conversas em geral). */
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const noop = () => {};
const ChatAppDockContext = createContext<ChatAppDockContextType>({
  isOpen: false,
  target: null,
  openForLead: noop,
  open: noop,
  close: noop,
  toggle: noop,
});

export function useChatAppDock() {
  return useContext(ChatAppDockContext);
}

export function ChatAppDockProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [target, setTarget] = useState<ChatAppTarget | null>(null);

  const openForLead = useCallback((t: ChatAppTarget) => {
    setTarget(t);
    setIsOpen(true);
    const phone = normalizePhoneBR(t.phone);
    // log best-effort (não bloqueia a UI se a tabela não existir)
    logWhatsApp({
      leadId: t.leadId ?? null,
      ownerId: t.ownerId ?? null,
      phone,
      status: "pending",
      kind: "message",
      body: "Aberto no atendimento (dock)",
    });
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((o) => !o), []);

  return (
    <ChatAppDockContext.Provider
      value={{ isOpen, target, openForLead, open, close, toggle }}
    >
      {children}
    </ChatAppDockContext.Provider>
  );
}
