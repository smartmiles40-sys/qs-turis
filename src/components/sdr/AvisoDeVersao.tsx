// src/components/sdr/AvisoDeVersao.tsx
// Aviso de versão nova (ver @/lib/qs/versaoDoApp). Montado uma vez no SdrLayout.
//
// Aparece só quando a aba está VISÍVEL — com ela escondida o vigia já recarrega
// sozinho. Fica no canto, discreto e sem bloquear nada: quem está no meio de um
// atendimento atualiza quando terminar. Não tem botão de fechar de propósito —
// enquanto a aba estiver velha, os pedaços do app que ela ainda não carregou vão
// falhar, e esconder isso só empurra o erro pra frente.

import { useEffect, useState } from "react";
import { vigiarVersao } from "@/lib/qs/versaoDoApp";

export default function AvisoDeVersao() {
  const [nova, setNova] = useState(false);

  useEffect(() => vigiarVersao(setNova), []);

  if (!nova) return null;

  return (
    <div
      className="fixed z-[88] bottom-5 left-5 flex items-center gap-3 rounded-xl py-2.5 pl-3.5 pr-2.5 text-[13px] font-semibold shadow-lg"
      style={{
        background: "#17202E",
        color: "#fff",
        maxWidth: 340,
        paddingBottom: "calc(.625rem + env(safe-area-inset-bottom))",
        animation: "qsToastIn .22s ease-out",
      }}
      role="status"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      </svg>
      <span className="leading-snug">Saiu uma versão nova do QS.</span>
      <button
        onClick={() => window.location.reload()}
        className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-bold text-white transition-colors hover:brightness-110"
        style={{ background: "#0147FF" }}
      >
        Atualizar
      </button>
    </div>
  );
}
