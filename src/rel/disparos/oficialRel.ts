// src/rel/disparos/oficialRel.ts
// -----------------------------------------------------------------------------
// DISPARO DO RELACIONAMENTO "IGUAL AO MANYCHAT" (0408) — o lado da tela.
// Tudo que ESCREVE passa por /api/disparos (setor relacionamento); ler
// campanhas, etiquetas e públicos salvos vai direto no banco (RLS).
// Regras em api/_relDisparoOficial.js e api/_relDisparoRegras.js.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { Campanha, MapaVariaveis, PublicoRel } from "@/lib/qs/disparos";
import type { EnvioExtra, KpisMkt, ModeloMkt, PrecosMkt } from "@/mkt/disparos/oficial";

export async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/disparos", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ setor: "relacionamento", ...corpo }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as T;
}

export type ModeloRel = ModeloMkt;

/** O que fazer quando a pessoa toca num botão de resposta rápida. */
export interface RespostaBotao { texto?: string; etiqueta?: string; tirar_etiqueta?: string; avisar?: boolean }
export type EnvioExtraRel = EnvioExtra & { respostas?: Record<string, RespostaBotao> };

export interface RitmoRel { por_segundo: number; por_dia: number; margem_tier: number; inicio: string; fim: string; dias: number[]; tier_padrao: string; intervalo_dias: number }
export interface NumeroTeste { nome: string; telefone: string }

export interface EstadoRel {
  /** Os números de teste (aba Número e ritmo) — o teste vai pra todos eles. */
  numerosTeste?: NumeroTeste[];
  simulacao: boolean; envLigado: boolean; real: boolean; faltam: string[]; temToken: boolean;
  numero: { phone_number_id: string; numero: string | null; rotulo?: string; conectado: boolean } | null;
  ritmo: RitmoRel; precos: PrecosMkt;
  saude: { tier: string | null; qualidade: string | null; numero: string | null; nome: string | null; status: string | null } | null;
  modelos: { total: number; aprovados: number; sincronizadoEm: string | null };
}

export type KpisRel = KpisMkt & { clicaram: number; botoes: Record<string, number> };
export interface AoVivoRel {
  status: Campanha["status"]; ultimo_erro: string | null; kpis: KpisRel | null;
  falhas: { nome: string | null; telefone: string; motivo: string | null; erro_codigo: number | null; status: string }[];
  interagiram: { nome: string | null; cliente_id: string | null; botao: string | null; clicou_em: string | null; respondeu_em: string | null; status: string }[];
}

export const estadoRel = (conferir = false) => chamar<EstadoRel>({ acao: "rel_oficial_estado", conferir });
export const sincronizarModelosRel = () => chamar<{ ok: true; total: number; aprovados: number }>({ acao: "rel_sincronizar_modelos" });
export const aoVivoRel = (campanhaId: string) => chamar<AoVivoRel>({ acao: "rel_kpis", campanhaId });
export const salvarRitmoRel = (ritmo: RitmoRel) => chamar<{ ok: true; ritmo: RitmoRel }>({ acao: "rel_salvar_ritmo", ritmo });
export const salvarNumerosTesteRel = (numeros: NumeroTeste[]) => chamar<{ ok: true; numeros: NumeroTeste[] }>({ acao: "rel_salvar_numeros_teste", numeros });

export const criarCampanhaRel = (c: { nome: string; modelo_nome: string; modelo_idioma: string; params: MapaVariaveis; publico: PublicoRel; envio_extra?: EnvioExtraRel; grupo_link?: string | null }) =>
  chamar<{ campanha: Campanha }>({ acao: "criar", ...c });

export const agendarRel = (campanhaId: string, agendada_para: string) => chamar<{ ok: true }>({ acao: "agendar", campanhaId, agendada_para });
export const desagendarRel = (campanhaId: string) => chamar<{ ok: true }>({ acao: "desagendar", campanhaId });

/** Manda UMA mensagem agora pra um número (campanha salva ou o rascunho da tela). */
export const testarRel = (telefone: string, alvo: { campanhaId: string } | { rascunho: { nome: string; modelo_nome: string; modelo_idioma: string; params: MapaVariaveis; envio_extra?: EnvioExtraRel; grupo_link?: string | null } }) =>
  chamar<{ ok: true; wamid: string }>({ acao: "rel_teste", telefone, ...alvo });

/** Manda pra TODOS os números de teste configurados. */
export const testarRelNumerosTeste = (alvo: Parameters<typeof testarRel>[1]) =>
  chamar<{ ok: true; enviados: string[]; erros: { nome: string; erro: string }[] }>({ acao: "rel_teste", paraTeste: true, ...alvo });

/** "Enviado pra Ana e Bruno" (+ quem falhou). */
export function avisoDoTeste(r: { enviados: string[]; erros: { nome: string; erro: string }[] }) {
  const ok = r.enviados.length ? `Teste enviado pra ${r.enviados.join(", ")}.` : "";
  const ruim = r.erros.length ? ` Falhou: ${r.erros.map((e) => `${e.nome} (${e.erro})`).join("; ")}` : "";
  return (ok + ruim).trim();
}

// ── Etiquetas ───────────────────────────────────────────────────────────────

export const normalizarEtiqueta = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 40);

export async function contagemEtiquetas(): Promise<{ etiqueta: string; n: number }[]> {
  const { data, error } = await supabase.rpc("rel_etiquetas_contagem");
  if (error) throw new Error(error.message);
  return (data ?? []) as { etiqueta: string; n: number }[];
}

export async function etiquetasDoCliente(clienteId: string): Promise<string[]> {
  const { data } = await supabase.from("rel_cliente_etiquetas").select("etiqueta").eq("cliente_id", clienteId).order("etiqueta");
  return ((data ?? []) as { etiqueta: string }[]).map((x) => x.etiqueta);
}

export async function porEtiqueta(clienteId: string, etiqueta: string) {
  const e = normalizarEtiqueta(etiqueta);
  if (!e) return;
  const { error } = await supabase.from("rel_cliente_etiquetas").upsert({ cliente_id: clienteId, etiqueta: e, origem: "manual" }, { onConflict: "cliente_id,etiqueta", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

export async function tirarEtiqueta(clienteId: string, etiqueta: string) {
  const { error } = await supabase.from("rel_cliente_etiquetas").delete().eq("cliente_id", clienteId).eq("etiqueta", etiqueta);
  if (error) throw new Error(error.message);
}

export const etiquetarEmMassa = (b: { etiquetas: string[]; tirar?: boolean; clientes?: string[]; publico?: PublicoRel; planilha?: string }) =>
  chamar<{ ok: true; clientes: number; sem_ficha?: number; linhas_invalidas?: number }>({ acao: "rel_etiquetar", ...b });
export const renomearEtiqueta = (de: string, para: string) => chamar<{ ok: true; clientes: number }>({ acao: "rel_etiqueta_renomear", de, para });
export const apagarEtiqueta = (etiqueta: string) => chamar<{ ok: true }>({ acao: "rel_etiqueta_apagar", etiqueta });

// ── Públicos salvos ─────────────────────────────────────────────────────────

export interface Segmento { id: string; nome: string; publico: PublicoRel; criado_em: string }
export async function listarSegmentos(): Promise<Segmento[]> {
  const { data, error } = await supabase.from("rel_disparo_segmentos").select("id, nome, publico, criado_em").order("nome");
  if (error) throw new Error(error.message);
  return (data ?? []) as Segmento[];
}
export async function salvarSegmento(nome: string, publico: PublicoRel) {
  const { error } = await supabase.from("rel_disparo_segmentos").insert({ nome: nome.trim(), publico });
  if (error) throw new Error(error.message);
}
export async function apagarSegmento(id: string) {
  const { error } = await supabase.from("rel_disparo_segmentos").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Clientes (escolher a dedo) ──────────────────────────────────────────────

export async function buscarClientes(termo: string): Promise<{ id: string; nome: string; telefone: string | null }[]> {
  const t = termo.trim();
  if (t.length < 2) return [];
  const d = t.replace(/\D/g, "");
  let q = supabase.from("rel_clientes").select("id, nome, telefone").is("mesclado_em_id", null).is("arquivado_em", null).limit(20);
  q = d.length >= 4 ? q.ilike("telefone", `%${d.slice(-8)}%`) : q.ilike("nome", `%${t}%`);
  const { data } = await q;
  return (data ?? []) as { id: string; nome: string; telefone: string | null }[];
}

export async function nomesDosClientes(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await supabase.from("rel_clientes").select("id, nome").in("id", ids.slice(0, 200));
  return new Map(((data ?? []) as { id: string; nome: string }[]).map((c) => [c.id, c.nome]));
}
