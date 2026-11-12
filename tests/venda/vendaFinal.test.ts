// Subir venda — sprint final (src/venda/vendaFinal.ts, 11/11/2026): pagamento em
// linhas, estado, vagas, faltas pra consolidar, rascunho, "Quem vai" e contrato.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as F from "../../src/venda/vendaFinal.ts";
import { pagamentoVendaVazio, pessoaVazia, viajanteVazio } from "../../src/venda/vendaRegras.ts";

const L = (o: Partial<F.LinhaPagamento> = {}): F.LinhaPagamento => ({ ...F.linhaVazia(), ...o });

test("pagamento em linhas: soma × total", () => {
  const ls = [L({ forma: "pix", valor: "5.000,00" }), L({ forma: "cartao", valor: "10000", parcelas: "10" })];
  assert.deepEqual(F.conferirPagamento(ls, 15000), { soma: 15000, total: 15000, diferenca: 0, bate: true });
  const c = F.conferirPagamento(ls, 17000);
  assert.equal(c.bate, false);
  assert.equal(c.diferenca, 2000, "falta lançar R$ 2.000");
  assert.equal(F.conferirPagamento([], 0).bate, false, "total zerado nunca 'bate'");
});

test("pagamento em linhas: problemas e payload (linha em branco é ignorada)", () => {
  assert.equal(F.problemaDaLinha(L(), 1), null);
  assert.match(F.problemaDaLinha(L({ valor: "100" }), 2)!, /Pagamento 2: escolha a forma/);
  assert.match(F.problemaDaLinha(L({ forma: "pix", valor: "abc" }), 1)!, /valor/);
  assert.match(F.problemaDaLinha(L({ forma: "pix", valor: "10", parcelas: "0" }), 1)!, /parcelas/);
  const p = F.linhasParaPayload([L(), L({ forma: "boleto", valor: "1.200,50", data: "2026-12-10", parcelas: "3", obs: " todo dia 10 " })]);
  assert.deepEqual(p, [{ ordem: 1, forma: "boleto", valor: 1200.5, data: "2026-12-10", parcelas: 3, obs: "todo dia 10" }]);
});

test("pagamento: reabrir do banco e de venda antiga", () => {
  const ls = F.linhasDoBanco([{ ordem: 2, forma: "cartao", valor: "800", data: "2026-12-01T00:00:00", parcelas: 4 }, { ordem: 1, forma: "xyz", valor: 200 }]);
  assert.deepEqual(ls.map((l) => [l.forma, l.valor, l.data, l.parcelas]), [["outro", "200", "", "1"], ["cartao", "800", "2026-12-01", "4"]]);
  const ant = F.linhasDoLegado({ ...pagamentoVendaVazio(), forma: "pix", condicao: "entrada", entrada: "1000", entrada_data: "2026-11-11", parcelas: "5", primeira_parcela: "2026-12-11" }, 6000);
  assert.equal(ant.length, 2);
  assert.equal(ant[0].valor, "1000");
  assert.equal(ant[1].valor, "5000");
  assert.equal(ant[1].parcelas, "5");
  assert.equal(F.linhasDoLegado(pagamentoVendaVazio(), 0).length, 1, "venda sem pagamento: 1 linha vazia");
  const leg = F.pagamentoLegadoDasLinhas([L({ forma: "cartao", valor: "900", parcelas: "3" })]);
  assert.equal(leg.condicao, "parcelado");
  assert.equal(leg.parcelas, "3");
});

test("estado: gravado manda; banco antigo deduz do cartão", () => {
  assert.equal(F.estadoDaVenda("reservada"), "reservada");
  assert.equal(F.estadoDaVenda(undefined, { consolidada: true }), "consolidada");
  assert.equal(F.estadoDaVenda(null, { preVenda: true }), "reservada");
  assert.equal(F.estadoDaVenda("lixo"), "negociacao");
});

test("vagas: quem já é desta venda não conta contra ela (reabrir em expedição quase lotada)", () => {
  const vs = [{ passageiro_id: "p1" }, { passageiro_id: "p2" }, { passageiro_id: null }];
  assert.equal(F.vagasParaEstaVenda(0, vs), 2);
  assert.equal(F.vagasParaEstaVenda(1, vs), 3, "2 já são da venda + 1 livre = cabe os 3");
  assert.equal(F.vagasParaEstaVenda(-1, []), 0);
});

test("faltas pra consolidar + passo de cada falta", () => {
  const base: F.EntradaFaltas = {
    comprador: { nome: "Ana Souza" },
    acompanhantes: [{ nome: "Maria Souza", vinculo: "" }],
    itens: [{ tipo: "expedicao", rotulo: "Expedição", expedicaoEscolhida: true }],
    total: 17000,
    linhas: [L({ forma: "pix", valor: "15000" })],
  };
  const f = F.faltasParaConsolidar(base);
  assert.ok(f.includes("Maria Souza: falta o vínculo (cônjuge, filho, amigo…)."));
  assert.ok(f.some((x) => /soma R\$\s?15\.000,00 ≠ total R\$\s?17\.000,00/.test(x)), f.join(" | "));
  assert.equal(F.primeiroPassoDasFaltas(f), F.PASSO.quem);
  assert.deepEqual(F.faltasParaConsolidar({ ...base, acompanhantes: [{ nome: "Maria Souza", vinculo: "filho" }], linhas: [L({ forma: "pix", valor: "17000", data: "2026-11-12" })] }), []);
  assert.equal(F.passoDaFalta("Pagamento: soma R$ 1 ≠ total R$ 2"), F.PASSO.pagamento);
  assert.equal(F.passoDaFalta("O que vendeu: nenhum item marcado."), F.PASSO.oque);
  assert.equal(F.passoDaFalta("Expedição: escolha qual expedição foi vendida."), F.PASSO.detalhes);
  assert.equal(F.passoDaFalta("João: falta o CPF"), F.PASSO.quem);
  assert.equal(F.primeiroPassoDasFaltas([]), F.PASSO.analise);
});

test("12/11: a tela confere o mesmo que o banco (CPF, nascimento, contato, data do pagamento)", () => {
  // O caso do teste do Bruno: titular sem CPF/nascimento, amiga sem nascimento, pagamentos sem data.
  const f = F.faltasParaConsolidar({
    comprador: { nome: "TESTE CLAUDE", cpf: "", nascimento: "", telefone: "11999990000", email: "" },
    acompanhantes: [{ nome: "teste 1", vinculo: "amigo", cpf: "11111111111", nascimento: "" }],
    itens: [{ tipo: "expedicao", rotulo: "Expedição", expedicaoEscolhida: true }],
    total: 20,
    linhas: [L({ forma: "pix", valor: "5" }), L({ forma: "cartao", valor: "15" })],
  });
  assert.ok(f.includes("TESTE CLAUDE: falta o CPF."), f.join(" | "));
  assert.ok(f.includes("TESTE CLAUDE: falta a data de nascimento."));
  assert.ok(f.includes("teste 1: falta a data de nascimento."));
  assert.ok(!f.some((x) => /teste 1: falta o CPF/.test(x)));
  assert.ok(f.includes("Pagamento 1: falta a data.") && f.includes("Pagamento 2: falta a data."));
  assert.ok(!f.some((x) => /telefone ou e-mail/.test(x)), "tem telefone");
  assert.equal(F.passoDaFalta("teste 1: falta a data de nascimento."), F.PASSO.quem);
  assert.equal(F.passoDaFalta("Pagamento 2: falta a data."), F.PASSO.pagamento);
  const sem = F.faltasParaConsolidar({ comprador: { nome: "Ana Souza", cpf: "1", nascimento: "2000-01-01", telefone: "", email: "" },
    acompanhantes: [], itens: [{ tipo: "outro", rotulo: "Outro" }], total: 10, linhas: [L({ forma: "pix", valor: "10", data: "2026-11-12" })] });
  assert.deepEqual(sem, ["Ana Souza: falta telefone ou e-mail."]);
});

test("juntar família ↔ expedição: atualiza por chave/CPF/nome, adiciona e nunca apaga", () => {
  const fam = [{ ...viajanteVazio(false, "Maria Souza", "k1"), cpf: "12345678909", vinculo: "filho" as const }, viajanteVazio(false, "Pedro", "k2")];
  const exp = [viajanteVazio(true), { ...viajanteVazio(false, "maria  souza", "x9"), email: "m@x.com", valor_contratado: "10000" }];
  const r = F.juntarPessoas(fam, exp, true);
  assert.equal(r.length, 3);
  assert.equal(r[1].cpf, "12345678909");
  assert.equal(r[1].email, "m@x.com", "campo preenchido não some");
  assert.equal(r[1].valor_contratado, "10000", "valor da expedição fica");
  assert.equal(r[2].chave, "k2");
  assert.equal(F.juntarPessoas(fam, exp, false).length, 2);
});

test("quem vai no cartão: conferência e payload", () => {
  const p = (o: Partial<F.PessoaQuemVai>): F.PessoaQuemVai => ({ chave: "a", nome: "Maria Souza", vinculo: "filho", cpf: "", nascimento: "", email: "", telefone: "", ...o });
  assert.equal(F.problemaQuemVai([p({})]), null);
  assert.match(F.problemaQuemVai([p({ vinculo: "" })])!, /vínculo/);
  assert.match(F.problemaQuemVai([p({ cpf: "123" })])!, /11 números/);
  assert.equal(F.problemaQuemVai([p({ vinculo: "", removida: true })]), null, "quem saiu não é conferido");
  const b = F.familiaParaPayload("neg1", [p({ cpf: "123.456.789-09" }), p({ chave: "b", removida: true }), p({ chave: "c", removida: true, pessoa_id: "pid" })]);
  assert.equal(b.negocio_id, "neg1");
  assert.equal(b.pessoas.length, 2, "removida sem id (nunca gravada) não vai");
  assert.equal(b.pessoas[0].cpf, "12345678909");
  assert.equal(b.pessoas[1].removida, true);
});

test("contrato: lê o jsonb sem confiar no formato", () => {
  assert.equal(F.lerVendaDoContrato(null), null);
  assert.equal(F.lerVendaDoContrato({ pessoas: [] }), null);
  const r = F.lerVendaDoContrato({ tipo: "Expedição", expedicao_id: "e1", valor: "17000", pessoas: [{ nome: "Ana" }, { nome: "Maria", vinculo: "filho" }, { nome: "" }] })!;
  assert.equal(r.tipo, "expedicao");
  assert.equal(r.valor, 17000);
  assert.equal(r.pessoas.length, 2);
  assert.equal(r.pessoas[0].comprador, true);
  assert.equal(r.pessoas[1].comprador, false);
});

test("rascunho: chave, leitura e qual restaurar", () => {
  assert.equal(F.chaveRascunho({ origem: "closer", negocioId: "n1" }), "qs:subir-venda:neg:n1");
  assert.equal(F.chaveRascunho({ origem: "ops" }), "qs:subir-venda:ops:novo:-");
  const r: F.RascunhoTela = { v: F.VERSAO_RASCUNHO, salvo_em: "2026-11-11T12:00:00Z", passo: 4, pessoa: pessoaVazia(), itens: [], valores: {}, viajantes: {}, outros: [], linhas: [], especial: false, especialObs: "", obs: "", obsFin: "" };
  const lido = F.lerRascunho(JSON.stringify(r))!;
  assert.equal(lido.passo, F.PASSO.pagamento, "não reabre direto na análise");
  assert.equal(F.lerRascunho("{quebrado"), null);
  assert.equal(F.lerRascunho({ ...r, v: 99 }), null);
  assert.equal(F.escolherRascunho(lido, null, "2026-11-11T11:00:00Z")?.de, "aparelho");
  assert.equal(F.escolherRascunho(lido, null, "2026-11-11T13:00:00Z"), null, "venda gravada depois: o do aparelho é velho");
  assert.equal(F.escolherRascunho(null, lido, "2026-11-11T12:01:00Z")?.de, "banco");
  assert.equal(F.escolherRascunho(null, lido, "2026-11-11T14:00:00Z"), null, "alguém mexeu depois: não restaura");
});

test("quem sai de uma lista sai da outra (e solta quarto/responsável)", () => {
  const a = viajanteVazio(false, "Maria Souza", "k1");
  const b = { ...viajanteVazio(false, "Pedro", "k2"), divide: "v:x1", responsavel: "x1" };
  const exp = [viajanteVazio(true), { ...viajanteVazio(false, "maria souza", "x1") }, b];
  const saiu = F.quemSaiu([a, viajanteVazio(false, "Pedro", "k2")], [viajanteVazio(false, "Pedro", "k2")]);
  assert.deepEqual(saiu.map((x) => x.chave), ["k1"]);
  const r = F.tirarPessoas(exp, saiu);
  assert.equal(r.length, 2);
  assert.ok(r[0].comprador, "comprador nunca sai");
  assert.equal(r[1].divide, "");
  assert.equal(r[1].responsavel, "");
});
