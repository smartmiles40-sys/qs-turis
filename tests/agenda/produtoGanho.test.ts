// Produto no "Ganho / Agendou" (06/11): título, validação e demanda por produto.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ESCOLHA_VAZIA, demandaPorProduto, mesAno, problemaDaEscolha, sdrFazSozinho, somarDemanda, tituloDoProduto,
  type EscolhaProduto,
} from "../../src/lib/qs/produtoGanho";

const esc = (p: Partial<EscolhaProduto>): EscolhaProduto => ({ ...ESCOLHA_VAZIA, ...p });
const EXPS = [
  { id: "e1", codigo: "ITA-2027-09", nome: "Itália – Costa Amalfitana - 2027", destino: "Itália", data_embarque: "2027-09-04", status: "Vendas Abertas" },
  { id: "e2", codigo: "X", nome: "Expedição Teste", destino: null, data_embarque: null, status: "Planejamento" },
];

test("título: mesmo formato que o comercial escrevia à mão", () => {
  assert.equal(tituloDoProduto(esc({ tipo: "expedicao", expedicaoId: "e1" }), EXPS), "Expedição Itália – Costa Amalfitana - 2027");
  assert.equal(tituloDoProduto(esc({ tipo: "expedicao", expedicaoId: "e2" }), EXPS), "Expedição Teste"); // não repete "Expedição"
  assert.equal(tituloDoProduto(esc({ tipo: "expedicao", detalhe: " Egito " }), EXPS), "Expedição Egito");
  assert.equal(tituloDoProduto(esc({ tipo: "aereo", detalhe: "Lisboa" })), "Passagem aérea Lisboa");
  assert.equal(tituloDoProduto(esc({ tipo: "aereo" })), "Passagem aérea");
  assert.equal(tituloDoProduto(esc({ tipo: "pacote", detalhe: "Japão  /  China" })), "Pacote Japão / China");
  assert.equal(tituloDoProduto(esc({ tipo: "outros", detalhe: "Concierge Maldivas" })), "Concierge Maldivas");
});

test("validação: produto obrigatório; expedição pede qual; pacote/outros pedem o destino", () => {
  assert.match(problemaDaEscolha(ESCOLHA_VAZIA) ?? "", /Escolha o produto/);
  assert.match(problemaDaEscolha(esc({ tipo: "expedicao" })) ?? "", /qual expedição/);
  assert.equal(problemaDaEscolha(esc({ tipo: "expedicao", expedicaoId: "e1" })), null);
  assert.equal(problemaDaEscolha(esc({ tipo: "expedicao", detalhe: "Egito" })), null);
  assert.match(problemaDaEscolha(esc({ tipo: "pacote" })) ?? "", /destino do pacote/);
  assert.match(problemaDaEscolha(esc({ tipo: "outros", detalhe: "  " })) ?? "", /o que é/);
  assert.equal(problemaDaEscolha(esc({ tipo: "aereo" })), null); // aéreo sem trecho passa
});

test("só o aéreo tem o caminho 'eu mesmo emito'", () => {
  assert.equal(sdrFazSozinho(esc({ tipo: "aereo", quemFaz: "sdr" })), true);
  assert.equal(sdrFazSozinho(esc({ tipo: "aereo", quemFaz: "closer" })), false);
  assert.equal(sdrFazSozinho(esc({ tipo: "pacote", quemFaz: "sdr" })), false);
});

test("demanda: 1ª reunião por produto + aéreo do SDR; retomada/cancelada/reagendada fora", () => {
  const linhas = demandaPorProduto(
    [
      { owner_id: "ana", produto_tipo: "expedicao" },
      { owner_id: "ana", produto_tipo: "expedicao", status: "realizada" },
      { owner_id: "ana", produto_tipo: "aereo", status: "agendada" },
      { owner_id: "ana", produto_tipo: null },                                   // antes da 0321
      { owner_id: "ana", produto_tipo: "pacote", tipo: "retomada" },             // fora
      { owner_id: "ana", produto_tipo: "pacote", status: "cancelada" },          // fora
      { owner_id: "ana", produto_tipo: "pacote", status: "reagendada" },         // linha antiga: fora
      { owner_id: "bia", produto_tipo: "pacote" },
      { owner_id: null, produto_tipo: "pacote" },                                // sem dono: fora
    ],
    [{ owner_id: "bia", produto_tipo: "aereo" }, { owner_id: "bia", produto_tipo: "aereo" }, { owner_id: "caio", produto_tipo: "aereo" }],
  );
  const ana = linhas.find((l) => l.ownerId === "ana")!;
  assert.deepEqual(ana.closer, { aereo: 1, pacote: 0, expedicao: 2, outros: 0 });
  assert.equal(ana.semProduto, 1);
  assert.equal(ana.totalCloser, 4);
  assert.equal(ana.aereoSdr, 0);
  assert.equal(ana.total, 4);
  const bia = linhas.find((l) => l.ownerId === "bia")!;
  assert.equal(bia.totalCloser, 1);
  assert.equal(bia.aereoSdr, 2);
  assert.equal(bia.total, 3);
  assert.equal(linhas[0].ownerId, "ana"); // ordem: maior total primeiro
  const t = somarDemanda(linhas);
  assert.equal(t.total, 8);
  assert.equal(t.aereoSdr, 3);
  assert.equal(t.closer.pacote, 1);
});

test("mesAno", () => {
  assert.equal(mesAno("2027-02-13"), "Fev/2027");
  assert.equal(mesAno(null), "");
});
