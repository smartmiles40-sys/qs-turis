// Contrato × ZapSign (api/closer.js + api/_contrato.js) com fetch FALSO (03/11):
// webhook (segredo, idempotência, doc apagado, PDF final), envio e leitura do
// documento. Nada sai pra rede; o formato do corpo é o da doc pública do ZapSign
// (docs.zapsign.com.br/webhooks/eventos/document/documento-assinado).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://sb.exemplo";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave";
process.env.ZAPSIGN_API_TOKEN = "tk-zap";
process.env.ZAPSIGN_WEBHOOK_SECRET = "segredo-longo-123";
process.env.BITRIX_WEBHOOK_BASE = "https://bx.exemplo/rest/1/tok";

const TOKEN = "cce11abf-abcd-abcd-a657-25b55f185f16";
type Chamada = { url: string; method: string; body: unknown; headers: Record<string, string> };
let chamadas: Chamada[] = [];
let contrato: Record<string, unknown> | null;
let docZap: Record<string, unknown> | null;
let webhookRepetido = false;

const resposta = (obj: unknown, status = 200) => ({
  ok: status < 400, status, json: async () => obj, text: async () => (obj == null ? "" : JSON.stringify(obj)),
  arrayBuffer: async () => new TextEncoder().encode("%PDF-assinado").buffer,
});

(globalThis as { fetch: unknown }).fetch = async (url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
  let body: unknown = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch { body = "(binário)"; }
  const method = init.method || "GET";
  chamadas.push({ url, method, body, headers: init.headers || {} });
  if (url.includes("/rest/v1/qs_contrato_webhooks")) return resposta(method === "POST" ? (webhookRepetido ? [] : [{ id: 1 }]) : null);
  if (url.includes("/rest/v1/qs_contratos?select=")) return resposta(contrato ? [contrato] : []);
  if (url.includes("/rest/v1/rpc/contrato_registrar_status")) return resposta((body as { p_status: string }).p_status);
  if (url.includes("/storage/v1/object/contratos/")) return resposta({ Key: "ok" });
  if (url.startsWith("https://api.zapsign.com.br/api/v1/docs/")) {
    if (!docZap) return resposta({ detail: "Não encontrado." }, 404);
    return resposta(docZap);
  }
  if (url.startsWith("https://zapsign.s3")) return resposta(null);
  if (url.startsWith("https://bx.exemplo")) return resposta({ result: 1 });
  throw new Error("url inesperada " + url);
};

const { default: handler } = await import("../../api/closer.js");
const Z = await import("../../api/_contrato.js");

function chamar(query: string, corpo: unknown, headers: Record<string, string> = {}) {
  const req = { method: "POST", url: `/api/closer?${query}`, query: Object.fromEntries(new URLSearchParams(query)), headers, body: corpo };
  const out: { status: number; json: unknown } = { status: 0, json: null };
  const res = {
    status(s: number) { out.status = s; return this; },
    json(j: unknown) { out.json = j; return out; },
    setHeader() { /* nada */ },
  };
  return Promise.resolve(handler(req, res)).then(() => out);
}

const signer = (over: Record<string, unknown> = {}) => ({
  token: "s1", status: "pending", email: "cliente@exemplo.com", times_viewed: 0, last_view_at: null, signed_at: null, sign_url: "https://app.zapsign.com.br/verificar/s1", ...over,
});
const corpoAssinado = (docStatus: string) => ({
  event_type: "doc_signed", token: TOKEN, status: docStatus, external_id: "neg-1", signed_file: "https://zapsign.s3.amazonaws.com/x.pdf",
  signers: [signer({ status: "signed", signed_at: "2026-11-03T15:00:00Z", times_viewed: 1 })],
});

beforeEach(() => {
  chamadas = []; webhookRepetido = false;
  contrato = { id: "c1", negocio_id: "neg-1", status: "enviado", modo: "automatico", campos: { email: "cliente@exemplo.com" }, zapsign_token: TOKEN, pdf_assinado_url: null, bitrix_deal_id: "42" };
  docZap = null;
});

test("webhook sem segredo / segredo errado → 401, nada gravado", async () => {
  const r1 = await chamar("acao=zapsign-webhook", corpoAssinado("pending"));
  assert.equal(r1.status, 401);
  const r2 = await chamar("acao=zapsign-webhook&s=errado", corpoAssinado("pending"));
  assert.equal(r2.status, 401);
  assert.equal(chamadas.length, 0);
});

test("segredo aceito na URL (&s=), no X-QS-Secret e no Authorization: Bearer", async () => {
  docZap = { token: TOKEN, status: "pending", signers: [signer({ times_viewed: 2, last_view_at: "2026-11-03T14:00:00Z" })] };
  for (const [q, h] of [
    ["acao=zapsign-webhook&s=segredo-longo-123", {}],
    ["acao=zapsign-webhook", { "x-qs-secret": "segredo-longo-123" }],
    ["acao=zapsign-webhook", { authorization: "Bearer segredo-longo-123" }],
  ] as const) {
    const r = await chamar(q, { event_type: "doc_viewed", token: TOKEN }, h as Record<string, string>);
    assert.equal(r.status, 200, q + JSON.stringify(h));
    assert.equal((r.json as { status: string }).status, "visualizado");
  }
});

test("doc_signed do CLIENTE: relê no ZapSign (não confia no corpo), arquiva o PDF e marca assinado", async () => {
  docZap = corpoAssinado("pending");
  const r = await chamar("acao=zapsign-webhook&s=segredo-longo-123", { ...corpoAssinado("pending"), status: "signed" /* corpo mentiroso */ });
  assert.equal(r.status, 200);
  const leu = chamadas.find((c) => c.url === `https://api.zapsign.com.br/api/v1/docs/${TOKEN}/`)!;
  assert.equal(leu.headers.Authorization, "Bearer tk-zap");
  const rpc = chamadas.find((c) => c.url.endsWith("rpc/contrato_registrar_status"))!;
  const b = rpc.body as { p_status: string; p_extra: Record<string, unknown> };
  assert.equal(b.p_status, "assinado");
  assert.equal(b.p_extra.pdf_assinado_url, "storage:neg-1/c1-assinado.pdf");
  assert.equal(b.p_extra.quando, "2026-11-03T15:00:00Z");
  assert.ok(chamadas.some((c) => c.url.includes("crm.timeline.comment.add")), "comenta no Bitrix");
});

test("documento FECHADO (agência assinou depois): arquiva o PDF final de novo", async () => {
  contrato = { ...contrato!, status: "assinado", pdf_assinado_url: "storage:neg-1/c1-assinado.pdf" };
  docZap = corpoAssinado("signed");
  const r = await chamar("acao=zapsign-webhook&s=segredo-longo-123", corpoAssinado("signed"));
  assert.equal(r.status, 200);
  assert.ok(chamadas.some((c) => c.url.includes("/storage/v1/object/contratos/neg-1/c1-assinado.pdf")), "subiu o PDF final");
  assert.ok(!chamadas.some((c) => c.url.includes("crm.timeline.comment.add")), "não comenta duas vezes");
});

test("já assinado e documento ainda pendente: não baixa o PDF de novo", async () => {
  contrato = { ...contrato!, status: "assinado", pdf_assinado_url: "storage:neg-1/c1-assinado.pdf" };
  docZap = corpoAssinado("pending");
  await chamar("acao=zapsign-webhook&s=segredo-longo-123", { event_type: "doc_viewed", token: TOKEN });
  assert.ok(!chamadas.some((c) => c.url.includes("/storage/v1/object/contratos/")));
});

test("doc_deleted (404 no ZapSign) → cancelado com 200, sem loop de reenvio", async () => {
  docZap = null;
  const r = await chamar("acao=zapsign-webhook&s=segredo-longo-123", { event_type: "doc_deleted", token: TOKEN, deleted: true });
  assert.equal(r.status, 200);
  const rpc = chamadas.find((c) => c.url.endsWith("rpc/contrato_registrar_status"))!;
  assert.equal((rpc.body as { p_status: string }).p_status, "cancelado");
});

test("corpo repetido → 200 sem reler; documento de fora do QS → ignorado", async () => {
  webhookRepetido = true;
  const r1 = await chamar("acao=zapsign-webhook&s=segredo-longo-123", corpoAssinado("pending"));
  assert.deepEqual(r1.json, { ok: true, repetido: true });
  assert.ok(!chamadas.some((c) => c.url.includes("api.zapsign")));
  webhookRepetido = false; contrato = null;
  const r2 = await chamar("acao=zapsign-webhook&s=segredo-longo-123", corpoAssinado("pending"));
  assert.equal((r2.json as { ignorado: string }).ignorado, "documento desconhecido");
});

test("ZapSign fora do ar → 500 e apaga a marca (o ZapSign reenvia)", async () => {
  const orig = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: object) => {
    if (String(url).includes("api.zapsign")) return resposta({ detail: "erro interno" }, 502);
    return (orig as (u: string, i?: object) => Promise<unknown>)(url, init);
  };
  try {
    const r = await chamar("acao=zapsign-webhook&s=segredo-longo-123", corpoAssinado("pending"));
    assert.equal(r.status, 500);
    assert.ok(chamadas.some((c) => c.url.includes("qs_contrato_webhooks?chave=") && c.method === "DELETE"));
  } finally {
    (globalThis as { fetch: unknown }).fetch = orig;
  }
});

test("statusDoDocumento: recusado, visualizado, enviado, cancelado", () => {
  assert.equal(Z.statusDoDocumento({ status: "refused", signers: [signer()] }, "cliente@exemplo.com")!.status, "recusado");
  assert.equal(Z.statusDoDocumento({ status: "pending", signers: [signer({ times_viewed: 1 })] }, "CLIENTE@exemplo.com")!.status, "visualizado");
  assert.equal(Z.statusDoDocumento({ status: "pending", signers: [signer()] }, "cliente@exemplo.com")!.status, "enviado");
  assert.equal(Z.statusDoDocumento({ deleted: true, signers: [] }, "x")!.status, "cancelado");
  // O assinante da agência assinar ANTES do cliente não marca o contrato como assinado.
  const doc = { status: "pending", signers: [signer({ email: "contato@setuforeuvou.com", status: "signed" }), signer()] };
  assert.equal(Z.statusDoDocumento(doc, "cliente@exemplo.com")!.status, "enviado");
});

test("criarNoZapsign: corpo do POST /docs/ (cliente + agência, external_id, PDF em base64)", async () => {
  const orig = globalThis.fetch;
  let enviado: Record<string, unknown> | null = null;
  (globalThis as { fetch: unknown }).fetch = async (_url: string, init: { body?: string } = {}) => {
    enviado = JSON.parse(init.body || "{}");
    return resposta({ token: TOKEN, open_id: 7, signers: [{ email: "cliente@exemplo.com", sign_url: "https://link" }, { email: "contato@setuforeuvou.com", sign_url: "https://outro" }] }, 201);
  };
  try {
    const r = await Z.criarNoZapsign({
      c: { nome: "Fulana", email: "cliente@exemplo.com" }, cfg: Z.CONFIG_PADRAO, nomes: { zapsign: "Contrato de Pacote - Fulana" },
      pdf: Buffer.from("%PDF"), negocioId: "neg-1",
    });
    assert.deepEqual(r, { token: TOKEN, openId: "7", link: "https://link" });
    const e = enviado as unknown as { external_id: string; base64_pdf: string; signers: { email: string; phone_country?: string; phone_number?: string }[] };
    assert.equal(e.external_id, "neg-1");
    assert.equal(e.base64_pdf, Buffer.from("%PDF").toString("base64"));
    assert.equal(e.signers[1].email, "contato@setuforeuvou.com");
    assert.equal(e.signers[1].phone_country, "55");
    assert.equal(e.signers[1].phone_number, "85987660748");
  } finally {
    (globalThis as { fetch: unknown }).fetch = orig;
  }
});
