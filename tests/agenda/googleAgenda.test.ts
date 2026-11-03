// Agenda Google sem n8n (03/11/2026): corpo do evento, respostas e freeBusy.
// Nada aqui vai à rede: as funções puras são testadas direto e, onde há fetch,
// o fetch global é trocado por um dublê.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  idEvento, separarConvidados, validarEntrada, montarEvento, montarPatchReagendar, urlInserir, urlEvento,
  respostaCriacao, respostaReagendar, respostaCancelamento, corpoFreeBusy, lerFreeBusy, linkDoMeet,
  executarAcaoAgenda, calendarioPadrao,
  // @ts-expect-error — módulo JS das funções da Vercel, sem tipos
} from "../../api/_googleAgenda.js";
import {
  envsGoogleFaltando, motivoNaoConfigurado, motivoDoErroDeToken, obterTokenGoogle, _limparCacheToken,
  // @ts-expect-error — módulo JS das funções da Vercel, sem tipos
} from "../../api/_google.js";

const MID = "0b5c3a9e-1f2d-4c6b-9a8e-7d6c5b4a3f21";
const ENV_OK = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec", GOOGLE_REFRESH_TOKEN: "rt" };

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  _limparCacheToken();
  for (const k of Object.keys(ENV_OK)) delete process.env[k];
});

type Resp = { status: number; body?: unknown };
/** Dublê do fetch: devolve as respostas em ordem e guarda as chamadas. */
function dubleFetch(respostas: Resp[]) {
  const chamadas: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url: String(url), init });
    const r = respostas.shift();
    if (!r) throw new Error("chamada a mais: " + url);
    const texto = r.body == null ? "" : JSON.stringify(r.body);
    return new Response(r.status === 204 ? null : texto, { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return chamadas;
}

// ── idEvento ───────────────────────────────────────────────────────────────

test("idEvento é IDÊNTICO ao do workflow do n8n (reuniões antigas caem no mesmo 409)", () => {
  const wf = JSON.parse(readFileSync(new URL("../../n8n/qs-agenda-meet.COM-OCUPACAO.workflow.json", import.meta.url), "utf8"));
  const codigo: string = wf.nodes.find((n: { name: string }) => n.name === "Validar entrada1").parameters.jsCode;
  const fonte = codigo.slice(codigo.indexOf("function idEvento"), codigo.indexOf("return [{ json"));
  const idDoN8n = new Function(`${fonte}; return idEvento;`)() as (s: string) => string;
  for (const s of [MID, "abc", "ffffffff-ffff-ffff-ffff-ffffffffffff"]) assert.equal(idEvento(s), idDoN8n(s));
});

test("idEvento: só base32hex (a-v, 0-9), até 60 caracteres, determinístico", () => {
  const id = idEvento(MID);
  assert.match(id, /^[a-v0-9]{5,60}$/);
  assert.ok(id.length <= 60);
  assert.equal(idEvento(MID), id);
  assert.notEqual(idEvento(MID.replace("0", "1")), id);
});

// ── Entrada ────────────────────────────────────────────────────────────────

test("convidados: descarta malformado, tira repetido sem caixa", () => {
  const r = separarConvidados(["closer@x.com", " Closer@X.com ", "sem-arroba", "", null, "cliente@y.com.br"]);
  assert.deepEqual(r.convidados, ["closer@x.com", "cliente@y.com.br"]);
  assert.deepEqual(r.descartados, ["sem-arroba"]);
});

test("validarEntrada: erros de cada ação viram 'invalida'", () => {
  assert.equal(validarEntrada({ acao: "criar" }, {}).acao, "invalida");
  assert.deepEqual(validarEntrada({ acao: "criar", meeting_id: MID }, {}).erros, ["inicio ausente", "fim ausente"]);
  assert.ok(validarEntrada({ acao: "criar", meeting_id: MID, inicio: "2026-11-04T15:00:00Z", fim: "2026-11-04T14:00:00Z" }, {})
    .erros.includes("fim menor ou igual ao inicio"));
  assert.deepEqual(validarEntrada({ acao: "cancelar", meeting_id: MID }, {}).erros, ["event_id ausente"]);
  assert.deepEqual(validarEntrada({ acao: "xpto", meeting_id: MID }, {}).erros, ["acao invalida: xpto"]);
  // ocupação dispensa meeting_id
  const oc = validarEntrada({ acao: "ocupacao", de: "2026-11-04T00:00:00Z", ate: "2026-11-05T00:00:00Z", emails: ["a@b.co", "torto"] }, {});
  assert.equal(oc.acao, "ocupacao");
  assert.deepEqual(oc.emails, ["a@b.co"]);
});

test("calendário: 'primary' por padrão, GOOGLE_CALENDAR_ID quando vier, calendar_id do corpo ganha", () => {
  assert.equal(calendarioPadrao({}), "primary");
  assert.equal(calendarioPadrao({ GOOGLE_CALENDAR_ID: " c_abc@group.calendar.google.com\n" }), "c_abc@group.calendar.google.com");
  assert.equal(validarEntrada({ acao: "cancelar", meeting_id: MID, event_id: "e", calendar_id: "outra" }, { GOOGLE_CALENDAR_ID: "x" }).calendar_id, "outra");
});

// ── Corpo do evento ────────────────────────────────────────────────────────

test("montarEvento: Meet (hangoutsMeet + requestId estável), id previsto, convidados, fuso e lembretes", () => {
  const d = validarEntrada({
    acao: "criar", meeting_id: MID, inicio: "2026-11-04T15:00:00.000Z", fim: "2026-11-04T16:00:00.000Z",
    titulo: "Reunião · Ana", descricao: "Negócio #123", convidados: ["closer@x.com", "ana@y.com", "ruim"],
  }, {});
  const ev = montarEvento(d);
  assert.equal(ev.id, idEvento(MID));
  assert.equal(ev.summary, "Reunião · Ana");
  assert.equal(ev.description, "Negócio #123");
  assert.deepEqual(ev.start, { dateTime: "2026-11-04T15:00:00.000Z", timeZone: "America/Sao_Paulo" });
  assert.deepEqual(ev.end, { dateTime: "2026-11-04T16:00:00.000Z", timeZone: "America/Sao_Paulo" });
  assert.deepEqual(ev.attendees, [{ email: "closer@x.com" }, { email: "ana@y.com" }]);
  assert.deepEqual(ev.conferenceData, { createRequest: { requestId: `qs-${MID}`, conferenceSolutionKey: { type: "hangoutsMeet" } } });
  assert.equal(ev.reminders.useDefault, false);
  assert.equal(d.convidados_descartados[0], "ruim");
});

test("URL do insert leva conferenceDataVersion=1 (sem isso o Google ignora o Meet) e sendUpdates=all", () => {
  const u = new URL(urlInserir("c_abc@group.calendar.google.com"));
  assert.equal(u.searchParams.get("conferenceDataVersion"), "1");
  assert.equal(u.searchParams.get("sendUpdates"), "all");
  assert.ok(u.pathname.includes("c_abc%40group.calendar.google.com") || u.pathname.includes("c_abc@group.calendar.google.com"));
  assert.ok(!urlEvento("primary", "e1").includes("sendUpdates"));
  assert.ok(urlEvento("primary", "e1", { sendUpdates: true }).endsWith("/events/e1?sendUpdates=all"));
});

test("reagendar: PATCH sem conferenceData (preserva a sala)", () => {
  const p = montarPatchReagendar(validarEntrada({ acao: "reagendar", meeting_id: MID, event_id: "e", inicio: "2026-11-05T15:00:00Z", fim: "2026-11-05T16:00:00Z", titulo: "T" }, {}));
  assert.deepEqual(Object.keys(p).sort(), ["end", "start", "summary"]);
});

// ── Respostas (o contrato que o QS espera) ─────────────────────────────────

const dCriar = validarEntrada({ acao: "criar", meeting_id: MID, inicio: "2026-11-04T15:00:00Z", fim: "2026-11-04T16:00:00Z", convidados: ["x"] }, {});

test("criação ok: event_id, meet_link, html_link, sem_meet=false, descartados", () => {
  const r = respostaCriacao(dCriar, 200, { id: "ev1", hangoutLink: "https://meet.google.com/abc", htmlLink: "https://cal/ev1" });
  assert.deepEqual(r, {
    ok: true, acao: "criar", meeting_id: MID, calendar_id: "primary", event_id: "ev1",
    meet_link: "https://meet.google.com/abc", html_link: "https://cal/ev1", sem_meet: false, convidados_descartados: ["x"],
  });
  assert.equal("duplicado" in r, false);
});

test("criação: link pelo entryPoint de vídeo; sem sala = sem_meet; 409 = duplicado", () => {
  const ev = { id: "e", conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:1" }, { entryPointType: "video", uri: "https://meet.google.com/x" }] } };
  assert.equal(linkDoMeet(ev), "https://meet.google.com/x");
  assert.equal(respostaCriacao(dCriar, 200, { id: "e" }).sem_meet, true);
  assert.equal(respostaCriacao(dCriar, 200, ev, true).duplicado, true);
});

test("criação: evento apagado no Google (cancelled) NÃO devolve a sala morta", () => {
  const r = respostaCriacao(dCriar, 200, { id: "e", status: "cancelled", hangoutLink: "https://meet.google.com/morta" }, true);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, "evento_cancelado");
  assert.equal(r.meet_link, undefined);
});

test("erro do Google vira { ok:false, codigo: status, erro: message }", () => {
  const r = respostaCriacao(dCriar, 403, { error: { code: 403, message: "Insufficient Permission" } });
  assert.deepEqual(r, { ok: false, acao: "criar", meeting_id: MID, codigo: 403, erro: "Insufficient Permission" });
});

test("reagendar 404/410 = nao_encontrado (o front recria); cancelar 410 = sucesso idempotente", () => {
  const d = validarEntrada({ acao: "reagendar", meeting_id: MID, event_id: "e", inicio: "2026-11-05T15:00:00Z", fim: "2026-11-05T16:00:00Z" }, {});
  assert.equal(respostaReagendar(d, 404, null).codigo, "nao_encontrado");
  assert.equal(respostaReagendar(d, 410, null).codigo, "nao_encontrado");
  const ok = respostaReagendar(d, 200, { id: "e", hangoutLink: "https://meet.google.com/a" });
  assert.equal(ok.ok, true);
  assert.equal(ok.meet_link, "https://meet.google.com/a");
  const dc = validarEntrada({ acao: "cancelar", meeting_id: MID, event_id: "e" }, {});
  assert.deepEqual(respostaCancelamento(dc, 204, null), { ok: true, acao: "cancelar", meeting_id: MID, event_id: "e" });
  assert.equal(respostaCancelamento(dc, 410, null).ja_estava_apagado, true);
  assert.equal(respostaCancelamento(dc, 500, { error: { message: "boom" } }).ok, false);
});

// ── freeBusy ───────────────────────────────────────────────────────────────

const dOc = validarEntrada({
  acao: "ocupacao", de: "2026-11-04T03:00:00.000Z", ate: "2026-11-19T03:00:00.000Z",
  emails: ["ana@x.com", "Beto@X.com", "caio@x.com", "duda@x.com"],
}, {});

test("corpo do freeBusy: timeMin/timeMax/timeZone/items", () => {
  assert.deepEqual(corpoFreeBusy(dOc), {
    timeMin: "2026-11-04T03:00:00.000Z", timeMax: "2026-11-19T03:00:00.000Z", timeZone: "America/Sao_Paulo",
    items: [{ id: "ana@x.com" }, { id: "Beto@X.com" }, { id: "caio@x.com" }, { id: "duda@x.com" }],
  });
});

test("parse do freeBusy: busy vira {inicio,fim}; agenda recusada vai pra avisos; caixa diferente acha", () => {
  const r = lerFreeBusy(dOc, 200, {
    calendars: {
      "ana@x.com": { busy: [{ start: "2026-11-04T17:00:00Z", end: "2026-11-04T18:00:00Z" }] },
      "beto@x.com": { busy: [] },
      "caio@x.com": { errors: [{ domain: "global", reason: "notFound" }], busy: [] },
    },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ocupado, {
    "ana@x.com": [{ inicio: "2026-11-04T17:00:00Z", fim: "2026-11-04T18:00:00Z" }],
    "Beto@X.com": [],
  });
  assert.deepEqual(r.avisos, ["caio@x.com: notFound", "duda@x.com: o Google nao devolveu esta agenda"]);
});

test("freeBusy com erro HTTP = ok:false (quem chama falha aberto)", () => {
  assert.deepEqual(lerFreeBusy(dOc, 401, { error: { message: "Invalid Credentials" } }),
    { ok: false, acao: "ocupacao", codigo: 401, erro: "Invalid Credentials" });
});

// ── Credencial / token (fetch dublê) ───────────────────────────────────────

test("envs: lista o que falta e a frase cita os nomes novos", () => {
  assert.deepEqual(envsGoogleFaltando({}), ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]);
  assert.deepEqual(envsGoogleFaltando({ ...ENV_OK, GOOGLE_REFRESH_TOKEN: "  \n" }), ["GOOGLE_REFRESH_TOKEN"]);
  assert.equal(motivoNaoConfigurado(ENV_OK), null);
  assert.match(motivoNaoConfigurado({}), /GOOGLE_REFRESH_TOKEN/);
});

test("erro do token: invalid_grant explica o que trocar", () => {
  assert.match(motivoDoErroDeToken({ error: "invalid_grant" }, 400), /GOOGLE_REFRESH_TOKEN/);
  assert.match(motivoDoErroDeToken({ error: "invalid_client" }, 401), /GOOGLE_CLIENT_ID/);
});

test("token: form-urlencoded com refresh_token e cache em memória até vencer", async () => {
  const chamadas = dubleFetch([{ status: 200, body: { access_token: "AT1", expires_in: 3599 } }]);
  const cred = { clientId: "cid", clientSecret: "sec", refreshToken: "rt" };
  assert.equal(await obterTokenGoogle({ credencial: cred }), "AT1");
  assert.equal(await obterTokenGoogle({ credencial: cred }), "AT1"); // do cache: dublê só tinha 1 resposta
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, "https://oauth2.googleapis.com/token");
  const corpo = new URLSearchParams(String(chamadas[0].init.body));
  assert.equal(corpo.get("grant_type"), "refresh_token");
  assert.equal(corpo.get("refresh_token"), "rt");
  assert.equal(corpo.get("client_id"), "cid");
});

// ── Porta única, ponta a ponta com o dublê ─────────────────────────────────

test("executarAcaoAgenda criar: 409 → busca o existente → duplicado com a MESMA sala", async () => {
  Object.assign(process.env, ENV_OK);
  const chamadas = dubleFetch([
    { status: 200, body: { access_token: "AT", expires_in: 3600 } },
    { status: 409, body: { error: { code: 409, message: "The requested identifier already exists." } } },
    { status: 200, body: { id: idEvento(MID), hangoutLink: "https://meet.google.com/mesma", htmlLink: "h" } },
  ]);
  const r = await executarAcaoAgenda({ acao: "criar", meeting_id: MID, inicio: "2026-11-04T15:00:00Z", fim: "2026-11-04T16:00:00Z", convidados: ["a@b.co"] });
  assert.equal(r.ok, true);
  assert.equal(r.duplicado, true);
  assert.equal(r.meet_link, "https://meet.google.com/mesma");
  assert.equal(chamadas[1].init.method, "POST");
  assert.equal((chamadas[1].init.headers as Record<string, string>).Authorization, "Bearer AT");
  assert.equal(JSON.parse(String(chamadas[1].init.body)).conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
  assert.equal(chamadas[2].init.method, "GET");
  assert.ok(chamadas[2].url.endsWith(`/events/${idEvento(MID)}`));
});

test("executarAcaoAgenda: sem env não vai à rede e responde nao_configurado; payload ruim = payload_invalido", async () => {
  const chamadas = dubleFetch([]);
  const r = await executarAcaoAgenda({ acao: "cancelar", meeting_id: MID, event_id: "e" });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, "nao_configurado");
  assert.equal((await executarAcaoAgenda({ acao: "criar" })).codigo, "payload_invalido");
  assert.equal(chamadas.length, 0);
});

test("executarAcaoAgenda: token recusado vira google_auth (nunca lança)", async () => {
  Object.assign(process.env, ENV_OK);
  dubleFetch([{ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }]);
  const r = await executarAcaoAgenda({ acao: "ocupacao", de: "2026-11-04T00:00:00Z", ate: "2026-11-05T00:00:00Z", emails: ["a@b.co"] });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, "google_auth");
  assert.match(r.erro, /refresh token/);
});

test("executarAcaoAgenda: 401 da Calendar limpa o token e tenta uma vez de novo", async () => {
  Object.assign(process.env, ENV_OK);
  const chamadas = dubleFetch([
    { status: 200, body: { access_token: "VELHO", expires_in: 3600 } },
    { status: 401, body: { error: { message: "Invalid Credentials" } } },
    { status: 200, body: { access_token: "NOVO", expires_in: 3600 } },
    { status: 204 },
  ]);
  const r = await executarAcaoAgenda({ acao: "cancelar", meeting_id: MID, event_id: "e" });
  assert.equal(r.ok, true);
  assert.equal((chamadas[3].init.headers as Record<string, string>).Authorization, "Bearer NOVO");
  assert.equal(chamadas[3].init.method, "DELETE");
});
