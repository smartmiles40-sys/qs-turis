// Taxas de reunião (05/11): remarcação, remarcação → no-show e desistência.
import { test } from "node:test";
import assert from "node:assert/strict";
import { taxasDeReuniao } from "../../src/lib/qs/metricasReuniao";

test("taxas: base sem retomada, sem cancelada e sem a linha antiga do reagendamento", () => {
  const t = taxasDeReuniao([
    { status: "reagendada" },                              // linha antiga: fora
    { status: "realizada", reagendado_de: "a" },           // remarcada, realizada
    { status: "no_show", reagendado_de: "b" },             // remarcada, no-show
    { status: "agendada", reagendado_de: "c" },            // remarcada, sem desfecho
    { status: "realizada" },
    { status: "no_show" },
    { status: "desistencia" },
    { status: "cancelada" },                               // fora
    { status: "realizada", tipo: "retomada" },             // fora
  ]);
  assert.equal(t.agendamentos, 6);
  assert.equal(t.remarcados, 3);
  assert.equal(t.taxaRemarcacao, 50);
  assert.equal(t.remarcadosComDesfecho, 2);
  assert.equal(t.remarcadosNoShow, 1);
  assert.equal(t.taxaRemarcacaoNoShow, 50);
  assert.equal(t.comDesfecho, 5);
  assert.equal(t.desistencias, 1);
  assert.equal(t.taxaDesistencia, 20);
});

test("taxas: sem base devolve null (mostra —, não 0%)", () => {
  const t = taxasDeReuniao([{ status: "cancelada" }]);
  assert.equal(t.taxaRemarcacao, null);
  assert.equal(t.taxaRemarcacaoNoShow, null);
  assert.equal(t.taxaDesistencia, null);
});
