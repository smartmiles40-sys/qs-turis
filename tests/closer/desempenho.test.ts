// Desempenho do closer (src/closer/desempenho.ts): a conta, sem rede.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularDesempenho, datasDoPreset, intervaloIso } from "../../src/closer/desempenho.ts";

const CLOSERS = [{ id: "a", nome: "Ana" }, { id: "b", nome: "Beto" }];
const reuniao = (closer_id: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ closer_id, status, tipo: "primeira", sal: null, venda_valor: null, venda_tipo: null, ...extra });
const negocio = (id: string, closer_id: string, extra: Record<string, unknown> = {}) =>
  ({ id, closer_id, pre_venda_em: "2026-11-02T12:00:00Z", pre_venda_valor: 10000, consolidada_em: null, valor_previsto: null, ficha: null, ...extra });

test("R.R., no-show, SAL e conversão por closer", () => {
  const { porCloser, time } = calcularDesempenho({
    reunioes: [
      reuniao("a", "realizada", { sal: "aceito", venda_valor: 30000, venda_tipo: "69" }),
      reuniao("a", "realizada", { sal: "recusado" }),
      reuniao("a", "realizada", { tipo: "retomada" }),           // retomada não entra no SAL
      reuniao("a", "no_show", { venda_valor: 36000 }),            // no-show com valor NÃO vira venda
      reuniao("a", "realizada", { venda_tipo: "71" }),            // aéreo não conta como reunião
      reuniao("b", "realizada"),
    ],
    negocios: [negocio("n1", "a"), negocio("n2", "a", { ficha: { valor_total: 20000 } })],
    // 0295: "propostas" = vendas com proposta anexada (n1 tem 2 anexos = 1 venda; o de n9 não é venda contada)
    anexos: [{ negocio_id: "n1" }, { negocio_id: "n1" }, { negocio_id: "n9" }, { negocio_id: null }],
  }, CLOSERS);
  const a = porCloser.find((l) => l.id === "a")!;
  assert.equal(a.realizadas, 3);
  assert.equal(a.noShow, 1);
  assert.equal(a.taxaNoShow, 0.25);
  assert.equal(a.primeiras, 2);
  assert.equal(a.sal, 1);
  assert.equal(a.taxaSal, 0.5);
  assert.equal(a.vendas, 2);
  assert.equal(a.faturamento, 30000);
  assert.equal(a.ticket, 15000);
  assert.equal(a.conversao, 2 / 3);
  assert.equal(a.propostas, 1);
  assert.equal(a.emNegociacao, 30000);
  const b = porCloser.find((l) => l.id === "b")!;
  assert.equal(b.salSemResposta, 1);
  assert.equal(b.propostas, 0);
  assert.equal(b.conversao, 0);
  assert.equal(time.realizadas, 4);
  assert.equal(time.vendas, 2);
  assert.equal(time.propostas, 1); // só vendas contadas com anexo
});

test("venda de aéreo, perdida ou repetida não conta", () => {
  const { time } = calcularDesempenho({
    reunioes: [],
    negocios: [
      negocio("n1", "a", { pre_venda_tipo_bitrix: "71" }),
      negocio("n2", "a", { ficha: { servico: "aereo", valor_total: 5000 } }),
      negocio("n3", "a", { etapa: "perdido" }),
      negocio("n4", "b"), negocio("n4", "b"),
    ],
    anexos: [{ negocio_id: "n1" }, { negocio_id: "n4" }],
  }, CLOSERS);
  assert.equal(time.vendas, 1);
  assert.equal(time.faturamento, 10000);
  assert.equal(time.propostas, 1, "anexo de venda de aéreo não conta; repetida conta uma vez");
});

test("sem reunião: taxas ficam vazias, não zero", () => {
  const { time } = calcularDesempenho({ reunioes: [], negocios: [], anexos: [] }, CLOSERS);
  assert.equal(time.taxaNoShow, null);
  assert.equal(time.conversao, null);
  assert.equal(time.ticket, null);
});

test("períodos em São Paulo", () => {
  assert.deepEqual(datasDoPreset("mes", "2026-11-03"), { de: "2026-11-01", ate: "2026-11-03" });
  assert.deepEqual(datasDoPreset("mes_passado", "2026-11-03"), { de: "2026-10-01", ate: "2026-10-31" });
  assert.deepEqual(datasDoPreset("mes_passado", "2026-01-15"), { de: "2025-12-01", ate: "2025-12-31" });
  assert.deepEqual(datasDoPreset("7d", "2026-11-03"), { de: "2026-10-28", ate: "2026-11-03" });
  assert.deepEqual(intervaloIso("2026-10-01", "2026-10-31"), { deIso: "2026-10-01T00:00:00-03:00", ateIso: "2026-11-01T00:00:00-03:00" });
});
