// Aéreo da venda SÓ com código IATA (src/venda/iata.ts, Bruno 11/11/2026): validar e
// normalizar o código, trechos de qualquer formato (voucher/IA, proposta, texto antigo),
// formato gravado (igual a rel_viagem_trechos), faltas que bloqueiam o Consolidar e
// a regra da análise pós-venda (api/_vendaConferencia.js) + o voucher (api/_vendaVoucher.js).
//   node --import ./tests/registrar-ts.mjs --test tests/venda/iata.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as I from "../../src/venda/iata.ts";
import * as F from "../../src/venda/vendaFinal.ts";
import { AEROPORTOS } from "../../src/propostas/aeroportos.ts";
import { conferirVenda, pendenciasIata, trechosDoItem } from "../../api/_vendaConferencia.js";
import { codigoIata, montarVenda } from "../../api/_vendaVoucher.js";

const T = (o: Partial<I.TrechoVenda> = {}): I.TrechoVenda => ({ ...I.trechoVendaVazio(), ...o });

test("lista de aeroportos: grande, todo o Brasil com fuso, todo mundo com país", () => {
  const todos = Object.entries(AEROPORTOS);
  assert.ok(todos.length >= 450, `só ${todos.length}`);
  const br = todos.filter(([, a]) => a.pais === "Brasil");
  assert.ok(br.length >= 110, `só ${br.length} no Brasil`);
  assert.ok(br.every(([, a]) => typeof a.fuso === "number"), "aeroporto do Brasil sem fuso");
  assert.ok(todos.every(([c, a]) => /^[A-Z]{3}$/.test(c) && a.pais && a.cidade && a.nome), "aeroporto sem país/cidade/nome");
  for (const c of ["LIS", "FCO", "NRT", "PEK", "DXB", "JNB", "SYD", "JFK", "EZE", "CZS", "BYO", "FEN"]) assert.ok(AEROPORTOS[c], c);
  assert.equal(AEROPORTOS.ERN.fuso, -5);
  assert.equal(AEROPORTOS.GRU.cidade, "São Paulo, SP", "o que já existia não muda");
});

test("lerIata: código, cidade com 1 aeroporto, e recusa texto livre", () => {
  assert.deepEqual(I.lerIata(" lis "), { codigo: "LIS", status: "ok" });
  assert.equal(I.lerIata("LIS · Lisboa, Portugal").codigo, "LIS");
  assert.equal(I.lerIata("Lisboa (LIS)").codigo, "LIS");
  assert.equal(I.lerIata("Lisboa").codigo, "LIS", "cidade com um aeroporto só");
  assert.equal(I.lerIata("Guarulhos").codigo, "GRU", "nome do aeroporto");
  assert.equal(I.lerIata("").status, "vazio");
  for (const t of ["Europa", "Ásia", "Itália", "Japão", "EUA", "eur", "São Paulo", "Tóquio", "SAO", "RIO"]) {
    const l = I.lerIata(t);
    assert.equal(l.status, "invalido", t);
    assert.equal(l.codigo, "", t);
    assert.ok(l.mensagem, t);
  }
  assert.deepEqual(I.lerIata("SAO").sugestoes, ["GRU", "CGH", "VCP"]);
  assert.ok(I.lerIata("Itália").sugestoes?.includes("FCO"));
  // código de 3 letras fora da lista: aceita com aviso
  const x = I.lerIata("QQX");
  assert.equal(x.status, "fora_lista");
  assert.equal(x.codigo, "QQX");
  assert.match(x.mensagem!, /não está na lista/);
});

test("autocompletar: 'lis' e 'Lisboa' trazem LIS primeiro; país lista os aeroportos", () => {
  assert.equal(I.buscarAeroportos("lis")[0].rotulo, "LIS · Lisboa, Portugal");
  assert.equal(I.buscarAeroportos("Lisboa")[0].codigo, "LIS");
  assert.equal(I.buscarAeroportos("gru")[0].rotulo, "GRU · São Paulo, SP");
  assert.ok(I.buscarAeroportos("Itália", 30).every((o) => o.pais === "Itália"));
  assert.deepEqual(I.buscarAeroportos(""), []);
});

test("trecho do voucher/IA: código ok, cidade vira código, país/região fica pendente", () => {
  const t = I.normalizarTrecho({ origem: "GRU", destino: "", destino_cidade: "Lisboa", data: "2027-03-12", hora_saida: "22:10", cia: "TAP", voo: "tp 82", sentido: "ida" });
  assert.equal(t.origem_codigo, "GRU");
  assert.equal(t.destino_codigo, "LIS");
  assert.equal(t.destino, "Lisboa");
  assert.equal(t.companhia, "TAP");
  assert.equal(t.numero, "TP 82");
  assert.equal(t.tipo, "voo_internacional");
  const p = I.normalizarTrecho({ origem: "GRU", destino: "", destino_texto: "Europa" });
  assert.equal(p.destino_codigo, "");
  assert.equal(p.destino_texto, "Europa");
  const interno = I.normalizarTrecho({ origem_codigo: "NRT", destino_codigo: "KIX" });
  assert.equal(interno.tipo, "voo_interno", "Tóquio → Osaka é voo interno");
  // formato da proposta (saida/chegada) e de rel_viagem_trechos (companhia/numero)
  const prop = I.normalizarTrecho({ origem: "GRU", destino: "NAT", data: "2027-01-02", saida: "7:05", chegada: "10:00", cia: "GOL", voo: "G3 1234" });
  assert.deepEqual([prop.hora_saida, prop.hora_chegada, prop.tipo], ["07:05", "10:00", "voo_interno"]);
});

test("texto antigo ('GRU para Europa') vira trechos com o que não entendeu pendente", () => {
  const ts = I.trechosDoTextoLivre("GRU para Europa\nGRU → NRT 12/03/2027 JL 45\nvolta: LIS - GRU\nconfirmar depois");
  assert.equal(ts.length, 4);
  assert.deepEqual([ts[0].origem_codigo, ts[0].destino_codigo, ts[0].destino_texto], ["GRU", "", "Europa"]);
  assert.deepEqual([ts[1].origem_codigo, ts[1].destino_codigo, ts[1].data, ts[1].numero], ["GRU", "NRT", "2027-03-12", "JL 45"]);
  assert.deepEqual([ts[2].sentido, ts[2].origem_codigo, ts[2].destino_codigo], ["volta", "LIS", "GRU"]);
  assert.equal(ts[3].origem_texto, "confirmar depois");
  // venda antiga só com `voos`: a tela mostra os trechos convertidos
  assert.equal(I.lerTrechos({ voos: "GRU → NRT" })[0].destino_codigo, "NRT");
  // trechos gravados (array ou JSON texto) mandam; [] não cai no texto antigo
  assert.deepEqual(I.lerTrechos({ trechos: "[]", voos: "GRU → NRT" }), []);
  assert.equal(I.lerTrechos({ trechos: [{ origem_codigo: "GIG", destino_codigo: "SSA" }] })[0].tipo, "voo_interno");
});

test("dados pro banco: trechos viram ARRAY no formato de rel_viagem_trechos + voos em texto", () => {
  const tela = I.comTrechos({ companhia: "TAP", classe: "" }, [
    T({ origem_codigo: "GRU", destino_codigo: "LIS", data: "2027-03-12", hora_saida: "22:10", companhia: "TAP", numero: "TP 82", origem_texto: "lixo velho" }),
    T(), // em branco: não vai
    T({ sentido: "volta", origem_codigo: "LIS", destino_texto: "Europa" }),
  ]);
  const d = I.dadosParaBanco(tela);
  assert.equal(d.classe, undefined, "vazio sai");
  const ts = d.trechos as I.TrechoVenda[];
  assert.equal(ts.length, 2);
  assert.deepEqual(
    { ordem: ts[0].ordem, tipo: ts[0].tipo, origem_codigo: ts[0].origem_codigo, destino_codigo: ts[0].destino_codigo, origem: ts[0].origem, destino: ts[0].destino },
    { ordem: 1, tipo: "voo_internacional", origem_codigo: "GRU", destino_codigo: "LIS", origem: "São Paulo, SP", destino: "Lisboa" },
  );
  assert.equal(ts[0].origem_texto, undefined, "com código, o texto pendente sai");
  assert.equal(ts[1].destino_texto, "Europa", "sem código, o texto fica (pendente)");
  assert.equal(d.voos, "GRU → LIS 12/03/2027 22:10 TAP TP 82\nLIS → Europa");
  assert.deepEqual(I.dadosParaBanco({ companhia: "GOL" }), { companhia: "GOL" }, "sem trechos não inventa nada");
});

test("problemas (bloqueiam o Consolidar) e avisos (fora da lista)", () => {
  assert.deepEqual(I.problemasDoAereo([T({ origem_codigo: "GRU", destino_codigo: "LIS" })]), []);
  assert.match(I.problemasDoAereo([])[0], /^Aéreo: coloque os trechos/);
  assert.deepEqual(I.problemasDoAereo([T({ origem_codigo: "GRU", destino_texto: "Europa" }), T({ origem_codigo: "LIS" })], "Aéreo 2"), [
    'Aéreo 2: trecho 1 sem código IATA de destino (está escrito "Europa").',
    "Aéreo 2: trecho 2 sem código IATA de destino.",
  ]);
  assert.match(I.problemasDoAereo([T({ origem_codigo: "SAO", destino_codigo: "LIS" })])[0], /trecho 1 sem código IATA de origem/, "código de cidade não vale");
  assert.match(I.problemasDoAereo([T({ origem_codigo: "GRU", destino_codigo: "GRU" })])[0], /iguais/);
  assert.deepEqual(I.problemasDoAereo([T({ origem_codigo: "GRU", destino_codigo: "QQX" })]), [], "fora da lista não bloqueia");
  assert.deepEqual(I.avisosDoAereo([T({ origem_codigo: "GRU", destino_codigo: "QQX" })]), ["Aéreo: trecho 1 — QQX não está na lista de aeroportos, confira."]);
  assert.equal(I.precisaDeTrechos({ tipo: "aereo" }), true);
  assert.equal(I.precisaDeTrechos({ tipo: "pacote", dados: { aereo_incluso: "sim" } }), true);
  assert.equal(I.precisaDeTrechos({ tipo: "pacote", dados: {} }), false);
  assert.equal(I.precisaDeTrechos({ tipo: "expedicao", dados: { aereo_incluso: "sim" } }), false, "expedição: o voo é do grupo (Ops)");
});

test("faltas pra consolidar: aéreo sem IATA bloqueia e leva ao passo Detalhes", () => {
  const base: F.EntradaFaltas = {
    comprador: { nome: "João da Silva" }, acompanhantes: [], total: 5000,
    linhas: [{ ...F.linhaVazia(), forma: "pix", valor: "5000" }],
    itens: [{ tipo: "aereo", rotulo: "Aéreo", trechos: [T({ origem_codigo: "GRU", destino_texto: "Europa" })] }],
  };
  const f = F.faltasParaConsolidar(base);
  assert.deepEqual(f, ['Aéreo: trecho 1 sem código IATA de destino (está escrito "Europa").']);
  assert.equal(F.primeiroPassoDasFaltas(f), F.PASSO.detalhes);
  assert.deepEqual(F.faltasParaConsolidar({ ...base, itens: [{ tipo: "aereo", rotulo: "Aéreo", trechos: [T({ origem_codigo: "GRU", destino_codigo: "LIS" })] }] }), []);
  const pac = F.faltasParaConsolidar({ ...base, itens: [{ tipo: "pacote", rotulo: "Pacote / circuito", trechos: [] }] });
  assert.match(pac[0], /^Pacote \/ circuito — aéreo: coloque os trechos/);
  assert.equal(F.passoDaFalta(pac[0]), F.PASSO.detalhes);
  assert.deepEqual(F.faltasParaConsolidar({ ...base, itens: [{ tipo: "seguro", rotulo: "Seguro" }] }), [], "item sem aéreo não pede trecho");
});

test("análise pós-venda: aponta trecho sem IATA (venda nova e antiga) e lê o formato novo", () => {
  assert.deepEqual(pendenciasIata({ tipo: "aereo", dados: { trechos: [{ origem_codigo: "GRU", destino_codigo: "LIS", origem: "São Paulo, SP", destino: "Lisboa" }] } }), []);
  assert.deepEqual(pendenciasIata({ tipo: "aereo", dados: { trechos: [{ origem_codigo: "GRU", destino_codigo: "", destino_texto: "Europa" }] } }),
    ['Aéreo: trecho 1 sem código IATA de destino (está escrito "Europa").']);
  assert.deepEqual(pendenciasIata({ tipo: "aereo", dados: { voos: "GRU para Europa" } }), ['Aéreo: trecho 1 sem código IATA de origem e destino (está escrito "GRU para Europa").']);
  assert.match(pendenciasIata({ tipo: "pacote", dados: { aereo_incluso: "sim" } })[0], /Pacote — aéreo: sem trechos/);
  assert.deepEqual(pendenciasIata({ tipo: "pacote", dados: {} }), []);
  // origem = CIDADE no formato novo: "Rio de Janeiro, RJ" não pode virar "RIO"
  const ts = trechosDoItem({ dados: { trechos: [{ origem_codigo: "", origem: "Rio de Janeiro, RJ", destino_codigo: "LIS" }] } });
  assert.equal(ts[0].origem, "");
  assert.equal(ts[0].destino, "LIS");
  const c = conferirVenda({ hoje: "2026-11-11", vendido: [{ tipo: "aereo", nome: "Voo Europa", valor: 5000, dados: { voos: "GRU para Europa" } }], total_venda: 5000 });
  const r = c.riscos.find((x: { categoria: string }) => x.categoria === "iata");
  assert.ok(r, JSON.stringify(c.riscos));
  assert.equal(r.nivel, "medio");
  assert.equal(r.item, "Voo Europa");
});

test("voucher (servidor): só aceita código de 3 letras; cidade/região vai como texto pendente", () => {
  assert.equal(codigoIata(" gru "), "GRU");
  assert.equal(codigoIata("Lisboa (LIS)"), "LIS");
  assert.equal(codigoIata("Lisboa"), "", "antes virava LIS por sorte (slice)");
  assert.equal(codigoIata("Europa"), "", "antes virava EUR");
  assert.equal(codigoIata("SAO"), "", "código de cidade");
  const v = montarVenda({ legivel: true, voos: [{ origem: "GRU", destino: "Europa", destino_cidade: null, data: "2027-03-12", hora_saida: "22:10", hora_chegada: "11:30", voo: "TP 82", localizador: "ABC123" }] }, { hoje: "2026-11-11" });
  const it = v.itens.find((i: { tipo: string }) => i.tipo === "aereo");
  const t = it.dados.trechos[0];
  assert.equal(t.destino, "");
  assert.equal(t.destino_texto, "Europa");
  assert.ok(v.avisos.some((a: string) => /código IATA de destino \(Europa\)/.test(a)), v.avisos.join(" | "));
  // e a tela transforma isso num trecho PENDENTE
  const tela = I.lerTrechos({ trechos: it.dados.trechos });
  assert.match(I.problemasDoAereo(tela)[0], /trecho 1 sem código IATA de destino \(está escrito "Europa"\)/);
});
