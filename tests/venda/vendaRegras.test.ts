// Subir venda — regras puras de "digitar uma vez só" (src/venda/vendaRegras.ts, Bruno 09/11/2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  completarPessoa, menorDeIdade, pagamentoDaVenda, pessoaVazia, precoTabela, restaurarViajantes, sugerirValor,
  trocarAereo, valorAjustado, viajanteVazio, viajantesParaJson, type PaxLinha, type Viajante,
} from "../../src/venda/vendaRegras.ts";

const EXP = { preco_venda_brl: 20000, preco_sem_aereo_brl: 14000 };

test("reabrir: pagamento gravado volta pra tela (não zera)", () => {
  const p = pagamentoDaVenda({ forma: "pix", condicao: "entrada", entrada: 2500.5, entrada_data: "2026-11-10", parcelas: 10, primeira_parcela: "2026-12-10", obs: "sinal caiu" });
  assert.deepEqual(p, { forma: "pix", condicao: "entrada", entrada: "2500,5", entrada_data: "2026-11-10", parcelas: "10", primeira_parcela: "2026-12-10", obs: "sinal caiu" });
  assert.equal(pagamentoDaVenda({ forma: "cartao", condicao: "avista", parcelas: 1 }).parcelas, "", "à vista não mostra parcelas");
  assert.equal(pagamentoDaVenda(null).condicao, "avista");
  assert.equal(pagamentoDaVenda({ condicao: "lixo" }).condicao, "avista");
});

test("quem comprou: a ficha só completa o vazio (o lead fica)", () => {
  const base = { ...pessoaVazia(), nome: "Ana Lead", telefone: "11999990000" };
  const r = completarPessoa(base, { nome: "Ana Maria Ficha", telefone: "5511888", cpf: "12345678901", nascimento: "1990-05-02T00:00:00", email: null });
  assert.equal(r.nome, "Ana Lead");
  assert.equal(r.telefone, "11999990000");
  assert.equal(r.cpf, "12345678901");
  assert.equal(r.nascimento, "1990-05-02");
  assert.equal(r.email, "");
  assert.equal(completarPessoa(base, null), base);
});

test("preço do Operacional: com × sem aéreo e 'ajustado'", () => {
  assert.equal(precoTabela(EXP, true), 20000);
  assert.equal(precoTabela(EXP, false), 14000);
  assert.equal(precoTabela({ preco_venda_brl: 20000, preco_sem_aereo_brl: null }, false), null);
  const v = { ...viajanteVazio(), aereo_incluso: false, valor_contratado: "14.000,00" };
  assert.equal(valorAjustado(v, EXP), false);
  assert.equal(valorAjustado({ ...v, valor_contratado: "13000" }, EXP), true);
  assert.equal(valorAjustado({ ...v, valor_contratado: "" }, EXP), null);
});

test("trocar aéreo acompanha a tabela, mas não mexe no valor ajustado à mão", () => {
  const v: Viajante = { ...viajanteVazio(), valor_contratado: "20000" };
  assert.equal(trocarAereo(v, false, EXP).valor_contratado, "14000");
  assert.equal(trocarAereo({ ...v, valor_contratado: "18500" }, false, EXP).valor_contratado, "18500");
  assert.equal(trocarAereo({ ...v, valor_contratado: "" }, false, EXP).valor_contratado, "14000");
  // sem preço sem aéreo cadastrado: limpa o valor da tabela antiga (não deixa o com aéreo enganando)
  assert.equal(trocarAereo(v, false, { preco_venda_brl: 20000 }).valor_contratado, "");
  assert.equal(sugerirValor({ ...viajanteVazio(), aereo_incluso: false }, EXP), "14000");
});

test("rascunho: tudo que vai pro json volta igual (nada se perde)", () => {
  const comp: Viajante = { ...viajanteVazio(true), valor_contratado: "20000", valor_pago: "5000", quarto_desejado: "Duplo" };
  const acomp: Viajante = {
    ...viajanteVazio(false, "Bia Souza"), telefone: "11977776666", cpf: "98765432100", email: "bia@x.com", nascimento: "2012-03-01",
    vinculo: "filho", valor_contratado: "14000", aereo_incluso: false, quarto_desejado: "Duplo", divide: `v:${comp.chave}`,
  };
  const json = viajantesParaJson([acomp, comp], "Ana Souza");
  assert.equal(json[1].nome, "Ana Souza");
  const { viajantes, dividiuIgual } = restaurarViajantes({ item: { valor: 34000, passageiros: json }, nomeComprador: "Ana Souza" });
  assert.equal(dividiuIgual, false);
  assert.equal(viajantes[0].comprador, true, "comprador vai primeiro");
  assert.equal(viajantes[0].chave, comp.chave);
  assert.equal(viajantes[0].valor_contratado, "20000");
  assert.equal(viajantes[0].valor_pago, "5000");
  const b = viajantes[1];
  assert.deepEqual(
    [b.nome, b.telefone, b.cpf, b.email, b.nascimento, b.vinculo, b.valor_contratado, b.aereo_incluso, b.divide],
    ["Bia Souza", "11977776666", "98765432100", "bia@x.com", "2012-03-01", "filho", "14000", false, `v:${comp.chave}`],
  );
});

test("venda confirmada: linhas de passageiros mandam (valor, aéreo, quarto, par) e a ficha completa", () => {
  // json como a venda_subir deixa hoje: só nome/cliente_id/passageiro_id
  const json = [{ nome: "Carlos Lima", cliente_id: "c2", passageiro_id: "p2" }, { nome: "Ana Souza", cliente_id: "c1", passageiro_id: "p1" }];
  const linhas: PaxLinha[] = [
    { id: "p1", cliente_id: "c1", nome_completo: "Ana Souza", valor_contratado_brl: "20000.00", valor_pago_brl: 0, aereo_incluso: true, quarto_desejado: "Casal", quarto_par_id: "q1", status_reserva: "Pré-reserva" },
    { id: "p2", cliente_id: "c2", nome_completo: "Carlos Lima", telefone: "5511911112222", cpf: null, valor_contratado_brl: 15000, aereo_incluso: false, quarto_desejado: "Casal", quarto_par_id: "q1", status_reserva: "Pré-reserva" },
    { id: "p3", cliente_id: "c3", nome_completo: "Cancelado", status_reserva: "Cancelado" },
  ];
  const { viajantes, dividiuIgual } = restaurarViajantes({
    item: { valor: 35000, passageiros: json }, linhas, compradorClienteId: "c1", nomeComprador: "Ana Souza",
    acompanhantes: [{ id: "c2", nome: "Carlos Lima", vinculo: "conjuge", cpf: "11122233344", nascimento: "1985-01-01", email: "c@x.com" }],
  });
  assert.equal(dividiuIgual, false);
  assert.equal(viajantes.length, 2, "cancelado não volta");
  const [ana, carlos] = viajantes;
  assert.equal(ana.comprador, true, "comprador pela ficha, não pela posição");
  assert.equal(ana.valor_contratado, "20000");
  assert.equal(carlos.comprador, false);
  assert.equal(carlos.valor_contratado, "15000");
  assert.equal(carlos.aereo_incluso, false);
  assert.equal(carlos.telefone, "5511911112222");
  assert.equal(carlos.cpf, "11122233344", "CPF vazio na linha → vem da ficha");
  assert.equal(carlos.vinculo, "conjuge");
  assert.equal(carlos.nascimento, "1985-01-01");
  assert.equal(ana.divide, `v:${carlos.chave}`, "mesmo quarto_par_id → dividem");
  assert.equal(carlos.divide, `v:${ana.chave}`);
});

test("divide com alguém de fora: vira 'só o nome'", () => {
  const linhas: PaxLinha[] = [{ id: "p1", cliente_id: "c1", nome_completo: "Ana", valor_contratado_brl: 1, acompanhante_dividir_com: "Joana Prima" }];
  const { viajantes } = restaurarViajantes({ item: { valor: 1, passageiros: [] }, linhas, compradorClienteId: "c1" });
  assert.equal(viajantes[0].divide, "t");
  assert.equal(viajantes[0].divide_nome, "Joana Prima");
});

test("venda antiga sem valor por pessoa: divide igual e avisa; sem ninguém, nasce o comprador", () => {
  const r = restaurarViajantes({ item: { valor: 30000, passageiros: [{ nome: "Ana" }, { nome: "Bia" }] }, nomeComprador: "Bia" });
  assert.equal(r.dividiuIgual, true);
  assert.deepEqual(r.viajantes.map((v) => v.valor_contratado), ["15000", "15000"]);
  assert.equal(r.viajantes[0].comprador, true);
  assert.equal(r.viajantes[1].nome, "Ana", "o comprador é a Bia (pelo nome), não o 1º da lista");
  const vazio = restaurarViajantes({ item: { valor: null, passageiros: [], dados: { quarto: "Single" } } });
  assert.equal(vazio.viajantes.length, 1);
  assert.equal(vazio.viajantes[0].comprador, true);
  assert.equal(vazio.viajantes[0].quarto_desejado, "Single");
});

test("menor de idade na data do embarque", () => {
  assert.equal(menorDeIdade("2010-06-15", "2028-06-14"), true);
  assert.equal(menorDeIdade("2010-06-15", "2028-06-15"), false);
  assert.equal(menorDeIdade("", "2028-01-01"), null);
});

test("closer sem acesso às Expedições: json completo da venda_subir (SQL proposto) também restaura tudo", () => {
  const json = [
    { nome: "Ana Souza", cliente_id: "c1", passageiro_id: "p1", comprador: true, valor_contratado: 20000, valor_pago: 0, aereo_incluso: true, quarto_desejado: "Casal", quarto_par_id: "q1" },
    { nome: "Carlos Lima", cliente_id: "c2", passageiro_id: "p2", vinculo: "conjuge", cpf: "11122233344", nascimento: "1985-01-01", valor_contratado: 15000, aereo_incluso: false, quarto_desejado: "Casal", quarto_par_id: "q1" },
  ];
  const { viajantes, dividiuIgual } = restaurarViajantes({ item: { valor: 35000, passageiros: json }, nomeComprador: "Ana Souza" });
  assert.equal(dividiuIgual, false);
  const [ana, carlos] = viajantes;
  assert.equal(ana.comprador, true);
  assert.equal(carlos.vinculo, "conjuge");
  assert.equal(carlos.aereo_incluso, false);
  assert.equal(carlos.valor_contratado, "15000");
  assert.equal(ana.divide, `v:${carlos.chave}`);
});
