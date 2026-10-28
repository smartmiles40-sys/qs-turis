// src/components/sdr/cadences/CalendarPreview.tsx
// -----------------------------------------------------------------------------
// Prévia do calendário: em que DATA cada passo cai para um lead que entra no
// dia escolhido. Usa a MESMA conta da geração de tarefas (planCadenceDates com
// dias de execução da cadência ∩ Horário de Trabalho), então o que aparece
// aqui é o que o SDR vai ver na fila. Feriados: o QS ainda não tem cadastro de
// feriados — a prévia avisa.
// -----------------------------------------------------------------------------

import { kindDef, ordenarPassos, type Passo } from "./cadenceModelos";
import { chaveDia } from "@/lib/qs/cadenceTeto";

const CAB = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

interface Props {
  passos: Passo[];
  datasPorDia: Map<number, Date>;
  entrada: Date;
  onEntrada: (d: Date) => void;
  /** Dias da semana em que a cadência pode agendar (já cruzado com o expediente). */
  permitidos: number[];
}

function inputValue(d: Date): string {
  return chaveDia(d);
}

export default function CalendarPreview({ passos, datasPorDia, entrada, onEntrada, permitidos }: Props) {
  const porData = new Map<string, Passo[]>();
  for (const p of ordenarPassos(passos)) {
    const d = datasPorDia.get(p.dia);
    if (!d) continue;
    const k = chaveDia(d);
    porData.set(k, [...(porData.get(k) ?? []), p]);
  }
  const datas = Array.from(datasPorDia.values());
  const ultima = datas.length ? new Date(Math.max(...datas.map((d) => d.getTime()))) : entrada;

  // Grade de semanas inteiras (domingo → sábado), da entrada até o último passo.
  const ini = new Date(entrada); ini.setHours(0, 0, 0, 0); ini.setDate(ini.getDate() - ini.getDay());
  const fim = new Date(ultima); fim.setHours(0, 0, 0, 0); fim.setDate(fim.getDate() + (6 - fim.getDay()));
  const celulas: Date[] = [];
  for (let d = new Date(ini); d <= fim && celulas.length < 7 * 12; d.setDate(d.getDate() + 1)) celulas.push(new Date(d));

  const corridos = Math.round((new Date(ultima).setHours(0, 0, 0, 0) - new Date(entrada).setHours(0, 0, 0, 0)) / 86_400_000) + 1;
  const entradaKey = chaveDia(entrada);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <span>Lead entrando em</span>
        <input type="date" value={inputValue(entrada)}
          onChange={(e) => { const [y, m, d] = e.target.value.split("-").map(Number); if (y && m && d) onEntrada(new Date(y, m - 1, d, 9, 0)); }}
          className="px-2 py-1 rounded-lg border border-gray-200 text-xs" />
        <span className="text-gray-400">→ termina em {corridos} dia{corridos === 1 ? "" : "s"} corridos</span>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {CAB.map((c, i) => (
          <div key={c} className={`text-center text-[10px] font-semibold uppercase ${permitidos.includes(i) ? "text-gray-400" : "text-gray-300 line-through"}`}>{c}</div>
        ))}
        {celulas.map((d) => {
          const k = chaveDia(d);
          const itens = porData.get(k) ?? [];
          const fds = d.getDay() === 0 || d.getDay() === 6;
          const fora = !permitidos.includes(d.getDay());
          return (
            <div key={k}
              className={`min-h-[54px] rounded-lg border p-1 ${
                itens.length ? (fds ? "border-amber-300 bg-amber-50" : "border-[#0147FF]/30 bg-[#0147FF]/5") : fora ? "border-gray-50 bg-gray-50" : "border-gray-100 bg-white"
              }`}>
              <div className={`text-[10px] ${k === entradaKey ? "font-bold text-[#0147FF]" : "text-gray-400"}`}>
                {d.getDate()}{k === entradaKey ? " · entra" : ""}
              </div>
              <div className="flex flex-col gap-0.5 mt-0.5">
                {itens.slice(0, 3).map((p) => (
                  <span key={p.id} className="truncate text-[9.5px] leading-tight text-gray-700" title={`Dia ${p.dia} · ${kindDef(p.kind).label}`}>
                    {kindDef(p.kind).label}
                  </span>
                ))}
                {itens.length > 3 && <span className="text-[9.5px] text-gray-400">+{itens.length - 3}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10.5px] text-gray-400">
        Dias riscados não recebem atividade (dias de execução da cadência ∩ Horário de Trabalho). Feriados ainda não são considerados: o QS não tem cadastro de feriados.
      </p>
    </div>
  );
}
