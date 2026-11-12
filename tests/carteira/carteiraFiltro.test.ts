// Filtros da Carteira (12/11): Lead Score, tempo sem contato e cadência.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  casaFiltrosCarteira, diasSemContato, SEM_CADENCIA, SEM_SCORE, FILTROS_CARTEIRA_VAZIOS as V,
} from "../../src/lib/qs/carteiraFiltro.ts";

const AGORA = Date.parse("2026-11-12T15:00:00Z");
const haDias = (n: number) => new Date(AGORA - n * 864e5).toISOString();
const item = (o: Partial<{ leadScore: string | null; ultimoContato: string | null; cadenceId: string | null }>) =>
  ({ leadScore: null, ultimoContato: null, cadenceId: null, ...o });

test("sem filtro passa tudo", () => {
  assert.equal(casaFiltrosCarteira(item({}), V, AGORA), true);
});

test("lead score normaliza o rótulo do Bitrix", () => {
  assert.equal(casaFiltrosCarteira(item({ leadScore: "Hot" }), { ...V, temp: "quente" }, AGORA), true);
  assert.equal(casaFiltrosCarteira(item({ leadScore: "Morno" }), { ...V, temp: "quente" }, AGORA), false);
  assert.equal(casaFiltrosCarteira(item({ leadScore: null }), { ...V, temp: SEM_SCORE }, AGORA), true);
  assert.equal(casaFiltrosCarteira(item({ leadScore: "Frio" }), { ...V, temp: SEM_SCORE }, AGORA), false);
});

test("tempo sem contato: N+ dias inclui quem nunca teve contato", () => {
  const f = { ...V, semContato: "30" as const };
  assert.equal(casaFiltrosCarteira(item({ ultimoContato: haDias(31) }), f, AGORA), true);
  assert.equal(casaFiltrosCarteira(item({ ultimoContato: haDias(29) }), f, AGORA), false);
  assert.equal(casaFiltrosCarteira(item({ ultimoContato: null }), f, AGORA), true);
});

test("nunca contatado = só sem atividade concluída", () => {
  const f = { ...V, semContato: "nunca" as const };
  assert.equal(casaFiltrosCarteira(item({ ultimoContato: null }), f, AGORA), true);
  assert.equal(casaFiltrosCarteira(item({ ultimoContato: haDias(200) }), f, AGORA), false);
});

test("cadência: id exato ou sem cadência", () => {
  assert.equal(casaFiltrosCarteira(item({ cadenceId: "a" }), { ...V, cadenceId: "a" }, AGORA), true);
  assert.equal(casaFiltrosCarteira(item({ cadenceId: "b" }), { ...V, cadenceId: "a" }, AGORA), false);
  assert.equal(casaFiltrosCarteira(item({ cadenceId: null }), { ...V, cadenceId: SEM_CADENCIA }, AGORA), true);
  assert.equal(casaFiltrosCarteira(item({ cadenceId: "a" }), { ...V, cadenceId: SEM_CADENCIA }, AGORA), false);
});

test("filtros combinam com E", () => {
  const f = { temp: "quente" as const, semContato: "15" as const, cadenceId: "a" };
  assert.equal(casaFiltrosCarteira(item({ leadScore: "quente", ultimoContato: haDias(20), cadenceId: "a" }), f, AGORA), true);
  assert.equal(casaFiltrosCarteira(item({ leadScore: "quente", ultimoContato: haDias(5), cadenceId: "a" }), f, AGORA), false);
});

test("diasSemContato", () => {
  assert.equal(diasSemContato(null, AGORA), null);
  assert.equal(diasSemContato(haDias(3), AGORA), 3);
});
