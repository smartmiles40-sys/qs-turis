// src/components/sdr/telefone/LigacaoOficialWidget.tsx
// -----------------------------------------------------------------------------
// A barra da ligação pelo NÚMERO OFICIAL (Cloud API Calling).
//
// Fica montada uma vez no SdrLayout e só aparece quando existe chamada. Não tem
// discador: quem disca é o card do lead. Aqui só mora o que a pessoa precisa
// DURANTE a ligação — pra quem, em que pé está, mudo e desligar.
//
// Por que não reusar o WebphoneWidget: aquele é o webfone SIP (VoxFree/JsSIP),
// outro caminho de áudio e outro ciclo de vida. Misturar os dois num componente
// só significaria um `if` em cada linha — e o dia em que um quebrasse levaria o
// outro junto.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import {
  assinarLigacaoAtual, desligarAtual, alternarMudoAtual,
  type EstadoNaTela,
} from "@/lib/qs/waCall";
import { formatPhoneDisplay } from "@/lib/whatsapp";

const LEGENDA: Record<string, string> = {
  "pedindo-microfone": "Liberando o microfone…",
  discando: "Discando…",
  tocando: "Tocando no aparelho do cliente…",
  falando: "Falando",
  encerrada: "Chamada encerrada",
  recusada: "O cliente recusou",
  erro: "Falhou",
};

function duracao(desde: number): string {
  const s = Math.max(0, Math.round((Date.now() - desde) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function LigacaoOficialWidget() {
  const [e, setE] = useState<EstadoNaTela | null>(null);
  const [, redesenha] = useState(0);

  useEffect(() => assinarLigacaoAtual(setE), []);

  // O cronômetro é a única coisa que precisa de tique — e só enquanto fala.
  useEffect(() => {
    if (!e?.atendidaEm) return;
    const t = window.setInterval(() => redesenha((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [e?.atendidaEm]);

  if (!e || (!e.ativa && !e.estado)) return null;

  const falando = e.estado === "falando";
  const acabou = e.estado === "encerrada" || e.estado === "recusada" || e.estado === "erro";

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[300px] rounded-xl border border-gray-200 bg-white p-3 shadow-lg"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-gray-900">
            {e.leadName || formatPhoneDisplay(e.phone) || "Ligação"}
          </p>
          <p className="mt-0.5 text-[12px] text-gray-600">
            {LEGENDA[String(e.estado)] ?? "…"}
            {e.detalhe ? `: ${e.detalhe}` : ""}
            {falando && e.atendidaEm ? ` · ${duracao(e.atendidaEm)}` : ""}
          </p>
          {e.leadName && (
            <p className="mt-0.5 truncate text-[11px] text-gray-400">{formatPhoneDisplay(e.phone)}</p>
          )}
        </div>
        <span
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
            falando ? "bg-green-600" : acabou ? "bg-gray-300" : "bg-amber-500"
          }`}
          aria-hidden
        />
      </div>

      {!acabou && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => void desligarAtual()}
            className="flex-1 rounded-md bg-red-700 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-red-800"
          >
            Desligar
          </button>
          <button
            onClick={() => alternarMudoAtual()}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-[13px] text-gray-800 hover:bg-gray-50"
          >
            {e.calado ? "Voltar a falar" : "Mudo"}
          </button>
        </div>
      )}

      {/* A ligação sai pelo número da empresa: dizer isso evita a dúvida de
          "de qual número o cliente vê que está sendo chamado?". */}
      <p className="mt-2 text-[11px] text-gray-400">Pelo WhatsApp oficial da empresa</p>
    </div>
  );
}
