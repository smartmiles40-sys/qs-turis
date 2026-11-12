// Fim de cadência no servidor (09/11): a decisão tem que ser a MESMA do
// navegador (src/lib/qs/cadenceSweep.ts) — redirecionar > perder > encerrar,
// congelada pausa o motor e destino congelado faz o lead esperar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirFimDeCadencia, emExpediente, inicioDoDiaBrt } from "../api/cadencia-sweep.js";

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

// ── 12/11/2026: lead parado atrás de destino congelado ganha UMA revisão ──────

function rodarRevisao(leads: any[], o: { revisados?: string[]; hoje?: Record<string, number>; teto?: number; agora?: number } = {}) {
  return decidirFimDeCadencia({
    leads,
    regras: new Map([[SDR.id, SDR]]),
    statusDestino: new Map([["resgate", "congelada"]]),
    comAbertas: new Set(),
    jaEncerrados: new Set(),
    jaRevisados: new Set(o.revisados ?? []),
    revisarHoje: new Map(Object.entries(o.hoje ?? {})),
    revisarDia: o.teto ?? 5,
    agoraMs: o.agora ?? AGORA,
  }).map((d: any) => [d.lead.id, d.acao]);
}

test("destino congelado + teto ligado: cria tarefa de revisão (uma vez só)", () => {
  assert.deepEqual(rodarRevisao([{ id: "a", cadence_id: "sdr", owner_id: "m" }]), [["a", "revisar"]]);
  assert.deepEqual(rodarRevisao([{ id: "a", cadence_id: "sdr", owner_id: "m" }], { revisados: ["a"] }), []);
});

test("revisão respeita o teto por SDR por dia (sem avalanche)", () => {
  const leads = ["1", "2", "3", "4"].map((id) => ({ id, cadence_id: "sdr", owner_id: "y" }));
  assert.equal(rodarRevisao(leads, { teto: 2 }).length, 2);
  assert.equal(rodarRevisao(leads, { teto: 2, hoje: { y: 1 } }).length, 1);
  assert.equal(rodarRevisao(leads, { teto: 2, hoje: { y: 2 } }).length, 0);
  // o teto é por dono: outro SDR tem a cota dele
  assert.equal(rodarRevisao([...leads, { id: "5", cadence_id: "sdr", owner_id: "m" }], { teto: 2, hoje: { y: 2 } }).length, 1);
});

test("revisão: sem dono, teto 0 ou fora do expediente = só espera", () => {
  assert.deepEqual(rodarRevisao([{ id: "a", cadence_id: "sdr", owner_id: null }]), []);
  assert.deepEqual(rodarRevisao([{ id: "a", cadence_id: "sdr", owner_id: "m" }], { teto: 0 }), []);
  const sabado = Date.parse("2026-11-14T15:00:00Z");
  assert.deepEqual(rodarRevisao([{ id: "a", cadence_id: "sdr", owner_id: "m" }], { agora: sabado }), []);
});

test("expediente e meia-noite em Brasília", () => {
  assert.equal(emExpediente(Date.parse("2026-11-09T11:59:00Z")), false); // seg 08:59 BRT
  assert.equal(emExpediente(Date.parse("2026-11-09T12:00:00Z")), true);  // seg 09:00 BRT
  assert.equal(emExpediente(Date.parse("2026-11-09T21:00:00Z")), false); // seg 18:00 BRT
  assert.equal(inicioDoDiaBrt(Date.parse("2026-11-10T02:00:00Z")), "2026-11-09T03:00:00.000Z"); // 23h BRT de seg
});
