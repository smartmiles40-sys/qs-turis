// Motivo da falha de entrega (05/11/2026): o código da Meta vira frase que o SDR entende.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import { motivoDaFalha, ehMidiaDoClienteQueNaoChegou } from "../../api/_waFalhas.js";

test("códigos conhecidos viram frase com o código no fim", () => {
  assert.match(motivoDaFalha([{ code: 131049 }]), /não cansar o cliente.*\[131049\]$/);
  assert.match(motivoDaFalha([{ code: 131047 }]), /24h/);
  assert.match(motivoDaFalha([{ code: 131026 }]), /não pode receber/);
});

test("código desconhecido usa o texto da Meta; sem erro diz que não sabe", () => {
  assert.equal(motivoDaFalha([{ code: 999, error_data: { details: "algo" } }]), "algo [999]");
  assert.match(motivoDaFalha(undefined), /não disse o motivo/);
});

test("131052 em recibo failed = arquivo do cliente que não chegou", () => {
  assert.equal(ehMidiaDoClienteQueNaoChegou({ status: "failed", errors: [{ code: 131052 }] }), true);
  assert.equal(ehMidiaDoClienteQueNaoChegou({ status: "failed", errors: [{ code: 131049 }] }), false);
  assert.equal(ehMidiaDoClienteQueNaoChegou({ status: "delivered" }), false);
});
