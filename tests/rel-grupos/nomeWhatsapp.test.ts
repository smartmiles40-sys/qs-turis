// Nome do WhatsApp × nome da ficha (src/rel/lib/nomeWhatsapp.ts, 18/11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { nomeWhatsNaoBate } from "../../src/rel/lib/nomeWhatsapp.ts";

test("os dois casos do Bruno acusam", () => {
  assert.equal(nomeWhatsNaoBate("Lara Moreira", "Daíse Moreira de Castro"), true);
  assert.equal(nomeWhatsNaoBate("Tais Claudino", "Eduardo Regis Coroa Vasconcelos"), true);
  assert.equal(nomeWhatsNaoBate("Kelly", "Rosicler Plotegher Lubiana Scaldaferro"), true);
});

test("apelido e acento não acusam", () => {
  assert.equal(nomeWhatsNaoBate("Gabi Pimenta", "Gabriela pimenta Pimenta"), false);
  assert.equal(nomeWhatsNaoBate("Paty", "Patrícia krekowiski"), false);
  assert.equal(nomeWhatsNaoBate("Laize Ellen", "Laise Ellen Silva Macedo"), false);
  assert.equal(nomeWhatsNaoBate("Gloria K", "GLÓRIA KEIKO SHISHIDO DE SOUZA"), false);
  assert.equal(nomeWhatsNaoBate("Dra Marta", "Marta Darakjian"), false);
  assert.equal(nomeWhatsNaoBate("Lara Moreira", "Lara Moreira Teles de Vasconcelos"), false);
});

test("sem nome útil não acusa", () => {
  assert.equal(nomeWhatsNaoBate("A.T", "Antônio Thiago Lima"), false);
  assert.equal(nomeWhatsNaoBate(null, "Fulano"), false);
  assert.equal(nomeWhatsNaoBate("Fulano", null), false);
});
