// src/clientes/visaoCruzada.ts
// -----------------------------------------------------------------------------
// VISÃO CRUZADA (13/11/2026) — as chamadas às RPCs 0381–0384. Regra de ouro:
// a tela funciona COM ou SEM as migrations. Função ausente → `null` (a tela
// cai no comportamento antigo / esconde o bloco). Sem acesso → `null` também:
// é informação de apoio, nunca erro na cara de quem está atendendo.
// Nada de dado pessoal em log.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import {
  semMigration,
  type ContextoComercial, type LinhaPessoa, type ParcelaReal, type ResumoSetores,
} from "./visaoCruzadaRegras";

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    const { data, error } = await supabase.rpc(nome, args);
    if (error) {
      if (!semMigration(error)) console.warn(`[visao-cruzada] ${nome}: ${error.code ?? "erro"}`);
      return null;
    }
    return (data ?? null) as T | null;
  } catch {
    return null;
  }
}

/** Resumo da pessoa dona deste lead (faixa "Cliente da casa"). null = sem ficha / sem migration. */
export const resumoDoLead = (leadId: string) => rpc<ResumoSetores>("lead_resumo_setores", { p_lead: leadId });

/** Resumo da pessoa pela ficha. */
export const resumoDaPessoa = (clienteId: string) => rpc<ResumoSetores>("cliente_resumo_setores", { p_cliente: clienteId });

/** O que o Comercial viveu com a pessoa (Rel/Ops/Fin/gestor). */
export const contextoComercial = (clienteId: string) => rpc<ContextoComercial>("pessoa_contexto_comercial", { p_cliente: clienteId });

/** Linha do tempo unificada. null = RPC ausente → a ficha fica com a linha antiga. */
export const linhaDoTempoDaPessoa = (clienteId: string, limite = 200) =>
  rpc<LinhaPessoa[]>("pessoa_linha_do_tempo", { p_cliente: clienteId, p_limite: limite });

/** Parcelas reais do plano do negócio. null = RPC ausente → o cartão usa o caminho antigo. */
export const parcelasDoNegocio = (negocioId: string) => rpc<ParcelaReal[]>("negocio_parcelas", { p_negocio: negocioId });
