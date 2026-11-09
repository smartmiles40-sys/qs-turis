// Criar e gerenciar grupos (0342): os formatos que vão pra Evolution API v2, a
// trava de instância nas chamadas novas, a rota pública /g/<slug> e o cron do link.
// Sem rede: o fetch é um falso que responde como PostgREST e anota a Evolution.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://banco.falso";
process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-falsa";
process.env.EVOLUTION_URL = "https://evo.falsa";
process.env.EVOLUTION_APIKEY = "evo-falsa";
process.env.REL_GRUPOS_INSTANCIA = "relacionamento-grupos-4183";
process.env.MKT_GRUPOS_LINK_AUTO = "";

type Chamada = { url: string; method: string; body: unknown };
let conexao: Record<string, unknown> | null = null;
let evo: Chamada[] = [];
let banco: Chamada[] = [];
let respostaRpc: unknown = {};
let links: unknown[] = [];
let linkGrupos: unknown[] = [];
let grupos: unknown[] = [];

const resp = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  const method = init?.method || "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (u.startsWith("https://evo.falsa")) {
    const c = u.replace("https://evo.falsa", "");
    evo.push({ url: c, method, body });
    if (c.startsWith("/group/create/")) return resp({ id: "120363999@g.us", subject: body.subject, participants: [{ id: "a" }, { id: "b" }] });
    if (c.startsWith("/group/inviteCode/")) return resp({ inviteUrl: "https://chat.whatsapp.com/CodigoNovo1234", inviteCode: "CodigoNovo1234" });
    if (c.startsWith("/group/revokeInviteCode/")) return resp({ revoked: true, inviteCode: "Renovado98765" });
    if (c.startsWith("/group/participants/")) return resp({ participants: [{ id: "5511911112222@s.whatsapp.net", admin: "admin" }, { id: "123456789@lid", phoneNumber: "5511933334444@s.whatsapp.net", admin: null }] });
    if (c.startsWith("/group/updateParticipant/")) return resp({ updateParticipants: [{ status: "200", jid: "5511911112222@s.whatsapp.net" }, { status: "403", jid: "5511933334444@s.whatsapp.net" }] });
    return resp({ update: "success" });
  }
  banco.push({ url: u, method, body });
  if (u.includes("/rest/v1/mkt_grupos_conexao")) return resp(conexao ? [conexao] : []);
  if (u.includes("/rest/v1/qs_wa_linhas")) return resp([]);
  if (u.includes("/rest/v1/mkt_grupos_bloqueios")) return resp([{ valor: "relacionamento-grupos-4183", tipo: "instancia" }]);
  if (u.includes("/rest/v1/rpc/mkt_grupos_link_escolher")) return resp(respostaRpc);
  if (u.includes("/rest/v1/mkt_grupos_links") && method === "GET") return resp(links);
  if (u.includes("/rest/v1/mkt_grupos_links") && method === "PATCH") return resp([{ id: "x" }]);
  if (u.includes("/rest/v1/mkt_grupos_link_grupos") && method === "GET") return resp(linkGrupos);
  if (u.includes("/rest/v1/mkt_grupos?") && method === "GET") return resp(grupos);
  return resp([]);
}) as typeof fetch;

// @ts-expect-error — módulos JS das funções da Vercel, sem tipos
const G = await import("../../api/_mktGruposGestao.js");
// @ts-expect-error — idem
const { rodadaLinks, refDoGrupo } = await import("../../api/_mktGruposLink.js");
// @ts-expect-error — idem
const { default: rotaPublica } = await import("../../api/mkt-grupos-link.js");

const MKT = { id: 1, instancia: "marketing-consolidado-59ipu", numero: "5511951757602", estado: "open", envio_ligado: false };
beforeEach(() => { evo = []; banco = []; conexao = { ...MKT }; links = []; linkGrupos = []; grupos = []; process.env.MKT_GRUPOS_LINK_AUTO = ""; });

test("criar grupo: create → foto → configurações → admins → convite, tudo pela instância do MKT", async () => {
  const g = await G.criarGrupo({ nome: "Japão 2027 #1", descricao: "Grupo oficial", fotoUrl: "https://x.supabase.co/f.jpg", admins: "11 99999-8888", soAdminsEnviam: true, soAdminsEditam: false });
  assert.equal(g.jid, "120363999@g.us");
  assert.equal(g.convite, "https://chat.whatsapp.com/CodigoNovo1234");
  assert.deepEqual(g.avisos, []);
  const q = "?groupJid=120363999%40g.us";
  assert.deepEqual(evo.map((c) => `${c.method} ${c.url}`), [
    "POST /group/create/marketing-consolidado-59ipu",
    `POST /group/updateGroupPicture/marketing-consolidado-59ipu${q}`,
    `POST /group/updateSetting/marketing-consolidado-59ipu${q}`,
    `POST /group/updateSetting/marketing-consolidado-59ipu${q}`,
    `POST /group/updateParticipant/marketing-consolidado-59ipu${q}`,
    `GET /group/inviteCode/marketing-consolidado-59ipu${q}`,
  ]);
  assert.deepEqual(evo[0].body, { subject: "Japão 2027 #1", description: "Grupo oficial", participants: ["5511999998888"] });
  assert.deepEqual(evo[1].body, { image: "https://x.supabase.co/f.jpg" });
  assert.deepEqual(evo[2].body, { action: "announcement" });
  assert.deepEqual(evo[3].body, { action: "unlocked" });
  assert.deepEqual(evo[4].body, { action: "promote", participants: ["5511999998888"] });
});

test("criar grupo: sem admin/participante o WhatsApp não cria — erro antes de chamar a Evolution", async () => {
  await assert.rejects(() => G.criarGrupo({ nome: "X" }), /pelo menos uma pessoa/);
  await assert.rejects(() => G.criarGrupo({ nome: "", admins: "11999998888" }), /nome/);
  assert.deepEqual(evo, []);
});

test("criar grupo pela instância do Rel: a trava recusa e NADA vai pra Evolution", async () => {
  conexao = { id: 1, instancia: "relacionamento-grupos-4183", numero: "5511980124183", estado: "open" };
  await assert.rejects(() => G.criarGrupo({ nome: "X", admins: "11999998888" }), /Trava do Marketing/);
  await assert.rejects(() => G.sairDoGrupo("120363@g.us"), /Trava do Marketing/);
  await assert.rejects(() => G.renovarConvite("120363@g.us"), /Trava do Marketing/);
  assert.deepEqual(evo, []);
});

test("passo depois da criação que falha vira aviso (o grupo já existe: não cria de novo)", async () => {
  const falso = async (rota: string, o: { body?: unknown } = {}) => {
    evo.push({ url: rota, method: "", body: o.body });
    if (rota === "group/create") return { id: "120363777@g.us" };
    if (rota === "group/updateGroupPicture") throw new Error("Evolution 400: imagem ruim");
    if (rota === "group/inviteCode") return { inviteCode: "Abcdefghij12" };
    return {};
  };
  const g = await G.criarGrupo({ nome: "Teste", admins: ["5511999998888"], fotoUrl: "https://a/b.png" }, { evo: falso });
  assert.equal(g.jid, "120363777@g.us");
  assert.equal(g.avisos.length, 1);
  assert.match(g.avisos[0], /^Foto:/);
  assert.equal(evo.filter((c) => c.url === "group/create").length, 1);
});

test("editar: só o que veio, nos endpoints certos", async () => {
  const f = await G.editarGrupo("120363@g.us", { nome: "Novo nome", descricao: "", soAdminsEnviam: false });
  assert.deepEqual(f, { nome: "Novo nome", descricao: null, so_admins_enviam: false });
  assert.deepEqual(evo.map((c) => [c.url.split("/").slice(0, 3).join("/"), c.body]), [
    ["/group/updateGroupSubject", { subject: "Novo nome" }],
    ["/group/updateGroupDescription", { description: " " }],
    ["/group/updateSetting", { action: "not_announcement" }],
  ]);
  await assert.rejects(() => G.editarGrupo("120363@g.us", {}), /Nada para mudar/);
  await assert.rejects(() => G.editarGrupo("5511@s.whatsapp.net", { nome: "x" }), /Grupo inválido/);
});

test("participantes: lê, e adicionar/remover/promover leva números ou ids (@lid incluso) e traduz o resultado", async () => {
  const lista = await G.lerParticipantes("120363@g.us");
  assert.deepEqual(lista.map((p: { telefone: string | null }) => p.telefone), ["5511911112222", "5511933334444"]);
  evo = [];
  const r = await G.mudarParticipantes("120363@g.us", "remove", ["123456789@lid", "(11) 91111-2222"]);
  assert.deepEqual(evo[0].body, { action: "remove", participants: ["123456789@lid", "5511911112222"] });
  assert.equal(r.resultado[0].ok, true);
  assert.match(r.resultado[1].motivo, /privacidade/);
  await assert.rejects(() => G.mudarParticipantes("120363@g.us", "banir", ["5511911112222"]), /Ação inválida/);
  await assert.rejects(() => G.mudarParticipantes("120363@g.us", "add", ["abc"]), /inválido/);
});

test("renovar convite: revoke e devolve o link NOVO; sair: DELETE leaveGroup", async () => {
  assert.equal(await G.renovarConvite("120363@g.us"), "https://chat.whatsapp.com/Renovado98765");
  await G.sairDoGrupo("120363@g.us");
  assert.deepEqual(evo.map((c) => `${c.method} ${c.url.split("?")[0]}`), [
    "POST /group/revokeInviteCode/marketing-consolidado-59ipu",
    "DELETE /group/leaveGroup/marketing-consolidado-59ipu",
  ]);
});

// ── rota pública ──
function resFalsa() {
  const r = { statusCode: 0, headers: {} as Record<string, string>, corpo: "" };
  const api = {
    setHeader: (k: string, v: string) => { r.headers[k.toLowerCase()] = v; },
    status: (s: number) => { r.statusCode = s; return api; },
    send: (b: string) => { r.corpo = b; return api; },
    end: () => api,
  };
  return { r, api };
}
const pedir = async (slug: string, ua = "Mozilla/5.0 (iPhone) Safari/604.1", cookie = "") => {
  const { r, api } = resFalsa();
  await rotaPublica({ method: "GET", query: { slug }, headers: { "user-agent": ua, cookie } }, api);
  return r;
};

test("/g/<slug>: pessoa vai pro convite (302) com cookie só de hash; não expõe jid", async () => {
  respostaRpc = { status: "ok", convite: "https://chat.whatsapp.com/AbCdEfGhIj12", ref: "0123456789ab" };
  const r = await pedir("japao-2027", undefined, "g_japao_2027=fedcba987654");
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, "https://chat.whatsapp.com/AbCdEfGhIj12");
  assert.match(r.headers["set-cookie"], /^g_japao_2027=0123456789ab; .*HttpOnly; Secure/);
  const rpc = banco.find((c) => c.url.includes("mkt_grupos_link_escolher"));
  assert.deepEqual(rpc?.body, { p_slug: "japao-2027", p_modo: "clique", p_ref: "fedcba987654" });
});

test("/g/<slug>: convite fora do WhatsApp nunca vira redirecionamento", async () => {
  respostaRpc = { status: "ok", convite: "https://evil.com/x", ref: "0123456789ab" };
  const r = await pedir("japao-2027");
  assert.notEqual(r.statusCode, 302);
  assert.equal(r.headers.location, undefined);
});

test("/g/<slug>: robô de prévia não conta; lotado, aguarde e inexistente", async () => {
  respostaRpc = { status: "ok", titulo: "Japão 2027", descricao: "Entre no grupo" };
  let r = await pedir("japao-2027", "WhatsApp/2.23");
  assert.equal(r.statusCode, 200);
  assert.match(r.corpo, /Japão 2027/);
  assert.equal(banco.find((c) => c.url.includes("escolher"))?.body && (banco.find((c) => c.url.includes("escolher"))?.body as { p_modo: string }).p_modo, "bot");
  respostaRpc = { status: "lotado", titulo: "Japão", mensagem: "Abrimos mais vagas sexta." };
  r = await pedir("japao-2027");
  assert.match(r.corpo, /Grupos lotados/);
  assert.match(r.corpo, /Abrimos mais vagas sexta/);
  respostaRpc = { status: "aguarde", titulo: "Japão" };
  r = await pedir("japao-2027");
  assert.match(r.corpo, /http-equiv="refresh"/);
  respostaRpc = { status: "nao_existe" };
  r = await pedir("nao-tem");
  assert.equal(r.statusCode, 404);
  banco = [];
  r = await pedir("../../etc");
  assert.equal(r.statusCode, 404);
  assert.equal(banco.length, 0);   // slug inválido nem chega no banco
});

// ── cron do link ──
test("cron do link: conta membros pela instância do MKT e grava pela RPC (sem criar grupo com a chave desligada)", async () => {
  links = [{ id: "11111111-1111-1111-1111-111111111111", slug: "japao", ativo: true, capacidade: 2, ao_lotar: "criar_grupo", modelo_nome: "J #{n}", modelo_admins: ["5511999998888"], limite_auto: 5, criados_auto: 0, criar_ao_pct: 90 }];
  linkGrupos = [{ link_id: "11111111-1111-1111-1111-111111111111", grupo_jid: "120363@g.us", ordem: 1, ativo: true, pendentes: 0 }];
  grupos = [{ jid: "120363@g.us", participantes: 1, link_convite: "https://chat.whatsapp.com/AbCdEfGhIj12", link_em: new Date().toISOString(), contado_em: null }];
  const r = await rodadaLinks({ prazoMs: 30_000 });
  assert.equal(r.contados, 1);
  assert.equal(r.criados, 0);   // MKT_GRUPOS_LINK_AUTO desligado
  assert.deepEqual(evo.map((c) => c.url), ["/group/participants/marketing-consolidado-59ipu?groupJid=120363%40g.us"]);
  const rpc = banco.find((c) => c.url.includes("rpc/mkt_grupos_link_contagem"));
  assert.deepEqual(rpc?.body, { p_grupo: "120363@g.us", p_membros: 2 });
});

test("cron do link com a instância do Rel: para antes de chamar a Evolution", async () => {
  conexao = { id: 1, instancia: "relacionamento-grupos-4183", estado: "open" };
  links = [{ id: "11111111-1111-1111-1111-111111111111", slug: "japao", ativo: true, capacidade: 2 }];
  linkGrupos = [{ link_id: "11111111-1111-1111-1111-111111111111", grupo_jid: "120363@g.us", ordem: 1, ativo: true }];
  const r = await rodadaLinks({ prazoMs: 30_000 });
  assert.match(String(r.parado), /Trava do Marketing/);
  assert.deepEqual(evo, []);
});

test("refDoGrupo bate com o SQL (sha256 hex, 12 primeiros)", () => {
  // select left(encode(sha256(convert_to('120363@g.us','UTF8')),'hex'),12)
  assert.match(refDoGrupo("120363@g.us"), /^[0-9a-f]{12}$/);
  assert.equal(refDoGrupo("120363@g.us"), refDoGrupo("120363@g.us"));
  assert.notEqual(refDoGrupo("120363@g.us"), refDoGrupo("120364@g.us"));
});

test("webhook GROUP_PARTICIPANTS_UPDATE da instância do MKT: grava entradas/saídas pela RPC; de outra instância: ignora", async () => {
  process.env.MKT_GRUPOS_SECRET = "segredo-de-teste-123456";
  // @ts-expect-error — módulo JS da função da Vercel, sem tipos
  const { default: rota } = await import("../../api/mkt-grupos.js");
  const chamar = async (corpo: unknown) => {
    const { r, api } = resFalsa();
    const api2 = { ...api, json: (b: unknown) => { r.corpo = JSON.stringify(b); return api2; }, status: (s: number) => { r.statusCode = s; return api2; } };
    await rota({ method: "POST", query: { webhook: "1", t: "segredo-de-teste-123456" }, headers: {}, body: corpo }, api2);
    return r;
  };
  let r = await chamar({ event: "group-participants.update", instance: "marketing-consolidado-59ipu", data: { id: "120363@g.us", action: "add", participants: ["a@lid", "b@lid"] } });
  assert.equal(r.statusCode, 200);
  const rpc = banco.filter((c) => c.url.includes("rpc/mkt_grupos_membros_mov"));
  assert.deepEqual(rpc.map((c) => c.body), [{ p_grupo: "120363@g.us", p_entradas: 2, p_saidas: 0 }]);
  banco = [];
  r = await chamar({ event: "GROUP_PARTICIPANTS_UPDATE", instance: "relacionamento-grupos-4183", data: { id: "120363@g.us", action: "add", participants: ["a"] } });
  assert.match(r.corpo, /ignorado/);
  assert.equal(banco.filter((c) => c.url.includes("rpc/")).length, 0);
  assert.deepEqual(evo, []);
});
