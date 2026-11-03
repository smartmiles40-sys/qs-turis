// Testes do filtro por tipo da lista de Viagens (src/rel/lib/tiposViagem.ts).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/viagens/tiposViagem.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SERVICOS_DO_TIPO, TIPOS_FILTRO, condicaoDoTipo, lerTipo, tipoDoServico } from "../../src/rel/lib/tiposViagem.ts";

// Todos os serviços de SERVICOS (src/rel/lib/viagens.ts) + o "sem serviço"
const SERVICOS = ["expedicao", "pacote", "aereo", "hospedagem", "passeio", "cruzeiro", "seguro", "concierge", "conta_liminar", "outro", null] as const;

test("a fileira é Todos · Expedições · Pacotes · Aéreo · Hotel/Passeio · Seguro e outros", () => {
  assert.deepEqual(TIPOS_FILTRO.map((t) => t.rotulo), ["Todos", "Expedições", "Pacotes", "Aéreo", "Hotel/Passeio", "Seguro e outros"]);
});

test("cada serviço (e o vazio) cai em exatamente um tipo — os números somam o total", () => {
  for (const s of SERVICOS) {
    const em = Object.entries(SERVICOS_DO_TIPO).filter(([, ss]) => (ss as readonly unknown[]).includes(s)).map(([t]) => t);
    assert.equal(em.length, 1, `${s} está em ${em.join(", ") || "nenhum"}`);
  }
});

test("agrupamento: cruzeiro com pacote, passeio com hotel, sem serviço em outros", () => {
  assert.equal(tipoDoServico("pacote"), "pacote");
  assert.equal(tipoDoServico("cruzeiro"), "pacote");
  assert.equal(tipoDoServico("hospedagem"), "hotel");
  assert.equal(tipoDoServico("passeio"), "hotel");
  assert.equal(tipoDoServico("seguro"), "outros");
  assert.equal(tipoDoServico(null), "outros");
  assert.equal(tipoDoServico(undefined), "outros");
});

test("condição da consulta: serviço nos quatro primeiros, acompanhamento no outros (pega o serviço vazio)", () => {
  assert.equal(condicaoDoTipo("todos"), null);
  assert.deepEqual(condicaoDoTipo("expedicao"), { coluna: "servico", valores: ["expedicao"] });
  assert.deepEqual(condicaoDoTipo("pacote"), { coluna: "servico", valores: ["pacote", "cruzeiro"] });
  assert.deepEqual(condicaoDoTipo("aereo"), { coluna: "servico", valores: ["aereo"] });
  assert.deepEqual(condicaoDoTipo("hotel"), { coluna: "servico", valores: ["hospedagem", "passeio"] });
  // seguro/concierge/conta liminar/outro = "nenhum"; sem serviço = "classificar" (rel_acompanhamento)
  assert.deepEqual(condicaoDoTipo("outros"), { coluna: "acompanhamento", valores: ["nenhum", "classificar"] });
});

test("o ?tipo= do endereço: valor conhecido vale, o resto é Todos", () => {
  assert.equal(lerTipo("pacote"), "pacote");
  assert.equal(lerTipo("outros"), "outros");
  assert.equal(lerTipo(null), "todos");
  assert.equal(lerTipo(""), "todos");
  assert.equal(lerTipo("pacotes"), "todos");
  assert.equal(lerTipo("hospedagem"), "todos");
});
