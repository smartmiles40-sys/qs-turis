// Número como "CPF" (05/11): quem já trabalhou o lead fica com ele, em
// qualquer número; ninguém trabalhou → dono do chip → rodízio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { escolherDonoDoNascimento } from "../../api/_waNascimento.js";

test("responsável do Bitrix ganha até do dono do chip", () => {
  assert.deepEqual(
    escolherDonoDoNascimento({ donoDoNumero: "mariana", donoBitrix: { id: "talita", name: "Talita" } }),
    { ownerId: "talita", motivo: "bitrix" },
  );
});

test("sem histórico no Bitrix: fica com o dono do número que recebeu", () => {
  assert.deepEqual(escolherDonoDoNascimento({ donoDoNumero: "mariana" }), { ownerId: "mariana", motivo: "numero" });
});

test("número do time (1935) e ninguém trabalhou: rodízio dos SDRs", () => {
  assert.deepEqual(escolherDonoDoNascimento({}), { ownerId: null, motivo: "rodizio" });
});
