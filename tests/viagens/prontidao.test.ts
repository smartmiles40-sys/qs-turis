// Testes da prontidão da viagem (src/rel/lib/prontidao.ts).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/viagens/prontidao.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diaHoraCurta, duracao, estadoDocumento, estadoPassaporte, noitesEntre, prontidaoDaViagem, seloEmbarque,
  type EntradaProntidao, type VooPront,
} from "../../src/rel/lib/prontidao.ts";

const HOJE = "2026-11-03";
let n = 0;
const voo = (papel: VooPront["papel"], partida: string, extra: Partial<VooPront> = {}): VooPront => ({
  id: `v${++n}`, papel, valido: true, partida_em: new Date(partida).toISOString(), partida_fuso: "-03:00", localizador: "K7PQ2M", origem: "FOR", destino: "LIS", ...extra,
});
const base = (x: Partial<EntradaProntidao> = {}): EntradaProntidao => ({
  servico: "pacote", acompanhamento: "completo", voos: [], hoteis: [], noitesSemHotel: 0, passeios: [], itens: [], docs: [],
  passageiros: [], qtdVendida: null, dataReferencia: "2026-11-25", sherpa: null, ...x,
});
const quadro = (e: EntradaProntidao, chave: string) => prontidaoDaViagem(e, HOJE).quadros.find((q) => q.chave === chave)!;

test("são sempre os 8 quadrinhos, na ordem do desenho", () => {
  const r = prontidaoDaViagem(base(), HOJE);
  assert.deepEqual(r.quadros.map((q) => q.chave), ["ida", "volta", "internos", "hospedagem", "passeios", "documentos", "entrada", "seguro"]);
});

test("pacote com ida e volta emitidas: ok com o LOC e a hora local", () => {
  const e = base({ voos: [voo("ida", "2026-11-15T23:45:00-03:00"), voo("nacional_ida", "2026-11-16T14:00:00-03:00"), voo("volta", "2026-11-25T11:40:00-03:00")] });
  const ida = quadro(e, "ida");
  assert.equal(ida.estado, "ok");
  assert.equal(ida.valor, "Emitido");
  assert.match(ida.detalhe, /LOC K7PQ2M · 15\/11 23:45/);
  assert.equal(quadro(e, "volta").estado, "ok");
});

test("pacote sem nenhum voo: ida e volta FALTAM; voo interno fica neutro (o sistema não sabe se precisa)", () => {
  const e = base();
  assert.equal(quadro(e, "ida").estado, "falta");
  assert.equal(quadro(e, "volta").valor, "Não cadastrado");
  assert.equal(quadro(e, "internos").estado, "neutro");
});

test("hotel sozinho: aéreo não vendido é neutro e não conta na barra", () => {
  const e = base({ servico: "hospedagem", acompanhamento: "leve", hoteis: [{ nome: "Hotel Gran Vía", noites: 5 }] });
  const r = prontidaoDaViagem(e, HOJE);
  assert.equal(r.quadros[0].estado, "neutro");
  assert.equal(r.quadros[0].valor, "Não vendido");
  assert.equal(quadro(e, "hospedagem").estado, "ok");
  assert.ok(r.aplicaveis < 8);
});

test("voo sem localizador = atenção; voo fora das datas não conta", () => {
  const e = base({ voos: [voo("ida", "2026-11-15T23:45:00-03:00", { localizador: null }), voo("volta", "2026-03-01T10:00:00-03:00", { valido: false })] });
  assert.equal(quadro(e, "ida").estado, "atencao");
  assert.equal(quadro(e, "ida").valor, "Sem localizador");
  assert.equal(quadro(e, "volta").estado, "falta");
});

test("só a data do Bitrix (sem hora) é atenção, não ok", () => {
  const e = base({ voos: [voo("ida", "2026-11-15T03:00:00Z", { semHora: true, localizador: null })] });
  assert.equal(quadro(e, "ida").valor, "Só a data do Bitrix");
});

test("item aéreo vendido e ainda sem voo = A emitir", () => {
  const e = base({ servico: "outro", itens: [{ tipo: "aereo", status: "vendido" }] });
  assert.equal(quadro(e, "ida").valor, "A emitir");
});

test("voos internos com e sem localizador", () => {
  assert.equal(quadro(base({ voos: [voo("interno", "2026-11-21T10:00:00+01:00", { origem: "MAD", destino: "BCN", partida_fuso: "+01:00" })] }), "internos").estado, "ok");
  assert.equal(quadro(base({ voos: [voo("interno", "2026-11-21T10:00:00+01:00", { localizador: null })] }), "internos").estado, "atencao");
});

test("hospedagem: noite sem hotel = atenção; pacote sem hotel = falta", () => {
  assert.equal(quadro(base({ hoteis: [{ nome: "A", noites: 5 }], noitesSemHotel: 2 }), "hospedagem").valor, "2 noites sem hotel");
  assert.equal(quadro(base(), "hospedagem").estado, "falta");
});

test("passeios: conta quantos têm voucher", () => {
  const e = base({ passeios: [{ nome: "Prado", comVoucher: true }, { nome: "Toledo", comVoucher: false }, { nome: "Sagrada Família", comVoucher: false }] });
  const p = quadro(e, "passeios");
  assert.equal(p.estado, "atencao");
  assert.equal(p.valor, "1 de 3 com voucher");
  assert.match(p.detalhe, /Toledo, Sagrada Família/);
  assert.equal(quadro(base({ passeios: [{ nome: "X", comVoucher: false }] }), "passeios").estado, "falta");
  assert.equal(quadro(base(), "passeios").estado, "neutro");
});

test("documentos: recusado ou passaporte curto = falta; a conferir = atenção; tudo aprovado = ok", () => {
  const ok = { nome: "Rafael Souza", passaporte: "FX1", passaporte_validade: "2033-01-04" };
  assert.equal(quadro(base({ docs: [{ tipo: "passaporte", status: "recusado" }], passageiros: [ok] }), "documentos").estado, "falta");
  assert.equal(quadro(base({ passageiros: [{ ...ok, passaporte_validade: "2027-03-01" }], docs: [{ tipo: "passaporte", status: "aprovado" }] }), "documentos").estado, "falta");
  assert.equal(quadro(base({ docs: [{ tipo: "bilhete", status: "recebido" }, { tipo: "voucher", status: "recebido" }], passageiros: [ok] }), "documentos").valor, "2 a conferir");
  assert.equal(quadro(base({ docs: [{ tipo: "passaporte", status: "aprovado" }], passageiros: [ok] }), "documentos").estado, "ok");
  assert.equal(quadro(base({ docs: [{ tipo: "passaporte", status: "aprovado" }], passageiros: [ok], qtdVendida: 2 }), "documentos").valor, "Falta passageiro");
});

test("Sherpa sem chave = neutro 'Não ligado'; com dado conta as exigências abertas", () => {
  assert.equal(quadro(base(), "entrada").valor, "Não ligado");
  const e = base({ sherpa: { exigencias: [{ texto: "Sem visto", ok: true }, { texto: "Seguro Schengen", ok: false }] } });
  assert.equal(quadro(e, "entrada").estado, "atencao");
  assert.equal(quadro(e, "entrada").detalhe, "Seguro Schengen");
});

test("seguro: emitido / a emitir / anexado a conferir / não registrado", () => {
  assert.equal(quadro(base({ itens: [{ tipo: "seguro", status: "emitido" }] }), "seguro").estado, "ok");
  assert.equal(quadro(base({ itens: [{ tipo: "seguro", status: "vendido" }] }), "seguro").valor, "A emitir");
  assert.equal(quadro(base({ docs: [{ tipo: "seguro", status: "recebido" }] }), "seguro").estado, "atencao");
  assert.equal(quadro(base({ itens: [{ tipo: "seguro", status: "cancelado" }] }), "seguro").estado, "falta");
  assert.equal(quadro(base({ acompanhamento: "nenhum" }), "seguro").estado, "neutro");
});

test("a barra conta só os aplicáveis", () => {
  const e = base({
    voos: [voo("ida", "2026-11-15T23:45:00-03:00"), voo("volta", "2026-11-25T11:40:00-03:00")],
    hoteis: [{ nome: "A", noites: 9 }], itens: [{ tipo: "seguro", status: "emitido" }],
    docs: [{ tipo: "passaporte", status: "aprovado" }], passageiros: [{ nome: "R", passaporte: "X", passaporte_validade: "2033-01-01" }],
  });
  const r = prontidaoDaViagem(e, HOJE);
  // internos, passeios e entrada ficam neutros
  assert.equal(r.aplicaveis, 5);
  assert.equal(r.prontos, 5);
  assert.equal(r.pct, 100);
});

test("helpers: hora local, duração, documento, passaporte, selo e noites", () => {
  assert.equal(diaHoraCurta("2026-11-16T10:55:00Z", "+00:00"), "16/11 10:55");
  assert.equal(diaHoraCurta("2026-11-16T02:45:00Z", null), "15/11 23:45");
  assert.equal(duracao("2026-11-16T02:45:00Z", "2026-11-16T09:55:00Z"), "7h10");
  assert.equal(duracao("2026-11-16T10:00:00Z", "2026-11-16T10:45:00Z"), "45min");
  assert.equal(duracao("2026-11-16T10:00:00Z", null), "");
  assert.equal(estadoDocumento("recebido").rotulo, "A conferir");
  assert.equal(estadoPassaporte({ passaporte: null, passaporte_validade: null }, null, HOJE).estado, "falta");
  assert.equal(estadoPassaporte({ passaporte: "X", passaporte_validade: "2033-01-04" }, "2026-11-25", HOJE).texto, "Válido até 04/01/2033");
  assert.equal(seloEmbarque("antes", 12, "ativa").texto, "Embarca em 12 dias");
  assert.equal(seloEmbarque("em_viagem", -2, "ativa").texto, "Viajando");
  assert.equal(seloEmbarque("concluida", -30, "ativa").texto, "Voltou");
  assert.equal(noitesEntre("2026-11-15", "2026-11-25"), 10);
});
