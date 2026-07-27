// src/components/sdr/comms/CommsDock.tsx
// -----------------------------------------------------------------------------
// Decide QUAL cockpit de atendimento montar, pela feature flag `chat_provider`
// (qs_settings). Três opções, da mais nova pra mais antiga:
//   qs       → atendimento NATIVO: a conversa mora no QS e cada SDR só enxerga a
//              carteira dele (RLS). É o padrão pretendido.
//   chatwoot → painel do Chatwoot embedado em iframe (todo agente vê a caixa toda)
//   chatapp  → legado, janela externa
// Monta só UM (todos usam o mesmo ChatAppDockContext). Virar a chave é instantâneo
// e sem deploy; rollback = trocar a flag de volta. Ver src/lib/qs/chatProvider.ts.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import ChatAppDock from "@/components/sdr/chatapp/ChatAppDock";
import ChatwootDock from "@/components/sdr/chatwoot/ChatwootDock";
import QsWaDock from "@/components/sdr/wa/QsWaDock";
import { getChatProvider, defaultChatProvider, type ChatProvider } from "@/lib/qs/chatProvider";

export default function CommsDock({ onOpenLead }: { onOpenLead?: (leadId: string) => void }) {
  // Começa com o default de build (sync, sem flicker) e confirma com a flag do banco.
  const [provider, setProvider] = useState<ChatProvider>(() => defaultChatProvider());

  useEffect(() => {
    let active = true;
    getChatProvider().then((p) => { if (active) setProvider(p); });
    return () => { active = false; };
  }, []);

  if (provider === "qs") return <QsWaDock onOpenLead={onOpenLead} />;
  if (provider === "chatwoot") return <ChatwootDock />;
  return <ChatAppDock />;
}
