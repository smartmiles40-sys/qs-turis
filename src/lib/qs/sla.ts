// src/lib/qs/sla.ts
// -----------------------------------------------------------------------------
// SLA do 1º atendimento (Bruno, 17/11): RPC qs_sla_painel (0400). A Fila de
// hoje e o Desempenho leem a MESMA resposta. Contas puras em slaContas.ts.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { normalizarPainelSla, type PainelSla } from "./slaContas";
export * from "./slaContas";

export async function fetchPainelSla(): Promise<PainelSla> {
  const { data, error } = await supabase.rpc("qs_sla_painel" as never);
  if (error) throw error;
  return normalizarPainelSla(data);
}
