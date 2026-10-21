// src/expedicoes/divisoes/dados.ts
// Grupos/divisões de uma expedição (app antigo: grupos/actions.ts + lib/data/grupos.ts
// + passageiros/grupo-actions.ts). Regras que dependem daqui:
//  - Divisão G1/G2 vale só se existirem grupos com nome EXATAMENTE "G1" e "G2"
//    (Passageiros, Rooming e Área do Líder mostram G1/G2).
//  - Portal /amigo: voo com grupo_id só aparece pra quem é daquele grupo; apagar o
//    grupo deixa o voo pra todos (FK set null). Por isso avisamos antes.
//  - Ligar/desligar a divisão é só do admin (igual ao antigo) e roda numa função SQL
//    (0169) que, diferente do antigo, NÃO apaga os outros grupos.
import { supabase, lerTudo, listarPassageirosDe, traduzirErro } from "../lib/banco";
import type { GrupoExpedicaoRow, PassageiroRow } from "../lib/database";

export const CAMPOS_GRUPO = ["nome", "data_embarque", "data_retorno", "pax_planejados", "observacoes"] as const;
export type CampoGrupo = (typeof CAMPOS_GRUPO)[number];

export function erroGrupo(msg: string): string {
  if (/grupos_expedicao_check/.test(msg)) return "A data de retorno do grupo não pode ser antes do embarque.";
  if (/grupos_expedicao_expedicao_id_nome_key|duplicate key/.test(msg)) return "Já existe um grupo com esse nome nesta expedição.";
  return traduzirErro(msg);
}
function falhou(error: { message: string } | null) { if (error) throw new Error(erroGrupo(error.message)); }

export const usaDivisao = (grupos: GrupoExpedicaoRow[]) => grupos.some((g) => g.nome === "G1") && grupos.some((g) => g.nome === "G2");

export interface DadosDivisoes {
  grupos: GrupoExpedicaoRow[];
  pax: PassageiroRow[];
  voosPorGrupo: Map<string, number>;
}

export async function carregarDivisoes(expedicaoId: string): Promise<DadosDivisoes> {
  const [g, pax, voos] = await Promise.all([
    supabase.from("grupos_expedicao").select("*").eq("expedicao_id", expedicaoId).order("ordem").order("created_at"),
    listarPassageirosDe([expedicaoId]),
    lerTudo<{ id: string; grupo_id: string | null }>("expedicao_voos", (q) => q.eq("expedicao_id", expedicaoId).not("grupo_id", "is", null), "id, grupo_id"),
  ]);
  falhou(g.error);
  const voosPorGrupo = new Map<string, number>();
  for (const v of voos) if (v.grupo_id) voosPorGrupo.set(v.grupo_id, (voosPorGrupo.get(v.grupo_id) ?? 0) + 1);
  return { grupos: (g.data ?? []) as GrupoExpedicaoRow[], pax, voosPorGrupo };
}

export async function criarGrupo(expedicaoId: string, nome: string, grupos: GrupoExpedicaoRow[]): Promise<void> {
  const n = nome.trim();
  if (!n) throw new Error("Dá um nome pro grupo (ex: G1, G2…)");
  if (n.length > 60) throw new Error("Nome muito longo (máximo 60 caracteres)");
  const ordem = grupos.reduce((m, g) => Math.max(m, g.ordem), 0) + 1;
  const { error } = await supabase.from("grupos_expedicao").insert({ expedicao_id: expedicaoId, nome: n, pax_planejados: 0, data_embarque: null, data_retorno: null, observacoes: null, ordem });
  falhou(error);
}

export async function salvarGrupo(id: string, campo: CampoGrupo, valor: unknown): Promise<void> {
  if (!CAMPOS_GRUPO.includes(campo)) throw new Error("Campo não editável");
  let v = valor;
  if (campo === "nome") {
    v = String(valor ?? "").trim();
    if (!v) throw new Error("O grupo precisa de um nome");
    if ((v as string).length > 60) throw new Error("Nome muito longo (máximo 60 caracteres)");
  }
  if (campo === "pax_planejados") {
    const n = valor == null ? 0 : Number(valor);
    if (!Number.isInteger(n) || n < 0) throw new Error("Pax planejados precisa ser um número inteiro (0 ou mais)");
    v = n;
  }
  const { error } = await supabase.from("grupos_expedicao").update({ [campo]: v }).eq("id", id);
  falhou(error);
}

/** Apaga UM grupo. Passageiros e voos dele ficam sem grupo (FK set null). */
export async function excluirGrupo(id: string): Promise<void> {
  const { error } = await supabase.from("grupos_expedicao").delete().eq("id", id);
  falhou(error);
}

export async function reordenarGrupos(ids: string[]): Promise<void> {
  const { error } = await supabase.rpc("exp_reordenar_grupos", { p_ids: ids });
  falhou(error);
}

export async function definirGrupoDoPax(paxId: string, grupoId: string | null): Promise<void> {
  const { error } = await supabase.from("passageiros").update({ grupo_id: grupoId }).eq("id", paxId);
  falhou(error);
}

export async function ativarDivisao(expedicaoId: string): Promise<void> {
  const { error } = await supabase.rpc("exp_ativar_divisao", { p_expedicao: expedicaoId });
  falhou(error);
}

/** Desliga a divisão: apaga só G1 e G2; devolve quantos passageiros ficaram sem grupo. */
export async function removerDivisao(expedicaoId: string): Promise<number> {
  const { data, error } = await supabase.rpc("exp_remover_divisao", { p_expedicao: expedicaoId });
  falhou(error);
  return Number(data ?? 0);
}

export async function souAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("exp_eh_admin");
  return !error && Boolean(data);
}
