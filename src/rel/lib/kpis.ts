// src/rel/lib/kpis.ts
// -----------------------------------------------------------------------------
// KPIs de receita, expansão, Google e atendimento (Bruno, 13/10/2026).
// As contas de receita/expansão são feitas aqui no navegador a partir das
// viagens (são ~2 mil linhas); TMA/TME vêm da função rel_kpi_atendimento (0120)
// e as avaliações do Google de /api/rel-google.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

export interface ViagemKpi {
  id: string;
  cliente_id: string | null;
  tipo: string;
  valor: number | null;
  status: string;
  data_venda: string | null;
  data_embarque: string | null;
  bitrix_funil: string | null;
}

export async function carregarViagensKpi(): Promise<ViagemKpi[]> {
  const todas: ViagemKpi[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from("rel_viagens")
      .select("id, cliente_id, tipo, valor, status, data_venda, data_embarque, bitrix_funil")
      .eq("status", "ativa").order("id").range(de, de + 999);
    if (error) throw new Error(error.message);
    todas.push(...((data ?? []) as ViagemKpi[]));
    if (!data || data.length < 1000) break;
  }
  return todas.map((v) => ({ ...v, valor: v.valor == null ? null : Number(v.valor) }));
}

// ── meses ───────────────────────────────────────────────────────────────────
export const chaveMes = (iso: string) => iso.slice(0, 7);
export function mesesAte(ultimo: string, n: number): string[] {
  const [a, m] = ultimo.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
export function mesesDesde(primeiro: string, n: number): string[] {
  const [a, m] = primeiro.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}
export const rotuloMes = (k: string) => {
  const [a, m] = k.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(".", "");
};
export const ehViagem = (t: string) => t === "expedicao" || t === "pacote";
export const ehRelacionamento = (funil: string | null) => /comercial\s*2|relacionamento/i.test(funil || "");

// ── Receita ─────────────────────────────────────────────────────────────────
/**
 * MRR do Relacionamento (estimativa): não há assinatura — a "receita recorrente"
 * é a MÉDIA MENSAL das vendas do Relacionamento (funil Comercial 2) nos últimos
 * 6 meses fechados. Também devolve a série mês a mês (12 meses) pro gráfico.
 */
export function receitaRelacionamento(vs: ViagemKpi[], mesAtual: string) {
  const serie = new Map<string, number>();
  for (const v of vs) {
    if (!ehRelacionamento(v.bitrix_funil) || !v.data_venda || !v.valor) continue;
    const k = chaveMes(v.data_venda);
    serie.set(k, (serie.get(k) ?? 0) + v.valor);
  }
  const fechados = mesesAte(mesesAte(mesAtual, 2)[0], 6); // 6 meses antes do atual
  const mrr = fechados.reduce((s, k) => s + (serie.get(k) ?? 0), 0) / 6;
  const meses = mesesAte(mesAtual, 12);
  return { mrr, fechados, meses: meses.map((k) => ({ k, valor: serie.get(k) ?? 0 })) };
}

/** Receita contratada a embarcar: valor das viagens ativas por mês de embarque, próximos 12 meses. */
export function receitaAEmbarcar(vs: ViagemKpi[], mesAtual: string) {
  const meses = mesesDesde(mesAtual, 12);
  const linhas = meses.map((k) => ({ k, expedicao: 0, pacote: 0, avulsa: 0 }));
  const idx = new Map(meses.map((k, i) => [k, i]));
  for (const v of vs) {
    if (!v.data_embarque || !v.valor) continue;
    const i = idx.get(chaveMes(v.data_embarque));
    if (i === undefined) continue;
    const l = linhas[i];
    if (v.tipo === "expedicao") l.expedicao += v.valor;
    else if (v.tipo === "pacote") l.pacote += v.valor;
    else l.avulsa += v.valor;
  }
  return linhas;
}

// ── Expansão (upsell / cross-sell) ──────────────────────────────────────────
/**
 * Por mês de venda:
 *  • Recompra (upsell): % dos clientes que compraram uma viagem (expedição/pacote)
 *    no mês e JÁ tinham outra viagem comprada antes.
 *  • Cross-sell: % das vendas do mês que foram complemento (aéreo, hotel,
 *    seguro…) de quem tem expedição/pacote embarcando até 120 dias de diferença.
 * Projeção: média dos 3 últimos meses fechados, repetida nos 3 próximos.
 */
export function expansao(vs: ViagemKpi[], mesAtual: string) {
  const viagensPorCliente = new Map<string, ViagemKpi[]>();
  for (const v of vs) {
    if (!v.cliente_id || !ehViagem(v.tipo)) continue;
    viagensPorCliente.set(v.cliente_id, [...(viagensPorCliente.get(v.cliente_id) ?? []), v]);
  }
  const dataRef = (v: ViagemKpi) => v.data_venda || v.data_embarque || "";
  const meses = mesesAte(mesAtual, 12);
  const serie = meses.map((k) => {
    const doMes = vs.filter((v) => v.data_venda && chaveMes(v.data_venda) === k && v.cliente_id);
    const viagens = doMes.filter((v) => ehViagem(v.tipo));
    const compradores = new Set(viagens.map((v) => v.cliente_id!));
    let recompra = 0;
    for (const c of compradores) {
      const primeiraNoMes = viagens.filter((v) => v.cliente_id === c).map((v) => v.data_venda!).sort()[0];
      const antes = (viagensPorCliente.get(c) ?? []).some((o) => dataRef(o) && dataRef(o) < primeiraNoMes);
      if (antes) recompra++;
    }
    const avulsas = doMes.filter((v) => !ehViagem(v.tipo));
    const complemento = avulsas.filter((a) => {
      const ref = a.data_embarque || a.data_venda!;
      return (viagensPorCliente.get(a.cliente_id!) ?? []).some((o) => o.data_embarque
        && Math.abs(new Date(o.data_embarque).getTime() - new Date(ref).getTime()) <= 120 * 86_400_000);
    }).length;
    return {
      k,
      compradores: compradores.size,
      recompra,
      upsell: compradores.size ? recompra / compradores.size : null,
      vendas: doMes.length,
      complemento,
      cross: doMes.length ? complemento / doMes.length : null,
    };
  });
  const fechados = serie.slice(-4, -1); // os 3 meses antes do atual
  const media = (f: (x: (typeof serie)[number]) => number | null) => {
    const v = fechados.map(f).filter((x): x is number => x != null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const proj = { upsell: media((x) => x.upsell), cross: media((x) => x.cross) };
  const futuros = mesesDesde(mesesDesde(mesAtual, 2)[1], 3);
  return { serie, proj, futuros };
}

// ── Atendimento (TMA / TME) ─────────────────────────────────────────────────
export interface Kpi { n: number; media: number | null; mediana: number | null }
export interface KpiAtendente {
  atendente_id: string | null; nome: string | null;
  tme_n: number; tme_media: number | null; tme_mediana: number | null;
  tma_n: number; tma_media: number | null; tma_mediana: number | null;
}
export interface KpiAtendimento { tme: Kpi; tma: Kpi; por_atendente: KpiAtendente[] }

export async function carregarAtendimento(dias: number): Promise<KpiAtendimento> {
  const ate = new Date();
  const de = new Date(ate.getTime() - dias * 86_400_000);
  const { data, error } = await supabase.rpc("rel_kpi_atendimento", { p_de: de.toISOString(), p_ate: ate.toISOString() });
  if (error) {
    if (/rel_kpi_atendimento|function/i.test(error.message)) throw new Error("A conta de TMA/TME ainda não está no banco (migration 0120).");
    throw new Error(error.message);
  }
  return data as KpiAtendimento;
}

export function minutos(m: number | null | undefined): string {
  if (m == null) return "—";
  if (m < 1) return "<1 min";
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

// ── Google ──────────────────────────────────────────────────────────────────
export interface Google {
  nota: number | null; total: number | null; nome: string | null;
  fonte: "google" | "manual" | null; em: string | null; place_id: string | null; temChave: boolean; aviso?: string | null;
}

async function apiGoogle<T>(metodo: "GET" | "POST", corpo?: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/rel-google", {
    method: metodo,
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (HTTP ${r.status}).`);
  return j as T;
}
export const lerGoogle = () => apiGoogle<Google>("GET");
export const salvarPlaceId = (place_id: string) => apiGoogle<{ ok: boolean }>("POST", { acao: "place", place_id });
export const salvarGoogleManual = (nota: string, total: number) => apiGoogle<{ ok: boolean }>("POST", { acao: "manual", nota, total });
