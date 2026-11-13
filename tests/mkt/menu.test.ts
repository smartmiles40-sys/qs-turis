// Menu do Marketing por papel (0240) e por VISÃO de time (0395).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/mkt/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparRotas, rotaVisivel, timesDe, visaoValida, visoesDe } from "../../src/mkt/menu.ts";

test("rota sem papéis é de todos", () => {
  assert.equal(rotaVisivel(undefined, "trafego", false), true);
  assert.equal(rotaVisivel([], "organico", false), true);
});

test("rota de time só aparece na visão daquele time (ou em Tudo)", () => {
  assert.equal(rotaVisivel(["organico"], "trafego", false), false);
  assert.equal(rotaVisivel(["organico"], "organico", false), true);
  assert.equal(rotaVisivel(["organico", "trafego"], "trafego", false), true);
  assert.equal(rotaVisivel(["organico"], "tudo", false), true);
});

test("rota de gestor só pra gestor, em qualquer visão", () => {
  assert.equal(rotaVisivel(["gestor"], "tudo", false), false);
  assert.equal(rotaVisivel(["gestor"], "organico", true), true);
});

test("times e visões", () => {
  assert.deepEqual(timesDe(["sup_organico"]), ["organico"]);
  assert.deepEqual(timesDe(["trafego", "organico"]), ["organico", "trafego"]);
  assert.deepEqual(visoesDe([], false), ["tudo"]);
  assert.deepEqual(visoesDe(["sup_trafego"], false), ["trafego"]);
  assert.deepEqual(visoesDe(["organico"], true), ["tudo", "organico", "trafego"]);
  assert.equal(visaoValida("trafego", ["organico"]), "organico");
  assert.equal(visaoValida("trafego", ["organico", "trafego"]), "trafego");
  assert.equal(visaoValida(null, ["tudo", "organico"]), "tudo");
});

test("agrupa na ordem dos grupos e some com grupo vazio", () => {
  const rotas = [
    { id: "biblioteca", grupo: "trafego", papeis: ["trafego"] },
    { id: "quadro", grupo: "comum" },
    { id: "pedidos", grupo: "trafego", papeis: ["trafego"] },
    { id: "calendario", grupo: "organico", papeis: ["organico"] },
  ];
  const grupos = [{ id: "organico", rotulo: "Orgânico" }, { id: "trafego", rotulo: "Tráfego" }, { id: "comum", rotulo: "Comum" }, { id: "email", rotulo: "E-mail" }];
  const g = agruparRotas(rotas, grupos, "trafego", false);
  assert.deepEqual(g.map((x) => x.id), ["trafego", "comum"]);
  assert.deepEqual(g[0].rotas.map((r) => r.id), ["biblioteca", "pedidos"]);
  assert.deepEqual(agruparRotas(rotas, grupos, "tudo", false).map((x) => x.id), ["organico", "trafego", "comum"]);
});
