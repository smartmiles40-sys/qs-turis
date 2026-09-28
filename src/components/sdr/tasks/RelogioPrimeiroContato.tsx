// src/components/sdr/tasks/RelogioPrimeiroContato.tsx
// -----------------------------------------------------------------------------
// O RELÓGIO DO 1º CONTATO — faixa no topo do Painel (Bruno, 28/09/2026).
//
// Medido em setembro (horas úteis, 0095): lead atendido em até 5 min marca
// reunião 24% das vezes; depois de 2h, 15%. O selo "N min sem contato" já
// existia DENTRO de cada card, mas só aparecia pra quem abrisse o card certo —
// o lead novo que chegava enquanto o SDR estava no meio do FUP ficava esperando
// no fim da fila. Esta faixa mostra, andando sozinha, quantos leads novos estão
// esperando e há quanto tempo o mais antigo espera, com um botão que abre ele.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";

export interface LeadEsperando {
  taskId: string;
  nome: string;
  chegouEm: string;
}

function tempo(min: number): string {
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export default function RelogioPrimeiroContato({
  esperando, onAtender,
}: {
  esperando: LeadEsperando[];
  onAtender: (taskId: string) => void;
}) {
  // Re-render a cada 15 s: o relógio anda mesmo sem a fila mudar.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  if (esperando.length === 0) return null;

  const maisAntigo = esperando[0];
  const min = Math.max(0, Math.floor((agora - new Date(maisAntigo.chegouEm).getTime()) / 60_000));
  const [fundo, cor, borda] =
    min < 5 ? ["#ECFDF5", "#047857", "#A7F3D0"]
    : min < 30 ? ["#FFF7ED", "#B45309", "#FED7AA"]
    : ["#FEF2F2", "#B91C1C", "#FECACA"];

  return (
    <div className="qsx-page mb-3 flex items-center gap-3 flex-wrap rounded-xl px-4 py-2.5"
         style={{ background: fundo, border: `1px solid ${borda}` }}
         role="status" aria-live="polite">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={cor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5" /><path d="M9 2h6" />
      </svg>
      <p className="text-[13.5px] flex-1 min-w-[220px]" style={{ color: cor }}>
        <b style={{ fontVariantNumeric: "tabular-nums" }}>{esperando.length}</b>{" "}
        {esperando.length === 1 ? "lead novo esperando" : "leads novos esperando"} o 1º contato
        {" · "}
        <b>{maisAntigo.nome}</b> chegou há <b style={{ fontVariantNumeric: "tabular-nums" }}>{tempo(min)}</b>
        {min < 5 && <span className="font-normal"> — atendido em até 5 min, 1 em 4 vira reunião</span>}
      </p>
      <button type="button" onClick={() => onAtender(maisAntigo.taskId)}
              className="h-9 px-4 rounded-lg text-[13px] font-bold text-white"
              style={{ background: cor }}>
        Atender agora
      </button>
    </div>
  );
}
