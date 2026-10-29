// Testes do Cockpit da Expedição (spec §3 e §4.1/4.2). Rodar: ver docs/MAPA-EXPEDICOES.md › Testes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { caminhoDoHash, hashCanonico, resolverRotaCockpit } from "../../src/expedicoes/lib/cockpit/rota.ts";
import { avaliarValidadePassaporte, somarMeses } from "../../src/expedicoes/lib/passaporte.ts";
import { resumoChecklist } from "../../src/expedicoes/lib/checklistResumo.ts";
import {
  acoesDaOperacao, hotelDoDia, montarDiasRoteiro, montarFaixaViagem, proximosDias, tagDoDiaLider, type DiaLiderMin,
} from "../../src/expedicoes/lib/cockpit/viagem.ts";
import {
  contagensMatriz, filtrarMatriz, maioresPendencias, montarMatriz, placarDaMatriz, resumoProntidao, type PaxMatriz,
} from "../../src/expedicoes/lib/cockpit/matriz.ts";
import { cartoesSaude } from "../../src/expedicoes/lib/cockpit/saude.ts";

const ID = "8f1c2a3b-0000-4000-8000-000000000001";

// ── Rota / redirects (§3.2) ──────────────────────────────────────────────────
test("rota: abas antigas no caminho (barra codificada) viram aba nova + seção", () => {
  const casos: [string, string, string | null][] = [
    ["passageiros", "passageiros", null], ["valores", "financeiro", null], ["rooming", "logistica", "rooming"],
    ["checklist", "logistica", "checklist"], ["roteiro-lider", "logistica", "roteiro"], ["grupos", "logistica", "divisoes"],
    ["documentos", "arquivos", "drive"], ["links", "arquivos", "links"], ["portal", "portal", null],
  ];
  for (const [antiga, aba, secao] of casos) {
    const r = resolverRotaCockpit({ caminho: `${ID}/${antiga}`, hash: `#ops/expedicoes/${ID}%2F${antiga}` });
    assert.equal(r.aba, aba, antiga);
    assert.equal(r.secao, secao, antiga);
    assert.equal(r.id, ID);
    assert.equal(r.normalizar, true, antiga);
  }
});

test("rota: barra NORMAL no hash (o app hospedeiro só entrega o id) também redireciona", () => {
  const r = resolverRotaCockpit({ caminho: ID, hash: `#ops/expedicoes/${ID}/rooming` });
  assert.deepEqual([r.aba, r.secao, r.normalizar], ["logistica", "rooming", true]);
  const v = resolverRotaCockpit({ caminho: ID, hash: `#rel/exp-expedicoes/${ID}/valores` });
  assert.equal(v.aba, "financeiro");
});

test("rota: ?aba= nova e antiga", () => {
  const n = resolverRotaCockpit({ caminho: ID, hash: `#ops/expedicoes/${ID}?aba=logistica&secao=checklist` });
  assert.deepEqual([n.aba, n.secao, n.normalizar], ["logistica", "checklist", false]);
  const a = resolverRotaCockpit({ caminho: ID, hash: `#ops/expedicoes/${ID}?aba=rooming` });
  assert.deepEqual([a.aba, a.secao, a.normalizar], ["logistica", "rooming", true]);
  const v = resolverRotaCockpit({ caminho: ID, hash: `#ops/expedicoes/${ID}?aba=valores` });
  assert.equal(v.aba, "financeiro");
  assert.equal(resolverRotaCockpit({ caminho: ID, hash: `#ops/expedicoes/${ID}` }).aba, "geral");
  assert.equal(resolverRotaCockpit({ caminho: ID, hash: `#ops/expedicoes/${ID}?aba=inexistente` }).aba, "geral");
});

test("rota: sub-endereços de Passageiros ficam no caminho", () => {
  const r = resolverRotaCockpit({ caminho: `${ID}/passageiros/pax/p1/perfil`, hash: `#ops/expedicoes/${encodeURIComponent(`${ID}/passageiros/pax/p1/perfil`)}` });
  assert.equal(r.aba, "passageiros");
  assert.deepEqual(r.sub, ["pax", "p1", "perfil"]);
  assert.equal(r.normalizar, false);
  const p = resolverRotaCockpit({ caminho: ID, hash: `#ops/expedicoes/${ID}/passageiros/prontidao/p9` });
  assert.deepEqual(p.sub, ["prontidao", "p9"]);
});

test("rota: pacote não tem Logística", () => {
  const r = resolverRotaCockpit({ caminho: `${ID}/rooming`, hash: null, pacote: true });
  assert.equal(r.aba, "geral");
  assert.equal(r.secao, null);
});

test("rota: caminhoDoHash junta os dois formatos e hashCanonico mantém área/tela", () => {
  assert.equal(caminhoDoHash(`#ops/expedicoes/${ID}%2Fvalores?x=1`), `${ID}/valores`);
  assert.equal(caminhoDoHash(`#ops/expedicoes/${ID}/valores`), `${ID}/valores`);
  assert.equal(caminhoDoHash("#ops/expedicoes"), null);
  assert.equal(hashCanonico(`#ops/expedicoes/${ID}%2Frooming`, ID, "logistica", "rooming"), `#ops/expedicoes/${ID}?aba=logistica&secao=rooming`);
  assert.equal(hashCanonico(`#rel/exp-expedicoes/${ID}`, ID, "geral"), `#rel/exp-expedicoes/${ID}`);
  assert.equal(hashCanonico("#", ID, "geral"), null);
});

// ── Passaporte (regra única) ─────────────────────────────────────────────────
test("passaporte: 6 meses depois da VOLTA (não do embarque)", () => {
  const exp = { data_embarque: "2026-10-26", data_retorno: "2026-11-12" };
  assert.equal(somarMeses("2026-11-12", 6), "2027-05-12");
  assert.equal(somarMeses("2026-08-31", 6), "2027-02-28");
  assert.equal(avaliarValidadePassaporte({ passaporte: "FX1", validade_passaporte: null }, exp).estado, "sem");
  assert.equal(avaliarValidadePassaporte({ passaporte: "", validade_passaporte: "2030-01-01" }, exp).estado, "sem");
  assert.equal(avaliarValidadePassaporte({ passaporte: "FX1", validade_passaporte: "2026-11-01" }, exp).estado, "vence_na_viagem");
  // embarque + 180 d = 24/04/2027 → a regra velha daria OK; volta + 6 m = 12/05/2027 → vence cedo
  assert.equal(avaliarValidadePassaporte({ passaporte: "FX1", validade_passaporte: "2027-05-01" }, exp).estado, "vence_cedo");
  assert.equal(avaliarValidadePassaporte({ passaporte: "FX1", validade_passaporte: "2027-05-12" }, exp).estado, "ok");
  const ok = avaliarValidadePassaporte({ passaporte: "FX1", validade_passaporte: "2030-02-16T00:00:00" }, exp);
  assert.equal(ok.mesAno, "02/2030");
  // sem volta usa o embarque
  assert.equal(avaliarValidadePassaporte({ passaporte: "FX1", validade_passaporte: "2027-04-01" }, { data_embarque: "2026-10-26", data_retorno: null }).estado, "vence_cedo");
});

// ── Checklist (§4.1) ─────────────────────────────────────────────────────────
test("checklist: uma conta só (todas as tarefas), atrasadas pelo prazo", () => {
  const itens = [
    { status: "Concluído", parent_id: null, prazo: "2026-09-01" },
    { status: "Pendente", parent_id: "a", prazo: "2026-10-01" },
    { status: "Pendente", parent_id: "a", prazo: "2026-12-01" },
    { status: "Concluído", parent_id: null },
  ];
  const r = resumoChecklist(itens, "2026-10-29");
  assert.equal(r.total, 4);
  assert.equal(r.concluidas, 2);
  assert.equal(r.pct, 0.5);
  assert.equal(r.atrasadas, 1);
  assert.deepEqual(r.processos, { total: 2, concluidos: 2 }); // o número que inflava o topo
  assert.equal(resumoChecklist([]).pct, 0);
});

// ── Faixa da viagem ──────────────────────────────────────────────────────────
const quartos = [
  { hotel_cidade: "Pequim · Ramada", check_in: "2026-10-27", check_out: "2026-10-28" },
  { hotel_cidade: "Tóquio · KOKO", check_in: "2026-10-28", check_out: "2026-10-31" },
  { hotel_cidade: "Tóquio · KOKO", check_in: "2026-10-28", check_out: "2026-10-31" },
  { hotel_cidade: "Osaka · Hiyori", check_in: "2026-10-31", check_out: "2026-11-07" },
  { hotel_cidade: "Pequim · Sunworld", check_in: "2026-11-07", check_out: "2026-11-12" },
  { hotel_cidade: "Cancelado", check_in: "2026-10-26", check_out: "2026-11-12", status: "cancelado" },
  { hotel_cidade: "Sem datas", check_in: null, check_out: null },
];

test("faixa: dias, hoje destacado, hotéis pelas datas reais e pistas alternadas", () => {
  const f = montarFaixaViagem({ inicio: "2026-10-26", fim: "2026-11-12", hoje: "2026-10-29", quartos });
  assert.equal(f.dias.length, 18);
  assert.equal(f.dias[3].estado, "hoje");
  assert.equal(f.dias[2].estado, "passado");
  assert.equal(f.hoteis, 4);
  assert.equal(f.semDatas, 1);
  const toquio = f.barras.find((b) => b.nome === "Tóquio · KOKO")!;
  assert.deepEqual([toquio.colIni, toquio.colFim, toquio.quartos], [3, 7, 2]); // 28/10 (D3) até 31/10 (D6)
  const pequim = f.barras.find((b) => b.nome === "Pequim · Ramada")!;
  assert.notEqual(pequim.pista, toquio.pista); // dividem o dia 28 → pistas diferentes
  const voo = f.barras.find((b) => b.tipo === "voo")!;
  assert.deepEqual([voo.colIni, voo.colFim], [1, 3]); // D1 sem hotel, encosta no check-in do D2
  assert.equal(f.pistas, 2);
  assert.equal(hotelDoDia(f.barras, "2026-10-29")?.nome, "Tóquio · KOKO");
  assert.equal(hotelDoDia(f.barras, "2026-10-31")?.nome, "Osaka · Hiyori"); // noite do dia 31
  assert.equal(hotelDoDia(f.barras, "2026-11-12")?.nome, "Pequim · Sunworld"); // último dia: check-out
});

test("faixa: sem hotel nenhum mostra só os dias; sem datas não quebra", () => {
  const f = montarFaixaViagem({ inicio: "2026-10-26", fim: "2026-10-28", hoje: "2026-10-01", quartos: [] });
  assert.equal(f.dias.length, 3);
  assert.equal(f.barras.length, 0);
  assert.equal(montarFaixaViagem({ inicio: null, fim: null, hoje: "2026-10-01", quartos }).dias.length, 0);
});

// ── Roteiro, próximos dias, tags e ações ─────────────────────────────────────
const lider = (o: Partial<DiaLiderMin> & { id: string }): DiaLiderMin => ({
  dia: null, data: null, local: null, programacao: null, lideres_ativos: null, pax: null,
  alerta_nivel: null, alerta_texto: null, alerta_acao: null, alerta_responsavel: null, ...o,
});

test("roteiro: junta portal + líder pela data (ou nº do dia)", () => {
  const dias = montarDiasRoteiro({
    inicio: "2026-10-26",
    portal: [{ dia: 4, data: "2026-10-29", titulo: "Tóquio: Asakusa e Akihabara", cidade: "Tóquio" }, { dia: 5, data: null, titulo: "Meiji e Shibuya", cidade: null }],
    lider: [
      lider({ id: "l4", dia: 4, data: "2026-10-29", programacao: "Tóquio, dia 1", lideres_ativos: "Everton · Jacqueline" }),
      lider({ id: "l6", dia: 6, data: "2026-10-31", local: "Osaka", programacao: "Monte Fuji → Osaka\nsegunda linha", alerta_nivel: "Crítico", alerta_acao: "Troca de líderes" }),
    ],
  });
  assert.equal(dias.length, 3);
  assert.equal(dias[0].titulo, "Tóquio: Asakusa e Akihabara"); // o título do portal vence
  assert.equal(dias[0].lideres, "Everton · Jacqueline");
  assert.equal(dias[1].data, "2026-10-30"); // D5 sem data → embarque + 4
  assert.equal(dias[2].titulo, "Monte Fuji → Osaka");
  assert.equal(dias[2].alerta?.nivel, "critico");
  assert.deepEqual(proximosDias(dias, "2026-10-29").map((d) => d.n), [5, 6]);
});

test("roteiro do líder: tags OK / Verificar / Atenção / Crítico / Hoje", () => {
  assert.equal(tagDoDiaLider({ data: "2026-10-29", alerta_nivel: "Crítico" }, "2026-10-29").rotulo, "Hoje");
  assert.equal(tagDoDiaLider({ data: "2026-10-31", alerta_nivel: "Crítico" }, "2026-10-29").tom, "danger");
  assert.equal(tagDoDiaLider({ data: null, alerta_nivel: "Atencao" }, "2026-10-29").rotulo, "Atenção");
  assert.equal(tagDoDiaLider({ data: null, alerta_nivel: "Verificar" }, "2026-10-29").rotulo, "Verificar");
  assert.equal(tagDoDiaLider({ data: null, alerta_nivel: null }, "2026-10-29").rotulo, "OK");
});

test("ações da operação: futuras por severidade, passadas como 'Sem baixa'", () => {
  const a = acoesDaOperacao([
    lider({ id: "1", dia: 1, data: "2026-10-26", alerta_nivel: "Atenção", alerta_acao: "Confirmar 7 pax" }),
    lider({ id: "3", dia: 3, data: "2026-10-28", alerta_nivel: "Crítico", alerta_texto: "Aeroportos diferentes" }),
    lider({ id: "6", dia: 6, data: "2026-10-31", alerta_nivel: "Crítico", alerta_acao: "Troca de líderes", alerta_texto: "Luis vai pro G1", alerta_responsavel: "Operações" }),
    lider({ id: "7", dia: 7, data: "2026-11-01", alerta_nivel: "Verificar", alerta_acao: "Reconfirmar trem" }),
    lider({ id: "8", dia: 8, data: "2026-11-02", alerta_nivel: "Crítico" }), // sem texto nem ação: não entra
    lider({ id: "9", dia: 9, data: "2026-11-03", alerta_nivel: "Crítico", alerta_acao: "Já resolvida" }),
  ].map((d) => (d.id === "9" ? { ...d, resolvida: true } : d)), "2026-10-29");
  assert.deepEqual(a.map((x) => x.id), ["6", "7", "3", "1"]);
  assert.equal(a[0].tag, "Crítico");
  assert.equal(a[0].titulo, "Dia 6 · 31/10 · Troca de líderes");
  assert.equal(a[0].descricao, "Luis vai pro G1");
  assert.equal(a[0].responsavel, "Operações");
  assert.equal(a[2].tag, "Sem baixa");
  assert.equal(a[2].tom, "warn");
});

// ── Matriz + placar + prontidão pós-embarque ─────────────────────────────────
const EXP = { data_embarque: "2026-12-01", data_retorno: "2026-12-15" };
const pax = (o: Partial<PaxMatriz> & { id: string }): PaxMatriz => ({
  nome: o.id, tipo: "Pagante", status_reserva: "Confirmado", passaporte: "FX1", validade_passaporte: "2031-01-01", preencheu: true,
  quarto: { rotulo: "Quarto 1", completo: true }, valor_contratado_brl: 20000, valor_pago_brl: 0,
  checagens: [{ tipo: "Seguro", semaforo: "bloqueio" }], requisitos: [{ tipo: "Seguro", status: "Pendente", arquivo_id: null }], ...o,
});
const lista = [
  pax({ id: "Ana" }),
  pax({ id: "Bia", preencheu: false, validade_passaporte: "2027-03-01", requisitos: [{ tipo: "Seguro", status: "Aprovado", arquivo_id: "arq" }], valor_contratado_brl: 0 }),
  pax({ id: "Everton", tipo: "Líder", valor_contratado_brl: 0, quarto: { rotulo: null, completo: false } }),
  pax({ id: "Zé", status_reserva: "Cancelado" }),
];

test("matriz: líderes primeiro, cancelado fora, células e placar por coluna", () => {
  const m = montarMatriz(lista, EXP, "embarque");
  assert.deepEqual(m.map((l) => l.pax.id), ["Everton", "Ana", "Bia"]);
  const bia = m[2].celulas;
  assert.equal(bia.passaporte.tom, "danger"); // vence < 6 meses após a volta
  assert.equal(bia.passaporte.rotulo, "Vence 03/2027");
  assert.equal(bia.seguro.rotulo, "Apólice");
  assert.equal(bia.formulario.rotulo, "Pendente");
  assert.equal(bia.pagamento.rotulo, "Sem valor");
  assert.equal(m[0].celulas.pagamento.rotulo, "Isento");
  assert.equal(m[0].celulas.visto.rotulo, "Não precisa");
  const p = placarDaMatriz(m);
  assert.equal(p.passaporte.texto, "2/3 válidos");
  assert.equal(p.passaporte.tom, "danger");
  assert.equal(p.seguro.texto, "1/3");
  assert.equal(p.formulario.texto, "2/3");
  assert.equal(p.quarto.texto, "2/3");
  assert.equal(p.pagamento.texto, "1/2 com valor");
  assert.equal(p.pagamento.tom, "danger");
  assert.equal(p.visto.texto, "não exigido");
  const c = contagensMatriz(m);
  assert.deepEqual(c, { todos: 3, pendencia: 3, formulario: 1, seguro: 2, lideres: 1 });
  assert.deepEqual(filtrarMatriz(m, "formulario").map((l) => l.pax.id), ["Bia"]);
  assert.deepEqual(maioresPendencias(m).map((x) => x.texto), ["2 sem seguro", "1 com passaporte a resolver", "1 sem formulário"]);
});

test("§4.2: em viagem a prontidão não bloqueia — só pendência administrativa", () => {
  const m = montarMatriz(lista, EXP, "em_viagem");
  const bia = m.find((l) => l.pax.id === "Bia")!.celulas;
  assert.equal(bia.passaporte.tom, "neutral");
  assert.equal(bia.formulario.pendente, false);
  const ana = m.find((l) => l.pax.id === "Ana")!.celulas;
  assert.equal(ana.seguro.tom, "warn"); // a apólice que faltou continua aparecendo
  assert.equal(placarDaMatriz(m).passaporte.tom, "ok");

  const resultados = [
    { prontidao: "Bloqueado", checagens: [{ tipo: "Seguro", semaforo: "bloqueio" }, { tipo: "Passaporte", semaforo: "ok" }] },
    { prontidao: "Bloqueado", checagens: [{ tipo: "Seguro", semaforo: "bloqueio" }] },
    { prontidao: "Apto", checagens: [] },
  ];
  const antes = resumoProntidao("embarque", resultados);
  assert.deepEqual(antes, { modo: "prontidao", total: 3, aptos: 1, atencao: 0, bloqueados: 2 });
  const depois = resumoProntidao("em_viagem", resultados);
  assert.equal(depois.modo, "administrativo");
  if (depois.modo === "administrativo") {
    assert.equal(depois.comPendencia, 2);
    assert.deepEqual(depois.porTipo, [{ tipo: "Seguro", qtd: 2 }]);
  }
});

// ── Saúde ────────────────────────────────────────────────────────────────────
test("saúde: 4 cartões com tag e destino; pacote sem checklist", () => {
  const m = montarMatriz(lista, EXP, "embarque");
  const ck = resumoChecklist([{ status: "Concluído" }, { status: "Pendente", prazo: "2026-10-01" }], "2026-10-29");
  const c = cartoesSaude({ fase: "embarque", pacote: false, confirmados: 2, planejados: 2, linhas: m, checklist: ck });
  assert.deepEqual(c.map((x) => [x.id, x.tag]), [["ocupacao", "OK"], ["seguro", "Pendente"], ["financeiro", "Pendente"], ["checklist", "Atrasado"]]);
  assert.equal(c[0].sub, "esgotada · líderes não contam");
  assert.equal(c[3].aba, "logistica");
  assert.equal(c[3].secao, "checklist");
  const p = cartoesSaude({ fase: "vendendo", pacote: true, confirmados: 1, planejados: 10, linhas: [], checklist: null });
  assert.deepEqual(p.map((x) => [x.id, x.tag]), [["ocupacao", "Pendente"], ["seguro", "Sem dados"], ["financeiro", "Sem dados"]]);
});

test("fase × status manual: aviso só quando divergem", async () => {
  const { divergenciaStatus } = await import("../../src/expedicoes/lib/fase.ts");
  assert.equal(divergenciaStatus("Em andamento", "em_viagem"), null);
  assert.equal(divergenciaStatus("Vendas Abertas", "preparacao"), null);
  assert.equal(divergenciaStatus("Cancelada", "em_viagem"), null);
  assert.match(divergenciaStatus("Vendas Abertas", "em_viagem") ?? "", /em viagem/);
  assert.match(divergenciaStatus("Em andamento", "concluida") ?? "", /acabou/);
  assert.match(divergenciaStatus("Concluída", "embarque") ?? "", /embarque/);
});

test("rota: caminho velho do hospedeiro (depois de replaceState) perde pro hash", () => {
  // O hospedeiro ainda acha que está na gaveta do pax; o hash já foi trocado pra Logística.
  const r = resolverRotaCockpit({ caminho: `${ID}/passageiros/pax/p1`, hash: `#ops/expedicoes/${ID}?aba=logistica` });
  assert.equal(r.aba, "logistica");
  assert.equal(r.normalizar, false);
  assert.deepEqual(r.sub, []);
  // Hash de OUTRA expedição não sobrescreve o caminho.
  const r2 = resolverRotaCockpit({ caminho: `${ID}/valores`, hash: "#ops/expedicoes/outra?aba=portal" });
  assert.equal(r2.aba, "financeiro");
});
