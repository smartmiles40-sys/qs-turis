// "Igual ManyChat", grupo 2 (23/11/2026): ação no clique, botão "pular" da
// pergunta, "não respondeu" no template, bloco Nota — editor (tipos.ts) e
// motor (api/_mktAutoRegras.js) têm que dar as MESMAS saídas.
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/mkt/manychat-botoes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { saidasDoNo as saidasTela, validarGrafo, type No } from "../../src/mkt/automacoes/tipos.ts";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import * as srv from "../../api/_mktAutoRegras.js";

const tpl = (extra: Record<string, unknown> = {}) => ({ id: "t1", tipo: "template", x: 0, y: 0, dados: { nome: "black", idioma: "pt_BR", variaveis: {}, botoes: ["Quero", "Não"], ...extra } }) as No;
const perg = (extra: Record<string, unknown> = {}) => ({ id: "p1", tipo: "pergunta", x: 0, y: 0, dados: { pergunta: "Qual destino?", tipoResposta: "texto", salvarEm: null, sugestoes: ["Japão"], ...extra } }) as No;
const nota = { id: "n1", tipo: "nota", x: 0, y: 0, dados: { texto: "lembrete", cor: "azul" } } as No;

test("tela e motor dão as mesmas saídas (template com prazo, pergunta com pular, nota)", () => {
  for (const no of [tpl(), tpl({ esperarMinutos: 1440 }), perg(), perg({ pular: "Prefiro não dizer" }), nota]) {
    assert.deepEqual(saidasTela(no), srv.saidasDoNo(no), `${no.tipo} ${JSON.stringify(no.dados)}`);
  }
});

test("template com prazo ganha a saída 'Não respondeu'; sem botão, não", () => {
  assert.ok(srv.saidasDoNo(tpl({ esperarMinutos: 60 })).some((s: { id: string }) => s.id === "sem_resposta"));
  assert.ok(!srv.saidasDoNo(tpl({ esperarMinutos: 60, botoes: [] })).some((s: { id: string }) => s.id === "sem_resposta"));
  assert.ok(!srv.saidasDoNo(tpl()).some((s: { id: string }) => s.id === "sem_resposta"));
});

test("pergunta com pular: botão a mais com id de SAÍDA (o clique segue a seta 'Pulou')", () => {
  const c = srv.montarPergunta(perg({ pular: "Pular" }).dados, {}, "f:abc:p1:");
  const ids = c.interactive.action.buttons.map((b: { reply: { id: string } }) => b.reply.id);
  assert.deepEqual(ids, ["f:abc:p1:_s0", "f:abc:p1:pulou"]);
  // 3 sugestões + pular: a última sugestão sai pra caber no limite de 3 botões da Meta
  const c3 = srv.montarPergunta(perg({ sugestoes: ["a", "b", "c"], pular: "Pular" }).dados, {}, "x:");
  assert.equal(c3.interactive.action.buttons.length, 3);
  assert.equal(c3.interactive.action.buttons[2].reply.title, "Pular");
  // digitou o texto do botão
  assert.equal(srv.pulouPorTexto(perg({ pular: "Prefiro não dizer" }), "prefiro nao dizer!"), true);
  assert.equal(srv.pulouPorTexto(perg(), "qualquer"), false);
});

test("ação no clique: o simulador aplica a tag de quem tocou no botão", () => {
  const no = tpl({ acoesSaida: { botao_0: [{ tipo: "adicionar_tag", tag: "black: quer" }] } });
  const fluxo = {
    id: "00000000-0000-4000-8000-000000000001",
    grafo: {
      nos: [{ id: "i", tipo: "inicio", x: 0, y: 0, dados: {} }, no, { id: "f", tipo: "fim", x: 0, y: 0, dados: {} }],
      ligacoes: [{ id: "l1", de: "i", saida: "proximo", para: "t1" }, { id: "l2", de: "t1", saida: "botao_0", para: "f" }],
    },
  };
  const r = srv.simularFluxo(fluxo, { pessoa: { tags: [] }, respostas: { t1: "botao_0" } });
  assert.ok(r.pessoa.tags.includes("black: quer"));
  assert.deepEqual(srv.acoesDaSaida(no, "botao_1"), []);
});

test("editor barra ação no clique sem tag; nota não é 'bloco solto'", () => {
  const no = tpl({ acoesSaida: { botao_0: [{ tipo: "adicionar_tag", tag: " " }] } });
  const g = {
    nos: [{ id: "i", tipo: "inicio", x: 0, y: 0, dados: {} } as No, no, nota],
    ligacoes: [{ id: "l1", de: "i", saida: "proximo", para: "t1" }],
  };
  const p = validarGrafo(g);
  assert.ok(p.some((x) => x.grave && /ao clicar/.test(x.mensagem)));
  assert.ok(!p.some((x) => x.noId === "n1"));
});
