// Testes da régua dos voos (src/rel/lib/statusViagem.ts).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/viagens/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estadoTrecho, faseAutomatica, faseManualValendo, idaVoltaReais, papeisDosVoos, resumirVoos, separarVoos, textoVooInterno,
  type TrechoVoo, type ViagemDatas,
} from "../../src/rel/lib/statusViagem.ts";

// 30/10/2026 12:00 em São Paulo
const AGORA = new Date("2026-10-30T12:00:00-03:00").getTime();
let n = 0;
const voo = (partida: string, o: string, d: string, extra: Partial<TrechoVoo> = {}): TrechoVoo => ({
  id: `t${++n}`, tipo: "voo_internacional", partida_em: new Date(partida).toISOString(), origem: o, destino: d, fonte: "expedicoes", ...extra,
});

test("caso Vinícius: voos do Pós-Venda de mar/2026 numa viagem de jun/2027 não são o próximo voo", () => {
  const v: ViagemDatas = { data_embarque: "2027-06-05", data_retorno: "2027-06-17", status: "ativa", titulo: "Turquia & Grécia G2 - 2027 (Junho)" };
  const ts = [
    voo("2026-03-21T00:00:00-03:00", "", "", { fonte: "bitrix" }),
    voo("2026-03-29T00:00:00-03:00", "", "", { fonte: "bitrix" }),
  ];
  const r = resumirVoos(v, ts, AGORA);
  assert.equal(r.proximo, null);
  assert.equal(r.fase, "antes");
  assert.equal(r.voos.filter((x) => x.valido).length, 0);
  const fora = r.inconsistencias.filter((i) => i.chave.startsWith("voo_fora:"));
  assert.equal(fora.length, 2);
  assert.match(fora[0].titulo, /ano errado/);
});

test("próximo voo = 1º com partida >= agora; voo sem horário vale até o fim do dia", () => {
  const v: ViagemDatas = { data_embarque: "2026-10-26", data_retorno: "2026-11-12", status: "ativa" };
  const ts = [
    voo("2026-10-26T01:30:00-03:00", "São Paulo (GRU)", "Dubai (DXB)"),
    voo("2026-10-30T00:00:00-03:00", "Pequim (PEK)", "Tóquio (HND)", { fonte: "bitrix" }), // hoje, sem hora — ignorado (há real)
    voo("2026-10-30T00:00:00-03:00", "Osaka (KIX)", "Pequim (PEK)", { fonte: "manual" }), // hoje, 00:00 = sem hora
    voo("2026-11-12T09:05:00-03:00", "Dubai (DXB)", "São Paulo (GRU)"),
  ];
  const r = resumirVoos(v, ts, AGORA);
  assert.equal(r.proximo?.origem, "Osaka (KIX)");
});

test("check-in: só voo futuro com a janela (48h) aberta; voo passado nunca pede check-in", () => {
  const passado = voo("2026-10-29T10:00:00-03:00", "A", "B");
  const em24h = voo("2026-10-31T12:00:00-03:00", "A", "B");
  const em5dias = voo("2026-11-04T12:00:00-03:00", "A", "B");
  const feito = voo("2026-10-31T12:00:00-03:00", "A", "B", { checkin_feito_em: "2026-10-30T09:00:00-03:00" });
  assert.equal(estadoTrecho(passado, AGORA), "voado");
  assert.equal(estadoTrecho(em24h, AGORA), "checkin_a_fazer");
  assert.equal(estadoTrecho(em5dias, AGORA), "a_voar");
  assert.equal(estadoTrecho(feito, AGORA), "checkin_feito");
  assert.equal(estadoTrecho({ ...em24h, status_manual: "cancelado" }, AGORA), "cancelado");
  assert.equal(estadoTrecho({ ...em5dias, status_manual: "voado" }, AGORA), "voado");
});

test("voo interno: blocos de conexão — 1º = ida, último = volta, meio = interno; Brasil→Brasil = nacional", () => {
  const v = { data_embarque: "2026-11-13", data_retorno: "2026-11-28" };
  const ts = [
    voo("2026-11-13T10:00:00-03:00", "Fortaleza (FOR)", "São Paulo (GRU)"),
    voo("2026-11-13T20:40:00-03:00", "São Paulo (GRU)", "Roma (FCO)"),
    voo("2026-11-14T15:10:00+01:00", "Roma (FCO)", "Bangkok (BKK)"),
    voo("2026-11-18T09:00:00+07:00", "Don Mueang (DMK)", "Krabi (KBV)", { tipo: "voo_interno" }),
    voo("2026-11-22T09:00:00+07:00", "Krabi (KBV)", "Chiang Mai (CNX)"), // marcado internacional, é interno
    voo("2026-11-27T12:15:00+07:00", "Bangkok (BKK)", "Roma (FCO)"),
    voo("2026-11-27T21:50:00+01:00", "Roma (FCO)", "São Paulo (GRU)"),
  ];
  const sep = separarVoos(v, ts);
  const p = papeisDosVoos(sep.validos, v);
  assert.deepEqual(ts.map((t) => p.get(t.id)), ["nacional_ida", "ida", "ida", "interno", "interno", "volta", "volta"]);
  const r = resumirVoos({ ...v, status: "ativa" }, ts, AGORA);
  assert.equal(r.internos, 2);
  assert.equal(r.nacionais, 1);
  assert.equal(textoVooInterno(r), "sim (2 trechos)");
  assert.ok(r.inconsistencias.some((i) => i.chave.startsWith("tipo_interno:")));
});

test("sem voo interno: só ida e volta", () => {
  const v = { data_embarque: "2027-02-13", data_retorno: "2027-02-23", status: "ativa" };
  const ts = [
    voo("2027-02-13T16:25:00-03:00", "São Paulo (GRU)", "Londres (LHR)"),
    voo("2027-02-14T13:40:00Z", "Londres (LHR)", "Keflavík (KEF)"),
    voo("2027-02-22T11:50:00Z", "Keflavík (KEF)", "Londres (LHR)"),
    voo("2027-02-22T21:15:00Z", "Londres (LHR)", "São Paulo (GRU)"),
  ];
  const r = resumirVoos(v, ts, AGORA);
  assert.equal(textoVooInterno(r), "não");
  assert.equal(r.internos, 0);
});

test("o mesmo voo repetido por passageiro conta uma vez", () => {
  const v = { data_embarque: "2026-11-13", data_retorno: "2026-11-28" };
  const a = voo("2026-11-13T20:40:00-03:00", "GRU", "FCO", { numero: "AZ 675" });
  const b = { ...a, id: "outro" };
  const sep = separarVoos(v, [a, b]);
  assert.equal(sep.validos.length, 1);
  assert.equal(sep.repetidos.length, 1);
});

test("em viagem = hoje entre a ida e a volta REAIS (os voos mandam quando batem)", () => {
  // venda 24/10, 1º voo 26/10 → ida real 26/10
  const v = { data_embarque: "2026-10-24", data_retorno: "2026-11-13" };
  const ts = [voo("2026-10-26T01:30:00-03:00", "GRU", "DXB"), voo("2026-11-13T09:05:00+04:00", "DXB", "GRU")];
  assert.deepEqual(idaVoltaReais(v, separarVoos(v, ts).validos), { ida: "2026-10-26", volta: "2026-11-13" });
  assert.equal(faseAutomatica("ativa", "2026-10-26", "2026-11-13", "2026-10-25"), "antes");
  assert.equal(faseAutomatica("ativa", "2026-10-26", "2026-11-13", "2026-10-30"), "em_viagem");
  assert.equal(faseAutomatica("ativa", "2026-10-26", "2026-11-13", "2026-11-14"), "concluida");
  // só a ida cadastrada: a volta continua sendo a da venda
  assert.deepEqual(idaVoltaReais(v, separarVoos(v, ts.slice(0, 1)).validos), { ida: "2026-10-26", volta: "2026-11-13" });
});

test("volta antes da ida e viagem longa viram inconsistência", () => {
  const r = resumirVoos({ data_embarque: "2026-11-10", data_retorno: "2026-11-01", status: "ativa" }, [], AGORA);
  assert.ok(r.inconsistencias.some((i) => i.chave === "volta_antes_ida"));
  const l = resumirVoos({ data_embarque: "2026-08-29", data_retorno: "2026-11-08", status: "ativa", servico: "pacote" }, [], AGORA);
  assert.ok(l.inconsistencias.some((i) => i.chave === "duracao_longa"));
  assert.ok(l.inconsistencias.some((i) => i.chave === "em_viagem_sem_voo"));
});

test("ano no nome diferente do ano da data", () => {
  const r = resumirVoos({ data_embarque: "2026-10-26", data_retorno: "2026-11-12", status: "ativa", expedicao: "Japão e China/ Out 2027" }, [], AGORA);
  assert.ok(r.inconsistencias.some((i) => i.chave === "ano_no_nome"));
});

test("status manual manda (e expira na data combinada); alerta ignorado fica marcado", () => {
  const v: ViagemDatas = { data_embarque: "2026-08-29", data_retorno: "2026-11-08", status: "ativa", fase_manual: "antes", fase_manual_motivo: "data da ida errada no Bitrix",
    alertas_ignorados: { duracao_longa: { motivo: "cliente fica 2 meses", por: "u1", em: "2026-10-30" } } };
  const r = resumirVoos(v, [], AGORA);
  assert.equal(r.faseAuto, "em_viagem");
  assert.equal(r.fase, "antes");
  assert.equal(r.faseManual, true);
  assert.equal(r.inconsistencias.find((i) => i.chave === "duracao_longa")?.ignorada?.motivo, "cliente fica 2 meses");
  assert.equal(faseManualValendo({ ...v, fase_manual_ate: "2026-10-29" }, "2026-10-30"), null);
  assert.equal(faseManualValendo({ ...v, status: "cancelada" }, "2026-10-30"), null);
});

test("trecho cancelado à mão sai da conta e do próximo voo", () => {
  const v = { data_embarque: "2026-11-13", data_retorno: "2026-11-28", status: "ativa" };
  const a = voo("2026-11-13T20:40:00-03:00", "GRU", "FCO", { status_manual: "cancelado" });
  const b = voo("2026-11-14T20:40:00-03:00", "GRU", "FCO");
  const r = resumirVoos(v, [a, b], AGORA);
  assert.equal(r.proximo?.id, b.id);
  assert.equal(r.voos.find((x) => x.t.id === a.id)?.estado, "cancelado");
  assert.equal(r.voos.find((x) => x.t.id === a.id)?.valido, false);
});
