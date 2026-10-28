// src/expedicoes/valores/dados.ts
// Valor de cada passageiro (pedido do Bruno, 28/10): contratado, condição (padrão /
// sem aéreo / ExpedAmigo / especial com texto), pago, saldo e status. Migration 0220:
//   - exp_pax_salvar_valores(p_pax, p_patch) → grava e o banco registra quem mudou
//     (exp_valor_historico) e recalcula status_financeiro;
//   - exp_valores_financeiro(p_exp) → plano de parcelas do Financeiro (fin_planos/
//     fin_parcelas) ligado a cada passageiro, quando existir;
//   - expedicoes.preco_sem_aereo_brl → preço de referência sem aéreo.
// O saldo (saldo_brl) é coluna gerada no banco: contratado − pago.
import { supabase, lerTudo, erroOuDados, traduzirErro } from "../lib/banco";
import type { CondicaoPagamento, PassageiroRow } from "../lib/database";

export const CONDICOES: { id: CondicaoPagamento; rotulo: string; dica: string }[] = [
  { id: "padrao", rotulo: "Padrão", dica: "preço cheio, com aéreo" },
  { id: "sem_aereo", rotulo: "Sem aéreo", dica: "cliente comprou só o terrestre" },
  { id: "expedamigo", rotulo: "ExpedAmigo", dica: "condição de quem já viajou com a gente" },
  { id: "especial", rotulo: "Especial", dica: "descreva a condição" },
];
export const rotuloCondicao = (c: CondicaoPagamento | null | undefined) => CONDICOES.find((x) => x.id === (c ?? "padrao"))?.rotulo ?? "Padrão";

export type StatusFin = "Sem valor" | "Em aberto" | "Parcial" | "Quitado";
/** Mesma conta do gatilho da 0220 (vale mesmo antes da migration, quando o banco ainda grava "Em aberto"). */
export function statusFin(contratado: number, pago: number): StatusFin {
  if (!(contratado > 0)) return pago > 0 ? "Parcial" : "Sem valor";
  if (pago >= contratado) return "Quitado";
  return pago > 0 ? "Parcial" : "Em aberto";
}
export const TOM_STATUS: Record<StatusFin, "ok" | "aviso" | "erro" | "neutro"> = {
  "Sem valor": "neutro", "Em aberto": "erro", Parcial: "aviso", Quitado: "ok",
};

export type PaxValor = Pick<PassageiroRow,
  "id" | "nome_completo" | "tipo" | "status_reserva" | "cpf" | "cliente_id" | "valor_contratado_brl" | "valor_pago_brl" | "saldo_brl" | "status_financeiro"
  | "condicao_pagamento" | "condicao_obs" | "valor_atualizado_em" | "valor_atualizado_por_nome" | "created_at">;

export type PlanoFin = {
  passageiro_id: string; plano_id: string; plano_total: number | null; recebido: number; a_receber: number;
  parcelas_abertas: number; proximo_vencimento: string | null; pax_no_plano: number;
};

export type Historico = {
  id: string; passageiro_id: string; campo: string; antes: string | null; depois: string | null; usuario_nome: string | null; criado_em: string;
};

const COLS_BASE = "id, nome_completo, tipo, status_reserva, cpf, cliente_id, valor_contratado_brl, valor_pago_brl, saldo_brl, status_financeiro, created_at";
const COLS_0220 = ", condicao_pagamento, condicao_obs, valor_atualizado_em, valor_atualizado_por_nome";

/** Sem a 0220 aplicada as colunas novas não existem: lê as antigas e avisa. */
export async function carregarValores(expId: string): Promise<{ pax: PaxValor[]; planos: Map<string, PlanoFin>; historico: Historico[]; migracao: boolean }> {
  let migracao = true;
  let pax: PaxValor[];
  try {
    pax = await lerTudo<PaxValor>("passageiros", (q) => q.eq("expedicao_id", expId), COLS_BASE + COLS_0220);
  } catch {
    migracao = false;
    pax = await lerTudo<PaxValor>("passageiros", (q) => q.eq("expedicao_id", expId), COLS_BASE);
  }
  const planos = new Map<string, PlanoFin>();
  let historico: Historico[] = [];
  if (migracao) {
    const [rp, rh] = await Promise.all([
      supabase.rpc("exp_valores_financeiro", { p_exp: expId }),
      supabase.from("exp_valor_historico").select("id, passageiro_id, campo, antes, depois, usuario_nome, criado_em")
        .eq("expedicao_id", expId).order("criado_em", { ascending: false }).limit(60),
    ]);
    for (const p of (rp.data ?? []) as PlanoFin[]) planos.set(p.passageiro_id, p);
    historico = (rh.data ?? []) as Historico[];
  }
  pax.sort((a, b) => a.nome_completo.localeCompare(b.nome_completo, "pt-BR"));
  return { pax, planos, historico, migracao };
}

export type PatchValor = Partial<Pick<PassageiroRow, "valor_contratado_brl" | "valor_pago_brl" | "condicao_pagamento" | "condicao_obs">>;

export async function salvarValores(paxId: string, patch: PatchValor) {
  const { data, error } = await supabase.rpc("exp_pax_salvar_valores", { p_pax: paxId, p_patch: patch });
  if (error) {
    if (/exp_pax_salvar_valores/.test(error.message) && /not find|does not exist|schema cache/i.test(error.message)) {
      throw new Error("Falta aplicar a migration 0220 no banco pra salvar valores.");
    }
    throw new Error(traduzirErro(error.message));
  }
  return data;
}

/** Preço de referência da expedição (com aéreo = preco_venda_brl; sem aéreo = preco_sem_aereo_brl). */
export async function salvarPrecoReferencia(expId: string, campo: "preco_venda_brl" | "preco_sem_aereo_brl", valor: number | null) {
  const patch = campo === "preco_venda_brl" ? { preco_venda_brl: valor ?? 0 } : { preco_sem_aereo_brl: valor };
  erroOuDados(await supabase.from("expedicoes").update(patch).eq("id", expId));
}

/** Referência sugerida pra condição (só padrão e sem aéreo têm preço de tabela). */
export function precoSugerido(c: CondicaoPagamento | null | undefined, comAereo: number | null | undefined, semAereo: number | null | undefined): number | null {
  if ((c ?? "padrao") === "padrao") return comAereo && comAereo > 0 ? comAereo : null;
  if (c === "sem_aereo") return semAereo && semAereo > 0 ? semAereo : null;
  return null;
}

/** Totais da expedição (cancelados ficam de fora). */
export function totais(pax: PaxValor[]) {
  const ativos = pax.filter((p) => p.status_reserva !== "Cancelado");
  const vendido = ativos.reduce((s, p) => s + Number(p.valor_contratado_brl || 0), 0);
  const recebido = ativos.reduce((s, p) => s + Number(p.valor_pago_brl || 0), 0);
  const aReceber = ativos.reduce((s, p) => s + Math.max(0, Number(p.valor_contratado_brl || 0) - Number(p.valor_pago_brl || 0)), 0);
  const porStatus: Record<StatusFin, number> = { "Sem valor": 0, "Em aberto": 0, Parcial: 0, Quitado: 0 };
  const porCondicao: Record<CondicaoPagamento, number> = { padrao: 0, sem_aereo: 0, expedamigo: 0, especial: 0 };
  for (const p of ativos) {
    porStatus[statusFin(Number(p.valor_contratado_brl || 0), Number(p.valor_pago_brl || 0))]++;
    porCondicao[p.condicao_pagamento ?? "padrao"]++;
  }
  return { ativos: ativos.length, vendido, recebido, aReceber, porStatus, porCondicao };
}

const NOMES_CAMPO: Record<string, string> = {
  valor_contratado_brl: "Contratado", valor_pago_brl: "Pago", condicao_pagamento: "Condição", condicao_obs: "Texto da condição",
};
export const nomeCampo = (c: string) => NOMES_CAMPO[c] ?? c;
