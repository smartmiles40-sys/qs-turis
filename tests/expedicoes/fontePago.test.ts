// Ponte pós-venda: de onde vem o "Pago" (Financeiro x digitado).
// Rodar: npx tsx --test tests/expedicoes/fontePago.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pagoEfetivo } from "../../src/expedicoes/valores/fontePago.ts";

test("plano só do passageiro: vale o recebido do Financeiro", () => {
  const r = pagoEfetivo(1000, { recebido: "2500.50", pax_no_plano: 1, vencido: 300 });
  assert.equal(r.fonte, "financeiro");
  assert.equal(r.valor, 2500.5);
  assert.equal(r.digitado, 1000);
  assert.equal(r.vencido, 300);
  assert.match(r.nota, /diferente/);
});

test("Financeiro igual ao digitado: nota sem alerta", () => {
  const r = pagoEfetivo("800", { recebido: 800, pax_no_plano: 1 });
  assert.equal(r.fonte, "financeiro");
  assert.equal(r.valor, 800);
  assert.doesNotMatch(r.nota, /diferente/);
});

test("recebido zero no Financeiro ainda é a fonte (não cai pro digitado)", () => {
  const r = pagoEfetivo(500, { recebido: 0, pax_no_plano: 1 });
  assert.equal(r.fonte, "financeiro");
  assert.equal(r.valor, 0);
});

test("plano conjunto: fica o digitado, com nota", () => {
  const r = pagoEfetivo(700, { recebido: 3000, pax_no_plano: 3 });
  assert.equal(r.fonte, "digitado");
  assert.equal(r.valor, 700);
  assert.match(r.nota, /3 pessoas/);
});

test("sem plano / valores ruins: digitado, zero quando vazio", () => {
  assert.deepEqual(pagoEfetivo(null, undefined).valor, 0);
  assert.equal(pagoEfetivo("abc", null).valor, 0);
  assert.equal(pagoEfetivo(120, null).fonte, "digitado");
});
