// Ficha mudou → contato do Bitrix acompanha (0393, api/_relPessoaBitrix.js).
// Regras puras + a rotina com o bx/rest DE VERDADE e o fetch de mentira
// (padrão de tests/leads/leadCardBitrix.test.ts): nada sai pra rede.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../../api/_relPessoaBitrix.js";
import { bx } from "../../api/_bitrixLead.js";
import { rest } from "../../api/_supabaseAdmin.js";

const ID = "11111111-1111-4111-8111-111111111111";
const pessoa = (extra: Record<string, unknown> = {}) => ({
  id: ID, nome: "Maria da Silva", telefone: "5511987654321", email: "maria@x.com", cpf: null,
  nascimento: null, bitrix_contato_id: "77", mesclado_em_id: null, arquivado_em: null, ...extra,
});
const contato = (extra: Record<string, unknown> = {}) => ({
  ID: "77", NAME: "Maria da Silva", SECOND_NAME: "", LAST_NAME: "",
  PHONE: [{ ID: "1", VALUE: "+55 11 98765-4321", VALUE_TYPE: "MOBILE" }],
  EMAIL: [{ ID: "2", VALUE: "maria@x.com", VALUE_TYPE: "HOME" }], ...extra,
});

// ── regras puras ─────────────────────────────────────────────────────────────

test("igual ao Bitrix → nada a mandar", () => {
  const p = R.planejarAtualizacao(pessoa(), contato(), ["nome", "telefone", "email"]);
  assert.deepEqual(p.fields, {});
  assert.deepEqual(p.mudou, []);
});

test("telefone novo entra como item novo; o mesmo número com/sem 9 e 55 não conta como novo", () => {
  const p = R.planejarAtualizacao(pessoa({ telefone: "5511912345678" }), contato(), ["telefone"]);
  assert.deepEqual(p.fields, { PHONE: [{ VALUE: "5511912345678", VALUE_TYPE: "MOBILE" }] });
  assert.equal(R.mesmoTelefone("11 8765-4321", "+55 11 98765-4321"), true);
  assert.equal(R.mesmoTelefone("5511912345678", "5511987654321"), false);
  assert.deepEqual(R.planejarAtualizacao(pessoa({ telefone: "11987654321" }), contato(), ["telefone"]).fields, {});
});

test("só manda os campos que mudaram no QS (campos da fila)", () => {
  const p = R.planejarAtualizacao(pessoa({ email: "nova@x.com", telefone: "5511912345678" }), contato(), ["email"]);
  assert.deepEqual(Object.keys(p.fields), ["EMAIL"]);
  assert.deepEqual(p.fields.EMAIL, [{ VALUE: "nova@x.com", VALUE_TYPE: "HOME" }]);
});

test("nunca apaga: vazio no QS não vai pro Bitrix", () => {
  const p = R.planejarAtualizacao(pessoa({ nome: "  ", telefone: null, email: "" }), contato(), ["nome", "telefone", "email"]);
  assert.deepEqual(p.fields, {});
  assert.equal(p.ignorados.length, 3);
});

test("nome: contato com nome inteiro no NAME troca o NAME; com sobrenome separa; com nome do meio e nome curto não mexe", () => {
  assert.deepEqual(R.planejarAtualizacao(pessoa({ nome: "Maria Souza" }), contato(), ["nome"]).fields, { NAME: "Maria Souza" });
  const comSobrenome = contato({ NAME: "Maria", LAST_NAME: "Silva" });
  assert.deepEqual(R.planejarAtualizacao(pessoa({ nome: "Maria Clara Souza" }), comSobrenome, ["nome"]).fields, { NAME: "Maria Clara", LAST_NAME: "Souza" });
  // mesmo nome, só acento/espaço: nada
  assert.deepEqual(R.planejarAtualizacao(pessoa({ nome: "Maria  Silva" }), comSobrenome, ["nome"]).fields, {});
  const comMeio = contato({ NAME: "Maria", SECOND_NAME: "Clara", LAST_NAME: "Silva" });
  const curto = R.planejarAtualizacao(pessoa({ nome: "Maria Souza" }), comMeio, ["nome"]);
  assert.deepEqual(curto.fields, {});
  assert.match(curto.ignorados[0].motivo, /nome do meio/);
  assert.deepEqual(R.planejarAtualizacao(pessoa({ nome: "Maria Clara Souza" }), comMeio, ["nome"]).fields,
    { NAME: "Maria", SECOND_NAME: "Clara", LAST_NAME: "Souza" });
});

// ── rotina com fetch de mentira ──────────────────────────────────────────────

type Pedido = { url: string; method: string; body: unknown };
function fetchFalso(bitrix: Record<string, unknown>, pedidos: Pedido[], { bitrixFora = false } = {}) {
  return (async (url: string, init?: RequestInit) => {
    const u = String(url);
    pedidos.push({ url: decodeURIComponent(u), method: init?.method || "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.startsWith("http://bitrix.teste")) {
      if (bitrixFora) return new Response("erro", { status: 503 });
      const metodo = u.replace(/^.*\/x\//, "").replace(/\.json$/, "");
      return new Response(JSON.stringify({ result: bitrix[metodo] ?? null }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(init?.method && init.method !== "GET" ? "" : "[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}
function ambiente() {
  process.env.SUPABASE_URL = "http://supabase.teste";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave";
  process.env.BITRIX_WEBHOOK_BASE = "http://bitrix.teste/rest/1/x";
}
const doBitrix = (p: Pedido[], metodo: string) => p.filter((x) => x.url.includes(`bitrix.teste`) && x.url.includes(`/${metodo}.json`));
const fila = (p: Pedido[]) => p.filter((x) => x.url.includes("/rest/v1/rel_clientes_bitrix") && x.method === "PATCH");

test("telefone mudou: lê o contato, manda crm.contact.update SÓ com o telefone e volta a fila pra ok", async () => {
  ambiente();
  const pedidos: Pedido[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = fetchFalso({ "crm.contact.get": contato(), "crm.contact.update": true }, pedidos);
  try {
    const r = await R.atualizarContato(pessoa({ telefone: "5511912345678" }), { bx, rest, linha: { tentativas: 0, campos: ["telefone"] } });
    assert.equal(r.status, "ok");
    assert.deepEqual(r.mudou, ["telefone"]);
    const up = doBitrix(pedidos, "crm.contact.update");
    assert.equal(up.length, 1);
    assert.deepEqual(up[0].body, { id: "77", fields: { PHONE: [{ VALUE: "5511912345678", VALUE_TYPE: "MOBILE" }] }, params: { REGISTER_SONET_EVENT: "N" } });
    const f = fila(pedidos);
    assert.equal((f.at(-1)!.body as { status: string }).status, "ok");
    assert.equal((f.at(-1)!.body as { campos: unknown }).campos, null);
    assert.ok(!pedidos.some((x) => x.url.includes("/rest/v1/rel_clientes?")), "não mexe na ficha");
  } finally { globalThis.fetch = original; }
});

test("nada mudou de fato no Bitrix → não chama update, mas fecha a fila", async () => {
  ambiente();
  const pedidos: Pedido[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = fetchFalso({ "crm.contact.get": contato() }, pedidos);
  try {
    const r = await R.atualizarContato(pessoa(), { bx, rest, linha: { tentativas: 0, campos: ["nome", "email"] } });
    assert.equal(r.status, "ok");
    assert.equal(doBitrix(pedidos, "crm.contact.update").length, 0);
    assert.equal((fila(pedidos).at(-1)!.body as { resultado: string }).resultado, "atualizado_sem_mudanca");
  } finally { globalThis.fetch = original; }
});

test("simulação (seco): só lê o contato — nenhum update nem escrita", async () => {
  ambiente();
  const pedidos: Pedido[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = fetchFalso({ "crm.contact.get": contato() }, pedidos);
  try {
    const r = await R.atualizarContato(pessoa({ email: "nova@x.com" }), { bx, rest, seco: true, linha: { campos: ["email"] } });
    assert.equal(r.acao, "atualizar");
    assert.equal(r.status, "simulado");
    assert.equal(doBitrix(pedidos, "crm.contact.update").length, 0);
    assert.ok(pedidos.filter((x) => x.url.includes("supabase.teste")).every((x) => x.method === "GET"));
  } finally { globalThis.fetch = original; }
});

test("Bitrix fora: não atualiza, fila continua 'atualizar' com o erro (tenta de novo depois)", async () => {
  ambiente();
  const pedidos: Pedido[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = fetchFalso({}, pedidos, { bitrixFora: true });
  try {
    const r = await R.atualizarContato(pessoa({ telefone: "5511912345678" }), { bx, rest, linha: { tentativas: 2, campos: ["telefone"] } });
    assert.equal(r.acao, "erro");
    assert.equal(doBitrix(pedidos, "crm.contact.update").length, 0);
    const b = fila(pedidos).at(-1)!.body as { status: string; tentativas: number; erro: string };
    assert.equal(b.status, "atualizar");
    assert.equal(b.tentativas, 3);
    assert.match(b.erro, /Nada foi alterado/);
  } finally { globalThis.fetch = original; }
});

test("ficha sem contato não vai pela atualização (é a criação que cuida)", async () => {
  const r = await R.atualizarContato(pessoa({ bitrix_contato_id: null }), { bx: async () => { throw new Error("não devia chamar"); }, rest: async () => [] });
  assert.equal(r.status, "sem_contato");
});

test("rodada real: pega as linhas 'atualizar' (com campos) depois das pendentes e atualiza", async () => {
  const lidas: string[] = [];
  const escritas: { path: string; body: unknown }[] = [];
  const restF = async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    if (opts.method && opts.method !== "GET") { escritas.push({ path, body: opts.body }); return null; }
    lidas.push(path);
    if (path.includes("status=eq.atualizar")) return [{ cliente_id: ID, status: "atualizar", tentativas: 0, campos: ["email"], cliente: pessoa({ email: "nova@x.com" }) }];
    return [];
  };
  const chamadas: { metodo: string; params: unknown }[] = [];
  const bxF = async (metodo: string, params: unknown) => { chamadas.push({ metodo, params }); return metodo === "crm.contact.get" ? contato() : true; };
  const r = await R.rodadaPessoas({ bx: bxF, rest: restF, limite: 5 });
  assert.equal(r.resumo.atualizaria, 1);
  assert.ok(lidas.some((p) => p.includes("status=eq.atualizar") && p.includes("campos")));
  const up = chamadas.find((c) => c.metodo === "crm.contact.update");
  assert.deepEqual((up!.params as { fields: unknown }).fields, { EMAIL: [{ VALUE: "nova@x.com", VALUE_TYPE: "HOME" }] });
  assert.equal((escritas.at(-1)!.body as { status: string }).status, "ok");
});
