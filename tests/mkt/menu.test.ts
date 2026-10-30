// Menu do Marketing por papel (0240).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/mkt/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparRotas, rotaVisivel } from "../../src/mkt/menu.ts";

test("rota sem papéis é de todos", () => {
  assert.equal(rotaVisivel(undefined, ["trafego"], false), true);
  assert.equal(rotaVisivel([], ["trafego"], false), true);
});

test("rota com papéis: só quem tem um deles — gestor e quem não tem papel veem tudo", () => {
  assert.equal(rotaVisivel(["organico"], ["trafego"], false), false);
  assert.equal(rotaVisivel(["organico", "trafego"], ["trafego"], false), true);
  assert.equal(rotaVisivel(["gestor"], ["organico"], true), true);
  assert.equal(rotaVisivel(["gestor"], [], false), true);
});

test("agrupa na ordem dos grupos e some com grupo vazio", () => {
  const rotas = [
    { id: "biblioteca", grupo: "trafego" },
    { id: "quadro", grupo: "comum" },
    { id: "pedidos", grupo: "trafego", papeis: ["trafego"] },
    { id: "calendario", grupo: "organico", papeis: ["organico"] },
  ];
  const grupos = [{ id: "organico", rotulo: "Orgânico" }, { id: "trafego", rotulo: "Tráfego" }, { id: "comum", rotulo: "Comum" }, { id: "email", rotulo: "E-mail" }];
  const g = agruparRotas(rotas, grupos, ["trafego"], false);
  assert.deepEqual(g.map((x) => x.id), ["trafego", "comum"]);
  assert.deepEqual(g[0].rotas.map((r) => r.id), ["biblioteca", "pedidos"]);
  assert.deepEqual(agruparRotas(rotas, grupos, [], false).map((x) => x.id), ["organico", "trafego", "comum"]);
});
