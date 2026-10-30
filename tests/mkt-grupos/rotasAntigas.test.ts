import { test } from "node:test";
import assert from "node:assert/strict";
import { hashNovoDaRotaAntiga } from "../../src/mkt/grupos/rotasAntigas.ts";

test("rotas antigas dos Grupos viram abas da página única", () => {
  assert.equal(hashNovoDaRotaAntiga("#mkt/grupos-campanhas"), "#mkt/grupos");
  assert.equal(hashNovoDaRotaAntiga("#mkt/grupos-cadencias"), "#mkt/grupos?aba=cadencias");
  assert.equal(hashNovoDaRotaAntiga("#mkt/grupos-celular"), "#mkt/grupos?aba=celular");
  assert.equal(hashNovoDaRotaAntiga("#mkt/grupos-chip"), "#mkt/grupos?chip=1");
  assert.equal(hashNovoDaRotaAntiga("#/mkt/grupos-celular?jid=123%40g.us"), "#mkt/grupos?jid=123%40g.us&aba=celular");
});

test("o resto não é mexido", () => {
  assert.equal(hashNovoDaRotaAntiga("#mkt/grupos"), null);
  assert.equal(hashNovoDaRotaAntiga("#mkt/grupos?aba=celular"), null);
  assert.equal(hashNovoDaRotaAntiga("#mkt/quadro"), null);
  assert.equal(hashNovoDaRotaAntiga("#mkt/grupos-qualquer"), null);
  assert.equal(hashNovoDaRotaAntiga("#rel/grupos-campanhas"), null);
});
