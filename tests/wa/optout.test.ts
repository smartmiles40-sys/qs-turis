// "PARAR" do Comercial e do Rel (api/_waOptout.js). Rodar:
// node --import ./tests/registrar-ts.mjs --test tests/wa/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import { ehPedidoDeParada } from "../../api/_waOptout.js";

test("pedido de saída de verdade conta", () => {
  for (const t of [
    "PARAR", "parar", "Pare", "SAIR", "stop", "Cancelar", "descadastrar",
    "Não quero", "nao quero mais", "Não tenho interesse", "sem interesse",
    "me tira dessa lista", "me remove", "pare de mandar mensagem", "para de mandar",
    "não quero receber", "não quero receber mais mensagens", "não me mande mais",
    "por favor parar", "pode parar", "quero sair", "parar por favor", "Parar, obrigado",
    "não quero mais, obrigada", "PARAR!!!",
  ]) assert.equal(ehPedidoDeParada(t), true, t);
});

test("lead interessado NÃO é descadastrado (bug de 30/10)", () => {
  for (const t of [
    "Não quero perder a data, me manda o link?",
    "não quero perder essa viagem",
    "nao quero ficar de fora",
    "Para quando é a próxima turma?",
    "para mim e minha esposa",
    "para o Japão tem vaga?",
    "sair de qual aeroporto?",
    "pare tudo, quero fechar!",
    "remover o seguro dá desconto?",
    "cancelar a outra reserva e ficar com essa",
    "Quero saber o valor",
  ]) assert.equal(ehPedidoDeParada(t), false, t);
});

test("mensagem longa nunca é pedido de saída", () => {
  assert.equal(ehPedidoDeParada("parar " + "muito ".repeat(10)), false);
  assert.equal(ehPedidoDeParada(""), false);
  assert.equal(ehPedidoDeParada(null), false);
});
