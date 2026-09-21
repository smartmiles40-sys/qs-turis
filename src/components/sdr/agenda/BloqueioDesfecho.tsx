// src/components/sdr/agenda/BloqueioDesfecho.tsx
// -----------------------------------------------------------------------------
// A faixa vermelha e o aviso de "reunião trancada" da agenda do closer que
// deixou reunião de dia anterior sem desfecho. A regra mora em
// src/lib/qs/bloqueioDesfecho.ts; aqui é só o que o closer vê.
// -----------------------------------------------------------------------------

import { MENSAGEM_BLOQUEIO, type ReuniaoPendente } from "@/lib/qs/bloqueioDesfecho";

function dataCurta(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** A faixa do topo: a mensagem pedida pelo Bruno + quantas faltam. */
export function FaixaBloqueioDesfecho({ pendentes, onAbrir }: {
  pendentes: ReuniaoPendente[];
  /** Abre a reunião pendente (a tela decide como). Sem isto, só lista. */
  onAbrir?: (id: string) => void;
}) {
  if (!pendentes.length) return null;
  return (
    <div role="alert" className="mb-5 rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3">
      <p className="flex items-start gap-2 text-sm font-bold text-red-700">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
             strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0" aria-hidden>
          <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        {MENSAGEM_BLOQUEIO}
      </p>
      <p className="mt-1 pl-[26px] text-xs text-red-600">
        {pendentes.length === 1 ? "Falta 1 reunião" : `Faltam ${pendentes.length} reuniões`} — as de hoje em diante
        ficam trancadas até lá.
      </p>
      {onAbrir && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-[26px]">
          {pendentes.slice(0, 12).map((p) => (
            <button key={p.id} onClick={() => onAbrir(p.id)}
                    className="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100">
              {dataCurta(p.scheduled_at)} · {p.lead_name || "cliente"}
            </button>
          ))}
          {pendentes.length > 12 && (
            <span className="px-1 py-1 text-xs text-red-500">+{pendentes.length - 12}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** No lugar do conteúdo da reunião trancada (modal ou painel). */
export function ReuniaoTrancada({ pendentes, onFechar }: { pendentes: number; onFechar?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-center">
      <p className="text-sm font-bold text-red-700">{MENSAGEM_BLOQUEIO}</p>
      <p className="mt-1 text-xs text-red-600">
        {pendentes === 1 ? "Falta o desfecho de 1 reunião" : `Faltam os desfechos de ${pendentes} reuniões`} de dias anteriores.
      </p>
      {onFechar && (
        <button onClick={onFechar}
                className="mt-3 rounded-lg border border-red-200 bg-white px-4 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">
          Fechar
        </button>
      )}
    </div>
  );
}
