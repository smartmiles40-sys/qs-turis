// src/rel/lib/chamados.ts
// -----------------------------------------------------------------------------
// KANBAN DE CHAMADOS (sprint de 13/10, migration 0106).
//
// O chamado (protocolo) anda por 4 colunas: Aberto → Em andamento →
// Aguardando → Resolvido. Cada um tem o "próximo passo" (o que falta pra
// andar), de quem depende agora e uma lista de tarefas (checklist).
//
// O HISTÓRICO (rel_chamado_eventos) é escrito sozinho pelo banco quando muda
// a situação, o responsável ou o próximo passo. A tela só lê e acrescenta
// notas.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { Chamado, Prioridade, StatusChamado } from "./pos";

export type AguardandoQuem = "time" | "cliente" | "fornecedor" | "financeiro" | "outro";

export const AGUARDANDO: Record<AguardandoQuem, string> = {
  time: "Nosso time",
  cliente: "Cliente",
  fornecedor: "Fornecedor / cia aérea",
  financeiro: "Financeiro",
  outro: "Outro",
};

export interface ItemChecklist { texto: string; feito: boolean }

export type ChamadoK = Chamado & {
  proximo_passo: string | null;
  aguardando_quem: AguardandoQuem | null;
  checklist: ItemChecklist[] | null;
  categoria: string | null;
};

export interface EventoChamado {
  id: string;
  chamado_id: string;
  tipo: "criado" | "status" | "nota" | "proximo_passo" | "responsavel" | "checklist" | "resolvido";
  texto: string | null;
  de_status: StatusChamado | null;
  para_status: StatusChamado | null;
  autor_id: string | null;
  criado_em: string;
  autor?: { name: string } | null;
}

/** As colunas do kanban, na ordem em que o protocolo anda. */
export const COLUNAS: { id: StatusChamado; rotulo: string; dica: string }[] = [
  { id: "aberto", rotulo: "Aberto", dica: "chegou, ninguém pegou ainda" },
  { id: "em_andamento", rotulo: "Em andamento", dica: "alguém está resolvendo" },
  { id: "aguardando", rotulo: "Aguardando", dica: "depende de cliente ou fornecedor" },
  { id: "resolvido", rotulo: "Resolvido", dica: "últimos 14 dias" },
];

const SELECT = "*, cliente:rel_clientes(nome), viagem:rel_viagens(titulo), responsavel:qs_users!rel_chamados_responsavel_id_fkey(name)";

/** Tudo que não foi resolvido + o que foi resolvido nos últimos 14 dias. */
export async function listarKanban(): Promise<ChamadoK[]> {
  const desde = new Date(Date.now() - 14 * 86400_000).toISOString();
  const [abertos, resolvidos] = await Promise.all([
    supabase.from("rel_chamados").select(SELECT).neq("status", "resolvido").order("prazo", { ascending: true, nullsFirst: false }).limit(500),
    supabase.from("rel_chamados").select(SELECT).eq("status", "resolvido").gte("resolvido_em", desde).order("resolvido_em", { ascending: false }).limit(200),
  ]);
  if (abertos.error) throw new Error(abertos.error.message);
  if (resolvidos.error) throw new Error(resolvidos.error.message);
  return [...(abertos.data ?? []), ...(resolvidos.data ?? [])] as ChamadoK[];
}

export async function carregarChamado(id: string): Promise<ChamadoK | null> {
  const { data, error } = await supabase.from("rel_chamados").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as ChamadoK | null;
}

/** Chamados ainda abertos de uma conversa (mostrados dentro dela). */
export async function chamadosDaConversa(conversaId: string): Promise<ChamadoK[]> {
  const { data } = await supabase.from("rel_chamados").select(SELECT).eq("conversa_id", conversaId)
    .neq("status", "resolvido").order("criado_em", { ascending: false }).limit(20);
  return (data ?? []) as ChamadoK[];
}

export type MudancaChamado = Partial<{
  status: StatusChamado; prioridade: Prioridade; prazo: string | null; responsavel_id: string | null;
  proximo_passo: string | null; aguardando_quem: AguardandoQuem | null; checklist: ItemChecklist[];
  resolucao: string | null;
}>;

/** Muda só as colunas pedidas. O banco grava o histórico. */
export async function mudarChamado(id: string, m: MudancaChamado): Promise<void> {
  const corpo: Record<string, unknown> = { ...m };
  // resolvido_em quem grava é o banco (gatilho da 0107).
  if (typeof m.proximo_passo === "string") corpo.proximo_passo = m.proximo_passo.trim() || null;
  if (typeof m.resolucao === "string") corpo.resolucao = m.resolucao.trim() || null;
  const { error } = await supabase.from("rel_chamados").update(corpo).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function eventosDoChamado(id: string): Promise<EventoChamado[]> {
  // O histórico não tem chave estrangeira pro autor: busca os nomes à parte.
  const { data: puros, error: e2 } = await supabase.from("rel_chamado_eventos").select("*").eq("chamado_id", id).order("criado_em", { ascending: true });
  if (e2) throw new Error(e2.message);
  const lista = (puros ?? []) as EventoChamado[];
  const ids = [...new Set(lista.map((e) => e.autor_id).filter((x): x is string => !!x))];
  if (ids.length) {
    const { data: us } = await supabase.from("qs_users").select("id, name").in("id", ids);
    const nomes = new Map(((us ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name]));
    lista.forEach((e) => { e.autor = e.autor_id && nomes.has(e.autor_id) ? { name: nomes.get(e.autor_id)! } : null; });
  }
  return lista;
}

export async function anotarNoChamado(id: string, texto: string): Promise<void> {
  const t = texto.trim();
  if (!t) return;
  const { error } = await supabase.from("rel_chamado_eventos").insert({ chamado_id: id, tipo: "nota", texto: t });
  if (error) throw new Error(error.message);
}

/**
 * Mexe em UM item do checklist no banco (RPC da 0107). Mandar a lista inteira
 * fazia o último a gravar apagar o que o outro marcou. Devolve a lista nova.
 */
export async function checklistDoChamado(
  id: string,
  acao: { tipo: "adicionar"; texto: string } | { tipo: "marcar"; indice: number; feito: boolean } | { tipo: "remover"; indice: number },
): Promise<ItemChecklist[]> {
  const { data, error } = await supabase.rpc("rel_chamado_checklist", {
    p_chamado: id,
    p_acao: acao.tipo,
    p_indice: acao.tipo === "adicionar" ? null : acao.indice,
    p_texto: acao.tipo === "adicionar" ? acao.texto : null,
    p_feito: acao.tipo === "marcar" ? acao.feito : null,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as ItemChecklist[]) : [];
}

/** Assunto sugerido a partir da última mensagem do cliente. */
export function assuntoSugerido(texto: string | null | undefined): string {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 3) return "";
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}
