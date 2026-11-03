// Testes das regras puras da ficha do lead (src/components/sdr/leads/ficha/regras.ts).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/ficha-lead/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dataRelativa, diaDaCadencia, escolherProximoPasso, iniciaisDoNome, notaHumana, passaNoFiltro, passosDaVenda,
  quandoPorExtenso, tarefasDeHoje,
} from "../../src/components/sdr/leads/ficha/regras.ts";

// Datas locais: o teste não depende do fuso da máquina.
const AGORA = new Date(2026, 10, 3, 12, 0); // ter 03/11/2026 12:00
const em = (d: number, h = 9, m = 0) => new Date(2026, 10, d, h, m).toISOString();

test("iniciais: primeira + última, e '?' sem nome", () => {
  assert.equal(iniciaisDoNome("Helena Martins"), "HM");
  assert.equal(iniciaisDoNome("  ana  maria  souza "), "AS");
  assert.equal(iniciaisDoNome("Cher"), "C");
  assert.equal(iniciaisDoNome(null), "?");
});

test("dataRelativa fala como gente", () => {
  assert.equal(dataRelativa(em(5, 18, 30), AGORA), "daqui a 2 dias");
  assert.equal(dataRelativa(em(4, 8), AGORA), "amanhã");
  assert.equal(dataRelativa(em(2, 8), AGORA), "ontem");
  assert.equal(dataRelativa(em(3, 12, 20), AGORA), "hoje, daqui a 20 min");
  assert.equal(dataRelativa(em(3, 15), AGORA), "hoje, daqui a 3 h");
  assert.equal(dataRelativa(em(3, 10), AGORA), "hoje, há 2 h");
  assert.equal(dataRelativa(em(1), AGORA), "há 2 dias");
});

test("quandoPorExtenso", () => {
  assert.equal(quandoPorExtenso(em(5, 18, 30)), "Quinta, 05/11 às 18:30");
});

test("diaDaCadencia: dia 1 é o do início; não passa do último", () => {
  assert.deepEqual(diaDaCadencia(em(2, 8), 5, AGORA), { dia: 2, total: 5, acabou: false });
  assert.deepEqual(diaDaCadencia(em(3, 11), 5, AGORA), { dia: 1, total: 5, acabou: false });
  assert.deepEqual(diaDaCadencia(new Date(2026, 9, 1, 8).toISOString(), 5, AGORA), { dia: 5, total: 5, acabou: true });
  assert.equal(diaDaCadencia(null, 5, AGORA), null);
  assert.equal(diaDaCadencia(em(2), 0, AGORA), null);
});

test("tarefasDeHoje: abertas de hoje + atrasadas + concluídas hoje, por horário", () => {
  const t = (id: string, status: string, scheduled_at: string, completed_at: string | null = null) =>
    ({ id, channel_type: "ligacao", status, scheduled_at, completed_at });
  const lista = tarefasDeHoje([
    t("amanha", "pendente", em(4)),
    t("hoje-16", "pendente", em(3, 16)),
    t("atrasada", "pendente", em(1)),
    t("feita-hoje", "concluida", em(3, 9), em(3, 9, 10)),
    t("feita-ontem", "concluida", em(2, 9), em(2, 9, 10)),
    t("pulada", "ignorada", em(3, 10)),
  ], AGORA);
  assert.deepEqual(lista.map((x) => x.id), ["atrasada", "feita-hoje", "hoje-16"]);
  assert.equal(lista[0].atrasada, true);
  assert.equal(lista[2].atrasada, false);
});

test("próximo passo: closer prioriza a reunião; SDR pega o que vem primeiro", () => {
  const tarefas = [{ id: "t1", channel_type: "whatsapp", status: "pendente", scheduled_at: em(3, 14), completed_at: null }];
  const reunioes = [
    { id: "velha", status: "realizada", scheduled_at: em(1) },
    { id: "r1", status: "agendada", scheduled_at: em(5, 18, 30) },
  ];
  assert.equal(escolherProximoPasso("closer", tarefas, reunioes)?.tipo, "reuniao");
  const sdr = escolherProximoPasso("sdr", tarefas, reunioes);
  assert.equal(sdr?.tipo, "tarefa");
  assert.equal(escolherProximoPasso("sdr", [], reunioes)?.tipo, "reuniao");
  assert.equal(escolherProximoPasso("sdr", [], [reunioes[0]]), null);
});

test("filtro: Sistema também mostra tarefas concluídas", () => {
  assert.equal(passaNoFiltro("sistema", "tarefa"), true);
  assert.equal(passaNoFiltro("nota", "tarefa"), false);
  assert.equal(passaNoFiltro("tudo", "ligacao"), true);
});

test("passos da venda saem dos dados reais", () => {
  const p = passosDaVenda({ reuniaoRealizada: false, etapa: "em_negociacao", propostasAnexadas: 1, statusContrato: "enviado", statusPagamento: null });
  assert.deepEqual(p.map((x) => x.estado), ["feito", "feito", "andamento", "falta"]);
  const nada = passosDaVenda({ reuniaoRealizada: false, etapa: "aguardando_reuniao", propostasAnexadas: 0, statusContrato: null, statusPagamento: null });
  assert.deepEqual(nada.map((x) => x.estado), ["falta", "falta", "falta", "falta"]);
  const pago = passosDaVenda({ reuniaoRealizada: true, etapa: null, propostasAnexadas: 0, statusContrato: "assinado", statusPagamento: "pago" });
  assert.deepEqual(pago.map((x) => x.estado), ["feito", "falta", "feito", "feito"]);
});

test("nota humana ignora o eco das tentativas", () => {
  assert.equal(notaHumana({ body: "Ligação — Caixa postal" }), false);
  assert.equal(notaHumana({ body: "Quer ir com a mãe em março", tags: ["bitrix"] }), true);
  assert.equal(notaHumana({ body: "Lead do formulário", tags: ["origem"] }), false);
});
