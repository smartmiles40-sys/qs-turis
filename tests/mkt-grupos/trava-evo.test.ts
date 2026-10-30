// A trava colada no fetch (api/_mktGruposEvo.js) e o motor parado por ela.
// Sem rede: o fetch é trocado por um falso que responde como PostgREST e
// anota toda chamada que iria pra Evolution.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://banco.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.EVOLUTION_URL = "https://evo.falsa";
process.env.EVOLUTION_APIKEY = "evo-falsa";
process.env.REL_GRUPOS_INSTANCIA = "relacionamento-grupos-4183";
process.env.MKT_GRUPOS_ENVIO = "1";

let conexao: Record<string, unknown> | null = null;
let linhasSdr: Record<string, unknown>[] = [];
let chamadasEvo: string[] = [];
let rpcs: string[] = [];

const resp = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (url: string | URL) => {
  const u = String(url);
  if (u.startsWith("https://evo.falsa")) { chamadasEvo.push(u.replace("https://evo.falsa", "")); return resp({ key: { id: "MSGID12345" }, instance: { state: "open" } }); }
  if (u.includes("/rest/v1/mkt_grupos_conexao")) return resp(conexao ? [conexao] : []);
  if (u.includes("/rest/v1/qs_wa_linhas")) return resp(linhasSdr);
  if (u.includes("/rest/v1/mkt_grupos_bloqueios")) return resp([{ valor: "relacionamento-grupos-4183", tipo: "instancia" }]);
  if (u.includes("/rest/v1/rpc/")) { rpcs.push(u); return resp([]); }
  return resp([]);
}) as typeof fetch;

// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
const { evoMkt } = await import("../../api/_mktGruposEvo.js");
// @ts-expect-error — idem
const { rodada } = await import("../../api/_mktGruposMotor.js");

beforeEach(() => { chamadasEvo = []; rpcs = []; linhasSdr = []; });

test("instância do Rel configurada: evoMkt recusa e NADA vai pra Evolution", async () => {
  conexao = { id: 1, instancia: "relacionamento-grupos-4183", numero: "5511980124183", envio_ligado: true, estado: "open" };
  await assert.rejects(() => evoMkt("message/sendText", { method: "POST", body: { number: "1@g.us", text: "x" } }), /Trava do Marketing/);
  assert.deepEqual(chamadasEvo, []);
});

test("conexão passada de fora com instância trocada: confere de novo colado no fetch", async () => {
  conexao = { id: 1, instancia: "marketing-a", envio_ligado: true };
  const falsa = { instancia: "relacionamento-grupos-4183", __listas: { proibidas: [], numerosProibidos: [] } };
  await assert.rejects(() => evoMkt("message/sendText", { method: "POST", body: {}, conexao: falsa }), /Trava do Marketing/);
  assert.deepEqual(chamadasEvo, []);
});

test("instância de SDR (qs_wa_linhas) com nome de marketing é recusada", async () => {
  conexao = { id: 1, instancia: "marketing-joao", envio_ligado: true };
  linhasSdr = [{ instancia: "marketing-joao", numero: "5511911112222" }];
  await assert.rejects(() => evoMkt("instance/connectionState"), /Trava do Marketing/);
  assert.deepEqual(chamadasEvo, []);
});

test("número do Rel numa instância com nome de marketing é recusado", async () => {
  conexao = { id: 1, instancia: "marketing-a", numero: "5511980124183", envio_ligado: true };
  await assert.rejects(() => evoMkt("instance/connectionState"), /Trava do Marketing/);
  assert.deepEqual(chamadasEvo, []);
});

test("instância do Marketing: o caminho sai com ELA (quem chama não escolhe instância)", async () => {
  conexao = { id: 1, instancia: "numero-para-o-marketing--edmg0", numero: "551153066577", envio_ligado: true };
  const r = await evoMkt("message/sendText", { method: "POST", body: { number: "1@g.us", text: "x" } });
  assert.equal(r.key.id, "MSGID12345");
  assert.deepEqual(chamadasEvo, ["/message/sendText/numero-para-o-marketing--edmg0"]);
});

test("motor com a instância do Rel: para antes de tudo (nem pede a fila)", async () => {
  conexao = { id: 1, instancia: "relacionamento-grupos-4183", envio_ligado: true, estado: "open" };
  const r = await rodada({ prazoMs: 20_000 });
  assert.match(String(r.parado), /Trava do Marketing/);
  assert.deepEqual(chamadasEvo, []);
  assert.deepEqual(rpcs, []);
});

test("motor sem MKT_GRUPOS_ENVIO=1: não pede a fila nem chama a Evolution", async () => {
  conexao = { id: 1, instancia: "marketing-a", envio_ligado: true, estado: "open" };
  process.env.MKT_GRUPOS_ENVIO = "";
  const r = await rodada({ prazoMs: 20_000 });
  process.env.MKT_GRUPOS_ENVIO = "1";
  assert.match(String(r.parado), /MKT_GRUPOS_ENVIO/);
  assert.deepEqual(chamadasEvo, []);
  assert.deepEqual(rpcs, []);
});

test("motor com envio pausado na tela: idem", async () => {
  conexao = { id: 1, instancia: "marketing-a", envio_ligado: false, estado: "open" };
  const r = await rodada({ prazoMs: 20_000 });
  assert.match(String(r.parado), /pausado/);
  assert.deepEqual(chamadasEvo, []);
});
