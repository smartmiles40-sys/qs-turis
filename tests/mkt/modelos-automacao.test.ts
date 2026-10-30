// "Comece por um modelo" e respostas básicas (src/mkt/automacoes/modelos.ts).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/mkt/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../../src/mkt/automacoes/modelos.ts";
import * as T from "../../src/mkt/automacoes/tipos.ts";
import * as R from "../../api/_mktAutoRegras.js";

const criaveis = M.MODELOS_AUTOMACAO.filter((m) => m.gatilho);

test("todo modelo pronto vira um fluxo SEM erro grave (dá pra ativar na hora)", () => {
  for (const m of criaveis) {
    const r = M.montarModelo(m.id, M.paramsPadrao(m.id));
    assert.ok(!("erro" in r), `${m.id}: ${"erro" in r ? r.erro : ""}`);
    if ("erro" in r) continue;
    const graves = T.validarGrafo(r.grafo).filter((p) => p.grave);
    assert.deepEqual(graves, [], `${m.id} tem erro grave`);
    assert.equal(r.gatilho.tipo, m.gatilho);
  }
});

test("a config do gatilho de cada modelo passa na régua do servidor sem mudar", () => {
  for (const m of criaveis) {
    const r = M.montarModelo(m.id, M.paramsPadrao(m.id));
    if ("erro" in r) continue;
    const limpo = R.limparConfigGatilho(r.gatilho.tipo, r.gatilho.config, () => "x");
    assert.ok(!limpo.erro, `${m.id}: ${limpo.erro}`);
    assert.deepEqual(limpo.config, r.gatilho.config, `${m.id}: o servidor mexeria na config`);
  }
});

test("nenhum modelo começa conversa sozinho (sem webhook, sem tag, sem template)", () => {
  for (const m of criaveis) {
    assert.ok(!["webhook", "tag_adicionada"].includes(m.gatilho as string), m.id);
    const r = M.montarModelo(m.id, M.paramsPadrao(m.id));
    if ("erro" in r) continue;
    assert.ok(!r.grafo.nos.some((n) => n.tipo === "template"), `${m.id} usa template`);
  }
});

test("PARAR só explica: não cria fluxo", () => {
  const r = M.montarModelo("parar", {});
  assert.ok("erro" in r);
  assert.equal(M.MODELOS_AUTOMACAO.find((m) => m.id === "parar")?.gatilho, null);
});

test("palavra de expedição: troca {{destino}}, deixa {{primeiro_nome}} pro motor e põe a tag", () => {
  const r = M.montarModelo("palavra_expedicao", { ...M.paramsPadrao("palavra_expedicao"), destino: "Islândia", palavras: "ISLANDIA, islândia" });
  assert.ok(!("erro" in r));
  if ("erro" in r) return;
  const msg = r.grafo.nos.find((n) => n.tipo === "mensagem");
  assert.ok(msg && msg.tipo === "mensagem");
  const texto = msg.dados.blocos[0].tipo === "texto" ? msg.dados.blocos[0].texto : "";
  assert.match(texto, /Islândia/);
  assert.match(texto, /\{\{primeiro_nome\}\}/);
  assert.equal(msg.dados.interacao.tipo, "link");
  const acoes = r.grafo.nos.find((n) => n.tipo === "acao");
  assert.ok(acoes && acoes.tipo === "acao");
  assert.deepEqual(acoes.dados.acoes, [{ tipo: "adicionar_tag", tag: "quer-islandia" }]);
  assert.deepEqual(r.gatilho.config.palavras, ["ISLANDIA", "islândia"]);
  // e o servidor casa a palavra
  assert.equal(R.casaPalavraChave("quero saber da islandia!", r.gatilho.config), true);
});

test("pedido de atendente ganha das palavras de expedição e avisa o time", () => {
  const r = M.montarModelo("pedido_humano", { ...M.paramsPadrao("pedido_humano"), usuarios: ["u1"] });
  assert.ok(!("erro" in r));
  if ("erro" in r) return;
  assert.ok(r.gatilho.prioridade > 0);
  const a = r.grafo.nos.find((n) => n.tipo === "acao");
  assert.ok(a && a.tipo === "acao" && a.dados.acoes[0].tipo === "avisar_humano");
  const gExp = { id: "e", fluxo_id: "f1", tipo: "palavra_chave", ativo: true, prioridade: 0, config: { palavras: ["japão"], modo: "contem" } };
  const gHum = { id: "h", fluxo_id: "f2", tipo: "palavra_chave", ativo: true, prioridade: r.gatilho.prioridade, config: r.gatilho.config };
  // o motor já recebe os gatilhos em ordem de prioridade (desc)
  const g = R.escolherGatilho([gHum, gExp], { texto: "quero falar com alguém sobre o Japão" });
  assert.equal(g?.id, "h");
});

test("o que falta: campo obrigatório vazio e link sem https", () => {
  assert.deepEqual(M.faltandoNoModelo("palavra_expedicao", M.paramsPadrao("palavra_expedicao")), []);
  const f = M.faltandoNoModelo("palavra_expedicao", { ...M.paramsPadrao("palavra_expedicao"), palavras: "", link_url: "setuforeuvou.com.br" });
  assert.ok(f.some((x) => /Palavras/.test(x)));
  assert.ok(f.some((x) => /https/.test(x)));
  assert.ok("erro" in M.montarModelo("palavra_expedicao", { ...M.paramsPadrao("palavra_expedicao"), palavras: [] }));
});

test("resposta simples: vai e volta igual; com botão de resposta deixa de ser simples", () => {
  const r = { texto: "Oi! Já te respondo.", link: { rotulo: "Ver site", url: "https://x.com" } };
  const g = M.grafoDeRespostaSimples(r);
  assert.deepEqual(M.lerRespostaSimples(g), r);
  assert.deepEqual(T.validarGrafo(g).filter((p) => p.grave), []);
  assert.deepEqual(M.lerRespostaSimples(M.grafoDeRespostaSimples({ texto: "só texto", link: null })), { texto: "só texto", link: null });
  const msg = g.nos.find((n) => n.tipo === "mensagem");
  if (msg && msg.tipo === "mensagem") msg.dados.interacao = { tipo: "botoes", botoes: [{ id: "b1", titulo: "Sim" }] };
  assert.equal(M.lerRespostaSimples(g), null);
  assert.equal(M.lerRespostaSimples(T.grafoInicial()) !== null, true, "o fluxo em branco (Início → mensagem) também é simples");
  assert.equal(M.lerRespostaSimples(null), null);
});

test("frases dos cartões em linguagem simples", () => {
  assert.equal(M.fraseDoGatilho("palavra_chave", { palavras: ["japão"] }), "Quando alguém mandar “JAPÃO”");
  assert.equal(M.fraseDoGatilho("palavra_chave", { palavras: ["a", "b"], modo: "exata" }), "Quando alguém mandar exatamente “A” ou “B”");
  assert.equal(M.fraseDoGatilho("boas_vindas", {}), "Quando alguém mandar a primeira mensagem");
  assert.equal(M.fraseDoGatilho("padrao", { intervalo_horas: 12 }), "Quando nada mais combinar (até 1× a cada 12 h)");
  assert.equal(M.fraseDoGatilho("link_ref", { codigo: "bio" }), "Quando alguém chegar pelo link “bio”");
  const r = M.montarModelo("palavra_expedicao", M.paramsPadrao("palavra_expedicao"));
  if (!("erro" in r)) assert.match(M.fraseDaResposta(r.grafo), /^responde com “Oi, \{\{primeiro_nome\}\}! Que bom/);
  assert.equal(M.fraseDaResposta(null), "não faz nada ainda");
  const longo = M.grafoDeRespostaSimples({ texto: "x".repeat(200), link: null });
  assert.ok(M.fraseDaResposta(longo, 30).length <= 30 + "responde com “”".length);
});

test("Instagram: a regra do cartão em linguagem simples", () => {
  assert.deepEqual(M.fraseInstagram("comentario", { palavras: ["roteiro"], dm_texto: "Oi! Segue o link", respostas_publicas: ["Te mandei!"] }),
    { quando: "Quando alguém comentar “ROTEIRO” em qualquer post", entao: "manda DM “Oi! Segue o link” e responde no post" });
  assert.equal(M.fraseInstagram("comentario", { qualquer_palavra: true, posts: ["1", "2"], dm_texto: "x" }).quando, "Quando alguém comentar em 2 posts escolhidos");
  assert.equal(M.fraseInstagram("dm_palavra", { palavras: ["japão", "peru"], dm_texto: "x", dm_botoes: [{ titulo: "Ver", url: "https://a" }] }).entao, "manda DM “x” com botão de link");
  assert.equal(M.fraseInstagram("story_resposta", { dm_texto: "x" }).quando, "Quando alguém responder um story");
  assert.equal(M.fraseInstagram("story_mencao", {}).entao, "manda DM (falta escrever)");
});

test("o aviso 'pediu humano' do motor abre a aba Conversas da página WhatsApp", async () => {
  const { readFile } = await import("node:fs/promises");
  const motor = await readFile(new URL("../../api/_mktMotor.js", import.meta.url), "utf8");
  assert.match(motor, /link: `#mkt\/whatsapp\?aba=conversas&c=\$\{c\.id\}`/);
  assert.doesNotMatch(motor, /#mkt\/conversas/);
  const rotas = await readFile(new URL("../../src/mkt/disparos/rotas.ts", import.meta.url), "utf8");
  assert.match(rotas, /id: "whatsapp"/);
  const pagina = await readFile(new URL("../../src/mkt/disparos/WhatsAppPage.tsx", import.meta.url), "utf8");
  assert.match(pagina, /id: "conversas"/);
});
