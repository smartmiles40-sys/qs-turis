// Regras do planejamento de conteúdo (0395): rota da agência (JS) x tela (TS).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/mkt-planejamento/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as js from "../../api/_mktPlanRegras.js";
import * as ts from "../../src/mkt/planejamento/regras.ts";

const PLAN = { periodo_inicio: "2026-11-16", periodo_fim: "2026-11-22" };
const PERFIS = ["p1", "p2"];
const COMPLETO = {
  titulo: "Alto em — Islândia", formato: "reels" as const, referencias: ["https://instagram.com/reel/x"],
  adaptacao: "Trocar a trilha e usar imagens da expedição de outubro.", perfil_ids: ["p1"],
  data_postagem: "2026-11-18", horario: "19:00",
};

test("conteúdo completo não tem falta (JS e TS)", () => {
  assert.deepEqual(js.faltasDoItem(COMPLETO, PLAN, PERFIS), []);
  assert.deepEqual(ts.faltasDoItem(COMPLETO, PLAN, PERFIS), []);
});

test("cada falta é apontada igual nos dois lados", () => {
  const casos = [
    [{ titulo: "ab" }, "titulo"],
    [{ formato: "podcast" }, "formato"],
    [{ referencias: ["sem link"] }, "referencia"],
    [{ adaptacao: "curta" }, "adaptacao"],
    [{ perfil_ids: [] }, "perfil"],
    [{ perfil_ids: ["inativo"] }, "perfil"],
    [{ data_postagem: null }, "data"],
    [{ data_postagem: "2026-11-30" }, "data_fora"],
    [{ horario: "25:00" }, "horario"],
    [{ horario: null }, "horario"],
  ] as const;
  for (const [mud, falta] of casos) {
    const item = { ...COMPLETO, ...mud } as never;
    assert.deepEqual(js.faltasDoItem(item, PLAN, PERFIS), [falta], `JS ${falta}`);
    assert.deepEqual(ts.faltasDoItem(item, PLAN, PERFIS), [falta], `TS ${falta}`);
  }
});

test("planejamento vazio e texto das faltas", () => {
  assert.deepEqual(js.faltasDoPlanejamento(PLAN, [], PERFIS), [{ item_id: null, faltas: ["sem_itens"] }]);
  const itens = [COMPLETO, { ...COMPLETO, titulo: "Carrossel 2", horario: null, perfil_ids: [] }];
  const pj = js.faltasDoPlanejamento(PLAN, itens, PERFIS);
  assert.deepEqual(pj, ts.faltasDoPlanejamento(PLAN, itens, PERFIS));
  assert.deepEqual(js.textoDasFaltas(pj), ["Conteúdo 2 (Carrossel 2): falta onde vai ser postado (perfil), horário"]);
  assert.deepEqual(js.textoDasFaltas(pj), ts.textoDasFaltas(pj));
});

test("período por periodicidade", () => {
  for (const f of [js.periodoValido, ts.periodoValido]) {
    assert.equal(f("semanal", "2026-11-16", "2026-11-22"), null);
    assert.match(f("semanal", "2026-11-16", "2026-11-23") ?? "", /7 dias/);
    assert.equal(f("mensal", "2026-11-01", "2026-11-30"), null);
    assert.match(f("diario", "2026-11-16", "2026-11-17") ?? "", /um dia/);
    assert.equal(f("diario", "2026-11-16", "2026-11-16"), null);
    assert.match(f("semanal", "2026-11-22", "2026-11-16") ?? "", /inválido/);
  }
});

test("semana de uma data vai de segunda a domingo", () => {
  assert.deepEqual(ts.semanaDe("2026-11-13"), { inicio: "2026-11-09", fim: "2026-11-15" }); // sexta
  assert.deepEqual(ts.semanaDe("2026-11-16"), { inicio: "2026-11-16", fim: "2026-11-22" }); // segunda
  assert.deepEqual(ts.semanaDe("2026-11-22"), { inicio: "2026-11-16", fim: "2026-11-22" }); // domingo
});

test("link do Google Docs vira export em PDF; outro link não", () => {
  assert.equal(js.exportarGoogleDocs("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit?usp=sharing"),
    "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/export?format=pdf");
  assert.equal(js.exportarGoogleDocs("https://evil.com/document/d/1AbCdEfGhIjKlMnOpQrStUv"), null);
});

test("IA: normaliza e nunca inventa", () => {
  const perfis = [{ id: "p1", nome: "Instagram STFV" }, { id: "p2", nome: "Instagram Jacque" }];
  const n = js.normalizarItemIa({ titulo: "  X  ", formato: "podcast", referencias: ["javascript:alert(1)", "https://a.com/b"], perfis: ["instagram stfv", "Facebook"], data_postagem: "18/11", horario: "7pm" }, perfis);
  assert.deepEqual(n, { titulo: "X", formato: null, referencias: ["https://a.com/b"], adaptacao: null, perfil_ids: ["p1"], data_postagem: null, horario: null });
});
