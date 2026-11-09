// src/closer/planoDaVenda.ts
// -----------------------------------------------------------------------------
// O PLANO DE PAGAMENTO QUE JÁ VEM DA VENDA (0338, Bruno 09/11/2026: "tudo
// digitado UMA vez no QS"). O closer diz como o cliente vai pagar no Registrar
// venda (qs_vendas.pagamento: forma, condição, entrada, nº de parcelas, 1ª
// parcela); a ficha de fechamento monta as parcelas daqui e o closer só confere
// os vencimentos. Também alimenta o "Pedir link ao Financeiro".
//
// Lógica pura (sem banco, sem React) — testada em tests/closer/planoDaVenda.test.ts.
// -----------------------------------------------------------------------------

/** Formas que o Financeiro conhece (fin_parcelas.forma). */
export type FormaPlano = "pix" | "boleto" | "cartao" | "link" | "transferencia" | "dinheiro" | "outro";
const FORMAS_PLANO: FormaPlano[] = ["pix", "boleto", "cartao", "link", "transferencia", "dinheiro", "outro"];

/** Como a venda grava o pagamento (src/venda/api.ts → montarPayload). */
export interface PagamentoDaVenda {
  forma?: string | null;
  condicao?: string | null;            // "avista" | "parcelado" | "entrada"
  entrada?: number | string | null;
  entrada_data?: string | null;
  parcelas?: number | string | null;
  primeira_parcela?: string | null;
  obs?: string | null;
}

export interface ParcelaPlano { valor: number; vencimento: string; forma: FormaPlano; recorrente?: boolean; observacao?: string }
export interface PlanoMontado { entrada: ParcelaPlano | null; parcelas: ParcelaPlano[]; observacao_financeiro: string }

/** Soma N meses a uma data YYYY-MM-DD (dia 31 vira o último dia do mês). */
export function somarMeses(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

const ehData = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const centavos = (v: number) => Math.round(v * 100);

/** Forma da venda → forma do plano (desconhecida vira "outro"). */
export function formaDoPlano(forma: string | null | undefined): FormaPlano {
  const f = String(forma ?? "").trim().toLowerCase();
  return (FORMAS_PLANO as string[]).includes(f) ? (f as FormaPlano) : f ? "outro" : "pix";
}

/** Divide um valor em N partes iguais em centavos; a última leva a sobra. */
export function dividirEmParcelas(valor: number, n: number): number[] {
  const q = Math.max(1, Math.min(48, Math.floor(n) || 1));
  const total = Math.max(0, centavos(valor));
  const base = Math.floor(total / q);
  return Array.from({ length: q }, (_, i) => (i === q - 1 ? total - base * (q - 1) : base) / 100);
}

/**
 * Monta o plano a partir do que a venda gravou. null quando a venda não diz a
 * condição (venda antiga ou sem pagamento) — aí a ficha pede o plano à mão.
 *
 *   • à vista   → 1 parcela do total, no dia da 1ª parcela/entrada ou hoje;
 *   • parcelado → N parcelas mensais a partir da 1ª parcela (ou hoje);
 *   • entrada   → entrada na data dela + N parcelas mensais do restante a partir
 *                 da 1ª parcela (ou 1 mês depois da entrada).
 */
export function planoDaVenda(total: number, pg: PagamentoDaVenda | null | undefined, hoje: string): PlanoMontado | null {
  if (!pg || !(total > 0)) return null;
  const condicao = String(pg.condicao ?? "").trim();
  if (!["avista", "parcelado", "entrada"].includes(condicao)) return null;
  const forma = formaDoPlano(pg.forma);
  const recorrente = forma === "cartao";
  const obs = String(pg.obs ?? "").trim();
  const base = ehData(hoje) ? hoje : new Date().toISOString().slice(0, 10);

  if (condicao === "avista") {
    const venc = ehData(pg.primeira_parcela) ? pg.primeira_parcela : ehData(pg.entrada_data) ? pg.entrada_data : base;
    return { entrada: null, parcelas: [{ valor: centavos(total) / 100, vencimento: venc, forma, recorrente: false, observacao: "" }], observacao_financeiro: obs };
  }

  let entrada: ParcelaPlano | null = null;
  let resto = total;
  let primeira = ehData(pg.primeira_parcela) ? pg.primeira_parcela : base;
  if (condicao === "entrada") {
    const vEnt = Math.min(Math.max(0, num(pg.entrada)), total);
    const dEnt = ehData(pg.entrada_data) ? pg.entrada_data : base;
    if (vEnt > 0) {
      entrada = { valor: centavos(vEnt) / 100, vencimento: dEnt, forma, recorrente: false, observacao: "" };
      resto = (centavos(total) - centavos(vEnt)) / 100;
    }
    if (!ehData(pg.primeira_parcela)) primeira = somarMeses(dEnt, 1);
  }
  if (resto <= 0.005) return { entrada, parcelas: [], observacao_financeiro: obs };

  const n = Math.max(1, Math.min(48, Math.floor(num(pg.parcelas)) || 1));
  const parcelas = dividirEmParcelas(resto, n).map((valor, i) => ({
    valor, vencimento: somarMeses(primeira, i), forma, recorrente, observacao: "",
  }));
  return { entrada, parcelas, observacao_financeiro: obs };
}

/** Soma do plano (entrada + parcelas). */
export function somaDoPlano(p: Pick<PlanoMontado, "entrada" | "parcelas">): number {
  return (centavos(p.entrada?.valor || 0) + p.parcelas.reduce((s, x) => s + centavos(Number(x.valor) || 0), 0)) / 100;
}

/** O plano fecha com o total (tolerância de 5 centavos, a mesma do closer_consolidar)? */
export function planoBate(p: Pick<PlanoMontado, "entrada" | "parcelas">, total: number): boolean {
  return Math.abs(somaDoPlano(p) - total) <= 0.05 && somaDoPlano(p) > 0;
}

/** O que vai pro pedido de link ao Financeiro: valor do link, nº de parcelas e 1º vencimento. */
export function pedidoDeLinkDoPlano(p: Pick<PlanoMontado, "entrada" | "parcelas"> | null, totalFallback: number | null):
  { valor: number | null; parcelas: number | null; vencimento: string | null } {
  if (!p || (!p.entrada && !p.parcelas.length)) return { valor: totalFallback && totalFallback > 0 ? totalFallback : null, parcelas: null, vencimento: null };
  // O link é do que vai parcelado (sem a entrada, que costuma ir no Pix); sem parcelas, é a própria entrada.
  if (p.parcelas.length) {
    const valor = p.parcelas.reduce((s, x) => s + centavos(Number(x.valor) || 0), 0) / 100;
    const venc = [...p.parcelas].map((x) => x.vencimento).filter(ehData).sort()[0] ?? null;
    return { valor, parcelas: p.parcelas.length, vencimento: venc };
  }
  return { valor: p.entrada!.valor, parcelas: 1, vencimento: ehData(p.entrada!.vencimento) ? p.entrada!.vencimento : null };
}
