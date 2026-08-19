// src/components/sdr/AvisoDoVigia.tsx
// A perna do vigia que mora dentro do app (ver @/lib/qs/vigiaWhatsApp).
// Montado uma vez no SdrLayout.
//
// ⚠️ A FAIXA ESTÁ DESLIGADA (19/08, a pedido do Bruno) — MAS O COMPONENTE NÃO.
//
// Ao religar o vigia, as instâncias "Comercial - SDRs (1595)" e "Comercial -
// Closers (1935)" voltaram `close`, enquanto a caixa 2 seguia trocando mensagem
// no mesmo dia. Ou o status da Evolution está velho, ou aquelas instâncias foram
// abandonadas na migração pra API oficial (978 de cada 1000 mensagens passam
// hoje pela caixa 3). Faixa vermelha permanente por alarme que talvez seja falso
// é o jeito mais rápido de o time aprender a ignorar alarme.
//
// O componente CONTINUA montado de propósito: é o `useEffect` dele que faz o QS
// aberto na tela das SDRs acionar a ronda de 5 em 5 minutos — a única perna do
// vigia que funciona quando NADA está chegando. Tirar o componente do layout
// mataria isso em silêncio, que é exatamente o erro que estamos consertando.
//
// Pra religar a faixa: MOSTRAR_FAIXA = true.

import { useEffect, useState } from "react";
import { vigiarWhatsApp, type SaudeWhatsApp } from "@/lib/qs/vigiaWhatsApp";

/** Desligada enquanto as duas instâncias antigas seguem reportando `close`. */
const MOSTRAR_FAIXA = false;

export default function AvisoDoVigia() {
  const [saude, setSaude] = useState<SaudeWhatsApp | null>(null);

  // Roda sempre: é isto que mantém o vigia vivo pelo app.
  useEffect(() => vigiarWhatsApp(setSaude), []);

  if (!MOSTRAR_FAIXA || !saude) return null;

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
