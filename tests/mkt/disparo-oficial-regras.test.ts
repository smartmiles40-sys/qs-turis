// DISPARO OFICIAL DO MARKETING (0341): as regras puras — travas, tier, ritmo,
// erros da Meta, modelos da WABA, components do template, custo e extras.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  travasDoEnvio, limiteDoTier, calcularFolga, pausaEntreEnvios, classificarErroMeta, modeloDaMeta, modeloParaTela,
  montarComponentes, pacoteDoEnvio, cobrancaDoRecibo, custoEstimado, conferirExtra,
} from "../../api/_mktOficialRegras.js";

const NUM = { phone_number_id: "999000111" };

test("travas: só é real com TODAS ligadas", () => {
  assert.deepEqual(travasDoEnvio({ envLigado: true, simulacao: false, numero: NUM, temToken: true }), { real: true, motivos: [] });
  const casos = [
    { envLigado: false, simulacao: false, numero: NUM, temToken: true },
    { envLigado: true, simulacao: true, numero: NUM, temToken: true },
    { envLigado: true, simulacao: undefined, numero: NUM, temToken: true }, // config não lida = simulação
    { envLigado: true, simulacao: false, numero: null, temToken: true },
    { envLigado: true, simulacao: false, numero: NUM, temToken: false },
  ];
  for (const c of casos) {
    const r = travasDoEnvio(c);
    assert.equal(r.real, false, JSON.stringify(c));
    assert.ok(r.motivos.length >= 1);
  }
  assert.equal(travasDoEnvio({ envLigado: false, simulacao: true, numero: null, temToken: false }).motivos.length, 3);
});

test("tier: valores da Meta e o lado seguro", () => {
  assert.equal(limiteDoTier("TIER_250"), 250);
  assert.equal(limiteDoTier("TIER_2K"), 2000);
  assert.equal(limiteDoTier("TIER_10K"), 10000);
  assert.equal(limiteDoTier("TIER_100K"), 100000);
  assert.equal(limiteDoTier("TIER_1K"), 1000); // nome antigo
  assert.equal(limiteDoTier("TIER_UNLIMITED"), Infinity);
  assert.equal(limiteDoTier(""), 250);
  assert.equal(limiteDoTier("qualquer"), 250);
});

test("folga: o menor entre tier (com margem), teto do dia e ritmo", () => {
  // tier 250 × 0,8 = 200 − 150 nas 24 h = 50
  assert.equal(calcularFolga({ tier: "TIER_250", margem: 0.8, porDia: 1000, enviados24h: 150, enviadosHoje: 0, porSegundo: 5, segundos: 45 }), 50);
  // teto do dia manda: 1000 − 990 = 10
  assert.equal(calcularFolga({ tier: "TIER_10K", porDia: 1000, enviados24h: 0, enviadosHoje: 990, porSegundo: 5, segundos: 45 }), 10);
  // ritmo manda: 2/s × 45 s = 90
  assert.equal(calcularFolga({ tier: "TIER_UNLIMITED", porDia: 100000, enviados24h: 0, enviadosHoje: 0, porSegundo: 2, segundos: 45 }), 90);
  // estourado = 0 (nunca negativo); contagem que falhou (Infinity) = 0
  assert.equal(calcularFolga({ tier: "TIER_250", porDia: 1000, enviados24h: 400, enviadosHoje: 0, porSegundo: 5, segundos: 45 }), 0);
  assert.equal(calcularFolga({ tier: "TIER_250", porDia: 1000, enviados24h: Infinity, enviadosHoje: 0, porSegundo: 5, segundos: 45 }), 0);
});

test("pausa entre envios respeita o por segundo e o teto de 80/s da Meta", () => {
  assert.equal(pausaEntreEnvios(5), 200);
  assert.equal(pausaEntreEnvios(1), 1000);
  assert.equal(pausaEntreEnvios(500), 13); // capado em 80/s
});

test("erros da Meta: o que cada código faz", () => {
  const acao = (c: number) => classificarErroMeta(c).acao;
  assert.equal(acao(131026), "destinatario");
  assert.equal(acao(131047), "destinatario");
  assert.equal(acao(131049), "destinatario");
  assert.equal(acao(131050), "optout");
  assert.equal(acao(130429), "esperar");
  assert.equal(acao(131056), "esperar");
  assert.equal(acao(80007), "esperar");
  assert.equal(acao(131048), "parar");
  assert.equal(acao(132001), "parar");
  assert.equal(acao(132015), "parar");
  assert.equal(acao(132016), "parar");
  assert.equal(acao(132099), "parar"); // qualquer 132xxx = modelo
  assert.equal(acao(368), "parar");
  assert.equal(classificarErroMeta(undefined, "fetch failed").acao, "destinatario");
  assert.equal(classificarErroMeta(undefined).codigo, null);
  assert.match(classificarErroMeta(131026).motivo, /código 131026/);
});

const TEMPLATE = {
  id: "777", name: "vagas_japao", language: "pt_BR", status: "APPROVED", category: "MARKETING", parameter_format: "POSITIONAL",
  components: [
    { type: "HEADER", format: "IMAGE", example: { header_handle: ["https://x"] } },
    { type: "BODY", text: "Oi {{1}}! Abriram as vagas de {{2}}." },
    { type: "FOOTER", text: "Responda PARAR pra sair" },
    { type: "BUTTONS", buttons: [
      { type: "URL", text: "Ver roteiro", url: "https://setur.com/r/{{1}}" },
      { type: "QUICK_REPLY", text: "Parar de receber" },
    ] },
  ],
};

test("modelo da Meta → linha e → tela", () => {
  const m = modeloDaMeta(TEMPLATE, "W1");
  assert.equal(m.nome, "vagas_japao");
  assert.equal(m.categoria, "MARKETING");
  assert.equal(m.status, "APPROVED");
  assert.equal(m.cabecalho_formato, "IMAGE");
  assert.equal(m.corpo, "Oi {{1}}! Abriram as vagas de {{2}}.");
  assert.deepEqual(m.botoes.map((b: { tipo: string; variavel: boolean }) => [b.tipo, b.variavel]), [["URL", true], ["QUICK_REPLY", false]]);
  const t = modeloParaTela(m);
  assert.equal(t.status, "aprovado");
  assert.equal(t.precisaMidia, true);
  assert.equal(t.botaoParar, true);
  assert.equal(t.origem, "meta");
  assert.equal(modeloParaTela({ ...m, status: "PENDING" }).status, "enviado");
  assert.equal(modeloParaTela({ ...m, status: "REJECTED" }).status, "recusado");
  assert.equal(modeloParaTela({ ...m, status: "PAUSED" }).status, "pausado");
});

test("components: mídia no topo, corpo em ordem, botão de link codificado", () => {
  const modelo = modeloDaMeta(TEMPLATE);
  const r = montarComponentes({ modelo, corpo: { "2": "Japão", "1": "Ana" }, midia: { link: "https://cdn/x.jpg" }, botoes: { 0: "Gonçalves" } });
  assert.deepEqual(r.components, [
    { type: "header", parameters: [{ type: "image", image: { link: "https://cdn/x.jpg" } }] },
    { type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "Japão" }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "Gon%C3%A7alves" }] },
  ]);
  // sem mídia: erro da CAMPANHA (ninguém recebe)
  const semMidia = montarComponentes({ modelo, corpo: { 1: "Ana", 2: "Japão" }, botoes: { 0: "x" } });
  assert.equal(semMidia.nivel, "campanha");
  // variável vazia: erro só deste destinatário
  const vazio = montarComponentes({ modelo, corpo: { 1: "", 2: "Japão" }, midia: { id: "123456" }, botoes: { 0: "x" } });
  assert.equal(vazio.nivel, "destinatario");
});

test("components: documento com nome, topo de texto e modelo NAMED", () => {
  const doc = montarComponentes({ modelo: { cabecalho_formato: "DOCUMENT", corpo: "Segue" }, midia: { id: "55555", nome: "roteiro.pdf" } });
  assert.deepEqual(doc.components, [{ type: "header", parameters: [{ type: "document", document: { id: "55555", filename: "roteiro.pdf" } }] }]);
  const named = montarComponentes({
    modelo: { cabecalho_formato: "TEXT", cabecalho_texto: "Olá {{nome}}", corpo: "Vagas de {{destino}}", formato_parametros: "NAMED" },
    topo: "Ana", corpo: { destino: "Japão" },
  });
  assert.deepEqual(named.components, [
    { type: "header", parameters: [{ type: "text", text: "Ana", parameter_name: "nome" }] },
    { type: "body", parameters: [{ type: "text", parameter_name: "destino", text: "Japão" }] },
  ]);
  // sem variável nenhuma: sem components
  assert.deepEqual(montarComponentes({ modelo: { corpo: "Bom dia!" } }).components, []);
});

test("pacote do envio no formato da Cloud API", () => {
  const p = pacoteDoEnvio({ para: "5511999990000", modelo: { nome: "vagas", idioma: "pt_BR" }, components: [], marca: "mkt:abc" });
  assert.deepEqual(p, {
    messaging_product: "whatsapp", recipient_type: "individual", to: "5511999990000", type: "template",
    biz_opaque_callback_data: "mkt:abc", template: { name: "vagas", language: { code: "pt_BR" } },
  });
});

test("cobrança do recibo e custo estimado", () => {
  assert.deepEqual(cobrancaDoRecibo({ pricing: { billable: true, pricing_model: "PMP", type: "regular", category: "marketing" } }), { cobranca_categoria: "marketing", cobravel: true });
  assert.equal(cobrancaDoRecibo({ status: "read" }), null);
  assert.deepEqual(custoEstimado({ marketing: 100, utility: 10 }, { moeda: "BRL", marketing: 0.35, utility: 0.05 }), { total: 35.5, moeda: "BRL", completo: true });
  assert.deepEqual(custoEstimado({ marketing: 100 }, { moeda: "BRL", marketing: null }), { total: 0, moeda: "BRL", completo: false });
});

test("extras da campanha conferidos contra o modelo", () => {
  const tela = modeloParaTela(modeloDaMeta(TEMPLATE));
  assert.match(conferirExtra(tela, {}).erro, /imagem/);
  assert.match(conferirExtra(tela, { midia: { link: "http://inseguro" } }).erro, /https/);
  assert.match(conferirExtra(tela, { midia: { link: "https://cdn/x.jpg" } }).erro, /Ver roteiro/);
  const ok = conferirExtra(tela, { midia: { link: "https://cdn/x.jpg" }, botoes: { 0: { fonte: "texto", valor: "japao-2027" } }, lixo: 1 });
  assert.deepEqual(ok.extra, { midia: { link: "https://cdn/x.jpg" }, botoes: { "0": { fonte: "texto", valor: "japao-2027" } } });
  // modelo só de texto: extra vazio, nada exigido
  assert.deepEqual(conferirExtra(modeloParaTela(modeloDaMeta({ name: "t", components: [{ type: "BODY", text: "Oi" }] })), { midia: { link: "https://x" } }).extra, {});
});
