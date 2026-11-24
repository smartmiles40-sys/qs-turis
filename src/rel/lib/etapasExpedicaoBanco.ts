// src/rel/lib/etapasExpedicaoBanco.ts — banco da cadência das expedições (0417).
// As regras/janelas (puras) ficam em etapasExpedicao.ts.
import { supabase } from "@/lib/supabase";
import { lotes } from "@/lib/lotes";
import type { EtapaExpId, Expedicao, RegistroEtapaExp } from "./etapasExpedicao";

const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const soma = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** Expedições com gente viajando que ainda não terminaram (até 5 dias depois da volta, pro Retorno). */
export async function expedicoesDaRotina(): Promise<{ exps: Expedicao[]; viagensPorExp: Map<string, string[]> }> {
  const hoje = hojeSP();
  const { data, error } = await supabase.from("expedicoes").select("id, nome, codigo, status, data_embarque, data_retorno")
    .gte("data_retorno", soma(hoje, -5)).order("data_embarque").limit(500);
  if (error) throw error;
  const base = ((data ?? []) as Omit<Expedicao, "pax">[]).filter((e) => !/cancel/i.test(String(e.status ?? "")));
  const viagensPorExp = new Map<string, string[]>();
  const rs = await Promise.all(lotes(base.map((e) => e.id), 100).map((l) =>
    supabase.from("rel_viagens").select("id, expedicoes_id").eq("status", "ativa").in("expedicoes_id", l).limit(5000)));
  for (const { data: vs, error: er } of rs) {
    if (er) throw er;
    for (const v of (vs ?? []) as { id: string; expedicoes_id: string }[]) viagensPorExp.set(v.expedicoes_id, [...(viagensPorExp.get(v.expedicoes_id) ?? []), v.id]);
  }
  const exps = base.map((e) => ({ ...e, pax: viagensPorExp.get(e.id)?.length ?? 0 })).filter((e) => e.pax > 0);
  return { exps, viagensPorExp };
}

export async function etapasDasExpedicoes(ids: string[]): Promise<Map<string, RegistroEtapaExp[]>> {
  const m = new Map<string, RegistroEtapaExp[]>();
  if (!ids.length) return m;
  const { data, error } = await supabase.from("rel_expedicao_etapas").select("*").in("expedicao_id", ids);
  if (error) throw error;
  for (const r of (data ?? []) as RegistroEtapaExp[]) m.set(r.expedicao_id, [...(m.get(r.expedicao_id) ?? []), r]);
  return m;
}

export async function concluirEtapaExp(p: { expedicaoId: string; etapa: EtapaExpId; userId: string; checklist: { item: string; feito: boolean }[]; houveAlteracao?: boolean | null; alteracao?: string | null; obs?: string | null }) {
  const { error } = await supabase.from("rel_expedicao_etapas").upsert({
    expedicao_id: p.expedicaoId, etapa: p.etapa, concluida_em: new Date().toISOString(), concluida_por: p.userId || null,
    checklist: p.checklist, houve_alteracao: p.houveAlteracao ?? null, alteracao: p.alteracao?.trim() || null, obs: p.obs?.trim() || null,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "expedicao_id,etapa" });
  if (error) throw error;
}

export async function desfazerEtapaExp(expedicaoId: string, etapa: EtapaExpId, antes: RegistroEtapaExp | null) {
  const { error } = await supabase.from("rel_expedicao_etapas").update({
    concluida_em: null, concluida_por: null, checklist: antes?.checklist ?? [], houve_alteracao: antes?.houve_alteracao ?? null,
    alteracao: antes?.alteracao ?? null, obs: antes?.obs ?? null, atualizado_em: new Date().toISOString(),
  }).eq("expedicao_id", expedicaoId).eq("etapa", etapa);
  if (error) throw error;
}
