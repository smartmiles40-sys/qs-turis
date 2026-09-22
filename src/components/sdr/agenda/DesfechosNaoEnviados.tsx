// src/components/sdr/agenda/DesfechosNaoEnviados.tsx
// -----------------------------------------------------------------------------
// "ESTES DESFECHOS NÃO CHEGARAM NO BITRIX" — a faixa do gestor (22/09).
//
// A revisão de 22/09 achou 27 desfechos recusados sem ninguém saber: o envio era
// fire-and-forget e a única pista era um toast que sumia na tela de quem lançou.
// Agora cada reunião guarda se o envio chegou (0079/0085), e esta faixa junta o
// que falta — com o motivo — pra reenviar um a um ou tudo de uma vez.
//
// Só aparece quando há pendência: faixa vazia é ruído na tela mais usada.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { desfechosNaoEnviados, reenviarDesfechoAoBitrix } from "@/lib/qs/meetings";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { MEETING_STATUS_LABELS, type Meeting } from "../types";

/** Desde quando procurar. Antes disso o QS não carimbava envio nenhum. */
const DESDE = "2026-09-01T03:00:00Z";

/** Folga entre envios em lote: cada envio são até 4 chamadas num Bitrix de ~2 req/s. */
const PAUSA_MS = 900;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function DesfechosNaoEnviados() {
  const [lista, setLista] = useState<Meeting[]>([]);
  const [aberto, setAberto] = useState(false);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [lote, setLote] = useState<{ feitos: number; total: number } | null>(null);

  const carregar = useCallback(async () => {
    setLista(await desfechosNaoEnviados(DESDE));
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  if (lista.length === 0) return null;

  const reenviar = async (m: Meeting): Promise<boolean> => {
    setEnviando(m.id);
    const r = await reenviarDesfechoAoBitrix(m);
    setEnviando(null);
    return r.ok;
  };

  const reenviarUm = async (m: Meeting) => {
    const ok = await reenviar(m);
    if (ok) notifySuccess(`Desfecho de ${m.lead_name || m.lead?.full_name || "lead"} chegou no Bitrix.`);
    else notifyError("Não chegou — o motivo ficou na linha.");
    await carregar();
  };

  const reenviarTodos = async () => {
    if (!window.confirm(`Reenviar os ${lista.length} desfechos pro Bitrix?\n\nNenhum card é puxado pra trás: se ele já passou da reunião, só os campos são gravados.`)) return;
    let ok = 0;
    setLote({ feitos: 0, total: lista.length });
    for (const [i, m] of lista.entries()) {
      if (await reenviar(m)) ok++;
      setLote({ feitos: i + 1, total: lista.length });
      await dormir(PAUSA_MS);
    }
    setLote(null);
    await carregar();
    if (ok === lista.length) notifySuccess(`${ok} desfechos enviados.`);
    else notifyError(`${ok} de ${lista.length} chegaram. Os que faltam continuam na lista, com o motivo.`);
  };

  const ocupado = !!enviando || !!lote;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
      <div className="flex flex-wrap items-center gap-2">
        <b>⚠ {lista.length} desfecho{lista.length > 1 ? "s" : ""} não chegou{lista.length > 1 ? "aram" : ""} no Bitrix</b>
        <button onClick={() => setAberto((a) => !a)} className="underline underline-offset-2 hover:text-amber-700">
          {aberto ? "esconder" : "ver quais"}
        </button>
        <button
          onClick={() => void reenviarTodos()}
          disabled={ocupado}
          className="ml-auto rounded-lg bg-amber-600 px-3 py-1 font-bold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {lote ? `Enviando ${lote.feitos}/${lote.total}…` : "Reenviar todos"}
        </button>
      </div>
      {aberto && (
        <ul className="mt-2 max-h-64 divide-y divide-amber-200 overflow-auto rounded-lg border border-amber-200 bg-white">
          {lista.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5">
              <span className="font-semibold text-gray-800">{m.lead_name || m.lead?.full_name || "—"}</span>
              <span className="text-gray-500">
                {new Date(m.scheduled_at).toLocaleDateString("pt-BR")} · {MEETING_STATUS_LABELS[m.status]} · {m.meeting_owner || "sem closer"}
              </span>
              <span className="text-red-600">{m.desfecho_erro || "nunca enviado"}</span>
              <button
                onClick={() => void reenviarUm(m)}
                disabled={ocupado}
                className="ml-auto rounded border border-amber-300 px-2 py-0.5 font-semibold hover:bg-amber-100 disabled:opacity-50"
              >
                {enviando === m.id ? "Enviando…" : "Reenviar"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
