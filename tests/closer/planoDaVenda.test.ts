// O plano de pagamento montado pelo que a venda gravou (src/closer/planoDaVenda.ts, 0338).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dividirEmParcelas, formaDoPlano, pedidoDeLinkDoPlano, planoBate, planoDaVenda, somaDoPlano, somarMeses,
} from "../../src/closer/planoDaVenda.ts";

const HOJE = "2026-11-09";

test("somarMeses: fim de mês e virada de ano", () => {
  assert.equal(somarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(somarMeses("2026-11-30", 2), "2027-01-30");
  assert.equal(somarMeses("2026-12-15", 0), "2026-12-15");
});

test("dividirEmParcelas: centavos certos, a última leva a sobra", () => {
  assert.deepEqual(dividirEmParcelas(1000, 3), [333.33, 333.33, 333.34]);
  assert.deepEqual(dividirEmParcelas(0.1 + 0.2, 1), [0.3]);
  assert.equal(dividirEmParcelas(25990.9, 10).reduce((s, x) => s + Math.round(x * 100), 0), 2599090);
  assert.equal(dividirEmParcelas(100, 0).length, 1);
  assert.equal(dividirEmParcelas(100, 99).length, 48);
});

test("formaDoPlano", () => {
  assert.equal(formaDoPlano("cartao"), "cartao");
  assert.equal(formaDoPlano("PIX"), "pix");
  assert.equal(formaDoPlano("cheque"), "outro");
  assert.equal(formaDoPlano(""), "pix");
});

test("sem condição (venda antiga) ou sem valor → null (ficha pede à mão)", () => {
  assert.equal(planoDaVenda(1000, null, HOJE), null);
  assert.equal(planoDaVenda(1000, { forma: "pix" }, HOJE), null);
  assert.equal(planoDaVenda(0, { condicao: "avista", forma: "pix" }, HOJE), null);
});

test("à vista: 1 parcela do total, hoje", () => {
  const p = planoDaVenda(12345.67, { condicao: "avista", forma: "pix", parcelas: 1, obs: "Pix com desconto" }, HOJE)!;
  assert.equal(p.entrada, null);
  assert.deepEqual(p.parcelas.map((x) => [x.valor, x.vencimento, x.forma]), [[12345.67, HOJE, "pix"]]);
  assert.equal(p.observacao_financeiro, "Pix com desconto");
  assert.ok(planoBate(p, 12345.67));
});

test("parcelado: N mensais a partir da 1ª parcela; cartão = recorrente", () => {
  const p = planoDaVenda(10000, { condicao: "parcelado", forma: "cartao", parcelas: 4, primeira_parcela: "2026-12-10" }, HOJE)!;
  assert.equal(p.parcelas.length, 4);
  assert.deepEqual(p.parcelas.map((x) => x.vencimento), ["2026-12-10", "2027-01-10", "2027-02-10", "2027-03-10"]);
  assert.ok(p.parcelas.every((x) => x.recorrente && x.forma === "cartao" && x.valor === 2500));
  assert.equal(somaDoPlano(p), 10000);
});

test("parcelado sem data: começa hoje", () => {
  const p = planoDaVenda(900, { condicao: "parcelado", forma: "boleto", parcelas: "3" }, HOJE)!;
  assert.equal(p.parcelas[0].vencimento, HOJE);
  assert.ok(p.parcelas.every((x) => !x.recorrente));
});

test("entrada + parcelas: resto dividido, 1ª um mês depois da entrada se não veio data", () => {
  const p = planoDaVenda(25990, { condicao: "entrada", forma: "pix", entrada: 5990, entrada_data: "2026-11-12", parcelas: 10 }, HOJE)!;
  assert.deepEqual(p.entrada && [p.entrada.valor, p.entrada.vencimento], [5990, "2026-11-12"]);
  assert.equal(p.parcelas.length, 10);
  assert.equal(p.parcelas[0].vencimento, "2026-12-12");
  assert.equal(p.parcelas[9].vencimento, "2027-09-12");
  assert.equal(somaDoPlano(p), 25990);
  assert.ok(planoBate(p, 25990));
});

test("entrada com 1ª parcela informada e valor quebrado", () => {
  const p = planoDaVenda(1000, { condicao: "entrada", forma: "boleto", entrada: "333,33", entrada_data: HOJE, parcelas: 3, primeira_parcela: "2027-01-05" }, HOJE)!;
  assert.equal(p.entrada!.valor, 333.33);
  assert.deepEqual(p.parcelas.map((x) => x.valor), [222.22, 222.22, 222.23]);
  assert.equal(p.parcelas[0].vencimento, "2027-01-05");
  assert.equal(somaDoPlano(p), 1000);
});

test("entrada maior que o total vira o total, sem parcelas", () => {
  const p = planoDaVenda(500, { condicao: "entrada", forma: "pix", entrada: 800, entrada_data: HOJE, parcelas: 2 }, HOJE)!;
  assert.equal(p.entrada!.valor, 500);
  assert.equal(p.parcelas.length, 0);
  assert.ok(planoBate(p, 500));
});

test("planoBate: tolerância de 5 centavos e plano vazio não bate", () => {
  assert.ok(planoBate({ entrada: null, parcelas: [{ valor: 99.96, vencimento: HOJE, forma: "pix" }] }, 100));
  assert.ok(!planoBate({ entrada: null, parcelas: [{ valor: 99.9, vencimento: HOJE, forma: "pix" }] }, 100));
  assert.ok(!planoBate({ entrada: null, parcelas: [] }, 0));
});

test("pedido de link: só o parcelado (entrada fora), nº de parcelas e 1º vencimento", () => {
  const p = planoDaVenda(25990, { condicao: "entrada", forma: "cartao", entrada: 5990, entrada_data: "2026-11-12", parcelas: 10 }, HOJE)!;
  assert.deepEqual(pedidoDeLinkDoPlano(p, 25990), { valor: 20000, parcelas: 10, vencimento: "2026-12-12" });
  const av = planoDaVenda(800, { condicao: "avista", forma: "pix" }, HOJE)!;
  assert.deepEqual(pedidoDeLinkDoPlano(av, 800), { valor: 800, parcelas: 1, vencimento: HOJE });
  assert.deepEqual(pedidoDeLinkDoPlano(null, 1500), { valor: 1500, parcelas: null, vencimento: null });
  assert.deepEqual(pedidoDeLinkDoPlano(null, null), { valor: null, parcelas: null, vencimento: null });
  const soEntrada = { entrada: { valor: 300, vencimento: HOJE, forma: "pix" as const }, parcelas: [] };
  assert.deepEqual(pedidoDeLinkDoPlano(soEntrada, 300), { valor: 300, parcelas: 1, vencimento: HOJE });
});
