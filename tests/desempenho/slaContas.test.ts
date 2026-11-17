// SLA do 1º atendimento (src/lib/qs/slaContas.ts, 0400): as contas, sem rede.
import { test } from "node:test";
import assert from "node:assert/strict";
import { minutosTxt, normalizarPainelSla, pctNaMeta, tomEspera, tomSla } from "../../src/lib/qs/slaContas.ts";

const b = (x: Partial<{ recebidos: number; atendidos: number; na_meta: number; fora_meta: number; aguardando: number; mediana_min: number | null }>) =>
  ({ recebidos: 0, atendidos: 0, na_meta: 0, fora_meta: 0, aguardando: 0, mediana_min: null, ...x });

test("% no prazo conta quem estourou esperando", () => {
  assert.equal(pctNaMeta(b({ na_meta: 6, fora_meta: 2 })), 0.75);
  assert.equal(pctNaMeta(b({})), null);
});

test("tom do SLA: mediana acima da meta é vermelho; 50–70% amarelo", () => {
  assert.equal(tomSla(b({ na_meta: 9, fora_meta: 1, mediana_min: 12 }), 30), "ok");
  assert.equal(tomSla(b({ na_meta: 6, fora_meta: 4, mediana_min: 20 }), 30), "warn");
  assert.equal(tomSla(b({ na_meta: 9, fora_meta: 1, mediana_min: 45 }), 30), "danger");
  assert.equal(tomSla(b({ na_meta: 1, fora_meta: 3, mediana_min: 10 }), 30), "danger");
  assert.equal(tomSla(b({}), 30), "neutro");
});

test("lead esperando: verde, amarelo a partir de 2/3 da meta, vermelho depois", () => {
  assert.equal(tomEspera(5, 30), "ok");
  assert.equal(tomEspera(20, 30), "warn");
  assert.equal(tomEspera(30, 30), "warn");
  assert.equal(tomEspera(31, 30), "danger");
});

test("tempo em horas úteis não vira dias", () => {
  assert.equal(minutosTxt(null), "—");
  assert.equal(minutosTxt(27), "27 min");
  assert.equal(minutosTxt(112), "1h52");
  assert.equal(minutosTxt(120), "2h");
  assert.equal(minutosTxt(3157), "52h");
});

test("normaliza a resposta do banco (números como texto, campos faltando)", () => {
  const p = normalizarPainelSla({
    meta_min: "30", gestor: true,
    time: { hoje: { recebidos: "27", atendidos: 23, na_meta: 15, fora_meta: 11, aguardando: 4, mediana_min: "27" } },
    sdrs: [{ sdr_id: "a", nome: "Ana", hoje: { recebidos: 9 } }],
    aguardando: [{ lead_id: "l", nome: "X", sdr_id: "a", sdr_nome: "Ana", chegou_em: "2026-11-17T12:00:00Z", minutos: "45" }],
  });
  assert.equal(p.meta_min, 30);
  assert.equal(p.time.hoje.mediana_min, 27);
  assert.equal(p.time.semana.recebidos, 0);
  assert.equal(p.sdrs[0].hoje.mediana_min, null);
  assert.equal(p.sdrs[0].mes.recebidos, 0);
  assert.equal(p.aguardando[0].minutos, 45);
});
