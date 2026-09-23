// src/components/sdr/AvisoDoVigia.tsx
// A perna do vigia que mora dentro do app (ver @/lib/qs/vigiaWhatsApp).
// Montado uma vez no SdrLayout, e SEMPRE montado: é o `useEffect` dele que
// mantém a ronda de 5 em 5 minutos viva enquanto o QS está aberto.
//
// A faixa só acende com prova de que o número oficial parou (`ok === false`,
// medido pelo pulso do webhook da Meta — 0086). "Ainda não sei" não acende.

import { useEffect, useState } from "react";
import { vigiarWhatsApp, type SaudeOficial } from "@/lib/qs/vigiaWhatsApp";

/** O que fazer, em uma frase, para cada causa que o vigia sabe separar. */
const TEXTO_OFICIAL: Record<string, string> = {
  "nao-chega":
    "O número oficial não recebe nada da Meta. Confira no painel do app se o webhook ainda aponta para /api/wa-calls e se o campo messages continua assinado.",
  assinatura:
    "A Meta está entregando e o QS está RECUSANDO: a assinatura não confere. O META_CALLS_APP_SECRET na Vercel está diferente do app secret real.",
  "chega-e-ignora":
    "A Meta está entregando, o QS aceita e não reconhece o formato do evento. O payload está no log — é conserto de código, não de configuração.",
};

function horasDesde(ms?: number | null): string {
  if (!ms || ms < 0) return "";
  const h = Math.floor(ms / 3_600_000);
  if (h < 48) return ` Faz ${h}h.`;
  return ` Faz ${Math.floor(h / 24)} dias.`;
}

export default function AvisoDoVigia() {
  const [oficial, setOficial] = useState<SaudeOficial | null>(null);

  // Roda sempre: é isto que mantém o vigia vivo pelo app.
  useEffect(() => vigiarWhatsApp(setOficial), []);

  if (oficial?.ok !== false) return null;

  const texto =
    (TEXTO_OFICIAL[oficial.motivo ?? ""] ?? "O número oficial não está recebendo mensagem no QS.") +
    horasDesde(oficial.silencioMs);

  return (
    <div
      className="shrink-0 z-[92] flex items-center justify-center gap-2.5 px-4 py-2 text-[13px] font-semibold text-white"
      style={{ background: "#C0261C" }}
      role="alert"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4" /><path d="M12 17h.01" />
      </svg>
      <span className="leading-snug">{texto}</span>
    </div>
  );
}
