// Próximo voo que anda sozinho (Painel) + calendário de check-ins dos pacotes.
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/viagens/vooDaVez.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resumirVoos, vooDaVez, type TrechoVoo } from "../../src/rel/lib/statusViagem.ts";
import { checkinsDoCalendario, type TrechoAgenda, type ViagemAgenda } from "../../src/rel/lib/agendaServicos.ts";

const V = { status: "ativa", servico: "pacote", data_embarque: "2026-11-19", data_retorno: "2026-11-30" };
const T = (id: string, partida: string, extra: Partial<TrechoVoo> = {}): TrechoVoo =>
  ({ id, tipo: "voo_internacional", partida_em: partida, numero: `LA${id}`, origem_codigo: "GRU", destino_codigo: "LIS", ...extra });
const ms = (iso: string) => new Date(iso).getTime();

// ida hoje 20h (chega amanhã 11h), interno dia 24, volta dia 30
const voos = [
  T("1", "2026-11-19T20:00:00-03:00", { chegada_em: "2026-11-20T11:00:00-03:00" }),
  T("2", "2026-11-24T09:00:00-03:00", { tipo: "voo_interno", chegada_em: "2026-11-24T10:30:00-03:00" }),
  T("3", "2026-11-30T15:00:00-03:00"),
];

test("o voo de hoje às 20h aparece até pousar; depois passa sozinho pro interno", () => {
  const r = resumirVoos(V, voos, ms("2026-11-19T08:00:00-03:00"));
  assert.equal(vooDaVez(r, ms("2026-11-19T19:59:00-03:00"), V).voo?.id, "1");
  assert.equal(vooDaVez(r, ms("2026-11-20T10:00:00-03:00"), V).voo?.id, "1"); // ainda voando
  assert.equal(vooDaVez(r, ms("2026-11-20T11:01:00-03:00"), V).voo?.id, "2");
  assert.equal(vooDaVez(r, ms("2026-11-25T08:00:00-03:00"), V).voo?.id, "3");
});

test("sem mais voo = viagem concluída", () => {
  const r = resumirVoos(V, voos, ms("2026-11-19T08:00:00-03:00"));
  const x = vooDaVez(r, ms("2026-11-30T15:01:00-03:00"), V);
  assert.equal(x.voo, null); assert.equal(x.concluida, true);
});

test("voo marcado como voado à mão sai da vez", () => {
  const vs = [T("1", "2026-11-19T20:00:00-03:00", { status_manual: "voado" }), voos[1]];
  const r = resumirVoos(V, vs, ms("2026-11-19T08:00:00-03:00"));
  assert.equal(vooDaVez(r, ms("2026-11-19T09:00:00-03:00"), V).voo?.id, "2");
});

test("sem voo nenhum: concluída só depois da volta da venda", () => {
  const r = resumirVoos(V, [], ms("2026-11-19T08:00:00-03:00"));
  assert.equal(vooDaVez(r, ms("2026-11-25T08:00:00-03:00"), V).concluida, false);
  assert.equal(vooDaVez(r, ms("2026-12-01T08:00:00-03:00"), V).concluida, true);
});

// ── calendário ──
const viagens = new Map<string, ViagemAgenda>([
  ["p", { id: "p", titulo: "Pacote Lisboa", cliente_id: null, cliente_nome: "Ana", data_embarque: "2026-11-21", data_retorno: "2026-11-30", servico: "pacote" }],
  ["e", { id: "e", titulo: "Japão G2", cliente_id: null, cliente_nome: "Bia", data_embarque: "2026-11-21", data_retorno: "2026-11-30", servico: "expedicao" }],
  ["h", { id: "h", titulo: "Hotel Roma", cliente_id: null, cliente_nome: "Caio", data_embarque: "2026-11-21", data_retorno: "2026-11-25", servico: "hospedagem", aereo_vendido: false }],
]);
const TA = (id: string, viagem_id: string, partida: string, extra: Partial<TrechoAgenda> = {}): TrechoAgenda =>
  ({ id, viagem_id, tipo: "voo_internacional", partida_em: partida, numero: "TP82", ...extra });

test("calendário: só pacote, sem expedição, sem a data do Bitrix do hotel", () => {
  const ts = [
    TA("a", "p", "2026-11-21T22:00:00-03:00", { passageiros: ["Ana"] }),
    TA("b", "p", "2026-11-21T22:00:00-03:00", { passageiros: ["Rui"] }), // mesmo voo, outro passageiro
    TA("c", "e", "2026-11-21T22:00:00-03:00"),
    TA("d", "h", "2026-11-21T00:00:00-03:00", { fonte: "bitrix", numero: null }),
  ];
  const l = checkinsDoCalendario(ts, viagens, ms("2026-11-19T12:00:00-03:00"));
  assert.equal(l.length, 1);
  assert.deepEqual(l[0].trechoIds, ["a", "b"]);
  assert.deepEqual(l[0].passageiros, ["Ana", "Rui"]);
  assert.equal(l[0].abre, ms("2026-11-19T22:00:00-03:00")); // 48h antes, estimado
  assert.equal(l[0].estimado, true);
  assert.equal(l[0].situacao, "abre_logo");
});

test("calendário: aberto, feito e voo que saiu sem marcar", () => {
  const ts = [TA("a", "p", "2026-11-21T22:00:00-03:00")];
  assert.equal(checkinsDoCalendario(ts, viagens, ms("2026-11-20T12:00:00-03:00"))[0].situacao, "aberto");
  assert.equal(checkinsDoCalendario(ts, viagens, ms("2026-11-22T12:00:00-03:00"))[0].situacao, "nao_marcado");
  const feito = [TA("a", "p", "2026-11-21T22:00:00-03:00", { checkin_feito_em: "2026-11-20T10:00:00-03:00" })];
  assert.equal(checkinsDoCalendario(feito, viagens, ms("2026-11-22T12:00:00-03:00"))[0].situacao, "feito");
});
