// src/rel/equipe/cargos.ts
// -----------------------------------------------------------------------------
// CARGOS (0122, 14/10/2026). O papel técnico (admin/gestor/atendente) é o que
// libera acesso; o cargo é o NOME da função de cada um e guarda uma lista de
// permissões pronta pro futuro (o Financeiro vai dar o status das atividades
// dentro do QS). Por enquanto as permissões ficam só registradas — NÃO travam
// nada; quando a função existir, é ela que vai conferir esta lista.
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

/** Permissões previstas. Ainda não travam nada — ficam prontas pro futuro. */
export const PERMISSOES: { chave: string; rotulo: string; setor: SetorCargo }[] = [
  { chave: "financeiro.status_atividades", rotulo: "Dar o status financeiro das atividades", setor: "financeiro" },
  { chave: "financeiro.ver_valores", rotulo: "Ver valores e pagamentos das viagens", setor: "financeiro" },
  { chave: "relacionamento.disparos", rotulo: "Mandar campanhas e automações", setor: "relacionamento" },
  { chave: "relacionamento.modelos", rotulo: "Criar modelos e respostas prontas", setor: "relacionamento" },
];

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
