// src/rel/equipe/cargos.ts
// -----------------------------------------------------------------------------
// CARGOS (0122, 14/10/2026). O papel técnico (admin/gestor/atendente) é o que
// libera o acesso à ÁREA; o cargo é o NOME da função e as permissões dentro
// dela (0135: o banco confere com qs_pode — ver usePode.ts). O Financeiro
// vai dar o status das atividades por aqui.
//
// Ler: qualquer um logado. Criar/editar: admin, ou a gestora do
// Relacionamento nos setores relacionamento e financeiro (o banco confere).
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

export type SetorCargo = "comercial" | "relacionamento" | "financeiro" | "operacional";

export const SETORES_CARGO: Record<SetorCargo, string> = {
  relacionamento: "Relacionamento",
  financeiro: "Financeiro",
  comercial: "Comercial",
  operacional: "Operacional",
};

export type Permissao =
  | "relacionamento.modelos" | "relacionamento.disparos" | "relacionamento.juntar_clientes" | "relacionamento.editar_viagens"
  | "relacionamento.agenda_time" | "relacionamento.kpis" | "relacionamento.conferir_documentos"
  | "financeiro.status_atividades" | "financeiro.ver_valores" | "financeiro.modelos";

/**
 * As permissões que o cargo marca — VALEM desde a 0135 (qs_pode no banco).
 * Admin e gestor(a) da área podem tudo; sem cargo = `padrao` (o de hoje).
 * Mesma lista de qs_permissoes_padrao() no banco: mudou aqui, muda lá.
 */
export const PERMISSOES: { chave: Permissao; rotulo: string; setor: SetorCargo; padrao: boolean }[] = [
  { chave: "relacionamento.modelos", rotulo: "Criar e editar respostas prontas", setor: "relacionamento", padrao: false },
  { chave: "relacionamento.disparos", rotulo: "Criar campanhas e automações", setor: "relacionamento", padrao: true },
  { chave: "relacionamento.juntar_clientes", rotulo: "Juntar fichas duplicadas", setor: "relacionamento", padrao: true },
  { chave: "relacionamento.editar_viagens", rotulo: "Criar e editar viagens", setor: "relacionamento", padrao: true },
  { chave: "relacionamento.agenda_time", rotulo: "Marcar compromissos na agenda dos outros", setor: "relacionamento", padrao: false },
  { chave: "relacionamento.kpis", rotulo: "Ver os KPIs", setor: "relacionamento", padrao: true },
  { chave: "relacionamento.conferir_documentos", rotulo: "Conferir documentos dos clientes", setor: "relacionamento", padrao: true },
  { chave: "financeiro.status_atividades", rotulo: "Mudar o status dos atendimentos", setor: "financeiro", padrao: true },
  { chave: "financeiro.ver_valores", rotulo: "Ver valores das viagens", setor: "financeiro", padrao: true },
  { chave: "financeiro.modelos", rotulo: "Criar e editar respostas prontas do Financeiro", setor: "financeiro", padrao: false },
];

/** O que um cargo novo já nasce marcado: o padrão de hoje do setor. */
export const permissoesPadrao = (setor: SetorCargo): string[] =>
  PERMISSOES.filter((p) => p.padrao && p.setor === setor).map((p) => p.chave);

export interface Cargo {
  id: string;
  nome: string;
  setor: SetorCargo;
  descricao: string | null;
  permissoes: string[];
  ativo: boolean;
  criado_em: string;
}

export async function listarCargos(): Promise<Cargo[]> {
  const { data, error } = await supabase.from("qs_cargos").select("*").order("setor").order("nome");
  if (error) throw new Error(error.message);
  return (data ?? []) as Cargo[];
}

export async function salvarCargo(c: Partial<Cargo> & { nome: string; setor: SetorCargo }): Promise<void> {
  const campos = { nome: c.nome.trim(), setor: c.setor, descricao: c.descricao?.trim() || null, permissoes: c.permissoes ?? [], ativo: c.ativo ?? true };
  const r = c.id
    ? await supabase.from("qs_cargos").update(campos).eq("id", c.id).select("id")
    : await supabase.from("qs_cargos").insert(campos);
  // UPDATE barrado pela RLS não dá erro: só não muda nenhuma linha.
  if (c.id && !r.error && !(r.data as unknown[] | null)?.length) throw new Error("Sem permissão pra mudar isso.");
  if (r.error) {
    if (r.error.code === "23505") throw new Error("Já existe um cargo com esse nome.");
    if (r.error.message.includes("row-level")) throw new Error("Você só cria cargos do Relacionamento ou do Financeiro.");
    throw new Error(r.error.message);
  }
}
