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

  // Visual do desenho (agenda.html, 03/11); o comportamento é o de sempre:
  // "Reenviar todos" pergunta antes e manda um por um, com pausa.
  return (
    <div className="flex flex-col gap-2">
      <div className="ag-faixa">
        <span style={{ color: "var(--ag-warn)" }}>
          {lista.length} desfecho{lista.length > 1 ? "s" : ""} registrado{lista.length > 1 ? "s" : ""} aqui ainda não chegou{lista.length > 1 ? "aram" : ""} no Bitrix
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setAberto((a) => !a)} className="ag-btn ag-btn--sm">
            {aberto ? "Esconder" : "Ver quais"}
          </button>
          <button type="button" onClick={() => void reenviarTodos()} disabled={ocupado} className="ag-btn ag-btn--sm ag-btn--quiet">
            {lote ? `Enviando ${lote.feitos}/${lote.total}…` : "Reenviar todos"}
          </button>
        </div>
      </div>
      {aberto && (
        <ul className="ag-card max-h-64 overflow-auto">
          {lista.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-[13px]" style={{ borderBottom: "1px solid var(--ag-line)" }}>
              <span className="font-semibold">{m.lead_name || m.lead?.full_name || "—"}</span>
              <span className="ag-muted">
                {new Date(m.scheduled_at).toLocaleDateString("pt-BR")} · {MEETING_STATUS_LABELS[m.status]} · {m.meeting_owner || "sem closer"}
              </span>
              <span style={{ color: "var(--ag-desistencia-fg)" }}>{m.desfecho_erro || "nunca enviado"}</span>
              <button type="button" onClick={() => void reenviarUm(m)} disabled={ocupado} className="ag-btn ag-btn--sm ml-auto">
                {enviando === m.id ? "Enviando…" : "Reenviar"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
