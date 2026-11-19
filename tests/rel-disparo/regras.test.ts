// Disparo do Relacionamento "igual ao ManyChat" (0408): as regras puras.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../../api/_relDisparoRegras.js";
import { botaoClicado } from "../../api/_relDisparoBotoes.js";

test("travas: só é real com env + simulação desligada + número + token", () => {
  const n = { phone_number_id: "123" };
  assert.equal(R.travasDoEnvioRel({ envLigado: true, simulacao: false, numero: n, temToken: true }).real, true);
  const t = R.travasDoEnvioRel({ envLigado: false, simulacao: true, numero: null, temToken: false });
  assert.equal(t.real, false);
  assert.equal(t.motivos.length, 3);
  assert.match(t.motivos[0], /REL_DISPARO_ENVIO/);
  assert.equal(R.travasDoEnvioRel({ envLigado: true, simulacao: false, numero: n, temToken: false }).real, false);
  // simulação "indefinida" conta como ligada (o lado seguro)
  assert.equal(R.travasDoEnvioRel({ envLigado: true, simulacao: undefined, numero: n, temToken: true }).real, false);
});

test("etiquetas: minúsculas, sem espaço sobrando, sem repetir, até 40", () => {
  assert.equal(R.normalizarEtiqueta("  VIP   Japão "), "vip japão");
  assert.equal(R.normalizarEtiqueta(""), null);
  assert.equal(R.normalizarEtiqueta("x".repeat(41)), null);
  assert.deepEqual(R.listaDeEtiquetas("VIP, vip; Japão|  "), ["vip", "japão"]);
  assert.deepEqual(R.listaDeEtiquetas(["a", "A ", null]), ["a"]);
});

test("telefone da planilha: põe 55 e recusa lixo", () => {
  assert.equal(R.telefoneDaPlanilha("(11) 98012-4183"), "5511980124183");
  assert.equal(R.telefoneDaPlanilha("+55 11 98012-4183"), "5511980124183");
  assert.equal(R.telefoneDaPlanilha("1234"), null);
});

test("planilha sem cabeçalho: 1ª coluna = contato, 2ª = etiquetas, + as do campo", () => {
  const p = R.lerPlanilhaEtiquetas("11980124183;vip\nana@x.com;japão,vip\n123.456.789-09;\nlixo;vip", ["black"]);
  assert.equal(p.linhas.length, 3);
  assert.deepEqual(p.linhas[0], { telefone: "5511980124183", cpf: null, email: null, etiquetas: ["vip", "black"] });
  assert.equal(p.linhas[1].email, "ana@x.com");
  assert.deepEqual(p.linhas[1].etiquetas, ["japão", "vip", "black"]);
  assert.equal(p.linhas[2].cpf, "12345678909");
  assert.deepEqual(p.linhas[2].etiquetas, ["black"]);
  assert.equal(p.invalidas, 1);
});

test("planilha com cabeçalho: colunas por nome", () => {
  const p = R.lerPlanilhaEtiquetas("nome,whatsapp,tags\nAna,11980124183,vip\nBia,,vip");
  assert.equal(p.linhas.length, 1);
  assert.equal(p.linhas[0].telefone, "5511980124183");
  assert.equal(p.invalidas, 1);
});

const MODELO = {
  botoes: [
    { indice: 0, tipo: "QUICK_REPLY", texto: "Quero saber mais" },
    { indice: 1, tipo: "QUICK_REPLY", texto: "Parar de receber" },
    { indice: 2, tipo: "URL", texto: "Ver roteiro" },
  ],
};

test("respostas dos botões: guarda o rótulo, ignora vazio e botão de link", () => {
  const r = R.conferirRespostas(MODELO, {
    0: { texto: "Oi {{nome}}! Já te chamo.", etiqueta: " Quente ", avisar: true },
    1: {},
    2: { texto: "não vale" },
  });
  assert.deepEqual(r, { respostas: { 0: { rotulo: "Quero saber mais", texto: "Oi {{nome}}! Já te chamo.", etiqueta: "quente", avisar: true } } });
  assert.match(R.conferirRespostas(MODELO, { 0: { etiqueta: "x".repeat(50) } }).erro, /etiqueta/);
});

test("clique: acha a resposta pelo texto do botão, sem ligar pra acento/caixa", () => {
  const { respostas } = R.conferirRespostas(MODELO, { 0: { texto: "ok" } });
  assert.equal(R.respostaDoBotao(respostas, "quero SABER mais ")?.texto, "ok");
  assert.equal(R.respostaDoBotao(respostas, "Parar de receber"), null);
  assert.equal(R.respostaDoBotao({}, "x"), null);
});

test("resposta personalizada: {{nome}} vira o primeiro nome, {{destino}} o destino", () => {
  assert.equal(R.personalizarResposta("Oi {{nome}}, bora pro {{ destino }}?", { nome: "Ana Maria", destino: "Japão" }), "Oi Ana, bora pro Japão?");
  assert.equal(R.personalizarResposta("Oi {{nome}}", { nome: "" }), "Oi");
});

test("botão clicado: só mensagem de botão conta", () => {
  assert.equal(botaoClicado({ type: "button", button: { text: "Quero saber mais", payload: "Quero saber mais" } }), "Quero saber mais");
  assert.equal(botaoClicado({ type: "interactive", interactive: { type: "button_reply", button_reply: { title: "Sim" } } }), "Sim");
  assert.equal(botaoClicado({ type: "text", text: { body: "Quero saber mais" } }), null);
});

test("link rastreado: monta, confere e troca só a fonte link", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  assert.equal(R.linkRastreado("https://qs.x.com/", id, "2"), `https://qs.x.com/l/${id}/2`);
  assert.deepEqual(R.lerClique(id, "2"), { envioId: id, variavel: "2" });
  assert.equal(R.lerClique("nao-e-uuid", "2"), null);
  assert.equal(R.lerClique(id, "../x"), null);
  assert.equal(R.urlSegura("https://a.com/x?y=1"), true);
  assert.equal(R.urlSegura("javascript:alert(1)"), false);
  const p = R.paramsComLinks({ 1: { fonte: "nome" }, 2: { fonte: "link", valor: "https://a.com" } }, "https://qs.x.com", id);
  assert.deepEqual(p[1], { fonte: "nome" });
  assert.deepEqual(p[2], { fonte: "texto", valor: `https://qs.x.com/l/${id}/2` });
});
