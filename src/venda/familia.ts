// src/venda/familia.ts
// -----------------------------------------------------------------------------
// A PASTA da família (0351): lê venda_familia(negocios[]) — quem vai em cada
// venda do closer, com a ficha de cada pessoa (o closer não lê rel_clientes de
// quem viaja junto; a RPC confere a permissão). Regras puras: ./familiaRegras.
// Banco sem a 0351 → devolve vazio (as telas só não mostram a pasta).
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { FamiliaDaVenda } from "./familiaRegras";

const semRpc = (m: string) => /venda_familia|qs_venda_pessoas|does not exist|schema cache/i.test(m);

/** Família de cada cartão (chave = negocio_id). Em lotes de 200. */
export async function familiasDosNegocios(ids: string[]): Promise<Map<string, FamiliaDaVenda>> {
  const out = new Map<string, FamiliaDaVenda>();
  const unicos = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 200) {
    const { data, error } = await supabase.rpc("venda_familia", { p_negocios: unicos.slice(i, i + 200) });
    if (error) {
      if (semRpc(error.message)) return out;
      throw new Error(error.message);
    }
    for (const f of (data ?? []) as FamiliaDaVenda[]) {
      out.set(f.negocio_id, { ...f, pessoas: (f.pessoas ?? []).map((p) => ({ ...p, valor: p.valor != null ? Number(p.valor) : null })) });
    }
  }
  return out;
}

export async function familiaDoNegocio(negocioId: string): Promise<FamiliaDaVenda | null> {
  return (await familiasDosNegocios([negocioId])).get(negocioId) ?? null;
}
