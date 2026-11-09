// Instagram no editor de fluxos + links/QR + token + relatório (09/11/2026).
// Regras puras: api/_mktIgRegras.js, api/_mktAutoRegras.js, src/mkt/automacoes/{tipos,modelos,relatorio,qr}.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as IG from "../../api/_mktIgRegras.js";
import * as R from "../../api/_mktAutoRegras.js";
import * as T from "../../src/mkt/automacoes/tipos.ts";
import * as M from "../../src/mkt/automacoes/modelos.ts";
import { montarRelatorio, rotuloConversao, desdeDias } from "../../src/mkt/automacoes/relatorio.ts";
import { matrizQr, caminhoQr } from "../../src/mkt/automacoes/qr.ts";

const D = 86_400_000;
const AGORA = Date.parse("2026-11-09T15:00:00Z");

// ── WhatsApp → Instagram ────────────────────────────────────────────────────

test("texto vira text; corta em 1000 BYTES sem partir emoji", () => {
  assert.deepEqual(IG.corpoParaInstagram({ type: "text", text: { body: "Oi" } }), { mensagens: [{ text: "Oi" }] });
  const longo = "ã".repeat(800); // 1600 bytes
  const r = IG.corpoParaInstagram({ type: "text", text: { body: longo } }) as { mensagens: { text: string }[] };
  assert.ok(Buffer.byteLength(r.mensagens[0].text, "utf8") <= 1000);
  assert.ok(r.mensagens[0].text.endsWith("…"));
  const emoji = IG.cortarBytes("😀".repeat(400), 1000);
  assert.ok(!emoji.includes("�"));
});

test("botões de resposta viram quick_replies (máx 13, título 20) com o id do clique no payload", () => {
  const corpo = {
    type: "interactive",
    interactive: { type: "button", body: { text: "Qual destino?" }, action: { buttons: [
      { type: "reply", reply: { id: "f:x:men_1:b1", title: "Japão" } },
      { type: "reply", reply: { id: "f:x:men_1:b2", title: "Um título bem comprido demais" } },
    ] } },
  };
  const r = IG.corpoParaInstagram(corpo) as { mensagens: Record<string, any>[] };
  assert.equal(r.mensagens[0].text, "Qual destino?");
  assert.equal(r.mensagens[0].quick_replies.length, 2);
  assert.deepEqual(r.mensagens[0].quick_replies[0], { content_type: "text", title: "Japão", payload: "f:x:men_1:b1" });
  assert.ok(r.mensagens[0].quick_replies[1].title.length <= 20);
  const lista = { type: "interactive", interactive: { type: "list", body: { text: "Escolha" }, action: { sections: [{ rows: Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, title: `Item ${i}` })) }] } } };
  assert.equal((IG.corpoParaInstagram(lista) as any).mensagens[0].quick_replies.length, 13);
});

test("link vira button template (web_url); template do WhatsApp é recusado; mídia com legenda = 2 mensagens", () => {
  const cta = { type: "interactive", interactive: { type: "cta_url", body: { text: "Veja" }, action: { name: "cta_url", parameters: { display_text: "Abrir roteiro", url: "https://x.com/r" } } } };
  const r = IG.corpoParaInstagram(cta) as any;
  assert.equal(r.mensagens[0].attachment.payload.template_type, "button");
  assert.deepEqual(r.mensagens[0].attachment.payload.buttons[0], { type: "web_url", url: "https://x.com/r", title: "Abrir roteiro" });
  assert.ok("erro" in IG.corpoParaInstagram({ type: "template", template: { name: "x" } }));
  const img = IG.corpoParaInstagram({ type: "image", image: { link: "https://x.com/a.jpg", caption: "Legenda" } }) as any;
  assert.equal(img.mensagens.length, 2);
  assert.equal(img.mensagens[0].attachment.type, "image");
  assert.equal(img.mensagens[1].text, "Legenda");
  assert.equal((IG.corpoParaInstagram({ type: "document", document: { link: "https://x.com/a.pdf" } }) as any).mensagens[0].attachment.type, "file");
  assert.deepEqual(IG.soTextoIg(r.mensagens[0]), { text: "Veja" });
});

// ── O que a pessoa fez ──────────────────────────────────────────────────────

test("lerEntradaIg: texto, quick reply, postback, resposta e menção no story, referral do ig.me", () => {
  assert.equal(IG.lerEntradaIg({ message: { mid: "m1", text: "japão" } }).tipo, "texto");
  const qr = IG.lerEntradaIg({ message: { mid: "m2", text: "Japão", quick_reply: { payload: "f:x:n:b1" } } });
  assert.equal(qr.tipo, "resposta_botao"); assert.equal(qr.idResposta, "f:x:n:b1");
  const pb = IG.lerEntradaIg({ postback: { mid: "m3", title: "Sim", payload: "p1" } });
  assert.equal(pb.tipo, "postback"); assert.equal(pb.idResposta, "p1");
  const st = IG.lerEntradaIg({ message: { mid: "m4", text: "😍", reply_to: { story: { id: "s1", url: "https://..." } } } });
  assert.equal(st.ehRespostaStory, true);
  const men = IG.lerEntradaIg({ message: { mid: "m5", attachments: [{ type: "story_mention", payload: { url: "https://..." } }] } });
  assert.equal(men.ehMencaoStory, true); assert.equal(men.tipo, "story_mencao");
  const ref = IG.lerEntradaIg({ referral: { ref: "bio", source: "SHORTLINK", type: "OPEN_THREAD" } });
  assert.equal(ref.ref, "bio"); assert.equal(ref.tipo, "referral"); assert.equal(ref.mid, null);
  assert.equal(IG.codigoDoRef("Bio"), "bio");
  assert.equal(IG.codigoDoRef("tem espaço"), null);
});

test("gatilho da DM: link > menção > story > palavra > boas-vindas (só conversa nova)", () => {
  const gs = [
    { id: "ref", tipo: "ig_ref", ativo: true, config: { codigo: "bio" } },
    { id: "men", tipo: "ig_story_mencao", ativo: true, config: {} },
    { id: "sto", tipo: "ig_story_resposta", ativo: true, config: { palavras: [] } },
    { id: "pal", tipo: "ig_dm_palavra", ativo: true, config: { palavras: ["japão"] } },
    { id: "bv", tipo: "ig_boas_vindas", ativo: true, config: {} },
    { id: "off", tipo: "ig_dm_palavra", ativo: false, config: { palavras: ["peru"] } },
  ];
  const e = (x: Record<string, unknown>) => ({ texto: "", ref: null, ehMencaoStory: false, ehRespostaStory: false, ...x });
  assert.equal(IG.escolherGatilhoIgDm(gs, e({ ref: "bio", texto: "japao" }))?.id, "ref");
  assert.equal(IG.escolherGatilhoIgDm(gs, e({ ehMencaoStory: true }))?.id, "men");
  assert.equal(IG.escolherGatilhoIgDm(gs, e({ ehRespostaStory: true, texto: "lindo" }))?.id, "sto");
  assert.equal(IG.escolherGatilhoIgDm(gs, e({ texto: "Quero o JAPAO!" }))?.id, "pal");
  assert.equal(IG.escolherGatilhoIgDm(gs, e({ texto: "peru" })), null);
  assert.equal(IG.escolherGatilhoIgDm(gs, e({ texto: "oi" }), { nova: true })?.id, "bv");
  assert.equal(IG.escolherGatilhoIgDm(gs, e({ texto: "oi" }), { nova: false }), null);
});

test("gatilho do comentário: post escolhido > palavra > qualquer; post errado não casa", () => {
  const gs = [
    { id: "qualquer", tipo: "ig_comentario", ativo: true, config: { qualquer_palavra: true }, prioridade: 0, criado_em: "2026-01-01" },
    { id: "palavra", tipo: "ig_comentario", ativo: true, config: { palavras: ["roteiro"] }, prioridade: 0, criado_em: "2026-01-02" },
    { id: "post", tipo: "ig_comentario", ativo: true, config: { palavras: ["roteiro"], posts: ["123"] }, prioridade: 0, criado_em: "2026-01-03" },
  ];
  assert.equal(IG.escolherGatilhoIgComentario(gs, "quero o roteiro", "123")?.id, "post");
  assert.equal(IG.escolherGatilhoIgComentario(gs, "quero o roteiro", "999")?.id, "palavra");
  assert.equal(IG.escolherGatilhoIgComentario(gs, "lindo!", "999")?.id, "qualquer");
  assert.equal(IG.escolherGatilhoIgComentario([gs[2]], "quero o roteiro", "999"), null);
  // sem palavras = qualquer comentário
  assert.equal(IG.escolherGatilhoIgComentario([{ id: "v", tipo: "ig_comentario", ativo: true, config: { palavras: [] } }], "x", "1")?.id, "v");
});

test("limparConfigGatilhoIg: exige palavra (ou qualquer), posts só números, código do link", () => {
  assert.ok("erro" in IG.limparConfigGatilhoIg("ig_comentario", { palavras: [] }));
  const ok = IG.limparConfigGatilhoIg("ig_comentario", { palavras: "roteiro, link", posts: "123, abc", respostas_publicas: "Te mandei!\nOlha a DM" }) as any;
  assert.deepEqual(ok.config.palavras, ["roteiro", "link"]);
  assert.deepEqual(ok.config.posts, ["123"]);
  assert.equal(ok.config.respostas_publicas.length, 2);
  assert.equal((IG.limparConfigGatilhoIg("ig_ref", { codigo: "Bio Insta" }) as any).config.codigo, "bio-insta");
  assert.ok("erro" in IG.limparConfigGatilhoIg("ig_ref", { codigo: "!" }));
});

// ── Resposta privada: 1 mensagem, até 7 dias ────────────────────────────────

test("resposta privada: só uma, até 7 dias (margem 10 min); depois só com conversa aberta", () => {
  const privada = { comment_id: "c1", em: new Date(AGORA - 2 * D).toISOString(), usada: false };
  assert.equal(IG.privadaDisponivel(privada, AGORA), true);
  assert.equal(IG.privadaDisponivel({ ...privada, usada: true }, AGORA), false);
  assert.equal(IG.privadaDisponivel({ ...privada, em: new Date(AGORA - 7 * D + 5 * 60_000).toISOString() }, AGORA), false);
  assert.deepEqual(IG.destinoDaDm({ igsid: "u1", janela: true, privada }, AGORA), { id: "u1" });
  assert.deepEqual(IG.destinoDaDm({ igsid: "u1", janela: false, privada }, AGORA), { comment_id: "c1" });
  assert.equal(IG.destinoDaDm({ igsid: "u1", janela: false, privada: { ...privada, usada: true } }, AGORA), null);
});

// ── Token ───────────────────────────────────────────────────────────────────

test("renovar token: só com 24 h+ de vida, sem tentativa em 12 h, vencendo em < 15 dias; vencido não renova", () => {
  const base = { status: "conectada", token_renovado_em: new Date(AGORA - 50 * D).toISOString(), token_expira_em: new Date(AGORA + 10 * D).toISOString(), token_tentativa_em: null };
  assert.equal(IG.precisaRenovarToken(base, AGORA), true);
  assert.equal(IG.precisaRenovarToken({ ...base, token_expira_em: new Date(AGORA + 40 * D).toISOString() }, AGORA), false);
  assert.equal(IG.precisaRenovarToken({ ...base, token_renovado_em: new Date(AGORA - 3_600_000).toISOString() }, AGORA), false);
  assert.equal(IG.precisaRenovarToken({ ...base, token_tentativa_em: new Date(AGORA - 3_600_000).toISOString() }, AGORA), false);
  assert.equal(IG.precisaRenovarToken({ ...base, token_expira_em: new Date(AGORA - D).toISOString() }, AGORA), false);
  assert.equal(IG.precisaRenovarToken({ ...base, token_expira_em: null }, AGORA), true);
  assert.equal(IG.precisaRenovarToken({ ...base, status: "desconectada" }, AGORA), false);
});

test("situação do token: servidor e tela dão a mesma resposta", () => {
  const casos = [
    { status: "conectada", token_expira_em: new Date(AGORA + 30 * D).toISOString() },
    { status: "conectada", token_expira_em: new Date(AGORA + 3 * D).toISOString() },
    { status: "conectada", token_expira_em: new Date(AGORA - D).toISOString() },
    { status: "erro", token_expira_em: new Date(AGORA + 30 * D).toISOString() },
    { status: "conectada", token_expira_em: null },
  ];
  assert.deepEqual(casos.map((c) => IG.situacaoToken(c, AGORA)), ["ok", "vence_logo", "vencido", "erro", "desconhecido"]);
  assert.deepEqual(casos.map((c) => T.situacaoToken(c, AGORA)), casos.map((c) => IG.situacaoToken(c, AGORA)));
});

// ── Links de entrada ────────────────────────────────────────────────────────

test("links: ig.me com ref, wa.me com [ref:], link curto com ?q=1 no QR; robô não conta", () => {
  assert.equal(IG.linkIgMe("@setuforeuvou", "bio"), "https://ig.me/m/setuforeuvou?ref=bio");
  assert.equal(T.linkIgMe("@setuforeuvou", "bio"), IG.linkIgMe("@setuforeuvou", "bio"));
  assert.equal(IG.destinoDaEntrada({ tipo: "ig_ref", codigo: "bio" }, { usuarioIg: "setuforeuvou" }), "https://ig.me/m/setuforeuvou?ref=bio");
  assert.equal(IG.destinoDaEntrada({ tipo: "ig_ref", codigo: "bio" }, {}), null);
  const wa = IG.destinoDaEntrada({ tipo: "link_ref", codigo: "live", texto: "Quero!" }, { numero: "+55 11 99999-0000" }) as string;
  assert.equal(wa, T.linkDeReferencia("5511999990000", "live", "Quero!"));
  assert.ok(decodeURIComponent(wa).includes("[ref:live]"));
  assert.equal(T.linkCurto("https://qs.com.br/", "bio"), "https://qs.com.br/e/bio");
  assert.equal(T.linkCurto("https://qs.com.br", "bio", true), "https://qs.com.br/e/bio?q=1");
  assert.equal(IG.ehRobo("WhatsApp/2.23.20"), true);
  assert.equal(IG.ehRobo("facebookexternalhit/1.1"), true);
  assert.equal(IG.ehRobo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0"), false);
});

test("vercel.json manda /e/<código> para o redirecionador", () => {
  const v = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  const r = (v.rewrites ?? []).find((x: { source: string }) => x.source === "/e/:codigo");
  assert.ok(r, "falta o rewrite /e/:codigo");
  assert.equal(r.destination, "/api/mkt-automacoes?e=:codigo");
  assert.equal(v.rewrites.indexOf(r), 0, "precisa vir antes do rewrite do SPA");
});

test("QR: matriz quadrada, com os 3 olhos, e caminho SVG com margem", () => {
  const m = matrizQr("https://qs.com.br/e/bio?q=1");
  assert.ok(m.length >= 21 && m.every((l) => l.length === m.length));
  // canto superior esquerdo do "olho": 7 escuros na 1ª linha
  assert.deepEqual(m[0].slice(0, 7), Array(7).fill(true));
  assert.deepEqual(m[0].slice(-7), Array(7).fill(true));
  const { d, lado } = caminhoQr(m);
  assert.equal(lado, m.length + 8);
  assert.ok(d.startsWith("M4 4h1v1h-1z"));
});

// ── Regra simples → fluxo ───────────────────────────────────────────────────

test("regra simples vira fluxo válido no Instagram; servidor e tela convertem igual", () => {
  const regra = {
    nome: "Reels: ROTEIRO", gatilho: "comentario" as const,
    config: { palavras: ["roteiro"], respostas_publicas: ["Te mandei!"], dm_texto: "Oi {{nome}}!", dm_botoes: [{ titulo: "Ver roteiro", url: "https://a.com" }, { titulo: "PDF", url: "https://b.com" }], tags: ["quer-roteiro"] },
  };
  const js = IG.fluxoDaRegraIg(regra) as any;
  const ts = M.fluxoDaRegraIg(regra);
  assert.deepEqual(ts, js);
  assert.equal(ts.gatilho.tipo, "ig_comentario");
  assert.deepEqual(ts.gatilho.config.respostas_publicas, ["Te mandei!"]);
  const men = ts.grafo.nos.find((n) => n.tipo === "mensagem")!;
  assert.equal(men.tipo === "mensagem" && men.dados.interacao.tipo, "link");
  assert.ok(men.tipo === "mensagem" && men.dados.blocos[0].tipo === "texto" && men.dados.blocos[0].texto.includes("PDF: https://b.com"));
  assert.ok(ts.grafo.nos.some((n) => n.tipo === "acao"));
  assert.deepEqual(T.validarGrafo(ts.grafo, "instagram").filter((p) => p.grave), []);
  for (const g of ["dm_palavra", "story_resposta", "story_mencao", "boas_vindas"] as const) {
    const r = { nome: "x", gatilho: g, config: { dm_texto: "Oi", palavras: ["a"] } };
    assert.deepEqual(M.fluxoDaRegraIg(r), IG.fluxoDaRegraIg(r));
    assert.equal(M.fluxoDaRegraIg(r).gatilho.tipo, `ig_${g}`);
  }
});

test("validarGrafo no Instagram: template e texto > 1000 bytes são graves; no WhatsApp não", () => {
  const g = M.grafoDeRespostaSimples({ texto: "ã".repeat(600), link: null });
  assert.ok(T.validarGrafo(g, "instagram").some((p) => p.grave && /1.000/.test(p.mensagem)));
  assert.ok(!T.validarGrafo(g, "whatsapp").some((p) => p.grave));
  const comTemplate = T.grafoInicial();
  comTemplate.nos.push(T.noPadrao("template", 600, 100));
  assert.ok(T.validarGrafo(comTemplate, "instagram").some((p) => p.grave && /Template/.test(p.mensagem)));
  assert.equal(T.canalDo({ canal: "instagram" }), "instagram");
  assert.equal(T.canalDo({}), "whatsapp");
  assert.equal(T.canalDo(null), "whatsapp");
});

// ── Motor: digitar o título do botão + {{usuario}} ──────────────────────────

test("digitar o título do botão conta como clique (resposta privada sem quick replies)", () => {
  const no = { id: "m", tipo: "mensagem", dados: { blocos: [{ tipo: "texto", texto: "?" }], interacao: { tipo: "botoes", botoes: [{ id: "b1", titulo: "Japão" }, { id: "b2", titulo: "Peru" }] } } };
  assert.equal(R.saidaPorTexto(no, "japao"), "b1");
  assert.equal(R.saidaPorTexto(no, " PERU "), "b2");
  assert.equal(R.saidaPorTexto(no, "quero o japão"), null);
  assert.equal(R.saidaPorTexto({ id: "p", tipo: "pergunta", dados: {} }, "x"), null);
  assert.equal(R.personalizar("Oi {{usuario}}", { usuario: "ana.viaja" }), "Oi @ana.viaja");
  assert.equal(R.personalizar("Oi {{usuario}}", {}), "Oi ");
});

// ── Relatório ───────────────────────────────────────────────────────────────

test("relatório: passos na ordem do fluxo, cliques por botão, onde param, conversões", () => {
  const grafo = {
    nos: [
      { id: "ini", tipo: "inicio", x: 0, y: 0, dados: {} },
      { id: "m1", tipo: "mensagem", x: 0, y: 0, dados: { blocos: [{ tipo: "texto", texto: "Qual destino?" }], interacao: { tipo: "botoes", botoes: [{ id: "b1", titulo: "Japão" }, { id: "b2", titulo: "Peru" }] } } },
      { id: "a1", tipo: "acao", x: 0, y: 0, dados: { acoes: [{ tipo: "adicionar_tag", tag: "quer-japao" }] } },
    ],
    ligacoes: [{ id: "l1", de: "ini", saida: "proximo", para: "m1" }, { id: "l2", de: "m1", saida: "b1", para: "a1" }],
  } as T.Grafo;
  const r = montarRelatorio({
    iniciados: 10, concluidos: 4, andamento: 5, cancelados: 1, erros: 0,
    blocos: [
      { no_id: "m1", tipo: "entrou", saida: "", total: 10 }, { no_id: "m1", tipo: "saida", saida: "b1", total: 4 }, { no_id: "m1", tipo: "saida", saida: "b2", total: 1 },
      { no_id: "a1", tipo: "entrou", saida: "", total: 4 },
    ],
    parados: [{ no_id: "m1", estado: "aguardando_resposta", total: 5 }],
    conversoes: [{ detalhe: "tag:quer-japao", pessoas: 4 }],
  }, grafo);
  assert.equal(r.resumo.taxaConclusao, 40);
  assert.deepEqual(r.passos.map((p) => p.noId), ["m1", "a1"]);
  assert.equal(r.passos[1].pct, 40);
  const b1 = r.botoes.find((b) => b.saida === "b1")!;
  assert.equal(b1.cliques, 4); assert.equal(b1.pct, 40); assert.equal(b1.rotulo, "Japão");
  assert.equal(r.parados[0].estado, "esperando a resposta/clique");
  assert.equal(r.conversoes[0].rotulo, "Tag “quer-japao”");
  assert.equal(r.conversoes[0].pct, 40);
  assert.equal(rotuloConversao("campo:destino"), "Campo “destino” preenchido");
  assert.equal(desdeDias(null), null);
  assert.equal(desdeDias(7, AGORA), new Date(AGORA - 7 * D).toISOString());
  // sem dados não quebra
  assert.equal(montarRelatorio({}, grafo).resumo.iniciados, 0);
});

// ── Migration 0343 ──────────────────────────────────────────────────────────

test("migration 0343: idempotente, nada pra anon, funções de servidor só no service_role", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/0343_mkt_automacoes_ig_fluxos.sql", import.meta.url), "utf8");
  const ativo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/grant[^;]*\bto\s+[^;]*\banon\b/i.test(ativo), "não pode ter grant pra anon");
  assert.ok(!/create table (?!if not exists)/i.test(ativo), "create table sem if not exists");
  assert.ok(!/add column (?!if not exists)/i.test(ativo), "add column sem if not exists");
  // as 4 funções do servidor passam pelo laço: revoke (public, anon, authenticated) + grant service_role
  assert.match(ativo, /revoke all on function %s from public, anon, authenticated/);
  assert.match(ativo, /grant execute on function %s to service_role/);
  for (const f of ["mkt_ig_tomar_conversa(uuid, int)", "mkt_ig_soltar_conversa(uuid)", "mkt_ig_registrar_entrada(uuid, timestamptz, text)", "mkt_entrada_clique(text, text)"]) {
    assert.ok(ativo.includes(`'public.${f}'`), `${f} fora do laço de revoke`);
  }
  assert.ok(ativo.includes("revoke all on function public.mkt_auto_relatorio(uuid, timestamptz) from public, anon;"));
  assert.match(ativo, /mkt_auto_relatorio/);
  assert.match(ativo, /enable row level security/i);
});
