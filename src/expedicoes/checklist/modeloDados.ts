// src/expedicoes/checklist/modeloDados.ts
// -----------------------------------------------------------------------------
// Banco do CHECKLIST PADRÃO EDITÁVEL (0224: exp_checklist_modelo +
// exp_checklist_modelo_aplicar). Sem a 0224 aplicada, tudo degrada pro padrão do
// código (lib/processos/template.ts), como era até 29/10: o editor mostra o padrão
// só pra leitura e o "Gerar checklist" usa o caminho antigo.
// -----------------------------------------------------------------------------
import { supabase, lerTudo, traduzirErro } from "../lib/banco";
import { FASES_CHECKLIST } from "../lib/constants";
import { PROCESSOS_EXPEDICAO, PROCESSOS_SUGERIDOS, setorDoProcesso, type ProcessoTemplate } from "../lib/processos/template";
import type { ModeloTarefa, PapelResponsavel, ReferenciaPrazo, SetorCk, TipoProduto } from "../lib/checklist/modelo";

const TABELA = "exp_checklist_modelo";

const semTabela = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || e.code === "42883"
    || /does not exist|could not find the (table|function)|schema cache/i.test(e.message ?? ""));

/** O padrão como o código tinha até a 0224 (ids "codigo:…", só leitura). */
export function modeloDoCodigo(): ModeloTarefa[] {
  const out: ModeloTarefa[] = [];
  const add = (lista: ProcessoTemplate[], prefixo: string, ativo: boolean, escalonar: boolean) => {
    const ordemFase = new Map<string, number>();
    lista.forEach((p, i) => {
      const o = (ordemFase.get(p.etapa) ?? 0) + 1;
      ordemFase.set(p.etapa, o);
      const base = p.offsetDias ?? FASES_CHECKLIST.find((f) => f.etapa === p.etapa)?.diasReferencia ?? 30;
      const setor = setorDoProcesso(p) as SetorCk;
      const posViagem = p.etapa === "Pós-viagem";
      const id = `codigo:${prefixo}-${i + 1}`;
      const papel: PapelResponsavel | null = setor === "operacional" ? "resp_operacional" : setor === "comercial" ? "resp_comercial" : null;
      const comum = {
        descricao: null, setor, responsavel_usuario_id: null, responsavel_papel: papel,
        prazo_referencia: (posViagem ? "retorno" : "embarque") as ReferenciaPrazo, prioridade: p.prioridade, ativo,
        tipo_produto: "expedicao" as TipoProduto, criado_por: null, criado_em: null, atualizado_por: null, atualizado_em: null,
        etapa: p.etapa,
      };
      out.push({ ...comum, id, chave: null, parent_id: null, titulo: p.tarefa, ordem: escalonar ? o : 100 + o,
        prazo_dias: posViagem ? -7 : escalonar ? base - (o - 1) * 2 : base });
      (p.subtarefas ?? []).forEach((s, j) => out.push({ ...comum, id: `${id}-s${j + 1}`, chave: null, parent_id: id, titulo: s, ordem: j + 1, prazo_dias: null }));
    });
  };
  add(PROCESSOS_EXPEDICAO, "ops", true, true);
  add(PROCESSOS_SUGERIDOS, "sug", false, false);
  return out;
}

export interface ModeloCarregado {
  /** true = a 0224 está aplicada e o padrão vem do banco (editável). */
  noBanco: boolean;
  tarefas: ModeloTarefa[];
}

export async function carregarModelo(): Promise<ModeloCarregado> {
  const { data, error } = await supabase.from(TABELA).select("*").order("ordem").limit(2000);
  if (error) {
    if (semTabela(error)) return { noBanco: false, tarefas: modeloDoCodigo() };
    throw new Error(traduzirErro(error.message));
  }
  return { noBanco: true, tarefas: (data ?? []) as ModeloTarefa[] };
}

/** Só a pergunta "a 0224 está aplicada?" (guardada na memória da página). */
let temModelo: Promise<boolean> | null = null;
export function modeloNoBanco(): Promise<boolean> {
  temModelo ??= Promise.resolve(supabase.from(TABELA).select("id", { head: true, count: "exact" }).limit(1))
    .then(({ error }) => !error)
    .catch(() => false);
  return temModelo;
}

/** Quem é de Operações (admin ou setor operacional) edita o padrão — a policy da 0224 confere de novo. */
export async function souOps(): Promise<boolean> {
  const { data, error } = await supabase.rpc("ops_tem_acesso");
  return !error && Boolean(data);
}

export async function meuId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export type CamposModelo = Pick<ModeloTarefa,
  "titulo" | "descricao" | "etapa" | "setor" | "responsavel_usuario_id" | "responsavel_papel" | "prazo_dias" | "prazo_referencia"
  | "prioridade" | "ativo" | "tipo_produto"> & { parent_id?: string | null };

function validar(c: Partial<CamposModelo>) {
  if ("titulo" in c && String(c.titulo ?? "").trim().length < 2) throw new Error("Título obrigatório (mínimo 2 caracteres)");
  if (c.responsavel_usuario_id && c.responsavel_papel) throw new Error("Escolha uma pessoa OU um papel, não os dois");
}

/** Cria tarefa (ou passo, com parent_id) no fim da fase / do processo. */
export async function criarTarefaModelo(c: CamposModelo, todas: readonly ModeloTarefa[]): Promise<void> {
  validar(c);
  const irmaos = todas.filter((t) => (c.parent_id ? t.parent_id === c.parent_id : !t.parent_id && t.etapa === c.etapa));
  const ordem = irmaos.reduce((m, t) => Math.max(m, t.ordem), 0) + 1;
  const { error } = await supabase.from(TABELA).insert({ ...c, titulo: c.titulo.trim(), descricao: c.descricao?.trim() || null, parent_id: c.parent_id ?? null, ordem });
  if (error) throw new Error(traduzirErro(error.message));
}

export async function salvarTarefaModelo(id: string, c: Partial<CamposModelo>, todas: readonly ModeloTarefa[]): Promise<void> {
  validar(c);
  const atual = todas.find((t) => t.id === id);
  const campos: Record<string, unknown> = { ...c };
  if (typeof c.titulo === "string") campos.titulo = c.titulo.trim();
  if ("descricao" in c) campos.descricao = c.descricao?.trim() || null;
  // trocou de fase → vai pro fim da fase nova
  if (atual && !atual.parent_id && c.etapa && c.etapa !== atual.etapa) {
    campos.ordem = todas.filter((t) => !t.parent_id && t.etapa === c.etapa).reduce((m, t) => Math.max(m, t.ordem), 0) + 1;
  }
  const { error } = await supabase.from(TABELA).update(campos).eq("id", id);
  if (error) throw new Error(traduzirErro(error.message));
}

export async function reordenarModelo(ids: string[]): Promise<void> {
  const { error } = await supabase.rpc("exp_checklist_modelo_reordenar", { p_ids: ids });
  if (error) throw new Error(traduzirErro(error.message));
}

/** Uma linha da prévia / do que entrou (exp_checklist_modelo_aplicar). */
export interface LinhaAplicacao {
  o_expedicao: string; o_codigo: string; o_nome: string; o_modelo: string; o_tarefa: string;
  o_etapa: string; o_sub: boolean; o_prazo: string | null; o_responsavel: string | null;
}

/**
 * Aplica o padrão: expedicoes nulo = todas em andamento; modelos nulo = todos os
 * processos ativos; simular = só a prévia. Só ACRESCENTA o que falta.
 */
export async function aplicarModelo(o: { expedicoes?: string[] | null; modelos?: string[] | null; simular: boolean }): Promise<LinhaAplicacao[]> {
  const { data, error } = await supabase.rpc("exp_checklist_modelo_aplicar", {
    p_expedicoes: o.expedicoes ?? null, p_modelo_ids: o.modelos ?? null, p_simular: o.simular,
  });
  if (error) throw new Error(traduzirErro(error.message));
  return (data ?? []) as LinhaAplicacao[];
}

/** Andamento de cada tarefa do padrão nas expedições (feitas/total), pelo modelo_id. */
export async function andamentoDoModelo(expedicoes: ReadonlySet<string>, hoje: string): Promise<Map<string, { feitas: number; total: number; atrasadas: number }>> {
  const m = new Map<string, { feitas: number; total: number; atrasadas: number }>();
  try {
    const itens = await lerTudo<{ expedicao_id: string; modelo_id: string | null; status: string; prazo: string | null }>(
      "checklist_itens", (q) => q.not("modelo_id", "is", null), "id,expedicao_id,modelo_id,status,prazo");
    for (const i of itens) {
      if (!i.modelo_id || !expedicoes.has(i.expedicao_id)) continue;
      const a = m.get(i.modelo_id) ?? { feitas: 0, total: 0, atrasadas: 0 };
      a.total++;
      if (i.status === "Concluído") a.feitas++;
      else if (i.prazo && i.prazo < hoje) a.atrasadas++;
      m.set(i.modelo_id, a);
    }
  } catch { /* sem a 0224 não há modelo_id: fica sem andamento */ }
  return m;
}
