// Tela unificada do SDR (03/11): situação das reuniões, períodos e resumo;
// Desempenho visual: ritmo da meta, série por dia e ranking.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  situacaoDaReuniao, intervaloReunioes, dentroDoIntervalo, resumirReunioes, agruparPorDia, faixaDaSemana, inicioDaSemana,
} from "../../src/lib/qs/reunioesDoSdr.ts";
import {
  fracaoDoMesUtil, ritmoDaMeta, serieDiaria, rankingPorReunioes, diasUteisRestantes,
} from "../../src/lib/qs/desempenhoSdr.ts";

// Terça, 03/11/2026, 15h (hora local).
const AGORA = new Date(2026, 10, 3, 15, 0, 0);
const iso = (d: number, h = 10, mes = 10) => new Date(2026, mes, d, h, 0, 0).toISOString();

test("agendada que já terminou vira 'sem desfecho'; futura 'vai acontecer'", () => {
  assert.equal(situacaoDaReuniao({ status: "agendada", scheduled_at: iso(3, 10), duration_min: 30 }, AGORA), "sem_desfecho");
  assert.equal(situacaoDaReuniao({ status: "confirmada", scheduled_at: iso(3, 16) }, AGORA), "vai_acontecer");
  // ends_at manda quando existe
  assert.equal(situacaoDaReuniao({ status: "agendada", scheduled_at: iso(3, 14), ends_at: iso(3, 16) }, AGORA), "vai_acontecer");
  assert.equal(situacaoDaReuniao({ status: "no_show", scheduled_at: iso(1) }, AGORA), "no_show");
  assert.equal(situacaoDaReuniao({ status: "qualquer", scheduled_at: iso(1) }, AGORA), "arquivada");
});

test("semana começa na segunda; períodos são [de, ate)", () => {
  assert.equal(inicioDaSemana(AGORA).getDate(), 2);
  const sem = intervaloReunioes("semana", AGORA);
  assert.equal(sem.de!.getDate(), 2);
  assert.equal(sem.ate!.getDate(), 9);
  const hoje = intervaloReunioes("hoje", AGORA);
  assert.ok(dentroDoIntervalo({ status: "agendada", scheduled_at: iso(3, 23) }, hoje));
  assert.ok(!dentroDoIntervalo({ status: "agendada", scheduled_at: iso(4, 0) }, hoje));
  const passado = intervaloReunioes("mes_passado", AGORA);
  assert.ok(dentroDoIntervalo({ status: "realizada", scheduled_at: iso(31, 10, 9) }, passado));
  assert.ok(!dentroDoIntervalo({ status: "realizada", scheduled_at: iso(1) }, passado));
  // domingo pertence à semana que começou na segunda anterior
  assert.equal(inicioDaSemana(new Date(2026, 10, 8, 12)).getDate(), 2);
});

test("resumo conta situação, SAL, vendas e comparecimento", () => {
  const r = resumirReunioes([
    { status: "realizada", scheduled_at: iso(2), sal: "aceito", venda_valor: 10000 },
    { status: "realizada", scheduled_at: iso(2), sal: "recusado", venda_valor: "0" },
    { status: "no_show", scheduled_at: iso(2) },
    { status: "agendada", scheduled_at: iso(5) },
    { status: "agendada", scheduled_at: iso(1) },
  ], AGORA);
  assert.equal(r.total, 5);
  assert.equal(r.porSituacao.realizada, 2);
  assert.equal(r.porSituacao.vai_acontecer, 1);
  assert.equal(r.porSituacao.sem_desfecho, 1);
  assert.equal(r.salAceito, 1);
  assert.equal(r.salRecusado, 1);
  assert.equal(r.vendas, 1);
  assert.equal(r.valorVendido, 10000);
  assert.equal(Math.round(r.comparecimento!), 67);
  assert.equal(resumirReunioes([], AGORA).comparecimento, null);
});

test("agrupa por dia na ordem pedida e monta a faixa seg→dom", () => {
  const lista = [
    { status: "agendada", scheduled_at: iso(4, 9) },
    { status: "agendada", scheduled_at: iso(3, 18) },
    { status: "realizada", scheduled_at: iso(3, 9) },
    { status: "arquivada", scheduled_at: iso(5, 9) },
  ];
  const g = agruparPorDia(lista, true);
  assert.deepEqual(g.map((x) => [x.dia.getDate(), x.itens.length]), [[3, 2], [4, 1], [5, 1]]);
  assert.equal(agruparPorDia(lista, false)[0].dia.getDate(), 5);
  const f = faixaDaSemana(lista, AGORA);
  assert.equal(f.length, 7);
  assert.equal(f[1].total, 2); // terça
  assert.equal(f[1].abertas, 1);
  assert.equal(f[3].total, 0); // quinta: a arquivada não conta
});

test("ritmo da meta usa dias úteis (seg–sex) e o que falta por dia", () => {
  // nov/2026 tem 21 dias úteis; dia 3 (terça) com meio dia = 1,5 passados
  assert.ok(Math.abs(fracaoDoMesUtil(AGORA) - 1.5 / 21) < 1e-9);
  assert.equal(diasUteisRestantes(AGORA), 20);
  const r = ritmoDaMeta(3, 42, AGORA)!;
  assert.equal(r.ideal, 3);
  assert.equal(r.tom, "ok");
  assert.equal(r.falta, 39);
  assert.equal(r.porDia, 2);
  assert.equal(ritmoDaMeta(4, 63, AGORA)!.tom, "warn"); // ideal 4,5; 4 ≥ 3,6
  assert.equal(ritmoDaMeta(2, 42, AGORA)!.tom, "danger"); // 2 < 2,4
  assert.equal(ritmoDaMeta(5, null, AGORA), null);
});

test("série diária preenche dias sem nada com zero", () => {
  const s = serieDiaria([iso(2), iso(2, 15), iso(4), null, iso(20)], "2026-11-01", "2026-11-04");
  assert.deepEqual(s.map((x) => x.n), [0, 2, 0, 1]);
});

test("ranking: marcadas pela criação, realizadas/SAL pela data, sem retomada nem quem não é SDR", () => {
  const sdrs = [{ id: "a", name: "Ana" }, { id: "b", name: "Bia" }];
  const base = { created_at: iso(2), scheduled_at: iso(2) };
  const r = rankingPorReunioes([
    { ...base, owner_id: "a", status: "realizada", sal: "aceito" },
    { ...base, owner_id: "a", status: "agendada", scheduled_at: iso(10) },
    { ...base, owner_id: "a", status: "realizada", tipo: "retomada" },
    { ...base, owner_id: "b", status: "realizada" },
    { ...base, owner_id: "b", status: "realizada" },
    { ...base, owner_id: "b", status: "arquivada" },
    { ...base, owner_id: "x", status: "realizada" },
    { owner_id: "a", status: "realizada", created_at: iso(20, 10, 9), scheduled_at: iso(20, 10, 9) },
  ], sdrs, "2026-11-01", "2026-11-30", AGORA);
  assert.deepEqual(r.map((l) => [l.id, l.marcadas, l.realizadas, l.sal]), [["b", 2, 2, 0], ["a", 2, 1, 1]]);
});
