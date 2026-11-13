// Ponte pós-venda: planos do Financeiro que não batem com a venda.
// Rodar: npx tsx --test tests/fin/divergencias.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { explicarMotivo, ordenarDivergencias, type Divergencia } from "../../src/fin/receber/divergencias.ts";

const base: Divergencia = {
  plano_id: "p1", cliente_nome: "Ana", closer_nome: "Leo", plano_total: 10000, venda_total: 12000,
  soma_parcelas: 9000, soma_pagamentos: 12000, motivos: ["valor"], tem_parcela_paga: false, atualizado_em: "2026-11-10",
};

test("explica cada motivo com os valores", () => {
  assert.match(explicarMotivo("valor", base), /12\.000,00.*10\.000,00/);
  assert.match(explicarMotivo("parcelas_x_plano", base), /9\.000,00.*10\.000,00/);
  assert.match(explicarMotivo("parcelas_x_pagamentos", base), /9\.000,00.*12\.000,00/);
  assert.equal(explicarMotivo("outro", base), "outro");
});

test("parcela paga vem primeiro, depois o mais recente", () => {
  const r = ordenarDivergencias([
    { ...base, plano_id: "a", atualizado_em: "2026-11-12" },
    { ...base, plano_id: "b", tem_parcela_paga: true, atualizado_em: "2026-11-01" },
    { ...base, plano_id: "c", atualizado_em: "2026-11-13" },
  ]);
  assert.deepEqual(r.map((x) => x.plano_id), ["b", "c", "a"]);
});
