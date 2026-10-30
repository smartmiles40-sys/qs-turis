// Regras puras das automações do Marketing (api/_mktAutoRegras.js) + paridade com o editor.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../../api/_mktAutoRegras.js";
import * as T from "../../src/mkt/automacoes/tipos.ts";

const FLUXO = "11111111-2222-3333-4444-555555555555";

test("janela de 24 h: aberta até 23h58, fechada depois; sem entrada = fechada", () => {
  const agora = Date.parse("2026-10-30T15:00:00Z");
  assert.equal(R.janelaAberta(null, agora), false);
  assert.equal(R.janelaAberta("2026-10-30T14:00:00Z", agora), true);
  assert.equal(R.janelaAberta("2026-10-29T15:03:00Z", agora), true); // 23h57
  assert.equal(R.janelaAberta("2026-10-29T15:01:00Z", agora), false); // 23h59: dentro da margem de 2 min
  assert.equal(R.janelaAberta("2026-10-28T15:00:00Z", agora), false);
  // o editor usa a mesma conta
  assert.equal(T.janelaAberta("2026-10-29T15:03:00Z", agora), true);
  assert.equal(T.janelaAberta("2026-10-29T15:01:00Z", agora), false);
});

test("fora da janela só template sai", () => {
  assert.equal(R.podeSairForaDaJanela({ type: "template" }), true);
  assert.equal(R.podeSairForaDaJanela({ type: "text" }), false);
  assert.equal(R.podeSairForaDaJanela({ type: "interactive" }), false);
});

test("mensagem com janela fechada: segue 'janela_fechada' se ligada, senão termina com erro", () => {
  const msg = T.noPadrao("mensagem", 0, 0);
  (msg.dados as T.DadosMensagem).blocos = [{ tipo: "texto", texto: "Oi {{primeiro_nome}}" }];
  const semSaida = { id: FLUXO, grafo: { nos: [msg], ligacoes: [] } };
  const p1 = R.planoDoNo(msg, semSaida, { janela: false });
  assert.equal(p1.tipo, "fim");
  assert.match(p1.erro, /24 h/);
  const comSaida = { id: FLUXO, grafo: { nos: [msg], ligacoes: [{ id: "l", de: msg.id, saida: "janela_fechada", para: "x" }] } };
  const p2 = R.planoDoNo(msg, comSaida, { janela: false });
  assert.deepEqual([p2.tipo, p2.saida, p2.enviar], ["seguir", "janela_fechada", undefined]);
  const p3 = R.planoDoNo(msg, comSaida, { janela: true, pessoa: { nome: "Maria Silva" } });
  assert.equal(p3.enviar[0].text.body, "Oi Maria");
});

test("botões levam o endereço da seta no id (f:fluxo:bloco:saida) e o clique volta certo", () => {
  const corpos = R.montarMensagens(
    { blocos: [{ tipo: "texto", texto: "Qual destino?" }], interacao: { tipo: "botoes", botoes: [{ id: "b_jp", titulo: "Japão" }, { id: "b_pe", titulo: "Peru" }] } },
    {}, R.prefixoDeResposta(FLUXO, "msg_1"),
  );
  assert.equal(corpos.length, 1);
  const id = corpos[0].interactive.action.buttons[1].reply.id;
  assert.equal(id, `f:${FLUXO}:msg_1:b_pe`);
  assert.deepEqual(R.lerIdDeResposta(id), { fluxoId: FLUXO, noId: "msg_1", saida: "b_pe" });
  assert.equal(R.lerIdDeResposta("qualquer coisa"), null);
});

test("lerEntrada: clique, lista, botão de template, anúncio", () => {
  assert.equal(R.lerEntrada({ type: "interactive", interactive: { button_reply: { id: "x", title: "Sim" } } }).idResposta, "x");
  assert.equal(R.lerEntrada({ type: "interactive", interactive: { list_reply: { id: "y", title: "Japão" } } }).texto, "Japão");
  assert.equal(R.lerEntrada({ type: "button", button: { text: "Quero", payload: "f:p" } }).idResposta, "f:p");
  const ad = R.lerEntrada({ type: "text", text: { body: "Olá" }, referral: { source_type: "ad", source_id: "120200", ctwa_clid: "abc" } });
  assert.equal(ad.anuncioId, "120200");
  assert.equal(ad.ctwaClid, "abc");
});

test("palavra-chave casa palavra inteira, sem acento", () => {
  assert.equal(R.casaPalavraChave("Quero ir pro JAPÃO!", { palavras: ["japao"] }), true);
  assert.equal(R.casaPalavraChave("posso perguntar?", { palavras: ["peru"] }), false);
  assert.equal(R.casaPalavraChave("roteiro", { palavras: ["roteiro"], modo: "exata" }), true);
  assert.equal(R.casaPalavraChave("roteiro do peru", { palavras: ["roteiro"], modo: "exata" }), false);
  assert.equal(R.casaPalavraChave("roteiro do peru", { palavras: ["roteiro"], modo: "comeca" }), true);
});

test("ordem dos gatilhos: ref > anúncio > palavra > boas-vindas > padrão (com intervalo)", () => {
  const g = (tipo: string, config: object = {}, id = tipo) => ({ id, tipo, config, ativo: true, fluxo_id: id });
  const todos = [g("padrao", { intervalo_horas: 24 }), g("boas_vindas"), g("palavra_chave", { palavras: ["japao"] }), g("anuncio", { ad_ids: [] }), g("link_ref", { codigo: "live-peru" })];
  const e = (texto: string, anuncioId: string | null = null) => ({ texto, anuncioId });
  assert.equal(R.escolherGatilho(todos, e("Quero saber [ref:live-peru] japao"), { nova: true }).tipo, "link_ref");
  assert.equal(R.escolherGatilho(todos, e("japao", "999"), { nova: true }).tipo, "anuncio");
  assert.equal(R.escolherGatilho(todos, e("japao"), { nova: true }).tipo, "palavra_chave");
  assert.equal(R.escolherGatilho(todos, e("oi"), { nova: true }).tipo, "boas_vindas");
  assert.equal(R.escolherGatilho(todos, e("oi"), { nova: false }).tipo, "padrao");
  const agora = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(R.escolherGatilho(todos, e("oi"), { nova: false, respostaPadraoEm: "2026-10-30T02:00:00Z", agora }), null);
  assert.equal(R.escolherGatilho(todos, e("oi"), { nova: false, respostaPadraoEm: "2026-10-29T11:00:00Z", agora }).tipo, "padrao");
  // anúncio filtrado por id
  assert.equal(R.escolherGatilho([g("anuncio", { ad_ids: ["1"] })], e("oi", "2")), null);
});

test("Aguardar com faixa de horário (São Paulo)", () => {
  const d = { quantidade: 1, unidade: "horas", janelaInicio: "09:00", janelaFim: "20:00" };
  // 22h SP + 1h = 23h → fora → amanhã 09h SP (12h UTC)
  assert.equal(R.calcularAcordar(d, new Date("2026-10-31T01:00:00Z")).toISOString(), "2026-10-31T12:00:00.000Z");
  // 05h SP + 1h = 06h → hoje 09h
  assert.equal(R.calcularAcordar(d, new Date("2026-10-30T08:00:00Z")).toISOString(), "2026-10-30T12:00:00.000Z");
  // 10h SP + 1h = 11h → dentro
  assert.equal(R.calcularAcordar(d, new Date("2026-10-30T13:00:00Z")).toISOString(), "2026-10-30T14:00:00.000Z");
  // sem faixa
  assert.equal(R.calcularAcordar({ quantidade: 2, unidade: "dias" }, new Date("2026-10-30T13:00:00Z")).toISOString(), "2026-11-01T13:00:00.000Z");
});

test("pergunta valida e normaliza", () => {
  assert.equal(R.validarResposta("email", " Ana@Ex.com "), "ana@ex.com");
  assert.equal(R.validarResposta("email", "ana@"), null);
  assert.equal(R.validarResposta("telefone", "(61) 99670-8984"), "5561996708984");
  assert.equal(R.validarResposta("data", "5/3/27"), "2027-03-05");
  assert.equal(R.validarResposta("numero", "2,5"), "2.5");
});

test("condição e A/B", () => {
  const c = { tags: ["quente"], campos: { destino: "Japão" }, janelaAberta: true, inscritoWhatsapp: true };
  assert.equal(R.avaliarCondicao({ combinar: "todas", regras: [{ campo: "tag", operador: "tem", valor: "Quente" }, { campo: "campo", chave: "destino", operador: "igual", valor: "japao" }] }, c), true);
  assert.equal(R.avaliarCondicao({ combinar: "todas", regras: [{ campo: "janela_aberta", operador: "nao_tem" }] }, c), false);
  const vs = [{ id: "a", nome: "A", peso: 70 }, { id: "b", nome: "B", peso: 30 }];
  assert.equal(R.escolherVariante(vs, 0.1).id, "a");
  assert.equal(R.escolherVariante(vs, 0.9).id, "b");
});

test("simulador anda sem mandar nada: tag, condição, espera de clique", () => {
  const ini = T.noPadrao("inicio", 0, 0);
  const acao = T.noPadrao("acao", 0, 0); (acao.dados as T.DadosAcao).acoes = [{ tipo: "adicionar_tag", tag: "lp-japao" }];
  const cond = T.noPadrao("condicao", 0, 0); (cond.dados as T.DadosCondicao).regras = [{ campo: "tag", operador: "tem", valor: "lp-japao" }];
  const msg = T.noPadrao("mensagem", 0, 0);
  (msg.dados as T.DadosMensagem).blocos = [{ tipo: "texto", texto: "Oi {{primeiro_nome}}, quer o roteiro?" }];
  (msg.dados as T.DadosMensagem).interacao = { tipo: "botoes", botoes: [{ id: "sim", titulo: "Quero" }] };
  const fim = T.noPadrao("fim", 0, 0);
  const grafo = { nos: [ini, acao, cond, msg, fim], ligacoes: [
    { id: "1", de: ini.id, saida: "proximo", para: acao.id },
    { id: "2", de: acao.id, saida: "proximo", para: cond.id },
    { id: "3", de: cond.id, saida: "sim", para: msg.id },
    { id: "4", de: msg.id, saida: "sim", para: fim.id },
  ] };
  const s1 = R.simularFluxo({ id: FLUXO, grafo }, { pessoa: { nome: "Bruno Oliveira" } });
  assert.equal(s1.fim, "esperando a resposta da pessoa");
  assert.deepEqual(s1.pessoa.tags, ["lp-japao"]);
  assert.equal(s1.passos.at(-1).enviar[0].interactive.body.text, "Oi Bruno, quer o roteiro?");
  const s2 = R.simularFluxo({ id: FLUXO, grafo }, { pessoa: {}, respostas: { [msg.id]: "sim" } });
  assert.equal(s2.fim, "concluído");
  // janela fechada sem saída: para com erro em vez de mandar texto livre
  const s3 = R.simularFluxo({ id: FLUXO, grafo }, { pessoa: {}, janela: false });
  assert.equal(s3.erro, true);
  assert.equal(s3.passos.flatMap((p: { enviar: unknown[] }) => p.enviar).length, 0);
});

test("laço sem Aguardar para no teto", () => {
  const ini = T.noPadrao("inicio", 0, 0);
  const a = T.noPadrao("acao", 0, 0);
  const grafo = { nos: [ini, a], ligacoes: [{ id: "1", de: ini.id, saida: "proximo", para: a.id }, { id: "2", de: a.id, saida: "proximo", para: a.id }] };
  const s = R.simularFluxo({ id: FLUXO, grafo }, {});
  assert.equal(s.erro, true);
  assert.match(s.fim, /teto/);
});

test("PARIDADE: as saídas do editor são as mesmas do motor, bloco por bloco", () => {
  const tipos: T.TipoNo[] = ["inicio", "mensagem", "template", "pergunta", "aguardar", "condicao", "acao", "randomizador", "ir_para", "fim"];
  const casos: T.No[] = tipos.map((t) => T.noPadrao(t, 0, 0));
  const m1 = T.noPadrao("mensagem", 0, 0); (m1.dados as T.DadosMensagem).interacao = { tipo: "botoes", botoes: [{ id: "a", titulo: "A" }, { id: "b", titulo: "" }] }; (m1.dados as T.DadosMensagem).esperarMinutos = 30;
  const m2 = T.noPadrao("mensagem", 0, 0); (m2.dados as T.DadosMensagem).interacao = { tipo: "lista", rotuloBotao: "Ver", secoes: [{ titulo: "", itens: [{ id: "i1", titulo: "Um" }, { id: "i2", titulo: "Dois" }] }] };
  const m3 = T.noPadrao("mensagem", 0, 0); (m3.dados as T.DadosMensagem).interacao = { tipo: "link", rotulo: "Abrir", url: "https://x" }; (m3.dados as T.DadosMensagem).esperarMinutos = 10;
  const t1 = T.noPadrao("template", 0, 0); (t1.dados as T.DadosTemplate).botoes = ["Sim", "Não"];
  casos.push(m1, m2, m3, t1);
  for (const no of casos) assert.deepEqual(R.saidasDoNo(no), T.saidasDoNo(no), `bloco ${no.tipo}`);
});

test("validarGrafo do editor pega o que a Meta recusaria", () => {
  const g = T.grafoInicial();
  const msg = g.nos[1] as Extract<T.No, { tipo: "mensagem" }>;
  assert.ok(T.validarGrafo(g).some((p) => p.grave && /vazio/.test(p.mensagem)));
  msg.dados.blocos = [{ tipo: "texto", texto: "Oi" }];
  msg.dados.interacao = { tipo: "botoes", botoes: [{ id: "a", titulo: "Igual" }, { id: "b", titulo: "igual" }] };
  assert.ok(T.validarGrafo(g).some((p) => p.grave && /mesmo texto/.test(p.mensagem)));
  msg.dados.interacao = { tipo: "nenhuma" };
  assert.equal(T.validarGrafo(g).filter((p) => p.grave).length, 0);
});

test("telefone canônico ganha o nono dígito; variantes cobrem os dois", () => {
  assert.equal(R.telefoneCanonico("556196708984"), "5561996708984");
  assert.equal(R.telefoneCanonico("(61) 99670-8984"), "5561996708984");
  assert.deepEqual(R.variantesTelefone("556196708984").sort(), ["556196708984", "5561996708984"]);
});

test("template monta as variáveis personalizadas; pausa manual de 12 h", () => {
  const t = R.montarTemplate({ nome: "boas_vindas", idioma: "pt_BR", variaveis: { "1": "{{primeiro_nome}}" } }, { nome: "Ana Paula" }, { nVariaveis: 2 });
  assert.deepEqual(t.params, { "1": "Ana", "2": "-" });
  const agora = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(R.pausaPorRespostaManual(12, agora), "2026-10-31T00:00:00.000Z");
  assert.equal(R.roboPausado("2026-10-31T00:00:00.000Z", agora), true);
  assert.equal(R.roboPausado(null, agora), false);
});
