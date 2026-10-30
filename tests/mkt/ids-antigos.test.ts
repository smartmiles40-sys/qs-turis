// Links antigos do Marketing (30/10/2026): o menu encolheu, o link velho não quebra.
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/mkt/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { IDS_ANTIGOS_CONTEUDO, traduzirHash, type MapaIdsAntigos } from "../../src/mkt/conteudo/idsAntigos.ts";

// Espelho de src/mkt/email/rotas.ts (o arquivo de rotas importa React.lazy, não roda no node:test).
const EMAIL: MapaIdsAntigos = {
  "email-campanhas": { tela: "email" },
  "email-relatorios": { tela: "email" },
  "email-modelos": { tela: "email", params: { aba: "modelos" } },
  "email-segmentos": { tela: "email", params: { aba: "publicos" } },
  "email-automacoes": { tela: "email", params: { aba: "automacoes" } },
  "email-conexao": { tela: "email", params: { conexao: "1" } },
};

test("Equipe e Colunas caem em Ajustes, na aba certa", () => {
  assert.equal(traduzirHash("#mkt/equipe", "mkt", IDS_ANTIGOS_CONTEUDO), "#mkt/ajustes");
  assert.equal(traduzirHash("#mkt/colunas", "mkt", IDS_ANTIGOS_CONTEUDO), "#mkt/ajustes?aba=colunas");
  assert.equal(traduzirHash("#/mkt/colunas", "mkt", IDS_ANTIGOS_CONTEUDO), "#mkt/ajustes?aba=colunas");
});

test("as 6 telas de e-mail caem na página E-mail", () => {
  assert.equal(traduzirHash("#mkt/email-campanhas", "mkt", EMAIL), "#mkt/email");
  assert.equal(traduzirHash("#mkt/email-relatorios", "mkt", EMAIL), "#mkt/email");
  assert.equal(traduzirHash("#mkt/email-modelos", "mkt", EMAIL), "#mkt/email?aba=modelos");
  assert.equal(traduzirHash("#mkt/email-segmentos", "mkt", EMAIL), "#mkt/email?aba=publicos");
  assert.equal(traduzirHash("#mkt/email-automacoes", "mkt", EMAIL), "#mkt/email?aba=automacoes");
  assert.equal(traduzirHash("#mkt/email-conexao", "mkt", EMAIL), "#mkt/email?conexao=1");
});

test("mantém os outros parâmetros e larga o id antigo", () => {
  assert.equal(traduzirHash("#mkt/email-modelos/abc?x=1", "mkt", EMAIL), "#mkt/email?x=1&aba=modelos");
});

test("não mexe em tela nova, em outra área nem no início", () => {
  assert.equal(traduzirHash("#mkt/email?aba=modelos", "mkt", EMAIL), null);
  assert.equal(traduzirHash("#mkt/quadro/123", "mkt", IDS_ANTIGOS_CONTEUDO), null);
  assert.equal(traduzirHash("#rel/equipe", "mkt", IDS_ANTIGOS_CONTEUDO), null);
  assert.equal(traduzirHash("#mkt", "mkt", IDS_ANTIGOS_CONTEUDO), null);
  assert.equal(traduzirHash("", "mkt", IDS_ANTIGOS_CONTEUDO), null);
  assert.equal(traduzirHash("#mkt/toString", "mkt", IDS_ANTIGOS_CONTEUDO), null);
});
