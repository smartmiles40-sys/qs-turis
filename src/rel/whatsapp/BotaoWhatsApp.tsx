// src/rel/whatsapp/BotaoWhatsApp.tsx
// -----------------------------------------------------------------------------
// O botão de CONECTAR O WHATSAPP sempre à vista no Relacionamento (Bruno,
// 13/10/2026: "preciso de um botão pra conectar o WhatsApp dentro da área").
// Sem número conectado: botão verde chamativo. Conectado: selo discreto que
// também leva pra tela do número (saúde, modelos, reconectar).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/** null = ainda verificando. */
export function useWhatsAppConectado() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let vivo = true;
    supabase.rpc("rel_whatsapp_conectado").then(({ data, error }) => { if (vivo) setOk(error ? null : !!data); });
    return () => { vivo = false; };
  }, []);
  return ok;
}

const ICONE = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3 2.4 1 2.9.8 3.4.7.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" />
  </svg>
);

export default function BotaoWhatsApp({ abrir, compacto = false }: { abrir: () => void; compacto?: boolean }) {
  const ok = useWhatsAppConectado();
  if (ok === null) return null;
  if (ok) {
    return (
      <button onClick={abrir} title="WhatsApp do Relacionamento conectado — ver o número"
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-semibold"
        style={{ color: "var(--rel-ink)", background: "var(--rel-soft)" }}>
        {ICONE}{!compacto && "WhatsApp conectado"}
      </button>
    );
  }
  return (
    <button onClick={abrir}
      className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-[13px] font-bold text-white shadow-sm"
      style={{ background: "#25D366" }}>
      {ICONE}Conectar WhatsApp
    </button>
  );
}
