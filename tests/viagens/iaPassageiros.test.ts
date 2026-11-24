import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error módulo JS da API
import { _regras } from "../../api/rel-viagem-ia.js";

const { nomeDoBilhete, cruzar } = _regras as {
  nomeDoBilhete: (s: string) => string;
  cruzar: (x: unknown) => { novos: string[]; divergencias: { texto: string }[] };
};

test("nome do bilhete vira nome de gente", () => {
  assert.equal(nomeDoBilhete("SILVA/JOAO PEDRO MR"), "Joao Pedro Silva");
  assert.equal(nomeDoBilhete("SOUZA/MARIA MRS"), "Maria Souza");
  assert.equal(nomeDoBilhete("ana de oliveira"), "Ana de Oliveira");
});

const viagem = { id: "v", titulo: "Japão", destino: "Japão", data_embarque: "2026-12-01", data_retorno: "2026-12-15", qtd_passageiros: 2 };
const leitura = (passageiros: string[], dia = "2026-12-01") => ({
  fonte: "documento", documento_id: "d", arquivo_nome: "bilhete.pdf",
  lido: { legivel: true, tipo_detectado: "bilhete", passageiros, localizador: "ABC123", seguro: null,
    segmentos: [{ categoria: "voo_internacional", origem: "São Paulo", origem_codigo: "GRU", origem_pais: "Brasil", destino: "Tóquio", destino_codigo: "NRT", destino_pais: "Japão",
      partida_local: `${dia}T10:00`, partida_fuso: "-03:00", chegada_local: null, chegada_fuso: null, companhia: "LA", numero: "LA1", passageiros: [] }] },
});

test("acompanhante no mesmo bilhete de quem já está na viagem = cadastrar", () => {
  const r = cruzar({ viagem: { ...viagem, qtd_passageiros: 1 }, passageiros: [{ cliente_id: "c1", nome: "Carlos Lima" }], leituras: [leitura(["LIMA/CARLOS MR", "LIMA/BEATRIZ MRS"])], trechosAntes: [] });
  assert.deepEqual(r.novos, ["LIMA/BEATRIZ MRS"]);
});

test("documento sem ninguém conhecido e venda cheia NÃO cadastra (pode ser de outra viagem da turma)", () => {
  const r = cruzar({ viagem: { ...viagem, qtd_passageiros: 1 }, passageiros: [{ cliente_id: "c1", nome: "Carlos Lima" }], leituras: [leitura(["ROCHA/PAULO MR"])], trechosAntes: [] });
  assert.deepEqual(r.novos, []);
});

test("data fora da viagem não cadastra ninguém", () => {
  const r = cruzar({ viagem, passageiros: [{ cliente_id: "c1", nome: "Carlos Lima" }], leituras: [leitura(["LIMA/CARLOS MR", "LIMA/BEATRIZ MRS"], "2027-05-01")], trechosAntes: [] });
  assert.deepEqual(r.novos, []);
});
