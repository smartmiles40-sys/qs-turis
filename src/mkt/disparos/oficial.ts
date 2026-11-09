// src/mkt/disparos/oficial.ts
// -----------------------------------------------------------------------------
// DISPARO OFICIAL DO MARKETING (0341) — o lado da tela.
// Tudo pela rota /api/disparos (setor marketing): estado das travas, sincronizar
// os modelos da WABA, KPIs ao vivo, ritmo e preços. Regras em
// api/_mktDisparoOficial.js e api/_mktOficialRegras.js.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { Campanha, MapaVariaveis, ModeloDisparo } from "@/lib/qs/disparos";
import type { PublicoMkt } from "./api";

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/disparos", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ setor: "marketing", ...corpo }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as T;
}

/** O modelo como vem da WABA do Marketing (sincronizado) — o ModeloDisparo + extras. */
export interface BotaoModelo { indice: number; tipo: string; texto: string; variavel: boolean }
export type ModeloMkt = ModeloDisparo & {
  origem?: "meta";
  categoriaMeta?: string | null;
  statusMeta?: string | null;
  cabecalhoFormato?: string | null;
  precisaMidia?: boolean;
  variaveisTopo?: string[];
  botoes?: BotaoModelo[];
};

export type FonteExtra = "nome" | "destino" | "texto" | "campo";
export interface EnvioExtra {
  midia?: { link?: string; id?: string; nome?: string };
  topo?: { fonte: FonteExtra; valor?: string };
  botoes?: Record<string, { fonte: FonteExtra; valor?: string }>;
}

export interface RitmoMkt { por_segundo: number; por_dia: number; margem_tier: number; inicio: string; fim: string; dias: number[]; tier_padrao: string }
export interface PrecosMkt { moeda: string; marketing: number | null; utility: number | null; authentication: number | null }
export interface EstadoOficial {
  simulacao: boolean; envLigado: boolean; real: boolean; faltam: string[]; temToken: boolean;
  numero: { phone_number_id: string; numero: string | null; rotulo: string } | null;
  ritmo: RitmoMkt; precos: PrecosMkt;
  saude: { tier: string | null; qualidade: string | null; numero: string | null; nome: string | null; status: string | null } | null;
  modelos: { total: number; aprovados: number; sincronizadoEm: string | null };
}

export interface KpisMkt {
  total: number; na_fila: number; enviados: number; entregues: number; lidos: number; responderam: number;
  falharam: number; pulados: number; cancelados: number; simulados: number;
  cobraveis: Record<string, number>; erros: Record<string, number>; ultimo_envio: string | null;
  custo: { total: number; moeda: string; completo: boolean };
}
export interface AoVivo {
  status: Campanha["status"]; ultimo_erro: string | null; kpis: KpisMkt | null;
  falhas: { nome: string | null; telefone: string; motivo: string | null; erro_codigo: number | null; status: string }[];
}

export const estadoOficial = (conferir = false) => chamar<EstadoOficial>({ acao: "mkt_oficial_estado", conferir });
export const sincronizarModelos = () => chamar<{ ok: true; total: number; aprovados: number }>({ acao: "mkt_sincronizar_modelos" });
export const aoVivo = (campanhaId: string) => chamar<AoVivo>({ acao: "mkt_kpis", campanhaId });
export const salvarRitmoOficial = (ritmo: RitmoMkt) => chamar<{ ok: true; ritmo: RitmoMkt }>({ acao: "mkt_salvar_ritmo_oficial", ritmo });
export const salvarPrecos = (precos: PrecosMkt) => chamar<{ ok: true; precos: PrecosMkt }>({ acao: "mkt_salvar_precos", precos });

/** Cria a campanha do Marketing já com os extras do modelo (mídia, topo, botões). */
export const criarCampanhaMkt = (c: { nome: string; modelo_nome: string; modelo_idioma: string; params: MapaVariaveis; publico: PublicoMkt; envio_extra?: EnvioExtra }) =>
  chamar<{ campanha: Campanha }>({ acao: "criar", ...c });

const temValor = (x?: { fonte: FonteExtra; valor?: string }) => !!x && (!["texto", "campo"].includes(x.fonte) || !!(x.valor ?? "").trim());

/** Os extras que o modelo pede estão preenchidos? (o servidor confere de novo) */
export function extrasOk(m: ModeloMkt | null, e: EnvioExtra): boolean {
  if (!m) return false;
  if (m.precisaMidia && !/^https:\/\/\S+$/i.test(e.midia?.link ?? "") && !/^\d{5,30}$/.test(e.midia?.id ?? "")) return false;
  if ((m.variaveisTopo ?? []).length && !temValor(e.topo)) return false;
  for (const b of m.botoes ?? []) if (b.tipo === "URL" && b.variavel && !temValor(e.botoes?.[String(b.indice)])) return false;
  return true;
}

export const ROTULO_CATEGORIA: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Utilidade", AUTHENTICATION: "Autenticação" };
export const ROTULO_TIER: Record<string, string> = {
  TIER_50: "50 por dia", TIER_250: "250 pessoas / 24 h", TIER_1K: "1.000 pessoas / 24 h", TIER_2K: "2.000 pessoas / 24 h",
  TIER_10K: "10.000 pessoas / 24 h", TIER_100K: "100.000 pessoas / 24 h", TIER_UNLIMITED: "sem limite",
};
