// src/components/sdr/AvisoDoVigia.tsx
// Aviso de número de WhatsApp fora do ar (ver @/lib/qs/vigiaWhatsApp).
// Montado uma vez no SdrLayout.
//
// Fica no TOPO e em vermelho, ao contrário do aviso de versão (canto, discreto):
// número caído significa que o cliente está mandando mensagem pra um número
// morto e ninguém no time está recebendo. É a única coisa no QS que justifica
// interromper quem está trabalhando.
//
// Sem botão de fechar, de propósito e pelo mesmo motivo do AvisoDeVersao: o
// problema não some porque a pessoa fechou o aviso, e esconder isso é como o
// número dos Closers ficou deslogado por dias em 06/08.

import { useEffect, useState } from "react";
import { vigiarWhatsApp, type SaudeWhatsApp } from "@/lib/qs/vigiaWhatsApp";

export default function AvisoDoVigia() {
  const [saude, setSaude] = useState<SaudeWhatsApp | null>(null);

  useEffect(() => vigiarWhatsApp(setSaude), []);

  if (!saude) return null;

  const texto = saude.semServidor
    ? "Não estou conseguindo falar com o servidor de WhatsApp. Pode ser que mensagem nenhuma esteja entrando no QS."
    : `WhatsApp fora do ar: ${saude.caidas.join(", ")}. Mensagem que chegar nesse número não entra no QS.`;

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
