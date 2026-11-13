// src/expedicoes/valores/fontePago.ts
// Ponte pós-venda (0387): de onde vem o "Pago" de um passageiro.
// Regra: se o Financeiro tem um plano SÓ dele (pax_no_plano === 1), o pago é o que o
// Financeiro recebeu (fin_parcelas pagas) — é a fonte da verdade. Plano conjunto
// (várias pessoas no mesmo plano) não dá pra dividir com segurança: fica o valor
// digitado no Operacional, com nota. Sem plano: digitado.
// Puro (sem React/Supabase) pra ser testado em tests/expedicoes/fontePago.test.ts.

export type PlanoParaPago = {
  recebido: number | string | null;
  pax_no_plano: number | null;
  vencido?: number | string | null;
  parcelas_vencidas?: number | null;
} | null | undefined;

export type FontePago = "financeiro" | "digitado";

export type PagoEfetivo = {
  valor: number;
  fonte: FontePago;
  /** Valor digitado no Operacional (para mostrar quando difere do Financeiro). */
  digitado: number;
  /** Quanto está vencido no Financeiro (0 se não souber). */
  vencido: number;
  /** Texto curto explicando a fonte (tooltip / legenda). */
  nota: string;
};

const num = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

export function pagoEfetivo(manual: number | string | null | undefined, plano: PlanoParaPago): PagoEfetivo {
  const digitado = num(manual);
  if (plano && plano.pax_no_plano === 1) {
    const valor = num(plano.recebido);
    return {
      valor, fonte: "financeiro", digitado, vencido: num(plano.vencido),
      nota: valor === digitado ? "Pago conforme o Financeiro." : "Pago conforme o Financeiro (o valor digitado no Operacional era diferente).",
    };
  }
  if (plano && num(plano.pax_no_plano) > 1) {
    return {
      valor: digitado, fonte: "digitado", digitado, vencido: 0,
      nota: `Plano conjunto (${plano.pax_no_plano} pessoas): o Financeiro não separa por passageiro — vale o valor digitado.`,
    };
  }
  return { valor: digitado, fonte: "digitado", digitado, vencido: 0, nota: "Valor digitado no Operacional (sem plano no Financeiro)." };
}
