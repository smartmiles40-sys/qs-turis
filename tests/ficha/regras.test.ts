// Testes das regras puras da Ficha do Cliente (src/rel/clientes/ficha/regras.ts).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/ficha/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparSeguidos, alertaSeisMeses, calcularCompletude, dataValida, normalizarFoneEmergencia, passaportesAntigos,
  resumirMudancaIda, somarDias, somarMeses, voltaDeReferencia, type DadosCompletude,
} from "../../src/rel/clientes/ficha/regras.ts";

const HOJE = "2026-10-30";

test("somarMeses não estoura o fim do mês", () => {
  assert.equal(somarMeses("2026-08-31", 6), "2027-02-28");
  assert.equal(somarMeses("2027-08-31", 6), "2028-02-29"); // bissexto
  assert.equal(somarMeses("2026-03-31", 1), "2026-04-30");
  assert.equal(somarMeses("2026-10-30", 6), "2027-04-30");
  assert.equal(somarMeses("2026-12-15", 1), "2027-01-15");
  assert.equal(somarMeses("2026-01-31", -2), "2025-11-30");
});

test("somarDias atravessa mês/ano", () => {
  assert.equal(somarDias("2027-01-10", -20), "2026-12-21");
  assert.equal(somarDias("2026-02-28", 1), "2026-03-01");
});

test("dataValida recusa data incompleta e inexistente", () => {
  assert.equal(dataValida("2026-02-29"), false);
  assert.equal(dataValida("2028-02-29"), true);
  assert.equal(dataValida(""), false);
  assert.equal(dataValida("0002-10-10"), false); // ano digitado pela metade
  assert.equal(dataValida("2026-10-3"), false);
});

test("regra dos 6 meses: vencido, curto, ok", () => {
  assert.deepEqual(alertaSeisMeses("2026-10-29", null, HOJE)?.tom, "danger");
  assert.deepEqual(alertaSeisMeses("2027-04-29", null, HOJE)?.tom, "warn");
  assert.deepEqual(alertaSeisMeses("2027-04-30", null, HOJE)?.tom, "ok");
  // volta 31/08/2027 → precisa valer até 29/02/2028 (bissexto), não 02/03
  assert.equal(alertaSeisMeses("2028-02-28", "2027-08-31", HOJE)?.tom, "warn");
  assert.equal(alertaSeisMeses("2028-02-29", "2027-08-31", HOJE)?.tom, "ok");
  assert.equal(alertaSeisMeses(null, null, HOJE), null);
});

test("viagem em andamento é a referência (a volta dela)", () => {
  const viagens = [
    { ida: "2026-10-25", volta: "2026-11-05" }, // em andamento
    { ida: "2027-03-01", volta: "2027-03-15" },
  ];
  assert.equal(voltaDeReferencia(viagens, HOJE), "2026-11-05");
  assert.equal(voltaDeReferencia([{ ida: "2026-10-01", volta: "2026-10-10" }, { ida: "2027-03-01", volta: null }], HOJE), "2027-03-01");
  assert.equal(voltaDeReferencia([], HOJE), null);
});

const base: DadosCompletude = {
  nome: "Maria Silva", cpf: "52998224725", nascimento: "1980-01-01", telefone: "11999998888", email: "m@x.com",
  passaporte: "FX123456", passaporte_validade: "2030-01-01", endereco: { cep: "01001000", rua: "Praça da Sé", cidade: "São Paulo" },
  emergenciaNome: "João", emergenciaFone: "11988887777", camiseta: "M", saudeRespondida: true, semFoto: false, voltaReferencia: null,
};

test("completude: tudo ok = 100%", () => {
  const c = calcularCompletude(base, HOJE);
  assert.equal(c.pct, 100);
  assert.equal(c.falta.length, 0);
});

test("completude: passaporte vencido ou fora dos 6 meses NÃO conta como ok", () => {
  const venc = calcularCompletude({ ...base, passaporte_validade: "2026-01-01" }, HOJE);
  assert.ok(venc.falta.some((f) => f.chave === "passaporte_validade" && f.motivo === "Vencido"));
  const curto = calcularCompletude({ ...base, passaporte_validade: "2027-05-01", voltaReferencia: "2027-03-15" }, HOJE);
  assert.ok(curto.falta.some((f) => f.chave === "passaporte_validade"));
});

test("completude: foto do passaporte vai pra 'pedir ao cliente' e a ligação chega a 100%", () => {
  const c = calcularCompletude({ ...base, semFoto: true }, HOJE);
  assert.ok(c.pct < 100);
  assert.equal(c.pctTelefone, 100);
  assert.deepEqual(c.pedirAoCliente.map((i) => i.chave), ["doc_passaporte"]);
  assert.equal(c.faltaTelefone.length, 0);
  // semFoto null (não deu pra conferir) não conta como faltando
  assert.equal(calcularCompletude({ ...base, semFoto: null }, HOJE).pct, 100);
});

test("passaportesAntigos: troca de número e de validade, ignora o 1º preenchimento", () => {
  const r = passaportesAntigos([
    { id: 1, acao: "UPDATE", antes: { passaporte: null }, depois: { passaporte: "AA111111" }, por: null, em: "2025-01-01T10:00:00Z" },
    { id: 2, acao: "UPDATE", antes: { passaporte: "AA111111", passaporte_validade: "2026-01-01" }, depois: { passaporte: "BB222222", passaporte_validade: "2035-01-01" }, por: "u1", em: "2026-02-01T10:00:00Z" },
    { id: 3, acao: "UPDATE", antes: { passaporte: "BB222222", passaporte_validade: "2035-01-01" }, depois: { passaporte: "BB222222", passaporte_validade: "2035-02-01" }, por: "u2", em: "2026-03-01T10:00:00Z" },
    { id: 4, acao: "UPDATE", antes: { passaporte: "BB222222", nome: "a" }, depois: { passaporte: "BB222222", nome: "b" }, por: "u2", em: "2026-04-01T10:00:00Z" },
  ]);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { numero: "BB222222", validade: "2035-01-01", valeuAte: "2026-03-01T10:00:00Z", por: "u2" });
  assert.equal(r[1].numero, "AA111111");
});

test("resumirMudancaIda: campo X mudou de A pra B, sem expor saúde", () => {
  const s = resumirMudancaIda(
    { passaporte: "A1", telefone: "1", updated_at: "x", saude: { a: 1 } },
    { passaporte: "B2", telefone: "1", updated_at: "y", saude: { a: 2 } },
  );
  assert.equal(s, "passaporte mudou de A1 pra B2; saúde mudou");
  assert.equal(resumirMudancaIda({ updated_at: "1" }, { updated_at: "2" }), null);
});

test("agruparSeguidos junta a mesma pessoa em até 10 min", () => {
  const it = (id: string, em: string, grupo: string | null, title = `t${id}`) => ({ id, em, grupo, title });
  const r = agruparSeguidos([
    it("1", "2026-10-30T12:09:00Z", "ficha:u1"),
    it("2", "2026-10-30T12:05:00Z", "ficha:u1"),
    it("3", "2026-10-30T12:00:00Z", "ficha:u1"),
    it("4", "2026-10-30T11:00:00Z", "ficha:u1"), // 1h depois: separado
    it("5", "2026-10-30T10:59:00Z", "ficha:u2"),
    it("6", "2026-10-30T10:58:00Z", null),
  ]);
  assert.equal(r.length, 4);
  assert.equal(r[0].id, "1");
  assert.match(r[0].title, /\+2 alterações/);
});

test("telefone de emergência do exterior", () => {
  assert.equal(normalizarFoneEmergencia("+351 912 345 678"), "+351912345678");
  assert.equal(normalizarFoneEmergencia("(11) 99999-8888"), "11999998888");
  assert.equal(normalizarFoneEmergencia("+1234567890123456789"), "+123456789012345");
});
