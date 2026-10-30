// src/mkt/email/lib/api.ts
// Leitura: direto no banco (RLS 0245). Escrita de modelos/segmentos/automações e
// campanhas em RASCUNHO: direto também (RLS + CHECK do banco validam).
// Status de envio, teste, conexão e configuração: /api/mkt-email (service_role).
import { supabase } from "@/lib/supabase";
import type { Bloco } from "./blocos";

export interface Publico { listas: string[]; segmento_id: string | null; tags: string[] }
export type StatusCampanha = "rascunho" | "agendada" | "enviando" | "pausada" | "enviada" | "cancelada" | "erro";

export interface Campanha {
  id: string; nome: string; status: StatusCampanha; publico: Publico;
  remetente_nome: string | null; remetente_email: string | null; responder_para: string | null;
  assunto: string | null; preheader: string | null; blocos: Bloco[]; html: string;
  modelo_id: string | null; agendada_para: string | null; iniciada_em: string | null; concluida_em: string | null;
  total: number; erro: string | null; criado_em: string; atualizado_em: string;
}
export interface Modelo { id: string; nome: string; assunto: string | null; preheader: string | null; blocos: Bloco[]; html: string; atualizado_em: string }

export interface Condicao { campo: string; op: string; valor?: string; chave?: string }
export interface Regras { combinar: "todas" | "qualquer"; condicoes: (Condicao | Regras)[] }
export interface Segmento { id: string; nome: string; descricao: string | null; regras: Regras; atualizado_em: string }

export type Passo = { tipo: "email"; modelo_id: string } | { tipo: "esperar"; minutos: number };
export interface Automacao {
  id: string; nome: string; ativo: boolean; gatilho_tipo: "lista" | "tag" | "formulario";
  gatilho_valor: string | null; passos: Passo[]; atualizado_em: string;
}
export interface Lista { id: string; nome: string }

export interface Metricas {
  campanha_id: string; total: number; enviados: number; falhas: number; pendentes: number; entregues: number;
  abriram: number; clicaram: number; descadastros: number; bounces: number; spam: number;
}

export interface RegistroDns { record?: string; name: string; type: string; value: string; ttl?: string | number; priority?: number; status?: string }
export interface StatusConexao {
  conectado: boolean; webhook: boolean; hmac: boolean; url: string | null; urlWebhook: string | null;
  faltando: string[];
  config: {
    remetente_nome: string; remetente_email: string | null; responder_para: string | null;
    rodape_texto: string | null; rodape_endereco: string | null; por_segundo: number;
    dominio: string | null; dominio_id: string | null; dominio_status: string | null;
    dominio_registros: RegistroDns[] | null; webhook_id: string | null;
    score_pesos: Record<string, number>; score_janela_dias: number; score_recalculado_em: string | null;
  };
}

export async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/mkt-email", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as T;
}

/** Erro do PostgREST/RLS em português legível. */
export function erroDoBanco(e: { message?: string } | null | undefined): string {
  const m = String(e?.message || "Falhou.");
  if (/row-level security|42501|permission denied/i.test(m)) return "Sem permissão para esta ação (só rascunho é editável pela tela).";
  return m.replace(/^segmento: /, "Segmento: ");
}

export const status = () => chamar<StatusConexao>({ acao: "status" });

export async function listarListas(): Promise<Lista[]> {
  const { data } = await supabase.from("mkt_listas").select("id,nome").order("nome");
  return (data ?? []) as Lista[];
}
export async function listarModelos(): Promise<Modelo[]> {
  const { data } = await supabase.from("mkt_email_modelos").select("*").order("atualizado_em", { ascending: false });
  return (data ?? []) as Modelo[];
}
export async function listarSegmentos(): Promise<Segmento[]> {
  const { data } = await supabase.from("mkt_segmentos").select("*").order("nome");
  return (data ?? []) as Segmento[];
}
export async function listarCampanhas(): Promise<Campanha[]> {
  const { data } = await supabase.from("mkt_email_campanhas").select("*").order("criado_em", { ascending: false }).limit(200);
  return (data ?? []) as Campanha[];
}
export async function lerMetricas(campanhaId: string | null = null): Promise<Metricas[]> {
  const { data } = await supabase.rpc("mkt_email_metricas", { p_campanha: campanhaId });
  return (data ?? []) as Metricas[];
}

export const STATUS_ROTULO: Record<StatusCampanha, string> = {
  rascunho: "Rascunho", agendada: "Agendada", enviando: "Enviando", pausada: "Pausada",
  enviada: "Enviada", cancelada: "Cancelada", erro: "Erro",
};

export const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1).replace(".", ",")}%` : "—");

export const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—";
