// Regras puras do quadro de conteúdo do Marketing (0240).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/mkt/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILTROS_PADRAO, colunaAceitaCardNovo, colunaDeEntrada, comentarioDeDevolucaoOk, contarFiltros, dataCurta, distintos,
  estaAtrasado, filtrarBiblioteca, gradeDoMes, lerTags, ordemAoSoltar, ordemEntre, passaNoFiltro, podeMover, porDia,
  progressoChecklist, semanaDe, somarDias,
} from "../../src/mkt/conteudo/regras.ts";
import type { CardMkt, Coluna } from "../../src/mkt/conteudo/tipos.ts";

const HOJE = "2026-10-30";

function card(p: Partial<CardMkt> = {}): CardMkt {
  return {
    id: "c1", titulo: "Reels Japão", descricao: null, tipo: "reels", origem: "organico", eh_pedido: false,
    coluna_id: "k1", ordem: 1000, responsavel_id: null, solicitante_id: null, prazo: null, data_publicacao: null,
    expedicao_id: null, destino: null, tags: [], checklist: [], link_publicacao: null, original_id: null,
    rodada: 0, status_aprovacao: "sem", aprovado_por: null, aprovado_em: null, arquivado: false,
    criado_por: null, criado_em: "2026-10-30T12:00:00Z", atualizado_em: "2026-10-30T12:00:00Z", ...p,
  };
}

test("ordem: entre vizinhos, no começo, no fim e em coluna vazia", () => {
  assert.equal(ordemEntre(null, null), 1000);
  assert.equal(ordemEntre(null, 10), 9);
  assert.equal(ordemEntre(10, null), 11);
  assert.equal(ordemEntre(10, 20), 15);
});

test("ordem ao soltar: antes do alvo, ou no fim", () => {
  const col = [{ id: "a", ordem: 10 }, { id: "b", ordem: 20 }, { id: "c", ordem: 30 }];
  assert.equal(ordemAoSoltar(col, "a"), 9);
  assert.equal(ordemAoSoltar(col, "b"), 15);
  assert.equal(ordemAoSoltar(col, null), 31);
  assert.equal(ordemAoSoltar([], null), 1000);
  assert.equal(ordemAoSoltar(col, "sumiu"), 31);
});

test("datas: soma no calendário e data curta", () => {
  assert.equal(somarDias("2026-10-30", 3), "2026-11-02");
  assert.equal(somarDias("2026-03-01", -1), "2026-02-28");
  assert.equal(dataCurta("2026-11-02", HOJE), "02/11");
  assert.equal(dataCurta("2027-01-05", HOJE), "05/01/2027");
});

test("atrasado: prazo passou e não foi publicado/arquivado", () => {
  assert.equal(estaAtrasado(card({ prazo: "2026-10-29" }), "livre", HOJE), true);
  assert.equal(estaAtrasado(card({ prazo: "2026-10-30" }), "livre", HOJE), false); // vence hoje: ainda não
  assert.equal(estaAtrasado(card({ prazo: "2026-10-29" }), "publicado", HOJE), false);
  assert.equal(estaAtrasado(card({ prazo: "2026-10-29", arquivado: true }), "livre", HOJE), false);
  assert.equal(estaAtrasado(card({ prazo: "2026-10-29" }), "aprovado", HOJE), true); // aprovado mas não publicado
  assert.equal(estaAtrasado(card(), "livre", HOJE), false);
});

test("filtros: área, responsável, tipo, prazo, atrasados e busca sem acento", () => {
  const c = card({ origem: "trafego", responsavel_id: "u1", tipo: "criativo_anuncio", prazo: "2026-11-03", tags: ["Peru"] });
  assert.equal(passaNoFiltro(c, FILTROS_PADRAO, "livre", HOJE), true);
  assert.equal(passaNoFiltro(c, { ...FILTROS_PADRAO, origem: "organico" }, "livre", HOJE), false);
  assert.equal(passaNoFiltro(c, { ...FILTROS_PADRAO, responsavel: "u2" }, "livre", HOJE), false);
  assert.equal(passaNoFiltro(c, { ...FILTROS_PADRAO, responsavel: "ninguem" }, "livre", HOJE), false);
  assert.equal(passaNoFiltro(card(), { ...FILTROS_PADRAO, responsavel: "ninguem" }, "livre", HOJE), true);
  assert.equal(passaNoFiltro(c, { ...FILTROS_PADRAO, tipo: "reels" }, "livre", HOJE), false);
  assert.equal(passaNoFiltro(c, { ...FILTROS_PADRAO, prazo: "semana" }, "livre", HOJE), true);
  assert.equal(passaNoFiltro(c, { ...FILTROS_PADRAO, prazo: "hoje" }, "livre", HOJE), false);
  assert.equal(passaNoFiltro(c, { ...FILTROS_PADRAO, prazo: "sem_prazo" }, "livre", HOJE), false);
  assert.equal(passaNoFiltro(c, { ...FILTROS_PADRAO, soAtrasados: true }, "livre", HOJE), false);
  assert.equal(passaNoFiltro(card({ titulo: "Expedição Japão" }), { ...FILTROS_PADRAO, busca: "japao" }, "livre", HOJE), true);
  assert.equal(passaNoFiltro(c, { ...FILTROS_PADRAO, busca: "peru" }, "livre", HOJE), true);
  assert.equal(contarFiltros({ ...FILTROS_PADRAO, origem: "trafego", soAtrasados: true, busca: " x " }), 3);
});

test("aprovação: quem não aprova não tira da aprovação nem aprova", () => {
  assert.deepEqual(podeMover("livre", "aprovacao", false, "sem"), { ok: true, acao: "pedir_aprovacao" });
  assert.equal(podeMover("aprovacao", "aprovado", false, "pendente").ok, false);
  assert.equal(podeMover("aprovacao", "ajustes", false, "pendente").ok, false);
  assert.equal(podeMover("aprovacao", "livre", false, "pendente").ok, false);
  assert.equal(podeMover("livre", "aprovado", false, "sem").ok, false);
  assert.equal(podeMover("ajustes", "publicado", false, "devolvido").ok, false);
});

test("aprovação: o aprovador aprova, devolve e não pula pra outra coluna", () => {
  assert.deepEqual(podeMover("aprovacao", "aprovado", true, "pendente"), { ok: true, acao: "aprovar" });
  assert.deepEqual(podeMover("aprovacao", "ajustes", true, "pendente"), { ok: true, acao: "devolver" });
  assert.equal(podeMover("aprovacao", "livre", true, "pendente").ok, false);
  assert.deepEqual(podeMover("livre", "aprovado", true, "sem"), { ok: true, acao: "aprovar" });
});

test("publicar só o aprovado; reabrir um aprovado é permitido", () => {
  assert.deepEqual(podeMover("aprovado", "publicado", false, "aprovado"), { ok: true, acao: "publicar" });
  assert.deepEqual(podeMover("aprovado", "livre", false, "aprovado"), { ok: true, acao: "reabrir" });
  assert.deepEqual(podeMover("livre", "ajustes", false, "sem"), { ok: true, acao: "mover" });
});

test("devolução exige comentário", () => {
  assert.equal(comentarioDeDevolucaoOk(""), false);
  assert.equal(comentarioDeDevolucaoOk("  ok "), false);
  assert.equal(comentarioDeDevolucaoOk("Trocar a música"), true);
});

test("card novo só nas colunas de trabalho; entrada é a do tipo 'entrada'", () => {
  assert.equal(colunaAceitaCardNovo("entrada"), true);
  assert.equal(colunaAceitaCardNovo("livre"), true);
  assert.equal(colunaAceitaCardNovo("aprovacao"), false);
  assert.equal(colunaAceitaCardNovo("publicado"), false);
  const cols: Coluna[] = [
    { id: "b", nome: "Roteiro", ordem: 20, cor: null, tipo: "livre" },
    { id: "a", nome: "Ideia", ordem: 10, cor: null, tipo: "entrada" },
  ];
  assert.equal(colunaDeEntrada(cols)?.id, "a");
  assert.equal(colunaDeEntrada([cols[0]])?.id, "b");
});

test("checklist e tags", () => {
  assert.deepEqual(progressoChecklist([{ feito: true }, { feito: false }]), { feitos: 1, total: 2 });
  assert.deepEqual(progressoChecklist(null), { feitos: 0, total: 0 });
  assert.deepEqual(lerTags("reels, Japão ,  japão,,"), ["Japão", "reels"]);
  assert.deepEqual(distintos(["Peru", "peru", null, " ", "Chile"]), ["Chile", "Peru"]);
});

test("biblioteca: só aprovado, não arquivado, com filtros", () => {
  const l = [
    card({ id: "1", status_aprovacao: "aprovado", destino: "Japão", tags: ["cultura"] }),
    card({ id: "2", status_aprovacao: "pendente", destino: "Japão" }),
    card({ id: "3", status_aprovacao: "aprovado", destino: "Peru", tipo: "carrossel" }),
    card({ id: "4", status_aprovacao: "aprovado", arquivado: true }),
  ];
  const f = { busca: "", tipo: "todos" as const, destino: "todos", tag: "todas" };
  assert.deepEqual(filtrarBiblioteca(l, f).map((c) => c.id), ["1", "3"]);
  assert.deepEqual(filtrarBiblioteca(l, { ...f, destino: "japao" }).map((c) => c.id), ["1"]);
  assert.deepEqual(filtrarBiblioteca(l, { ...f, tipo: "carrossel" }).map((c) => c.id), ["3"]);
  assert.deepEqual(filtrarBiblioteca(l, { ...f, tag: "Cultura" }).map((c) => c.id), ["1"]);
});

test("calendário: grade do mês domingo-sábado e semana", () => {
  const out = gradeDoMes(2026, 10); // 01/10/2026 é quinta
  assert.equal(out[0][0], "2026-09-27");
  assert.equal(out[0][4], "2026-10-01");
  assert.equal(out[out.length - 1][6], "2026-10-31"); // 31/10/2026 é sábado
  assert.equal(gradeDoMes(2026, 11).at(-1)?.[6], "2026-12-05"); // completa com dezembro
  assert.ok(out.every((s) => s.length === 7));
  assert.equal(gradeDoMes(2026, 2).length, 4); // fevereiro/2026 começa no domingo e tem 28 dias
  assert.deepEqual(semanaDe("2026-10-30"), ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  const m = porDia([card({ id: "a", data_publicacao: "2026-10-30" }), card({ id: "b" }), card({ id: "c", data_publicacao: "2026-10-30" })]);
  assert.deepEqual(m.get("2026-10-30")?.map((c) => c.id), ["a", "c"]);
  assert.equal(m.size, 1);
});
