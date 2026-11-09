// Contrato × VENDA REGISTRADA (09/11): a lógica PURA de api/_contrato.js e do
// modelo — prioridade das fontes, texto do pagamento, aéreo por viajante,
// contrato por pessoa (valor da pessoa, menor assinado pelo responsável),
// write-back pro cadastro e o Anexo I do roteiro. Nada sai pra rede.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://sb.exemplo";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave";

import {
  AVISO_ENDERECO, camposDasFontes, correcoesDoCliente, enderecoDoCliente, enderecoParaColunas, idadeEm, montarPreviaDaPessoa,
  normalizarCampos, passagemDaVenda, resumoDaVenda, textoDoPagamentoDaVenda, textoDoRoteiro, validarCampos, viajantesDaVenda,
} from "../../api/_contrato.js";
import { blocosDoRoteiro, clausulasDe } from "../../api/_contratoModelo.js";

const EXP = "11111111-1111-4111-8111-111111111111";
const vendaExpedicao = (extra: Record<string, unknown> = {}) => ({
  venda: { id: "v1", cliente_id: "c1", valor_total: 50000, pagamento: { forma: "cartao", condicao: "entrada", entrada: 5000, entrada_data: "2026-11-10", parcelas: 10, primeira_parcela: "2026-12-10", obs: null }, condicao_especial: false },
  itens: [{ id: "i1", tipo: "expedicao", nome: "Expedição Japão", data_inicio: null, data_fim: null, dados: { expedicao_id: EXP }, passageiros: [], valor: 50000 }],
  expedicoes: [{ id: EXP, nome: "Japão e China 2027", destino: "Japão e China", data_embarque: "2027-10-09", data_retorno: "2027-10-25" }],
  roteiro: [
    { expedicao_id: EXP, dia: 2, data: "2027-10-10", titulo: "Pequim", descricao: "• Muralha\n\n🚐 Van", cidade: "Pequim", ordem: 2 },
    { expedicao_id: EXP, dia: 1, data: "2027-10-09", titulo: "Saída do Brasil", descricao: "• Encontro em GRU", cidade: "", ordem: 1 },
  ],
  passageiros: [
    { id: "p1", cliente_id: "c1", nome_completo: "Ana Lima", valor_contratado_brl: 26000, aereo_incluso: true, status_reserva: "Pré-reserva" },
    { id: "p2", cliente_id: "c2", nome_completo: "Beto Lima", valor_contratado_brl: 24000, aereo_incluso: true, status_reserva: "Pré-reserva" },
  ],
  ...extra,
});
const bitrix = {
  deal: { nome: "Ana do Bitrix", cpf: "529.982.247-25", expedicao: "Expedição do Bitrix", destino: "Destino Bitrix", ida: "01/01/2027", volta: "02/01/2027", passagem: "Não inclusa", valor_total: "99999", forma_pagamento: "Pix do Bitrix", endereco: "Rua do Bitrix" },
  contato: { rg: "RG-BITRIX", email: "bitrix@x.com" },
};
const cliente = {
  id: "c1", nome: "Ana Lima", cpf: "11144477735", rg: "12.345.678-9", nascimento: "1990-05-20", email: "ana@x.com", telefone: "5585999998888",
  endereco_rua: "Rua A", endereco_numero: "10", endereco_complemento: "", endereco_bairro: "Centro", endereco_cidade: "Fortaleza", endereco_estado: "CE", endereco_cep: "60000000",
};

// ── Prioridade das fontes ──────────────────────────────────────────────────
test("venda registrada ganha da ficha, da proposta e do Bitrix (tipo, expedição, datas, valor, pagamento, passagem)", () => {
  const { campos, origem } = camposDasFontes({
    negocio: { ficha: { servico: "pacote", destino: "Ficha", valor_total: 1, data_ida: "2026-01-01" }, valor_previsto: 7 },
    lead: {}, cliente, venda: vendaExpedicao(), bitrix, closerNome: "Closer", hoje: "09/11/2026",
  });
  assert.equal(campos.tipo, "expedicao");
  assert.equal(origem.tipo, "venda registrada");
  assert.equal(campos.expedicao, "Japão e China 2027");
  assert.equal(campos.destino, "Japão e China");
  assert.equal(campos.ida, "09/10/2027");
  assert.equal(campos.volta, "25/10/2027");
  assert.equal(campos.valor_total, "50.000,00");
  assert.equal(origem.valor_total, "venda registrada");
  assert.match(campos.forma_pagamento, /^Entrada de R\$\s5\.000,00 em 10\/11\/2026 e 10 parcelas de R\$\s4\.500,00 \(a 1ª em 10\/12\/2026\), via cartão de crédito\.$/);
  assert.equal(campos.passagem, "Inclusa");
  assert.match(campos.roteiro, /^Dia 1 · 09\/10\/2027 — Saída do Brasil\n• Encontro em GRU\n\nDia 2/);
});

test("pessoa: cadastro único ganha do Bitrix (inclusive RG e endereço); o último envio ganha de tudo", () => {
  const sem = camposDasFontes({ negocio: {}, lead: { email: "lead@x.com", phone: "85911112222" }, cliente, venda: null, bitrix, hoje: "09/11/2026" });
  assert.equal(sem.campos.nome, "Ana Lima");
  assert.equal(sem.origem.nome, "cadastro do cliente");
  assert.equal(sem.campos.cpf, "111.444.777-35");
  assert.equal(sem.campos.rg, "12.345.678-9");
  assert.equal(sem.campos.endereco, "Rua A, 10, Centro, Fortaleza/CE, CEP 60000-000");
  assert.equal(sem.campos.email, "ana@x.com");
  assert.equal(sem.campos.nascimento, "20/05/1990");

  const com = camposDasFontes({ negocio: {}, lead: {}, cliente, venda: null, bitrix, ultimo: { cpf: "529.982.247-25", endereco: "Rua Corrigida" }, hoje: "09/11/2026" });
  assert.equal(com.campos.cpf, "529.982.247-25");
  assert.equal(com.origem.cpf, "último envio");
  assert.equal(com.campos.endereco, "Rua Corrigida");

  const soBitrix = camposDasFontes({ negocio: {}, lead: { full_name: "Lead" }, cliente: null, venda: null, bitrix, hoje: "09/11/2026" });
  assert.equal(soBitrix.campos.rg, "RG-BITRIX");
  assert.equal(soBitrix.campos.nome, "Ana do Bitrix");
});

test("sem venda registrada: continua ficha → Bitrix (comportamento antigo)", () => {
  const { campos, origem } = camposDasFontes({
    negocio: { ficha: { servico: "pacote", destino: "Itália", valor_total: 30000, itens: [{ tipo: "hospedagem", descricao: "10 noites" }], plano: { entrada: { valor: 1000, forma: "pix" } } } },
    lead: {}, cliente: null, venda: null, bitrix: { deal: { ...bitrix.deal, expedicao: "" }, contato: {} }, hoje: "09/11/2026",
  });
  assert.equal(campos.tipo, "pacote");
  assert.equal(campos.destino, "Itália");
  assert.equal(origem.destino, "venda consolidada");
  assert.equal(campos.valor_total, "30.000,00");
  assert.equal(campos.inclusos, "Hospedagem: 10 noites");
  assert.match(campos.forma_pagamento, /Entrada de R\$\s1\.000,00 via Pix/);
  assert.equal(campos.roteiro, "");
});

test("venda de pacote: inclusos, destino e datas vêm dos itens; valor = soma quando o cabeçalho está zerado", () => {
  const r = resumoDaVenda({
    venda: { id: "v", valor_total: 0, pagamento: { forma: "pix", condicao: "avista" } },
    itens: [
      { tipo: "pacote", nome: "Pacote Itália", data_inicio: "2027-03-01", data_fim: "2027-03-12", dados: { destino: "Itália", descricao: "Roma e Toscana" }, valor: 20000 },
      { tipo: "seguro", nome: "", data_inicio: "2027-03-01", data_fim: "2027-03-15", dados: {}, valor: 500 },
    ],
  });
  assert.equal(r.tipo, "pacote");
  assert.equal(r.destino, "Itália");
  assert.equal(r.inclusos, "Pacote Itália: Roma e Toscana\nSeguro viagem");
  assert.equal(r.ida, "01/03/2027");
  assert.equal(r.volta, "15/03/2027");
  assert.equal(r.valor, 20500);
  assert.equal(r.seguro, "Incluso");
  assert.equal(r.passagem, "Não inclusa");
  assert.equal(r.forma_pagamento, "À vista (R$ 20.500,00), via Pix.");
});

// ── Texto do pagamento ─────────────────────────────────────────────────────
test("texto do pagamento: à vista, parcelado, entrada, obs/peculiaridades e condição especial", () => {
  assert.equal(textoDoPagamentoDaVenda({ forma: "pix", condicao: "avista" }, 1000), "À vista (R$ 1.000,00), via Pix.");
  assert.equal(textoDoPagamentoDaVenda({ forma: "cartao", condicao: "parcelado", parcelas: 3, primeira_parcela: "2026-12-01" }, 3000),
    "3 parcelas de R$ 1.000,00 (a 1ª em 01/12/2026), via cartão de crédito.");
  assert.equal(textoDoPagamentoDaVenda({ forma: "boleto", condicao: "entrada", entrada: 1000, parcelas: 2, peculiaridades: "Saldo até 30 dias antes." }, 5000),
    "Entrada de R$ 1.000,00 e 2 parcelas de R$ 2.000,00, via boleto. Saldo até 30 dias antes.");
  assert.equal(textoDoPagamentoDaVenda({ forma: "pix" }, 0, { condicaoEspecial: true, condicaoObs: "ExpedAmigo" }), "À vista, via Pix. Condição especial: ExpedAmigo.");
  assert.equal(textoDoPagamentoDaVenda({}, 0), "");
  assert.equal(textoDoPagamentoDaVenda(null, 0), "");
});

// ── Aéreo por viajante ─────────────────────────────────────────────────────
test("passagem: aereo_incluso de cada viajante manda (expedição com aéreo incluso sai Inclusa sem item de aéreo)", () => {
  assert.equal(passagemDaVenda(vendaExpedicao()), "Inclusa");
  const semAereo = vendaExpedicao({ passageiros: [{ id: "p1", nome_completo: "Ana", aereo_incluso: false }] });
  assert.equal(passagemDaVenda(semAereo), "Não inclusa");
  const misto = vendaExpedicao({ passageiros: [{ id: "p1", nome_completo: "Ana", aereo_incluso: true }, { id: "p2", nome_completo: "Beto", aereo_incluso: false }] });
  assert.equal(passagemDaVenda(misto), "Inclusa para Ana; não inclusa para Beto");
  // Sem informação do viajante numa expedição: a venda não diz (cai pro Bitrix).
  const semInfo = vendaExpedicao({ passageiros: [] });
  assert.equal(passagemDaVenda(semInfo), "");
  const { campos, origem } = camposDasFontes({ negocio: {}, lead: {}, venda: semInfo, bitrix, hoje: "09/11/2026" });
  assert.equal(campos.passagem, "Não inclusa");
  assert.equal(origem.passagem, "Bitrix (negócio)");
  // Cancelado não conta; o json do item completa quem não virou passageiro.
  const comJson = vendaExpedicao({
    passageiros: [{ id: "p9", nome_completo: "Zé", aereo_incluso: false, status_reserva: "Cancelado" }],
    itens: [{ id: "i1", tipo: "expedicao", dados: { expedicao_id: EXP }, passageiros: [{ nome: "Ana", aereo_incluso: true, valor_contratado: "26.000,00" }], valor: 26000 }],
  });
  assert.deepEqual(viajantesDaVenda(comJson).map((v: { nome: string; valor: number | null }) => [v.nome, v.valor]), [["Ana", 26000]]);
  assert.equal(passagemDaVenda(comJson), "Inclusa");
});

// ── Contrato por pessoa ────────────────────────────────────────────────────
test("montarPreviaDaPessoa: valor DAQUELA pessoa, aéreo dela e os dados dela (não os do comprador)", () => {
  const base = camposDasFontes({ negocio: {}, lead: {}, cliente, venda: vendaExpedicao(), bitrix, hoje: "09/11/2026" });
  const [, beto] = viajantesDaVenda(vendaExpedicao());
  const r = montarPreviaDaPessoa(base, { ...beto, aereo_incluso: false, cpf: "52998224725", nascimento: "1985-01-01", email: "BETO@x.com", telefone: "85988887777", endereco: "Rua B" },
    { totalDaVenda: 50000, nViajantes: 2 });
  assert.equal(r.menor, false);
  assert.equal(r.campos.nome, "Beto Lima");
  assert.equal(r.campos.cpf, "529.982.247-25");
  assert.equal(r.campos.email, "beto@x.com");
  assert.equal(r.campos.rg, "");          // nada herdado do comprador
  assert.equal(r.campos.valor_total, "24.000,00");
  assert.equal(r.origem.valor_total, "valor do viajante");
  assert.equal(r.campos.passagem, "Não inclusa");
  assert.match(r.campos.forma_pagamento, /Condições da venda total de R\$\s50\.000,00 \(2 viajantes\)\.$/);
  assert.equal(r.campos.viajante, "");
  assert.equal(r.campos.expedicao, "Japão e China 2027");
});

test("montarPreviaDaPessoa: menor de idade → contratante é o responsável e o menor sai como VIAJANTE", () => {
  const base = camposDasFontes({ negocio: {}, lead: {}, cliente, venda: vendaExpedicao(), bitrix, hoje: "09/11/2026" });
  const menor = { nome: "Caio Lima", nascimento: "2015-03-10", cpf: "", valor: 15000, aereo_incluso: true };
  const r = montarPreviaDaPessoa(base, menor, { responsavel: cliente, totalDaVenda: 50000 });
  assert.equal(r.menor, true);
  assert.equal(r.idade, 11);
  assert.equal(r.campos.nome, "Ana Lima");
  assert.equal(r.campos.cpf, "111.444.777-35");
  assert.equal(r.campos.endereco, "Rua A, 10, Centro, Fortaleza/CE, CEP 60000-000");
  assert.equal(r.origem.nome, "responsável pelo menor");
  assert.match(r.campos.viajante, /^Caio Lima, nascido\(a\) em 10\/03\/2015, menor de idade/);
  assert.equal(r.campos.valor_total, "15.000,00");
  const semResp = montarPreviaDaPessoa(base, menor, {});
  assert.equal(semResp.campos.nome, "");
  assert.ok(semResp.avisos.some((a: string) => /falta o responsável/.test(a)));
});

test("idadeEm: aniversário ainda não chegou conta um ano a menos", () => {
  assert.equal(idadeEm("2008-11-10", "09/11/2026"), 17);
  assert.equal(idadeEm("2008-11-09", "09/11/2026"), 18);
  assert.equal(idadeEm("", "09/11/2026"), null);
});

// ── Write-back pro cadastro ────────────────────────────────────────────────
test("write-back: completa vazio; sobrescreve só o que o closer editou; sem prévia só completa", () => {
  const vazio = { id: "c9", cpf: null, nascimento: null, email: null, rg: null };
  const c = { cpf: "529.982.247-25", nascimento: "01/02/1990", email: "Novo@X.com", rg: "MG-1", endereco: "Rua Nova 1, CEP 01234-567" };
  assert.deepEqual(correcoesDoCliente(vazio, c), {
    cpf: "52998224725", nascimento: "1990-02-01", email: "novo@x.com", rg: "MG-1",
    endereco_rua: "Rua Nova 1", endereco_numero: null, endereco_complemento: null, endereco_bairro: null, endereco_cidade: null, endereco_estado: null, endereco_cep: "01234567",
  });

  // Prévia trouxe do cadastro e o closer não mexeu → nada.
  const previa = camposDasFontes({ negocio: {}, lead: {}, cliente, venda: null, hoje: "09/11/2026" });
  assert.deepEqual(correcoesDoCliente(cliente, normalizarCampos(previa.campos), previa), {});
  // Closer trocou o CPF e o endereço → grava o CPF; o endereço NÃO (cadastro já
  // tem endereço estruturado: bairro/cidade/UF/CEP não podem ser apagados) e avisa.
  const editado = normalizarCampos({ ...previa.campos, cpf: "52998224725", endereco: "Av. Nova, 99" });
  const avisos: string[] = [];
  const patch = correcoesDoCliente(cliente, editado, previa, { avisos });
  assert.equal(patch.cpf, "52998224725");
  assert.ok(!Object.keys(patch).some((k) => k.startsWith("endereco_")));
  assert.deepEqual(avisos, [AVISO_ENDERECO]);
  assert.equal(patch.email, undefined);
  // Cadastro só com a rua (não estruturado) e o closer editou → regrava quebrando o texto.
  const soRua = { ...cliente, endereco_numero: "", endereco_bairro: "", endereco_cidade: "", endereco_estado: "", endereco_cep: "" };
  const prSoRua = camposDasFontes({ negocio: {}, lead: {}, cliente: soRua, venda: null, hoje: "09/11/2026" });
  const avisos2: string[] = [];
  const p3 = correcoesDoCliente(soRua, normalizarCampos({ ...prSoRua.campos, endereco: "Av. Nova, 99, Recife/PE" }), prSoRua, { avisos: avisos2 });
  assert.equal(p3.endereco_rua, "Av. Nova, 99");
  assert.equal(p3.endereco_cidade, "Recife");
  assert.equal(p3.endereco_estado, "PE");
  assert.deepEqual(avisos2, []);
  // Sem edição no endereço estruturado → nem grava nem avisa.
  const avisos3: string[] = [];
  correcoesDoCliente(cliente, normalizarCampos(previa.campos), previa, { avisos: avisos3 });
  assert.deepEqual(avisos3, []);
  // Mesmo valor diferente, sem prévia (não dá pra saber se editou) → não sobrescreve.
  assert.deepEqual(correcoesDoCliente(cliente, editado, null), {});
  // Ficha achada só por telefone/e-mail → não sobrescreve.
  assert.deepEqual(correcoesDoCliente(cliente, editado, previa, { podeSobrescrever: false }), {});
  // Valor que veio do "último envio" (correção antiga do closer) → grava.
  const doUltimo = camposDasFontes({ negocio: {}, lead: {}, cliente, venda: null, ultimo: { email: "corrigido@x.com" }, hoje: "09/11/2026" });
  assert.equal(correcoesDoCliente(cliente, normalizarCampos(doUltimo.campos), doUltimo).email, "corrigido@x.com");
  // CPF inválido e banco sem a coluna rg (0339 não aplicada) → não entram.
  const { rg: _rg, ...semRg } = { ...vazio };
  const p2 = correcoesDoCliente(semRg, { cpf: "123", rg: "X" });
  assert.equal(p2.cpf, undefined);
  assert.equal(p2.rg, undefined);
});

test("endereço: quebra conservadora (CEP + Cidade/UF no fim; o resto na rua) e volta ao mesmo texto", () => {
  const cols = enderecoParaColunas("Rua das Flores, 12, ap 3, CEP 04551-010");
  assert.equal(cols?.endereco_cep, "04551010");
  assert.equal(cols?.endereco_cidade, null);
  assert.equal(enderecoDoCliente(cols), "Rua das Flores, 12, ap 3, CEP 04551-010");
  const c2 = enderecoParaColunas("Rua das Flores, 12, Vila Olímpia, São Paulo/SP, 04551-010");
  assert.deepEqual([c2?.endereco_rua, c2?.endereco_cidade, c2?.endereco_estado, c2?.endereco_cep, c2?.endereco_bairro, c2?.endereco_numero],
    ["Rua das Flores, 12, Vila Olímpia", "São Paulo", "SP", "04551010", null, null]);
  const c3 = enderecoParaColunas("Av. Beira Mar 500, Fortaleza - ce");
  assert.deepEqual([c3?.endereco_rua, c3?.endereco_cidade, c3?.endereco_estado], ["Av. Beira Mar 500", "Fortaleza", "CE"]);
  // "UF" que não é UF (ex.: "Bloco B/AP") fica tudo na rua.
  const c4 = enderecoParaColunas("Rua X, 10, Bloco B/XX");
  assert.deepEqual([c4?.endereco_rua, c4?.endereco_cidade, c4?.endereco_estado], ["Rua X, 10, Bloco B/XX", null, null]);
  assert.equal(enderecoParaColunas("  "), null);
});

test("write-back de endereço com cadastro vazio: completa quebrando o texto", () => {
  const vazio = { id: "c8", nome: "X" };
  const p = correcoesDoCliente(vazio, { endereco: "Rua Y, 5, Natal/RN, CEP 59000-000" });
  assert.deepEqual([p.endereco_rua, p.endereco_cidade, p.endereco_estado, p.endereco_cep], ["Rua Y, 5", "Natal", "RN", "59000000"]);
});

// ── Anexo I ────────────────────────────────────────────────────────────────
test("Anexo I: com roteiro a 1.1 cita o anexo; sem roteiro, não cita", () => {
  const um = (c: Record<string, string>) => clausulasDe(c).find((l: string) => l.startsWith("1.1. "));
  assert.match(um({ tipo: "expedicao", roteiro: "Dia 1 — Chegada" }), /como anexo I\.$/);
  assert.match(um({ tipo: "expedicao", roteiro: "" }), /parte integrante deste contrato\.$/);
  assert.doesNotMatch(um({ tipo: "expedicao", roteiro: "" }), /anexo/i);
  assert.match(um({ tipo: "pacote", roteiro: "" }), /Anexo I/);   // pacote: texto do jurídico intacto
  const blocos = blocosDoRoteiro(textoDoRoteiro(vendaExpedicao().roteiro));
  assert.equal(blocos.length, 2);
  assert.equal(blocos[1].titulo, "Dia 2 · 10/10/2027 · Pequim — Pequim");
  assert.deepEqual(blocos[1].linhas, ["• Muralha", "🚐 Van"]);
  const { avisos } = validarCampos(normalizarCampos({ tipo: "expedicao", roteiro: "" }));
  assert.ok(avisos.some((a: string) => /Anexo I/.test(a)));
});
