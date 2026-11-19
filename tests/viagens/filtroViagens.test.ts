// Testes da aba "Filtrar" das Viagens (src/rel/lib/filtroViagens.ts).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/viagens/filtroViagens.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILTRO_PADRAO, condicoesDaSituacao, condicoesDeData, colunaDeOrdem, grupoDaBusca, grupoDosServicos, intervaloDoPeriodo, juntarGrupos, lerFiltro, quantosAtivos,
} from "../../src/rel/lib/filtroViagens.ts";

const base = { de: "", ate: "" };

test("períodos rápidos a partir de hoje", () => {
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "hoje" }, "2026-11-19"), { de: "2026-11-19", ate: "2026-11-19" });
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "7d" }, "2026-11-19"), { de: "2026-11-19", ate: "2026-11-25" });
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "30d" }, "2026-11-19"), { de: "2026-11-19", ate: "2026-12-18" });
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "este_mes" }, "2026-11-19"), { de: "2026-11-01", ate: "2026-11-30" });
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "tudo" }, "2026-11-19"), { de: null, ate: null });
});

test("próximo mês vira o ano em dezembro e acerta fevereiro", () => {
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "prox_mes" }, "2026-12-10"), { de: "2027-01-01", ate: "2027-01-31" });
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "prox_mes" }, "2028-01-31"), { de: "2028-02-01", ate: "2028-02-29" });
});

test("período livre usa de/até (vazio = sem limite)", () => {
  assert.deepEqual(intervaloDoPeriodo({ periodo: "livre", de: "2026-12-01", ate: "" }, "2026-11-19"), { de: "2026-12-01", ate: null });
});

test("em andamento: embarca até o fim E volta depois do início (sem volta: embarca depois do início)", () => {
  const c = condicoesDeData("durante", "2026-11-19", "2026-11-25");
  assert.deepEqual(c.simples, [{ coluna: "data_embarque", op: "lte", valor: "2026-11-25" }]);
  assert.equal(c.grupo, "or(data_retorno.gte.2026-11-19,and(data_retorno.is.null,data_embarque.gte.2026-11-19))");
  assert.deepEqual(condicoesDeData("durante", null, null), { simples: [], grupo: null });
});

test("embarque/volta/venda filtram a coluna certa; próximo voo usa o dia de SP", () => {
  assert.deepEqual(condicoesDeData("volta", "2026-11-01", "2026-11-30").simples.map((c) => c.coluna), ["data_retorno", "data_retorno"]);
  assert.deepEqual(condicoesDeData("venda", "2026-11-01", null).simples, [{ coluna: "data_venda", op: "gte", valor: "2026-11-01" }]);
  assert.deepEqual(condicoesDeData("proximo_voo", "2026-11-19", "2026-11-19").simples, [
    { coluna: "proximo_voo_em", op: "gte", valor: "2026-11-19T00:00:00-03:00" },
    { coluna: "proximo_voo_em", op: "lt", valor: "2026-11-20T00:00:00-03:00" },
  ]);
  assert.deepEqual(colunaDeOrdem("venda"), { coluna: "data_venda", asc: false });
});

test("serviço: vários de uma vez + sem classificação (null)", () => {
  assert.equal(grupoDosServicos([]), null);
  assert.equal(grupoDosServicos(["pacote", "aereo"]), "or(servico.in.(pacote,aereo))");
  assert.equal(grupoDosServicos(["sem_classificacao"]), "or(servico.is.null)");
  assert.equal(grupoDosServicos(["hospedagem", "sem_classificacao"]), "or(servico.in.(hospedagem),servico.is.null)");
});

test("busca limpa o que quebra o or= e aceita nº do Bitrix", () => {
  assert.equal(grupoDaBusca("  "), null);
  assert.equal(grupoDaBusca("Ana, (Japão)"), "or(titulo.ilike.*Ana   Japão*,destino.ilike.*Ana   Japão*,expedicao.ilike.*Ana   Japão*,cliente_nome.ilike.*Ana   Japão*,bitrix_deal_id.eq.0)");
  assert.match(grupoDaBusca("48021")!, /bitrix_deal_id\.eq\.48021\)$/);
});

test("um or= só: 1 grupo vai solto, vários viram and(...)", () => {
  assert.equal(juntarGrupos([null, null]), null);
  assert.equal(juntarGrupos(["or(a.eq.1,b.eq.2)", null]), "a.eq.1,b.eq.2");
  assert.equal(juntarGrupos(["or(a.eq.1)", "or(b.eq.2,c.is.null)"]), "and(or(a.eq.1),or(b.eq.2,c.is.null))");
});

test("situação", () => {
  assert.deepEqual(condicoesDaSituacao("ativas"), { status: "ativa", fases: ["antes", "em_viagem"] });
  assert.deepEqual(condicoesDaSituacao("concluidas"), { fases: ["concluida"] });
  assert.deepEqual(condicoesDaSituacao("todas"), {});
});

test("filtro guardado: lixo volta pro padrão e a busca não fica", () => {
  assert.deepEqual(lerFiltro(null), FILTRO_PADRAO);
  assert.deepEqual(lerFiltro("{quebrado"), FILTRO_PADRAO);
  const f = lerFiltro(JSON.stringify({ campo: "volta", periodo: "livre", de: "2026-12-01", ate: "x", servicos: ["aereo", "nada"], tem: ["voo_interno", "?"], dono: "minhas", busca: "ana" }));
  assert.equal(f.campo, "volta"); assert.equal(f.de, "2026-12-01"); assert.equal(f.ate, "");
  assert.deepEqual(f.servicos, ["aereo"]); assert.deepEqual(f.tem, ["voo_interno"]); assert.equal(f.busca, "");
  assert.equal(quantosAtivos(FILTRO_PADRAO), 0);
  assert.equal(quantosAtivos(f), 4);
});
