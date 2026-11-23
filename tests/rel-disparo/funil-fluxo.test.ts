// 0414 (23/11): link rastreado do bloco Mensagem do fluxo + leitura do clique.
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkDoFluxo, lerCliqueFluxo, rastrearLinkDoCorpo } from "../../api/_relDisparoRegras.js";

const EXEC = "06263519-6cef-49ed-a9d2-634e17428061";
const cta = (url: string) => ({ type: "interactive", interactive: { type: "cta_url", body: { text: "oi" }, action: { name: "cta_url", parameters: { display_text: "Abrir", url } } } });

test("monta /l/f/<execução>/<bloco> sem barra dupla", () => {
  assert.equal(linkDoFluxo("https://qs.x.com.br/", EXEC, "men_t99l4w3"), `https://qs.x.com.br/l/f/${EXEC}/men_t99l4w3`);
});

test("lê o clique só com uuid e id de bloco válidos", () => {
  assert.deepEqual(lerCliqueFluxo(EXEC, "men_t99l4w3"), { execId: EXEC, noId: "men_t99l4w3" });
  assert.equal(lerCliqueFluxo("abc", "men_1"), null);
  assert.equal(lerCliqueFluxo(EXEC, "../x"), null);
});

test("troca a URL do botão link fixo pelo rastreado", () => {
  const r = rastrearLinkDoCorpo(cta("https://site.com/indica/"), "https://site.com/indica/", "https://qs/l/f/a/b") as ReturnType<typeof cta>;
  assert.equal(r.interactive.action.parameters.url, "https://qs/l/f/a/b");
  assert.equal(r.interactive.action.parameters.display_text, "Abrir");
});

test("não mexe em link com variável, texto simples ou botões", () => {
  const comVar = cta("https://site.com/?n=Ana");
  assert.equal(rastrearLinkDoCorpo(comVar, "https://site.com/?n={{primeiro_nome}}", "R"), comVar);
  const texto = { type: "text", text: { body: "https://site.com" } };
  assert.equal(rastrearLinkDoCorpo(texto, "https://site.com", "R"), texto);
});
