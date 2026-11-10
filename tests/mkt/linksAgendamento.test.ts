// Links de agendamento do Marketing (0354, Bruno 10/11/2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORM_VAZIO, linhaDoForm, novoCodigo, problemasDoForm, slug, urlDoLink } from "../../src/mkt/agendamento/regras.ts";
import { diasUteisDoLink, recadoDoLimite, ultimoDiaPermitido } from "../../api/_limiteAgendamento.js";
import { codigoDoCorpo, linhaDeRastro, utmDoCorpo } from "../../api/_linkAgendamento.js";
import { camposUtmBitrix } from "../../api/_bitrixLead.js";

const base = "https://qs.setuforeuvouviagens.com.br";
const salvo = {
  codigo: "japao-stories-ab12", tipo: "closer" as const, expedicao: "Japão", origem: "Instagram - Stories",
  utm_source: "instagram", utm_medium: "stories", utm_campaign: "japao-2027", utm_content: null, utm_term: null,
  dias: null, dias_uteis: 3, tema_stfv: false,
};

test("slug e código: sem acento, minúsculo, com sufixo", () => {
  assert.equal(slug("Japão 2027 — Stories!"), "japao-2027-stories");
  const c = novoCodigo("Japão Stories", () => 0);
  assert.match(c, /^japao-stories-[a-z0-9]{4}$/);
  assert.match(c, /^[a-z0-9-]{3,60}$/); // o check do banco
});

test("URL do closer: sem com=, com UTMs e o código", () => {
  const u = new URL(urlDoLink(base, salvo));
  assert.equal(u.pathname, "/agendar/");
  assert.equal(u.searchParams.get("com"), null);
  assert.equal(u.searchParams.get("expedicao"), "Japão");
  assert.equal(u.searchParams.get("utm_campaign"), "japao-2027");
  assert.equal(u.searchParams.get("l"), "japao-stories-ab12");
  assert.equal(u.searchParams.get("uteis"), null); // 3 = regra geral, não vai
});

test("URL do SDR com 2 dias úteis", () => {
  const u = new URL(urlDoLink(base, { ...salvo, tipo: "sdr-semana", dias_uteis: 2 }));
  assert.equal(u.searchParams.get("com"), "sdr-semana");
  assert.equal(u.searchParams.get("uteis"), "2");
});

test("form: exige nome, source e campaign; limpa as UTMs", () => {
  assert.equal(problemasDoForm(FORM_VAZIO).length, 3);
  const l = linhaDoForm({ ...FORM_VAZIO, nome: " Teste ", utm_source: " Instagram ", utm_medium: "Stories Bio", utm_campaign: "Japão 2027", dias_uteis: 2 });
  assert.equal(l.nome, "Teste");
  assert.equal(l.utm_source, "instagram");
  assert.equal(l.utm_medium, "stories-bio");
  assert.equal(l.utm_campaign, "Japão-2027");
  assert.equal(l.dias_uteis, 2);
  assert.equal(l.expedicao, null);
});

test("servidor: ?uteis só encurta (1..3), inválido = 3", () => {
  assert.equal(diasUteisDoLink("2"), 2);
  assert.equal(diasUteisDoLink(5), 3);
  assert.equal(diasUteisDoLink("x"), 3);
  // terça 10/11: 2 dias úteis = quinta 12/11; 1 = quarta 11/11
  const ter = new Date("2026-11-10T12:00:00Z");
  assert.equal(ultimoDiaPermitido(ter, 2), "2026-11-12");
  assert.equal(ultimoDiaPermitido(ter, 1), "2026-11-11");
  assert.equal(recadoDoLimite(2), "Só dá pra agendar até 2 dias úteis à frente.");
});

test("servidor: UTMs, código e rastro", () => {
  assert.deepEqual(utmDoCorpo({ utm_source: " ig ", utm_medium: "", utm_campaign: "x", outro: "y" }), { utm_source: "ig", utm_campaign: "x" });
  assert.equal(codigoDoCorpo({ link: "Japao-AB12" }), "japao-ab12");
  assert.equal(codigoDoCorpo({ link: "../x" }), null);
  assert.equal(linhaDeRastro({ utm_source: "ig" }, "Japão"), "Link: Japão · utm_source=ig");
  assert.equal(linhaDeRastro({}, null), null);
  assert.deepEqual(camposUtmBitrix({ utm_source: "ig", utm_campaign: "japao", utm_term: "" }), { UTM_SOURCE: "ig", UTM_CAMPAIGN: "japao" });
});
