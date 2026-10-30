// Regras puras das telas de Grupos (src/mkt/grupos/datas.ts) — datas em Brasília,
// calendário de várias datas, cadência, recorrência e as campanhas migradas do SendFlow.
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/mkt-grupos/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isoDeSP, partesSP, somarDias, diaPorExtenso, relativo, sugerirData, feriadosBR, proximosFeriados,
  normalizarDatas, campanhasDasDatas, problemasDasDatas, estimarDuracao, formatarDuracao,
  descreverRecorrencia, proximasOcorrencias, veioDoSendFlow, avisoPausadaDeProposito,
  abaDoStatus, acoesDaCampanha, passoEditavel, problemasDaCampanha, quandoSP,
} from "../../src/mkt/grupos/datas.ts";

const AGORA = Date.parse("2026-10-30T15:00:00.000Z"); // 30/10/2026 12:00 em Brasília (sexta)

test("Brasília: 19:30 de SP = 22:30 UTC, e volta igual", () => {
  assert.equal(isoDeSP("2026-11-02", "19:30"), "2026-11-02T22:30:00.000Z");
  assert.deepEqual(partesSP("2026-11-02T22:30:00.000Z"), { data: "2026-11-02", hora: "19:30", dow: 1 });
  // 23h em SP já é o dia seguinte em UTC — a data de SP não pode pular
  assert.deepEqual(partesSP("2026-11-03T02:00:00.000Z"), { data: "2026-11-02", hora: "23:00", dow: 1 });
  assert.equal(isoDeSP("2026-11-02", "25:00"), null);
  assert.equal(isoDeSP("02/11/2026", "10:00"), null);
  assert.equal(quandoSP("2026-11-02T22:30:00.000Z"), "02/11 às 19:30");
});

test("somarDias mantém o horário de Brasília (inclusive virando o mês)", () => {
  assert.equal(somarDias("2026-10-31T23:00:00.000Z", 1), "2026-11-01T23:00:00.000Z");
  assert.equal(somarDias("2026-10-30T15:00:00.000Z", 7), "2026-11-06T15:00:00.000Z");
});

test("dia por extenso e tempo relativo", () => {
  assert.equal(diaPorExtenso("2026-10-30T22:00:00.000Z", AGORA), "hoje · sexta-feira, 30 de outubro");
  assert.equal(diaPorExtenso("2026-10-31T13:00:00.000Z", AGORA), "amanhã · sábado, 31 de outubro");
  assert.equal(diaPorExtenso("2027-01-05T13:00:00.000Z", AGORA), "terça-feira, 5 de janeiro de 2027");
  assert.equal(relativo("2026-10-30T18:00:00.000Z", AGORA), "em 3h");
  assert.equal(relativo("2026-10-30T14:55:00.000Z", AGORA), "há 5 min");
  assert.equal(relativo("2026-11-01T15:00:00.000Z", AGORA), "em 2 dias");
  assert.equal(relativo("2026-10-30T15:00:20.000Z", AGORA), "agora");
});

test("sugerirData: um dia depois da anterior; se não couber, no meio; nunca no passado", () => {
  // primeira mensagem: daqui 1h
  assert.equal(sugerirData(null, null, AGORA), new Date(AGORA + 3600_000).toISOString());
  // fim da linha: +1 dia no mesmo horário
  assert.equal(sugerirData("2026-11-01T22:00:00.000Z", null, AGORA), "2026-11-02T22:00:00.000Z");
  // entre duas com 6h de folga: no meio
  assert.equal(sugerirData("2026-11-01T12:00:00.000Z", "2026-11-01T18:00:00.000Z", AGORA), "2026-11-01T15:00:00.000Z");
  // anterior já passou: não sugere data no passado
  assert.ok(Date.parse(sugerirData("2026-10-01T12:00:00.000Z", null, AGORA)) > AGORA);
});

test("feriados nacionais: Páscoa móvel certa e só os de hoje em diante", () => {
  const f26 = feriadosBR(2026);
  assert.equal(f26.find((f) => f.nome === "Carnaval")?.data, "2026-02-17");
  assert.equal(f26.find((f) => f.nome === "Sexta-feira Santa")?.data, "2026-04-03");
  assert.equal(f26.find((f) => f.nome === "Corpus Christi")?.data, "2026-06-04");
  assert.equal(f26.length, 12);
  const prox = proximosFeriados(AGORA);
  assert.equal(prox[0].nome, "Finados");
  assert.ok(prox.every((f) => f.data >= "2026-10-30"));
});

test("várias datas: uma campanha por data, data própria troca mídia e texto", () => {
  const base = { tipo: "imagem" as const, texto: "Base", midia_url: "https://x/base.jpg", midia_nome: "base.jpg" };
  const lista = campanhasDasDatas(base, [
    { data: "2026-11-03", hora: "09:00" },
    { data: "2026-11-02", hora: "19:00", texto: "Só no feriado" },
    { data: "2026-11-02", hora: "08:00" }, // repetida: fica a primeira
    { data: "2026-11-04", hora: "10:00", tipo: "texto" },
    { data: "2026-11-05", hora: "10:00", tipo: "video", midia_url: "https://x/v.mp4", midia_nome: "v.mp4" },
  ]);
  assert.deepEqual(lista.map((c) => c.data), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
  assert.equal(lista[0].texto, "Só no feriado");
  assert.equal(lista[0].enviar_em, "2026-11-02T22:00:00.000Z");
  assert.equal(lista[1].texto, "Base");
  assert.equal(lista[1].midia_url, "https://x/base.jpg");
  assert.equal(lista[2].tipo, "texto");
  assert.equal(lista[2].midia_url, null);
  assert.equal(lista[3].midia_url, "https://x/v.mp4");
  assert.equal(normalizarDatas([{ data: "2026-11-02", hora: "1" }, { data: "2026-11-02", hora: "2" }]).length, 1);
});

test("várias datas: sem data, data no passado e mídia faltando são barradas", () => {
  const base = { tipo: "texto" as const, texto: "oi", midia_url: null, midia_nome: null };
  assert.deepEqual(problemasDasDatas(base, [], AGORA), ["Escolha pelo menos uma data."]);
  assert.ok(problemasDasDatas(base, [{ data: "2026-10-30", hora: "08:00" }], AGORA)[0].includes("futuro"));
  assert.ok(problemasDasDatas(base, [{ data: "2026-11-02", hora: "10:00", tipo: "imagem" }], AGORA).some((e) => e.includes("02/11/2026")));
  assert.deepEqual(problemasDasDatas(base, [{ data: "2026-11-02", hora: "10:00" }], AGORA), []);
});

test("tempo estimado do envio", () => {
  assert.deepEqual(estimarDuracao(24, 20, 45), { minSeg: 460, maxSeg: 1035 });
  assert.deepEqual(estimarDuracao(1, 20, 45), { minSeg: 0, maxSeg: 0 });
  assert.equal(formatarDuracao(30), "menos de 1 min");
  assert.equal(formatarDuracao(460), "8 min");
  assert.equal(formatarDuracao(3600 + 20 * 60), "1h 20min");
});

test("recorrência: descrição e próximas datas (com início e fim)", () => {
  assert.equal(descreverRecorrencia([1], "19:00"), "Toda segunda às 19:00");
  assert.equal(descreverRecorrencia([5, 1, 3], "09:00"), "Toda segunda, quarta e sexta às 09:00");
  assert.equal(descreverRecorrencia([6], "10:00"), "Todo sábado às 10:00");
  assert.equal(descreverRecorrencia([0, 1, 2, 3, 4, 5, 6], "08:00"), "Todo dia às 08:00");
  const rec = { dias_semana: [1, 5], hora: "19:00", inicio: null, fim: null, ativo: true };
  // hoje é sexta 12h: a de hoje 19h ainda conta
  assert.deepEqual(proximasOcorrencias(rec, AGORA), ["2026-10-30T22:00:00.000Z", "2026-11-02T22:00:00.000Z", "2026-11-06T22:00:00.000Z"]);
  assert.deepEqual(proximasOcorrencias({ ...rec, inicio: "2026-11-03" }, AGORA, 1), ["2026-11-06T22:00:00.000Z"]);
  assert.deepEqual(proximasOcorrencias({ ...rec, fim: "2026-11-01" }, AGORA), ["2026-10-30T22:00:00.000Z"]);
  assert.deepEqual(proximasOcorrencias({ ...rec, ativo: false }, AGORA), []);
});

test("migradas do SendFlow: só a pausada de propósito pede confirmação", () => {
  const pausada = "Migrada do SendFlow — pausada de propósito: o SendFlow ainda manda esta. Retome só depois de desligar o SendFlow.";
  assert.equal(avisoPausadaDeProposito([pausada]), pausada);
  assert.equal(avisoPausadaDeProposito(["Migrada do SendFlow"]), null);
  assert.equal(avisoPausadaDeProposito(["Grupo X saiu"]), null);
  assert.equal(avisoPausadaDeProposito(null), null);
  assert.ok(veioDoSendFlow(["Migrada do SendFlow"]));
  assert.ok(!veioDoSendFlow([]));
});

test("abas e botões da campanha seguem o que o banco aceita", () => {
  assert.equal(abaDoStatus("enviando"), "agendadas");
  assert.equal(abaDoStatus("pausada"), "pausadas");
  assert.equal(abaDoStatus("erro"), "historico");
  assert.deepEqual(acoesDaCampanha({ status: "pausada", fanout_em: null }), ["editar", "retomar", "cancelar", "duplicar", "excluir"]);
  // a fila já existe: não edita nem apaga, só pausa/retoma/cancela
  assert.deepEqual(acoesDaCampanha({ status: "pausada", fanout_em: "2026-10-30T10:00:00Z" }), ["retomar", "cancelar", "duplicar"]);
  assert.deepEqual(acoesDaCampanha({ status: "enviando", fanout_em: "x" }), ["pausar", "cancelar", "duplicar"]);
  assert.deepEqual(acoesDaCampanha({ status: "concluida", fanout_em: "x" }), ["duplicar"]);
  assert.ok(passoEditavel({ status: "agendada", fanout_em: null }));
  assert.ok(!passoEditavel({ status: "agendada", fanout_em: "x" }));
  assert.ok(!passoEditavel({ status: "concluida", fanout_em: null }));
});

test("conferência antes de agendar: destino vazio NUNCA vira 'todos'", () => {
  const ok = { nome: "Live", tipo: "texto", texto: "oi", midia_url: null, enquete_opcoes: null, tag_ids: ["t"], grupo_jids: [], enviar_em: "2026-11-01T12:00:00.000Z" };
  assert.deepEqual(problemasDaCampanha(ok, { agora: AGORA }), {});
  assert.ok(problemasDaCampanha({ ...ok, tag_ids: [] }, { agora: AGORA }).publico);
  assert.ok(problemasDaCampanha({ ...ok, enviar_em: "2026-10-29T12:00:00.000Z" }, { agora: AGORA }).enviar_em);
  assert.ok(!problemasDaCampanha({ ...ok, enviar_em: null }, { agora: AGORA, exigirData: false }).enviar_em);
  assert.ok(problemasDaCampanha({ ...ok, tipo: "imagem", midia_url: null }, { agora: AGORA }).midia);
  assert.ok(problemasDaCampanha({ ...ok, tipo: "enquete", enquete_opcoes: ["Sim", "sim"] }, { agora: AGORA }).enquete);
  assert.ok(problemasDaCampanha({ ...ok, nome: " " }, { agora: AGORA }).nome);
});
