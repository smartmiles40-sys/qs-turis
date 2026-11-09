// Cron do closer → Bitrix (api/closer.js, cronBitrix), com o PostgREST de mentira:
// os cartões 'sem_card' cujo lead já tem bitrix_id entram na rodada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cronBitrix } from "../api/closer.js";

test("cron: pendente + erro + sem_card com bitrix_id; sem_card sem id fica de fora", async () => {
  process.env.SUPABASE_URL = "http://supabase.teste";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave";
  const pedidos: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const u = decodeURIComponent(String(url));
    pedidos.push(u);
    let corpo: unknown = [];
    if (u.includes("bitrix_status=eq.pendente")) corpo = [{ id: "p1" }];
    else if (u.includes("bitrix_status=eq.erro")) corpo = [{ id: "e1" }];
    else if (u.includes("bitrix_status=eq.sem_card")) corpo = [{ id: "s1", lead: { bitrix_id: "123" } }, { id: "s2", lead: { bitrix_id: "" } }];
    // espelhar lê o cartão: devolve vazio (404) — o teste só olha quem foi tentado.
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const r = await cronBitrix();
    assert.equal(r.pendentes, 1);
    assert.equal(r.erros, 1);
    assert.equal(r.sem_card_com_bitrix, 1);
    const semCard = pedidos.find((p) => p.includes("bitrix_status=eq.sem_card"));
    assert.ok(semCard?.includes("qs_leads!inner(bitrix_id)"));
    assert.ok(semCard?.includes("lead.bitrix_id=not.is.null"));
    const tentados = pedidos.filter((p) => p.includes("qs_closer_negocios?select=*&id=eq.")).map((p) => p.split("id=eq.")[1].split("&")[0]);
    assert.deepEqual(tentados, ["p1", "e1", "s1"]);
  } finally {
    globalThis.fetch = original;
  }
});
