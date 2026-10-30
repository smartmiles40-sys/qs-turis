// src/expedicoes/checklist/ChipSetor.tsx — etiqueta do setor de uma tarefa (Operações, Comercial…), nas cores de --sector-*.
import { COR_SETOR, NOME_SETOR, type SetorCk } from "../lib/checklist/modelo";

export function ChipSetor({ setor }: { setor: string | null | undefined }) {
  if (!setor || !(setor in NOME_SETOR)) return null;
  const cor = COR_SETOR[setor as SetorCk];
  return (
    <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap"
      style={{ background: `var(--sector-${cor}-bg, var(--card2))`, color: `var(--sector-${cor}-fg, var(--ink2))` }}>{NOME_SETOR[setor as SetorCk]}</span>
  );
}
