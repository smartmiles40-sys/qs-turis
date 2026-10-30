// E-mail marketing (0245): editor por blocos → HTML de e-mail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEmail, renderBloco, linkSeguro, imagemSegura, textoRico, MODELO_INICIAL } from "../../src/mkt/email/lib/blocos.ts";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import { montarEmail } from "../../api/_mktEmailMontar.js";

test("documento: tabela 600px, estilos inline, rodapé com {{descadastro}} sempre", () => {
  const html = renderEmail([{ id: "1", tipo: "titulo", texto: "Japão 2027" }], { rodapeEndereco: "CNPJ 53.545.815/0001-12" });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /width="600"/);
  assert.ok(!/<style/i.test(html), "sem <style>: Gmail corta");
  assert.ok(html.includes('href="{{descadastro}}"'), "rodapé automático");
  assert.ok(html.includes("CNPJ 53.545.815/0001-12"));
});

test("escapa tudo que vem do usuário", () => {
  const h = renderBloco({ id: "1", tipo: "titulo", texto: '<img src=x onerror="alert(1)">' });
  assert.ok(!h.includes("<img"));
  assert.ok(h.includes("&lt;img"));
  const t = textoRico('**oi** <b>x</b> [clique](javascript:alert(1)) [site](https://a.com?x=1&y=2)', "#000000");
  assert.ok(t.includes("<strong>oi</strong>"));
  assert.ok(t.includes("&lt;b&gt;"));
  assert.ok(t.includes('href="#"'), "javascript: vira #");
  assert.ok(t.includes('href="https://a.com?x=1&amp;y=2"'));
});

test("links e imagens seguros", () => {
  assert.equal(linkSeguro("https://a.com/x"), "https://a.com/x");
  assert.equal(linkSeguro("javascript:alert(1)"), "#");
  assert.equal(linkSeguro('https://a.com/" onclick="x'), "#");
  assert.equal(linkSeguro("{{link_grupo}}"), "{{link_grupo}}");
  assert.equal(imagemSegura("http://a.com/x.png"), null);
  assert.equal(imagemSegura("https://a.com/x.png"), "https://a.com/x.png");
  assert.equal(renderBloco({ id: "1", tipo: "imagem", url: "http://inseguro/x.png" }), "");
});

test("botão à prova de bala e colunas", () => {
  const b = renderBloco({ id: "1", tipo: "botao", texto: "Quero ir", url: "https://stfv.com.br", cor: "#ff0000", alinhar: "centro" });
  assert.match(b, /bgcolor="#ff0000"/);
  assert.match(b, /href="https:\/\/stfv\.com\.br"/);
  const cor = renderBloco({ id: "1", tipo: "botao", texto: "x", url: "https://a.com", cor: "red;background:url(x)" });
  assert.ok(cor.includes("#0E7C6A"), "cor inválida cai na padrão");
  const c = renderBloco({ id: "2", tipo: "colunas", esquerda: { texto: "A", imagem: "https://a.com/1.jpg" }, direita: { texto: "B" } });
  assert.equal((c.match(/width="50%"/g) || []).length, 2);
});

test("ponta a ponta: blocos → HTML → e-mail de uma pessoa (descadastro e clique assinados)", () => {
  const html = renderEmail(MODELO_INICIAL());
  const m = montarEmail({ html, assunto: "Oi {{primeiro_nome}}" }, { nome: "João Silva", email: "j@x.com" },
    { base: "https://qs.x.com", segredo: "k".repeat(32), token: "tok_1234567890ABCDEF" });
  assert.equal(m.assunto, "Oi João");
  assert.ok(m.html.includes("Olá, João!"));
  assert.ok(!m.html.includes("{{"), "nenhuma variável sobrando");
  assert.ok(m.html.includes("r=u&amp;t=tok_1234567890ABCDEF"));
  // o botão "https://" (inválido) virou "#" e não é rastreado
  assert.ok(m.html.includes('href="#"'));
});
