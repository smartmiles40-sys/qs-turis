// Testes das abas Check-ins e Serviços + "próximo voo só com aéreo" (0359).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/viagens/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acoesDaVenda, acoesDoTrecho, contarPorCategoria, ehVooQueVale, filaDeCheckins, montarAcoes,
  type TrechoAgenda, type ViagemAgenda,
} from "../../src/rel/lib/agendaServicos.ts";
import { resumirVoos, separarVoos, vendaTemAereo } from "../../src/rel/lib/statusViagem.ts";

// 11/11/2026 10:00 em São Paulo
const AGORA = new Date("2026-11-11T10:00:00-03:00").getTime();
let n = 0;
const tr = (tipo: string, partida: string, extra: Partial<TrechoAgenda> = {}): TrechoAgenda => ({
  id: `t${String(++n).padStart(3, "0")}`, viagem_id: "v1", tipo, partida_em: new Date(partida).toISOString(), fonte: "ia", ...extra,
});
const viagem = (extra: Partial<ViagemAgenda> = {}): ViagemAgenda => ({
  id: "v1", titulo: "Japão", cliente_id: "c1", cliente_nome: "Ana", data_embarque: "2026-11-20", data_retorno: "2026-11-30", servico: "pacote", ...extra,
});

// ── só aéreo de verdade ─────────────────────────────────────────────────────

test("venda de HOTEL: a data do Bitrix (Ida/Volta) não é voo — caso Osaka/Tóquio", () => {
  const hotel = viagem({ servico: "hospedagem", aereo_vendido: false });
  const ida = tr("voo_internacional", "2026-11-26T00:00:00-03:00", { fonte: "bitrix" });
  assert.equal(ehVooQueVale(ida, hotel), false);
  // sem a coluna da view (migration não aplicada) decide pelo serviço
  assert.equal(ehVooQueVale(ida, { servico: "hospedagem" }), false);
  assert.equal(ehVooQueVale(ida, { servico: "pacote" }), true);
  // a view manda quando tem a coluna
  assert.equal(ehVooQueVale({ ...ida, conta_como_voo: false }, { servico: "pacote" }), false);
});

test("voo de verdade (Expedições/IA) numa venda de hotel continua sendo voo", () => {
  const t = tr("voo_internacional", "2026-11-26T22:35:00-03:00", { fonte: "expedicoes", numero: "AA 950" });
  assert.equal(ehVooQueVale(t, viagem({ servico: "hospedagem", aereo_vendido: false })), true);
});

test("hotel, passeio e trecho cancelado nunca são voo", () => {
  assert.equal(ehVooQueVale(tr("hospedagem", "2026-11-20T15:00:00-03:00")), false);
  assert.equal(ehVooQueVale(tr("passeio", "2026-11-20T08:00:00-03:00")), false);
  assert.equal(ehVooQueVale(tr("voo_interno", "2026-11-20T08:00:00-03:00", { status_manual: "cancelado" })), false);
});

test("vendaTemAereo: a view manda; sem ela, pelo serviço", () => {
  assert.equal(vendaTemAereo({ servico: "pacote", aereo_vendido: false }), false); // "Passagem Aérea: Não inclusa"
  assert.equal(vendaTemAereo({ servico: null, aereo_vendido: true }), true); // "Inclusa"
  assert.equal(vendaTemAereo({ servico: "aereo" }), true);
  assert.equal(vendaTemAereo({ servico: "expedicao" }), true);
  assert.equal(vendaTemAereo({ servico: "seguro" }), false);
  assert.equal(vendaTemAereo({ servico: null }), false);
});

test("próximo voo (régua da tela): venda de hotel com Ida/Volta do Bitrix fica SEM próximo voo", () => {
  const v = { data_embarque: "2026-11-26", data_retorno: "2026-12-02", status: "ativa", servico: "hospedagem", aereo_vendido: false };
  const ts = [
    { id: "a", tipo: "voo_internacional", partida_em: new Date("2026-11-26T00:00:00-03:00").toISOString(), fonte: "bitrix" },
    { id: "b", tipo: "voo_internacional", partida_em: new Date("2026-12-02T00:00:00-03:00").toISOString(), fonte: "bitrix" },
  ];
  const sep = separarVoos(v, ts);
  assert.equal(sep.validos.length, 0);
  assert.equal(sep.semAereo.length, 2);
  const r = resumirVoos(v, ts, AGORA);
  assert.equal(r.proximo, null);
  assert.ok(r.voos.every((x) => !x.valido && /não tem aéreo/.test(x.motivoFora ?? "")));
  // a mesma data numa venda COM aéreo segue sendo o próximo voo
  const r2 = resumirVoos({ ...v, servico: "aereo", aereo_vendido: true }, ts, AGORA);
  assert.equal(r2.proximo?.id, "a");
});

// ── fila de check-ins ───────────────────────────────────────────────────────

test("check-ins em ordem de ABERTURA (estimada 48h antes), só voo futuro, sem hotel", () => {
  const vs = new Map([["v1", viagem()], ["v2", viagem({ id: "v2", cliente_nome: "Bia" })]]);
  const ts = [
    tr("voo_internacional", "2026-11-15T22:00:00-03:00", { numero: "LA 8084" }),               // abre 13/11 22:00
    tr("voo_interno", "2026-11-12T09:00:00-03:00", { viagem_id: "v2", numero: "G3 1000" }),     // abre 10/11 09:00 → aberto
    tr("hospedagem", "2026-11-12T15:00:00-03:00"),                                              // hotel: fora
    tr("voo_internacional", "2026-11-10T09:00:00-03:00", { numero: "AF 1" }),                   // já voou: fora
    tr("voo_internacional", "2026-11-14T08:00:00-03:00", { numero: "TP 1", checkin_abre_em: new Date("2026-11-11T08:00:00-03:00").toISOString() }), // a cia disse: abre 11/11 08:00
  ];
  const f = filaDeCheckins(ts, vs, AGORA);
  assert.deepEqual(f.map((x) => x.t.numero), ["G3 1000", "TP 1", "LA 8084"]);
  assert.equal(f[0].situacao, "aberto");
  assert.equal(f[0].estimado, true);
  assert.equal(f[1].estimado, false);
  assert.equal(f[1].situacao, "aberto");
  assert.equal(f[2].situacao, "futuro");
});

test("check-in: o mesmo voo de vários passageiros da viagem vira 1 item; feito só quando todos", () => {
  const vs = new Map([["v1", viagem()]]);
  const p = "2026-11-12T20:00:00-03:00";
  const ts = [
    tr("voo_internacional", p, { numero: "LA 1", passageiros: ["Ana"], checkin_feito_em: new Date(AGORA).toISOString() }),
    tr("voo_internacional", p, { numero: "LA 1", passageiros: ["Beto"] }),
  ];
  const f = filaDeCheckins(ts, vs, AGORA);
  assert.equal(f.length, 1);
  assert.equal(f[0].trechoIds.length, 2);
  assert.deepEqual(f[0].passageiros, ["Ana", "Beto"]);
  assert.equal(f[0].situacao, "aberto"); // 12/11 20:00 − 48h = 10/11 20:00
});

test("check-in: feitos e voo sem bilhete (só data do Bitrix) só entram quando pedidos; janela abreAte", () => {
  const vs = new Map([["v1", viagem({ servico: "aereo", aereo_vendido: true })]]);
  const feito = tr("voo_internacional", "2026-11-12T20:00:00-03:00", { numero: "LA 2", checkin_feito_em: new Date(AGORA).toISOString() });
  const bitrix = tr("voo_internacional", "2026-11-25T00:00:00-03:00", { fonte: "bitrix" });
  const longe = tr("voo_internacional", "2026-12-20T10:00:00-03:00", { numero: "LA 3" });
  assert.deepEqual(filaDeCheckins([feito, bitrix, longe], vs, AGORA).map((x) => x.t.numero), ["LA 3"]);
  assert.equal(filaDeCheckins([feito, bitrix, longe], vs, AGORA, { feitos: true, semBilhete: true }).length, 3);
  assert.equal(filaDeCheckins([feito, bitrix, longe], vs, AGORA, { abreAte: AGORA + 7 * 86_400_000 }).length, 0);
  // venda de hotel: a data do Bitrix não entra nem pedindo "sem bilhete"
  const hotel = new Map([["v1", viagem({ servico: "hospedagem", aereo_vendido: false })]]);
  assert.equal(filaDeCheckins([bitrix], hotel, AGORA, { semBilhete: true }).length, 0);
});

// ── agenda de serviços ──────────────────────────────────────────────────────

test("hotel vira check-in e check-out; passeio começo e fim; voo parte + check-in online", () => {
  const v = viagem();
  const hotel = tr("hospedagem", "2026-11-20T15:00:00-03:00", { chegada_em: new Date("2026-11-25T11:00:00-03:00").toISOString(), descricao: "Hotel Gracery", destino: "Tóquio" });
  assert.deepEqual(acoesDoTrecho(hotel, v, AGORA).map((a) => a.evento), ["hotel_checkin", "hotel_checkout"]);
  const passeio = tr("passeio", "2026-11-21T08:00:00-03:00", { chegada_em: new Date("2026-11-21T17:00:00-03:00").toISOString(), descricao: "Monte Fuji" });
  assert.deepEqual(acoesDoTrecho(passeio, v, AGORA).map((a) => a.evento), ["passeio_inicio", "passeio_fim"]);
  const voo = tr("voo_internacional", "2026-11-20T01:00:00-03:00", { numero: "EK 262", companhia: "Emirates" });
  const av = acoesDoTrecho(voo, v, AGORA);
  assert.deepEqual(av.map((a) => a.evento), ["voo_parte", "checkin_online"]);
  assert.equal(av[1].estimado, true);
  assert.equal(new Date(av[1].quando).getTime(), new Date("2026-11-18T01:00:00-03:00").getTime());
});

test("hotel sem horário (00:00) avisa 'sem horário'", () => {
  const h = tr("hospedagem", "2027-01-11T00:00:00-03:00", { chegada_em: new Date("2027-01-15T00:00:00-03:00").toISOString() });
  assert.ok(acoesDoTrecho(h, viagem(), AGORA).every((a) => a.semHora));
});

test("venda de hotel sem trecho de hotel: entra pelas datas da venda; com o trecho, não duplica", () => {
  const v = viagem({ servico: "hospedagem", aereo_vendido: false });
  const a = acoesDaVenda(v, []);
  assert.deepEqual(a.map((x) => x.evento), ["hotel_checkin", "hotel_checkout"]);
  assert.ok(a.every((x) => x.daVenda && x.semHora));
  assert.equal(acoesDaVenda(v, [tr("hospedagem", "2026-11-20T15:00:00-03:00")]).length, 0);
  // a "Ida/Volta" do Bitrix da venda de hotel não vira "Voo parte"
  const ida = tr("voo_internacional", "2026-11-20T00:00:00-03:00", { fonte: "bitrix" });
  assert.equal(acoesDoTrecho(ida, v, AGORA).length, 0);
});

test("montarAcoes: filtra por tipo, por data da ação e por embarque; ordena por data/hora", () => {
  const vs = new Map([
    ["v1", viagem()],
    ["v2", viagem({ id: "v2", data_embarque: "2026-12-10", data_retorno: "2026-12-15", servico: "seguro" })],
  ]);
  const ts = [
    tr("hospedagem", "2026-11-20T15:00:00-03:00", { chegada_em: new Date("2026-11-25T11:00:00-03:00").toISOString() }),
    tr("passeio", "2026-11-21T08:00:00-03:00"),
    tr("voo_internacional", "2026-11-20T01:00:00-03:00", { numero: "EK 262" }),
  ];
  const todas = montarAcoes(ts, vs, {}, AGORA);
  const ord = todas.map((a) => a.quando);
  assert.deepEqual(ord, [...ord].sort());
  const c = contarPorCategoria(todas);
  assert.equal(c.hotel, 2);
  assert.equal(c.aereo, 2);
  assert.equal(c.seguro, 2);
  assert.deepEqual(montarAcoes(ts, vs, { categorias: ["hotel"] }, AGORA).map((a) => a.evento), ["hotel_checkin", "hotel_checkout"]);
  const dia20 = montarAcoes(ts, vs, { de: new Date("2026-11-20T00:00:00-03:00").getTime(), ate: new Date("2026-11-21T00:00:00-03:00").getTime() }, AGORA);
  assert.deepEqual(dia20.map((a) => a.evento), ["voo_parte", "hotel_checkin"]);
  const embDez = montarAcoes(ts, vs, { embarqueDe: "2026-12-01", embarqueAte: "2026-12-31" }, AGORA);
  assert.ok(embDez.length === 2 && embDez.every((a) => a.viagem_id === "v2"));
});
