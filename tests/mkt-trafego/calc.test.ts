// Tráfego › Meta Ads: as contas puras (api/_mktTrafegoCalc.js). Sem rede, sem banco.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../../api/_mktTrafegoCalc.js";

// 03/11/2026 15:00 em São Paulo
const AGORA = Date.parse("2026-11-03T18:00:00Z");
const PERIODO = { inicio: "2026-11-01", fim: "2026-11-15", valor: 15000 };

test("datas em São Paulo: 23h de SP ainda é o mesmo dia; dias contados com os dois extremos", () => {
  assert.equal(C.diaSP(Date.parse("2026-11-04T02:30:00Z")), "2026-11-03");
  assert.equal(C.diaSP(Date.parse("2026-11-04T03:00:00Z")), "2026-11-04");
  assert.equal(C.diasEntre("2026-11-01", "2026-11-15"), 15);
  assert.equal(C.diasEntre("2026-11-15", "2026-11-01"), 0);
  assert.equal(C.somarDias("2026-10-31", 1), "2026-11-01");
});

test("verba: ritmo ideal, saldo, diária segura e projeção pelo ritmo dos dias completos", () => {
  const v = C.calcularVerba({ ...PERIODO, gasto: 3000, gastoHoje: 600, orcamentoDiario: 0, agora: AGORA });
  assert.equal(v.diasTotais, 15);
  assert.equal(v.pctTempo, 17.5);            // 2 dias e 15 h de 15 dias
  assert.equal(v.pctVerba, 20);
  assert.equal(v.ritmoIdeal, 2625);
  assert.equal(v.acimaDoRitmo, 375);
  assert.equal(v.saldo, 12000);
  assert.equal(v.diasRestantes, 13);         // hoje (03) até 15, contando hoje
  assert.equal(v.diariaSegura, 923.08);      // 12.000 ÷ 13
  assert.equal(v.mediaDiaria, 1200);         // (3.000 − 600 de hoje) ÷ 2 dias completos
  assert.equal(v.projecao, 18000);           // 3.000 + resto de hoje 600 + 1.200 × 12
  assert.equal(v.sobraOuFaltaNaProjecao, -3000);
  assert.equal(v.acabaNoDia, "2026-11-13");
});

test("orçamento programado: diz quanto e em que dia estoura", () => {
  const v = C.calcularVerba({ ...PERIODO, gasto: 3000, gastoHoje: 600, orcamentoDiario: 1100, agora: AGORA });
  assert.equal(v.programado, 13700);         // (1.100 − 600) hoje + 1.100 × 12
  assert.equal(v.estouroProgramado, 1700);
  assert.equal(v.estouraNoDia, "2026-11-14");
  const ok = C.calcularVerba({ ...PERIODO, gasto: 3000, gastoHoje: 600, orcamentoDiario: 900, agora: AGORA });
  assert.equal(ok.estouroProgramado, 0);
  assert.equal(ok.estouraNoDia, null);
});

test("verba: no primeiro dia usa a fração do dia; período acabado não projeta nada novo", () => {
  const cedo = C.calcularVerba({ ...PERIODO, gasto: 250, gastoHoje: 250, agora: Date.parse("2026-11-01T15:00:00Z") }); // 12h de SP
  assert.equal(cedo.mediaDiaria, 500);
  const fim = C.calcularVerba({ ...PERIODO, gasto: 14000, gastoHoje: 0, orcamentoDiario: 1000, agora: Date.parse("2026-11-20T15:00:00Z") });
  assert.equal(fim.diasRestantes, 0);
  assert.equal(fim.diariaSegura, 0);
  assert.equal(fim.projecao, 14000);
  assert.equal(fim.programado, 0);
  assert.equal(fim.pctTempo, 100);
});

test("orçamento diário ativo: CBO pela campanha, ABO pelos conjuntos ativos, vitalício à parte", () => {
  const camp = [
    { id: "1", effective_status: "ACTIVE", daily_budget: 300 },
    { id: "2", effective_status: "ACTIVE", daily_budget: null },
    { id: "3", effective_status: "PAUSED", daily_budget: 999 },
    { id: "4", effective_status: "ACTIVE", lifetime_budget: 5000 },
  ];
  const conj = [
    { id: "a", campanha_id: "2", effective_status: "ACTIVE", daily_budget: 100 },
    { id: "b", campanha_id: "2", effective_status: "PAUSED", daily_budget: 400 },
    { id: "c", campanha_id: "2", effective_status: "ACTIVE", daily_budget: 50 },
  ];
  const o = C.orcamentoDiarioAtivo(camp, conj);
  assert.equal(o.diario, 450);
  assert.equal(o.vitalicias, 1);
  assert.equal(o.porCampanha.get("2"), 150);
  assert.equal(C.orcamentoDiarioAtivo(camp, conj, (c) => c.id === "1").diario, 300);
});

test("destino pelo nome: emoji, caixa, live, Costa Amalfitana = Itália, JAPÃO+CHINA = os dois", () => {
  const k = C.destinosConhecidos([]);
  const d = (n: string) => C.classificarCampanha(n, k);
  assert.deepEqual(d("[STFV] [Tailândia] | CBO - Teste de Público"), { destino: "tailandia", tipo: "trafego" });
  assert.deepEqual(d("[STFV] [LIVE] [INSCRIÇÃO] CBO Estático - Tailândia 🇹🇭 Outubro"), { destino: "tailandia", tipo: "live" });
  assert.deepEqual(d("[STFV] [LIVE 3] [INSCRIÇÃO] CBO Vídeo - Costa Amalfitana LP | 08-10"), { destino: "italia", tipo: "live" });
  assert.deepEqual(d("[STFV] [JAPÃO+CHINA] [AQUISI] | ABO | Teste Público | Out26"), { destino: "china+japao", tipo: "trafego" });
  assert.deepEqual(d("STFV [LEADS] [LEARNING] Expedição Turquia e Grécia 🇹🇷"), { destino: "turquia e grecia", tipo: "trafego" });
  assert.equal(d("[STFV] [sem vídeo] | ABO |").destino, null);
  assert.equal(d("[R] [C1] Post do Instagram: Onde é que eu tô? 👀").destino, null);
  // "Pacote Japão" não conta também como Expedição Japão
  assert.equal(d("[STFV] [Pacote Japão] | ABO").destino, "pacote japao");
});

test("destino da Fonte do lead: '[Japão e China] - Live' casa com a campanha JAPÃO+CHINA; destino novo entra sozinho", () => {
  assert.deepEqual(C.lerSegmento("[Tailândia] - Tráfego"), { bruto: "Tailândia", canal: "trafego" });
  assert.deepEqual(C.lerSegmento("[China] - Google Ads"), { bruto: "China", canal: "google" });
  assert.equal(C.lerSegmento("WhatsApp - Agencia Se tu for, eu vou").bruto, null);
  const k = C.destinosConhecidos(["[Confins da Patagônia] - Orgânico", "[Japão e China] - Live"]);
  assert.ok(k.some((x) => x.chave === "confins da patagonia"));
  assert.equal(C.chaveDe(C.extrairDestinos("Japão e China", k)), "china+japao");
  assert.equal(C.rotuloDe("china+japao", k), "China + Japão");
});

test("utm_campaign → campanha: igual normalizado, renomeada com sufixo (prefixo ≥ 12), id cru; nunca chuta", () => {
  const camp = [
    { id: "120001", nome: "[STFV] [Tailândia] | CBO - Teste de Público Diversos" },
    { id: "120002", nome: "🇯🇵 [STFV]  [Japão] | ABO - Teste Público" },
  ];
  assert.equal(C.acharCampanhaDaUtm("[STFV] [Japão] | ABO - Teste Público", camp), "120002");
  assert.equal(C.acharCampanhaDaUtm("[STFV] [Tailândia] | CBO - Teste de Público", camp), "120001");
  assert.equal(C.acharCampanhaDaUtm("120001", camp), "120001");
  assert.equal(C.acharCampanhaDaUtm("STFV", camp), null);
  assert.equal(C.acharCampanhaDaUtm("", camp), null);
});

test("funil por destino e canal, safra do lead; o que não casa aparece separado", () => {
  const k = C.destinosConhecidos([]);
  const camp = [
    { id: "1", nome: "[STFV] [Tailândia] | CBO", gasto: 1000, leadsMeta: 40, ...C.classificarCampanha("[STFV] [Tailândia] | CBO", k) },
    { id: "2", nome: "[STFV] [LIVE] [INSCRIÇÃO] - Tailândia", gasto: 500, leadsMeta: 100, ...C.classificarCampanha("[STFV] [LIVE] [INSCRIÇÃO] - Tailândia", k) },
    { id: "3", nome: "[STFV] [sem vídeo] | ABO |", gasto: 500, leadsMeta: 10, ...C.classificarCampanha("[STFV] [sem vídeo] | ABO |", k) },
  ];
  const qs = [
    { segment: "[Tailândia] - Tráfego", utm_campaign: null, leads: 50, agendamentos: 10, realizadas: 5, vendas: 2, faturamento: 40000 },
    { segment: "[Tailândia] - Live", utm_campaign: null, leads: 80, agendamentos: 4, realizadas: 2, vendas: 0, faturamento: 0 },
    { segment: "[Tailândia] - Orgânico", utm_campaign: null, leads: 30, agendamentos: 9, realizadas: 9, vendas: 3, faturamento: 90000 },
    { segment: "[Egito] - Tráfego", utm_campaign: null, leads: 7, agendamentos: 0, realizadas: 0, vendas: 0, faturamento: 0 },
  ];
  const f = C.montarFunil(camp, qs, k);
  const trafego = f.porDestino.find((g) => g.chave === "tailandia|trafego")!;
  assert.equal(trafego.gasto, 1000);
  assert.equal(trafego.leads, 50);
  assert.equal(trafego.cpl, 20);
  assert.equal(trafego.custoAgendamento, 100);
  assert.equal(trafego.custoReuniao, 200);
  assert.equal(trafego.cac, 500);
  assert.equal(trafego.roas, 40);
  const live = f.porDestino.find((g) => g.chave === "tailandia|live")!;
  assert.equal(live.cac, null); // gastou e não vendeu: "nenhum ainda" (a tela mostra assim)
  // orgânico não entra no funil pago
  assert.equal(f.total.leads, 137);
  assert.equal(f.total.gasto, 2000);
  assert.equal(f.semCasar.gastoSemDestino, 500);
  assert.equal(f.semCasar.pctGastoCasado, 75);
  assert.deepEqual(f.semCasar.campanhasSemDestino.map((c) => c.id), ["3"]);
  assert.deepEqual(f.semCasar.leadsSemCampanha, [{ rotulo: "Egito · Tráfego", leads: 7 }]);
});

test("funil: campanha marcada 'vários destinos' rateia o gasto pelos leads do mesmo canal", () => {
  const k = C.destinosConhecidos([]);
  const camp = [
    { id: "1", nome: "[STFV] [Japão] | ABO", gasto: 1000, leadsMeta: 0, destino: "japao", tipo: "trafego" },
    { id: "3", nome: "[STFV] [sem vídeo] | ABO |", gasto: 900, leadsMeta: 0, destino: C.RATEIO, tipo: "trafego" },
  ];
  const qs = [
    { segment: "[Japão] - Tráfego", utm_campaign: null, leads: 20, agendamentos: 0, realizadas: 0, vendas: 0, faturamento: 0 },
    { segment: "[China] - Tráfego", utm_campaign: null, leads: 10, agendamentos: 0, realizadas: 0, vendas: 0, faturamento: 0 },
  ];
  const f = C.montarFunil(camp, qs, k);
  const jp = f.porDestino.find((g) => g.chave === "japao|trafego")!;
  const cn = f.porDestino.find((g) => g.chave === "china|trafego")!;
  assert.equal(jp.gasto, 1600);
  assert.equal(jp.gastoRateado, 600);
  assert.equal(cn.gasto, 300);
  assert.equal(f.semCasar.gastoSemDestino, 0);
  assert.equal(f.semCasar.gastoRateado, 900);
  assert.deepEqual(f.semCasar.leadsSemCampanha, []);
});

test("funil por campanha usa o utm_campaign quando o lead trouxe", () => {
  const camp = [{ id: "120002", nome: "[STFV] [Japão] | ABO - Teste Público", gasto: 600, leadsMeta: 30, destino: "japao", tipo: "trafego" }];
  const qs = [{ segment: "[Japão] - Tráfego", utm_campaign: "[STFV] [Japão] | ABO - Teste Público", leads: 12, agendamentos: 3, realizadas: 2, vendas: 1, faturamento: 30000 }];
  const f = C.montarFunil(camp, qs, C.DESTINOS_BASE);
  const c = f.porCampanha[0];
  assert.equal(c.cplMeta, 20);
  assert.equal(c.qs!.leads, 12);
  assert.equal(c.qs!.custoReuniao, 300);
  assert.equal(f.semCasar.leadsComUtm, 12);
});
