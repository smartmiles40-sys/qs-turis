// src/mkt/planejamento/dados.ts — leitura e escrita do planejamento (0395) pelo time.
// A RLS decide quem lê e escreve; enviar/decidir/obs passam pelas RPCs
// (mkt_plan_enviar / mkt_plan_decidir / mkt_plan_obs). O da agência o time só
// LÊ e decide — quem escreve nele é a agência, pela rota api/mkt-agencia.js.
import { supabase } from "@/lib/supabase";
import { traduzirErro } from "../conteudo/dados";
import type { Formato, ItemPlano, Pendencia, Periodicidade } from "./regras";
import type { TimeMkt } from "../menu";

export type StatusPlano = "rascunho" | "enviado" | "devolvido" | "aprovado" | "cancelado";
export type Rede = "instagram" | "tiktok" | "linkedin" | "youtube" | "facebook" | "outra";

export interface Perfil { id: string; rede: Rede; dono: "stfv" | "jacque"; nome: string; usuario: string | null; ativo: boolean; ordem: number }

export interface RevisaoIa {
  etapa?: "leitura" | "faltas" | "revisao";
  resumo?: string;
  avisos?: ({ conteudo: number | null; aviso: string } | string)[];
  avisos_leitura?: string[];
  pendencias?: string[];
  erro?: string;
  em?: string;
}

export interface Planejamento {
  id: string;
  origem: "agencia" | "interno";
  periodicidade: Periodicidade;
  time: TimeMkt;
  titulo: string;
  periodo_inicio: string;
  periodo_fim: string;
  status: StatusPlano;
  rodada: number;
  documento_nome: string | null;
  documento_path: string | null;
  documento_link: string | null;
  ia_revisao: RevisaoIa | null;
  criado_por: string | null;
  enviado_em: string | null;
  decidido_por: string | null;
  decidido_em: string | null;
  criado_em: string;
}

export interface ItemSalvo extends ItemPlano {
  id: string;
  planejamento_id: string;
  ordem: number;
  titulo: string;
  formato: Formato | null;
  referencias: string[];
  adaptacao: string | null;
  perfil_ids: string[];
  data_postagem: string | null;
  horario: string | null;
  card_id: string | null;
}

export interface Obs {
  id: string;
  planejamento_id: string;
  item_id: string | null;
  autor_id: string | null;
  autor_agencia: string | null;
  time: TimeMkt | null;
  texto: string;
  rodada: number;
  resolvida: boolean;
  criado_em: string;
}

function falhou(error: { message: string } | null): void {
  if (error) throw new Error(traduzirErroPlano(error.message));
}

export function traduzirErroPlano(msg: string): string {
  if (/relation "mkt_plan|mkt_perfis|function .*mkt_plan/i.test(msg)) return "O banco do planejamento ainda não foi criado (falta aplicar a migration 0395).";
  return traduzirErro(msg);
}
export const erroDePlano = (e: unknown) => (e instanceof Error ? traduzirErroPlano(e.message) : "Algo deu errado");

// ── Perfis ─────────────────────────────────────────────────────────────────
export async function listarPerfis(incluirInativos = false): Promise<Perfil[]> {
  let q = supabase.from("mkt_perfis").select("id, rede, dono, nome, usuario, ativo, ordem").order("ordem");
  if (!incluirInativos) q = q.eq("ativo", true);
  const { data, error } = await q;
  falhou(error);
  return (data ?? []) as Perfil[];
}
export async function salvarPerfil(p: Partial<Perfil> & { nome: string; rede: Rede; dono: "stfv" | "jacque" }): Promise<void> {
  const linha = { nome: p.nome.trim(), rede: p.rede, dono: p.dono, usuario: p.usuario?.trim() || null, ativo: p.ativo ?? true, ordem: p.ordem ?? 0 };
  const { error } = p.id ? await supabase.from("mkt_perfis").update(linha).eq("id", p.id) : await supabase.from("mkt_perfis").insert(linha);
  falhou(error);
}

// ── Planejamentos ──────────────────────────────────────────────────────────
const CAMPOS = "id, origem, periodicidade, time, titulo, periodo_inicio, periodo_fim, status, rodada, documento_nome, documento_path, documento_link, ia_revisao, criado_por, enviado_em, decidido_por, decidido_em, criado_em";

export async function listarPlanejamentos(): Promise<Planejamento[]> {
  const { data, error } = await supabase.from("mkt_planejamentos").select(CAMPOS)
    .neq("status", "cancelado").order("periodo_inicio", { ascending: false }).limit(200);
  falhou(error);
  return (data ?? []) as Planejamento[];
}

export async function lerPlanejamento(id: string): Promise<{ plano: Planejamento; itens: ItemSalvo[]; obs: Obs[] } | null> {
  const [p, i, o] = await Promise.all([
    supabase.from("mkt_planejamentos").select(CAMPOS).eq("id", id).maybeSingle(),
    supabase.from("mkt_planejamento_itens").select("*").eq("planejamento_id", id).order("ordem"),
    supabase.from("mkt_planejamento_obs").select("*").eq("planejamento_id", id).order("criado_em"),
  ]);
  falhou(p.error); falhou(i.error); falhou(o.error);
  if (!p.data) return null;
  return { plano: p.data as Planejamento, itens: (i.data ?? []) as ItemSalvo[], obs: (o.data ?? []) as Obs[] };
}

export async function criarPlanejamentoInterno(d: { titulo: string; periodicidade: Periodicidade; time: TimeMkt; periodo_inicio: string; periodo_fim: string }): Promise<string> {
  const { data, error } = await supabase.from("mkt_planejamentos")
    .insert({ ...d, origem: "interno", titulo: d.titulo.trim() }).select("id").single();
  falhou(error);
  return (data as { id: string }).id;
}

export async function apagarPlanejamento(id: string): Promise<void> {
  const { data, error } = await supabase.from("mkt_planejamentos").delete().eq("id", id).select("id");
  falhou(error);
  if (!data?.length) throw new Error("Só dá pra apagar rascunho (seu, ou sendo gestor).");
}

/** Grava os conteúdos do planejamento interno (os que sumiram da lista são apagados). */
export async function salvarItens(planId: string, itens: ItemPlano[]): Promise<void> {
  const { data: atuais, error: e1 } = await supabase.from("mkt_planejamento_itens").select("id").eq("planejamento_id", planId);
  falhou(e1);
  const manter = new Set(itens.map((i) => i.id).filter(Boolean));
  const apagar = (atuais ?? []).map((a) => (a as { id: string }).id).filter((id) => !manter.has(id));
  if (apagar.length) falhou((await supabase.from("mkt_planejamento_itens").delete().in("id", apagar)).error);
  for (const [n, i] of itens.entries()) {
    const linha = {
      ordem: n,
      titulo: (i.titulo ?? "").trim(),
      formato: i.formato ?? null,
      referencias: (i.referencias ?? []).map((r) => r.trim()).filter(Boolean),
      adaptacao: i.adaptacao?.trim() || null,
      perfil_ids: i.perfil_ids ?? [],
      data_postagem: i.data_postagem || null,
      horario: i.horario || null,
    };
    const r = i.id
      ? await supabase.from("mkt_planejamento_itens").update(linha).eq("id", i.id)
      : await supabase.from("mkt_planejamento_itens").insert({ ...linha, planejamento_id: planId });
    falhou(r.error);
  }
}

export async function enviarPlanejamento(id: string): Promise<{ ok: boolean; faltas?: Pendencia[] }> {
  const { data, error } = await supabase.rpc("mkt_plan_enviar", { p_id: id });
  falhou(error);
  return data as { ok: boolean; faltas?: Pendencia[] };
}

export async function decidirPlanejamento(id: string, decisao: "aprovado" | "devolvido", obs?: string): Promise<{ ok: boolean; cards?: number }> {
  const { data, error } = await supabase.rpc("mkt_plan_decidir", { p_id: id, p_decisao: decisao, p_obs: obs?.trim() || null });
  falhou(error);
  return data as { ok: boolean; cards?: number };
}

export async function deixarObs(planId: string, itemId: string | null, texto: string): Promise<void> {
  const { error } = await supabase.rpc("mkt_plan_obs", { p_plan: planId, p_item: itemId, p_texto: texto });
  falhou(error);
}

export async function resolverObs(id: string, resolvida: boolean): Promise<void> {
  falhou((await supabase.from("mkt_planejamento_obs").update({ resolvida }).eq("id", id)).error);
}

/** Link temporário (10 min) pro PDF que a agência mandou. */
export async function linkDoPdf(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("mkt-planejamentos").createSignedUrl(path, 600);
  falhou(error);
  if (!data?.signedUrl) throw new Error("Não deu para abrir o PDF.");
  return data.signedUrl;
}

export async function contarPlanejamentosParaRevisar(times: TimeMkt[]): Promise<number> {
  if (!times.length) return 0;
  const { count } = await supabase.from("mkt_planejamentos").select("id", { count: "exact", head: true })
    .eq("status", "enviado").in("time", times);
  return count ?? 0;
}

// ── Agência (contas) — gestor/admin ────────────────────────────────────────
export interface ContaAgencia { id: string; agencia: string; nome: string; email: string; ativo: boolean; ultimo_acesso: string | null; bloqueada_ate: string | null; criado_em: string }

export async function listarContasAgencia(): Promise<ContaAgencia[]> {
  const { data, error } = await supabase.rpc("mkt_agencia_listar");
  falhou(error);
  return (data ?? []) as ContaAgencia[];
}
export async function salvarContaAgencia(c: { id?: string | null; agencia: string; nome: string; email: string; senha?: string; ativo?: boolean }): Promise<string> {
  const { data, error } = await supabase.rpc("mkt_agencia_salvar", {
    p_id: c.id ?? null, p_agencia: c.agencia, p_nome: c.nome, p_email: c.email, p_senha: c.senha ?? "", p_ativo: c.ativo ?? true,
  });
  falhou(error);
  return data as string;
}
