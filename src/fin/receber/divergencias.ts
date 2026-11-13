// src/fin/receber/divergencias.ts
// Ponte pós-venda (0388, fin_planos_divergentes_v): planos do Financeiro que não batem
// com a venda do QS depois de uma mudança pós-consolidação. Nada é refeito sozinho —
// a lista só mostra o que conferir. Puro (testado em tests/fin/divergencias.test.ts).

export type Divergencia = {
  plano_id: string; cliente_nome: string | null; closer_nome: string | null;
  plano_total: number | string | null; venda_total: number | string | null;
  soma_parcelas: number | string | null; soma_pagamentos: number | string | null;
  motivos: string[] | null; tem_parcela_paga: boolean | null; atualizado_em: string | null;
};

const brl = (v: unknown) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Frase curta para cada motivo da view. */
export function explicarMotivo(m: string, d: Divergencia): string {
  switch (m) {
    case "valor": return `Venda vale ${brl(d.venda_total)}, plano está em ${brl(d.plano_total)}`;
    case "parcelas_x_plano": return `Parcelas somam ${brl(d.soma_parcelas)}, plano diz ${brl(d.plano_total)}`;
    case "parcelas_x_pagamentos": return `Parcelas somam ${brl(d.soma_parcelas)}, a forma de pagamento da venda soma ${brl(d.soma_pagamentos)}`;
    default: return m;
  }
}

/** Ordem: quem já tem parcela paga primeiro (mais delicado), depois o mais recente. */
export function ordenarDivergencias(lista: Divergencia[]): Divergencia[] {
  return [...lista].sort((a, b) =>
    Number(!!b.tem_parcela_paga) - Number(!!a.tem_parcela_paga)
    || String(b.atualizado_em ?? "").localeCompare(String(a.atualizado_em ?? "")));
}
