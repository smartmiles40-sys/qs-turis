// Fim de cadência no servidor (09/11): a decisão tem que ser a MESMA do
// navegador (src/lib/qs/cadenceSweep.ts) — redirecionar > perder > encerrar,
// congelada pausa o motor e destino congelado faz o lead esperar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirFimDeCadencia } from "../api/cadencia-sweep.js";

const DIA = 86_400_000;
const AGORA = Date.parse("2026-11-09T12:00:00Z");
const haDias = (n: number) => new Date(AGORA - n * DIA).toISOString();

const SDR = { id: "sdr", name: "Cadência SDR", auto_loss_days: null, redirect_cadence_id: "resgate" };
const PERDE = { id: "perde", name: "Nutrição", auto_loss_days: 10, redirect_cadence_id: null };
const LIVRE = { id: "livre", name: "Atendimento", auto_loss_days: null, redirect_cadence_id: null };
const REDIR_E_PERDE = { id: "rp", name: "RP", auto_loss_days: 1, redirect_cadence_id: "livre" };

function rodar(leads: any[], o: { regras?: any[]; destino?: Record<string, string>; abertas?: string[]; encerrados?: string[] } = {}) {
  const regras = new Map((o.regras ?? [SDR, PERDE, LIVRE, REDIR_E_PERDE]).map((c) => [c.id, c]));
  return decidirFimDeCadencia({
    leads,
    regras,
    statusDestino: new Map(Object.entries(o.destino ?? { resgate: "disponivel", livre: "disponivel" })),
    comAbertas: new Set(o.abertas ?? []),
    jaEncerrados: new Set(o.encerrados ?? []),
    agoraMs: AGORA,
  }).map((d: any) => [d.lead.id, d.acao, d.dias]);
}

test("lead com tarefa aberta não é tocado", () => {
  assert.deepEqual(rodar([{ id: "a", cadence_id: "sdr" }], { abertas: ["a"] }), []);
});

test("cadência fora das regras (congelada/rascunho) = motor pausado", () => {
  assert.deepEqual(rodar([{ id: "a", cadence_id: "congelada", cadence_started_at: haDias(99) }]), []);
});

test("redireciona quando o destino está disponível", () => {
  assert.deepEqual(rodar([{ id: "a", cadence_id: "sdr" }]), [["a", "redirecionar", undefined]]);
});

test("destino congelado: o lead ESPERA (não redireciona nem perde)", () => {
  assert.deepEqual(rodar([{ id: "a", cadence_id: "sdr" }], { destino: { resgate: "congelada" } }), []);
  assert.deepEqual(rodar([{ id: "b", cadence_id: "rp", cadence_started_at: haDias(30) }], { destino: { livre: "rascunho" } }), []);
});

test("redirecionamento vence a perda", () => {
  assert.deepEqual(rodar([{ id: "a", cadence_id: "rp", cadence_started_at: haDias(30) }]), [["a", "redirecionar", undefined]]);
});

test("redirecionar pra si mesma não conta como redirecionamento", () => {
  const LOOP = { id: "loop", name: "Loop", auto_loss_days: null, redirect_cadence_id: "loop" };
  assert.deepEqual(rodar([{ id: "a", cadence_id: "loop" }], { regras: [LOOP], destino: { loop: "disponivel" } }), [["a", "encerrar", undefined]]);
});

test("perda só depois do prazo; base = cadence_started_at, senão arrived_at", () => {
  assert.deepEqual(rodar([{ id: "a", cadence_id: "perde", cadence_started_at: haDias(9) }]), []);
  assert.deepEqual(rodar([{ id: "b", cadence_id: "perde", cadence_started_at: haDias(10) }]), [["b", "perder", 10]]);
  assert.deepEqual(rodar([{ id: "c", cadence_id: "perde", cadence_started_at: null, arrived_at: haDias(12) }]), [["c", "perder", 12]]);
  assert.deepEqual(rodar([{ id: "d", cadence_id: "perde", cadence_started_at: null, arrived_at: null }]), []);
});

test("sem regra: encerra uma vez só (nota fim-cadencia já existe = pula)", () => {
  assert.deepEqual(rodar([{ id: "a", cadence_id: "livre" }]), [["a", "encerrar", undefined]]);
  assert.deepEqual(rodar([{ id: "a", cadence_id: "livre" }], { encerrados: ["a"] }), []);
});

test("lead já encerrado com regra de perda ainda pode ser perdido (igual ao navegador)", () => {
  assert.deepEqual(rodar([{ id: "a", cadence_id: "perde", cadence_started_at: haDias(20) }], { encerrados: ["a"] }), [["a", "perder", 20]]);
});
