// Testes de parseExpedicaoNome (spec §4.3). Rodar: ver docs/MAPA-EXPEDICOES.md › Testes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { juntarGrupos, nomeDaExpedicao, normalizarGrupo, parseExpedicaoNome } from "../../src/expedicoes/lib/nomeExpedicao.ts";

const casos: [string, string, string | null][] = [
  // exemplo da spec
  ["Japão & China - 2026 (Out/Nov) — G1", "Japão & China - 2026 (Out/Nov)", "G1"],
  // " - G1", " — G1", " – G1", " G1"
  ["Tailândia - G2", "Tailândia", "G2"],
  ["Tailândia — G3", "Tailândia", "G3"],
  ["Tailândia – G4", "Tailândia", "G4"],
  ["Tailândia G1", "Tailândia", "G1"],
  // "G1 - 2027" no meio
  ["Islândia G1 - 2027", "Islândia - 2027", "G1"],
  ["Islândia - G2 - 2027", "Islândia - 2027", "G2"],
  ["G1 - 2027", "2027", "G1"],
  // formato do Bitrix (rel/lib/grupos.ts)
  ["Exp. Japão e China G2 - Out e Nov/26", "Exp. Japão e China - Out e Nov/26", "G2"],
  // entre parênteses, minúsculo, "Grupo N", "G 1"
  ["Peru (G1)", "Peru", "G1"],
  ["Peru g2", "Peru", "G2"],
  ["Turquia & Grécia Grupo 3", "Turquia & Grécia", "G3"],
  ["Egito G 1 - Setembro", "Egito - Setembro", "G1"],
  // sem grupo: nada muda
  ["Peru", "Peru", null],
  ["Japão & China - 2027 (Out)", "Japão & China - 2027 (Out)", null],
  ["Expedição 4G Patagônia", "Expedição 4G Patagônia", null],
  ["China 2027 G20 Summit", "China 2027 G20 Summit", null],
  ["  ", "", null],
];

for (const [raw, base, grupo] of casos) {
  test(`parseExpedicaoNome(${JSON.stringify(raw)})`, () => {
    assert.deepEqual(parseExpedicaoNome(raw), { base, grupo });
  });
}

test("null/undefined viram nome vazio", () => {
  assert.deepEqual(parseExpedicaoNome(null), { base: "", grupo: null });
  assert.deepEqual(parseExpedicaoNome(undefined), { base: "", grupo: null });
});

test("grupo_rotulo do banco vale mais que o nome", () => {
  assert.deepEqual(nomeDaExpedicao({ nome: "Tailândia", grupo_rotulo: "2" }), { base: "Tailândia", grupo: "G2" });
  assert.deepEqual(nomeDaExpedicao({ nome: "Tailândia G1", grupo_rotulo: "Grupo 3" }), { base: "Tailândia", grupo: "G3" });
  assert.deepEqual(nomeDaExpedicao({ nome: "Tailândia G1", grupo_rotulo: null }), { base: "Tailândia", grupo: "G1" });
  assert.equal(normalizarGrupo("g01"), "G1");
  assert.equal(normalizarGrupo(""), null);
});

test("juntarGrupos", () => {
  assert.equal(juntarGrupos("Tailândia", ["G2", "G1"]), "Tailândia G1 e G2");
  assert.equal(juntarGrupos("Tailândia", ["G1", "G3", "G2"]), "Tailândia G1, G2 e G3");
  assert.equal(juntarGrupos("Peru", [null]), "Peru");
});
