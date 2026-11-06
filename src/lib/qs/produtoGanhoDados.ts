// src/lib/qs/produtoGanhoDados.ts
// -----------------------------------------------------------------------------
// Produto no "Ganho / Agendou" (06/11) — a parte que fala com o banco (0321).
// Sem a migration aplicada, tudo aqui degrada: lista de expedições vazia (o SDR
// escreve o destino), ganho do SDR não grava (avisa) e a métrica fica vazia.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "./queries";
import type { ExpedicaoAVenda, GanhoSdrParaDemanda, ProdutoTipo, ReuniaoParaDemanda } from "./produtoGanho";

const semSchema = (code?: string | null) => code === "42P01" || code === "42883" || code === "PGRST202" || code === "PGRST205" || code === "42703";

let cacheExpedicoes: { em: number; lista: ExpedicaoAVenda[] } | null = null;

/** Expedições à venda no Operacional (cache de 5 min — a lista muda pouco). */
export async function fetchExpedicoesAVenda(): Promise<ExpedicaoAVenda[]> {
  if (cacheExpedicoes && Date.now() - cacheExpedicoes.em < 5 * 60_000) return cacheExpedicoes.lista;
  const { data, error } = await supabase.rpc("qs_expedicoes_a_venda");
  if (error) {
    if (!semSchema(error.code)) console.warn("[QS] expedições à venda:", error.message);
    return [];
  }
  const lista = (data ?? []) as ExpedicaoAVenda[];
  cacheExpedicoes = { em: Date.now(), lista };
  return lista;
}

/** Ganho que o próprio SDR faz (aéreo que ele emite). true = gravou. */
export async function registrarGanhoSdr(input: {
  leadId: string;
  ownerId: string;
  produtoTipo: ProdutoTipo;
  descricao: string | null;
}): Promise<boolean> {
  const { error } = await supabase.from("qs_ganhos_sdr").insert({
    lead_id: input.leadId,
    owner_id: input.ownerId,
    produto_tipo: input.produtoTipo,
    descricao: input.descricao?.trim() || null,
  });
  if (error) {
    console.warn("[QS] ganho do SDR não gravou:", error.message);
    return false;
  }
  return true;
}

/** Base da métrica "Demanda por produto" no período [desde, ate). */
export async function fetchBaseDemanda(
  desde: Date,
  ate: Date,
  ownerId?: string | null,
): Promise<{ reunioes: ReuniaoParaDemanda[]; ganhosSdr: GanhoSdrParaDemanda[]; semMigration: boolean }> {
  let semMigration = false;
  const reunioes = await fetchAllRows<ReuniaoParaDemanda>((from, to) => {
    let q = supabase
      .from("qs_meetings")
      .select("id, owner_id, produto_tipo, tipo, status")
      .gte("created_at", desde.toISOString())
      .lt("created_at", ate.toISOString())
      .order("id")
      .range(from, to);
    if (ownerId) q = q.eq("owner_id", ownerId);
    return q;
  }).catch((e: { code?: string; message?: string }) => {
    if (semSchema(e?.code)) semMigration = true;
    else console.warn("[QS] demanda por produto (reuniões):", e?.message);
    return [] as ReuniaoParaDemanda[];
  });
  const ganhosSdr = await fetchAllRows<GanhoSdrParaDemanda>((from, to) => {
    let q = supabase
      .from("qs_ganhos_sdr")
      .select("id, owner_id, produto_tipo")
      .gte("created_at", desde.toISOString())
      .lt("created_at", ate.toISOString())
      .order("id")
      .range(from, to);
    if (ownerId) q = q.eq("owner_id", ownerId);
    return q;
  }).catch((e: { code?: string; message?: string }) => {
    if (semSchema(e?.code)) semMigration = true;
    else console.warn("[QS] demanda por produto (ganhos do SDR):", e?.message);
    return [] as GanhoSdrParaDemanda[];
  });
  return { reunioes, ganhosSdr, semMigration };
}
