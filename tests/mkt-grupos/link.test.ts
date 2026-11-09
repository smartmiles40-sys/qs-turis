// Link inteligente de grupo (0342): regras puras — escolha do grupo, lotação,
// criação do próximo, números, robôs, contagem e a página pública.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import * as R from "../../api/_mktGruposLinkRegras.js";
import { situacaoDosGrupos as situacaoTela } from "../../src/mkt/grupos/linkRegras.ts";

const conv = (c: string) => `https://chat.whatsapp.com/${c}`;
const grupo = (jid: string, o: Record<string, unknown> = {}) => ({
  grupo_jid: jid, ordem: 0, capacidade: null, membros: 0, pendentes: 0, link_convite: conv("ABCDEFGHIJ" + jid.replace(/\D/g, "")), ativo: true, saiu_em: null, ...o,
});
const link = { ativo: true, capacidade: 100, ao_lotar: "pagina" };

test("slug: nome vira endereço limpo; validação", () => {
  assert.equal(R.slugDe("Japão 2027 — Live!"), "japao-2027-live");
  assert.equal(R.slugDe("  --Ação  de   Natal-- "), "acao-de-natal");
  assert.equal(R.slugValido("japao-2027"), true);
  assert.equal(R.slugValido("ja"), false);
  assert.equal(R.slugValido("Japao"), false);
  assert.equal(R.slugValido("japao--2027"), false);
  assert.equal(R.slugValido("../admin"), false);
});

test("convite: só chat.whatsapp.com (nada de redirecionar pra outro site)", () => {
  assert.equal(R.conviteValido("https://chat.whatsapp.com/AbCdEfGhIj12"), true);
  assert.equal(R.conviteValido("http://chat.whatsapp.com/AbCdEfGhIj12"), false);
  assert.equal(R.conviteValido("https://chat.whatsapp.com.evil.com/AbCdEfGhIj12"), false);
  assert.equal(R.conviteValido("https://evil.com/?x=https://chat.whatsapp.com/AbCdEfGhIj12"), false);
  assert.equal(R.conviteDaResposta({ inviteCode: "AbCdEfGhIj12" }), "https://chat.whatsapp.com/AbCdEfGhIj12");
  assert.equal(R.conviteDaResposta({ inviteUrl: "https://chat.whatsapp.com/AbCdEfGhIj12", inviteCode: "x" }), "https://chat.whatsapp.com/AbCdEfGhIj12");
  assert.equal(R.conviteDaResposta({}), null);
});

test("escolha: o primeiro da ordem que cabe mais um", () => {
  const gs = [grupo("2@g.us", { ordem: 2 }), grupo("1@g.us", { ordem: 1, membros: 99 }), grupo("3@g.us", { ordem: 3 })];
  const r = R.escolherGrupo(link, gs);
  assert.equal(r.status, "ok");
  assert.equal(r.grupo.grupo_jid, "1@g.us");   // 99 + 1 = 100 cabe
  gs[1].pendentes = 1;                         // 99 + 1 pendente = 100: lotado
  assert.equal(R.escolherGrupo(link, gs).grupo.grupo_jid, "2@g.us");
});

test("escolha: capacidade do grupo vence a do link; pendentes contam", () => {
  const gs = [grupo("1@g.us", { ordem: 1, capacidade: 10, membros: 5, pendentes: 5 }), grupo("2@g.us", { ordem: 2 })];
  assert.equal(R.escolherGrupo(link, gs).grupo.grupo_jid, "2@g.us");
});

test("escolha: pula grupo desligado, de onde o chip saiu ou sem convite", () => {
  const gs = [
    grupo("1@g.us", { ordem: 1, ativo: false }),
    grupo("2@g.us", { ordem: 2, saiu_em: "2026-11-01T00:00:00Z" }),
    grupo("3@g.us", { ordem: 3, link_convite: null }),
    grupo("4@g.us", { ordem: 4, link_convite: "https://evil.com/x" }),
    grupo("5@g.us", { ordem: 5 }),
  ];
  assert.equal(R.escolherGrupo(link, gs).grupo.grupo_jid, "5@g.us");
});

test("escolha: todos lotados → lotado; link pausado → pausado", () => {
  const gs = [grupo("1@g.us", { membros: 100 }), grupo("2@g.us", { membros: 80, pendentes: 20 })];
  assert.equal(R.escolherGrupo(link, gs).status, "lotado");
  assert.equal(R.escolherGrupo({ ...link, ativo: false }, gs).status, "pausado");
  assert.equal(R.escolherGrupo(link, []).status, "lotado");
});

test("escolha: quem volta (cookie) cai no mesmo grupo e não conta de novo", () => {
  const gs = [grupo("1@g.us", { ordem: 1 }), grupo("2@g.us", { ordem: 2, membros: 100, ref: "aaaaaaaaaaaa" })];
  // grupo 2 está em 100/100: quem já está nele volta sem ocupar vaga nova
  const r = R.escolherGrupo(link, gs, "aaaaaaaaaaaa");
  assert.equal(r.grupo.grupo_jid, "2@g.us");
  assert.equal(r.unico, false);
  // grupo 2 passou do limite (101): volta pro primeiro que cabe, contando como novo
  gs[1].membros = 101;
  const r2 = R.escolherGrupo(link, gs, "aaaaaaaaaaaa");
  assert.equal(r2.grupo.grupo_jid, "1@g.us");
  assert.equal(r2.unico, true);
});

test("situação pra tela: recebendo, fila, lotado, sem convite — e a tela calcula igual ao servidor", () => {
  const gs = [
    grupo("1@g.us", { ordem: 1, membros: 100 }),
    grupo("2@g.us", { ordem: 2, membros: 40 }),
    grupo("3@g.us", { ordem: 3 }),
    grupo("4@g.us", { ordem: 4, link_convite: null }),
    grupo("5@g.us", { ordem: 5, ativo: false }),
  ];
  const s = R.situacaoDosGrupos(link, gs).map((g: { situacao: string }) => g.situacao);
  assert.deepEqual(s, ["lotado", "recebendo", "fila", "sem_convite", "desligado"]);
  assert.deepEqual(situacaoTela(link, gs).map((g) => g.situacao), s);
});

test("criar o próximo: só com 'criar_grupo', modelo completo, abaixo do teto e todos acima do gatilho", () => {
  const l = { ativo: true, capacidade: 100, ao_lotar: "criar_grupo", criar_ao_pct: 90, limite_auto: 3, criados_auto: 0, modelo_nome: "Japão #{n}", modelo_admins: ["5511999998888"] };
  const gs = [grupo("1@g.us", { membros: 100 }), grupo("2@g.us", { membros: 89 })];
  assert.equal(R.precisaCriarProximo(l, gs), false);       // 89 < 90
  gs[1].pendentes = 1;
  assert.equal(R.precisaCriarProximo(l, gs), true);        // 90 ≥ 90
  assert.equal(R.precisaCriarProximo({ ...l, ao_lotar: "pagina" }, gs), false);
  assert.equal(R.precisaCriarProximo({ ...l, criados_auto: 3 }, gs), false);
  assert.equal(R.precisaCriarProximo({ ...l, modelo_admins: [] }, gs), false);
  assert.equal(R.precisaCriarProximo({ ...l, ativo: false }, gs), false);
  assert.equal(R.precisaCriarProximo(l, []), true);        // sem nenhum grupo útil: cria o primeiro
});

test("trava da criação: livre sem marca ou depois de 5 min", () => {
  const agora = new Date("2026-11-09T12:00:00Z");
  assert.equal(R.criacaoLivre(null, agora), true);
  assert.equal(R.criacaoLivre("2026-11-09T11:58:00Z", agora), false);
  assert.equal(R.criacaoLivre("2026-11-09T11:54:00Z", agora), true);
});

test("nome numerado", () => {
  assert.equal(R.nomeNumerado("Japão 2027 #{n}", 3), "Japão 2027 #3");
  assert.equal(R.nomeNumerado("Japão 2027", 4), "Japão 2027 4");
  assert.equal(R.nomeNumerado("x".repeat(120) + "{n}", 1).length, 100);
});

test("números: limpa, põe o 55 em DDD+número, recusa lixo e repetido", () => {
  const r = R.limparNumeros("(11) 99999-8888, +55 11 98888-7777 ; 5511999998888 abc 123");
  assert.deepEqual(r.numeros, ["5511999998888", "5511988887777"]);
  assert.deepEqual(r.invalidos, ["abc", "123"]);
  assert.deepEqual(R.limparNumeros(["351912345678"]).numeros, ["351912345678"]);
});

test("robôs de prévia não contam clique; navegador conta", () => {
  assert.equal(R.ehRobo("WhatsApp/2.23.20.0 A"), true);
  assert.equal(R.ehRobo("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"), true);
  assert.equal(R.ehRobo("TelegramBot (like TwitterBot)"), true);
  assert.equal(R.ehRobo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), false);
  assert.equal(R.ehRobo("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Instagram 300.0"), false);
});

test("contagem: intervalo próprio por grupo, quente conta antes, limite por rodada", () => {
  const agora = new Date("2026-11-09T12:00:00Z");
  const itens = [
    { grupo_jid: "1@g.us", contado_em: "2026-11-09T11:58:30Z" },               // 1,5 min: ainda não
    { grupo_jid: "2@g.us", contado_em: "2026-11-09T11:57:30Z", quente: true }, // 2,5 min e quente: conta
    { grupo_jid: "3@g.us", contado_em: "2026-11-09T11:57:30Z" },               // 2,5 min, frio: não
    { grupo_jid: "4@g.us", contado_em: null },                                  // nunca: conta primeiro
    { grupo_jid: "4@g.us", contado_em: null },                                  // repetido (2 links): uma vez só
    { grupo_jid: "5@g.us", contado_em: "2026-11-09T11:50:00Z" },               // 10 min: conta
    { grupo_jid: "6@g.us", contado_em: null, saiu_em: "2026-11-01T00:00:00Z" }, // chip saiu: não
  ];
  const r = R.gruposParaContar(itens, { agora, minutos: 5, minutosQuente: 2, limite: 8 }).map((g: { grupo_jid: string }) => g.grupo_jid);
  assert.deepEqual(r, ["4@g.us", "5@g.us", "2@g.us"]);
  assert.equal(R.gruposParaContar(itens, { agora, limite: 1 }).length, 1);
});

test("webhook de participantes: entrou/saiu; promover não muda contagem", () => {
  assert.deepEqual(R.lerMovimento({ id: "120363@g.us", action: "add", participants: ["a", "b"] }), { grupo: "120363@g.us", entradas: 2, saidas: 0 });
  assert.deepEqual(R.lerMovimento({ id: "120363@g.us", action: "remove", participants: [{ id: "a" }] }), { grupo: "120363@g.us", entradas: 0, saidas: 1 });
  assert.equal(R.lerMovimento({ id: "120363@g.us", action: "promote", participants: ["a"] }), null);
  assert.equal(R.lerMovimento({ id: "5511@s.whatsapp.net", action: "add", participants: ["a"] }), null);
});

test("página pública: escapa o texto (nada de HTML injetado) e não mostra dado nenhum", () => {
  const h = R.paginaHtml({ titulo: "<script>alert(1)</script>", texto: "\"oi\" & tchau", recarregarEm: 30 });
  assert.ok(!h.includes("<script>alert"));
  assert.ok(h.includes("&lt;script&gt;"));
  assert.ok(h.includes("&quot;oi&quot; &amp; tchau"));
  assert.ok(h.includes('http-equiv="refresh" content="30"'));
  assert.ok(h.includes('name="robots" content="noindex"'));
});
