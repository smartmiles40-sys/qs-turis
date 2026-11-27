// Instagram do trabalho de cada SDR (27/11): o state do OAuth é a única coisa
// que prova, na volta do Instagram, QUEM clicou em "Conectar".
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error rota JS sem tipos
import { assinarState, lerState } from "../../api/sdr-instagram.js";

const SEG = "segredo-de-teste";

test("state assinado volta o usuário", () => {
  const ts = String(Date.now());
  const st = `u-123.${ts}.${assinarState("u-123", ts, SEG)}`;
  assert.equal(lerState(st, SEG), "u-123");
});

test("state adulterado (outro usuário) é recusado", () => {
  const ts = String(Date.now());
  const st = `u-999.${ts}.${assinarState("u-123", ts, SEG)}`;
  assert.equal(lerState(st, SEG), null);
});

test("state vencido (mais de 15 min) é recusado", () => {
  const ts = String(Date.now() - 16 * 60_000);
  const st = `u-123.${ts}.${assinarState("u-123", ts, SEG)}`;
  assert.equal(lerState(st, SEG), null);
});

test("sem segredo ou lixo → null", () => {
  assert.equal(lerState("abc", SEG), null);
  assert.equal(lerState("a.b.c", ""), null);
});
