// Reparo da agenda (api/agenda-reparo.js), sem rede: contador de tentativas,
// erro de código que não gasta tentativa, "mais nova do lead" e o desfecho.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../api/agenda-reparo.js";

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

test("erro de código é reconhecido; erro do Bitrix não", () => {
  assert.ok(R.ehErroDeCodigo("ilegivel is not defined"));
  assert.ok(R.ehErroDeCodigo("TypeError: x.map is not a function"));
  assert.ok(R.ehErroDeCodigo("ReferenceError: foo"));
  assert.ok(R.ehErroDeCodigo("Cannot read properties of undefined (reading 'id')"));
  assert.ok(!R.ehErroDeCodigo("Bitrix recusou: Not found"));
  assert.ok(!R.ehErroDeCodigo("o Bitrix não respondeu em 12s"));
  assert.ok(!R.ehErroDeCodigo(null));
});

test("marca antiga 'desisti' por erro de código volta a ser tentada, com contador zerado", () => {
  const agora = Date.now();
  const m = R.lerMarca(`[reparo 5/5 ${iso(agora - 2 * 60 * MIN)} desisti] ilegivel is not defined`);
  assert.equal(m.n, 0);
  assert.equal(m.codigo, true);
  assert.equal(R.podeTentar(m, agora), true);
  // ...mas não a cada 10 min: espera 30.
  const recente = R.lerMarca(`[reparo 5/5 ${iso(agora - 10 * MIN)} desisti] ilegivel is not defined`);
  assert.equal(R.podeTentar(recente, agora), false);
});

test("'desisti' por erro do Bitrix continua desistido", () => {
  const agora = Date.now();
  const m = R.lerMarca(`[reparo 5/5 ${iso(agora - 24 * 60 * MIN)} desisti] Bitrix recusou: campo inválido`);
  assert.equal(m.n, 5);
  assert.equal(m.codigo, false);
  assert.equal(R.podeTentar(m, agora), false);
});

test("erro de código não soma tentativa; erro do Bitrix soma", () => {
  const base = R.lerMarca(`[reparo 2/5 ${iso(Date.now() - 60 * MIN)}] Bitrix recusou: x`);
  const cod = R.proximaMarca(base, "ilegivel is not defined");
  assert.match(cod, /^\[reparo 2\/5 \S+ código\] ilegivel is not defined$/);
  const lida = R.lerMarca(cod);
  assert.equal(lida.n, 2);
  assert.equal(lida.codigo, true);
  // Depois do conserto, o erro do Bitrix volta a contar a partir de 2.
  assert.match(R.proximaMarca(lida, "Bitrix recusou: y"), /^\[reparo 3\/5 /);
  // A 5ª de Bitrix desiste.
  const quatro = R.lerMarca(`[reparo 4/5 ${iso(Date.now() - 200 * MIN)}] Bitrix recusou: x`);
  assert.match(R.proximaMarca(quatro, "Bitrix recusou: x"), /^\[reparo 5\/5 \S+ desisti\]/);
  // Erro de código nunca vira "desisti", nem com 4 contadas.
  assert.doesNotMatch(R.proximaMarca(quatro, "x is not a function"), /desisti/);
});

test("texto sem marca (erro gravado pela tela) pode tentar já", () => {
  const m = R.lerMarca("Bitrix recusou: qualquer coisa");
  assert.equal(m.n, 0);
  assert.equal(R.podeTentar(m, Date.now()), true);
});

test("só a reunião mais nova do lead vai", () => {
  const m = { id: "b", lead_id: "L", scheduled_at: "2026-11-05T15:00:00Z" };
  assert.equal(R.haReuniaoMaisNova(m, [{ id: "a", lead_id: "L", scheduled_at: "2026-11-01T15:00:00Z" }]), false);
  assert.equal(R.haReuniaoMaisNova(m, [{ id: "c", lead_id: "L", scheduled_at: "2026-11-10T15:00:00Z" }]), true);
  assert.equal(R.haReuniaoMaisNova(m, [{ id: "c", lead_id: "OUTRO", scheduled_at: "2026-11-10T15:00:00Z" }]), false);
  assert.equal(R.haReuniaoMaisNova(m, [{ id: "b", lead_id: "L", scheduled_at: "2026-11-05T15:00:00Z" }]), false);
  // Empate: só uma das duas vai.
  const x = { id: "x", lead_id: "L", scheduled_at: "2026-11-05T15:00:00Z" };
  const y = { id: "y", lead_id: "L", scheduled_at: "2026-11-05T15:00:00Z" };
  assert.notEqual(R.haReuniaoMaisNova(x, [x, y]), R.haReuniaoMaisNova(y, [x, y]));
});

test("desfecho: mesmos eventos da tela (nota + reuniao-campos)", () => {
  const { nota, campos } = R.montarDesfecho({
    id: "m1", lead_id: "L", status: "realizada", scheduled_at: "2026-11-05T18:00:00Z", title: "Expedição Itália",
    sal: "aceito", venda_valor: 1000, venda_tipo: "Expedições", realizada_em: null, tipo: "primeira",
  });
  assert.equal(nota.event, "nota");
  assert.match(nota.body, /05\/11\/2026.*15:00.*foi REALIZADA no QS\. SAL: ACEITO\./);
  assert.deepEqual({ ...campos }, {
    event: "reuniao-campos", lead_id: "L", desfecho: "realizada", data: "2026-11-05",
    valor: 1000, tipo_venda: "Expedições", sal: "aceito", motivo: undefined,
  });
  const d = R.montarDesfecho({ id: "m2", lead_id: "L", status: "desistencia", scheduled_at: "2026-11-05T18:00:00Z", desistencia_motivo: "" });
  assert.equal(d.campos.motivo, "não informado (desistência registrada no QS antes de 22/09)");
  assert.equal(d.campos.sal, undefined);
  // Retomada não leva SAL.
  const r = R.montarDesfecho({ id: "m3", lead_id: "L", status: "no_show", scheduled_at: "2026-11-05T18:00:00Z", sal: "recusado", tipo: "retomada" });
  assert.equal(r.campos.sal, undefined);
});
