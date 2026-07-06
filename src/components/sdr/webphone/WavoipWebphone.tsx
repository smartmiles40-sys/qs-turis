// src/components/sdr/webphone/WavoipWebphone.tsx
// -----------------------------------------------------------------------------
// Monta o WEBFONE (Wavoip) uma única vez no app. Carrega a lib via CDN, registra
// o dispositivo (token) e deixa o botão flutuante disponível para receber e fazer
// chamadas. Não renderiza nada próprio — o widget se desenha sozinho (Shadow DOM).
//
// O botão fica no canto INFERIOR ESQUERDO para não colidir com o FAB do ChatApp
// (que fica no inferior direito). Para discar a partir de um lead, use
// dialViaWavoip() de "@/lib/wavoip" (ver WhatsAppModal).
// -----------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { ensureWavoipDevice, ensureWavoipLoaded } from "@/lib/wavoip";

export default function WavoipWebphone() {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return; // evita init duplo (StrictMode em dev)
    startedRef.current = true;

    (async () => {
      try {
        const api = await ensureWavoipLoaded();

        // Ajustes visuais — não críticos, então nunca derrubam a inicialização.
        try { api.theme.set("light"); } catch { /* versão sem theme */ }
        try { api.widget.buttonPosition.set("bottom-left"); } catch { /* posição não suportada */ }

        // Registra o dispositivo (token). Se não houver token, o widget aparece
        // mas não conecta — o SDR configura em Configurações → Webfone.
        const dev = await ensureWavoipDevice();
        if (!dev.ok) console.warn("[webfone]", dev.error);
      } catch (e) {
        console.warn("[webfone] não foi possível iniciar:", e);
      }
    })();
  }, []);

  return null;
}
