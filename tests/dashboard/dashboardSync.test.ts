// QS → Dashboard (05/11): cada reunião vira uma linha da reunioes_qs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { linhaDaReuniao } from "../../api/dashboard-sync.js";

test("linha da reunião: campos do QS + bitrix_id e temperatura do lead", () => {
  const l = linhaDaReuniao({
    id: "m1", lead_id: "l1", lead_name: "Ana", status: "no_show", tipo: null,
    reagendado_de: "m0", scheduled_at: "2026-11-05T17:00:00Z", created_at: "2026-11-04T12:00:00Z",
    booking_date: "2026-11-04", scheduled_by: "Mariana Rodrigues - SDR", meeting_owner: "Talita Carvalho",
    temperatura_sdr: "quente", updated_at: "2026-11-05T18:00:00Z",
    lead: { bitrix_id: "#54127", lead_score: "Morno", full_name: "Ana Souza" },
  });
  assert.equal(l.bitrix_id, "54127");
  assert.equal(l.tipo, "primeira");
  assert.equal(l.reagendado_de, "m0");
  assert.equal(l.temperatura, "Morno");
  assert.equal(l.temperatura_sdr, "quente");
  assert.equal(l.lead_nome, "Ana");
  assert.equal(l.sdr, "Mariana Rodrigues - SDR");
});

test("linha da reunião: sem lead embutido não quebra", () => {
  const l = linhaDaReuniao({ id: "m2", status: "agendada", lead: null });
  assert.equal(l.bitrix_id, null);
  assert.equal(l.temperatura, null);
});

// 24/11: metas dos SDRs vêm do Dashboard (metas_config) pro QS.
import { casarMetas, normalizarNome, mesSP } from "../../api/dashboard-sync.js";

test("metas do Dashboard casam com o SDR do QS pelo começo do nome", () => {
  assert.equal(normalizarNome("Mariana Rodrigues - SDR"), "mariana rodrigues");
  const sdrs = [
    { id: "y", name: "Yanca Manuella Ruivo" },
    { id: "m", name: "Mariana" },
    { id: "v", name: "Victor Hugo" },
  ];
  const pares = casarMetas([
    { nome: "Mariana Rodrigues - SDR", agendamentos: 80, reunioes: 60 },
    { nome: "Victor Hugo - SDR", agendamentos: 80, reunioes: 0 },
    { nome: "Yanca Manuella", agendamentos: 70, reunioes: 50 },
    { nome: "Fulano - SDR", agendamentos: 10, reunioes: 5 },
  ], sdrs);
  assert.deepEqual(pares, [
    { owner_id: "m", reunioes: 80, reunioes_realizadas: 60 },
    { owner_id: "v", reunioes: 80, reunioes_realizadas: null },
    { owner_id: "y", reunioes: 70, reunioes_realizadas: 50 },
  ]);
});

test("nome ambíguo não casa (nunca chuta)", () => {
  const pares = casarMetas([{ nome: "Ana", agendamentos: 10, reunioes: 5 }],
    [{ id: "1", name: "Ana Paula" }, { id: "2", name: "Ana Clara" }]);
  assert.equal(pares.length, 0);
});

test("mês corrente no fuso de SP", () => {
  assert.equal(mesSP(new Date("2026-12-01T02:00:00Z")), "2026-11");
  assert.equal(mesSP(new Date("2026-12-01T04:00:00Z")), "2026-12");
});
