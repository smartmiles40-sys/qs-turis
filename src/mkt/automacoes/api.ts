// src/mkt/automacoes/api.ts
// O que a tela das automações conversa com o servidor e com o banco.
// CRUD (fluxos, gatilhos, campos, config, automações do Instagram) vai direto no
// Supabase com a RLS da 0244 (mkt_auto_acesso). O que fala com a Meta passa pela
// rota /api/mkt-automacoes (service_role).
import { supabase } from "@/lib/supabase";
import { authHeaders } from "@/lib/qs/waInbox";
import { canalDo, type Canal, type CampoPersonalizado, type Fluxo, type Gatilho, type Grafo, type TipoGatilho, type GatilhoConfig } from "./tipos";
import type { DadosRelatorio } from "./relatorio";

export async function acao<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/mkt-automacoes", { method: "POST", headers: await authHeaders(), body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || "O servidor recusou.");
  return d as T;
}

export interface EstadoMkt {
  numero: { phoneId: string; numero: string | null; nome: string | null; conectado: boolean } | null;
  robo: { ligado: boolean; pausa_manual_horas: number };
  instagram: { ligado: boolean; webhook: string | null; verifyToken: boolean };
  lpBase: string | null;
}
export async function carregarEstado(): Promise<EstadoMkt> {
  const r = await fetch("/api/mkt-automacoes?estado=1", { headers: await authHeaders() });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || "Não consegui carregar.");
  return d as EstadoMkt;
}

function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export const listarFluxos = async () => ok(await supabase.from("mkt_fluxos").select("*").order("atualizado_em", { ascending: false })) as Fluxo[];
export const lerFluxo = async (id: string) => ok(await supabase.from("mkt_fluxos").select("*").eq("id", id).maybeSingle()) as Fluxo | null;
// O canal só vai no insert quando é Instagram (banco sem a 0343 continua aceitando o WhatsApp).
export const criarFluxo = async (nome: string, grafo: Grafo, canal: Canal = "whatsapp") =>
  ok(await supabase.from("mkt_fluxos").insert({ nome, grafo, ...(canal === "instagram" ? { canal } : {}) }).select().single()) as Fluxo;
export const salvarFluxo = async (id: string, patch: Partial<Pick<Fluxo, "nome" | "descricao" | "status" | "grafo" | "pasta">>) => {
  ok(await supabase.from("mkt_fluxos").update(patch).eq("id", id).select("id"));
};
export const apagarFluxo = async (id: string) => { ok(await supabase.from("mkt_fluxos").delete().eq("id", id).select("id")); };
export const duplicarFluxo = async (f: Fluxo) => criarFluxo(`${f.nome} (cópia)`, f.grafo, canalDo(f));

export const listarGatilhos = async (tipos?: TipoGatilho[]) => {
  let q = supabase.from("mkt_fluxo_gatilhos").select("*").order("prioridade", { ascending: false }).order("criado_em");
  if (tipos?.length) q = q.in("tipo", tipos);
  return ok(await q) as Gatilho[];
};
export const criarGatilho = async (g: { fluxo_id: string; tipo: TipoGatilho; config: GatilhoConfig; prioridade?: number }) =>
  ok(await supabase.from("mkt_fluxo_gatilhos").insert(g).select().single()) as Gatilho;
export const mudarGatilho = async (id: string, patch: Partial<Pick<Gatilho, "config" | "ativo" | "prioridade" | "fluxo_id">>) => {
  ok(await supabase.from("mkt_fluxo_gatilhos").update(patch).eq("id", id).select("id"));
};
export const apagarGatilho = async (id: string) => { ok(await supabase.from("mkt_fluxo_gatilhos").delete().eq("id", id).select("id")); };

export const listarCampos = async () => ok(await supabase.from("mkt_campos").select("*").order("rotulo")) as CampoPersonalizado[];
export const criarCampo = async (c: Omit<CampoPersonalizado, "id">) => ok(await supabase.from("mkt_campos").insert(c).select().single()) as CampoPersonalizado;
export const apagarCampo = async (id: string) => { ok(await supabase.from("mkt_campos").delete().eq("id", id).select("id")); };

export async function salvarConfig(chave: "robo" | "instagram", valor: Record<string, unknown>) {
  ok(await supabase.from("mkt_auto_config").upsert({ chave, valor }).select("chave"));
}

export async function estatisticas(fluxoId: string): Promise<Map<string, { entrou: number; saidas: Record<string, number>; erros: number }>> {
  const { data } = await supabase.rpc("mkt_auto_estatisticas", { p_fluxo: fluxoId });
  const m = new Map<string, { entrou: number; saidas: Record<string, number>; erros: number }>();
  for (const l of (data ?? []) as { no_id: string; tipo: string; saida: string; total: number }[]) {
    const e = m.get(l.no_id) ?? { entrou: 0, saidas: {}, erros: 0 };
    if (l.tipo === "entrou") e.entrou += Number(l.total);
    if (l.tipo === "erro") e.erros += Number(l.total);
    if (l.tipo === "saida") e.saidas[l.saida] = (e.saidas[l.saida] ?? 0) + Number(l.total);
    m.set(l.no_id, e);
  }
  return m;
}

export interface ModeloMkt { nome: string; idioma: string; categoria: string; corpo: string; variaveis: number; cabecalho: string | null; botoes: string[] }
export const listarModelos = () => acao<{ modelos?: ModeloMkt[]; erro?: string; aviso?: string }>({ acao: "modelos" });

export async function listarUsuarios(): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("qs_users").select("id,name").eq("is_active", true).in("role", ["admin", "gestor", "marketing"]).order("name");
  return (data ?? []) as { id: string; name: string }[];
}

export function novoToken(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Relatório de um fluxo (0343, mkt_auto_relatorio): contado no banco. `desde` = ISO ou null (desde sempre). */
export async function relatorioDoFluxo(fluxoId: string, desde: string | null): Promise<DadosRelatorio> {
  const { data, error } = await supabase.rpc("mkt_auto_relatorio", { p_fluxo: fluxoId, p_desde: desde });
  if (error) throw new Error(/function .*mkt_auto_relatorio|schema cache/i.test(error.message) ? "O relatório precisa da migration 0343 aplicada no banco." : error.message);
  return (data ?? {}) as DadosRelatorio;
}

/** Cliques por dia num link de entrada (últimos 30 dias). */
export async function cliquesPorDia(gatilhoId: string): Promise<{ dia: string; total: number }[]> {
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await supabase.from("mkt_entrada_cliques").select("criado_em").eq("gatilho_id", gatilhoId).gte("criado_em", desde).order("criado_em").limit(5000);
  const m = new Map<string, number>();
  for (const l of (data ?? []) as { criado_em: string }[]) {
    const dia = new Date(l.criado_em).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    m.set(dia, (m.get(dia) ?? 0) + 1);
  }
  return [...m].map(([dia, total]) => ({ dia, total }));
}
