// Limite de agendamento (Bruno, 10/11/2026): só até 3 dias úteis à frente.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as front from "../../src/lib/qs/limiteAgendamento.ts";
import * as api from "../../api/_limiteAgendamento.js";

// 12h UTC = 9h em São Paulo do mesmo dia.
const dia = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

test("segunda vai até quinta; quinta vai até terça", () => {
  assert.equal(front.ultimoDiaPermitido(dia("2026-11-09")), "2026-11-12"); // seg → qui
  assert.equal(front.ultimoDiaPermitido(dia("2026-11-12")), "2026-11-17"); // qui → ter
});

test("sexta, sábado e domingo vão até quarta", () => {
  assert.equal(front.ultimoDiaPermitido(dia("2026-11-13")), "2026-11-18");
  assert.equal(front.ultimoDiaPermitido(dia("2026-11-14")), "2026-11-18");
  assert.equal(front.ultimoDiaPermitido(dia("2026-11-15")), "2026-11-18");
});

test("o dia conta em São Paulo (23h de SP já é amanhã em UTC)", () => {
  // 10/11 23h em SP = 11/11 02h UTC: ainda é terça em SP → até sexta 13/11.
  assert.equal(front.ultimoDiaPermitido(new Date("2026-11-11T02:00:00Z")), "2026-11-13");
});

test("depoisDoLimite: último dia ainda pode, o seguinte não", () => {
  const agora = dia("2026-11-10"); // terça → até sexta 13/11
  assert.equal(front.depoisDoLimite(new Date("2026-11-13T21:00:00Z"), agora), false); // sex 18h SP
  assert.equal(front.depoisDoLimite(new Date("2026-11-16T13:00:00Z"), agora), true);  // seg
});

test("front e api dão a mesma conta", () => {
  for (let i = 0; i < 21; i++) {
    const agora = new Date(Date.UTC(2026, 10, 1 + i, 15));
    assert.equal(api.ultimoDiaPermitido(agora), front.ultimoDiaPermitido(agora));
  }
});

test("menorData: o prazo da campanha vence se for antes", () => {
  assert.equal(api.menorData("2026-11-11", "2026-11-13"), "2026-11-11");
  assert.equal(api.menorData(null, "2026-11-13"), "2026-11-13");
});
