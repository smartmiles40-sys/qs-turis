// Produto no "Ganho / Agendou" + cotações de aéreo (spec 06/11).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COTACAO_VAZIA, ESCOLHA_VAZIA, ROTA_PADRAO, camposDaEtapa, horasUteisEntre, mesAno, numeroBr,
  problemaDaCotacao, problemaDaEscolha, rotaDoProduto, tituloDoProduto,
  type DadosCotacao, type EscolhaProduto, type ExpedicaoAVenda,
} from "../../src/lib/qs/produtoGanho";

const esc = (p: Partial<EscolhaProduto>): EscolhaProduto => ({ ...ESCOLHA_VAZIA, ...p });
const cot = (p: Partial<DadosCotacao>): DadosCotacao => ({ ...COTACAO_VAZIA, ...p });
const EXPS = [
  { id: "e1", codigo: "ITA-2027-09", nome: "Itália – Costa Amalfitana - 2027", destino: "Itália", data_embarque: "2027-09-04", status: "Vendas Abertas" },
  { id: "e2", codigo: "X", nome: "Expedição Teste", destino: null, data_embarque: null, status: "Planejamento" },
] as unknown as ExpedicaoAVenda[];

test("rota: aéreo nunca gera reunião, sempre cotação", () => {
  assert.equal(rotaDoProduto("aereo"), "cotacao");
  assert.equal(rotaDoProduto("expedicao"), "reuniao");
  assert.equal(rotaDoProduto("pacote"), "reuniao");
  assert.equal(rotaDoProduto("outros"), "reuniao");
  assert.equal(rotaDoProduto(null), null);
  // a tabela produto_rota manda: se a gestão mudar, o front segue
  assert.equal(rotaDoProduto("pacote", { ...ROTA_PADRAO, pacote: "cotacao" }), "cotacao");
});

test("título: mesmo formato que o comercial escrevia à mão", () => {
  assert.equal(tituloDoProduto(esc({ tipo: "expedicao", expedicaoId: "e1" }), EXPS), "Expedição Itália – Costa Amalfitana - 2027");
  assert.equal(tituloDoProduto(esc({ tipo: "expedicao", expedicaoId: "e2" }), EXPS), "Expedição Teste");
  assert.equal(tituloDoProduto(esc({ tipo: "expedicao", detalhe: " Egito " }), EXPS), "Expedição Egito");
  assert.equal(tituloDoProduto(esc({ tipo: "pacote", detalhe: "Japão  /  China" })), "Pacote Japão / China");
  assert.equal(tituloDoProduto(esc({ tipo: "outros", detalhe: "Concierge Maldivas" })), "Concierge Maldivas");
});

test("validação: sem produto não há desfecho; pacote/outros pedem o destino", () => {
  assert.match(problemaDaEscolha(ESCOLHA_VAZIA) ?? "", /Escolha o produto/);
  assert.equal(problemaDaEscolha(esc({ tipo: "expedicao" })), null);
  assert.match(problemaDaEscolha(esc({ tipo: "pacote" })) ?? "", /destino do pacote/);
  assert.match(problemaDaEscolha(esc({ tipo: "outros", detalhe: "  " })) ?? "", /o que é/);
  assert.equal(problemaDaEscolha(esc({ tipo: "pacote", detalhe: "Japão" })), null);
});

test("cotação: trecho, ida e passageiros obrigatórios", () => {
  const ok = cot({ origem: "GRU", destino: "LIS", dataIda: "2027-03-10" });
  assert.equal(problemaDaCotacao(ok), null);
  assert.match(problemaDaCotacao(cot({ destino: "LIS", dataIda: "2027-03-10" })) ?? "", /origem e o destino/);
  assert.match(problemaDaCotacao(cot({ origem: "GRU", destino: "LIS" })) ?? "", /data de ida/);
  assert.match(problemaDaCotacao({ ...ok, dataVolta: "2027-03-01" }) ?? "", /volta não pode/);
  assert.match(problemaDaCotacao({ ...ok, adultos: 0 }) ?? "", /passageiros/);
  assert.match(problemaDaCotacao({ ...ok, orcamento: "abc" }) ?? "", /número/);
  assert.equal(problemaDaCotacao({ ...ok, orcamento: "R$ 4.500,00" }), null);
});

test("numeroBr entende o jeito brasileiro", () => {
  assert.equal(numeroBr("R$ 4.500,50"), 4500.5);
  assert.equal(numeroBr("4.500"), 4500);
  assert.equal(numeroBr("4500.5"), 4500.5);
  assert.ok(Number.isNaN(numeroBr("")));
});

test("etapas: campos exigidos espelham o gatilho do banco", () => {
  assert.deepEqual(camposDaEtapa("solicitada"), []);
  assert.deepEqual(camposDaEtapa("em_cotacao"), []);
  assert.deepEqual(camposDaEtapa("entregue"), ["valor_cotado", "canal_entrega", "validade_ate"]);
  assert.deepEqual(camposDaEtapa("aprovada"), ["valor_emitido"]);
  assert.deepEqual(camposDaEtapa("perdida"), ["motivo_perda"]);
});

test("horas úteis: só seg–sex, 8h–18h", () => {
  // sexta 16h → segunda 10h = 2h (sex) + 2h (seg)
  assert.equal(horasUteisEntre(new Date(2026, 10, 6, 16), new Date(2026, 10, 9, 10)), 4);
  // sábado inteiro não conta
  assert.equal(horasUteisEntre(new Date(2026, 10, 7, 9), new Date(2026, 10, 7, 17)), 0);
  // antes das 8h não conta
  assert.equal(horasUteisEntre(new Date(2026, 10, 5, 6), new Date(2026, 10, 5, 9)), 1);
  assert.equal(horasUteisEntre(new Date(2026, 10, 5, 9), new Date(2026, 10, 5, 8)), 0);
});

test("mesAno", () => {
  assert.equal(mesAno("2027-02-13"), "Fev/2027");
  assert.equal(mesAno(null), "");
});
