// Testes de getFase / infoFase (spec §1). Rodar: ver docs/MAPA-EXPEDICOES.md › Testes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITES_FASE, dataSP, diasEntre, getFase, infoFase } from "../../src/expedicoes/lib/fase.ts";

const HOJE = "2026-10-29";

test("limites ficam numa constante só", () => {
  assert.equal(LIMITES_FASE.embarque, 30);
  assert.equal(LIMITES_FASE.preparacao, 120);
});

test("concluída: hoje depois do fim", () => {
  assert.equal(getFase("2026-10-05", "2026-10-18", HOJE), "concluida");
  assert.equal(getFase("2026-10-05", "2026-10-28", HOJE), "concluida");
});

test("em viagem: início <= hoje <= fim (inclusive nas pontas)", () => {
  assert.equal(getFase("2026-10-26", "2026-11-12", HOJE), "em_viagem");
  assert.equal(getFase("2026-10-29", "2026-11-12", HOJE), "em_viagem"); // embarca hoje
  assert.equal(getFase("2026-10-20", "2026-10-29", HOJE), "em_viagem"); // volta hoje
});

test("embarque: faltam 1 a 30 dias", () => {
  assert.equal(getFase("2026-10-30", "2026-11-10", HOJE), "embarque"); // 1 dia
  assert.equal(getFase("2026-11-28", "2026-12-10", HOJE), "embarque"); // 30 dias
});

test("preparação: faltam 31 a 120 dias", () => {
  assert.equal(getFase("2026-11-29", "2026-12-10", HOJE), "preparacao"); // 31
  assert.equal(getFase("2027-02-26", "2027-03-10", HOJE), "preparacao"); // 120
});

test("vendendo: mais de 120 dias", () => {
  assert.equal(getFase("2027-02-27", "2027-03-10", HOJE), "vendendo"); // 121
  assert.equal(getFase("2027-10-09", "2027-10-24", HOJE), "vendendo");
});

test("compara só a data em São Paulo (23h30 em SP ainda é o mesmo dia)", () => {
  // 30/10 02:30 UTC = 29/10 23:30 em SP
  const quaseMeiaNoite = new Date("2026-10-30T02:30:00Z");
  assert.equal(dataSP(quaseMeiaNoite), "2026-10-29");
  assert.equal(getFase("2026-10-30", "2026-11-10", quaseMeiaNoite), "embarque");
  // 30/10 03:30 UTC = 30/10 00:30 em SP → embarca hoje
  assert.equal(getFase("2026-10-30", "2026-11-10", new Date("2026-10-30T03:30:00Z")), "em_viagem");
});

test("aceita Date e string com horário", () => {
  assert.equal(getFase(new Date("2026-11-13T12:00:00Z"), "2026-11-28T00:00:00", HOJE), "embarque");
  assert.equal(diasEntre(HOJE, "2026-11-13"), 15);
});

test("infoFase: dia da viagem, total e volta", () => {
  const i = infoFase("2026-10-26", "2026-11-12", HOJE);
  assert.equal(i.fase, "em_viagem");
  assert.equal(i.diaDaViagem, 4);
  assert.equal(i.totalDias, 18);
  assert.equal(i.diasParaFim, 14);
  assert.ok(i.progresso > 0.2 && i.progresso < 0.25);
});

test("infoFase sem data de embarque fica em vendendo", () => {
  assert.equal(infoFase(null, null, HOJE).fase, "vendendo");
});
