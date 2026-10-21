// src/expedicoes/checklist/dados.ts
// Leitura/escrita do checklist de uma expedição (app antigo: checklist/page.tsx +
// actions.ts gerarChecklistPadrao / criarChecklistItem / atualizarChecklistCampo /
// excluirChecklistItem). Gerar padrão e mudar de fase são funções SQL atômicas (0169).
import { supabase, lerTudo, traduzirErro } from "../lib/banco";
import { construirChecklistPadrao, PROCESSOS_EXPEDICAO } from "../lib/processos/template";
import { FASES_CHECKLIST, STATUS_CHECKLIST } from "../lib/constants";
import type { ChecklistItemRow, EtapaChecklist, Prioridade, StatusChecklist, UsuarioRow } from "../lib/database";
import type { Tom } from "../ui";

export const TOM_STATUS: Record<StatusChecklist, Tom> = {
  Pendente: "neutro", "Em andamento": "lista", Atenção: "aviso", Concluído: "ok", Bloqueado: "erro",
};
export const COR_PONTO: Record<StatusChecklist, string> = {
  Pendente: "#9CA3AF", "Em andamento": "#7C3AED", Atenção: "#D97706", Concluído: "#16A34A", Bloqueado: "#DC2626",
};
export const TOM_PRIORIDADE: Record<Prioridade, Tom> = { Baixa: "neutro", Média: "lista", Alta: "aviso", Crítica: "erro" };

export const KANBAN_COLUNAS: { titulo: string; statuses: StatusChecklist[] }[] = [
  { titulo: "Pendente", statuses: ["Pendente"] },
  { titulo: "Em andamento", statuses: ["Em andamento"] },
  { titulo: "Atenção", statuses: ["Atenção", "Bloqueado"] },
  { titulo: "Concluído", statuses: ["Concluído"] },
];

export async function listarChecklist(expedicaoId: string): Promise<ChecklistItemRow[]> {
  return lerTudo<ChecklistItemRow>("checklist_itens", (q) => q.eq("expedicao_id", expedicaoId));
}

function falhou(error: { message: string } | null) {
  if (error) throw new Error(traduzirErro(error.message));
}

/** Data pura: "YYYY-MM-DD" − dias (sem fuso — o antigo podia errar 1 dia). */
export function menosDias(iso: string, dias: number): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const t = Date.UTC(a, m - 1, d) - dias * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Gera os 23 processos + subtarefas. Responsável padrão: o responsável operacional
 * da expedição; sem ele, o primeiro usuário operacional por nome (no antigo era
 * "o primeiro que o banco devolvesse", não determinístico). Sem data de embarque
 * os prazos ficam vazios (no antigo viravam 1970).
 */
export async function gerarChecklistPadrao(exp: { id: string; data_embarque: string | null; responsavel_operacional_id: string | null }, usuarios: UsuarioRow[]): Promise<number> {
  const operacional = exp.responsavel_operacional_id
    ?? [...usuarios].filter((u) => u.papel === "operacional").sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))[0]?.id;
  const linhas = construirChecklistPadrao({ expedicaoId: exp.id, dataEmbarque: exp.data_embarque ?? "2000-01-01", responsavelPorPapel: operacional ? { operacional } : {} });
  // Recalcula o prazo com data pura (mesma regra do template: referência da fase,
  // cada processo seguinte da fase vence 2 dias mais perto; subtarefa = prazo do pai).
  const idReal = new Map(linhas.map((l) => [l.id, crypto.randomUUID()]));
  const prazoDoPai = new Map<string, string | null>();
  let k = 0;
  for (const l of linhas) {
    if (l.parent_id) continue;
    const proc = PROCESSOS_EXPEDICAO[k++];
    const base = proc?.offsetDias ?? FASES_CHECKLIST.find((f) => f.etapa === l.etapa)?.diasReferencia ?? 30;
    prazoDoPai.set(l.id, exp.data_embarque ? menosDias(exp.data_embarque, base - (l.ordem - 1) * 2) : null);
  }
  const itens = linhas.map((l) => {
    const prazo = prazoDoPai.get(l.parent_id ?? l.id) ?? null;
    return {
      id: idReal.get(l.id), etapa: l.etapa, tarefa: l.tarefa, responsavel_id: l.responsavel_id, prazo,
      prioridade: l.prioridade, parent_id: l.parent_id ? idReal.get(l.parent_id) : null, ordem: l.ordem,
    };
  });
  const { data, error } = await supabase.rpc("exp_gerar_checklist", { p_expedicao: exp.id, p_itens: itens });
  falhou(error);
  return Number(data ?? itens.length);
}

export interface NovaTarefa {
  tarefa: string; etapa: EtapaChecklist; prioridade: Prioridade; prazo: string | null;
  responsavel_id: string | null; observacoes: string | null; parent_id: string | null; status?: StatusChecklist;
}

/** Cria tarefa (ou subtarefa, com parent_id). ordem = irmãos + 1, igual ao antigo. */
export async function criarTarefa(expedicaoId: string, t: NovaTarefa, itens: ChecklistItemRow[]): Promise<void> {
  if (t.tarefa.trim().length < 2) throw new Error("Tarefa obrigatória (mínimo 2 caracteres)");
  const irmaos = itens.filter((i) => (t.parent_id ? i.parent_id === t.parent_id : !i.parent_id && i.etapa === t.etapa));
  const ordem = irmaos.reduce((m, i) => Math.max(m, i.ordem), 0) + 1;
  const { error } = await supabase.from("checklist_itens").insert({
    expedicao_id: expedicaoId, etapa: t.etapa, tarefa: t.tarefa.trim(), prioridade: t.prioridade, prazo: t.prazo || null,
    responsavel_id: t.responsavel_id || null, observacoes: t.observacoes?.trim() || null, parent_id: t.parent_id,
    status: t.status ?? "Pendente", ordem, dependencia_id: null, evidencia_url: null, bitrix_task_id: null,
  });
  falhou(error);
}

const CAMPOS_EDITAVEIS = ["tarefa", "responsavel_id", "status", "prazo", "prioridade", "observacoes"] as const;
type CampoEditavel = (typeof CAMPOS_EDITAVEIS)[number];

export async function salvarCampo(id: string, campo: CampoEditavel, valor: unknown): Promise<void> {
  if (!CAMPOS_EDITAVEIS.includes(campo)) throw new Error("Campo não editável");
  if (campo === "status" && !STATUS_CHECKLIST.includes(valor as StatusChecklist)) throw new Error("Status inválido");
  if (campo === "tarefa" && String(valor ?? "").trim().length < 2) throw new Error("Tarefa obrigatória (mínimo 2 caracteres)");
  const { error } = await supabase.from("checklist_itens").update({ [campo]: valor === "" ? null : valor }).eq("id", id);
  falhou(error);
}

export async function salvarVarios(id: string, campos: Partial<Record<CampoEditavel, unknown>>): Promise<void> {
  if (!Object.keys(campos).length) return;
  if ("tarefa" in campos && String(campos.tarefa ?? "").trim().length < 2) throw new Error("Tarefa obrigatória (mínimo 2 caracteres)");
  const { error } = await supabase.from("checklist_itens").update(campos).eq("id", id);
  falhou(error);
}

/** Muda a fase de um processo (as subtarefas vão junto; entra no fim da nova fase). */
export async function moverEtapa(id: string, etapa: EtapaChecklist): Promise<void> {
  const { error } = await supabase.rpc("exp_checklist_mover_etapa", { p_id: id, p_etapa: etapa });
  falhou(error);
}

export async function reordenar(ids: string[]): Promise<void> {
  const { error } = await supabase.rpc("exp_reordenar_checklist", { p_ids: ids });
  falhou(error);
}

/** Excluir: subtarefas saem pelo FK (cascade); dependências apontando pra ele viram null pelo FK. */
export async function excluirTarefa(id: string): Promise<void> {
  const { error } = await supabase.from("checklist_itens").delete().eq("id", id);
  falhou(error);
}
