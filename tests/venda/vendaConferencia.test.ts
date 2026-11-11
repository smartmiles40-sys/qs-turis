// Análise pós-venda — regras novas do subir venda final (api/_vendaConferencia.js, 11/11/2026):
// pagamento em linhas × total, família (vínculo/CPF/nascimento, menor sem responsável, pessoa sem item),
// nome no bilhete × ficha (tolera nome do meio abreviado), datas do item × expedição, leitura da resposta da IA.
//   node --import ./tests/registrar-ts.mjs --test tests/venda/vendaConferencia.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compararNomeFicha, conferirVenda, cpfValido, familiaDaVenda, idadeEm, lerRespostaIa, linhasDePagamento, materialParaIa,
} from "../../api/_vendaConferencia.js";

const HOJE = "2026-11-11";
const CPF_OK = "52998224725"; // CPF de exemplo com dígitos verificadores válidos
type Risco = { nivel: string; categoria: string; motivo: string; fonte: string; pessoa?: string; item?: string; o_que_fazer?: string };
const riscos = (ctx: Record<string, unknown>): Risco[] => conferirVenda({ hoje: HOJE, ...ctx }).riscos;
const de = (rs: Risco[], cat: string) => rs.filter((r) => r.categoria === cat);
const HOTEL = { tipo: "hospedagem", nome: "Hotel Lima", data_inicio: "2027-03-10", data_fim: "2027-03-15", status: "emitido", dados: { localizador: "H1" } };

// ── Pagamento em linhas ─────────────────────────────────────────────────────
test("pagamento: soma das linhas menor que o total = risco ALTO apontando o Pagamento", () => {
  const rs = de(riscos({ vendido: [HOTEL], total_venda: 17000, pagamentos: [
    { forma: "pix", valor: 5000, data: "2026-11-20", parcelas: 1 },
    { forma: "cartao", valor: 10000, data: "2026-11-20", parcelas: 10 },
  ] }), "pagamento");
  const soma = rs.find((r) => /soma das linhas/.test(r.motivo));
  assert.ok(soma, "tem o risco da soma");
  assert.equal(soma!.nivel, "alto");
  assert.match(soma!.motivo, /R\$\s?15\.000,00.*R\$\s?17\.000,00.*faltam R\$\s?2\.000,00/);
  assert.equal(soma!.item, "Pagamento");
  assert.ok(soma!.o_que_fazer);
});

test("pagamento: soma igual ao total não aponta nada; soma maior = médio; valor em texto '1.500,00' é lido", () => {
  const ok = de(riscos({ vendido: [HOTEL], total_venda: 3000, pagamentos: [
    { forma: "pix", valor: "1.500,00", data: "2026-11-20", parcelas: 1 }, { forma: "boleto", valor: "1500.00", data: "2026-12-20", parcelas: 1 },
  ] }), "pagamento");
  assert.deepEqual(ok, []);
  const mais = de(riscos({ vendido: [HOTEL], total_venda: 1000, pagamentos: [{ forma: "pix", valor: 1200, data: "2026-11-20", parcelas: 1 }] }), "pagamento");
  assert.equal(mais.length, 1);
  assert.equal(mais[0].nivel, "medio");
  assert.match(mais[0].motivo, /sobram/);
});

test("pagamento: linha incompleta, vencendo depois do embarque e com data passada", () => {
  const rs = de(riscos({ vendido: [HOTEL], total_venda: 3000, pagamentos: [
    { forma: "", valor: 1000, data: "", parcelas: 0 },
    { forma: "boleto", valor: 1000, data: "2027-04-01", parcelas: 1 },
    { forma: "pix", valor: 1000, data: "2026-11-01", parcelas: 1 },
  ] }), "pagamento");
  const l1 = rs.find((r) => /^Pagamento 1/.test(r.motivo))!;
  assert.match(l1.motivo, /sem forma de pagamento, sem data e nº de parcelas inválido \(0\)/);
  assert.equal(l1.nivel, "medio");
  assert.equal(l1.item, "Pagamento 1");
  const l2 = rs.find((r) => /^Pagamento 2/.test(r.motivo))!;
  assert.match(l2.motivo, /depois do embarque \(10\/03\/2027\)/);
  const l3 = rs.find((r) => /^Pagamento 3/.test(r.motivo))!;
  assert.equal(l3.nivel, "baixo");
  assert.match(l3.motivo, /já passou/);
});

test("pagamento: venda antiga (sem linhas) segue as regras de antes; lista vazia com total = médio", () => {
  const antiga = de(riscos({ vendido: [HOTEL], total_venda: 1000, pagamento: { forma: "" } }), "pagamento");
  assert.deepEqual(antiga.map((r) => r.motivo), ["Forma de pagamento não registrada."]);
  const vazia = de(riscos({ vendido: [HOTEL], total_venda: 1000, pagamentos: [] }), "pagamento");
  assert.equal(vazia.length, 1);
  assert.match(vazia[0].motivo, /Nenhuma linha de pagamento/);
  assert.equal(linhasDePagamento(undefined), null);
  assert.deepEqual(linhasDePagamento([null, { forma: "PIX", valor: "10", ordem: 2 }, { forma: "boleto", valor: 5, ordem: 1 }])!.map((l) => [l.n, l.forma]), [[1, "boleto"], [2, "pix"]]);
});

// ── Família ─────────────────────────────────────────────────────────────────
const comp = { nome: "Carlos Souza", comprador: true, cpf: CPF_OK, nascimento: "1980-01-01", chave: "c", itens: [] };

test("família: pessoa sem vínculo, CPF e nascimento = 1 risco médio que aponta a pessoa", () => {
  const rs = de(riscos({ vendido: [HOTEL], familia: [comp, { nome: "Ana Souza", chave: "a", itens: [] }] }), "familia");
  assert.equal(rs.length, 1);
  assert.equal(rs[0].nivel, "medio");
  assert.equal(rs[0].pessoa, "Ana Souza");
  assert.match(rs[0].motivo, /^Ana Souza: falta o vínculo com o comprador, o CPF e a data de nascimento\.$/);
});

test("família: CPF com dígito errado = médio (sem mostrar o número); comprador do banco também é conferido", () => {
  const rs = de(riscos({ vendido: [HOTEL], familia: [{ ...comp, cpf: "52998224700" }, { nome: "Ana Souza", chave: "a", vinculo: "conjuge", cpf: CPF_OK, nascimento: "1982-02-02", itens: [] }] }), "familia");
  assert.equal(rs.length, 1);
  assert.match(rs[0].motivo, /Carlos Souza: CPF inválido/);
  assert.doesNotMatch(rs[0].motivo, /\d{5}/);
  assert.ok(cpfValido(CPF_OK) && !cpfValido("11111111111") && !cpfValido("123"));
});

test("família: no rascunho (passageiros dos itens) o comprador não é cobrado; quem vai junto é", () => {
  const exp = { tipo: "expedicao", nome: "Expedição Japão", passageiros: [
    { chave: "c", comprador: true, nome: "Carlos Souza", cpf: null, nascimento: null },
    { chave: "a", comprador: false, nome: "Ana Souza", vinculo: "conjuge", cpf: CPF_OK, nascimento: null },
  ] };
  const fam = familiaDaVenda({ vendido: [exp] });
  assert.equal(fam.length, 2);
  const rs = de(riscos({ vendido: [exp] }), "familia");
  assert.deepEqual(rs.map((r) => r.motivo), ["Ana Souza: falta a data de nascimento."]);
});

test("família: menor sem responsável, responsável menor e comprador menor", () => {
  const ini = "2027-03-10";
  const exp = { tipo: "hospedagem", nome: "Hotel", data_inicio: ini, data_fim: "2027-03-12" };
  const crianca = { nome: "Bia Souza", chave: "b", vinculo: "filho", cpf: CPF_OK, nascimento: "2015-05-05", itens: [] };
  // Sem comprador na lista (banco) e sem responsável → médio.
  let rs = de(riscos({ vendido: [exp], familia: [crianca] }), "familia");
  assert.ok(rs.some((r) => r.nivel === "medio" && /Bia Souza é menor de idade e está sem responsável/.test(r.motivo)));
  // Responsável indicado também é menor → alto.
  const irmao = { nome: "Leo Souza", chave: "l", vinculo: "irmao", cpf: CPF_OK, nascimento: "2012-01-01", itens: [] };
  rs = de(riscos({ vendido: [exp], familia: [comp, irmao, { ...crianca, responsavel: "l" }] }), "familia");
  assert.ok(rs.some((r) => r.nivel === "alto" && /responsável \(Leo Souza\) também é menor/.test(r.motivo)));
  // Responsável que saiu da venda → médio.
  rs = de(riscos({ vendido: [exp], familia: [comp, { ...crianca, responsavel: "sumiu" }] }), "familia");
  assert.ok(rs.some((r) => /responsável indicado não está/.test(r.motivo)));
  // Comprador menor → alto.
  rs = de(riscos({ vendido: [exp], familia: [{ ...comp, nascimento: "2010-01-01" }] }), "familia");
  assert.ok(rs.some((r) => r.nivel === "alto" && /menor de idade e está como comprador/.test(r.motivo)));
  // Com comprador adulto e sem responsável indicado = o comprador → sem risco de responsável.
  rs = de(riscos({ vendido: [exp], familia: [comp, crianca] }), "familia");
  assert.deepEqual(rs, []);
  // Coluna `menor` do banco vale mais que a conta pela data.
  rs = de(riscos({ vendido: [exp], familia: [{ ...crianca, nascimento: "1990-01-01", menor: true }] }), "familia");
  assert.ok(rs.some((r) => /menor de idade/.test(r.motivo)));
  assert.equal(idadeEm("2015-05-05", "2027-03-10"), 11);
});

test("família: pessoa sem item/passageiro", () => {
  const aereo = { tipo: "aereo", nome: "Aéreo", passageiros: [{ chave: "c", comprador: true, nome: "Carlos Souza" }] };
  const hotel = { tipo: "hospedagem", nome: "Hotel", passageiros: [{ chave: "c", comprador: true, nome: "Carlos Souza" }] };
  // Rascunho: Ana está na família (vinda de "pessoas") mas não em nenhum item.
  let rs = de(riscos({ vendido: [aereo, hotel], familia: [comp, { nome: "Ana Souza", chave: "a", vinculo: "conjuge", cpf: CPF_OK, nascimento: "1982-02-02" }] }), "familia");
  assert.equal(rs.length, 1);
  assert.match(rs[0].motivo, /Ana Souza está em "Quem vai", mas não está em nenhum item/);
  assert.equal(rs[0].pessoa, "Ana Souza");
  // Banco: itens [] = "em todos" → ok; itens com ordem que não existe → risco.
  const ana = { nome: "Ana Souza", chave: "a", vinculo: "conjuge", cpf: CPF_OK, nascimento: "1982-02-02" };
  const itensBanco = [{ ...aereo, ordem: 0, passageiros: [] }, { ...hotel, ordem: 1, passageiros: [] }];
  assert.deepEqual(de(riscos({ vendido: itensBanco, familia: [comp, { ...ana, itens: [] }] }), "familia"), []);
  assert.deepEqual(de(riscos({ vendido: itensBanco, familia: [comp, { ...ana, itens: [1] }] }), "familia"), []);
  assert.equal(de(riscos({ vendido: itensBanco, familia: [comp, { ...ana, itens: [7] }] }), "familia").length, 1);
  // Pessoa removida não conta.
  assert.equal(familiaDaVenda({ familia: [comp, { ...ana, removida_em: "2026-11-10" }] }).length, 1);
});

// ── Nome no bilhete × ficha ─────────────────────────────────────────────────
test("nome: comparação sem acento, SOBRENOME/NOME, tolera nome do meio abreviado", () => {
  assert.equal(compararNomeFicha("José da Conceição", "CONCEICAO/JOSE MR"), "igual");
  assert.equal(compararNomeFicha("Maria Clara Silva", "SILVA/MARIA C"), "abreviado");
  assert.equal(compararNomeFicha("Maria Clara Silva", "Maria C. Silva"), "abreviado");
  assert.equal(compararNomeFicha("Maria C. Silva", "Maria Clara Silva"), "abreviado");
  assert.equal(compararNomeFicha("Maria Clara Silva", "SILVA/MARIA"), "parcial");
  assert.equal(compararNomeFicha("Maria Clara Silva", "Maria Beatriz Silva"), "parcial");
  assert.equal(compararNomeFicha("Maria Clara Silva", "Carlos Souza"), "diferente");
  assert.equal(compararNomeFicha("", "Carlos"), null);
});

test("nome: bilhete com nome do meio abreviado não vira risco; desconhecido = alto apontando pessoa e item", () => {
  const trecho = (pax: string[]) => ({ fonte: "trecho", tipo: "aereo", trecho: { origem: "GRU", destino: "LIM", data: "2027-03-10", localizador: "ABC123", passageiros: pax } });
  const fam = [{ nome: "Maria Clara Silva", comprador: true, cpf: CPF_OK, nascimento: "1990-01-01", itens: [] }];
  assert.deepEqual(de(riscos({ vendido: [], emitido: [trecho(["SILVA/MARIA C MRS"])], familia: fam }), "nome"), []);
  const rs = de(riscos({ vendido: [], emitido: [trecho(["SOUZA/CARLOS"])], familia: fam }), "nome");
  assert.equal(rs.length, 1);
  assert.equal(rs[0].nivel, "alto");
  assert.equal(rs[0].pessoa, "Carlos Souza");
  assert.equal(rs[0].item, "GRU → LIM");
  assert.match(rs[0].motivo, /Aéreo: GRU → LIM/);
});

// ── Datas do item × expedição ───────────────────────────────────────────────
const EXP = { id: "e1", nome: "Japão Março", data_embarque: "2027-03-10", data_retorno: "2027-03-22" };

test("datas: item da expedição com embarque diferente = alto; retorno diferente = médio", () => {
  const rs = de(riscos({ vendido: [{ tipo: "expedicao", nome: "Expedição Japão", data_inicio: "2027-03-11", data_fim: "2027-03-20", dados: { expedicao_id: "e1" } }], expedicoes: [EXP] }), "datas");
  assert.equal(rs.length, 2);
  assert.ok(rs.some((r) => r.nivel === "alto" && /início no item 11\/03\/2027 ≠ embarque da expedição 10\/03\/2027/.test(r.motivo) && r.item === "Expedição Japão"));
  assert.ok(rs.some((r) => r.nivel === "medio" && /retorno da expedição 22\/03\/2027/.test(r.motivo)));
});

test("datas: datas certas não apontam nada; hotel fora do período = médio; sem expedições a regra não roda", () => {
  const exp = { tipo: "expedicao", nome: "Expedição Japão", data_inicio: "2027-03-10", data_fim: "2027-03-22", dados: { expedicao_id: "e1" } };
  assert.deepEqual(de(riscos({ vendido: [exp], expedicoes: [EXP] }), "datas"), []);
  const hotelLonge = { tipo: "hospedagem", nome: "Hotel Tóquio", data_inicio: "2027-05-01", data_fim: "2027-05-03" };
  const rs = de(riscos({ vendido: [exp, hotelLonge], expedicoes: [EXP] }), "datas");
  assert.equal(rs.length, 1);
  assert.match(rs[0].motivo, /Hotel Tóquio .* fora do período da expedição/);
  const extensao = { tipo: "hospedagem", nome: "Hotel pré", data_inicio: "2027-03-07", data_fim: "2027-03-10" };
  assert.deepEqual(de(riscos({ vendido: [exp, extensao], expedicoes: [EXP] }), "datas"), [], "extensão colada (±7 dias) passa");
  assert.deepEqual(de(riscos({ vendido: [{ ...exp, data_inicio: "2027-01-01" }] }), "datas"), [], "venda antiga sem expedições");
});

// ── Resposta da IA ──────────────────────────────────────────────────────────
test("IA: lê JSON (até dentro de ```json), normaliza nível/categoria e garante pessoa/item", () => {
  const r = lerRespostaIa('```json\n{"riscos":[{"nivel":"Médio","categoria":"inventada","pessoa":"","item":"","motivo":"Noite de 12/03 sem hotel.","o_que_fazer":"Reserve a noite."},{"nivel":"alta","categoria":"nome","pessoa":"Ana","item":"","motivo":"Sobrenome de casada.","o_que_fazer":"x"},{"nivel":"alto","categoria":"nome","motivo":""},{"nivel":"urgente","motivo":"y"}],"texto":"Olhe o hotel."}\n```');
  assert.ok(r);
  assert.equal(r!.riscos.length, 2);
  assert.deepEqual(r!.riscos[0], { nivel: "medio", categoria: "outro", pessoa: "", item: "Venda inteira", motivo: "Noite de 12/03 sem hotel.", o_que_fazer: "Reserve a noite." });
  assert.equal(r!.riscos[1].nivel, "alto");
  assert.equal(r!.riscos[1].pessoa, "Ana");
  assert.equal(r!.riscos[1].item, "");
  assert.equal(r!.texto, "Olhe o hotel.");
});

test("IA: resposta inválida devolve null (não lança)", () => {
  assert.equal(lerRespostaIa("isso não é json"), null);
  assert.equal(lerRespostaIa('{"texto":"sem riscos"}'), null);
  assert.equal(lerRespostaIa(""), null);
  assert.equal(lerRespostaIa(null), null);
  assert.deepEqual(lerRespostaIa('{"riscos":[],"texto":""}'), { riscos: [], texto: "" });
});

test("IA: material vai sem CPF e sem data de nascimento, com família, pagamentos e expedição", () => {
  const ctx = {
    hoje: HOJE, vendido: [{ tipo: "expedicao", nome: "Expedição Japão", data_inicio: "2027-03-10", data_fim: "2027-03-22", dados: { expedicao_id: "e1" } }],
    familia: [comp, { nome: "Bia Souza", chave: "b", vinculo: "filho", cpf: CPF_OK, nascimento: "2015-05-05", itens: [] }],
    pagamentos: [{ forma: "pix", valor: 1000, data: "2026-11-20", parcelas: 1 }], total_venda: 2000, expedicoes: [EXP],
  };
  const m = materialParaIa(ctx, conferirVenda(ctx));
  const s = JSON.stringify(m);
  assert.doesNotMatch(s, new RegExp(CPF_OK));
  assert.doesNotMatch(s, /2015-05-05|1980-01-01/);
  assert.equal(m.familia.length, 2);
  assert.deepEqual(m.familia[1], { nome: "Bia Souza", comprador: false, vinculo: "filho(a)", tem_cpf: true, cpf_valido: true, tem_nascimento: true, idade_na_viagem: 11, menor: true, responsavel: null, itens: null });
  assert.equal(m.soma_pagamentos, 1000);
  assert.equal(m.total_venda, 2000);
  assert.deepEqual(m.expedicoes, [{ nome: "Japão Março", data_embarque: "2027-03-10", data_retorno: "2027-03-22" }]);
  assert.ok(m.riscos_das_regras.some((x: string) => /soma das linhas/.test(x)));
});
