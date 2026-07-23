// src/components/sdr/comms/CommsDock.tsx
// -----------------------------------------------------------------------------
// Decide QUAL cockpit de atendimento montar — ChatApp (legado, janela externa)
// ou Chatwoot (novo, embedado) — pela feature flag `chat_provider` (qs_settings).
// Monta só UM (ambos usam o mesmo ChatAppDockContext). Virar a chave é instantâneo
// e sem deploy; rollback = trocar a flag de volta. Ver src/lib/qs/chatProvider.ts.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import ChatAppDock from "@/components/sdr/chatapp/ChatAppDock";
import ChatwootDock from "@/components/sdr/chatwoot/ChatwootDock";
import { getChatProvider, defaultChatProvider, type ChatProvider } from "@/lib/qs/chatProvider";

export default function CommsDock() {
  // Começa com o default de build (sync, sem flicker) e confirma com a flag do banco.
  const [provider, setProvider] = useState<ChatProvider>(() => defaultChatProvider());

  useEffect(() => {
    let active = true;
    getChatProvider().then((p) => { if (active) setProvider(p); });
    return () => { active = false; };
  }, []);

  return provider === "chatwoot" ? <ChatwootDock /> : <ChatAppDock />;
}
