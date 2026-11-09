// UTM do lead (0265): o que a entrada aceita e o que o Bitrix manda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { utmDoPayload } from "../../api/_leads.js";
import { achatar, leadDoBitrix, completarPeloNegocio } from "../../api/_bitrixEntrada.js";

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
