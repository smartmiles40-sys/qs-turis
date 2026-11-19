// Testes do filtro do Painel de Viagens (src/rel/lib/filtroViagens.ts).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/viagens/filtroViagens.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILTRO_PADRAO, alternarTem, contarOpcoes, contarPorSemana, semanasDaLinha, intervaloDoPeriodo, lerFiltro, passaNaBusca, passaNaData, passaNoFiltro, quantosAtivos,
  type FiltroPainel, type ViagemFiltravel,
} from "../../src/rel/lib/filtroViagens.ts";

const base = { de: "", ate: "" };
const V = (p: Partial<ViagemFiltravel> = {}): ViagemFiltravel => ({
  id: "v1", servico: "pacote", data_embarque: "2026-12-01", data_retorno: "2026-12-10", data_venda: "2026-11-02", proximo_voo_em: null,
  responsavel_id: null, fase: "antes", titulo: "Japão", destino: "Tóquio", expedicao: null, cliente_nome: "Ana Souza", bitrix_deal_id: "48021",
  voos_internos: 0, voos_total: 2, ...p,
} as ViagemFiltravel);
const ctx = { hoje: "2026-11-19", userId: "eu", tiposDoRoteiro: new Map([["v1", new Set(["hospedagem", "voo_internacional"])]]) };
const F = (p: Partial<FiltroPainel>): FiltroPainel => ({ ...FILTRO_PADRAO, ...p });

test("períodos rápidos a partir de hoje", () => {
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "hoje" }, "2026-11-19"), { de: "2026-11-19", ate: "2026-11-19" });
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "7d" }, "2026-11-19"), { de: "2026-11-19", ate: "2026-11-25" });
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "30d" }, "2026-11-19"), { de: "2026-11-19", ate: "2026-12-18" });
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "este_mes" }, "2026-11-19"), { de: "2026-11-01", ate: "2026-11-30" });
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "tudo" }, "2026-11-19"), { de: null, ate: null });
  assert.deepEqual(intervaloDoPeriodo({ periodo: "livre", de: "2026-12-01", ate: "" }, "2026-11-19"), { de: "2026-12-01", ate: null });
});

test("próximo mês vira o ano em dezembro e acerta fevereiro bissexto", () => {
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "prox_mes" }, "2026-12-10"), { de: "2027-01-01", ate: "2027-01-31" });
  assert.deepEqual(intervaloDoPeriodo({ ...base, periodo: "prox_mes" }, "2028-01-31"), { de: "2028-02-01", ate: "2028-02-29" });
});

test("em andamento: pega quem já está viajando e quem embarca no período", () => {
  const viajando = V({ data_embarque: "2026-11-10", data_retorno: "2026-11-25" });
  assert.equal(passaNaData(viajando, "durante", "2026-11-19", "2026-11-25"), true);
  assert.equal(passaNaData(viajando, "embarque", "2026-11-19", "2026-11-25"), false);
  assert.equal(passaNaData(V(), "durante", "2026-11-19", "2026-11-25"), false); // embarca 01/12
  assert.equal(passaNaData(V({ data_retorno: null }), "durante", "2026-12-01", "2026-12-01"), true);
  assert.equal(passaNaData(V({ data_embarque: null }), "durante", "2026-11-19", null), false);
  assert.equal(passaNaData(V({ data_embarque: null }), "durante", null, null), true); // sem período, tudo passa
});

test("volta, venda e próximo voo (dia de São Paulo)", () => {
  assert.equal(passaNaData(V(), "volta", "2026-12-10", "2026-12-10"), true);
  assert.equal(passaNaData(V(), "venda", "2026-11-01", "2026-11-30"), true);
  // 02h de Brasília do dia 20 = 05h UTC; 23h do dia 19 em SP = 02h UTC do dia 20
  assert.equal(passaNaData(V({ proximo_voo_em: "2026-11-20T02:00:00Z" }), "proximo_voo", "2026-11-19", "2026-11-19"), true);
  assert.equal(passaNaData(V({ proximo_voo_em: null }), "proximo_voo", "2026-11-19", "2026-11-19"), false);
});

test("busca sem acento e pelo nº do Bitrix", () => {
  assert.equal(passaNaBusca(V(), "japao"), true);
  assert.equal(passaNaBusca(V(), "SOUZA"), true);
  assert.equal(passaNaBusca(V(), "48021"), true);
  assert.equal(passaNaBusca(V(), "islandia"), false);
});

test("serviço, roteiro, situação e dono", () => {
  assert.equal(passaNoFiltro(V(), F({ servicos: ["aereo"] }), ctx), false);
  assert.equal(passaNoFiltro(V(), F({ servicos: ["aereo", "pacote"] }), ctx), true);
  assert.equal(passaNoFiltro(V(), F({ tem: ["voo_interno"] }), ctx), false);
  assert.equal(passaNoFiltro(V({ voos_internos: 2 }), F({ tem: ["voo_interno"] }), ctx), true);
  assert.equal(passaNoFiltro(V(), F({ tem: ["hospedagem"] }), ctx), true);
  assert.equal(passaNoFiltro(V(), F({ tem: ["hospedagem", "transfer"] }), ctx), false); // precisa ter todos
  assert.equal(passaNoFiltro(V(), F({ tem: ["sem_voo"] }), ctx), false);
  assert.equal(passaNoFiltro(V({ voos_total: 0 }), F({ tem: ["sem_voo"] }), ctx), true);
  assert.equal(passaNoFiltro(V(), F({ situacao: "em_viagem" }), ctx), false);
  assert.equal(passaNoFiltro(V(), F({ dono: "sem_dono" }), ctx), true);
  assert.equal(passaNoFiltro(V(), F({ dono: "minhas" }), ctx), false);
  assert.equal(passaNoFiltro(V({ responsavel_id: "eu" }), F({ dono: "minhas" }), ctx), true);
  assert.equal(passaNoFiltro(V({ responsavel_id: "x" }), F({ dono: "y" }), ctx), false);
});

test("nenhum voo e voo interno se desmarcam", () => {
  assert.deepEqual(alternarTem(["voo_interno", "hospedagem"], "sem_voo"), ["hospedagem", "sem_voo"]);
  assert.deepEqual(alternarTem(["sem_voo"], "voo"), ["voo"]);
  assert.deepEqual(alternarTem(["voo"], "voo"), []);
});

test("filtro guardado: lixo volta pro padrão e a busca não fica; padrão = nada filtrado", () => {
  assert.deepEqual(lerFiltro(null), FILTRO_PADRAO);
  assert.deepEqual(lerFiltro("{quebrado"), FILTRO_PADRAO);
  assert.equal(quantosAtivos(FILTRO_PADRAO), 0);
  const f = lerFiltro(JSON.stringify({ campo: "volta", periodo: "livre", de: "2026-12-01", ate: "x", servicos: ["aereo", "seguro"], tem: ["voo_interno", "?"], dono: "minhas", busca: "ana" }));
  assert.equal(f.campo, "volta"); assert.equal(f.de, "2026-12-01"); assert.equal(f.ate, "");
  assert.deepEqual(f.servicos, ["aereo"]); assert.deepEqual(f.tem, ["voo_interno"]); assert.equal(f.busca, "");
  assert.equal(quantosAtivos(f), 4);
});

test("linha do tempo: semanas de segunda a domingo; venda olha pra trás", () => {
  const s = semanasDaLinha("2026-11-19", 3); // quinta
  assert.deepEqual(s.map((x) => [x.de, x.ate]), [["2026-11-16", "2026-11-22"], ["2026-11-23", "2026-11-29"], ["2026-11-30", "2026-12-06"]]);
  assert.deepEqual(s.map((x) => x.mes), ["nov", null, null]); // o mês só aparece quando muda
  const t = semanasDaLinha("2026-11-19", 2, true);
  assert.deepEqual(t.map((x) => x.de), ["2026-11-09", "2026-11-16"]);
});

test("barras por semana separam pacote e expedição e ignoram o período escolhido", () => {
  const vs = [V({ id: "a" }), V({ id: "b", servico: "expedicao", data_embarque: "2026-11-20", data_retorno: "2026-11-21" })];
  const sem = semanasDaLinha("2026-11-19", 3);
  const c = contarPorSemana(vs, F({ campo: "embarque", periodo: "hoje" }), ctx, sem, (v) => (v.servico === "expedicao" ? "expedicao" : "pacote"));
  assert.deepEqual(c, [{ expedicao: 1, pacote: 0 }, { expedicao: 0, pacote: 0 }, { expedicao: 0, pacote: 1 }]);
});

test("números dos botões: o próprio grupo não zera as outras opções", () => {
  const vs = [V({ id: "v1" }), V({ id: "b", servico: "aereo", voos_internos: 1 })];
  const n = contarOpcoes(vs, F({ servicos: ["aereo"] }), ctx, "servicos");
  assert.equal(n.get("pacote"), 1); assert.equal(n.get("aereo"), 1);
  const t = contarOpcoes(vs, F({ servicos: ["aereo"] }), ctx, "tem");
  assert.equal(t.get("voo_interno"), 1); assert.equal(t.get("hospedagem"), undefined); // o b não tem hotel
});
