// Testes do filtro por coluna do quadro de pacotes (src/rel/lib/filtroQuadro.ts).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/viagens/filtroQuadro.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { FILTRO_QUADRO_VAZIO, intervaloVoo, lerFiltroQuadro, passaNoQuadro, quantosAtivosQuadro, type FiltroQuadro, type LinhaFiltravel } from "../../src/rel/lib/filtroQuadro.ts";

const L = (p: Partial<LinhaFiltravel> = {}): LinhaFiltravel => ({
  cliente: "Gabriela Pimenta", servico: "pacote", de: "HKT Phuket", para: "CNX Chiang Mai Tailândia", dia: "2026-11-21",
  temLocalizador: true, interno: 1, pax: 2, alertas: { alta: 0, media: 1 }, situacao: "ida", ...p,
});
const F = (p: Partial<FiltroQuadro>): FiltroQuadro => ({ ...FILTRO_QUADRO_VAZIO, ...p });
const HOJE = "2026-11-19";

test("sem filtro, tudo passa", () => {
  assert.equal(passaNoQuadro(L(), FILTRO_QUADRO_VAZIO, HOJE), true);
  assert.equal(quantosAtivosQuadro(FILTRO_QUADRO_VAZIO), 0);
});

test("texto: responsável, de e para — sem acento e sem maiúscula", () => {
  assert.equal(passaNoQuadro(L(), F({ responsavel: "gabriela" }), HOJE), true);
  assert.equal(passaNoQuadro(L(), F({ responsavel: "bianca" }), HOJE), false);
  assert.equal(passaNoQuadro(L(), F({ de: "hkt" }), HOJE), true);
  assert.equal(passaNoQuadro(L(), F({ para: "tailandia" }), HOJE), true);
  assert.equal(passaNoQuadro(L(), F({ para: "japao" }), HOJE), false);
});

test("serviço e situação", () => {
  assert.equal(passaNoQuadro(L(), F({ servico: "aereo" }), HOJE), false);
  assert.equal(passaNoQuadro(L(), F({ servico: "pacote", situacao: "ida" }), HOJE), true);
  assert.equal(passaNoQuadro(L(), F({ situacao: "pendente" }), HOJE), false);
});

test("próximo voo por período", () => {
  assert.deepEqual(intervaloVoo({ voo: "amanha", vooDe: "", vooAte: "" }, HOJE), { de: "2026-11-20", ate: "2026-11-20" });
  assert.deepEqual(intervaloVoo({ voo: "prox_mes", vooDe: "", vooAte: "" }, "2026-12-05"), { de: "2027-01-01", ate: "2027-01-31" });
  assert.equal(passaNoQuadro(L(), F({ voo: "7d" }), HOJE), true);
  assert.equal(passaNoQuadro(L(), F({ voo: "hoje" }), HOJE), false);
  assert.equal(passaNoQuadro(L({ dia: null }), F({ voo: "30d" }), HOJE), false);
  assert.equal(passaNoQuadro(L(), F({ voo: "livre", vooDe: "2026-11-21", vooAte: "" }), HOJE), true);
});

test("localizador, interno, pax e alertas", () => {
  assert.equal(passaNoQuadro(L(), F({ localizador: "sem" }), HOJE), false);
  assert.equal(passaNoQuadro(L(), F({ interno: "sim" }), HOJE), true);
  assert.equal(passaNoQuadro(L({ interno: 0 }), F({ interno: "nao" }), HOJE), true);
  assert.equal(passaNoQuadro(L({ interno: null }), F({ interno: "nao" }), HOJE), false);
  assert.equal(passaNoQuadro(L({ interno: null }), F({ interno: "sem_voo" }), HOJE), true);
  assert.equal(passaNoQuadro(L(), F({ pax: "2" }), HOJE), true);
  assert.equal(passaNoQuadro(L(), F({ pax: "3+" }), HOJE), false);
  assert.equal(passaNoQuadro(L(), F({ alertas: "urgente" }), HOJE), false);
  assert.equal(passaNoQuadro(L(), F({ alertas: "algum" }), HOJE), true);
  assert.equal(passaNoQuadro(L(), F({ alertas: "nenhum" }), HOJE), false);
});

test("filtros somam e contam", () => {
  const f = F({ responsavel: "gab", voo: "7d", interno: "sim" });
  assert.equal(passaNoQuadro(L(), f, HOJE), true);
  assert.equal(quantosAtivosQuadro(f), 3);
});

test("filtro guardado: lixo volta pro vazio", () => {
  assert.deepEqual(lerFiltroQuadro(null), FILTRO_QUADRO_VAZIO);
  assert.deepEqual(lerFiltroQuadro("{x"), FILTRO_QUADRO_VAZIO);
  const f = lerFiltroQuadro(JSON.stringify({ responsavel: "ana", voo: "nada", interno: "sim", pax: 9, vooDe: "ontem" }));
  assert.equal(f.responsavel, "ana"); assert.equal(f.voo, "tudo"); assert.equal(f.interno, "sim"); assert.equal(f.pax, ""); assert.equal(f.vooDe, "");
});
