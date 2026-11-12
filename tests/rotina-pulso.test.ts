// Pulso das rotinas (api/_rotinaPulso.js) + alerta de automação parada/pulando.
import { test } from "node:test";
import assert from "node:assert/strict";
import { proximoPulso, podePular, regraRotinas, pulsoDaFinComSync } from "../api/_rotinaPulso.js";

const MIN = 60_000;
const HORA = 60 * MIN;
const agora = Date.UTC(2026, 10, 12, 15, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const CAT = { teste: { nome: "Rotina teste", cron: "*/5 * * * *", toleranciaMs: HORA } };

test("proximoPulso: ok atualiza ok_em; pulado/erro preservam o último sucesso", () => {
  const ok = proximoPulso(null, {}, agora);
  assert.equal(ok.status, "ok");
  assert.equal(ok.ok_em, iso(agora));
  const pulou = proximoPulso(ok, { status: "pulado", motivo: "falta env" }, agora + MIN);
  assert.equal(pulou.status, "pulado");
  assert.equal(pulou.ok_em, iso(agora));
  assert.equal(pulou.em, iso(agora + MIN));
  assert.equal(proximoPulso(null, { status: "erro" }, agora).ok_em, null);
  assert.equal(proximoPulso(null, { status: "qualquer" }, agora).status, "ok");
});

test("podePular: só pula o mesmo desfecho dentro do intervalo", () => {
  const ant = { em: iso(agora - 2 * MIN), status: "ok", motivo: null, ok_em: iso(agora - 2 * MIN) };
  assert.equal(podePular(ant, {}, agora, 5 * MIN), true);
  assert.equal(podePular(ant, {}, agora, 0), false);
  assert.equal(podePular(ant, {}, agora, MIN), false);
  assert.equal(podePular(ant, { status: "erro", motivo: "x" }, agora, 5 * MIN), false);
});

test("regraRotinas: parada, pulando, falhando e silêncio quando está tudo bem", () => {
  const recente = iso(agora - 5 * MIN);
  const velho = iso(agora - 3 * HORA);
  assert.deepEqual(regraRotinas({ teste: { em: recente, status: "ok", ok_em: recente } }, agora, CAT), []);
  // sem rastro (ainda não publicada) não acusa
  assert.deepEqual(regraRotinas({}, agora, CAT), []);

  const parada = regraRotinas({ teste: { em: velho, status: "ok", ok_em: velho } }, agora, CAT);
  assert.equal(parada.length, 1);
  assert.equal(parada[0].id, "rotina_parada:teste");

  const pulando = regraRotinas({ teste: { em: recente, status: "pulado", motivo: "Falta X", ok_em: velho } }, agora, CAT);
  assert.equal(pulando[0].id, "rotina_pulando:teste");
  assert.match(pulando[0].texto, /Falta X/);

  const nunca = regraRotinas({ teste: { em: recente, status: "pulado", motivo: "Falta X", ok_em: null } }, agora, CAT);
  assert.equal(nunca[0].id, "rotina_pulando:teste");

  const falhando = regraRotinas({ teste: { em: recente, status: "erro", motivo: "500", ok_em: velho } }, agora, CAT);
  assert.equal(falhando[0].id, "rotina_falhando:teste");

  // pulou agora, mas deu certo há pouco: ainda dentro da tolerância
  assert.deepEqual(regraRotinas({ teste: { em: recente, status: "pulado", ok_em: iso(agora - 10 * MIN) } }, agora, CAT), []);
});

test("fin_com_sync antiga vira pulso: a parada de 09/11 acusa", () => {
  const p = pulsoDaFinComSync({ rodou_em: "2026-11-09T14:02:12.057Z", erro: null });
  assert.equal(p?.status, "ok");
  const a = regraRotinas({ "fin-comissoes": p }, agora, { "fin-comissoes": { nome: "Comissões", cron: "11,41 * * * *", toleranciaMs: 3 * HORA } });
  assert.equal(a[0].id, "rotina_parada:fin-comissoes");
  assert.equal(pulsoDaFinComSync(null), null);
  assert.equal(pulsoDaFinComSync({ rodou_em: "2026-11-12T10:00:00Z", erro: "Dashboard 500" })?.status, "erro");
});
