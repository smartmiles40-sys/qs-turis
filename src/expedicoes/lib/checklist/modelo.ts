// src/expedicoes/lib/checklist/modelo.ts
// -----------------------------------------------------------------------------
// CHECKLIST PADRÃO EDITÁVEL (Bruno, 30/10). Lógica PURA (sem "@/") pra rodar no
// node:test: tipos do modelo (tabela exp_checklist_modelo da 0224), rótulo do
// prazo relativo, quem é o responsável padrão, e os filtros da aba Checklist
// ("minhas tarefas", "atrasadas", por setor).
// O banco (0224) é quem aplica o padrão às expedições (exp_checklist_modelo_aplicar);
// aqui só se descreve e se filtra.
// -----------------------------------------------------------------------------

export type SetorCk = "operacional" | "comercial" | "financeiro" | "relacionamento";
export type PapelResponsavel = "resp_operacional" | "resp_comercial";
export type TipoProduto = "expedicao" | "pacote" | "ambos";
export type ReferenciaPrazo = "embarque" | "retorno";

export const SETORES_CK: readonly SetorCk[] = ["operacional", "comercial", "financeiro", "relacionamento"];
export const NOME_SETOR: Record<SetorCk, string> = {
  operacional: "Operações", comercial: "Comercial", financeiro: "Financeiro", relacionamento: "Relacionamento",
};
/** Sufixo das variáveis de cor (--sector-<x>, --sector-<x>-bg/-fg). */
export const COR_SETOR: Record<SetorCk, string> = {
  operacional: "operacoes", comercial: "comercial", financeiro: "financeiro", relacionamento: "relacionamento",
};
export const NOME_PAPEL: Record<PapelResponsavel, string> = {
  resp_operacional: "Responsável operacional da expedição",
  resp_comercial: "Responsável comercial da expedição",
};
export const NOME_TIPO: Record<TipoProduto, string> = { expedicao: "Expedição", pacote: "Pacote", ambos: "Expedição e pacote" };

/** Mesma ordem do enum etapa_checklist. */
export const ETAPAS_CK = ["Após o fechamento", "12 a 6 meses", "6 a 2 meses", "2 meses a 15 dias", "Na semana", "Pós-viagem"] as const;

/** Uma linha de exp_checklist_modelo (0224). */
export interface ModeloTarefa {
  id: string;
  chave: string | null;
  parent_id: string | null;
  titulo: string;
  descricao: string | null;
  etapa: string;
  setor: SetorCk;
  responsavel_usuario_id: string | null;
  responsavel_papel: PapelResponsavel | null;
  /** prazo = referência − prazo_dias (30 = D-30; −7 = D+7). Nulo na subtarefa = prazo do processo. */
  prazo_dias: number | null;
  prazo_referencia: ReferenciaPrazo;
  prioridade: string;
  ordem: number;
  ativo: boolean;
  tipo_produto: TipoProduto;
  criado_por: string | null;
  criado_em: string | null;
  atualizado_por: string | null;
  atualizado_em: string | null;
}

/** "D-30 do embarque", "D+7 do retorno", "no dia do embarque"; null/sub → "mesmo prazo do processo". */
export function rotuloPrazo(dias: number | null | undefined, ref: ReferenciaPrazo = "embarque", sub = false): string {
  if (dias == null) return sub ? "mesmo prazo do processo" : "sem prazo";
  const alvo = ref === "retorno" ? "do retorno" : "do embarque";
  if (dias === 0) return `no dia ${alvo}`;
  return dias > 0 ? `D-${dias} ${alvo}` : `D+${-dias} ${alvo}`;
}

/** Data pura "YYYY-MM-DD" − dias (sem fuso). */
export function menosDiasISO(iso: string, dias: number): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d) - dias * 86400000).toISOString().slice(0, 10);
}

/** O prazo que a tarefa do padrão teria nesta expedição (a mesma conta da função do banco). */
export function prazoNaExpedicao(m: Pick<ModeloTarefa, "prazo_dias" | "prazo_referencia">, exp: { data_embarque: string | null; data_retorno: string | null }): string | null {
  const ref = m.prazo_referencia === "retorno" ? exp.data_retorno : exp.data_embarque;
  if (!ref || m.prazo_dias == null) return null;
  return menosDiasISO(ref, m.prazo_dias);
}

/** Texto do responsável padrão ("Larissa", "Responsável operacional da expedição", "Financeiro (sem pessoa)"). */
export function textoResponsavel(m: Pick<ModeloTarefa, "responsavel_usuario_id" | "responsavel_papel" | "setor">, nomes: ReadonlyMap<string, string>): string {
  if (m.responsavel_usuario_id) return nomes.get(m.responsavel_usuario_id) ?? "Pessoa removida";
  if (m.responsavel_papel) return NOME_PAPEL[m.responsavel_papel];
  return `${NOME_SETOR[m.setor] ?? m.setor} (sem pessoa fixa)`;
}

/** Processos (topo) do modelo na ordem da tela: fase, depois ordem. Subtarefas por processo. */
export function arvoreDoModelo(linhas: readonly ModeloTarefa[]): { processo: ModeloTarefa; subs: ModeloTarefa[] }[] {
  const ix = (e: string) => { const i = (ETAPAS_CK as readonly string[]).indexOf(e); return i < 0 ? 99 : i; };
  const porOrdem = (a: ModeloTarefa, b: ModeloTarefa) => a.ordem - b.ordem || (a.criado_em ?? "").localeCompare(b.criado_em ?? "") || a.titulo.localeCompare(b.titulo);
  const subs = new Map<string, ModeloTarefa[]>();
  for (const l of linhas) if (l.parent_id) { const a = subs.get(l.parent_id) ?? []; a.push(l); subs.set(l.parent_id, a); }
  return linhas.filter((l) => !l.parent_id)
    .sort((a, b) => ix(a.etapa) - ix(b.etapa) || porOrdem(a, b))
    .map((processo) => ({ processo, subs: (subs.get(processo.id) ?? []).sort(porOrdem) }));
}

/** Nova ordem depois de subir/descer um item entre os irmãos (lista de ids na ordem nova). */
export function moverNaLista(ids: readonly string[], id: string, delta: -1 | 1): string[] | null {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const n = [...ids];
  [n[i], n[j]] = [n[j], n[i]];
  return n;
}

// ── filtros da aba ──────────────────────────────────────────────────────────
export interface ItemFiltravel {
  id: string;
  parent_id: string | null;
  status: string;
  prazo: string | null;
  responsavel_id: string | null;
  setor?: string | null;
}

export type FiltroQuem = "todas" | "minhas" | "atrasadas";

export const estaAtrasada = (i: Pick<ItemFiltravel, "status" | "prazo">, hoje: string) =>
  i.status !== "Concluído" && !!i.prazo && i.prazo.slice(0, 10) < hoje;

/**
 * Filtra o checklist da expedição. O processo fica quando ELE ou alguma subtarefa
 * passa no filtro (pra não perder o contexto); a subtarefa fica quando ela passa,
 * ou quando o filtro é só de setor e o processo passou.
 * Setor: a subtarefa sem setor herda o do processo.
 */
export function filtrarChecklist<T extends ItemFiltravel>(itens: readonly T[], f: { quem: FiltroQuem; eu: string | null; setor: SetorCk | ""; hoje: string }): T[] {
  if (f.quem === "todas" && !f.setor) return [...itens];
  const porId = new Map(itens.map((i) => [i.id, i]));
  const setorDe = (i: T) => i.setor ?? (i.parent_id ? porId.get(i.parent_id)?.setor ?? null : null);
  const passaQuem = (i: T) =>
    f.quem === "todas" ? true : f.quem === "minhas" ? !!f.eu && i.responsavel_id === f.eu : estaAtrasada(i, f.hoje);
  const passaSetor = (i: T) => !f.setor || setorDe(i) === f.setor;
  const passa = (i: T) => passaQuem(i) && passaSetor(i);
  const ficam = new Set<string>();
  for (const i of itens) {
    if (!passa(i)) continue;
    ficam.add(i.id);
    if (i.parent_id) ficam.add(i.parent_id);
  }
  return itens.filter((i) => ficam.has(i.id) && (i.parent_id ? passa(i) : true));
}
