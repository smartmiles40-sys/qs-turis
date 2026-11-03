// Propostas nos 3 modelos-padrão (0280, 03/11/2026): regras puras de
// src/propostas/modelos.ts e a rota pública api/proposta.js com fetch FALSO
// (proposta antiga continua abrindo; modelo/conteúdo/opcoes_extra saem certos).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/propostas/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alternativas, conteudoInicial, diasInclusivos, modeloDaSolicitacao, negritos, numeroBr, periodoCurto, periodoLongo,
  resumoServicos, roteiroServicos, tabelaComGrupos, MODELO_DO_TIPO, SECOES,
} from "../../src/propostas/modelos.ts";

test("cada tipo de solicitação cai num dos 3 modelos", () => {
  assert.equal(modeloDaSolicitacao({ tipo_id: "ops_cotacao" }), "pacote");
  assert.equal(modeloDaSolicitacao({ tipo_id: "ops_cot_aereo" }), "pacote");
  assert.equal(modeloDaSolicitacao({ tipo_id: "ops_cot_seguro" }), "seguro");
  assert.equal(modeloDaSolicitacao({ tipo_id: "ops_alteracao" }), "servicos");
  assert.equal(modeloDaSolicitacao({ tipo_id: "rel_contato" }), "servicos");
  // "seguro" no título decide mesmo sem o tipo próprio (antes da 0281)
  assert.equal(modeloDaSolicitacao({ tipo_id: "ops_cotacao", titulo: "Cotação de seguro viagem Europa" }), "seguro");
  // cotação marcada como alteração/correção no formulário → serviços
  assert.equal(modeloDaSolicitacao({ tipo_id: "ops_cotacao", formulario: { pedido: "alteracao" } }), "servicos");
  assert.equal(modeloDaSolicitacao({ tipo_id: "tipo_que_nao_existe" }), "pacote");
  assert.equal(modeloDaSolicitacao(null), "pacote");
  for (const m of Object.values(MODELO_DO_TIPO)) assert.ok(["pacote", "servicos", "seguro"].includes(m));
});

test("número no jeito brasileiro", () => {
  assert.equal(numeroBr("R$ 1.000,48"), 1000.48);
  assert.equal(numeroBr("577,82"), 577.82);
  assert.equal(numeroBr("1.500"), 1500);
  assert.equal(numeroBr("99.01"), 99.01);
  assert.equal(numeroBr(""), 0);
  assert.equal(numeroBr("abc"), 0);
});

test("datas como nos PDFs", () => {
  assert.equal(periodoLongo("2027-08-17", "2027-08-23"), "17 a 23 de agosto de 2027");
  assert.equal(periodoLongo("2026-11-28", "2026-12-03"), "28 de novembro a 3 de dezembro de 2026");
  assert.equal(periodoCurto("2027-08-17", "2027-08-23"), "17 a 23/08/2027");
  assert.equal(periodoCurto("2026-10-30", "2026-11-12"), "30/10 a 12/11/2026");
  assert.equal(diasInclusivos("2026-10-30", "2026-11-12"), 14); // seguro Europa: 14 dias
  assert.equal(diasInclusivos("", "2026-11-12"), 0);
});

test("tabela de voos com grupo e conexão", () => {
  const t = tabelaComGrupos("# Ida · terça\nFortaleza → Rio | G3 2055 | 16:50 | 20:10 | 3h20\n> Conexão de 5h25\n\n");
  assert.deepEqual(t.map((l) => l.tipo), ["grupo", "linha", "nota"]);
  assert.deepEqual(t[1].cols, ["Fortaleza → Rio", "G3 2055", "16:50", "20:10", "3h20"]);
  assert.equal(t[0].cols[0], "Ida · terça");
});

test("negrito simples sem HTML", () => {
  assert.deepEqual(negritos("**Hero:** câmbio <b>"), [{ b: true, t: "Hero:" }, { b: false, t: " câmbio <b>" }]);
});

test("roteiro dos serviços: cidades, transição e numeração D1…", () => {
  const r = roteiroServicos("# Madri | Ramada · 30/10 a 04/11\n2026-10-30 | Chegada | city tour\n2026-10-31 | Segóvia | excursão | s\n> 2026-11-04 | Trem para Barcelona | alta velocidade | s\n# Barcelona | Holiday Inn\n2026-11-05 | Gaudí | Sagrada Família");
  assert.equal(r.totalDias, 4);
  assert.equal(r.blocos.length, 3);
  assert.equal(r.blocos[0].tipo, "cidade");
  if (r.blocos[0].tipo === "cidade") { assert.equal(r.blocos[0].dias[1].sugestao, true); assert.equal(r.blocos[0].hotel, "Ramada · 30/10 a 04/11"); }
  if (r.blocos[1].tipo === "transicao") assert.equal(r.blocos[1].dia.n, 3);
  if (r.blocos[2].tipo === "cidade") assert.equal(r.blocos[2].dias[0].n, 4);
});

test("resumo dos serviços sai dos itens (incluso, opcional, alternativas)", () => {
  const linhas = resumoServicos([
    { nome: "Passeio panorâmico", data_inicio: "2026-10-30", incluso: true, valor_total: 0,
      detalhes: { resumo: "Chegada e passeio panorâmico em Madri", opcional_rotulo: "OPCIONAL", opcional_valor: "99,01", opcional_resumo: "estender o passeio para o almoço (+2h)" } },
    { nome: "Segóvia", data_inicio: "2026-10-31", incluso: false, valor_total: 0,
      detalhes: { alternativas: "OPÇÃO 1 | sem almoço | 577,82 | Segóvia sem almoço\n*OPÇÃO 2 | com almoço | 1.000,48 | Segóvia com almoço" } },
    { nome: "Gestão de reservas de restaurantes", data_inicio: "", incluso: false, valor_total: 161.15, detalhes: {} },
  ]);
  assert.equal(linhas.length, 5);
  assert.equal(linhas[0].valor, "Já incluído");
  assert.equal(linhas[1].texto, "Opcional: estender o passeio para o almoço (+2h)");
  assert.match(linhas[1].valor, /^\+ R\$\s99,01$/);
  assert.match(linhas[3].valor, /1\.000,48/);
  assert.equal(linhas[4].tag, "Viagem");
  const alts = alternativas("*OPÇÃO 2 · COM ALMOÇO | texto | 1.000,48 | x");
  assert.equal(alts[0].destaque, true);
  assert.equal(alts[0].rotulo, "OPÇÃO 2 · COM ALMOÇO");
});

test("textos iniciais: fixos dos PDFs e o nº de passageiros", () => {
  const s = conteudoInicial("servicos", { pax: 28, cliente: "Família Sobreira", hoje: "2026-10-22" });
  assert.match(String(s.nota_valores), /considerando os 28 passageiros\. A família escolhe quais quer incluir na programação\./);
  assert.match(String(s.infos_nota), /^As refeições não estão incluídas, exceto quando indicado no serviço\./);
  const g = conteudoInicial("seguro", { pax: 4, cliente: "Michele", hoje: "2026-10-14" });
  assert.equal(g.condicoes_pagamento, "PIX, boleto ou cartão de crédito em até 12x.");
  assert.match(String(g.validade), /^valores de 14\/10\/2026, sujeitos à variação do câmbio/);
  const p = conteudoInicial("pacote", { pax: 2, cliente: "", hoje: "2026-10-13" });
  assert.match(String(p.condicoes), /^Valores consultados em 13\/10\/2026, sujeitos a disponibilidade/);
  assert.match(String(p.documentos_nota), /outubro de 2026/);
  // todo campo das seções existe no conteúdo inicial (o editor não fica com campo "fantasma")
  for (const m of ["pacote", "servicos", "seguro"] as const) {
    const c = conteudoInicial(m, { pax: 1, cliente: "" });
    for (const sec of SECOES[m]) for (const f of sec.campos) assert.ok(f.chave in c, `${m}.${f.chave}`);
  }
});

// ── api/proposta.js (rota pública) com fetch falso ──────────────────────────
process.env.SUPABASE_URL = "https://sb.exemplo";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave";
const TOKEN = "a".repeat(64);
let proposta: Record<string, unknown> = {};
const ops = [{ id: "o1", ordem: 0, titulo: "1 viajante", descricao: "", recomendada: false, desconto: 100, pagamentos: [] },
  { id: "o2", ordem: 1, titulo: "2 viajantes", descricao: "", recomendada: true, desconto: 0, pagamentos: [] }];
const its = [{ opcao_id: "o1", ordem: 0, tipo: "aereo", nome: "Voo", valor_total: 1000, incluso: false, detalhes: { localizador: "XYZ123", trechos: [] } }];
(globalThis as { fetch: unknown }).fetch = async (url: string) => {
  const r = (o: unknown) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
  if (url.includes("qs_propostas?select=*")) return r([proposta]);
  if (url.includes("qs_proposta_opcoes")) return r(ops);
  if (url.includes("qs_proposta_itens")) return r(its);
  if (url.includes("qs_users")) return r([{ name: "Ana Paula Souza", whatsapp_number: "5511999999999" }]);
  return r([]);
};
const { default: handler } = await import("../../api/proposta.js");
async function abrir() {
  let status = 0, corpo: Record<string, unknown> = {};
  const res = { setHeader() {}, status(s: number) { status = s; return this; }, json(o: Record<string, unknown>) { corpo = o; return this; } };
  await handler({ method: "GET", query: { token: TOKEN, equipe: "1" } }, res);
  return { status, corpo };
}

test("rota pública: proposta ANTIGA (sem as colunas da 0280) segue abrindo", async () => {
  proposta = { id: "p1", numero: 7, status: "enviada", titulo: "Japão", criado_em: "2026-10-19T15:00:00Z", criado_por: "u1" };
  const { status, corpo } = await abrir();
  assert.equal(status, 200);
  assert.equal(corpo.modelo, null);
  assert.deepEqual(corpo.conteudo, {});
  assert.equal(corpo.data, "2026-10-19");
  const o = (corpo.opcoes as { itens: { detalhes: Record<string, unknown> }[] }[])[0];
  assert.equal(o.itens[0].detalhes.localizador, undefined, "localizador é interno");
});

test("rota pública: modelo + conteúdo, opcoes_extra vai pra cada opção", async () => {
  proposta = {
    id: "p1", numero: 8, status: "enviada", modelo: "pacote", enviada_em: "2026-10-20T01:30:00Z", criado_por: "u1",
    conteudo: { selo: "ALL INCLUSIVE", opcoes_extra: [{ selo: "10% OFF" }, { rotulo: "QUARTO DUPLO · CASAL" }] },
  };
  const { corpo } = await abrir();
  assert.equal(corpo.modelo, "pacote");
  assert.deepEqual(corpo.conteudo, { selo: "ALL INCLUSIVE" });
  assert.equal(corpo.data, "2026-10-19", "01:30 UTC ainda é dia 19 em Brasília");
  const opcoes = corpo.opcoes as { extra: Record<string, unknown> }[];
  assert.deepEqual(opcoes[0].extra, { selo: "10% OFF" });
  assert.deepEqual(opcoes[1].extra, { rotulo: "QUARTO DUPLO · CASAL" });
});

test("rota pública: rascunho não abre", async () => {
  proposta = { id: "p1", status: "rascunho", modelo: "seguro" };
  assert.equal((await abrir()).status, 404);
});
