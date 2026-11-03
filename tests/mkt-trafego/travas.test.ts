// Tráfego › Meta Ads: avaliação das travas (api/_mktTrafegoCalc.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../../api/_mktTrafegoCalc.js";

const regra = (o: Record<string, unknown>) => ({ id: "r", nome: "t", escopo: "periodo", alvo: null, gasto_minimo: 0, acao: "avisar", horas: null, ...o });

test("custo por reunião: dispara acima do limite, ok abaixo", () => {
  const r = regra({ metrica: "custo_reuniao", limite: 300 });
  assert.equal(C.avaliarRegra(r, { gasto: 1000, realizadas: 4 }).situacao, "ok");       // 250
  const a = C.avaliarRegra(r, { gasto: 1000, realizadas: 3 });                          // 333,33
  assert.equal(a.situacao, "disparou");
  assert.equal(a.valor, 333.33);
});

test("gasto mínimo antes de julgar: amostra pequena não dispara nem com zero reunião", () => {
  const r = regra({ metrica: "custo_reuniao", limite: 300, gasto_minimo: 1500 });
  assert.equal(C.avaliarRegra(r, { gasto: 900, realizadas: 0 }).situacao, "amostra_pequena");
  const a = C.avaliarRegra(r, { gasto: 1600, realizadas: 0 });
  assert.equal(a.situacao, "disparou"); // gastou o mínimo e nenhuma reunião
  assert.equal(a.infinito, true);
  assert.equal(a.valor, null);
});

test("sem dado (campanha sem UTM não tem agendamento) não dispara", () => {
  const r = regra({ escopo: "campanha", alvo: "1", metrica: "custo_agendamento", limite: 100 });
  assert.equal(C.avaliarRegra(r, { gasto: 5000, agendamentos: null }).situacao, "sem_dado");
  assert.equal(C.decidirAcao({ ...r, acao: "pausar" }, C.avaliarRegra(r, { gasto: 5000, agendamentos: null }), { pausaLigada: true }), "nada");
});

test("trava de verba: 80% avisa, 100% dispara", () => {
  const r = regra({ metrica: "verba_pct", limite: 100, acao: "pausar" });
  assert.equal(C.avaliarRegra(r, { gasto: 11000, verba: 15000 }).situacao, "ok");
  const quase = C.avaliarRegra(r, { gasto: 12000, verba: 15000 });
  assert.equal(quase.situacao, "alerta");
  assert.equal(C.decidirAcao(r, quase, { pausaLigada: true }), "avisar");
  const estourou = C.avaliarRegra(r, { gasto: 15000, verba: 15000 });
  assert.equal(estourou.situacao, "disparou");
  assert.equal(C.decidirAcao(r, estourou, { pausaLigada: true }), "pausar");
  assert.equal(C.avaliarRegra(r, { gasto: 100, verba: null }).situacao, "sem_dado");
});

test("pausa só com a regra em 'pausar' E a chave geral ligada; senão 'pausaria' (simulação)", () => {
  const av = { situacao: "disparou" } as ReturnType<typeof C.avaliarRegra>;
  assert.equal(C.decidirAcao(regra({ acao: "avisar" }), av, { pausaLigada: true }), "avisar");
  assert.equal(C.decidirAcao(regra({ acao: "pausar" }), av, { pausaLigada: false }), "pausaria");
  assert.equal(C.decidirAcao(regra({ acao: "pausar" }), av, { pausaLigada: true }), "pausar");
  assert.equal(C.decidirAcao(regra({ acao: "pausar" }), { situacao: "ok" } as never, { pausaLigada: true }), "nada");
});

test("chave geral MKT_TRAFEGO_PAUSA_LIGADA: só valores explícitos ligam", () => {
  assert.equal(C.pausaLigada({}), false);
  assert.equal(C.pausaLigada({ MKT_TRAFEGO_PAUSA_LIGADA: "0" }), false);
  assert.equal(C.pausaLigada({ MKT_TRAFEGO_PAUSA_LIGADA: "talvez" }), false);
  assert.equal(C.pausaLigada({ MKT_TRAFEGO_PAUSA_LIGADA: "1" }), true);
  assert.equal(C.pausaLigada({ MKT_TRAFEGO_PAUSA_LIGADA: " true " }), true);
});

test("gasto do dia e do período comparam com o limite em reais", () => {
  assert.equal(C.avaliarRegra(regra({ metrica: "gasto_dia", limite: 1200 }), { gastoHoje: 1250 }).situacao, "disparou");
  assert.equal(C.avaliarRegra(regra({ metrica: "gasto_periodo", limite: 15000 }), { gasto: 14999 }).situacao, "ok");
});

test("'gastou R$ X sem nenhum lead em N horas' pela fotografia acumulada", () => {
  const agora = Date.parse("2026-11-03T18:00:00Z");
  const h = (n: number) => new Date(agora - n * 3_600_000).toISOString();
  const atual = new Map([["1", { gasto_acum: 1300, leads_acum: 40 }], ["2", { gasto_acum: 200, leads_acum: 5 }]]);
  const leituras = new Map([
    ["1", [{ lido_em: h(7), gasto_acum: 900, leads_acum: 40 }, { lido_em: h(5), gasto_acum: 1000, leads_acum: 40 }, { lido_em: h(1), gasto_acum: 1250, leads_acum: 40 }]],
  ]);
  // campanha 2 sem fotografia = não gastou nos últimos dias: fica de fora
  const j = C.janelaDeGasto(atual, leituras, ["1", "2"], 6, agora);
  assert.deepEqual(j, { gasto: 400, leads: 0 });
  const r = regra({ metrica: "sem_lead", limite: 300, horas: 6 });
  assert.equal(C.avaliarRegra(r, { gastoJanela: j.gasto, leadsJanela: j.leads }).situacao, "disparou");
  assert.equal(C.avaliarRegra(r, { gastoJanela: 400, leadsJanela: 1 }).situacao, "ok");
  // QS ligou há 3 h: ainda não dá pra medir 6 h
  const novo = new Map([["1", [{ lido_em: h(3), gasto_acum: 1000, leads_acum: 40 }]]]);
  assert.deepEqual(C.janelaDeGasto(atual, novo, ["1"], 6, agora), { gasto: null, leads: null });
  assert.equal(C.avaliarRegra(r, { gastoJanela: null, leadsJanela: null }).situacao, "sem_dado");
});

test("escopo da trava: período = todas, destino = as do destino, campanha = ela", () => {
  const camp = [{ id: "1", destino: "japao" }, { id: "2", destino: "china" }, { id: "3", destino: null }];
  assert.equal(C.campanhasDoEscopo(regra({}), camp).length, 3);
  assert.deepEqual(C.campanhasDoEscopo(regra({ escopo: "destino", alvo: "japao" }), camp).map((c) => c.id), ["1"]);
  assert.deepEqual(C.campanhasDoEscopo(regra({ escopo: "campanha", alvo: "2" }), camp).map((c) => c.id), ["2"]);
});

test("alertas da leitura: orçamento que subiu por fora e campanha nova fora do plano", () => {
  const antes = [{ id: "1", nome: "A", daily_budget: 200 }];
  const depois = [
    { id: "1", nome: "A", daily_budget: 350, effective_status: "ACTIVE" },
    { id: "9", nome: "Nova China", daily_budget: 100, effective_status: "ACTIVE", destino: "china" },
  ];
  const periodo = { cotas: [{ tipo: "destino", alvo: "japao", valor: 5000 }] };
  const m = C.mudancasDaLeitura({ antes, depois, conjAntes: [{ id: "j", nome: "J", campanha_id: "1", daily_budget: 50 }], conjDepois: [{ id: "j", nome: "J", campanha_id: "1", daily_budget: 40 }], periodo });
  assert.deepEqual(m, [
    { tipo: "orcamento_subiu", nivel: "campanha", id: "1", nome: "A", de: 200, para: 350 },
    { tipo: "campanha_nova", id: "9", nome: "Nova China", foraDoPlano: true },
  ]);
  // primeira leitura da vida (sem nada antes) não grita "campanha nova" pra tudo
  assert.deepEqual(C.mudancasDaLeitura({ antes: [], depois }), []);
});
