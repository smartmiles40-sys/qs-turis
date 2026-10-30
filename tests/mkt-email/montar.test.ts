// E-mail marketing (0245): montagem do e-mail, HMAC do clique, descadastro, Svix.
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/mkt-email/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import * as M from "../../api/_mktEmailMontar.js";

const BASE = "https://qs.exemplo.com.br";
const SEG = "segredo-de-teste-0123456789abcdef";
const TOKEN = "tok_ABCDEFGHIJKLMNOP1234";

test("personalizar: troca e ESCAPA o dado da pessoa; variável desconhecida some", () => {
  const out = M.personalizar("Olá {{ Primeiro_Nome }}, {{cidade}} {{plano}}", {
    nome: "Maria <b>Silva</b>", email: "m@x.com", campos: { cidade: "Rio & Cia" },
  });
  assert.equal(out, "Olá Maria, Rio &amp; Cia ");
  assert.equal(M.personalizar("{{nome}}", { nome: "<script>" }), "&lt;script&gt;");
  // assunto (texto puro) não escapa
  assert.equal(M.personalizar("Tudo & {{nome}}", { nome: "A&B" }, { html: false }), "Tudo & A&B");
  // estrutural fica para a etapa seguinte
  assert.equal(M.personalizar("{{descadastro}}", { nome: "x" }), "{{descadastro}}");
});

test("HMAC: link assinado volta o destino; adulterado é recusado", () => {
  const url = M.urlDeClique(BASE, SEG, TOKEN, "https://setuforeuvou.com.br/japao?utm=a&b=1");
  const q = new URL(url).searchParams;
  assert.equal(q.get("r"), "c");
  assert.equal(M.destinoDoClique(SEG, q.get("t"), q.get("u"), q.get("s")), "https://setuforeuvou.com.br/japao?utm=a&b=1");
  // outro destino com a mesma assinatura
  const falso = Buffer.from("https://phishing.example", "utf8").toString("base64url");
  assert.equal(M.destinoDoClique(SEG, q.get("t"), falso, q.get("s")), null);
  // outro token
  assert.equal(M.destinoDoClique(SEG, "outro_token_1234567", q.get("u"), q.get("s")), null);
  // outra chave
  assert.equal(M.destinoDoClique("outra-chave", q.get("t"), q.get("u"), q.get("s")), null);
  // sem chave nunca confere
  assert.equal(M.destinoDoClique(null, q.get("t"), q.get("u"), q.get("s")), null);
});

test("HMAC: mesmo assinado, só http(s) redireciona", () => {
  const u = Buffer.from("javascript:alert(1)", "utf8").toString("base64url");
  const s = M.assinar(SEG, `${TOKEN}.${u}`);
  assert.equal(M.destinoDoClique(SEG, TOKEN, u, s), null);
});

test("reescreverLinks: rastreia http(s), deixa mailto/tel/âncora/descadastro", () => {
  const html = `<a href="https://a.com/x?y=1&amp;z=2">A</a><a href="mailto:a@b.com">M</a><a href="#topo">T</a><a href='${BASE}/api/mkt-email-publico?r=u&amp;t=x'>S</a><a href="/relativo">R</a>`;
  const out = M.reescreverLinks(html, { base: BASE, segredo: SEG, token: TOKEN });
  const hrefs = [...out.matchAll(/href=(["'])(.*?)\1/g)].map((m) => m[2]);
  assert.match(hrefs[0], /^https:\/\/qs\.exemplo\.com\.br\/api\/mkt-email-publico\?r=c&amp;t=/);
  const real = new URL(hrefs[0].replace(/&amp;/g, "&"));
  assert.equal(M.destinoDoClique(SEG, real.searchParams.get("t"), real.searchParams.get("u"), real.searchParams.get("s")), "https://a.com/x?y=1&z=2");
  assert.equal(hrefs[1], "mailto:a@b.com");
  assert.equal(hrefs[2], "#topo");
  assert.ok(hrefs[3].includes("r=u"));
  assert.equal(hrefs[4], "/relativo");
});

test("montarEmail: descadastro da pessoa, pixel, preheader, texto e assunto", () => {
  const m = M.montarEmail(
    { html: '<html><body><p>Oi {{nome}}</p><a href="https://x.com">ver</a><a href="{{descadastro}}">sair</a></body></html>', assunto: "Para {{primeiro_nome}} & cia", preheader: "Prévia {{nome}}" },
    { nome: "Ana Paula", email: "ana@x.com" },
    { base: BASE, segredo: SEG, token: TOKEN },
  );
  assert.equal(m.assunto, "Para Ana & cia");
  assert.ok(m.html.includes(`r=u&amp;t=${TOKEN}`), "link de descadastro da pessoa");
  assert.ok(m.html.includes(`r=o&amp;t=${TOKEN}`), "pixel");
  assert.ok(m.html.indexOf("Prévia Ana Paula") < m.html.indexOf("Oi Ana Paula"), "preheader no começo do body");
  assert.ok(m.html.indexOf("r=o&amp;") < m.html.indexOf("</body>"), "pixel antes do </body>");
  assert.ok(!m.html.includes("{{descadastro}}"));
  assert.equal(m.urlDescadastro, `${BASE}/api/mkt-email-publico?r=u&t=${TOKEN}`);
  assert.ok(m.texto.includes("Oi Ana Paula"));
  assert.ok(!m.texto.includes("Prévia"), "preheader invisível não entra no texto");
});

test("montarEmail: modelo sem descadastro ganha rodapé com os dados da empresa", () => {
  const m = M.montarEmail({ html: "<p>Oi</p>", assunto: "a" }, { email: "a@b.com" },
    { base: BASE, segredo: SEG, token: TOKEN, rodapeEndereco: "CNPJ 53.545.815/0001-12" });
  assert.ok(m.html.includes("Descadastrar meu e-mail"));
  assert.ok(m.html.includes("CNPJ 53.545.815/0001-12"));
});

test("montarEmail: rastrear=false não troca links nem põe pixel", () => {
  const m = M.montarEmail({ html: '<a href="https://x.com">x</a>{{descadastro}}', assunto: "a" }, { email: "a@b.com" },
    { base: BASE, segredo: SEG, token: TOKEN, rastrear: false });
  assert.ok(m.html.includes('href="https://x.com"'));
  assert.ok(!m.html.includes("r=o"));
});

test("List-Unsubscribe One-Click e remetente", () => {
  assert.deepEqual(M.cabecalhosDescadastro("https://q/u"), {
    "List-Unsubscribe": "<https://q/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
  assert.deepEqual(M.cabecalhosDescadastro(null), {});
  assert.equal(M.ehUmCliqueDoProvedor("List-Unsubscribe=One-Click"), true);
  assert.equal(M.ehUmCliqueDoProvedor("confirmar=1"), false);
  assert.equal(M.formatarRemetente("Se Tu For, Eu Vou!", "a@b.com"), '"Se Tu For, Eu Vou!" <a@b.com>');
  assert.equal(M.formatarRemetente("Equipe STFV", "a@b.com"), "Equipe STFV <a@b.com>");
  assert.equal(M.formatarRemetente("X\r\nBcc: y", "a@b.com"), '"X  Bcc: y" <a@b.com>');
});

test("Svix: assinatura certa passa; corpo mexido, velho ou sem segredo falha", () => {
  const segredo = "whsec_" + Buffer.from("chave-secreta-do-webhook").toString("base64");
  const corpo = JSON.stringify({ type: "email.bounced", data: { email_id: "abc" } });
  const ts = String(Math.floor(Date.now() / 1000));
  const assinatura = createHmac("sha256", Buffer.from("chave-secreta-do-webhook")).update(`msg_1.${ts}.${corpo}`).digest("base64");
  const cab = { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": `v1,xxxx v1,${assinatura}` };
  assert.equal(M.svixConfere(corpo, cab, segredo), true);
  assert.equal(M.svixConfere(corpo + " ", cab, segredo), false);
  assert.equal(M.svixConfere(corpo, cab, ""), false);
  assert.equal(M.svixConfere(corpo, cab, segredo, Number(ts) + 600), false);
  assert.equal(M.traduzirEventoResend("email.bounced"), "bounce");
  assert.equal(M.traduzirEventoResend("email.complained"), "spam");
  assert.equal(M.traduzirEventoResend("email.opened"), null);
});
