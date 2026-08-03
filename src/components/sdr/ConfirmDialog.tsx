// src/components/sdr/ConfirmDialog.tsx
// Desenha os pedidos de confirmação globais (confirmar() de @/lib/qs/confirmar).
// Montado UMA vez no SdrLayout, ao lado do <GlobalToasts/>.
//
// Detalhes que não são decoração:
//  • o foco vai pro botão de CONFIRMAR ao abrir, e Esc recusa — quem trabalha na
//    fila usa teclado, e um diálogo sem foco obriga a pegar o mouse;
//  • fechar por Esc ou clicando fora conta como RECUSA, nunca como confirmação;
//  • a promise só resolve uma vez (a trava está no confirmar.ts), então clicar
//    duas vezes não dispara a ação duas vezes.

import { useEffect, useRef, useState } from "react";
import { subscribeConfirmacoes, type ConfirmacaoAberta } from "@/lib/qs/confirmar";

export default function ConfirmDialog() {
  const [pedido, setPedido] = useState<ConfirmacaoAberta | null>(null);
  const confirmarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeConfirmacoes((p) => setPedido(p)), []);

  useEffect(() => {
    if (!pedido) return;
    confirmarRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { pedido.resolver(false); setPedido(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pedido]);

  if (!pedido) return null;

  const responder = (ok: boolean) => { pedido.resolver(ok); setPedido(null); };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={() => responder(false)} />
      <div
        className="relative w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-5 shadow-lg"
        style={{ animation: "qsToastIn .18s ease-out" }}
      >
        <h2 className="text-base font-bold text-gray-900">{pedido.titulo}</h2>
        {pedido.mensagem && (
          <p className="mt-1.5 text-sm leading-relaxed text-gray-500">{pedido.mensagem}</p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => responder(false)}
            className="rounded-lg border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            {pedido.recusarLabel ?? "Recusar"}
          </button>
          <button
            ref={confirmarRef}
            onClick={() => responder(true)}
            className={`rounded-lg py-2.5 text-sm font-semibold text-white transition-colors ${
              pedido.perigo ? "bg-[#C4373D] hover:bg-[#A72E33]" : "bg-[#0147FF] hover:bg-[#0139D6]"
            }`}
          >
            {pedido.confirmarLabel ?? "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
