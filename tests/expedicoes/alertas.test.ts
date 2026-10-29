// Testes das regras do "Precisa de atenção" (spec §2.2). Rodar: ver docs/MAPA-EXPEDICOES.md › Testes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alertasDasExpedicoes, alertasPorExpedicao, contarAlertasAcionaveis, type DadosAlertaExp,
} from "../../src/expedicoes/lib/alertas/expedicoes.ts";

const HOJE = "2026-10-29";
let n = 0;
const exp = (p: Partial<DadosAlertaExp>): DadosAlertaExp => ({
  id: `e${++n}`, nome: "Teste", data_embarque: "2027-12-01", data_retorno: "2027-12-10",
  pax_confirmados: 20, pax_planejados: 20, prontidao_aptos: 20, prontidao_total: 20, ...p,
});

test("embarque com aptos < 50% é Crítico e leva pra Passageiros", () => {
  const a = alertasDasExpedicoes([exp({ nome: "Egito", data_embarque: "2026-11-13", data_retorno: "2026-11-28", prontidao_aptos: 9, prontidao_total: 20 })], HOJE);
  assert.equal(a.length, 1);
  assert.equal(a[0].regra, "embarque_aptos");
  assert.equal(a[0].severidade, "critico");
  assert.equal(a[0].aba, "passageiros");
  assert.equal(a[0].titulo, "Egito embarca em 15 dias com 9 de 20 passageiros aptos");
});

test("embarque com 50% ou mais de aptos não alerta", () => {
  assert.equal(alertasDasExpedicoes([exp({ data_embarque: "2026-11-13", data_retorno: "2026-11-28", prontidao_aptos: 10, prontidao_total: 20 })], HOJE).length, 0);
});

test("irmãs G1 e G2 com a mesma saída viram UM alerta somado", () => {
  const a = alertasDasExpedicoes([
    exp({ nome: "Tailândia G2", data_embarque: "2026-11-13", data_retorno: "2026-11-28", prontidao_aptos: 0, prontidao_total: 22 }),
    exp({ nome: "Tailândia G1", data_embarque: "2026-11-13", data_retorno: "2026-11-28", prontidao_aptos: 0, prontidao_total: 22 }),
    exp({ nome: "Tailândia G3", data_embarque: "2026-11-17", data_retorno: "2026-12-02", prontidao_aptos: 0, prontidao_total: 22 }),
  ], HOJE);
  assert.equal(a.length, 2);
  assert.equal(a[0].titulo, "Tailândia G1 e G2 embarcam em 15 dias com 0 de 44 passageiros aptos");
  assert.equal(a[0].expedicaoIds.length, 2);
  assert.equal(a[1].titulo, "Tailândia G3 embarca em 19 dias com 0 de 22 passageiros aptos");
});

test("irmãs pelo viagem_grupo, mesmo com nomes diferentes", () => {
  const a = alertasDasExpedicoes([
    exp({ nome: "Japão & China - 2026 — G1", viagem_grupo: "jc", data_embarque: "2026-10-26", data_retorno: "2026-11-12", pax_sem_valor: 25 }),
    exp({ nome: "Japão e China (Out) G2", viagem_grupo: "jc", data_embarque: "2026-10-26", data_retorno: "2026-11-12", pax_sem_valor: 24 }),
  ], HOJE);
  assert.equal(a.length, 1);
  assert.equal(a[0].regra, "sem_valor");
  assert.match(a[0].titulo, /G1 e G2 em viagem com 49 passageiros sem valor lançado$/);
  assert.equal(a[0].aba, "valores");
});

test("preparação: aptos < 20% faltando menos de 60 dias é Atenção; com 60+ dias não", () => {
  const perto = exp({ data_embarque: "2026-12-20", data_retorno: "2027-01-02", prontidao_aptos: 3, prontidao_total: 20 }); // 52 dias
  const longe = exp({ data_embarque: "2027-01-10", data_retorno: "2027-01-20", prontidao_aptos: 0, prontidao_total: 20 }); // 73 dias
  const a = alertasDasExpedicoes([perto, longe], HOJE);
  assert.equal(a.length, 1);
  assert.equal(a[0].regra, "preparacao_aptos");
  assert.equal(a[0].severidade, "atencao");
});

test("seguro sem apólice só em viagem ou embarque", () => {
  const a = alertasDasExpedicoes([
    exp({ data_embarque: "2026-10-26", data_retorno: "2026-11-12", seguro_sem_apolice: 25 }),
    exp({ data_embarque: "2027-01-10", data_retorno: "2027-01-20", seguro_sem_apolice: 25 }), // preparação
  ], HOJE);
  assert.deepEqual(a.map((x) => x.regra), ["seguro_sem_apolice"]);
  assert.match(a[0].titulo, /25 apólices de seguro não anexadas/);
});

test("vendendo com ocupação < 30% e menos de 365 dias é Info (não conta no selo)", () => {
  const a = alertasDasExpedicoes([
    exp({ nome: "China", data_embarque: "2027-10-09", data_retorno: "2027-10-24", pax_confirmados: 5, pax_planejados: 20 }),
    exp({ nome: "Longe", data_embarque: "2027-11-20", data_retorno: "2027-11-30", pax_confirmados: 1, pax_planejados: 20 }), // 387 dias
  ], HOJE);
  assert.equal(a.length, 1);
  assert.equal(a[0].severidade, "info");
  assert.equal(a[0].titulo, "China com 5 de 20 vagas vendidas");
  assert.equal(contarAlertasAcionaveis(a), 0);
});

test("ações do roteiro: crítica nos próximos 3 dias e dia passado sem baixa", () => {
  const e = exp({
    nome: "Japão G1", data_embarque: "2026-10-26", data_retorno: "2026-11-12",
    acoes_roteiro: [
      { dia: 6, data: "2026-10-31", titulo: "Troca de líderes", severidade: "critico", baixada: false },
      { dia: 9, data: "2026-11-03", titulo: "Longe ainda", severidade: "critico", baixada: false }, // 5 dias
      { dia: 2, data: "2026-10-27", titulo: "Transfer", severidade: "atencao", baixada: false },
      { dia: 1, data: "2026-10-26", titulo: "Já resolvida", severidade: "critico", baixada: true },
      { dia: 3, data: "2026-10-28", titulo: "Sem campo de baixa", severidade: "critico", baixada: null },
    ],
  });
  const a = alertasDasExpedicoes([e], HOJE);
  assert.deepEqual(a.map((x) => x.regra).sort(), ["acao_critica", "acao_sem_baixa"]);
  const critica = a.find((x) => x.regra === "acao_critica")!;
  assert.equal(critica.titulo, "Japão G1 · Troca de líderes no Dia 6 (31/10)");
  assert.equal(critica.aba, "roteiro-lider");
});

test("dado ausente não dispara regra; cancelada não alerta", () => {
  const a = alertasDasExpedicoes([
    exp({ data_embarque: "2026-10-26", data_retorno: "2026-11-12", pax_sem_valor: null, seguro_sem_apolice: undefined }),
    exp({ status: "Cancelada", data_embarque: "2026-11-13", data_retorno: "2026-11-28", prontidao_aptos: 0, prontidao_total: 20 }),
  ], HOJE);
  assert.equal(a.length, 0);
});

test("em viagem a prontidão não gera alerta (spec §4.2)", () => {
  assert.equal(alertasDasExpedicoes([exp({ data_embarque: "2026-10-26", data_retorno: "2026-11-12", prontidao_aptos: 0, prontidao_total: 25 })], HOJE).length, 0);
});

test("ordem: severidade, depois data; contagem por expedição ignora Info", () => {
  const a1 = exp({ data_embarque: "2026-11-20", data_retorno: "2026-11-30", prontidao_aptos: 0, prontidao_total: 10 }); // crítico, 22 dias
  const a2 = exp({ data_embarque: "2026-11-05", data_retorno: "2026-11-15", prontidao_aptos: 0, prontidao_total: 10, pax_sem_valor: 3 }); // crítico 7 dias + atenção
  const a3 = exp({ data_embarque: "2027-06-01", data_retorno: "2027-06-10", pax_confirmados: 1, pax_planejados: 20 }); // info
  const a = alertasDasExpedicoes([a3, a1, a2], HOJE);
  assert.deepEqual(a.map((x) => [x.severidade, x.expedicaoId]), [["critico", a2.id], ["critico", a1.id], ["atencao", a2.id], ["info", a3.id]]);
  const porExp = alertasPorExpedicao(a);
  assert.equal(porExp.get(a2.id), 2);
  assert.equal(porExp.get(a1.id), 1);
  assert.equal(porExp.get(a3.id), undefined);
});
