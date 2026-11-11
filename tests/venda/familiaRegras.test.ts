// A família da venda (0351): regras puras da pasta (src/venda/familiaRegras.ts)
// + o que vai pra venda_subir (montarPayload / viajantesParaJson / restauro).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../../src/venda/familiaRegras.ts";
import { restaurarViajantes, viajanteVazio, viajantesParaJson } from "../../src/venda/vendaRegras.ts";

const p = (o: Partial<R.PessoaFamilia> = {}): R.PessoaFamilia => ({
  id: Math.random().toString(36), cliente_id: "c", comprador: false, vinculo: "filho", nome: "Maria Silva", cpf: "12345678909",
  nascimento: "2012-01-01", telefone: null, email: null, idade: 14, menor: true, responsavel_nome: "Carlos", valor: 10000,
  aereo_incluso: true, bitrix_deal_id: null, bitrix_status: "pendente", contrato_status: null, removida_em: null, ...o,
});

test("é família só com 2+ pessoas ativas; quem saiu não conta", () => {
  assert.equal(R.ehFamilia({ pessoas: [p({ comprador: true })] }), false);
  assert.equal(R.ehFamilia({ pessoas: [p({ comprador: true }), p({ removida_em: "2026-11-09" })] }), false);
  const f = { pessoas: [p({ comprador: true, menor: false, telefone: "5511999990000" }), p(), p({ cpf: null, menor: false })] };
  assert.equal(R.ehFamilia(f), true);
  assert.deepEqual(R.resumoFamilia(f), { n: 3, menores: 1, incompletas: 1, texto: "Família · 3 pessoas" });
});

test("faltas: CPF, nascimento, vínculo (acompanhante) e contato (titular)", () => {
  assert.deepEqual(R.faltasDaPessoa(p({ cpf: "", nascimento: null, vinculo: null })), ["CPF", "nascimento", "vínculo"]);
  assert.deepEqual(R.faltasDaPessoa(p({ comprador: true, vinculo: null, telefone: null, email: null })), ["contato"]);
  assert.deepEqual(R.faltasDaPessoa(p()), []);
});

test("valor do titular = total − filhos (mesma conta do card pai no Bitrix)", () => {
  const f = { valor_total: 30000, pessoas: [p({ comprador: true, valor: 10000 }), p({ valor: 12000 }), p({ valor: 8000 }), p({ valor: 5000, removida_em: "x" })] };
  assert.equal(R.valorDoTitular(f), 10000);
  assert.equal(R.valorDoTitular({ valor_total: 5000, pessoas: [p({ comprador: true }), p({ valor: null })] }), null);
});

test("rótulos: vínculo, Bitrix e contrato do menor", () => {
  assert.equal(R.rotuloVinculo(p()), "Filho(a)");
  assert.equal(R.rotuloVinculo(p({ comprador: true })), "Titular");
  assert.equal(R.situacaoBitrix(p({ bitrix_status: "ok", bitrix_deal_id: "77" })).t, "Card 77 criado");
  assert.equal(R.situacaoBitrix(p({ bitrix_status: "pendente" })).t, "Bitrix: card a criar");
  assert.equal(R.situacaoBitrix(p({ bitrix_status: "erro" })).tom, "erro");
  assert.match(R.situacaoContrato(p()), /assina: Carlos/);
  assert.equal(R.linhaCurta(p()), "Maria Silva (filho(a), 14 anos)");
});

test("responsável do menor vai no json do item e volta ao reabrir (chave sumida vira o comprador)", () => {
  const comp = viajanteVazio(true, "", "k0");
  const mae = { ...viajanteVazio(false, "Ana Lima", "k1"), vinculo: "conjuge" as const };
  const filho = { ...viajanteVazio(false, "Bia Lima", "k2"), nascimento: "2015-03-03", responsavel: "k1" };
  const json = viajantesParaJson([comp, mae, filho], "Carlos Lima");
  assert.equal(json[2].responsavel_chave, "k1");
  assert.equal(json[0].responsavel_chave, null);
  const r = restaurarViajantes({ item: { valor: null, passageiros: json } });
  assert.equal(r.viajantes.find((v) => v.nome === "Bia Lima")?.responsavel, "k1");
  const semMae = restaurarViajantes({ item: { valor: null, passageiros: [json[0], json[2]] } });
  assert.equal(semMae.viajantes.find((v) => v.nome === "Bia Lima")?.responsavel, "");
});

test("0352: o quadro mostra \"contratos 2/4 assinados\" (quem saiu da venda e quem não recebeu não contam)", () => {
  const f = { pessoas: [
    p({ comprador: true, contrato_status: "assinado" }), p({ contrato_status: "assinado" }), p({ contrato_status: "enviado" }),
    p({ contrato_status: "visualizado" }), p({ contrato_status: null }), p({ contrato_status: "assinado", removida_em: "2026-11-09" }),
  ] };
  assert.deepEqual(R.resumoContratosFamilia(f), { total: 4, assinados: 2, texto: "contratos 2/4 assinados" });
  assert.equal(R.resumoContratosFamilia({ pessoas: [p(), p()] }).texto, "");
  assert.equal(R.situacaoContrato(p({ contrato_status: "recusado", menor: false })), "recusado");
});
