// src/clientes/divergenciasRegras.ts
// Regra pura da bolinha "Arrumar cadastros" (ponte/pedidos, 13/11/2026) — sem
// supabase, pra testar (tests/clientes/divergencias.test.ts).

export interface ContagemDivergencias {
  abertas: number;
  /** Alguma aberta há mais de DIAS_DIVERGENCIA_ANTIGA dias (a bolinha fica vermelha). */
  antigas: boolean;
}

export const DIAS_DIVERGENCIA_ANTIGA = 7;

/** A bolinha do menu a partir da contagem: o número das abertas; vermelha se tem antiga. */
export function bolinhaDasDivergencias(c: ContagemDivergencias): { badge?: number; alerta: boolean } {
  return { badge: c.abertas > 0 ? c.abertas : undefined, alerta: c.abertas > 0 && c.antigas };
}
