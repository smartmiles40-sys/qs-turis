// 24/11 (Bruno): próximo voo que não fica no passado, localizador do voo da vez
// e a SITUAÇÃO = o que está acontecendo agora com a pessoa.
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/viagens/momentoViagem.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localizadoresDoVoo, momentoDaViagem, proximaDataDaVenda, resumirVoos, vooDaVez,
  type TrechoMomento, type TrechoVoo, type ViagemDatas,
} from "../../src/rel/lib/statusViagem.ts";

const ms = (iso: string) => new Date(iso).getTime();
const V: ViagemDatas = { status: "ativa", servico: "pacote", data_embarque: "2026-11-19", data_retorno: "2026-11-30" };
const T = (id: string, partida: string, extra: Partial<TrechoVoo> = {}): TrechoVoo =>
  ({ id, tipo: "voo_internacional", partida_em: partida, numero: `LA${id}`, origem_codigo: "GRU", destino_codigo: "LIS", ...extra });
const voos = [
  T("1", "2026-11-19T20:00:00-03:00", { chegada_em: "2026-11-20T11:00:00-03:00", localizador: "AAA111" }),
  T("2", "2026-11-24T09:00:00-03:00", { tipo: "voo_interno", chegada_em: "2026-11-24T10:30:00-03:00", origem_codigo: "LIS", destino_codigo: "MAD" }),
  T("3", "2026-11-30T15:00:00-03:00", { chegada_em: "2026-12-01T06:00:00-03:00", origem_codigo: "MAD", destino_codigo: "GRU", localizador: "CCC333" }),
];
const hotel: TrechoMomento = { id: "h", tipo: "hospedagem", partida_em: "2026-11-20T14:00:00+00:00", chegada_em: "2026-11-24T06:00:00-03:00", descricao: "Hotel Lisboa" };
const passeio: TrechoMomento = { id: "p", tipo: "passeio", partida_em: "2026-11-21T15:00:00-03:00", descricao: "Sintra" };
const momento = (agora: string, outros: TrechoMomento[] = [hotel, passeio], v = V, vs = voos) =>
  momentoDaViagem(v, resumirVoos(v, vs, ms(agora)), outros, ms(agora));

test("Gabriela Sobral: sem voo nosso, a ida já passou → a próxima data é a volta", () => {
  const gab: ViagemDatas = { status: "ativa", servico: "pacote", aereo_vendido: false, data_embarque: "2026-11-04", data_retorno: "2026-11-25" };
  const bitrix = [
    T("i", "2026-11-04T03:00:00Z", { fonte: "bitrix", numero: null }),
    T("v", "2026-11-25T03:00:00Z", { fonte: "bitrix", numero: null }),
  ];
  const agora = ms("2026-11-24T10:00:00-03:00");
  const r = resumirVoos(gab, bitrix, agora);
  assert.equal(vooDaVez(r, agora, gab).voo, null);
  assert.deepEqual(proximaDataDaVenda(gab, agora), { dia: "2026-11-25", qual: "volta" });
  assert.equal(proximaDataDaVenda(gab, ms("2026-11-26T10:00:00-03:00")), null);
  assert.equal(momentoDaViagem(gab, r, [], agora)?.chave, "em_viagem");
  assert.equal(momentoDaViagem(gab, resumirVoos(gab, bitrix, ms("2026-11-25T10:00:00-03:00")), [], ms("2026-11-25T10:00:00-03:00"))?.chave, "volta_hoje");
});

test("check-in pendente antes da viagem (janela de 48h aberta)", () => {
  assert.equal(momento("2026-11-17T21:00:00-03:00")?.chave, "checkin");
  assert.equal(momento("2026-11-16T10:00:00-03:00"), null); // nada a fazer ainda → situação da checagem
});

test("em voo, depois na hospedagem, em passeio e de volta ao hotel", () => {
  assert.equal(momento("2026-11-19T23:00:00-03:00")?.chave, "em_voo");
  assert.equal(momento("2026-11-21T10:00:00-03:00")?.chave, "na_hospedagem");
  assert.equal(momento("2026-11-21T10:00:00-03:00")?.detalhe, "Hotel Lisboa");
  assert.equal(momento("2026-11-21T16:00:00-03:00")?.chave, "em_passeio");
  assert.equal(momento("2026-11-21T19:00:00-03:00")?.chave, "na_hospedagem"); // passeio sem fim = 3h
});

test("check-in do interno pendente ganha do hotel; sem nada rolando = em viagem", () => {
  assert.equal(momento("2026-11-23T10:00:00-03:00")?.chave, "checkin");
  assert.equal(momento("2026-11-26T10:00:00-03:00", [])?.chave, "em_viagem");
});

test("venda só de hotel, sem trecho: no período da venda = na hospedagem", () => {
  const h: ViagemDatas = { status: "ativa", servico: "hospedagem", aereo_vendido: false, data_embarque: "2026-11-20", data_retorno: "2026-11-25" };
  assert.equal(momentoDaViagem(h, resumirVoos(h, [], ms("2026-11-22T10:00:00-03:00")), [], ms("2026-11-22T10:00:00-03:00"))?.chave, "na_hospedagem");
});

test("concluída quando não sobra voo", () => {
  assert.equal(momento("2026-12-01T07:00:00-03:00")?.chave, "concluida");
});

test("localizador: o do voo da vez; cópias por passageiro somam; sem, pega a conexão", () => {
  const agora = ms("2026-11-19T10:00:00-03:00");
  const com = [...voos, T("1b", "2026-11-19T20:00:00-03:00", { chegada_em: "2026-11-20T11:00:00-03:00", localizador: "BBB222", numero: "LA1" })];
  const r = resumirVoos(V, com, agora);
  assert.deepEqual(localizadoresDoVoo(vooDaVez(r, agora, V).voo, r), ["AAA111", "BBB222"]);
  // o interno não tem localizador e não há voo a menos de 24h → vazio (não pega o da ida nem o da volta)
  const r2 = resumirVoos(V, voos, ms("2026-11-23T10:00:00-03:00"));
  assert.deepEqual(localizadoresDoVoo(vooDaVez(r2, ms("2026-11-23T10:00:00-03:00"), V).voo, r2), []);
  // conexão: voo sem localizador 3h depois de um com localizador → herda
  const cx = [T("a", "2026-11-19T20:00:00-03:00", { localizador: "XYZ999", chegada_em: "2026-11-19T21:00:00-03:00" }), T("b", "2026-11-20T00:00:00-03:00", { origem_codigo: "GIG" })];
  const r3 = resumirVoos(V, cx, ms("2026-11-19T21:30:00-03:00"));
  assert.deepEqual(localizadoresDoVoo(vooDaVez(r3, ms("2026-11-19T21:30:00-03:00"), V).voo, r3), ["XYZ999"]);
});

test("Julia Trianda (26/11): venda de hotel sem aéreo não mostra data como próximo voo", async () => {
  const { rotuloSemAereo } = await import("../../src/rel/lib/statusViagem.ts");
  const agora = ms("2026-11-26T10:00:00-03:00");
  const osaka: ViagemDatas = { status: "ativa", servico: "hospedagem", aereo_vendido: false, data_embarque: "2026-11-30", data_retorno: "2026-12-01" };
  const toquio: ViagemDatas = { ...osaka, data_embarque: "2026-11-16", data_retorno: "2026-11-27" };
  assert.equal(rotuloSemAereo(osaka, proximaDataDaVenda(osaka, agora)), "HOTEL");
  assert.equal(rotuloSemAereo(toquio, proximaDataDaVenda(toquio, agora)), "SAÍDA HOTEL");
  assert.equal(rotuloSemAereo({ servico: "seguro", aereo_vendido: false }, null), "SEGURO");
  assert.equal(rotuloSemAereo({ servico: "pacote", aereo_vendido: false }, null), "SEM AÉREO");
  // venda com aéreo segue a data (voo ou VOLTA)
  assert.equal(rotuloSemAereo({ servico: "pacote", aereo_vendido: true }, null), null);
  assert.equal(rotuloSemAereo({ servico: "aereo" }, null), null);
});
