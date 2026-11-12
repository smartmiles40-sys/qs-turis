// Venda consolidada → trechos (0361). Os mesmos itens foram passados na SQL
// rel_venda_trechos_desejados (SELECT com os dados inline) e deram os mesmos instantes.
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/viagens/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { instanteDaVenda, trechosDaVenda, voosQueNaoEntram, type ItemDaVenda } from "../../src/rel/lib/trechosDaVenda.ts";

const ITENS: ItemDaVenda[] = [
  { id: "a1", tipo: "aereo", nome: "Voos", dados: { trechos: [
    { ordem: 1, tipo: "voo_internacional", sentido: "ida", origem_codigo: "gru", destino_codigo: "NRT", origem: "São Paulo, SP", destino: "Tóquio", data: "2027-03-10", hora_saida: "23:55", chegada_data: "2027-03-12", hora_chegada: "06:10", companhia: "Emirates", numero: "EK262", localizador: "ABC123" },
    { ordem: 2, sentido: "volta", origem_codigo: "NRT", destino_texto: "Europa", data: "2027-03-20" },
    { ordem: 3, sentido: "interno", tipo: "voo_interno", origem_codigo: "HND", destino_codigo: "ITM", data: "2027-03-15", hora_saida: "10:00", hora_chegada: "08:00" },
  ] } },
  { id: "h1", tipo: "hospedagem", nome: "Hotel Gracery", data_inicio: "2027-03-12", data_fim: "2027-03-15", dados: { cidade: "Tóquio", checkin_hora: "15:00", checkout_hora: "11:00", endereco: "Shinjuku 1-19", regime: "Café" }, fornecedor: "Booking" },
  { id: "s1", tipo: "seguro", nome: "", data_inicio: "2027-03-10", data_fim: "2027-03-21", dados: { seguradora: "Assist Card", plano: "AC 150" } },
  { id: "p1", tipo: "pacote", nome: "Pacote", data_inicio: "2027-03-10", dados: { aereo_incluso: "nao", trechos: [{ ordem: 1, origem_codigo: "GRU", destino_codigo: "LIS", data: "2027-03-10" }] } },
  { id: "x1", tipo: "passeio", nome: "Fuji", data_inicio: "2027-03-14", dados: { local: "Shinjuku Sta.", hora: "07:30" }, status: "cancelado" },
  { id: "t1", tipo: "trem", nome: "Shinkansen", data_inicio: "2027-03-16", dados: { operadora: "JR", numero: "Nozomi 21", de: "Tóquio", para: "Kyoto", saida: "09:00", chegada: "11:15", assento: "7A" } },
  { id: "e1", tipo: "expedicao", nome: "Japão G1", data_inicio: "2027-03-10" },
];

test("instante: hora de Brasília; sem hora = 00:00; data ruim = null", () => {
  assert.equal(instanteDaVenda("2027-03-10", "23:55"), "2027-03-11T02:55:00.000Z");
  assert.equal(instanteDaVenda("2027-03-10", ""), "2027-03-10T03:00:00.000Z");
  assert.equal(instanteDaVenda("2027-03-10", "9:05"), "2027-03-10T12:05:00.000Z");
  assert.equal(instanteDaVenda("", "10:00"), null);
  assert.equal(instanteDaVenda(null), null);
});

test("mesmo resultado da SQL: refs, tipos e instantes", () => {
  const r = trechosDaVenda(ITENS);
  assert.deepEqual(r.map((t) => t.ref_externa), [
    "venda:a1:voo:1", "venda:a1:voo:3", "venda:h1:hospedagem", "venda:s1:seguro", "venda:t1:trem",
  ]);
  const [ida, interno, hotel, seguro, trem] = r;
  assert.equal(ida.origem_codigo, "GRU");
  assert.equal(ida.partida_em, "2027-03-11T02:55:00.000Z");
  assert.equal(ida.chegada_em, "2027-03-12T09:10:00.000Z");
  assert.equal(ida.descricao, "Ida — da venda");
  assert.equal(interno.tipo, "voo_interno");
  assert.equal(interno.chegada_em, null, "chegada antes da partida (fuso) fica vazia");
  assert.equal(hotel.partida_em, "2027-03-12T18:00:00.000Z");
  assert.equal(hotel.chegada_em, "2027-03-15T14:00:00.000Z");
  assert.equal(hotel.endereco, "Shinjuku 1-19");
  assert.equal(hotel.observacoes, "Café · Booking");
  assert.equal(seguro.tipo, "seguro");
  assert.equal(seguro.descricao, "Seguro viagem");
  assert.equal(seguro.companhia, "Assist Card");
  assert.equal(seguro.chegada_em, "2027-03-21T03:00:00.000Z");
  assert.equal(trem.assento, "7A");
  assert.equal(trem.chegada_em, "2027-03-16T14:15:00.000Z");
});

test("pendente de IATA, pacote sem aéreo, cancelado e expedição não viram trecho", () => {
  assert.equal(voosQueNaoEntram(ITENS), 1);
  const comAereo = trechosDaVenda([{ ...ITENS[3], dados: { ...ITENS[3].dados, aereo_incluso: true } }]);
  assert.deepEqual(comAereo.map((t) => t.ref_externa), ["venda:p1:voo:1"]);
});
