// Gravação + transcrição do Meet → card do QS (0314, 05/11/2026).
// Só as funções puras + o leitor de texto com fetch dublê. Nada vai à rede.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  codigoDoMeet, idDoArquivo, escolherAnexos, fimDaReuniao, intervaloEntreTentativas, decidirTentativa,
  statusDepois, cortarTexto, montarComentarioBitrix, dealIdDoLead, fraseSemAcessoAoTexto, motivoGoogle,
  lerTextoDoDoc, _limparCacheSa, MAX_TENTATIVAS,
  // @ts-expect-error — módulo JS das funções da Vercel, sem tipos
} from "../../api/_meetGravacoes.js";
// @ts-expect-error — módulo JS das funções da Vercel, sem tipos
import { _limparCacheToken } from "../../api/_google.js";

const MIN = 60_000;
const H = 60 * MIN;
const DOC = "application/vnd.google-apps.document";

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  _limparCacheToken();
  _limparCacheSa();
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_SA_JSON", "GOOGLE_SA_EMAIL", "GOOGLE_SA_KEY"]) delete process.env[k];
});

// ── Código do Meet ──────────────────────────────────────────────────────────
test("código do Meet sai do link (com e sem querystring, maiúsculas)", () => {
  assert.equal(codigoDoMeet("https://meet.google.com/cuz-kdsr-ngw"), "cuz-kdsr-ngw");
  assert.equal(codigoDoMeet("https://meet.google.com/KKI-YRTB-TSV?authuser=0"), "kki-yrtb-tsv");
  assert.equal(codigoDoMeet("meet.google.com/mqx-jyck-szb/"), "mqx-jyck-szb");
  assert.equal(codigoDoMeet("https://meet.google.com/lookup/abc-defg-hij"), "abc-defg-hij");
});
test("link que não é do Meet (ou torto) → null", () => {
  assert.equal(codigoDoMeet(null), null);
  assert.equal(codigoDoMeet("https://zoom.us/j/123"), null);
  assert.equal(codigoDoMeet("https://meet.google.com/abc-defg-hijk"), null);
});

// ── Anexos ──────────────────────────────────────────────────────────────────
const VIDEO = { fileId: "1AbCdEfGhIjKlMnOp", fileUrl: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view", title: "Reunião João (2026-11-04 14:03 GMT-3) - Gravação", mimeType: "video/mp4" };
const TRANSC = { fileId: "1TrAnScRiCaO12345", fileUrl: "https://docs.google.com/document/d/1TrAnScRiCaO12345/edit", title: "Reunião João (2026-11-04 14:03 GMT-3) - Transcrição", mimeType: DOC };
const GEMINI = { fileId: "1GeMiNi1234567890", fileUrl: "https://docs.google.com/document/d/1GeMiNi1234567890/edit", title: "Reunião João - 2026/11/04 14:03 GMT-03:00 - Anotações do Gemini", mimeType: DOC };
const PAUTA = { fileId: "1PaUtA12345678901", fileUrl: "https://docs.google.com/document/d/1PaUtA12345678901/edit", title: "Roteiro Japão", mimeType: DOC };

test("vídeo + transcrição + Gemini: fica a transcrição", () => {
  const e = escolherAnexos([GEMINI, VIDEO, PAUTA, TRANSC]);
  assert.equal(e.video.id, "1AbCdEfGhIjKlMnOp");
  assert.equal(e.documento.id, "1TrAnScRiCaO12345");
  assert.equal(e.documento.tipo, "transcricao");
});
test("só Anotações do Gemini: vira o texto, marcado como gemini", () => {
  const e = escolherAnexos([VIDEO, GEMINI]);
  assert.equal(e.documento.id, "1GeMiNi1234567890");
  assert.equal(e.documento.tipo, "gemini");
});
test("transcrição em inglês também conta", () => {
  const e = escolherAnexos([{ ...TRANSC, title: "Meeting - Transcript" }]);
  assert.equal(e.documento.tipo, "transcricao");
  assert.equal(e.video, null);
});
test("Doc qualquer anexado à mão não é transcrição; lista vazia/nula → nada", () => {
  assert.deepEqual(escolherAnexos([PAUTA]), { video: null, documento: null });
  assert.deepEqual(escolherAnexos(undefined), { video: null, documento: null });
});
test("id do arquivo sai da URL quando não vem fileId", () => {
  assert.equal(idDoArquivo({ fileUrl: "https://drive.google.com/file/d/1xYz_abc-DEF123/view?usp=drive_web" }), "1xYz_abc-DEF123");
  assert.equal(idDoArquivo({ fileUrl: "https://drive.google.com/open?id=1xYz_abc-DEF123" }), "1xYz_abc-DEF123");
  assert.equal(idDoArquivo({ fileUrl: "https://exemplo.com" }), null);
});

// ── Quando tentar ───────────────────────────────────────────────────────────
const INICIO = Date.UTC(2026, 10, 4, 17, 0); // 14:00 em SP
const reuniao = (extra: Record<string, unknown> = {}) => ({ status: "realizada", scheduled_at: new Date(INICIO).toISOString(), duration_min: 60, ...extra });
const FIM = INICIO + 60 * MIN;

test("fim = ends_at; sem ele, início + duração (30 min se faltar)", () => {
  assert.equal(fimDaReuniao(reuniao()), FIM);
  assert.equal(fimDaReuniao(reuniao({ duration_min: null })), INICIO + 30 * MIN);
  assert.equal(fimDaReuniao(reuniao({ ends_at: new Date(FIM + 10 * MIN).toISOString() })), FIM + 10 * MIN);
});
test("antes de 20 min do fim não busca", () => {
  assert.equal(decidirTentativa(reuniao(), FIM + 19 * MIN).tentar, false);
  const d = decidirTentativa(reuniao(), FIM + 21 * MIN);
  assert.equal(d.tentar, true);
  assert.equal(d.ultima, false);
});
test("só reunião realizada; achada e sem_gravacao não voltam", () => {
  assert.equal(decidirTentativa(reuniao({ status: "no_show" }), FIM + H).tentar, false);
  assert.equal(decidirTentativa(reuniao({ gravacao_status: "achada" }), FIM + H).tentar, false);
  assert.equal(decidirTentativa(reuniao({ gravacao_status: "sem_gravacao" }), FIM + H).tentar, false);
});
test("espera cresce entre tentativas (15 min, 30, 1 h… até 6 h)", () => {
  assert.equal(intervaloEntreTentativas(1), 15 * MIN);
  assert.equal(intervaloEntreTentativas(2), 30 * MIN);
  assert.equal(intervaloEntreTentativas(3), H);
  assert.equal(intervaloEntreTentativas(10), 6 * H);
  const m = reuniao({ gravacao_status: "pendente", gravacao_tentativas: 2, gravacao_buscada_em: new Date(FIM + H).toISOString() });
  assert.equal(decidirTentativa(m, FIM + H + 29 * MIN).tentar, false);
  assert.equal(decidirTentativa(m, FIM + H + 31 * MIN).tentar, true);
});
test("passou de 48 h do fim: é a última (antiga da carga também tenta uma vez)", () => {
  const d = decidirTentativa(reuniao(), FIM + 30 * 24 * H);
  assert.equal(d.tentar, true);
  assert.equal(d.ultima, true);
});
test("teto de tentativas para; refazer ignora espera e teto", () => {
  const m = reuniao({ gravacao_status: "erro", gravacao_tentativas: MAX_TENTATIVAS, gravacao_buscada_em: new Date(FIM).toISOString() });
  assert.equal(decidirTentativa(m, FIM + 100 * H).tentar, false);
  assert.equal(decidirTentativa(m, FIM + 100 * H, { refazer: true }).tentar, true);
});

// ── Status depois da busca ──────────────────────────────────────────────────
const base = { fim: FIM, agora: FIM + H, ultima: false };
test("vídeo + texto lido = achada", () => {
  assert.equal(statusDepois({ ...base, video: {}, documento: {}, textoOk: true }), "achada");
});
test("nada ainda: pendente; na última: sem_gravacao", () => {
  assert.equal(statusDepois({ ...base }), "pendente");
  assert.equal(statusDepois({ ...base, ultima: true }), "sem_gravacao");
});
test("achou o Doc mas não leu (falta acesso) = erro, pra tentar de novo", () => {
  assert.equal(statusDepois({ ...base, video: {}, documento: {}, textoOk: false, erroTexto: "sem acesso" }), "erro");
});
test("só um dos dois: espera o outro até 3 h, depois fecha achada", () => {
  assert.equal(statusDepois({ ...base, documento: {}, textoOk: true }), "pendente");
  assert.equal(statusDepois({ ...base, agora: FIM + 4 * H, documento: {}, textoOk: true }), "achada");
  assert.equal(statusDepois({ ...base, agora: FIM + 4 * H, video: {} }), "achada");
});
test("erro do Google: erro; evento apagado na última: sem_gravacao", () => {
  assert.equal(statusDepois({ ...base, erroGoogle: "403" }), "erro");
  assert.equal(statusDepois({ ...base, erroGoogle: "sumiu", eventoSumiu: true, ultima: true }), "sem_gravacao");
});

// ── Texto ───────────────────────────────────────────────────────────────────
test("cortarTexto respeita o teto e prefere quebra de linha", () => {
  assert.deepEqual(cortarTexto("﻿oi\r\ntudo bem", 100), { texto: "oi\ntudo bem", cortada: false });
  const linhas = Array.from({ length: 50 }, (_, i) => `linha ${i} ${"x".repeat(10)}`).join("\n");
  const r = cortarTexto(linhas, 200);
  assert.equal(r.cortada, true);
  assert.ok(r.texto.length <= 200);
  assert.ok(r.texto.endsWith("x"));
});

// ── Bitrix ──────────────────────────────────────────────────────────────────
test("comentário do Bitrix: links, texto e aviso de corte; sem emoji", () => {
  const texto = "Closer: Olá!\n".repeat(10);
  const c = montarComentarioBitrix({ m: { scheduled_at: new Date(INICIO).toISOString(), title: "Japão" }, gravacaoUrl: "https://g/v", transcricaoUrl: "https://g/t", texto, tipo: "transcricao", max: 50 });
  assert.match(c, /Reunião do Google Meet de 04\/11\/2026,? 14:00 — Japão/);
  assert.match(c, /Gravação: https:\/\/g\/v/);
  assert.match(c, /Transcrição: https:\/\/g\/t/);
  assert.match(c, /texto cortado aqui .* o completo está no QS/);
  assert.ok(!/[\u{10000}-\u{10FFFF}]/u.test(c), "nada de caractere de 4 bytes (o Bitrix corta)");
});
test("comentário só com link, sem texto lido, e Gemini rotulado", () => {
  const c = montarComentarioBitrix({ m: { scheduled_at: new Date(INICIO).toISOString() }, gravacaoUrl: null, transcricaoUrl: "https://g/t", texto: null, tipo: "gemini" });
  assert.match(c, /Anotações do Gemini: https:\/\/g\/t/);
  assert.match(c, /não pôde ser lido/);
  assert.ok(!c.includes("Gravação:"));
});
test("deal id do lead: só dígitos, aceita lista do PostgREST", () => {
  assert.equal(dealIdDoLead({ bitrix_id: "12345" }), "12345");
  assert.equal(dealIdDoLead([{ bitrix_id: " D_987 " }]), "987");
  assert.equal(dealIdDoLead({ bitrix_id: null }), null);
  assert.equal(dealIdDoLead(null), null);
});

// ── Frases de erro ──────────────────────────────────────────────────────────
test("frase de acesso diz o e-mail da conta de serviço e o escopo", () => {
  const f = fraseSemAcessoAoTexto({ motivoOauth: "token sem escopo de Drive", motivoSa: "404", emailSa: "qs@proj.iam.gserviceaccount.com" });
  assert.match(f, /Meet Recordings/);
  assert.match(f, /qs@proj\.iam\.gserviceaccount\.com/);
  assert.match(f, /drive\.readonly/);
  assert.match(f, /especialista@agenciasetuforeuvou\.com/);
});
test("motivoGoogle reconhece escopo insuficiente", () => {
  assert.match(motivoGoogle(403, { error: { message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } }), /escopo/);
  assert.match(motivoGoogle(404, null), /404/);
});

// ── Leitura do texto (fetch dublê) ──────────────────────────────────────────
test("texto: token da agenda sem escopo de Drive e sem conta de serviço → erro explicando", async () => {
  process.env.GOOGLE_CLIENT_ID = "cid"; process.env.GOOGLE_CLIENT_SECRET = "sec"; process.env.GOOGLE_REFRESH_TOKEN = "rt";
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
    return new Response(JSON.stringify({ error: { message: "insufficient authentication scopes" } }), { status: 403 });
  }) as typeof fetch;
  const r = await lerTextoDoDoc("1TrAnScRiCaO12345");
  assert.equal(r.ok, false);
  assert.match(r.erro, /não tem acesso/);
  assert.match(r.erro, /GOOGLE_SA_JSON/);
  assert.ok(urls.some((u) => u.includes("/files/1TrAnScRiCaO12345/export?mimeType=text%2Fplain")));
});
test("texto: token da agenda com acesso devolve o texto", async () => {
  process.env.GOOGLE_CLIENT_ID = "cid"; process.env.GOOGLE_CLIENT_SECRET = "sec"; process.env.GOOGLE_REFRESH_TOKEN = "rt";
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "tk", expires_in: 3600 }), { status: 200 });
    return new Response("Closer: bom dia\nCliente: bom dia", { status: 200 });
  }) as typeof fetch;
  const r = await lerTextoDoDoc("1TrAnScRiCaO12345");
  assert.equal(r.ok, true);
  assert.equal(r.via, "agenda");
  assert.match(r.texto, /Cliente: bom dia/);
});
