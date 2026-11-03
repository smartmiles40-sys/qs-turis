// Pipeline do closer → Bitrix (api/_closerBitrixPlano.js), sem rede.
// As colunas são as do portal, lidas em 03/11 por GET /api/bitrix-etapas
// (tests/closer/funis-03-11.json: funis 0, 3 e 25).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as P from "../../api/_closerBitrixPlano.js";

const FUNIS = JSON.parse(readFileSync(new URL("./funis-03-11.json", import.meta.url), "utf8"));
const C1 = FUNIS["0"];
const PRE = FUNIS["25"];
const REL = FUNIS["3"];

const cartao = (etapa: string, extra: Record<string, unknown> = {}) => ({ etapa, ficha: null, valor_previsto: null, ...extra });
const deal = (STAGE_ID: string, CATEGORY_ID = "0", extra: Record<string, unknown> = {}) => ({ STAGE_ID, CATEGORY_ID, OPPORTUNITY: "0", ...extra });

test("mapeamento: toda etapa do QS tem coluna no Comercial 1", () => {
  const esperado: Record<string, string> = {
    aguardando_reuniao: "EXECUTING", reagendamento: "UC_ANBZSL", em_cotacao: "UC_3I8BDW", em_negociacao: "UC_YGG9JY",
    no_show: "UC_3Y96XD", oportunidade_futura: "UC_PV9OAM", aguardando_emissao: "UC_70BW8E", venda_realizada: "WON",
    perdido: "LOSE", venda_cancelada: "UC_NV92A7",
  };
  for (const [etapa, coluna] of Object.entries(esperado)) assert.equal(P.colunaParaEtapa(C1, etapa), coluna, etapa);
});

test("volta: Gerar Pagamento e Envio de contrato contam como venda", () => {
  assert.equal(P.etapaParaColuna(C1, "UC_IHT3PF").etapa, "aguardando_emissao");
  assert.equal(P.etapaParaColuna(C1, "UC_FYJCD5").etapa, "aguardando_emissao");
  assert.equal(P.etapaParaColuna(C1, "EXECUTING").etapa, "aguardando_reuniao");
  assert.equal(P.etapaParaColuna(REL, "C3:LOSE").etapa, "perdido"); // lá o LOSE se chama "Cotação Enviada"
});

test("Aguardando reunião vai pra Reunião de Vendas (antes dava erro: não há coluna com esse nome)", () => {
  const p = P.planejarEspelho({ n: cartao("aguardando_reuniao"), deal: deal("NEW"), lista: C1 });
  assert.equal(p.ok, true);
  assert.deepEqual(p.fields, { STAGE_ID: "EXECUTING" });
  assert.equal(p.para.nome, "Reunião de Vendas");
});

test("já igual: nada a enviar", () => {
  const p = P.planejarEspelho({ n: cartao("em_cotacao"), deal: deal("UC_3I8BDW"), lista: C1 });
  assert.equal(p.ok, true);
  assert.deepEqual(p.fields, {});
});

test("card ainda na Pré-Vendas: vai pro Comercial 1 com CATEGORY_ID e STAGE_ID juntos", () => {
  const p = P.planejarEspelho({ n: cartao("em_cotacao"), deal: deal("C25:WON", "25"), lista: PRE, listaComercial: C1 });
  assert.equal(p.ok, true);
  assert.deepEqual(p.fields, { CATEGORY_ID: 0, STAGE_ID: "UC_3I8BDW" });
});

test("outro funil: o cron não mexe; a pessoa pode", () => {
  const cron = P.planejarEspelho({ n: cartao("em_cotacao"), deal: deal("C3:NEW", "3"), lista: REL });
  assert.equal(cron.ok, false);
  assert.match(cron.motivo, /outro funil/);
  const pessoa = P.planejarEspelho({ n: cartao("em_cotacao"), deal: deal("C3:UC_UAOBYR", "3"), lista: REL, porPessoa: true });
  assert.equal(pessoa.ok, true);
  assert.equal(pessoa.fields.STAGE_ID, "C3:NEW"); // "Cotação Relacionamento"
});

test("cron não tira de venda (Em Emissão, Gerar Pagamento, Envio de contrato, WON)", () => {
  for (const col of ["UC_70BW8E", "UC_IHT3PF", "UC_FYJCD5", "WON"]) {
    const p = P.planejarEspelho({ n: cartao("em_cotacao"), deal: deal(col), lista: C1 });
    assert.equal(p.ok, false, col);
    assert.match(p.motivo, /venda/);
  }
  // nem pra Perdido
  assert.equal(P.planejarEspelho({ n: cartao("perdido"), deal: deal("UC_IHT3PF"), lista: C1 }).ok, false);
  // a pessoa pode
  assert.equal(P.planejarEspelho({ n: cartao("em_cotacao"), deal: deal("UC_70BW8E"), lista: C1, porPessoa: true }).ok, true);
});

test("cron não reabre card encerrado no Bitrix (Perdidos / Cancelamento)", () => {
  for (const col of ["LOSE", "UC_NV92A7"]) {
    const p = P.planejarEspelho({ n: cartao("em_negociacao"), deal: deal(col), lista: C1 });
    assert.equal(p.ok, false, col);
    assert.match(p.motivo, /encerrado/);
  }
  // encerrado → encerrado e encerrado → venda passam
  assert.equal(P.planejarEspelho({ n: cartao("perdido"), deal: deal("UC_NV92A7"), lista: C1 }).ok, true);
  assert.equal(P.planejarEspelho({ n: cartao("venda_realizada"), deal: deal("LOSE"), lista: C1 }).ok, true);
});

test("perdido no QS com card em negociação → Perdidos", () => {
  const p = P.planejarEspelho({ n: cartao("perdido"), deal: deal("UC_YGG9JY"), lista: C1 });
  assert.deepEqual(p.fields, { STAGE_ID: "LOSE" });
});

test("pré-venda: coluna de venda + valor + tipo de venda", () => {
  const n = cartao("em_negociacao", { pre_venda_em: "2026-11-01T10:00:00Z", pre_venda_valor: 12000, pre_venda_tipo_bitrix: "71" });
  const p = P.planejarEspelho({ n, deal: deal("UC_YGG9JY"), lista: C1 });
  assert.equal(p.preVenda, true);
  assert.deepEqual(p.fields, { STAGE_ID: "UC_70BW8E", OPPORTUNITY: 12000, CURRENCY_ID: "BRL", [P.CAMPO_TIPO_VENDA]: "71" });
});

test("valor igual não regrava", () => {
  const p = P.planejarEspelho({ n: cartao("em_negociacao", { valor_previsto: 5000 }), deal: deal("UC_YGG9JY", "0", { OPPORTUNITY: "5000.00" }), lista: C1 });
  assert.deepEqual(p.fields, {});
});
