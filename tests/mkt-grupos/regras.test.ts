// Grupos do WhatsApp do Marketing (api/_mktGruposRegras.js, 0243, 30/10/2026).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/mkt-grupos/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  motivoBloqueioInstancia, caminhoDaInstancia, destinoDaCaixaPermitido, validarCampanha,
  resolverGrupos, montarFila, resumirFila, campanhaTerminou, linhaPresa, sortearIntervaloMs,
  liberadaEm, dentroDaJanela, isoDeSP, ocorrencias, campanhaDaOcorrencia, montarEnvio, envioDaFila,
  erroPermanente, lerGrupo, lerConversas, semNono, intervalo,
  // @ts-expect-error — módulo JS das funções da Vercel, sem tipos
} from "../../api/_mktGruposRegras.js";

const G1 = "120363000000000001@g.us";
const G2 = "120363000000000002@g.us";
const G3 = "120363000000000003@g.us";

// ── TRAVA DE INSTÂNCIA ──────────────────────────────────────────────────────
test("trava: a instância do Relacionamento NUNCA passa (nem com maiúscula/espaço)", () => {
  assert.ok(motivoBloqueioInstancia("relacionamento-grupos-4183", null));
  assert.ok(motivoBloqueioInstancia("  Relacionamento-Grupos-4183 ", null));
  // mesmo que alguém "maquie" com mkt no nome
  assert.ok(motivoBloqueioInstancia("mkt-relacionamento", null));
  assert.ok(motivoBloqueioInstancia("marketing-rel", null));
  assert.ok(motivoBloqueioInstancia("rel_mkt", null));
});

test("trava: nome de outro setor ou sem marketing/mkt é recusado", () => {
  for (const n of ["comercial-mkt", "closers-marketing", "sdr-marketing", "financeiro-mkt", "operacional-mkt", "Comercial - Closers (1935)", "qualquer-uma", ""]) {
    assert.ok(motivoBloqueioInstancia(n, null), n);
  }
});

test("trava: o chip do Marketing de hoje passa", () => {
  assert.equal(motivoBloqueioInstancia("numero-para-o-marketing--edmg0", "551153066577"), null);
  assert.equal(motivoBloqueioInstancia("Marketing (consolidado)", "5511951757602"), null);
  assert.equal(motivoBloqueioInstancia("mkt-relampago", null), null); // "rel" só como palavra inteira
});

test("trava: lista vinda do ambiente/banco (env do Rel, SDRs) e número do Rel", () => {
  const listas = { proibidas: ["marketing-do-sdr-joao"], numerosProibidos: ["5511999990000"] };
  assert.ok(motivoBloqueioInstancia("Marketing-do-SDR-Joao", null, listas));
  assert.ok(motivoBloqueioInstancia("marketing-x", "5511980124183"));         // número do Rel
  assert.ok(motivoBloqueioInstancia("marketing-x", "+55 (11) 8012-4183"));    // sem o 9
  assert.ok(motivoBloqueioInstancia("marketing-x", "5511999990000", listas));
  assert.equal(motivoBloqueioInstancia("marketing-x", "5511911112222", listas), null);
});

test("trava: MKT_GRUPOS_INSTANCIA fixada só aceita ela", () => {
  assert.ok(motivoBloqueioInstancia("marketing-b", null, { fixada: "marketing-a" }));
  assert.equal(motivoBloqueioInstancia("MARKETING-A", null, { fixada: "marketing-a" }), null);
});

test("semNono tira o 9 só de celular BR", () => {
  assert.equal(semNono("5511980124183"), "551180124183");
  assert.equal(semNono("551180124183"), "551180124183");
  assert.equal(semNono("14155550100"), "14155550100");
});

test("caminho da Evolution precisa terminar na instância do Marketing", () => {
  assert.equal(caminhoDaInstancia("/message/sendText/marketing-a", "marketing-a"), true);
  assert.equal(caminhoDaInstancia("/group/findGroupInfos/marketing-a?groupJid=1@g.us", "marketing-a"), true);
  assert.equal(caminhoDaInstancia("/message/sendText/relacionamento-grupos-4183", "marketing-a"), false);
  assert.equal(caminhoDaInstancia("/instance/fetchInstances", "marketing-a"), false);
  assert.equal(caminhoDaInstancia("/message/sendText/../x/marketing-a", "marketing-a"), false);
  assert.equal(caminhoDaInstancia("/message/sendText/marketing-a", ""), false);
});

test("caixa: só grupo — pessoa nunca, nem com a chave antiga ligada", () => {
  assert.equal(destinoDaCaixaPermitido(G1), null);
  assert.ok(destinoDaCaixaPermitido("5511999990000@s.whatsapp.net"));
  process.env.MKT_GRUPOS_PRIVADO = "1";
  assert.ok(destinoDaCaixaPermitido("5511999990000@s.whatsapp.net"));
  delete process.env.MKT_GRUPOS_PRIVADO;
  assert.ok(destinoDaCaixaPermitido("status@broadcast"));
});

test("caixa: conversas particulares do chip não saem do servidor", () => {
  const brutas = [
    { remoteJid: G1, name: "Japão 2027 #1", updatedAt: "2026-11-09T10:00:00Z" },
    { remoteJid: "5511999990000@s.whatsapp.net", pushName: "Lead curioso", updatedAt: "2026-11-09T11:00:00Z" },
    { remoteJid: "status@broadcast" },
  ];
  const lista = lerConversas(brutas);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].jid, G1);
  assert.ok(lista.every((c: { grupo: boolean }) => c.grupo));
});

// ── CAMPANHA E FILA ─────────────────────────────────────────────────────────
const agora = new Date("2026-11-03T12:00:00Z");
const base = { nome: "Live Japão", tipo: "texto", texto: "Hoje 19h!", tag_ids: ["t1"], grupo_jids: [], enviar_em: "2026-11-03T22:00:00Z" };

test("campanha válida passa; destino vazio NÃO vira 'todos'", () => {
  assert.deepEqual(validarCampanha(base, { agora }), []);
  assert.ok(validarCampanha({ ...base, tag_ids: [] }, { agora }).some((e: string) => /Destino vazio/.test(e)));
});

test("campanha: pessoa no destino, enquete, mídia, data passada e intervalo", () => {
  assert.ok(validarCampanha({ ...base, grupo_jids: ["5511999990000@s.whatsapp.net"] }, { agora }).length);
  assert.ok(validarCampanha({ ...base, tipo: "enquete", enquete_opcoes: ["Sim"] }, { agora }).length);
  assert.deepEqual(validarCampanha({ ...base, tipo: "enquete", enquete_opcoes: ["Sim", "Não"] }, { agora }), []);
  assert.ok(validarCampanha({ ...base, tipo: "enquete", enquete_opcoes: ["Sim", "sim"] }, { agora }).length);
  assert.ok(validarCampanha({ ...base, tipo: "imagem", midia_url: "http://x/a.jpg" }, { agora }).length);
  assert.deepEqual(validarCampanha({ ...base, tipo: "imagem", texto: "", midia_url: "https://x/a.jpg" }, { agora }), []);
  assert.ok(validarCampanha({ ...base, enviar_em: "2026-11-03T10:00:00Z" }, { agora }).length);
  assert.ok(validarCampanha({ ...base, intervalo_min_seg: 2 }, { agora }).length);
  assert.ok(validarCampanha({ ...base, intervalo_min_seg: 30, intervalo_max_seg: 10 }, { agora }).length);
});

test("resolverGrupos: une tags + escolhidos, sem repetir, sem grupo de onde o número saiu", () => {
  const grupos = [
    { jid: G1, nome: "B grupo" }, { jid: G2, nome: "A grupo" },
    { jid: G3, nome: "Saí", saiu_em: "2026-10-01T00:00:00Z" },
  ];
  const links = [{ tag_id: "t1", grupo_jid: G1 }, { tag_id: "t1", grupo_jid: G3 }, { tag_id: "t2", grupo_jid: G2 }];
  const r = resolverGrupos({ tagIds: ["t1"], grupoJids: [G1, G2, "5511@s.whatsapp.net"], grupos, links });
  assert.deepEqual(r.grupos.map((g: { jid: string }) => g.jid), [G2, G1]); // ordem por nome
  assert.equal(r.avisos.length, 1);
});

test("resolverGrupos: só admins mandam e o número não é admin → fora, com aviso", () => {
  const r = resolverGrupos({ tagIds: [], grupoJids: [G1], grupos: [{ jid: G1, nome: "x", so_admins_enviam: true, eu_admin: false }], links: [] });
  assert.equal(r.grupos.length, 0);
  assert.equal(r.avisos.length, 1);
});

test("fila: uma linha por grupo, só grupo, sem duplicar", () => {
  const f = montarFila("c1", [{ jid: G1, nome: "a" }, { jid: G1, nome: "a" }, { jid: "x@s.whatsapp.net" }, { jid: G2 }]);
  assert.equal(f.length, 2);
  assert.ok(f.every((l: { status: string; campanha_id: string }) => l.status === "pendente" && l.campanha_id === "c1"));
});

test("resumo da fila e fim da campanha", () => {
  const r = resumirFila([{ status: "enviado" }, { status: "chegou" }, { status: "falha" }, { status: "pendente" }]);
  assert.deepEqual([r.total, r.chegaram, r.falhas, r.pendentes], [4, 2, 1, 1]);
  assert.equal(campanhaTerminou(r), false);
  assert.equal(campanhaTerminou(resumirFila([{ status: "chegou" }, { status: "cancelado" }])), true);
  assert.equal(campanhaTerminou(resumirFila([])), false);
});

test("linha presa em 'enviando' > 5 min (não reenvia sozinho)", () => {
  assert.equal(linhaPresa({ status: "enviando", reivindicado_em: "2026-11-03T11:50:00Z" }, agora), true);
  assert.equal(linhaPresa({ status: "enviando", reivindicado_em: "2026-11-03T11:58:00Z" }, agora), false);
  assert.equal(linhaPresa({ status: "pendente", reivindicado_em: "2026-11-03T11:00:00Z" }, agora), false);
});

// ── RITMO ───────────────────────────────────────────────────────────────────
test("intervalo sorteado entre grupos fica na faixa", () => {
  assert.equal(sortearIntervaloMs(20, 45, 0), 20_000);
  assert.equal(sortearIntervaloMs(20, 45, 1), 45_000);
  assert.equal(sortearIntervaloMs(30, 10, 0.5), 30_000);
  assert.deepEqual(intervalo({}, { min: 20, max: 45 }), { min: 20, max: 45 });
  assert.deepEqual(intervalo({ intervalo_min_seg: 60 }, { min: 20, max: 45 }), { min: 60, max: 60 });
  assert.equal(liberadaEm(null, agora), true);
  assert.equal(liberadaEm("2026-11-03T12:00:30Z", agora), false);
});

test("janela de envio em hora de SP", () => {
  assert.equal(dentroDaJanela(new Date("2026-11-03T12:00:00Z"), "08:00", "21:00"), true);  // 09:00 SP
  assert.equal(dentroDaJanela(new Date("2026-11-04T01:00:00Z"), "08:00", "21:00"), false); // 22:00 SP
  assert.equal(dentroDaJanela(new Date("2026-11-04T01:00:00Z"), "22:00", "06:00"), true);
});

// ── AGENDAMENTO / RECORRÊNCIA ───────────────────────────────────────────────
test("data e hora de SP viram UTC certo", () => {
  assert.equal(isoDeSP("2026-11-03", "19:30"), "2026-11-03T22:30:00.000Z");
  assert.equal(isoDeSP("2026-11-03", "23:30"), "2026-11-04T02:30:00.000Z");
  assert.equal(isoDeSP("2026-11-03", "25:00"), null);
});

test("recorrência: aquecimento da live seg/qua/sex 19:00 entre datas", () => {
  // 03/11/2026 é terça. Janela: de seg 02/11 00:00 SP até dom 08/11.
  const rec = { id: "r1", nome: "Aquecimento", dias_semana: [1, 3, 5], hora: "19:00", inicio: "2026-11-02", fim: "2026-11-06" };
  const d = ocorrencias(rec, new Date("2026-11-02T03:00:00Z"), new Date("2026-11-09T03:00:00Z"));
  assert.deepEqual(d, ["2026-11-02T22:00:00.000Z", "2026-11-04T22:00:00.000Z", "2026-11-06T22:00:00.000Z"]);
  // de é exclusivo: rodar de novo a partir da última não repete
  assert.deepEqual(ocorrencias(rec, new Date("2026-11-06T22:00:00Z"), new Date("2026-11-09T03:00:00Z")), []);
  assert.deepEqual(ocorrencias({ ...rec, dias_semana: [] }, new Date("2026-11-02T03:00:00Z"), new Date("2026-11-09T03:00:00Z")), []);
});

test("ocorrência vira campanha agendada com o mesmo destino", () => {
  const c = campanhaDaOcorrencia({ id: "r1", nome: "Aquec.", tipo: "texto", texto: "oi", tag_ids: ["t1"], mencionar_todos: true }, "2026-11-02T22:00:00.000Z");
  assert.equal(c.status, "agendada");
  assert.equal(c.recorrencia_id, "r1");
  assert.equal(c.enviar_em, "2026-11-02T22:00:00.000Z");
  assert.equal(c.nome, "Aquec. · 2026-11-02 19:00");
  assert.deepEqual(c.tag_ids, ["t1"]);
});

// ── FORMATO DO ENVIO ────────────────────────────────────────────────────────
test("envio de texto com @todos e citação", () => {
  const { caminho, corpo } = montarEnvio("marketing-a", { destino: G1, tipo: "texto", texto: "oi", mencionarTodos: true, citar: { id: "ABC12345", fromMe: false, participant: "1@lid", texto: "pergunta" } });
  assert.equal(caminho, "/message/sendText/marketing-a");
  assert.equal(corpo.mentionsEveryOne, true);
  assert.equal(corpo.quoted.key.participant, "1@lid");
  assert.equal(corpo.quoted.message.conversation, "pergunta");
});

test("enquete, mídia e documento no formato da Evolution v2", () => {
  const e = montarEnvio("marketing-a", { destino: G1, tipo: "enquete", texto: "Vai?", enqueteOpcoes: ["Sim", "Não", " "], enqueteMultipla: false });
  assert.equal(e.caminho, "/message/sendPoll/marketing-a");
  assert.deepEqual(e.corpo.values, ["Sim", "Não"]);
  assert.equal(e.corpo.selectableCount, 1);
  const m = montarEnvio("marketing-a", { destino: G1, tipo: "imagem", texto: "", midiaUrl: "https://x/a.png" });
  assert.equal(m.corpo.mediatype, "image");
  assert.equal(m.corpo.mimetype, "image/png");
  assert.equal(m.corpo.caption, undefined);
  const d = montarEnvio("marketing-a", { destino: G1, tipo: "documento", texto: "roteiro", midiaUrl: "https://x/Roteiro%20Jap%C3%A3o.pdf" });
  assert.equal(d.corpo.fileName, "Roteiro Japão.pdf");
  assert.throws(() => montarEnvio("marketing-a", { destino: "qualquer", tipo: "texto", texto: "x" }));
});

test("envio da fila usa o conteúdo da campanha", () => {
  const e = envioDaFila({ grupo_jid: G2 }, { tipo: "texto", texto: "t", mencionar_todos: true });
  assert.equal(e.destino, G2);
  assert.equal(e.mencionarTodos, true);
});

test("erro permanente não é repetido", () => {
  assert.equal(erroPermanente("Evolution 400: [object Object]"), true);
  assert.equal(erroPermanente("not-authorized"), true);
  assert.equal(erroPermanente("A Evolution demorou demais pra responder."), false);
  assert.equal(erroPermanente("Evolution 500: x"), false);
});

test("dados do grupo: participantes @lid + phoneNumber, admins e eu_admin", () => {
  const g = lerGrupo({
    id: G1, subject: "Live - Japão & China", desc: "d", size: 3, announce: true, restrict: false, owner: "551153066577@s.whatsapp.net",
    participants: [
      { id: "111@lid", phoneNumber: "551153066577@s.whatsapp.net", admin: "superadmin" },
      { id: "222@lid", phoneNumber: "5511999990000@s.whatsapp.net", admin: null },
      { id: "333@lid", admin: "admin" },
    ],
  }, "551153066577");
  assert.equal(g.nome, "Live - Japão & China");
  assert.equal(g.participantes, 3);
  assert.equal(g.admins.length, 2);
  assert.equal(g.eu_admin, true);
  assert.equal(g.so_admins_enviam, true);
  // sem participantes na resposta: não apaga a lista nem o eu_admin
  assert.equal("eu_admin" in lerGrupo({ id: G1, subject: "x" }, "551153066577"), false);
});
