// src/contexts/ChatAppDockContext.tsx
// -----------------------------------------------------------------------------
// Estado global do "dock" de ATENDIMENTO — o painel lateral fixo (inbox nativo
// ou Chatwoot, conforme a flag chat_provider). O nome "ChatApp" no arquivo é
// herança do cockpit legado (removido em 2026-08); o contexto em si é genérico.
//
// Qualquer botão de WhatsApp chama `openForLead(lead)`:
//   1. abre o painel (se estiver fechado)
//   2. copia o telefone do lead pra área de transferência (útil pra busca do
//      Chatwoot, que é iframe de outro contexto — não dá pra "digitar" nele)
//   3. registra a interação em qs_whatsapp_messages (best-effort)
// -----------------------------------------------------------------------------

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { normalizePhoneBR, formatPhoneDisplay, logWhatsApp } from "@/lib/whatsapp";

export interface ChatAppTarget {
  leadId?: string | null;
  name?: string | null;
  phone?: string | null;
  ownerId?: string | null;
  /**
   * Texto pra já deixar escrito no campo de mensagem — é assim que o roteiro da
   * atividade da cadência chega no atendimento nativo, em vez de o SDR ter que
   * copiar e colar. Só o provider "qs" usa (o Chatwoot é iframe).
   */
  draft?: string | null;
}

interface ChatAppDockContextType {
  /** Painel aberto? */
  isOpen: boolean;
  /** Lead atualmente "mirado" (nome + telefone exibidos no cabeçalho do dock). */
  target: ChatAppTarget | null;
  /** Telefone normalizado do último lead, já copiado (pra exibir "copiado: ..."). */
  copiedPhone: string | null;
  /** Abre o dock focando um lead: copia o telefone e registra a interação. */
  openForLead: (target: ChatAppTarget) => void;
  /** Abre/foca o dock sem lead específico (ver conversas em geral). */
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Copia de novo o telefone do lead-alvo (botão "copiar" no cabeçalho). */
  recopyPhone: () => void;
}

const noop = () => {};
const ChatAppDockContext = createContext<ChatAppDockContextType>({
  isOpen: false,
  target: null,
  copiedPhone: null,
  openForLead: noop,
  open: noop,
  close: noop,
  toggle: noop,
  recopyPhone: noop,
});

export function useChatAppDock() {
  return useContext(ChatAppDockContext);
}

async function copyPhone(phone: string): Promise<boolean> {
  if (!phone) return false;
  try {
    await navigator.clipboard.writeText(phone);
    return true;
  } catch {
    return false;
  }
}

export function ChatAppDockProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [target, setTarget] = useState<ChatAppTarget | null>(null);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  const openForLead = useCallback((t: ChatAppTarget) => {
    setTarget(t);
    setIsOpen(true);
    const phone = normalizePhoneBR(t.phone);
    if (phone) {
      // dispara dentro do gesto de clique — o Chrome permite o clipboard aqui.
      copyPhone(formatPhoneDisplay(t.phone).replace(/[()\s-]/g, "") || phone);
      setCopiedPhone(formatPhoneDisplay(t.phone) || phone);
    } else {
      setCopiedPhone(null);
    }
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
  const recopyPhone = useCallback(() => {
    if (target?.phone) {
      const phone = normalizePhoneBR(target.phone);
      copyPhone(phone);
      setCopiedPhone(formatPhoneDisplay(target.phone) || phone);
    }
  }, [target]);

  return (
    <ChatAppDockContext.Provider
      value={{ isOpen, target, copiedPhone, openForLead, open, close, toggle, recopyPhone }}
    >
      {children}
    </ChatAppDockContext.Provider>
  );
}
