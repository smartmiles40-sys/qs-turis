// Números de teste do Relacionamento (19/11): a lista que o time configura.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://falso.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
const { limparNumerosTeste } = await import("../../api/_relDisparoOficial.js");

test("limpa: só dígitos, sem repetir, nome padrão, descarta inválido", () => {
  assert.deepEqual(limparNumerosTeste([
    { nome: " Bruno ", telefone: "(11) 98012-4183" },
    { nome: "", telefone: "11 98012 4183" },
    { nome: "Ana", telefone: "123" },
    { telefone: "5521999990000" },
    null,
  ]), [
    { nome: "Bruno", telefone: "11980124183" },
    { nome: "Teste", telefone: "5521999990000" },
  ]);
});

test("no máximo 10 e não-lista vira lista vazia", () => {
  const muitos = Array.from({ length: 15 }, (_, i) => ({ nome: `T${i}`, telefone: `119800000${String(i).padStart(2, "0")}` }));
  assert.equal(limparNumerosTeste(muitos).length, 10);
  assert.deepEqual(limparNumerosTeste("x"), []);
});
