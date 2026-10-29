// src/expedicoes/lib/checklistResumo.ts
// -----------------------------------------------------------------------------
// RESUMO DO CHECKLIST — conta ÚNICA (redesign 29/10, spec §4.1).
// Antes o cabeçalho mostrava "78% concluído" (só os PROCESSOS de topo) e o Resumo
// da Visão Geral mostrava "18/74 concluídos" (todas as linhas). Um processo marcado
// como concluído com as subtarefas abertas inflava o primeiro número. Vale agora a
// conta do mockup (ref-expedicao.dc.html, "18/74 · 24% das tarefas concluídas"):
// TODAS as tarefas (processos + subtarefas), cada uma pelo próprio status.
// Usada no cabeçalho/agregados, na aba Checklist, na Saúde e na Tabela da Central.
// Lógica PURA (sem alias "@/") pra rodar no node:test.
// -----------------------------------------------------------------------------

export interface ItemChecklistMin {
  status: string;
  prazo?: string | null;
  parent_id?: string | null;
}

export interface ResumoChecklist {
  /** Todas as tarefas (processos + subtarefas). */
  total: number;
  concluidas: number;
  /** 0..1 (0 quando não há tarefa). */
  pct: number;
  /** Não concluídas com prazo antes de hoje. */
  atrasadas: number;
  /** Só os processos de topo (informativo, ex.: chips de fase). */
  processos: { total: number; concluidos: number };
}

export const CONCLUIDO = "Concluído";

/** `hoje` em "YYYY-MM-DD" (calendário de São Paulo — use dataSP de ./fase.ts). */
export function resumoChecklist(itens: readonly ItemChecklistMin[], hoje?: string): ResumoChecklist {
  const total = itens.length;
  const concluidas = itens.filter((i) => i.status === CONCLUIDO).length;
  const atrasadas = hoje
    ? itens.filter((i) => i.status !== CONCLUIDO && !!i.prazo && i.prazo.slice(0, 10) < hoje).length
    : 0;
  const topo = itens.filter((i) => !i.parent_id);
  return {
    total,
    concluidas,
    pct: total ? concluidas / total : 0,
    atrasadas,
    processos: { total: topo.length, concluidos: topo.filter((i) => i.status === CONCLUIDO).length },
  };
}
