// Testes do checklist padrão editável (30/10): prazo relativo, responsável, árvore do modelo e filtros da aba.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arvoreDoModelo, filtrarChecklist, moverNaLista, prazoNaExpedicao, rotuloPrazo, textoResponsavel, type ModeloTarefa,
} from "../../src/expedicoes/lib/checklist/modelo.ts";

const m = (o: Partial<ModeloTarefa>): ModeloTarefa => ({
  id: "x", chave: null, parent_id: null, titulo: "T", descricao: null, etapa: "6 a 2 meses", setor: "operacional",
  responsavel_usuario_id: null, responsavel_papel: null, prazo_dias: 30, prazo_referencia: "embarque", prioridade: "Média",
  ordem: 1, ativo: true, tipo_produto: "expedicao", criado_por: null, criado_em: null, atualizado_por: null, atualizado_em: null, ...o,
});

test("prazo relativo: rótulo e data (mesma conta do banco)", () => {
  assert.equal(rotuloPrazo(30), "D-30 do embarque");
  assert.equal(rotuloPrazo(-7, "retorno"), "D+7 do retorno");
  assert.equal(rotuloPrazo(0), "no dia do embarque");
  assert.equal(rotuloPrazo(null, "embarque", true), "mesmo prazo do processo");
  const exp = { data_embarque: "2027-03-10", data_retorno: "2027-03-20" };
  assert.equal(prazoNaExpedicao(m({ prazo_dias: 30 }), exp), "2027-02-08");
  assert.equal(prazoNaExpedicao(m({ prazo_dias: -7, prazo_referencia: "retorno" }), exp), "2027-03-27");
  assert.equal(prazoNaExpedicao(m({ prazo_dias: 30 }), { data_embarque: null, data_retorno: null }), null);
});

test("para quem é: pessoa, papel ou só o setor", () => {
  const nomes = new Map([["u1", "Larissa Souza"]]);
  assert.equal(textoResponsavel(m({ responsavel_usuario_id: "u1" }), nomes), "Larissa Souza");
  assert.equal(textoResponsavel(m({ responsavel_papel: "resp_operacional" }), nomes), "Responsável operacional da expedição");
  assert.equal(textoResponsavel(m({ setor: "financeiro" }), nomes), "Financeiro (sem pessoa fixa)");
});

test("árvore do modelo: fase na ordem do enum, depois ordem; passos dentro do processo", () => {
  const a = arvoreDoModelo([
    m({ id: "b", etapa: "Na semana", ordem: 1 }),
    m({ id: "a2", etapa: "Após o fechamento", ordem: 2 }),
    m({ id: "a1", etapa: "Após o fechamento", ordem: 1 }),
    m({ id: "s2", parent_id: "a1", ordem: 2 }), m({ id: "s1", parent_id: "a1", ordem: 1 }),
  ]);
  assert.deepEqual(a.map((x) => x.processo.id), ["a1", "a2", "b"]);
  assert.deepEqual(a[0].subs.map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(moverNaLista(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.equal(moverNaLista(["a", "b"], "a", -1), null);
});

test("filtros da aba: minhas, atrasadas e setor mantêm o processo como contexto", () => {
  const hoje = "2026-10-30";
  const itens = [
    { id: "p1", parent_id: null, status: "Pendente", prazo: "2026-11-30", responsavel_id: "eu", setor: "operacional" },
    { id: "s1", parent_id: "p1", status: "Pendente", prazo: "2026-10-01", responsavel_id: "outro", setor: null },
    { id: "s2", parent_id: "p1", status: "Concluído", prazo: "2026-10-01", responsavel_id: "eu", setor: null },
    { id: "p2", parent_id: null, status: "Pendente", prazo: "2026-12-01", responsavel_id: "outro", setor: "financeiro" },
    { id: "s3", parent_id: "p2", status: "Pendente", prazo: null, responsavel_id: "eu", setor: null },
  ];
  const ids = (q: Parameters<typeof filtrarChecklist>[1]) => filtrarChecklist(itens, q).map((i) => i.id);
  assert.deepEqual(ids({ quem: "todas", eu: "eu", setor: "", hoje }), ["p1", "s1", "s2", "p2", "s3"]);
  assert.deepEqual(ids({ quem: "minhas", eu: "eu", setor: "", hoje }), ["p1", "s2", "p2", "s3"]);
  assert.deepEqual(ids({ quem: "atrasadas", eu: "eu", setor: "", hoje }), ["p1", "s1"]);
  // subtarefa sem setor herda o do processo
  assert.deepEqual(ids({ quem: "todas", eu: "eu", setor: "financeiro", hoje }), ["p2", "s3"]);
  assert.deepEqual(ids({ quem: "minhas", eu: null, setor: "", hoje }), []);
});
