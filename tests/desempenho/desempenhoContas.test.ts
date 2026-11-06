// Desempenho SDR (spec 06/11): contas puras das páginas 1–3.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brl, comparecimento, duracaoTxt, iniciais, normalizarBloco, ondeVaza, passagens, pctTxt, pontoDeAtencao,
  produtosReuniao, taxa, taxaReagendamento, taxaSal, tempoHumano, type FunilSdr,
} from "../../src/lib/qs/desempenhoContas";

const funil = (p: Partial<FunilSdr>): FunilSdr => ({
  recebeu: 0, trabalhou: 0, falou: 0, marcou: 0, aconteceu: 0, sla_medidos: 0, sla_na_meta: 0, sla_mediana_min: null, ...p,
});

test("normaliza o que o banco manda nulo (SDR sem cotação, sem cadência)", () => {
  const b = normalizarBloco({ cotacoes: null as never, reunioes: { marcadas: 3 } as never });
  assert.equal(b.cotacoes.aprovadas, 0);
  assert.equal(b.reunioes.marcadas, 3);
  assert.equal(b.reunioes.rr, 0);
  assert.deepEqual(b.produtos, []);
  assert.equal(normalizarBloco(null).cadencia.em_trabalho, 0);
});

test("taxas das reuniões seguem as definições da spec", () => {
  const r = normalizarBloco({ reunioes: { marcadas: 30, rr: 11, futuras: 12, no_show: 2, canceladas: 5, sem_desfecho: 0, reagendadas: 7, sal_aceito: 9 } as never }).reunioes;
  // comparecimento: R.R ÷ as que já passaram (sem futuras, sem canceladas)
  assert.equal(comparecimento(r), 11 / 13);
  assert.equal(taxaReagendamento(r), 7 / 30);
  assert.equal(taxaSal(r), 9 / 11);
  assert.equal(taxa(1, 0), null);
});

test("formatos", () => {
  assert.equal(pctTxt(0.0512, 1), "5,1%");
  assert.equal(pctTxt(null), "—");
  assert.equal(brl(0), "R$ —");
  assert.match(brl(139992), /139\.992/);
  assert.equal(tempoHumano(828), "13h48");
  assert.equal(tempoHumano(25), "25 min");
  assert.equal(duracaoTxt(34), "34s");
  assert.equal(duracaoTxt(10026), "2h47");
  assert.equal(iniciais("Victor Hugo"), "VH");
  assert.equal(iniciais("Yanca Manuella Ruivo"), "YM");
});

test("passagens: cada etapa sobre a anterior", () => {
  const p = passagens(funil({ recebeu: 60, trabalhou: 55, falou: 21, marcou: 6, aconteceu: 3 }));
  assert.equal(p[0], 1);
  assert.equal(p[2], 21 / 55);
  assert.equal(p[4], 0.5);
});

test("onde vaza: maior queda contra o time; nada quando está acima ou sem volume", () => {
  const time = funil({ recebeu: 175, trabalhou: 165, falou: 51, marcou: 18, aconteceu: 6 });
  const mariana = funil({ recebeu: 61, trabalhou: 56, falou: 23, marcou: 6, aconteceu: 3 });
  // falou 41% (time 31%) ok; marcou 26% (time 35%) é a pior; aconteceu 50% (time 33%) ok
  assert.equal(ondeVaza(mariana, time), 3);
  assert.equal(ondeVaza(time, time), null);
  assert.equal(ondeVaza(funil({ recebeu: 3, trabalhou: 0 }), time), null);
});

test("ponto de atenção escolhe o maior gap negativo", () => {
  const time = normalizarBloco({
    funil: funil({ recebeu: 175, trabalhou: 165, falou: 51, marcou: 18, aconteceu: 6, sla_mediana_min: 600 }),
    atividades: { programadas: 500, concluidas: 150, atrasadas: 300 },
  });
  const yanca = normalizarBloco({
    funil: funil({ recebeu: 60, trabalhou: 56, falou: 14, marcou: 8, aconteceu: 1, sla_mediana_min: 650 }),
    atividades: { programadas: 50, concluidas: 20, atrasadas: 280 },
  });
  assert.match(pontoDeAtencao(yanca, time, 3), /280 atividades atrasadas/);
  const naMedia = normalizarBloco({ funil: time.funil, atividades: { programadas: 160, concluidas: 50, atrasadas: 100 } });
  assert.match(pontoDeAtencao(naMedia, time, 3), /Sem ponto fora da curva/);
});

test("produtos da rota reunião: sempre os 3, sem aéreo", () => {
  const ps = produtosReuniao([{ produto: "outros", marcadas: 30, rr: 11, no_show: 2, sal_aceito: 9, sal_recusado: 2, inferidas: 30, forcash: 1 },
    { produto: "aereo", marcadas: 1, rr: 0, no_show: 0, sal_aceito: 0, sal_recusado: 0, inferidas: 0, forcash: 0 }]);
  assert.deepEqual(ps.map((p) => p.produto), ["expedicao", "pacote", "outros"]);
  assert.equal(ps[0].marcadas, 0);
  assert.equal(ps[2].marcadas, 30);
});
