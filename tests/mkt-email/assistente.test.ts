// Assistentes de e-mail (30/10/2026): passos, o que falta em cada um e os resumos.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emUnidade, pendenciasAutomacao, pendenciasCampanha, problemasDosBlocos, publicoVazio, quandoParaIso,
  resumoPublico, textoEspera, textoGatilho,
} from "../../src/mkt/email/lib/assistente.ts";
import type { Bloco } from "../../src/mkt/email/lib/blocos.ts";

const blocosOk: Bloco[] = [
  { id: "1", tipo: "titulo", texto: "Oi" },
  { id: "2", tipo: "botao", texto: "Ver", url: "https://setuforeuvouviagens.com.br" },
  { id: "3", tipo: "rodape" },
];
const pub = (o: Partial<{ listas: string[]; tags: string[]; segmento_id: string | null }> = {}) => ({ listas: [], tags: [], segmento_id: null, ...o });
const camp = (o: Record<string, unknown> = {}) => ({ nome: "X", publico: pub({ listas: ["l1"] }), assunto: "Assunto", blocos: blocosOk, remetente_email: null, ...o });

test("público vazio = ninguém recebe", () => {
  assert.equal(publicoVazio(pub()), true);
  assert.equal(publicoVazio(null), true);
  assert.equal(publicoVazio(pub({ listas: ["a"] })), false);
  assert.equal(publicoVazio(pub({ tags: ["vip"] })), false);
  assert.equal(publicoVazio(pub({ segmento_id: "s" })), false);
});

test("resumo do público em português", () => {
  assert.equal(resumoPublico(pub(), {}, {}), "Ninguém escolhido ainda");
  assert.equal(resumoPublico(pub({ listas: ["a", "b"], tags: ["vip"], segmento_id: "s" }), { a: "Japão", b: "China" }, { s: "Quentes" }),
    "Japão + China · tag vip · segmento Quentes");
});

test("blocos: sem conteúdo, botão sem link e imagem sem endereço são apontados", () => {
  assert.deepEqual(problemasDosBlocos(blocosOk), []);
  assert.ok(problemasDosBlocos([{ id: "r", tipo: "rodape" }]).some((p) => /sem conteúdo/.test(p)));
  assert.ok(problemasDosBlocos([{ id: "b", tipo: "botao", texto: "Ir", url: "https://" }]).some((p) => /sem link/.test(p)));
  assert.ok(problemasDosBlocos([{ id: "i", tipo: "imagem", url: "" }]).some((p) => /imagem/.test(p)));
});

test("horário de Brasília → ISO; lixo vira null", () => {
  assert.equal(quandoParaIso("2026-11-02T09:30"), "2026-11-02T12:30:00.000Z");
  assert.equal(quandoParaIso(""), null);
  assert.equal(quandoParaIso("amanhã"), null);
});

test("campanha: pendências por passo", () => {
  const agora = new Date("2026-10-30T12:00:00Z");
  const ok = pendenciasCampanha(camp(), { modo: "agora", quando: "" }, { remetentePadrao: "oi@mail.x.com", dominio: "mail.x.com" }, agora);
  assert.deepEqual(ok.revisar, []);

  const p = pendenciasCampanha(camp({ publico: pub(), assunto: " " }), { modo: "agendar", quando: "2026-10-29T10:00" }, {}, agora);
  assert.equal(p.para.length, 1);
  assert.ok(p.conteudo.includes("Escreva o assunto"));
  assert.ok(p.quando.some((x) => /remetente/.test(x)));
  assert.ok(p.quando.some((x) => /já passou/.test(x)));
  assert.equal(p.revisar.length, p.para.length + p.conteudo.length + p.quando.length);

  const dom = pendenciasCampanha(camp({ remetente_email: "eu@gmail.com" }), { modo: "agora", quando: "" }, { dominio: "mail.x.com" }, agora);
  assert.ok(dom.quando.some((x) => /@mail\.x\.com/.test(x)));
  const semData = pendenciasCampanha(camp(), { modo: "agendar", quando: "" }, { remetentePadrao: "a@b.com" }, agora);
  assert.ok(semData.quando.some((x) => /dia e a hora/.test(x)));
});

test("automação: gatilho, modelo e espera de 1 min a 90 dias", () => {
  assert.deepEqual(pendenciasAutomacao({ gatilho_tipo: "formulario", gatilho_valor: null, passos: [{ tipo: "email", modelo_id: "m" }] }).revisar, []);
  const p = pendenciasAutomacao({ gatilho_tipo: "lista", gatilho_valor: null, passos: [{ tipo: "esperar", minutos: 91 * 1440 }, { tipo: "email", modelo_id: "" }] });
  assert.ok(p.gatilho.includes("Escolha a lista"));
  assert.ok(p.sequencia.some((x) => /90 dias/.test(x)));
  assert.ok(p.sequencia.some((x) => /modelo/.test(x)));
  assert.ok(pendenciasAutomacao({ gatilho_tipo: "tag", gatilho_valor: " ", passos: [] }).revisar.includes("Ponha pelo menos um e-mail"));
});

test("textos da automação", () => {
  assert.deepEqual(emUnidade(2880), [2, "dias"]);
  assert.deepEqual(emUnidade(90), [90, "minutos"]);
  assert.equal(textoEspera(1440), "1 dia");
  assert.equal(textoEspera(120), "2 horas");
  assert.equal(textoGatilho({ gatilho_tipo: "lista", gatilho_valor: "a" }, { a: "Japão" }), "Quando entrar na lista Japão");
  assert.equal(textoGatilho({ gatilho_tipo: "formulario", gatilho_valor: null }, {}), "Quando responder qualquer formulário");
});
