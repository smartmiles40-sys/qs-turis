// Pipeline da saúde (Bruno 03/11 — src/expedicoes/lib/saudePipeline.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ETAPAS_SAUDE, etapaSaude, inscricaoTemAlertaSaude, montarPipeline } from "../../src/expedicoes/lib/saudePipeline.ts";

const laudo = (status: "a_fazer" | "em_andamento" | "emitido" | "dispensado", apto: "sim" | "nao" | "ressalvas" | null = null) => ({ status, apto });

test("saúde: alerta clínico sem laudo (ou a fazer) = Declarou alerta", () => {
  assert.equal(etapaSaude({ clinicos: 2, laudo: null }), "declarou");
  assert.equal(etapaSaude({ clinicos: 1, laudo: laudo("a_fazer") }), "declarou");
});

test("saúde: laudo em andamento / emitido apto / com ressalvas / dispensado / não apto", () => {
  assert.equal(etapaSaude({ clinicos: 1, laudo: laudo("em_andamento") }), "andamento");
  assert.equal(etapaSaude({ clinicos: 1, laudo: laudo("emitido", "sim") }), "liberado");
  assert.equal(etapaSaude({ clinicos: 1, laudo: laudo("emitido", "ressalvas") }), "liberado");
  assert.equal(etapaSaude({ clinicos: 1, laudo: laudo("emitido") }), "liberado");
  assert.equal(etapaSaude({ clinicos: 1, laudo: laudo("dispensado") }), "liberado");
  assert.equal(etapaSaude({ clinicos: 1, laudo: laudo("emitido", "nao") }), "nao_apto");
});

test("saúde: receita marcada e não enviada segura o caso em Receita a enviar", () => {
  assert.equal(etapaSaude({ clinicos: 1, laudo: laudo("emitido", "sim"), receitaPendente: true }), "receita");
  assert.equal(etapaSaude({ clinicos: 1, laudo: laudo("emitido", "sim"), receitaPendente: true, receitaEnviadaEm: "2026-11-01T10:00:00Z" }), "liberado");
  // sem caso clínico, só a receita (marcada na triagem)
  assert.equal(etapaSaude({ clinicos: 0, laudo: null, receitaPendente: true }), "receita");
  // laudo ainda não feito: o laudo manda
  assert.equal(etapaSaude({ clinicos: 1, laudo: null, receitaPendente: true }), "declarou");
  assert.equal(etapaSaude({ clinicos: 1, laudo: laudo("em_andamento"), receitaPendente: true }), "andamento");
});

test("saúde: só alimentar (nada clínico, sem laudo, sem receita) não entra no pipeline", () => {
  assert.equal(etapaSaude({ clinicos: 0, laudo: null }), null);
  assert.equal(etapaSaude({ clinicos: 0, laudo: null, receitaPendente: true, receitaEnviadaEm: "2026-11-01" }), null);
});

test("saúde: inscrição com alerta — qualquer \"Sim\" menos a vacina", () => {
  assert.equal(inscricaoTemAlertaSaude({ saude: { problema_saude: "Sim" } }), true);
  assert.equal(inscricaoTemAlertaSaude({ saude: { vacina_febre_amarela: "Sim", problema_saude: "Não" } }), false);
  assert.equal(inscricaoTemAlertaSaude(null), false);
  assert.equal(inscricaoTemAlertaSaude({}), false);
});

test("saúde: colunas na ordem do fluxo e quem embarca antes em cima (sem data por último)", () => {
  assert.deepEqual(ETAPAS_SAUDE.map((e) => e.id), ["inscricao", "declarou", "andamento", "receita", "liberado", "nao_apto"]);
  const p = montarPipeline([
    { etapa: "declarou", dias: 40, nome: "Bia", item: 1 },
    { etapa: "declarou", dias: null, nome: "Ana", item: 2 },
    { etapa: "declarou", dias: 10, nome: "Caio", item: 3 },
    { etapa: "declarou", dias: 10, nome: "Ana", item: 4 },
    { etapa: "liberado", dias: 5, nome: "Davi", item: 5 },
  ]);
  assert.deepEqual(p.declarou.map((c) => c.item), [4, 3, 1, 2]);
  assert.equal(p.liberado.length, 1);
  assert.equal(p.inscricao.length, 0);
});
