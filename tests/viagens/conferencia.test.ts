// Testes da revisão manual dos voos e do "já aconteceu" (src/rel/lib/conferencia.ts).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/viagens/conferencia.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { conferidosDoHistorico, contarConferidos, jaAconteceu, type LinhaHistorico } from "../../src/rel/lib/conferencia.ts";

let n = 0;
const linha = (trecho: string, acao: string, em: string, extra: Partial<LinhaHistorico> = {}): LinhaHistorico => ({
  id: `c${++n}`, trecho_id: trecho, acao, depois: acao === "trecho_conferido" ? { conferido: true } : {}, feito_em: em, feito_por_nome: "Yanca", desfeita_em: null, ...extra,
});

test("conferido: a última conferência valendo manda, com quem e quando", () => {
  const m = conferidosDoHistorico([linha("t1", "trecho_conferido", "2026-11-03T10:00:00Z"), linha("t2", "trecho_checkin", "2026-11-03T11:00:00Z")]);
  assert.equal(m.size, 1);
  assert.equal(m.get("t1")?.por, "Yanca");
  assert.equal(m.get("t1")?.em, "2026-11-03T10:00:00Z");
});

test("conferência desfeita ou retirada não vale", () => {
  assert.equal(conferidosDoHistorico([linha("t1", "trecho_conferido", "2026-11-03T10:00:00Z", { desfeita_em: "2026-11-03T12:00:00Z" })]).size, 0);
  const m = conferidosDoHistorico([
    linha("t1", "trecho_conferido", "2026-11-03T10:00:00Z"),
    linha("t1", "trecho_conferido", "2026-11-03T11:00:00Z", { depois: { conferido: false } }),
  ]);
  assert.equal(m.has("t1"), false);
});

test("corrigir o trecho DEPOIS de conferido anula a conferência; conferir de novo volta", () => {
  // o histórico vem do banco do mais novo pro mais velho — a ordem não pode importar
  const h = [linha("t1", "trecho_editado", "2026-11-03T11:00:00Z"), linha("t1", "trecho_conferido", "2026-11-03T10:00:00Z")];
  assert.equal(conferidosDoHistorico(h).has("t1"), false);
  assert.equal(conferidosDoHistorico([...h, linha("t1", "trecho_conferido", "2026-11-03T12:00:00Z")]).has("t1"), true);
  // correção desfeita não anula
  assert.equal(conferidosDoHistorico([linha("t1", "trecho_conferido", "2026-11-03T10:00:00Z"), linha("t1", "trecho_editado", "2026-11-03T11:00:00Z", { desfeita_em: "x" })]).has("t1"), true);
});

const AGORA = Date.parse("2026-11-03T15:00:00-03:00");

test("já aconteceu: voado, chegada no passado, check-out no passado", () => {
  assert.equal(jaAconteceu({ tipo: "voo_internacional", partida_em: "2026-11-10T10:00:00Z", status_manual: "voado" }, AGORA), true);
  assert.equal(jaAconteceu({ tipo: "voo_internacional", partida_em: "2026-11-01T10:00:00Z", chegada_em: "2026-11-01T20:00:00Z" }, AGORA), true);
  assert.equal(jaAconteceu({ tipo: "voo_internacional", partida_em: "2026-11-15T10:00:00Z" }, AGORA, "a_voar"), false);
  assert.equal(jaAconteceu({ tipo: "voo_internacional", partida_em: "2026-11-15T10:00:00Z" }, AGORA, "voado"), true);
  assert.equal(jaAconteceu({ tipo: "hospedagem", partida_em: "2026-10-28T15:00:00Z", chegada_em: "2026-11-02T11:00:00Z" }, AGORA), true);
  // hotel em curso (check-in passado, check-out futuro) ainda não aconteceu
  assert.equal(jaAconteceu({ tipo: "hospedagem", partida_em: "2026-11-01T15:00:00Z", chegada_em: "2026-11-05T11:00:00Z" }, AGORA), false);
});

test("cancelado não conta como acontecido (é tirado); Bitrix só conta o dia inteiro", () => {
  assert.equal(jaAconteceu({ tipo: "voo_interno", partida_em: "2026-10-01T10:00:00Z", status_manual: "cancelado" }, AGORA), false);
  assert.equal(jaAconteceu({ tipo: "voo_interno", partida_em: "2026-10-01T10:00:00Z" }, AGORA, "cancelado"), false);
  // Bitrix: 03/11 00:00 (hora de mentira) — às 15h do mesmo dia ainda não passou
  assert.equal(jaAconteceu({ tipo: "voo_internacional", partida_em: "2026-11-03T03:00:00Z", fonte: "bitrix" }, AGORA), false);
  assert.equal(jaAconteceu({ tipo: "voo_internacional", partida_em: "2026-11-01T03:00:00Z", fonte: "bitrix" }, AGORA), true);
});

test("X de Y voos conferidos: só os que ainda valem", () => {
  const r = contarConferidos([
    { id: "a", valido: true, conferido: true },
    { id: "b", valido: true },
    { id: "c", valido: false, conferido: true },
    { id: "d", valido: true, cancelado: true },
    { id: "e", valido: true, passou: true },
  ]);
  assert.deepEqual(r, { conferidos: 1, total: 2 });
});
