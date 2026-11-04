// Cliente da Meta Ads (api/_metaAds.js) com fetch FALSO: paginação, prazos, pausa.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../../api/_metaAds.js";

const ENV = { META_ADS_TOKEN: "tok", META_AD_ACCOUNT_ID: "123456" };
const resposta = (j: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(j) });

test("sem env, diz o que falta; com env, monta conta act_ e versão", () => {
  assert.deepEqual(M.faltaConfigurar({}), ["META_ADS_TOKEN", "META_AD_ACCOUNT_ID"]);
  assert.throws(() => M.metaConfig({}), /META_ADS_TOKEN/);
  const cfg = M.metaConfig(ENV);
  assert.equal(cfg.conta, "act_123456");
  assert.equal(cfg.base, "https://graph.facebook.com/v23.0");
  assert.equal(M.metaConfig({ ...ENV, META_AD_ACCOUNT_ID: "act_99" }).conta, "act_99");
});

test("paginar segue paging.next até o fim", async () => {
  const urls: string[] = [];
  const fetchFalso = async (url: string) => {
    urls.push(url);
    if (url.includes("pag=2")) return resposta({ data: [{ id: 3 }] });
    return resposta({ data: [{ id: 1 }, { id: 2 }], paging: { next: "https://graph.facebook.com/v23.0/x?pag=2" } });
  };
  const r = await M.paginar("https://graph.facebook.com/v23.0/x", { fetchImpl: fetchFalso as never });
  assert.deepEqual(r.itens.map((i: { id: number }) => i.id), [1, 2, 3]);
  assert.equal(r.completo, true);
  assert.equal(r.paginas, 2);
});

test("paginar para no teto de páginas e AVISA que ficou incompleto", async () => {
  const fetchSemFim = async () => resposta({ data: [{ id: 1 }], paging: { next: "https://x/proxima" } });
  const r = await M.paginar("https://x/1", { fetchImpl: fetchSemFim as never, maxPaginas: 3 });
  assert.equal(r.itens.length, 3);
  assert.equal(r.completo, false);
  const r2 = await M.paginar("https://x/1", { fetchImpl: fetchSemFim as never, ateMs: Date.now() - 1 });
  assert.equal(r2.itens.length, 0);
  assert.equal(r2.completo, false);
});

test("erro da Graph vira ErroMeta; código 190 = token vencido", async () => {
  const fetchErro = async () => resposta({ error: { message: "Error validating access token", code: 190 } }, 400);
  await assert.rejects(M.graph("https://x", { fetchImpl: fetchErro as never }), (e: M.ErroMeta) => e.tokenInvalido === true && /validating/.test(e.message));
});

test("prazo: chamada pendurada aborta", async () => {
  const pendura = (_url: string, init: { signal: AbortSignal }) => new Promise((_r, rej) => {
    init.signal.addEventListener("abort", () => { const e = new Error("abort"); e.name = "AbortError"; rej(e); });
  });
  await assert.rejects(M.graph("https://x", { fetchImpl: pendura as never, prazoMs: 20 }), /não respondeu/);
});

test("estrutura: orçamento em centavos vira reais; filtros de status vão na URL", async () => {
  const vistos: string[] = [];
  const fetchFalso = async (url: string) => {
    vistos.push(decodeURIComponent(url));
    if (url.includes("/campaigns")) return resposta({ data: [{ id: "111", name: "[STFV] [Japão]", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "15000" }] });
    if (url.includes("/adsets")) return resposta({ data: [{ id: "222", name: "C1", campaign_id: "111", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "4550" }] });
    return resposta({ data: [{ id: "333", name: "AD1", adset_id: "222", campaign_id: "111", status: "ACTIVE", effective_status: "ACTIVE" }] });
  };
  const e = await M.lerEstrutura(M.metaConfig(ENV), { fetchImpl: fetchFalso as never });
  assert.equal(e.campanhas[0].daily_budget, 150);
  assert.equal(e.conjuntos[0].daily_budget, 45.5);
  assert.equal(e.anuncios[0].conjunto_id, "222");
  assert.ok(vistos.every((u) => u.includes('"operator":"IN"') && u.includes("access_token=tok")));
});

test("insights diários: leads pelas ações (agregado 'lead' primeiro), gasto em reais", async () => {
  const fetchFalso = async (url: string) => {
    assert.match(decodeURIComponent(url), /time_range=\{"since":"2026-11-01","until":"2026-11-03"\}/);
    assert.match(url, /time_increment=1/);
    return resposta({ data: [
      { campaign_id: "111", campaign_name: "X", date_start: "2026-11-01", spend: "123.456", impressions: "1000", clicks: "30",
        actions: [{ action_type: "offsite_conversion.fb_pixel_lead", value: "9" }, { action_type: "lead", value: "12" }] },
      { campaign_id: "111", campaign_name: "X", date_start: "2026-11-02", spend: "50", impressions: "500", clicks: "3" },
    ] });
  };
  const r = await M.lerInsightsDiarios(M.metaConfig(ENV), { desde: "2026-11-01", ate: "2026-11-03", fetchImpl: fetchFalso as never });
  assert.deepEqual(r.linhas.map((l: { gasto: number; leads: number }) => [l.gasto, l.leads]), [[123.46, 12], [50, 0]]);
  assert.equal(M.leadsDasAcoes([{ action_type: "onsite_conversion.lead_grouped", value: "4" }]), 4);
});

test("mudarStatus: POST com status=PAUSED no corpo; recusa id ou status estranho", async () => {
  let chamada: { url: string; init: { method: string; body: string } } | null = null;
  const fetchFalso = async (url: string, init: { method: string; body: string }) => { chamada = { url, init }; return resposta({ success: true }); };
  await M.mudarStatus(M.metaConfig(ENV), "120000000001", "PAUSED", { fetchImpl: fetchFalso as never });
  assert.equal(chamada!.url, "https://graph.facebook.com/v23.0/120000000001");
  assert.equal(chamada!.init.method, "POST");
  assert.match(chamada!.init.body, /status=PAUSED/);
  await assert.rejects(M.mudarStatus(M.metaConfig(ENV), "abc", "PAUSED", { fetchImpl: fetchFalso as never }), /Id inválido/);
  await assert.rejects(M.mudarStatus(M.metaConfig(ENV), "120000000001", "DELETED", { fetchImpl: fetchFalso as never }), /Status inválido/);
});
