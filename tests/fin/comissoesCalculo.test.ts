// Comissões dos SDRs e closers (06/11): a conta pura.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categoriaDe, csvDasLinhas, linhasDoMes, numeroBr, resumoPorPessoa, valorDaRegra,
  type Ajuste, type Regra, type VendaCard,
} from "../../src/fin/comissoes/calculo";

const SDR = "sdr-mariana";
const CLOSER = "closer-talita";

const card = (p: Partial<VendaCard>): VendaCard => ({
  bitrix_id: "1", nome: "Cliente", pipeline: "Comercial 1 - Se tu for eu vou", fase: "Em emissão/venda realizada",
  tipo_venda: "Expedições", nome_expedicao: "Japão Out/27", total: 30000, data_venda: "2026-10-10",
  sdr: "Mariana Rodrigues - SDR", responsavel_reuniao: "Talita Carvalho", data_reuniao_realizada: "2026-10-05",
  no_show: false, sdr_id: SDR, closer_id: CLOSER, ...p,
});

const regras: Regra[] = [
  { papel: "sdr", pessoa_id: null, vigente_desde: "2026-01-01", valor_rr: 20, valor_expedicao: 50, pct_aereo: 2, pct_pacote: 1 },
  { papel: "closer", pessoa_id: null, vigente_desde: "2026-01-01", valor_rr: 999, valor_expedicao: 300, pct_aereo: 3, pct_pacote: 4 },
];

test("expedição é valor fixo; aéreo e pacote são percentual", () => {
  const l = linhasDoMes([
    card({ bitrix_id: "1" }),
    card({ bitrix_id: "2", tipo_venda: "Pacotes de Viagens", total: 10000 }),
    card({ bitrix_id: "3", tipo_venda: "Passagens aéreas", total: 5000, data_reuniao_realizada: null }),
  ], regras, [], "2026-10");
  const closer = l.filter((x) => x.papel === "closer");
  assert.deepEqual(closer.map((x) => x.comissao), [300, 400, 150]);
  const sdr = l.filter((x) => x.papel === "sdr");
  // card 1: R.R 20 + expedição 50; card 2: R.R 20 + 1% de 10.000; card 3: 2% de 5.000 (aéreo não tem R.R)
  assert.deepEqual(sdr.map((x) => x.comissao), [70, 120, 100]);
});

test("closer nunca ganha R.R, mesmo com valor na regra", () => {
  const l = linhasDoMes([card({ data_venda: null, total: null })], regras, [], "2026-10");
  assert.equal(l.length, 1);
  assert.equal(l[0].papel, "sdr");
  assert.equal(l[0].comissao, 20);
  assert.equal(l[0].venda_no_mes, false);
});

test("R.R conta no mês da reunião realizada; a venda no mês da data da venda", () => {
  const c = card({ data_reuniao_realizada: "2026-09-28", data_venda: "2026-10-03" });
  const set = linhasDoMes([c], regras, [], "2026-09").filter((x) => x.papel === "sdr");
  const out = linhasDoMes([c], regras, [], "2026-10").filter((x) => x.papel === "sdr");
  assert.equal(set[0].comissao, 20);
  assert.equal(set[0].valor_venda, 0);
  assert.equal(out[0].comissao, 50);
  assert.ok(out[0].selos.includes("R.R paga em outro mês"));
});

test("no-show sem fase de pós-reunião não é R.R", () => {
  const l = linhasDoMes([card({ no_show: true, fase: "No-show", data_venda: null })], regras, [], "2026-10");
  assert.equal(l.length, 0);
  const l2 = linhasDoMes([card({ no_show: true, fase: "Em negociação", data_venda: null })], regras, [], "2026-10");
  assert.equal(l2[0].comissao, 20);
});

test("exceção por pessoa só troca os campos preenchidos e respeita a vigência", () => {
  const r: Regra[] = [
    ...regras,
    { papel: "closer", pessoa_id: CLOSER, vigente_desde: "2026-10-15", valor_rr: null, valor_expedicao: 500, pct_aereo: null, pct_pacote: null },
    { papel: "closer", pessoa_id: null, vigente_desde: "2026-11-01", valor_rr: 0, valor_expedicao: 1000, pct_aereo: 10, pct_pacote: 10 },
  ];
  assert.equal(valorDaRegra(r, "closer", CLOSER, "2026-10-10", "valor_expedicao"), 300); // antes da exceção
  assert.equal(valorDaRegra(r, "closer", CLOSER, "2026-10-20", "valor_expedicao"), 500); // exceção
  assert.equal(valorDaRegra(r, "closer", CLOSER, "2026-10-20", "pct_aereo"), 3);        // campo vazio → geral
  assert.equal(valorDaRegra(r, "closer", "outro", "2026-10-20", "valor_expedicao"), 300);
  assert.equal(valorDaRegra(r, "closer", "outro", "2026-11-02", "valor_expedicao"), 1000); // regra nova não reescreve outubro
  assert.equal(valorDaRegra([], "sdr", null, "2026-10-01", "valor_rr"), 0);
});

test("venda de aéreo do próprio SDR é do SDR, não do closer", () => {
  const naoSeAplica = card({ bitrix_id: "49453", responsavel_reuniao: "Não se aplica", tipo_venda: null, total: 3433.22, closer_id: null });
  const mesmoNome = card({ bitrix_id: "9", responsavel_reuniao: "Mariana Rodrigues", tipo_venda: "Passagens aéreas", total: 1000, closer_id: SDR, data_reuniao_realizada: null });
  const l = linhasDoMes([naoSeAplica, mesmoNome], regras, [], "2026-10");
  assert.equal(l.filter((x) => x.papel === "closer").length, 0);
  const sdr = l.filter((x) => x.papel === "sdr");
  assert.equal(sdr.length, 2);
  assert.ok(sdr.every((x) => x.selos.includes("Venda do próprio SDR")));
  // "Não se aplica" sem tipo vira aéreo (como no Dashboard): 2% de 3.433,22; 49453 é da lista que conta R.R.
  assert.equal(sdr.find((x) => x.bitrix_id === "49453")!.comissao, 20 + 68.66);
  assert.equal(sdr.find((x) => x.bitrix_id === "9")!.comissao, 20);
});

test("aéreo fechado por closer continua do closer", () => {
  const l = linhasDoMes([card({ tipo_venda: "Passagens aéreas", total: 2000 })], regras, [], "2026-10");
  assert.equal(l.find((x) => x.papel === "closer")!.comissao, 60);
  // reunião de aéreo não é R.R (fora da lista)
  assert.equal(l.find((x) => x.papel === "sdr")!.rr_no_mes, false);
});

test("card sem tipo e tipo sem regra entram com 0 e selo", () => {
  const l = linhasDoMes([
    card({ bitrix_id: "1", tipo_venda: null }),
    card({ bitrix_id: "2", tipo_venda: "Seguro Viagem" }),
  ], regras, [], "2026-10").filter((x) => x.papel === "closer");
  assert.deepEqual(l.map((x) => x.comissao), [0, 0]);
  assert.ok(l[0].selos.includes("Sem tipo"));
  assert.ok(l[1].selos.includes("Sem regra"));
  assert.equal(categoriaDe({ tipo_venda: "Hospedagem", responsavel_reuniao: "x", sdr: "y" }), "sem_regra");
});

test("venda cancelada aparece com 0 e não soma", () => {
  const l = linhasDoMes([card({ fase: "Cancelamento/Desistência" })], regras, [], "2026-10");
  const c = l.find((x) => x.papel === "closer")!;
  assert.equal(c.comissao, 0);
  assert.equal(c.valor_venda, 0);
  assert.ok(c.selos.includes("Venda cancelada"));
  assert.equal(resumoPorPessoa(l).find((r) => r.papel === "closer")!.soma_vendas, 0);
});

test("ajuste do financeiro: valor manual, não comissiona e limpar (o mais novo vale)", () => {
  const aj = (p: Partial<Ajuste>): Ajuste => ({ bitrix_id: "1", pessoa_id: CLOSER, papel: "closer", mes: "2026-10", tipo: "valor", valor: 123.45, motivo: "m", criado_em: "2026-11-01T10:00:00Z", ...p });
  const c = card({ tipo_venda: "Seguro Viagem" });
  const um = linhasDoMes([c], regras, [aj({})], "2026-10").find((x) => x.papel === "closer")!;
  assert.equal(um.comissao, 123.45);
  assert.equal(um.comissao_calculada, 0);
  const dois = linhasDoMes([c], regras, [aj({}), aj({ tipo: "nao_comissiona", valor: null, criado_em: "2026-11-02T00:00:00Z" })], "2026-10").find((x) => x.papel === "closer")!;
  assert.equal(dois.comissao, 0);
  assert.ok(dois.selos.includes("Não comissiona"));
  const tres = linhasDoMes([c], regras, [aj({}), aj({ tipo: "limpar", valor: null, criado_em: "2026-11-03T00:00:00Z" })], "2026-10").find((x) => x.papel === "closer")!;
  assert.equal(tres.ajuste, null);
  // ajuste de outro mês não vale
  const quatro = linhasDoMes([c], regras, [aj({ mes: "2026-09" })], "2026-10").find((x) => x.papel === "closer")!;
  assert.equal(quatro.comissao, 0);
});

test("nome que não casou e card sem SDR nem closer vão pra fila sem dono", () => {
  const l = linhasDoMes([
    card({ bitrix_id: "1", sdr_id: null }),
    card({ bitrix_id: "2", sdr: "Não se aplica", responsavel_reuniao: "Não se aplica", sdr_id: null, closer_id: null }),
  ], regras, [], "2026-10");
  const semDono = l.filter((x) => !x.pessoa_id);
  assert.equal(semDono.length, 2);
  assert.equal(semDono[0].nome_bitrix, "Mariana Rodrigues");
  assert.ok(semDono.every((x) => x.selos.includes("Sem dono")));
});

test("resumo por pessoa e CSV com ; e número brasileiro", () => {
  const l = linhasDoMes([card({ bitrix_id: "1", total: 1234.5 }), card({ bitrix_id: "2", nome: 'Ana; "Bia"', total: 1000000 })], regras, [], "2026-10");
  const r = resumoPorPessoa(l).find((x) => x.papel === "closer")!;
  assert.equal(r.cards, 2);
  assert.equal(r.soma_vendas, 1001234.5);
  assert.equal(r.total, 600);
  assert.equal(numeroBr(1234.5), "1.234,50");
  assert.equal(numeroBr(-0.5), "-0,50");
  const csv = csvDasLinhas(l.filter((x) => x.papel === "sdr"), "sdr").split("\r\n");
  assert.equal(csv[0], "Pessoa;ID;Nome;R.R;Data da R.R;Valor da venda;Tipo da venda;Expedição;Data da venda;Pipeline;Comissão;Observação");
  assert.equal(csv[1], "Mariana Rodrigues;1;Cliente;Sim;05/10/2026;1.234,50;Expedições;Japão Out/27;10/10/2026;Comercial 1 - Se tu for eu vou;70,00;");
  assert.ok(csv[2].includes('"Ana; ""Bia"""'));
  assert.equal(csvDasLinhas([], "closer"), "Pessoa;ID;Nome;Valor da venda;Tipo da venda;Expedição;Data da venda;Pipeline;Comissão;Observação");
});
