// src/lib/qs/sla.ts
// -----------------------------------------------------------------------------
// SLA do 1º atendimento (Bruno, 17/11): RPC qs_sla_painel (0400). A Fila de
// hoje e o Desempenho leem a MESMA resposta. Contas puras em slaContas.ts.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { normalizarPainelSla, type PainelSla } from "./slaContas";
export * from "./slaContas";

/** Sem datas = Fila de hoje. Com datas (Desempenho) o bloco "faixa" vem do
 *  intervalo do filtro da página (0401). Banco ainda sem a 0401 → cai pro
 *  chamado antigo e faixa_ok=false (a tela avisa). */
export async function fetchPainelSla(de?: string, ate?: string): Promise<PainelSla> {
  if (de && ate) {
    const { data, error } = await supabase.rpc("qs_sla_painel" as never, { p_de: de, p_ate: ate } as never);
    if (!error) return normalizarPainelSla(data);
    if (error.code !== "PGRST202") throw error;
  }
  const { data, error } = await supabase.rpc("qs_sla_painel" as never);
  if (error) throw error;
  return normalizarPainelSla(data);
}
