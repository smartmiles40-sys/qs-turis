// Alarmes da gestão (api/qs-alertas.js): regras puras, horário e dedupe.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  relogioBRT, dentroDoHorario, avaliarEntrada, regraEntradaLeads, regraReunioesBitrix,
  regraPulsoWhatsApp, regraCloserPendente, regraGravacoes, filtrarDedupe,
} from "../api/qs-alertas.js";

// hora de Brasília → ms UTC (UTC-3 fixo)
const brt = (y: number, m: number, d: number, h: number, min = 0) => Date.UTC(y, m - 1, d, h + 3, min);

test("relógio BRT e janela seg–sáb 8h–20h", () => {
  const seg14 = brt(2026, 11, 9, 14, 30); // segunda
  assert.equal(relogioBRT(seg14).hora, 14);
  assert.equal(relogioBRT(seg14).dow, 1);
  assert.equal(dentroDoHorario(seg14), true);
  assert.equal(dentroDoHorario(brt(2026, 11, 9, 7, 59)), false);
  assert.equal(dentroDoHorario(brt(2026, 11, 9, 20, 0)), false);
  assert.equal(dentroDoHorario(brt(2026, 11, 8, 10)), false); // domingo
  assert.equal(dentroDoHorario(brt(2026, 11, 14, 10)), true); // sábado
  // 23h BRT de segunda = 02h UTC de terça: continua segunda
  assert.equal(relogioBRT(brt(2026, 11, 9, 23)).dow, 1);
});

test("entrada de leads: compara com o mesmo horário dos 7 dias úteis, pulando domingo", () => {
  const agora = brt(2026, 11, 9, 14, 0); // segunda 14h
  const leads: number[] = [];
  // 7 dias úteis anteriores: 10 leads cada até 14h (às 10h) + 5 depois (às 18h)
  for (const d of [7, 6, 5, 4, 3, 2, 31]) {
    const mes = d === 31 ? 10 : 11;
    for (let i = 0; i < 10; i++) leads.push(brt(2026, mes, d, 10, i));
    for (let i = 0; i < 5; i++) leads.push(brt(2026, mes, d, 18, i));
  }
  for (let i = 0; i < 50; i++) leads.push(brt(2026, 11, 8, 10, i % 60)); // domingo: ignorado
  for (let i = 0; i < 3; i++) leads.push(brt(2026, 11, 9, 9, i)); // hoje
  const av = avaliarEntrada(leads, agora);
  assert.equal(av.porDia.length, 7);
  assert.equal(av.media, 10);
  assert.equal(av.hoje, 3);
  assert.ok(regraEntradaLeads(av, agora));
  assert.equal(regraEntradaLeads({ ...av, hoje: 5 }, agora), null); // 50% não alerta
  assert.equal(regraEntradaLeads(av, brt(2026, 11, 9, 11, 59)), null); // antes das 12h
  assert.equal(regraEntradaLeads({ ...av, media: 3 }, agora), null); // base pequena
});

test("reuniões sem Bitrix: ≥2 pendentes ou qualquer 'desisti'", () => {
  assert.equal(regraReunioesBitrix({ pendentes: 1, desistidas: 0 }), null);
  assert.ok(regraReunioesBitrix({ pendentes: 2, desistidas: 0 }));
  assert.ok(regraReunioesBitrix({ pendentes: 0, desistidas: 1 }));
});

test("pulso do WhatsApp: > 30 min sem batida, só depois das 8h30", () => {
  const agora = brt(2026, 11, 9, 15, 0);
  const val = (minAtras: number) => ({ ultimo_em: new Date(agora - minAtras * 60_000).toISOString() });
  assert.equal(regraPulsoWhatsApp(val(10), null, agora), null);
  assert.ok(regraPulsoWhatsApp(val(31), null, agora));
  assert.ok(regraPulsoWhatsApp(null, null, agora)); // sem registro
  assert.equal(regraPulsoWhatsApp(null, null, brt(2026, 11, 9, 8, 15)), null);
});

test("closer > 20 e gravações > 0 (baixo)", () => {
  assert.equal(regraCloserPendente(20), null);
  assert.ok(regraCloserPendente(21));
  assert.equal(regraGravacoes(0), null);
  assert.equal(regraGravacoes(3)?.nivel, "baixo");
});

test("dedupe: 6h pro alto, 24h pro baixo", () => {
  const agora = brt(2026, 11, 9, 15, 0);
  const alto = { id: "x", nivel: "alto", titulo: "", texto: "" };
  const baixo = { id: "y", nivel: "baixo", titulo: "", texto: "" };
  const h = (n: number) => new Date(agora - n * 3_600_000).toISOString();
  let r = filtrarDedupe([alto, baixo], { x: h(5), y: h(7) }, agora);
  assert.deepEqual(r.enviar.map((a) => a.id), []);
  r = filtrarDedupe([alto, baixo], { x: h(6), y: h(24) }, agora);
  assert.deepEqual(r.enviar.map((a) => a.id), ["x", "y"]);
  assert.equal(r.novoEstado.x, new Date(agora).toISOString());
  r = filtrarDedupe([alto], null, agora);
  assert.equal(r.enviar.length, 1);
});
