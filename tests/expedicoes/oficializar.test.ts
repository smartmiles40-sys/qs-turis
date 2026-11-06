// Preparação da troca (06/11/2026): "Liberar todos" por link mágico, rotas
// desativadas do antigo (da4d0ba) e papel do login criado pras Expedições.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import { quemRecebeLink } from "../../api/_expAcesso.js";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import { ROTA_DESATIVADA } from "../../api/expedicoes.js";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import { papelQsDaExp } from "../../api/admin-user.js";

const pax = (id: string, cpf: string | null, extra: Record<string, unknown> = {}) => ({
  id, nome_completo: `Pessoa ${id}`, cpf, telefone: "11999990000", created_at: `2026-01-0${id.length}`, status_reserva: "Confirmado", ...extra,
});

test("liberar todos: um link por CPF, pula quem já tem senha, cancelado e sem CPF", () => {
  const r = quemRecebeLink([
    pax("a", "123.456.789-01"),
    pax("bb", "12345678901"),               // mesmo CPF, linha mais nova → não repete
    pax("c", "98765432100"),                // já tem senha própria
    pax("d", null),                          // sem CPF
    pax("e", "11122233344", { status_reserva: "Cancelado" }),
  ], new Set(["98765432100"]));
  assert.equal(r.total, 4);                  // cancelado não conta
  assert.equal(r.ja_tinham_senha, 1);
  assert.equal(r.sem_cpf, 1);
  assert.deepEqual(r.receber.map((x: { passageiro_id: string; cpf: string }) => [x.passageiro_id, x.cpf]), [["a", "12345678901"]]);
});

test("liberar todos: lista vazia não quebra", () => {
  assert.deepEqual(quemRecebeLink([], new Set()), { total: 0, ja_tinham_senha: 0, receber: [], sem_cpf: 0 });
});

test("rotas desativadas iguais ao antigo (da4d0ba): sync-contato segue ativa", () => {
  for (const r of ["onboarding-diario", "passageiro-sync", "expedicao-sync", "importar-compras"]) assert.equal(ROTA_DESATIVADA[r], true, r);
  assert.equal(ROTA_DESATIVADA["sync-contato"], undefined);
});

test("login criado pras Expedições: relacionamento fica no Rel, o resto em Operações", () => {
  assert.equal(papelQsDaExp("relacionamento"), "relacionamento");
  for (const p of ["admin", "operacional", "leitura", undefined]) assert.equal(papelQsDaExp(p), "operacional");
});
