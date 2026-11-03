// Envio da reunião/ganho ao Bitrix (api/_bitrixSaida.js) com fetch FALSO:
// confere a sequência de chamadas (o que o n8n fazia nó a nó), sem rede.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.BITRIX_WEBHOOK_BASE = "https://bx.exemplo/rest/1/tok/";
process.env.SUPABASE_URL = "https://sb.exemplo";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave";

type Chamada = { url: string; method: string; body: unknown };
let chamadas: Chamada[] = [];
let recusarUpdate = false;

function resposta(obj: unknown) {
  return { ok: true, status: 200, json: async () => obj, text: async () => (obj == null ? "" : JSON.stringify(obj)) };
}

(globalThis as { fetch: unknown }).fetch = async (url: string, init: { method?: string; body?: string } = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  chamadas.push({ url, method: init.method || "GET", body });
  if (url.includes("/rest/v1/bitrix_fields")) return resposta([{ alias: "email_cliente", field_name: "UF_EMAIL" }]);
  if (url.includes("/rest/v1/v_opcoes_por_alias")) return resposta([]);
  if (url.includes("/rest/v1/qs_meetings")) return resposta(null);
  if (url.endsWith("crm.deal.update.json")) return resposta(recusarUpdate ? { error: "ERR", error_description: "campo inválido" } : { result: true });
  if (url.endsWith("crm.timeline.comment.add.json")) return resposta({ result: 77 });
  throw new Error("url inesperada " + url);
};

const S = await import("../../api/_bitrixSaida.js");

beforeEach(() => { chamadas = []; recusarUpdate = false; });

test("reunião ok: update → comentário → marca sincronizada (amarrada ao lead)", async () => {
  const r = await S.enviarReuniaoDireto({ bitrix_id: "42", meeting_id: "m1", lead_id: "l1", client_email: "a@b.com" });
  assert.equal(r.ok, true);
  const bx = chamadas.filter((c) => c.url.startsWith("https://bx.exemplo"));
  assert.equal(bx[0].url, "https://bx.exemplo/rest/1/tok/crm.deal.update.json");
  assert.deepEqual(bx[0].body, { id: 42, fields: { UF_EMAIL: "a@b.com" } });
  assert.equal(bx[1].url.endsWith("crm.timeline.comment.add.json"), true);
  const patch = chamadas.find((c) => c.url.includes("qs_meetings"))!;
  assert.equal(patch.method, "PATCH");
  assert.match(patch.url, /id=eq\.m1&lead_id=eq\.l1/);
  assert.equal((patch.body as { bitrix_synced: boolean }).bitrix_synced, true);
  assert.match(String((patch.body as { bitrix_error: string }).bitrix_error), /^gravado, mas sem: data_agendamento/);
});

test("reunião recusada: marca o erro e não comenta", async () => {
  recusarUpdate = true;
  const r = await S.enviarReuniaoDireto({ bitrix_id: "42", meeting_id: "m1", client_email: "a@b.com" });
  assert.equal(r.ok, false);
  assert.equal(chamadas.some((c) => c.url.endsWith("crm.timeline.comment.add.json")), false);
  const patch = chamadas.find((c) => c.url.includes("qs_meetings"))!;
  assert.deepEqual(patch.body, { bitrix_synced: false, bitrix_error: "Bitrix recusou: campo inválido" });
});

test("ganho sem valor: só o comentário", async () => {
  const r = await S.gravarGanhoNoBitrix({ bitrixId: "9", closedValue: null, fullName: "Ana" });
  assert.deepEqual(r, { ok: true, code: "comentado" });
  assert.deepEqual(chamadas.map((c) => c.url.split("/").pop()), ["crm.timeline.comment.add.json"]);
});

test("ganho com valor: update (com evento na timeline) e comentário, mesmo se o update falhar", async () => {
  let r = await S.gravarGanhoNoBitrix({ bitrixId: "9", closedValue: 1000 });
  assert.equal(r.code, "gravado");
  assert.deepEqual(chamadas[0].body, { id: 9, fields: { OPPORTUNITY: 1000 }, params: { REGISTER_SONET_EVENT: "Y" } });
  chamadas = []; recusarUpdate = true;
  r = await S.gravarGanhoNoBitrix({ bitrixId: "9", closedValue: 1000 });
  assert.deepEqual(r, { ok: true, code: "so_comentario" });
  assert.equal(chamadas.at(-1)!.url.endsWith("crm.timeline.comment.add.json"), true);
});
