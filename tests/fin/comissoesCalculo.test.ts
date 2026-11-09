// Comissões dos SDRs e closers: a conta pura, com as regras do PDF (0328, out/2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bonusDoDia, categoriaDe, csvDasLinhas, destinoDe, linhasDoMes, numeroBr, resumoPorPessoa, valorDaFaixa, valorDaRegra,
  type Ajuste, type Regra, type VendaCard,
} from "../../src/fin/comissoes/calculo";

const SDR = "sdr-mariana";
const CLOSER = "closer-talita";
const BRUNO = "closer-bruno";

const card = (p: Partial<VendaCard>): VendaCard => ({
  bitrix_id: "1", nome: "Cliente", pipeline: "Comercial 1 - Se tu for eu vou", fase: "Em emissão/venda realizada",
  tipo_venda: "Expedições", nome_expedicao: "Japão e China/ Out 2027", total: 30000, data_venda: "2026-10-10",
  sdr: "Mariana Rodrigues - SDR", responsavel_reuniao: "Talita Carvalho", data_reuniao_realizada: "2026-10-05",
  no_show: false, sdr_id: SDR, closer_id: CLOSER, ...p,
});

// O PDF.
const regras: Regra[] = [
  {
    papel: "sdr", pessoa_id: null, vigente_desde: "2026-10-01",
    valor_exp_geral: 50, valor_exp_peru: 25, valor_exp_amazonia: 15, valor_pacote: 20, valor_outros: 8, pct_lucro: 10, valor_cotacao: 8,
    faixas_rr: [{ de: 0, valor: 8 }, { de: 41, valor: 12 }, { de: 60, valor: 16 }, { de: 90, valor: 20 }],
    bonus_dia: [{ min: 6, valor: 20 }, { min: 10, valor: 40 }],
  },
  { papel: "closer", pessoa_id: null, vigente_desde: "2026-10-01", valor_exp_geral: 500, valor_exp_peru: 250, valor_exp_amazonia: 150, pct_lucro: 10 },
  { papel: "closer", pessoa_id: CLOSER, vigente_desde: "2026-10-01", pct_lucro: 11 },
];

const sdrDe = (ls: ReturnType<typeof linhasDoMes>) => ls.filter((x) => x.papel === "sdr");
const closerDe = (ls: ReturnType<typeof linhasDoMes>) => ls.filter((x) => x.papel === "closer");

test("destino da expedição: Peru, Amazônia e o resto é geral", () => {
  assert.equal(destinoDe("Peru/ Ago 2027"), "peru");
  assert.equal(destinoDe("Amazônia/ Jul 2027"), "amazonia");
  assert.equal(destinoDe("Egito/Set 2027"), "geral");
  assert.equal(destinoDe("Japão e China G2/ Abr 2027"), "geral");
  assert.equal(destinoDe(null), "geral");
});

test("expedição: fixo por destino pro SDR e pro closer", () => {
  const l = linhasDoMes([
    card({ bitrix_id: "1", data_reuniao_realizada: null }),
    card({ bitrix_id: "2", nome_expedicao: "Peru/ Ago 2027", data_reuniao_realizada: null }),
    card({ bitrix_id: "3", nome_expedicao: "Amazônia/ Jul 2027", data_reuniao_realizada: null }),
  ], regras, [], "2026-10");
  assert.deepEqual(sdrDe(l).map((x) => x.comissao), [50, 25, 15]);
  assert.deepEqual(closerDe(l).map((x) => x.comissao), [500, 250, 150]);
});

test("SDR: pacote R$ 20, outros e aéreo do closer R$ 8; closer: % do lucro por pessoa", () => {
  const l = linhasDoMes([
    card({ bitrix_id: "1", tipo_venda: "Pacotes de Viagens", total: 10000, data_reuniao_realizada: null }),
    card({ bitrix_id: "2", tipo_venda: "Seguro Viagem", total: 1000, data_reuniao_realizada: null, responsavel_reuniao: "Bruno Matheus", closer_id: BRUNO }),
    card({ bitrix_id: "3", tipo_venda: "Passagens aéreas", total: 5000, data_reuniao_realizada: null }),
  ], regras, [], "2026-10", { lucros: { "1": 2000, "2": 300, "3": 500 } });
  assert.deepEqual(sdrDe(l).map((x) => x.comissao), [20, 8, 8]);
  // Talita 11% de 2.000 e de 500; Bruno 10% de 300
  assert.deepEqual(closerDe(l).map((x) => x.comissao), [220, 30, 55]);
});

test("closer sem lucro digitado: R$ 0 com selo Falta lucro; custo do Bitrix vira lucro", () => {
  const l = linhasDoMes([
    card({ bitrix_id: "1", tipo_venda: "Pacotes de Viagens", total: 10000, data_reuniao_realizada: null }),
    card({ bitrix_id: "2", tipo_venda: "Pacotes de Viagens", total: 10000, custo: 8000, data_reuniao_realizada: null }),
  ], regras, [], "2026-10");
  const c = closerDe(l);
  assert.equal(c[0].comissao, 0);
  assert.ok(c[0].selos.includes("Falta lucro"));
  assert.equal(c[1].lucro, 2000);
  assert.equal(c[1].lucro_origem, "bitrix");
  assert.equal(c[1].comissao, 220);
  assert.equal(resumoPorPessoa(c)[0].falta_lucro, 1);
});

test("aéreo vendido pelo próprio SDR: 10% do lucro pro SDR, nada pro closer", () => {
  const l = linhasDoMes([card({ tipo_venda: "Passagens aéreas", total: 8000, responsavel_reuniao: "Não se aplica", closer_id: null, data_reuniao_realizada: null })],
    regras, [], "2026-10", { lucros: { "1": 900 } });
  assert.equal(l.length, 1);
  assert.equal(l[0].papel, "sdr");
  assert.equal(l[0].comissao, 90);
  assert.ok(l[0].selos.includes("Venda do próprio SDR"));
});

test("faixa de R.R: o valor da faixa vale pra TODAS as R.R do mês", () => {
  assert.equal(valorDaFaixa(regras[0].faixas_rr!, 40).valor, 8);
  assert.equal(valorDaFaixa(regras[0].faixas_rr!, 41).valor, 12);
  assert.equal(valorDaFaixa(regras[0].faixas_rr!, 89).valor, 16);
  assert.equal(valorDaFaixa(regras[0].faixas_rr!, 90).valor, 20);
  const so = (n: number) => Array.from({ length: n }, (_, i) => card({ bitrix_id: String(100 + i), data_venda: null, total: null }));
  const l40 = linhasDoMes(so(40), regras, [], "2026-10");
  assert.equal(resumoPorPessoa(l40)[0].total, 40 * 8);
  const l62 = linhasDoMes(so(62), regras, [], "2026-10");
  assert.equal(resumoPorPessoa(l62)[0].total, 62 * 16);
  assert.ok(l62.every((x) => x.valor_por_rr === 16));
});

test("R.R de aéreo do próprio SDR recebe a faixa mas não conta pra subir", () => {
  // 40 R.R normais + 1 de aéreo que conta (lista do Dashboard): continua na faixa base.
  const normais = Array.from({ length: 40 }, (_, i) => card({ bitrix_id: String(100 + i), data_venda: null, total: null }));
  const aereo = card({ bitrix_id: "47771", tipo_venda: "Passagens aéreas", responsavel_reuniao: "Não se aplica", data_venda: null, total: null });
  const l = linhasDoMes([...normais, aereo], regras, [], "2026-10");
  const r = resumoPorPessoa(l)[0];
  assert.equal(r.rr, 41);
  assert.equal(r.rr_faixa, 40);
  assert.equal(r.total, 41 * 8);
  assert.ok(l.find((x) => x.bitrix_id === "47771")!.selos.includes("R.R de aéreo: fora da faixa"));
});

test("closer nunca ganha R.R", () => {
  const l = linhasDoMes([card({ data_venda: null, total: null })], regras, [], "2026-10");
  assert.equal(l.length, 1);
  assert.equal(l[0].papel, "sdr");
  assert.equal(l[0].comissao, 8);
});

test("R.R conta no mês da reunião realizada; a venda no mês da data da venda", () => {
  const c = card({ data_reuniao_realizada: "2026-09-28", data_venda: "2026-10-03" });
  const regrasSet = regras.map((r) => ({ ...r, vigente_desde: "2026-01-01" }));
  const set = sdrDe(linhasDoMes([c], regrasSet, [], "2026-09"));
  const out = sdrDe(linhasDoMes([c], regrasSet, [], "2026-10"));
  assert.equal(set[0].comissao, 8);
  assert.equal(set[0].valor_venda, 0);
  assert.equal(out[0].comissao, 50);
  assert.ok(out[0].selos.includes("R.R paga em outro mês"));
});

test("no-show sem fase de pós-reunião não é R.R", () => {
  assert.equal(linhasDoMes([card({ no_show: true, fase: "No-show", data_venda: null })], regras, [], "2026-10").length, 0);
  const l2 = linhasDoMes([card({ no_show: true, fase: "Em negociação", data_venda: null })], regras, [], "2026-10");
  assert.equal(l2[0].comissao, 8);
});

test("bônus diário: maior faixa batida no dia, sem somar", () => {
  assert.equal(bonusDoDia(regras[0].bonus_dia!, 5), 0);
  assert.equal(bonusDoDia(regras[0].bonus_dia!, 6), 20);
  assert.equal(bonusDoDia(regras[0].bonus_dia!, 10), 40);
  const agendou = (n: number, dia: string) => Array.from({ length: n }, (_, i) =>
    card({ bitrix_id: `${dia}-${i}`, data_quando_agendou: dia, data_venda: null, total: null, data_reuniao_realizada: null }));
  const l = linhasDoMes([...agendou(7, "2026-10-06"), ...agendou(11, "2026-10-09"), ...agendou(5, "2026-10-10")], regras, [], "2026-10");
  const bonus = l.filter((x) => x.tipo_linha === "bonus_dia");
  assert.deepEqual(bonus.map((x) => [x.data_ref, x.agendamentos, x.comissao]), [["2026-10-06", 7, 20], ["2026-10-09", 11, 40]]);
  const r = resumoPorPessoa(l)[0];
  assert.equal(r.dias_bonus, 2);
  assert.equal(r.total, 60);
});

test("cotação de aéreo entregue no mês: R$ 8 por proposta", () => {
  const l = linhasDoMes([], regras, [], "2026-11", { cotacoes: [
    { id: "a", sdr_id: SDR, destino: "Lisboa", status: "entregue", entregue_em: "2026-11-07T15:00:00Z", negocio_bitrix_id: null },
    { id: "b", sdr_id: SDR, destino: null, status: "aprovada", entregue_em: "2026-12-01T01:00:00Z", negocio_bitrix_id: null }, // 30/11 em Brasília
    { id: "c", sdr_id: SDR, destino: null, status: "entregue", entregue_em: "2026-10-31T12:00:00Z", negocio_bitrix_id: null },
  ] });
  assert.deepEqual(l.map((x) => [x.tipo_linha, x.comissao]), [["cotacao", 8], ["cotacao", 8]]);
  assert.equal(resumoPorPessoa(l)[0].cotacoes, 2);
});

test("exceção por pessoa só troca os campos preenchidos e respeita a vigência", () => {
  assert.equal(valorDaRegra(regras, "closer", CLOSER, "2026-10-10", "pct_lucro"), 11);
  assert.equal(valorDaRegra(regras, "closer", CLOSER, "2026-10-10", "valor_exp_geral"), 500);
  assert.equal(valorDaRegra(regras, "closer", BRUNO, "2026-10-10", "pct_lucro"), 10);
  assert.equal(valorDaRegra(regras, "closer", CLOSER, "2026-09-30", "pct_lucro"), 0);
});

test("categorias", () => {
  assert.equal(categoriaDe({ tipo_venda: "Hospedagem", responsavel_reuniao: "x", sdr: "y" }), "outros");
  assert.equal(categoriaDe({ tipo_venda: null, responsavel_reuniao: "Talita", sdr: "y" }), "sem_tipo");
  assert.equal(categoriaDe({ tipo_venda: null, responsavel_reuniao: "Não se aplica", sdr: "Mariana" }), "aereo");
});

test("card sem tipo entra com 0 e selo; expedição sem nome paga o geral com selo", () => {
  const l = linhasDoMes([
    card({ bitrix_id: "1", tipo_venda: null, data_reuniao_realizada: null }),
    card({ bitrix_id: "2", nome_expedicao: null, data_reuniao_realizada: null }),
  ], regras, [], "2026-10");
  const s = sdrDe(l);
  assert.equal(s[0].comissao, 0);
  assert.ok(s[0].selos.includes("Sem tipo"));
  assert.equal(s[1].comissao, 50);
  assert.ok(s[1].selos.includes("Expedição sem nome"));
});

test("venda cancelada aparece com 0 e não soma", () => {
  const l = linhasDoMes([card({ fase: "Cancelamento/Desistência", data_reuniao_realizada: null })], regras, [], "2026-10");
  assert.ok(l.every((x) => x.comissao === 0 && x.cancelada && x.selos.includes("Venda cancelada")));
  assert.equal(resumoPorPessoa(l)[0].vendas, 0);
});

test("ajuste do financeiro: valor manual, não comissiona e limpar (o mais novo vale)", () => {
  const aj = (tipo: Ajuste["tipo"], valor: number | null, em: string): Ajuste =>
    ({ bitrix_id: "1", pessoa_id: SDR, papel: "sdr", mes: "2026-10", tipo, valor, motivo: "teste", criado_em: em });
  const c = [card({ data_reuniao_realizada: null })];
  assert.equal(sdrDe(linhasDoMes(c, regras, [aj("valor", 99, "2026-11-01")], "2026-10"))[0].comissao, 99);
  assert.equal(sdrDe(linhasDoMes(c, regras, [aj("valor", 99, "2026-11-01"), aj("nao_comissiona", null, "2026-11-02")], "2026-10"))[0].comissao, 0);
  const limpo = sdrDe(linhasDoMes(c, regras, [aj("valor", 99, "2026-11-01"), aj("limpar", null, "2026-11-03")], "2026-10"))[0];
  assert.equal(limpo.comissao, 50);
  assert.equal(limpo.ajuste, null);
});

test("nome que não casou e card sem SDR nem closer vão pra fila sem dono", () => {
  const l = linhasDoMes([
    card({ bitrix_id: "1", sdr_id: null, data_reuniao_realizada: null }),
    card({ bitrix_id: "2", sdr: "Não se aplica", responsavel_reuniao: "Não se aplica", sdr_id: null, closer_id: null, data_reuniao_realizada: null }),
  ], regras, [], "2026-10");
  const sem = l.filter((x) => !x.pessoa_id);
  assert.equal(sem.length, 2);
  assert.ok(sem.every((x) => x.selos.includes("Sem dono")));
});

test("resumo por pessoa e CSV com ; e número brasileiro", () => {
  const l = linhasDoMes([card({}), card({ bitrix_id: "2", nome: 'Ana; "Bia"', total: 1234.5 })], regras, [], "2026-10");
  const r = resumoPorPessoa(sdrDe(l))[0];
  assert.equal(r.cards, 2);
  assert.equal(r.rr, 2);
  assert.equal(r.total, 2 * 8 + 2 * 50);
  assert.equal(numeroBr(1234.5), "1.234,50");
  const csv = csvDasLinhas(sdrDe(l), "sdr");
  assert.ok(csv.split("\r\n")[0].startsWith("Pessoa;ID;Nome;R.R"));
  assert.ok(csv.includes('"Ana; ""Bia"""'));
  assert.ok(csv.includes("1.234,50"));
});

test("supervisor fora da comissão some da conta", () => {
  const fora: Regra[] = [...regras, { papel: "closer", pessoa_id: BRUNO, vigente_desde: "2026-10-01", sem_comissao: true }];
  const l = linhasDoMes([card({ responsavel_reuniao: "Bruno Matheus", closer_id: BRUNO, data_reuniao_realizada: null })], fora, [], "2026-10");
  assert.equal(closerDe(l).length, 0);
  assert.equal(sdrDe(l).length, 1);
});
