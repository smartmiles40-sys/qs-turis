// Instagram do Marketing: regras puras + assinatura do webhook + "desligado não faz nada".
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.SUPABASE_URL = "https://falso.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";

const IG = await import("../../api/_mktInstagram.js");
const { assinaturaConfere } = await import("../../api/mkt-instagram.js");

const a = (gatilho: string, config: object, id = gatilho, criado_em = "2026-10-01") => ({ id, nome: id, ativo: true, gatilho, config, criado_em });

test("comentário: a automação mais específica ganha (post > palavra > qualquer)", () => {
  const lista = [a("comentario", { qualquer_palavra: true }, "qualquer"), a("comentario", { palavras: ["roteiro"] }, "palavra"), a("comentario", { palavras: ["roteiro"], posts: ["123"] }, "post")];
  assert.equal(IG.escolherParaComentario(lista, "Quero o ROTEIRO!", "123").id, "post");
  assert.equal(IG.escolherParaComentario(lista, "Quero o roteiro", "999").id, "palavra");
  assert.equal(IG.escolherParaComentario(lista, "lindo", "999").id, "qualquer");
  assert.equal(IG.escolherParaComentario([a("comentario", { palavras: ["eu"] })], "europa", null), null);
});

test("DM: menção > resposta a story > palavra > boas-vindas", () => {
  const lista = [a("story_mencao", {}), a("story_resposta", {}), a("dm_palavra", { palavras: ["peru"] }), a("boas_vindas", {})];
  assert.equal(IG.escolherParaDm(lista, { texto: "", ehMencaoStory: true, ehRespostaStory: false, primeiraMensagem: true }).gatilho, "story_mencao");
  assert.equal(IG.escolherParaDm(lista, { texto: "amei", ehMencaoStory: false, ehRespostaStory: true, primeiraMensagem: false }).gatilho, "story_resposta");
  assert.equal(IG.escolherParaDm(lista, { texto: "e o Peru?", ehMencaoStory: false, ehRespostaStory: false, primeiraMensagem: false }).gatilho, "dm_palavra");
  assert.equal(IG.escolherParaDm(lista, { texto: "oi", ehMencaoStory: false, ehRespostaStory: false, primeiraMensagem: true }).gatilho, "boas_vindas");
  assert.equal(IG.escolherParaDm(lista, { texto: "oi", ehMencaoStory: false, ehRespostaStory: false, primeiraMensagem: false }), null);
});

test("mensagem com botões de link e validação", () => {
  const m = IG.montarMensagemIg("Segue o roteiro", [{ titulo: "Ver roteiro", url: "https://setufor.com/japao" }]);
  assert.equal(m.attachment.payload.buttons[0].type, "web_url");
  assert.deepEqual(IG.montarMensagemIg("oi"), { text: "oi" });
  assert.equal(IG.validarAutomacaoIg({ nome: "x", gatilho: "comentario", config: { dm_texto: "oi" } }).ok, false);
  assert.equal(IG.validarAutomacaoIg({ nome: "x", gatilho: "comentario", config: { palavras: "roteiro, preço", dm_texto: "oi {{nome}}" } }).ok, true);
  assert.equal(IG.personalizarIg("Oi {{nome}} ({{usuario}})", { nome: "Ana Lima", username: "analima" }), "Oi Ana (@analima)");
});

test("assinatura do webhook: confere com o segredo certo, recusa o errado e cabeçalho lixo", () => {
  const raw = Buffer.from('{"object":"instagram","entry":[]}');
  const sig = "sha256=" + crypto.createHmac("sha256", "segredo").update(raw).digest("hex");
  assert.equal(assinaturaConfere(raw, sig, "segredo"), true);
  assert.equal(assinaturaConfere(raw, sig, "outro"), false);
  assert.equal(assinaturaConfere(raw, "sha256=zz", "segredo"), false);
  assert.equal(assinaturaConfere(raw, undefined, "segredo"), false);
});

test("Instagram DESLIGADO: o webhook não grava nem responde nada", async () => {
  const chamadas: string[] = [];
  const antes = globalThis.fetch;
  globalThis.fetch = (async (u: string) => {
    chamadas.push(String(u));
    return new Response(JSON.stringify([{ valor: { ligado: false } }]), { status: 200 });
  }) as typeof fetch;
  try {
    const r = await IG.processarWebhookInstagram({ object: "instagram", entry: [{ id: "1784", changes: [{ field: "comments", value: { id: "c1", text: "roteiro", from: { id: "9" } } }] }] });
    assert.equal(r.desligado, true);
    assert.deepEqual(chamadas.map((u) => u.replace(/^.*\/rest\/v1\//, "")), ["mkt_auto_config?select=valor&chave=eq.instagram&limit=1"]);
  } finally { globalThis.fetch = antes; }
});
