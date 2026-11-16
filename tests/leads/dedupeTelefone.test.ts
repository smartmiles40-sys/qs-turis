// Dedupe de 24h na entrada sem bitrix_id (16/11/2026): o mesmo telefone em
// formatos diferentes ("5511945329139" do Bitrix × "11945329139" do formulário)
// tem que cair no MESMO card. PostgREST de mentira (fetch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInboundLead } from "../../api/_leads.js";

test("formulário sem bitrix_id reencontra o card do Bitrix com o telefone em outro formato", async () => {
  process.env.SUPABASE_URL = "http://supabase.teste";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave";
  const existente = {
    id: "lead-bitrix", phone: "5511945329139", email: null, bitrix_id: "56197",
    owner_id: "sdr-1", cadence_id: "cad-1", created_at: new Date().toISOString(),
  };
  const chamadas: { url: string; method: string; body?: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = String(init.method || "GET");
    chamadas.push({ url: String(url), method, body: init.body as string | undefined });
    if (method === "GET" && String(url).includes("/rest/v1/qs_leads?")) {
      return new Response(JSON.stringify([existente]), { status: 200 });
    }
    if (method === "PATCH") return new Response(null, { status: 204 });
    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;
  try {
    const r = await createInboundLead({ full_name: "Cícero Pessoa", phone: "11945329139", email: "Cicero@X.com" });
    assert.equal(r.deduped, true);
    assert.equal(r.lead.id, "lead-bitrix");
    // Nada de INSERT (card duplicado)…
    assert.equal(chamadas.some((c) => c.method === "POST" && c.url.includes("/qs_leads")), false);
    // …e o e-mail que faltava foi pro card existente.
    const patch = chamadas.find((c) => c.method === "PATCH");
    assert.ok(patch && patch.body && JSON.parse(patch.body).email === "cicero@x.com");
    // A busca é pelos 8 finais, não pelo texto exato.
    const busca = chamadas.find((c) => c.method === "GET");
    assert.ok(busca && decodeURIComponent(busca.url).includes("phone.ilike.*45329139*"));
  } finally {
    globalThis.fetch = original;
  }
});

test("telefone diferente não é tratado como duplicado", async () => {
  process.env.SUPABASE_URL = "http://supabase.teste";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave";
  // A busca ampla devolve alguém com os mesmos 8 finais mas OUTRO DDD.
  const outro = { id: "outro", phone: "5521945329139", email: null, owner_id: "x", cadence_id: null, created_at: new Date().toISOString() };
  const original = globalThis.fetch;
  let inseriu = false;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = String(init.method || "GET");
    if (method === "POST" && String(url).includes("/rest/v1/qs_leads")) {
      inseriu = true;
      return new Response(JSON.stringify([{ id: "novo", owner_id: null }]), { status: 201 });
    }
    if (method === "GET" && String(url).includes("/rest/v1/qs_leads?")) {
      return new Response(JSON.stringify([outro]), { status: 200 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;
  try {
    const r = await createInboundLead({ full_name: "Fulano", phone: "11945329139" }, { semBitrix: true });
    assert.notEqual(r.deduped, true);
    assert.equal(inseriu, true);
  } finally {
    globalThis.fetch = original;
  }
});
