// Testes dos rótulos/formatação dos campos do cadastro único (src/clientes/camposCadastro.ts).
// 'nome' entrou com a 0379 (o nome também é sincronizado ficha ↔ ida).
import { test } from "node:test";
import assert from "node:assert/strict";
import { NOME_CAMPO, rotuloCampo, valorLegivel, type CampoDivergente } from "../../src/clientes/camposCadastro.ts";

// Os mesmos valores do CHECK de cad_divergencias.campo na 0379.
const CAMPOS_DO_BANCO: CampoDivergente[] = ["pessoa", "cpf", "passaporte", "passaporte_validade", "nascimento", "email", "telefone", "nome"];

test("todo campo que o banco aceita em cad_divergencias tem rótulo", () => {
  for (const c of CAMPOS_DO_BANCO) assert.ok(NOME_CAMPO[c]?.length, `sem rótulo: ${c}`);
  assert.equal(NOME_CAMPO.nome, "Nome");
});

test("rotuloCampo não devolve undefined pra campo desconhecido", () => {
  assert.equal(rotuloCampo("nome"), "Nome");
  assert.equal(rotuloCampo("rg"), "rg");
});

test("valorLegivel formata datas e CPF e deixa nome como veio", () => {
  assert.equal(valorLegivel("nascimento", "1990-05-07"), "07/05/1990");
  assert.equal(valorLegivel("cpf", "12345678901"), "123.456.789-01");
  assert.equal(valorLegivel("nome", "Maria da Silva"), "Maria da Silva");
  assert.equal(valorLegivel("nome", null), "—");
});
