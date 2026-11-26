// 26/11 (Bruno): coluna PASSAGEM da matriz de passageiros das Expedições.
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/expedicoes/passagem.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { avaliarPassagem, iataDe, pontoDeEncontro, ufDoCep, ufDoTexto, type EntradaPassagem, type VooPassagem } from "../../src/expedicoes/lib/cockpit/passagem.ts";

const V = (lado: VooPassagem["lado"], numero: string, origem: string, destino: string, localizador: string | null = "CR6IJF"): VooPassagem => ({ lado, numero, origem, destino, localizador });
const grupo = [
  V("ida", "Emirates 262", "São Paulo (GRU)", "Dubai (DXB)"), V("ida", "Emirates 376", "Dubai (DXB)", "Bangkok (BKK)"),
  V("volta", "Emirates 385", "Bangkok (BKK)", "Dubai (DXB)"), V("volta", "Emirates 261", "Dubai (DXB)", "São Paulo (GRU)"),
];
const base: EntradaPassagem = { aereoIncluso: true, fonteIncluso: "bitrix", grupo, proprios: [], ufCasa: "SP", vooNacionalMarcado: false };

test("UF pelo CEP e pelo texto do estado", () => {
  assert.equal(ufDoCep("60055-000"), "CE");
  assert.equal(ufDoCep("04106-000"), "SP");
  assert.equal(ufDoCep("69060000"), "AM");
  assert.equal(ufDoCep("123"), null);
  assert.equal(ufDoTexto("Ceará"), "CE");
  assert.equal(ufDoTexto("Ceara"), "CE");
  assert.equal(ufDoTexto("São Paulo - SP"), "SP");
  assert.equal(ufDoTexto("Rn"), "RN");
  assert.equal(iataDe("São Paulo (GRU) · Terminal 3"), "GRU");
  assert.equal(pontoDeEncontro(grupo), "GRU");
});

test("mora em SP e vai no voo do grupo emitido → Emitida (verde)", () => {
  const r = avaliarPassagem(base);
  assert.equal(r.rotulo, "Emitida");
  assert.equal(r.tom, "ok");
  assert.equal(r.pendente, false);
});

test("Mariana (CE): voo do grupo + GOL FOR→GRU comprado à parte → Emitida + nacional", () => {
  const r = avaliarPassagem({ ...base, ufCasa: "CE", aereoIncluso: null, fonteIncluso: null,
    proprios: [V(null, "G31555", "FOR", "GRU", "HAZINC"), V(null, "G31558", "GRU", "FOR", "HAZINC")] });
  assert.equal(r.rotulo, "Emitida + nacional");
  assert.equal(r.tom, "ok");
  assert.match(r.dica, /mora em CE, o grupo sai de GRU/);
});

test("mora no CE sem bilhete nacional → falta nacional (amarelo)", () => {
  const r = avaliarPassagem({ ...base, ufCasa: "CE" });
  assert.equal(r.rotulo, "Emitida · falta nacional");
  assert.equal(r.tom, "warn");
  assert.equal(r.pendente, true);
});

test("volta separada (voo próprio nas Expedições)", () => {
  const r = avaliarPassagem({ ...base, proprios: [V("volta", "Emirates 385", "Bangkok (BKK)", "Dubai (DXB)", "IKV766"), V("volta", "Emirates 261", "Dubai (DXB)", "São Paulo (GRU)", "IKV766")] });
  assert.equal(r.rotulo, "Emitida · volta separada");
});

test("Passagem Aérea 'Não inclusa' e nenhum bilhete → vermelho; depois do embarque só amarelo", () => {
  const e = { ...base, aereoIncluso: false };
  assert.equal(avaliarPassagem(e).rotulo, "Compra própria · sem bilhete");
  assert.equal(avaliarPassagem(e).tom, "danger");
  assert.equal(avaliarPassagem(e, true).tom, "warn");
  assert.equal(avaliarPassagem(e, true).pendente, false);
});

test("grupo sem localizador → Falta emitir", () => {
  const r = avaliarPassagem({ ...base, grupo: grupo.map((v) => ({ ...v, localizador: null })) });
  assert.equal(r.rotulo, "Falta emitir");
  assert.equal(r.tom, "warn");
});

test("sem CEP: não inventa voo nacional", () => {
  const r = avaliarPassagem({ ...base, ufCasa: null });
  assert.equal(r.rotulo, "Emitida");
  assert.match(r.dica, /sem CEP/);
});
