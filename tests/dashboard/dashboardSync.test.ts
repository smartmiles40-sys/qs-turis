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
