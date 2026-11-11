// Rota api/venda-analise.js com banco e OpenAI de MENTIRA (fetch trocado; nada sai da máquina):
// revisão da IA (prompt de auditor, modelo configurável, temperatura 0, parse defensivo) e as
// tabelas novas da venda gravada (qs_venda_pagamentos, qs_venda_pessoas) lidas com defesa.
//   node --import ./tests/registrar-ts.mjs --test tests/venda/vendaAnaliseIa.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "http://banco.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_MODEL;

const U = "11111111-1111-4111-8111-111111111111";
const VENDA = "22222222-2222-4222-8222-222222222222";
const CLI = "33333333-3333-4333-8333-333333333333";
const FILHO = "44444444-4444-4444-8444-444444444444";
const EXP = "55555555-5555-4555-8555-555555555555";

type Resp = { status: number; body: any };
let openai: { modo: string; conteudo?: string; pedidos: any[] } = { modo: "ok", pedidos: [] };
let banco: { pagamentos: "ok" | "sem_tabela"; pessoas: "ok" | "sem_tabela" } = { pagamentos: "ok", pessoas: "ok" };

const RESPOSTA_OK = JSON.stringify({
  riscos: [{ nivel: "alto", categoria: "familia", pessoa: "Bia Souza", item: "Expedição Japão", motivo: "Menor viajando só com o pai: precisa de autorização da mãe.", o_que_fazer: "Peça a autorização de viagem com firma reconhecida." }],
  texto: "Confira a autorização da Bia antes de tudo.",
});

globalThis.fetch = (async (url: string | URL, opt: any = {}) => {
  const u = String(url);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (u.includes("/auth/v1/user")) return json({ id: U });
  if (u.includes("api.openai.com")) {
    openai.pedidos.push(JSON.parse(opt.body));
    if (openai.modo === "lanca") throw new TypeError("fetch failed");
    if (openai.modo === "http500") return json({ error: { message: "x" } }, 500);
    if (openai.modo === "recusa") return json({ choices: [{ message: { content: null, refusal: "não posso" }, finish_reason: "stop" }] });
    if (openai.modo === "cortada") return json({ choices: [{ message: { content: '{"riscos":[{"nivel":"al' }, finish_reason: "length" }] });
    return json({ choices: [{ message: { content: openai.conteudo ?? RESPOSTA_OK }, finish_reason: "stop" }] });
  }
  const p = decodeURIComponent(u.split("/rest/v1/")[1] || "");
  const semTabela = () => json({ code: "42P01", message: "relation does not exist" }, 404);
  if (p.startsWith("qs_users")) return json([{ id: U, role: "closer", setores: ["comercial"], is_active: true, name: "Closer" }]);
  if (p.startsWith("rpc/venda_analise_gravar")) return json({ analise_id: "a1", status: "x" });
  if (p.startsWith("qs_vendas")) return json([{ id: VENDA, origem: "closer", criado_por: U, cliente_id: CLI, negocio_id: null, viagem_id: null, valor_total: 20000, pagamento: null }]);
  if (p.startsWith("qs_venda_itens")) return json([{ id: "i1", tipo: "expedicao", nome: "Expedição Japão", data_inicio: "2027-03-11", data_fim: "2027-03-22", dados: { expedicao_id: EXP }, passageiros: [], valor: 20000, status: "vendido", ordem: 0 }]);
  if (p.startsWith("qs_venda_pagamentos")) return banco.pagamentos === "ok" ? json([{ ordem: 1, forma: "pix", valor: 5000, data: "2026-11-20", parcelas: 1, obs: null }, { ordem: 2, forma: "cartao", valor: "10000.00", data: "2026-11-20", parcelas: 10 }]) : semTabela();
  if (p.startsWith("qs_venda_pessoas")) return banco.pessoas === "ok" ? json([
    { cliente_id: CLI, comprador: true, chave: null, vinculo: null, menor: false, responsavel_cliente_id: null, itens: [], removida_em: null },
    { cliente_id: FILHO, comprador: false, chave: "k1", vinculo: null, menor: true, responsavel_cliente_id: CLI, itens: [], removida_em: null },
  ]) : semTabela();
  if (p.startsWith("rel_clientes?select=id,nome,cpf,nascimento")) return json([{ id: CLI, nome: "Carlos Souza", cpf: "52998224725", nascimento: "1980-01-01" }, { id: FILHO, nome: "Bia Souza", cpf: null, nascimento: "2015-05-05" }]);
  if (p.startsWith("rel_clientes")) return json([{ nome: "Carlos Souza", passaporte_validade: "2032-01-01" }]);
  if (p.startsWith("expedicoes")) return json([{ id: EXP, nome: "Japão Março", data_embarque: "2027-03-10", data_retorno: "2027-03-22" }]);
  return json([]);
}) as typeof fetch;

const { default: handler, revisarComIa, materialEmTexto } = await import("../../api/venda-analise.js");

function chamar(body: unknown): Promise<Resp> {
  return new Promise((ok) => {
    const res = { statusCode: 200, setHeader() {}, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { ok({ status: this.statusCode, body: b }); } };
    handler({ method: "POST", headers: { authorization: "Bearer x" }, body }, res);
  });
}
const RASCUNHO = {
  origem: "closer", cliente: { nome: "Carlos Souza" },
  itens: [{ tipo: "hospedagem", nome: "Hotel Lima", data_inicio: "2027-03-10", data_fim: "2027-03-12", status: "emitido", dados: { localizador: "H1" } }],
  viajantes: [], pagamento: null, total: 3000,
  pagamentos: [{ forma: "pix", valor: 1000, data: "2026-11-20", parcelas: 1 }],
};

beforeEach(() => {
  openai = { modo: "ok", pedidos: [] };
  banco = { pagamentos: "ok", pessoas: "ok" };
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
});

test("sem OPENAI_API_KEY: modo regras, não chama a OpenAI, regras novas valem no rascunho", async () => {
  const r = await chamar({ rascunho: RASCUNHO });
  assert.equal(r.status, 200);
  assert.equal(r.body.ia.usada, false);
  assert.match(r.body.ia.aviso, /IA indispon/);
  assert.equal(openai.pedidos.length, 0);
  assert.ok(r.body.riscos.some((x: any) => x.categoria === "pagamento" && x.nivel === "alto" && /faltam/.test(x.motivo)));
});

test("com chave: prompt de auditor, temperatura 0, modelo padrão e schema com pessoa/item/o_que_fazer", async () => {
  process.env.OPENAI_API_KEY = "sk-teste";
  const r = await chamar({ rascunho: RASCUNHO });
  assert.equal(r.status, 200);
  const pedido = openai.pedidos[0];
  assert.equal(pedido.model, "gpt-4o-mini");
  assert.equal(pedido.temperature, 0);
  assert.match(pedido.messages[0].content, /AUDITOR DE EMISSÃO/);
  assert.match(pedido.messages[0].content, /NUNCA invente dado/);
  const schema = pedido.response_format.json_schema;
  assert.equal(schema.strict, true);
  assert.deepEqual(schema.schema.properties.riscos.items.required, ["nivel", "categoria", "pessoa", "item", "motivo", "o_que_fazer"]);
  const material = JSON.parse(pedido.messages[1].content.split("\n").slice(1).join("\n"));
  assert.equal(material.soma_pagamentos, 1000);
  assert.equal(material.total_venda, 3000);
  // A resposta entra como risco da IA apontando pessoa e item, e o alto muda o status.
  const ia = r.body.riscos.find((x: any) => x.fonte === "ia");
  assert.equal(ia.pessoa, "Bia Souza");
  assert.equal(ia.item, "Expedição Japão");
  assert.match(ia.o_que_fazer, /autorização/);
  assert.equal(r.body.ia.usada, true);
  assert.equal(r.body.ia.texto, "Confira a autorização da Bia antes de tudo.");
  assert.equal(r.body.status, "risco_alto");
});

test("OPENAI_MODEL troca o modelo", async () => {
  process.env.OPENAI_API_KEY = "sk-teste";
  process.env.OPENAI_MODEL = "gpt-4.1";
  const r = await revisarComIa({ hoje: "2026-11-11" });
  assert.equal(openai.pedidos[0].model, "gpt-4.1");
  assert.equal(r.modelo, "gpt-4.1");
});

for (const [modo, conteudo, esperado] of [
  ["ok", "isso não é JSON", /não devolveu a revisão/],
  ["ok", '{"texto":"sem a lista"}', /não devolveu a revisão/],
  ["recusa", undefined, /recusou/],
  ["cortada", undefined, /cortada/],
  ["http500", undefined, /HTTP 500/],
  ["lanca", undefined, /falhou/],
] as const) {
  test(`resposta inválida da IA (${modo}${conteudo ? `: ${conteudo}` : ""}) não derruba a análise`, async () => {
    process.env.OPENAI_API_KEY = "sk-teste";
    openai.modo = modo;
    openai.conteudo = conteudo;
    const r = await chamar({ rascunho: RASCUNHO });
    assert.equal(r.status, 200);
    assert.equal(r.body.ia.usada, false);
    assert.match(r.body.ia.aviso, esperado);
    assert.ok(r.body.riscos.length > 0 && r.body.riscos.every((x: any) => x.fonte === "regra"), "fica só com as regras");
    assert.ok(r.body.contagens);
  });
}

test("ia_previa da tela passa pela mesma limpeza (nível estranho e sem motivo saem)", async () => {
  const r = await chamar({ venda_id: VENDA, ia_previa: { usada: true, modelo: "gpt-4o-mini", texto: "ok", riscos: [{ nivel: "urgentíssimo", motivo: "x" }, { nivel: "Alta", categoria: "roteiro", motivo: "Noite sem hotel.", item: "Roteiro" }] } });
  assert.equal(r.status, 200);
  const ia = r.body.riscos.filter((x: any) => x.fonte === "ia");
  assert.equal(ia.length, 1);
  assert.equal(ia[0].nivel, "alto");
  assert.equal(openai.pedidos.length, 0, "não paga a IA de novo");
});

test("venda gravada: lê qs_venda_pagamentos, qs_venda_pessoas (+ficha) e as datas da expedição", async () => {
  const r = await chamar({ venda_id: VENDA });
  assert.equal(r.status, 200);
  const m = r.body.riscos.map((x: any) => x.motivo);
  assert.ok(m.some((x: string) => /soma das linhas R\$\s?15\.000,00 ≠ total da venda R\$\s?20\.000,00/.test(x)), "soma × total");
  assert.ok(m.some((x: string) => /^Bia Souza: falta o vínculo com o comprador e o CPF\.$/.test(x)), "família da 0351 + ficha");
  assert.ok(m.some((x: string) => /início no item 11\/03\/2027 ≠ embarque da expedição 10\/03\/2027/.test(x)), "datas × expedição");
});

test("venda antiga / banco sem as tabelas novas: análise roda igual, sem as regras novas", async () => {
  banco = { pagamentos: "sem_tabela", pessoas: "sem_tabela" };
  const r = await chamar({ venda_id: VENDA });
  assert.equal(r.status, 200);
  assert.ok(!r.body.riscos.some((x: any) => /soma das linhas|Bia Souza/.test(x.motivo)));
});

test("material grande: encurta as listas e o texto continua JSON válido", () => {
  const grande = { hoje: "2026-11-11", extrato: Array.from({ length: 5000 }, (_, i) => ({ nome: `item ${i}`, motivos: ["x".repeat(30)] })), riscos_das_regras: ["alto: a"] };
  const t = materialEmTexto(grande, 20_000);
  assert.ok(t.length <= 20_000);
  assert.ok(JSON.parse(t));
});
