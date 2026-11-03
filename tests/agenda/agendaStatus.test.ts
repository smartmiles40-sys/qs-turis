// Agenda (redesign 03/11): status dos chips, sidebar do dia e rotas /agenda/*.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  statusNaAgenda, contarPorStatus, chipsDaAgenda, filtrarPorStatus, acontecendoAgora, proximaReuniao,
  faltaDesfecho, emQuantoTempo, abaDoCloser, abaDoComercial, hashDaAgenda, fimDaReuniaoAgenda,
} from "../../src/lib/qs/agendaStatus.ts";

// Terça, 03/11/2026, 19:34 (hora local) — o "agora" do desenho.
const AGORA = new Date(2026, 10, 3, 19, 34, 0);
const iso = (h: number, min = 0, dia = 3) => new Date(2026, 10, dia, h, min, 0).toISOString();
const r = (status: string, h: number, min = 0, dur: number | null = 60, extra: Record<string, unknown> = {}) =>
  ({ status, scheduled_at: iso(h, min), duration_min: dur, ...extra });

test("aberta que já terminou = falta registrar o desfecho", () => {
  assert.equal(statusNaAgenda(r("agendada", 9), AGORA), "sem_desfecho");
  assert.equal(statusNaAgenda(r("confirmada", 18, 0, 60), AGORA), "sem_desfecho");
});

test("aberta que começou e não terminou = acontecendo agora", () => {
  assert.equal(statusNaAgenda(r("agendada", 19, 30), AGORA), "acontecendo");
  assert.equal(statusNaAgenda(r("confirmada", 19, 34), AGORA), "acontecendo"); // começa exatamente agora
});

test("aberta no futuro mantém agendada/confirmada", () => {
  assert.equal(statusNaAgenda(r("agendada", 20), AGORA), "agendada");
  assert.equal(statusNaAgenda(r("confirmada", 21), AGORA), "confirmada");
});

test("sem duração gravada vale 30 min (mesma regra do semDesfecho); ends_at manda", () => {
  assert.equal(statusNaAgenda(r("agendada", 19, 0, null), AGORA), "sem_desfecho"); // 19:00–19:30
  assert.equal(statusNaAgenda(r("agendada", 19, 0, null, { ends_at: iso(20) }), AGORA), "acontecendo");
  assert.equal(fimDaReuniaoAgenda(r("agendada", 10, 0, null)).getTime(), new Date(iso(10, 30)).getTime());
});

test("status fechados passam direto; desconhecido vira arquivada", () => {
  for (const s of ["realizada", "no_show", "reagendada", "cancelada", "desistencia", "arquivada"]) {
    assert.equal(statusNaAgenda(r(s, 9), AGORA), s);
  }
  assert.equal(statusNaAgenda(r("sei_la", 9), AGORA), "arquivada");
});

const DIA = [
  r("realizada", 9, 0, 60, { id: "a" }),
  r("agendada", 11, 0, 60, { id: "b" }),       // sem desfecho
  r("desistencia", 11, 0, 60, { id: "c" }),
  r("reagendada", 16, 0, 60, { id: "d" }),
  r("cancelada", 18, 0, 60, { id: "e" }),
  r("confirmada", 9, 0, 60, { id: "f" }),      // sem desfecho
  r("agendada", 19, 30, 60, { id: "g" }),      // acontecendo
  r("agendada", 20, 0, 60, { id: "h" }),       // próxima
  r("confirmada", 21, 0, 60, { id: "i" }),
];

test("contagem por status e chips só com o que existe", () => {
  const c = contarPorStatus(DIA, AGORA);
  assert.equal(c.todas, 9);
  assert.equal(c.sem_desfecho, 2);
  assert.equal(c.acontecendo, 1);
  assert.equal(c.agendada, 1);
  assert.equal(c.no_show, 0);
  const chips = chipsDaAgenda(DIA, AGORA);
  assert.deepEqual(chips.map((x) => x.id), ["todas", "acontecendo", "sem_desfecho", "agendada", "confirmada", "realizada", "reagendada", "cancelada", "desistencia"]);
  assert.equal(chips.find((x) => x.id === "sem_desfecho")!.rotulo, "Falta registrar o desfecho");
  // o chip ativo não some mesmo zerado
  assert.ok(chipsDaAgenda(DIA, AGORA, "no_show").some((x) => x.id === "no_show" && x.qtd === 0));
});

test("filtro, acontecendo, próxima e falta desfecho", () => {
  assert.deepEqual(filtrarPorStatus(DIA, "sem_desfecho", AGORA).map((m) => m.id), ["b", "f"]);
  assert.equal(filtrarPorStatus(DIA, "todas", AGORA).length, 9);
  assert.deepEqual(acontecendoAgora(DIA, AGORA).map((m) => m.id), ["g"]);
  assert.equal(proximaReuniao(DIA, AGORA)?.id, "h");
  assert.deepEqual(faltaDesfecho(DIA, AGORA).map((m) => m.id), ["f", "b"]); // 9h antes de 11h
  assert.equal(proximaReuniao([r("realizada", 22)], AGORA), null);
});

test("em quanto tempo", () => {
  assert.equal(emQuantoTempo(AGORA, new Date(iso(20))), "em 26 min");
  assert.equal(emQuantoTempo(AGORA, new Date(iso(20, 34))), "em 1 h");
  assert.equal(emQuantoTempo(AGORA, new Date(iso(21, 39))), "em 2 h 05");
});

test("rotas do closer: novas e antigas", () => {
  assert.equal(abaDoCloser("agenda", "mes"), "mes");
  assert.equal(abaDoCloser("agenda", "time"), "time");
  assert.equal(abaDoCloser("agenda", "desfechos"), "desfechos");
  assert.equal(abaDoCloser("agenda"), "dia");
  assert.equal(abaDoCloser("agenda", "xyz"), "dia");
  assert.equal(abaDoCloser("painel"), "dia");
  assert.equal(abaDoCloser("reunioes"), "dia");
  assert.equal(abaDoCloser("reunioes", "todas"), "dia");
  assert.equal(abaDoCloser("reunioes", "agenda"), "desfechos");
  assert.equal(abaDoCloser("reunioes", "falta-agendar"), "falta-agendar");
  assert.equal(abaDoCloser("pipeline"), null);
});

test("rotas do comercial: novas e antigas", () => {
  assert.equal(abaDoComercial("#comercial/agenda/dia"), "dia");
  assert.equal(abaDoComercial("#comercial/agenda/time"), "time");
  assert.equal(abaDoComercial("#comercial/agenda/mes?x=1"), "mes");
  assert.equal(abaDoComercial("#comercial/agenda"), "dia");
  assert.equal(abaDoComercial("#comercial/agenda/desfechos"), "dia"); // aba de closer não existe aqui
  assert.equal(abaDoComercial("#comercial/minha-agenda"), "time");
  assert.equal(abaDoComercial("#comercial/reunioes"), "dia");
  assert.equal(abaDoComercial("#comercial/lead/123"), null);
  assert.equal(abaDoComercial("#closer/agenda/dia"), null);
  assert.equal(hashDaAgenda("closer", "mes"), "#closer/agenda/mes");
});
