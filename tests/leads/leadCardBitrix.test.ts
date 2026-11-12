// Card do lead no Bitrix (12/11/2026, 0362): recuo, decisão vincular × criar,
// fila da rotina, simulação sem escrita, rotina desligada, sucesso falso do
// /api/bitrix-sync e o alerta da gestão. PostgREST/Bitrix de mentira (fetch).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planoDaFalha, decidirVinculo, caminhoDaFila, rodadaRetentativa, retentativaLigada,
  MAX_TENTATIVAS, RECUO_MIN,
} from "../../api/_leadCardBitrix.js";
import { regraLeadsSemCard } from "../../api/qs-alertas.js";
import { seloDoCard } from "../../src/components/sdr/leads/cardBitrixRegras.ts";

const T0 = Date.UTC(2026, 10, 12, 15, 0);

test("planoDaFalha: recuo crescente e desiste na 6ª", () => {
  const p1 = planoDaFalha(0, "fora do ar", T0);
  assert.equal(p1.bitrix_card_status, "pendente");
  assert.equal(p1.bitrix_card_tentativas, 1);
  assert.equal(Date.parse(p1.bitrix_card_proxima!) - T0, RECUO_MIN[0] * 60_000);
  assert.equal(p1.bitrix_card_trava, null);
  const p3 = planoDaFalha(2, "x", T0);
  assert.equal(Date.parse(p3.bitrix_card_proxima!) - T0, RECUO_MIN[2] * 60_000);
  const ult = planoDaFalha(MAX_TENTATIVAS - 1, "y".repeat(500), T0);
  assert.equal(ult.bitrix_card_status, "falhou");
  assert.equal(ult.bitrix_card_proxima, null);
  assert.equal(ult.bitrix_card_erro.length, 300);
});

test("decidirVinculo: procura antes de criar, nunca cria às cegas", () => {
  const lead = { created_at: "2026-11-12T12:00:00Z" };
  assert.equal(decidirVinculo(lead, { indisponivel: true, motivo: "timeout" }, null).acao, "erro");
  assert.equal(decidirVinculo(lead, { achou: false, semTelefone: true }, null).acao, "criar");
  assert.deepEqual(
    { ...decidirVinculo(lead, { achou: false }, null), motivo: "" },
    { acao: "criar", contatoId: null, motivo: "" });
  // contato sem negócio → cria no contato
  const c = decidirVinculo(lead, { achou: true, contatoId: "9", dealId: null }, null);
  assert.equal(c.acao, "criar"); assert.equal(c.contatoId, "9");
  // negócio nascido junto (±48h) e livre → vincula
  const deal = { DATE_CREATE: "2026-11-12T11:58:00-03:00" };
  const v = decidirVinculo(lead, { achou: true, contatoId: "9", dealId: "555", deal }, null);
  assert.equal(v.acao, "vincular"); assert.equal(v.dealId, "555");
  // mesmo negócio, mas já é de outro lead → cria novo no mesmo contato
  const o = decidirVinculo(lead, { achou: true, contatoId: "9", dealId: "555", deal }, { id: "x", full_name: "Fulana" });
  assert.equal(o.acao, "criar"); assert.equal(o.contatoId, "9"); assert.match(o.motivo, /Fulana/);
  // negócio antigo → cria novo (não gruda num card de meses atrás)
  const a = decidirVinculo(lead, { achou: true, contatoId: "9", dealId: "1", deal: { DATE_CREATE: "2026-05-01T10:00:00-03:00" } }, null);
  assert.equal(a.acao, "criar");
});

test("caminhoDaFila: abertos sem card, pendentes/antigos, vencidos; perdidos só com flag", () => {
  const p = decodeURIComponent(caminhoDaFila({ agoraIso: "2026-11-12T15:00:00.000Z", limite: 5 }));
  assert.ok(p.includes("bitrix_id=is.null"));
  assert.ok(p.includes("status=in.(nao_iniciado,em_prospeccao,ganho)"));
  assert.ok(p.includes("or(bitrix_card_status.is.null,bitrix_card_status.eq.pendente)"));
  assert.ok(p.includes('bitrix_card_proxima.lte."2026-11-12T15:00:00.000Z"'));
  assert.ok(p.includes("limit=5"));
  const q = decodeURIComponent(caminhoDaFila({ agoraIso: "x", limite: 9, perdidos: true, apenasVencidos: false, offset: 10 }));
  assert.ok(q.includes(",perdido)"));
  assert.ok(!q.includes("bitrix_card_proxima.lte"));
  assert.ok(q.includes("offset=10"));
});

function fetchFalso(linhas: unknown[], pedidos: { url: string; method: string }[]) {
  return (async (url: string, init?: RequestInit) => {
    pedidos.push({ url: decodeURIComponent(String(url)), method: init?.method || "GET" });
    return new Response(JSON.stringify(String(url).includes("qs_leads?select=") ? linhas : []), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

test("simulação: lista a fila e NÃO escreve nada nem chama o Bitrix", async () => {
  process.env.SUPABASE_URL = "http://supabase.teste";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave";
  process.env.BITRIX_WEBHOOK_BASE = "http://bitrix.teste/rest/1/x";
  const pedidos: { url: string; method: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = fetchFalso([
    { id: "a", full_name: "A", status: "em_prospeccao", bitrix_card_status: null },
    { id: "b", full_name: "B", status: "ganho", bitrix_card_status: "pendente", bitrix_card_tentativas: 2 },
  ], pedidos);
  try {
    const r = await rodadaRetentativa({ seco: true });
    assert.equal(r.seco, true);
    assert.equal(r.resumo.na_fila, 2);
    assert.deepEqual(r.resumo.por_status, { em_prospeccao: 1, ganho: 1 });
    assert.equal(r.itens[0].estado, "(antigo, sem marca)");
    assert.ok(pedidos.every((p) => p.method === "GET"), "simulação só lê");
    assert.ok(pedidos.every((p) => !p.url.includes("bitrix.teste")), "sem consultar=1 não encosta no Bitrix");
  } finally {
    globalThis.fetch = original;
  }
});

test("rotina desligada (padrão): só conta, não envia", async () => {
  delete process.env.LEADS_BITRIX_RETENTATIVA_LIGADA;
  assert.equal(retentativaLigada(), false);
  assert.equal(retentativaLigada({ LEADS_BITRIX_RETENTATIVA_LIGADA: "1" }), true);
  const pedidos: { url: string; method: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = fetchFalso([{ id: "a", status: "em_prospeccao" }], pedidos);
  try {
    const r = await rodadaRetentativa({ seco: false });
    assert.equal(r.desligada, true);
    assert.equal(r.na_fila_agora, 1);
    assert.ok(pedidos.every((p) => p.method === "GET" && !p.url.includes("bitrix.teste")));
  } finally {
    globalThis.fetch = original;
  }
});

test("bitrix-sync: lead sem card não é mais sucesso", async () => {
  process.env.INTERNAL_API_SECRET = "segredo-interno";
  const { default: rota } = await import("../../api/bitrix-sync.js");
  const pedidos: { url: string; method: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = fetchFalso([{ id: "11111111-1111-1111-1111-111111111111", owner_id: null, bitrix_id: null, bitrix_card_status: "pendente" }], pedidos);
  const res = {
    statusCode: 200, body: null as Record<string, unknown> | null,
    setHeader() {},
    status(c: number) { this.statusCode = c; return this; },
    json(o: Record<string, unknown>) { this.body = o; return this; },
  };
  try {
    await rota({ method: "POST", headers: { "x-internal-secret": "segredo-interno" },
      body: { event: "nota", lead_id: "11111111-1111-1111-1111-111111111111", body: "oi" } }, res);
    assert.equal(res.body?.success, false);
    assert.equal(res.body?.code, "skipped_no_bitrix_id");
    assert.equal(res.body?.pendente, true);
    // Já estava pendente: não regrava a marca.
    assert.ok(!pedidos.some((p) => p.method === "PATCH"));
  } finally {
    globalThis.fetch = original;
  }
});

test("alerta e selo", () => {
  assert.equal(regraLeadsSemCard(0), null);
  const a = regraLeadsSemCard(7, { rotinaLigada: false });
  assert.equal(a?.id, "leads_sem_card");
  assert.match(a!.texto, /DESLIGADA/);
  assert.match(regraLeadsSemCard(3, { rotinaLigada: true })!.texto, /tentando de novo/);

  assert.equal(seloDoCard({ id: "1", bitrix_id: "9" }), null);
  assert.equal(seloDoCard({ id: "1", bitrix_card_status: "pendente" })?.texto, "Sem card no Bitrix — tentando de novo");
  assert.equal(seloDoCard({ id: "1", bitrix_card_status: "falhou", bitrix_card_erro: "recusou" })?.texto, "Falhou: recusou");
  assert.equal(seloDoCard({ id: "1", status: "perdido" })?.texto, "Sem card no Bitrix");
  assert.equal(seloDoCard({ id: "1", bitrix_card_status: "so_qs" }), null);
});
