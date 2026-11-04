// src/mkt/trafego/api.ts — conversa da tela de Meta Ads (0265).
// Números e ações na Meta: pela /api/mkt-trafego (o token da Meta nunca vem
// pro navegador). Períodos, travas, quem recebe aviso e destino à mão: direto
// no banco, com a RLS da 0265 decidindo quem pode.
import { supabase } from "@/lib/supabase";
import type { Cota, Escopo, Metrica, Painel } from "./tipos";

async function token(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  return session.access_token;
}

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const r = await fetch("/api/mkt-trafego", {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as T;
}

export const lerPainel = (periodoId?: string | null) => chamar<Painel>({ acao: "painel", periodoId: periodoId ?? null });
export const atualizarAgora = () => chamar<{ ok: true }>({ acao: "sincronizar" });
export const reativarCampanha = (acaoId: number) => chamar<{ ok: true; liberadaAte: string }>({ acao: "reativar", acaoId });

const erroDe = (e: { message: string; code?: string } | null) => {
  if (!e) return;
  if (e.code === "42501" || /row-level security|permission/i.test(e.message)) throw new Error("Você não tem permissão pra isso.");
  throw new Error(e.message);
};

export interface PeriodoNovo { id?: string; nome: string; inicio: string; fim: string; valor: number; cotas: Cota[]; ativo: boolean }
export async function salvarPeriodo(p: PeriodoNovo): Promise<string> {
  const linha = { nome: p.nome, inicio: p.inicio, fim: p.fim, valor: p.valor, cotas: p.cotas, ativo: p.ativo };
  if (p.id) {
    const { error } = await supabase.from("mkt_trafego_periodos").update(linha).eq("id", p.id);
    erroDe(error);
    return p.id;
  }
  const { data, error } = await supabase.from("mkt_trafego_periodos").insert(linha).select("id").single();
  erroDe(error);
  return (data as { id: string }).id;
}
export async function apagarPeriodo(id: string) {
  const { error } = await supabase.from("mkt_trafego_periodos").delete().eq("id", id);
  erroDe(error);
}

export interface RegraNova {
  id?: string; nome: string; ativa: boolean; periodo_id: string | null; escopo: Escopo; alvo: string | null; alvo_rotulo: string | null;
  metrica: Metrica; limite: number; gasto_minimo: number; horas: number | null; acao: "avisar" | "pausar";
}
export async function salvarRegra(r: RegraNova) {
  const { id, ...linha } = r;
  const { error } = id
    ? await supabase.from("mkt_trafego_regras").update(linha).eq("id", id)
    : await supabase.from("mkt_trafego_regras").insert(linha);
  erroDe(error);
}
export async function ligarRegra(id: string, ativa: boolean) {
  const { error } = await supabase.from("mkt_trafego_regras").update({ ativa }).eq("id", id);
  erroDe(error);
}
export async function apagarRegra(id: string) {
  const { error } = await supabase.from("mkt_trafego_regras").delete().eq("id", id);
  erroDe(error);
}

export async function salvarQuemRecebe(ids: string[]) {
  const { error } = await supabase.from("mkt_trafego_config").update({ avisar_ids: ids }).eq("id", 1);
  erroDe(error);
}

/** Destino da campanha à mão ('' = volta pro do nome; '*' = vários destinos, rateio). */
export async function definirDestino(campanhaId: string, destino: string) {
  const { error } = await supabase.rpc("mkt_trafego_definir_destino", { p_campanha: campanhaId, p_destino: destino });
  erroDe(error);
}
