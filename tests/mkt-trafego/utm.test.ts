// UTM do lead (0265): o que a entrada aceita e o que o Bitrix manda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { utmDoPayload } from "../../api/_leads.js";
import { achatar, leadDoBitrix, completarPeloNegocio, normalizarUtm, juntarUtm, utmDoNegocio } from "../../api/_bitrixEntrada.js";

test("utmDoPayload: minúsculo ou maiúsculo, vazio some, corta em 300", () => {
  assert.deepEqual(utmDoPayload({ utm_campaign: " [STFV] [Japão] ", UTM_SOURCE: "facebook", utm_content: "" }), { utm_source: "facebook", utm_campaign: "[STFV] [Japão]" });
  assert.deepEqual(utmDoPayload({}), {});
  assert.equal(utmDoPayload({ utm_term: "x".repeat(400) }).utm_term.length, 300);
});

test("robô do Bitrix com &utm_campaign= na URL leva a UTM pro lead; sem ela nada muda", () => {
  const l = leadDoBitrix(achatar({ Nome: "Ana", Telefone: "11999990000", utm_campaign: "[STFV] [China 2027] | ABO" }));
  assert.equal(l.utm_campaign, "[STFV] [China 2027] | ABO");
  assert.equal("utm_source" in leadDoBitrix(achatar({ Nome: "Ana" })), false);
});

test("negócio lido do Bitrix traz UTM_CAMPAIGN do campo padrão", async () => {
  const bx = async (metodo: string) => (metodo === "crm.deal.get"
    ? { ID: "1", TITLE: "Ana", CONTACT_ID: "0", UTM_CAMPAIGN: "[STFV] [Japão] | ABO - Teste Público", UTM_SOURCE: "fb" }
    : null);
  const r = await completarPeloNegocio("1", bx as never);
  assert.equal(r!.campos.utm_campaign, "[STFV] [Japão] | ABO - Teste Público");
  assert.equal(r!.campos.utm_source, "fb");
  assert.equal("utm_term" in r!.campos, false);
});

// ── 12/11/2026: UTM normalizada + negócio lido em toda entrada ───────────────
test("normalizarUtm: codificada, acento quebrado, NFD, emoji na frente, template", () => {
  assert.equal(normalizarUtm("%5BSTFV%5D+%5BJap%C3%A3o%5D"), "[STFV] [Japão]");
  assert.equal(normalizarUtm("[STFV] [JapÃ£o]"), "[STFV] [Japão]");
  assert.equal(normalizarUtm("Japão"), "Japão");
  assert.equal(normalizarUtm("🇯🇵 [STFV]  Japão "), "[STFV] Japão");
  assert.equal(normalizarUtm("{{UTM_CAMPAIGN}}"), null);
  assert.equal(normalizarUtm("   "), null);
  assert.equal(normalizarUtm("100% orgânico"), "100% orgânico"); // % solto não quebra
  assert.equal(normalizarUtm("Promo 🇯🇵 Ã£"), "Promo 🇯🇵 Ã£"); // com emoji no meio não relê latin-1
});

test("juntarUtm: a da URL vence; o negócio completa o que faltou", () => {
  const lead: any = { full_name: "Ana", utm_campaign: "Da URL", utm_source: "{{UTM_SOURCE}}" };
  const origem = juntarUtm(lead, utmDoNegocio({ UTM_CAMPAIGN: "Do negócio", UTM_SOURCE: "fb", UTM_MEDIUM: "" }));
  assert.equal(lead.utm_campaign, "Da URL");
  assert.equal(lead.utm_source, "fb");
  assert.equal("utm_medium" in lead, false);
  assert.deepEqual(origem, { utm_campaign: "url", utm_source: "negocio" });
  const semNada: any = { full_name: "Ana" };
  assert.deepEqual(juntarUtm(semNada, null), {});
});

test("completarPeloNegocio semContato: lê só o negócio (1 chamada)", async () => {
  const chamadas: string[] = [];
  const bx = async (metodo: string) => { chamadas.push(metodo); return metodo === "crm.deal.get" ? { ID: "1", CONTACT_ID: "77", UTM_CAMPAIGN: "Jap%C3%A3o" } : { NAME: "X" }; };
  const r = await completarPeloNegocio("1", bx as never, { semContato: true });
  assert.deepEqual(chamadas, ["crm.deal.get"]);
  assert.equal(r!.campos.utm_campaign, "Japão");
});
