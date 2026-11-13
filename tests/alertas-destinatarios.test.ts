// Alarmes da gestão — quem recebe (13/11/2026, auditoria "180 alertas, 0 lidos").
// E a bolinha do "Arrumar cadastros" (divergências ficha × expedição).
import { test } from "node:test";
import assert from "node:assert/strict";
import { destinatariosDoAlerta, setorDoAlerta } from "../api/qs-alertas.js";
import { bolinhaDasDivergencias } from "../src/clientes/divergenciasRegras.ts";

const gente = [
  { id: "a", role: "admin", setores: ["comercial", "relacionamento", "financeiro", "operacional"] },
  { id: "gc", role: "gestor", setores: ["comercial"] },
  { id: "gf", role: "gestor", setores: ["financeiro"] },
  { id: "go", role: "gestor", setores: ["operacional"] },
  { id: "gr", role: "gestor", setores: ["relacionamento"] },
  { id: "gs", role: "gestor", setores: null },
];
const ids = (l: { id: string }[]) => l.map((p) => p.id).sort();

test("alarme do Comercial: admin + gestor do Comercial (não o do Financeiro/Ops/Rel)", () => {
  assert.equal(setorDoAlerta("leads_sem_card"), "comercial");
  assert.equal(setorDoAlerta("rotina_parada:avisos"), "comercial");
  assert.deepEqual(ids(destinatariosDoAlerta("leads_sem_card", gente)), ["a", "gc"]);
  assert.deepEqual(ids(destinatariosDoAlerta("whatsapp_parado", gente)), ["a", "gc"]);
});

test("pessoas sem contato no Bitrix é do Relacionamento", () => {
  assert.equal(setorDoAlerta("pessoas_sem_bitrix"), "relacionamento");
  assert.deepEqual(ids(destinatariosDoAlerta("pessoas_sem_bitrix", gente)), ["a", "gr"]);
});

test("gestor sem setores cadastrados não recebe; lista vazia não quebra", () => {
  assert.ok(!destinatariosDoAlerta("leads_sem_card", gente).some((p) => p.id === "gs"));
  assert.deepEqual(destinatariosDoAlerta("x", undefined as unknown as []), []);
});

test("bolinha das divergências: número das abertas, vermelha só com antiga", () => {
  assert.deepEqual(bolinhaDasDivergencias({ abertas: 0, antigas: true }), { badge: undefined, alerta: false });
  assert.deepEqual(bolinhaDasDivergencias({ abertas: 110, antigas: true }), { badge: 110, alerta: true });
  assert.deepEqual(bolinhaDasDivergencias({ abertas: 3, antigas: false }), { badge: 3, alerta: false });
});
