// Testes das partes puras do Drive do Marketing (0241).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/mkt-drive/*.test.ts
// Nada aqui chama o Google de verdade: o fetch é falso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import {
  assinarJwt, b64url, lerCredenciais, normalizarChave, tokenGoogle, _limparCacheToken,
  montarQueryBusca, escaparQ, dataRfc3339, tamanhoPagina, tokenPaginaValido, paramsListagem,
  faixaDoPedido, MAX_PEDACO, urlAssinada, conferirLink, origemPermitida, tagsLimpas, nomeLimpo,
  paraIndice, paraTela, tipoDe, miniaturaNoTamanho, idValido, URL_TOKEN, ESCOPO_DRIVE,
} from "../../api/_mktDriveGoogle.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const EMAIL = "qs-drive@projeto.iam.gserviceaccount.com";
const ENV = { GOOGLE_SA_EMAIL: EMAIL, GOOGLE_SA_KEY: privateKey.replace(/\n/g, "\\n"), MKT_DRIVE_ID: "0ABCdefGhIjKlMnOpQ" };

const decodificar = (parte: string) => JSON.parse(Buffer.from(parte.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));

// ── JWT ─────────────────────────────────────────────────────────────────────

test("JWT: cabeçalho RS256, claims do Google e assinatura que confere com a chave pública", () => {
  const jwt = assinarJwt({ email: EMAIL, chave: privateKey, agora: 1_800_000_000 });
  const [h, c, s] = jwt.split(".");
  assert.deepEqual(decodificar(h), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(decodificar(c), { iss: EMAIL, scope: ESCOPO_DRIVE, aud: URL_TOKEN, iat: 1_800_000_000, exp: 1_800_003_600 });
  assert.ok(!/[=+/]/.test(jwt), "base64url sem padding");
  const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  assert.equal(ok, true);
});

test("b64url de texto e de buffer", () => {
  assert.equal(b64url("??>"), "Pz8-");
  assert.equal(b64url(Buffer.from([0xfb, 0xff])), "-_8");
});

test("chave com \\n escapado e aspas vira PEM de verdade", () => {
  const k = normalizarChave(`"-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n"`);
  assert.equal(k, "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n");
});

test("credenciais: por variáveis soltas, por JSON e por JSON em base64", () => {
  assert.equal(lerCredenciais(ENV).email, EMAIL);
  const json = JSON.stringify({ client_email: EMAIL, private_key: privateKey });
  const a = lerCredenciais({ GOOGLE_SA_JSON: json, MKT_DRIVE_ID: "x123456789" });
  assert.equal(a.chave, privateKey.trim());
  const b = lerCredenciais({ GOOGLE_SA_JSON: Buffer.from(json).toString("base64"), MKT_DRIVE_ID: "x123456789" });
  assert.equal(b.email, EMAIL);
});

test("credenciais: diz o que falta", () => {
  assert.throws(() => lerCredenciais({}), /falta GOOGLE_SA_EMAIL, GOOGLE_SA_KEY, MKT_DRIVE_ID/);
  assert.throws(() => lerCredenciais({ GOOGLE_SA_JSON: "{oi" }), /não é um JSON válido/);
  assert.throws(() => lerCredenciais({ ...ENV, GOOGLE_SA_KEY: "abc" }), /não parece uma chave PEM/);
});

test("token: troca o JWT no endpoint do Google e guarda em memória", async () => {
  _limparCacheToken();
  const chamadas: { url: string; corpo: string }[] = [];
  const fetchFalso = async (url: string, init: { body: string }) => {
    chamadas.push({ url, corpo: init.body });
    return { ok: true, json: async () => ({ access_token: "ya29.teste", expires_in: 3599 }) } as unknown as Response;
  };
  const t1 = await tokenGoogle({ fetchFn: fetchFalso as unknown as typeof fetch, env: ENV });
  const t2 = await tokenGoogle({ fetchFn: fetchFalso as unknown as typeof fetch, env: ENV });
  assert.equal(t1, "ya29.teste");
  assert.equal(t2, "ya29.teste");
  assert.equal(chamadas.length, 1, "segunda chamada usa o cache");
  assert.equal(chamadas[0].url, URL_TOKEN);
  const corpo = new URLSearchParams(chamadas[0].corpo);
  assert.equal(corpo.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  assert.equal(corpo.get("assertion")!.split(".").length, 3);
  _limparCacheToken();
});

test("token: Google recusou → erro DRIVE_AUTH com o motivo", async () => {
  _limparCacheToken();
  const fetchFalso = async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "Invalid JWT Signature." }) }) as unknown as Response;
  await assert.rejects(tokenGoogle({ fetchFn: fetchFalso as unknown as typeof fetch, env: ENV }), (e: Error & { code?: string }) => e.code === "DRIVE_AUTH" && /Invalid JWT Signature/.test(e.message));
});

// ── Query de busca ──────────────────────────────────────────────────────────

test("busca: sem nada → só o que não está na lixeira", () => {
  assert.equal(montarQueryBusca(), "trashed = false");
});

test("busca: nome, tipo, pasta e período", () => {
  const q = montarQueryBusca({ texto: "  Japão reels ", tipo: "video", pastaId: "1AbCdEfGhIjK", desde: "2026-10-01", ate: "2026-10-30" });
  assert.equal(q, [
    "trashed = false",
    "name contains 'Japão reels'",
    "mimeType contains 'video/'",
    "'1AbCdEfGhIjK' in parents",
    "modifiedTime >= '2026-10-01T00:00:00-03:00'",
    "modifiedTime <= '2026-10-30T23:59:59-03:00'",
  ].join(" and "));
});

test("busca: aspas e barra invertida não escapam da string (sem injeção na q)", () => {
  assert.equal(escaparQ("d'água \\ x"), "d\\'água \\\\ x");
  const q = montarQueryBusca({ texto: "x' or name contains '" });
  assert.equal(q, "trashed = false and name contains 'x\\' or name contains \\''");
});

test("busca: tipo desconhecido e data inválida são ignorados", () => {
  assert.equal(montarQueryBusca({ tipo: "exe", desde: "ontem" }), "trashed = false");
  assert.equal(dataRfc3339(""), null);
  assert.equal(montarQueryBusca({ lixeira: true }), "trashed = true");
});

// ── Paginação ───────────────────────────────────────────────────────────────

test("paginação: tamanho com padrão e teto", () => {
  assert.equal(tamanhoPagina(undefined), 50);
  assert.equal(tamanhoPagina("abc"), 50);
  assert.equal(tamanhoPagina(0), 50);
  assert.equal(tamanhoPagina(30), 30);
  assert.equal(tamanhoPagina(5000), 200);
});

test("paginação: só repassa pageToken com cara de token do Drive", () => {
  assert.equal(tokenPaginaValido("~!!~AI9FV7Q"), false);
  assert.equal(tokenPaginaValido("AHWqTUmQx-2_a=="), true);
  assert.equal(tokenPaginaValido(""), false);
  const p = paramsListagem({ driveId: "0ABC", q: "trashed = false", pageToken: "AHWqTUm", tamanho: 20 });
  assert.equal(p.pageToken, "AHWqTUm");
  assert.equal(p.pageSize, 20);
  assert.equal(p.corpora, "drive");
  assert.equal(p.driveId, "0ABC");
  assert.equal(p.includeItemsFromAllDrives, "true");
  assert.match(p.fields, /^nextPageToken,files\(/);
  const sem = paramsListagem({ driveId: "0ABC", q: "x", pageToken: "a b" });
  assert.equal("pageToken" in sem, false);
});

// ── Faixa de bytes do player ────────────────────────────────────────────────

test("faixa: bytes=N- vira um pedaço de no máximo 4 MB", () => {
  assert.deepEqual(faixaDoPedido("bytes=0-"), { inicio: 0, fim: MAX_PEDACO - 1 });
  assert.deepEqual(faixaDoPedido("bytes=1000-"), { inicio: 1000, fim: 1000 + MAX_PEDACO - 1 });
  assert.deepEqual(faixaDoPedido("bytes=10-20"), { inicio: 10, fim: 20 });
  assert.deepEqual(faixaDoPedido("bytes=0-99999999"), { inicio: 0, fim: MAX_PEDACO - 1 });
  assert.deepEqual(faixaDoPedido(undefined), { inicio: 0, fim: MAX_PEDACO - 1 });
  assert.deepEqual(faixaDoPedido("lixo"), { inicio: 0, fim: MAX_PEDACO - 1 });
});

// ── Link assinado ───────────────────────────────────────────────────────────

test("link assinado: confere, expira e não serve pra outro arquivo nem outra ação", () => {
  const agora = 1_800_000_000;
  const url = urlAssinada("midia", "1AbCdEfGhIjK", { agora, validade: 60, env: ENV });
  const p = Object.fromEntries(new URL(url, "https://qs.x").searchParams);
  assert.equal(conferirLink(p as never, { agora, env: ENV }), true);
  assert.equal(conferirLink(p as never, { agora: agora + 61, env: ENV }), false, "expirou");
  assert.equal(conferirLink({ ...p, id: "1OutroArquivoX" } as never, { agora, env: ENV }), false);
  assert.equal(conferirLink({ ...p, acao: "miniatura" } as never, { agora, env: ENV }), false);
  assert.equal(conferirLink({ ...p, sig: "x" } as never, { agora, env: ENV }), false);
});

// ── Origem do upload ────────────────────────────────────────────────────────

test("origem: só o próprio QS (mesmo host), a lista e localhost fora de produção", () => {
  assert.equal(origemPermitida("https://qs.exemplo.com.br", { host: "qs.exemplo.com.br", env: { VERCEL_ENV: "production" } }), "https://qs.exemplo.com.br");
  assert.equal(origemPermitida("https://qs.exemplo.com.br/mkt/drive?x=1", { host: "qs.exemplo.com.br", env: {} }), "https://qs.exemplo.com.br");
  assert.equal(origemPermitida("https://malvado.com", { host: "qs.exemplo.com.br", env: { VERCEL_ENV: "production" } }), null);
  assert.equal(origemPermitida("http://localhost:5180", { host: "x", env: { VERCEL_ENV: "production" } }), null);
  assert.equal(origemPermitida("http://localhost:5180", { host: "x", env: { VERCEL_ENV: "preview" } }), "http://localhost:5180");
  assert.equal(origemPermitida("https://outro.app", { host: "x", env: { VERCEL_ENV: "production", MKT_DRIVE_ORIGENS: "https://outro.app/, https://y.z" } }), "https://outro.app");
  assert.equal(origemPermitida("javascript:alert(1)", { host: "x", env: {} }), null);
});

// ── Limpeza e formato ───────────────────────────────────────────────────────

test("tags: minúsculas, sem #, sem repetir, no máximo 20", () => {
  assert.deepEqual(tagsLimpas(["#Japão", "japão", "  Reels  Bruno ", ""]), ["japão", "reels bruno"]);
  assert.deepEqual(tagsLimpas("a, b ,a"), ["a", "b"]);
  assert.equal(tagsLimpas(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 20);
});

test("nome: tira caractere de controle e corta em 250", () => {
  assert.equal(nomeLimpo(" vídeo\u0000\n final.mp4 "), "vídeo final.mp4");
  assert.equal(nomeLimpo("x".repeat(400)).length, 250);
});

test("arquivo do Drive → índice e → tela", () => {
  const f = {
    id: "1AbCdEfGhIjK", name: "Reels Japão.mp4", mimeType: "video/mp4", parents: ["1Pasta000000"], driveId: "0ABC",
    size: "123456789", createdTime: "2026-10-30T12:00:00.000Z", modifiedTime: "2026-10-30T13:00:00.000Z", hasThumbnail: true,
    webViewLink: "https://drive.google.com/file/d/1AbCdEfGhIjK/view", videoMediaMetadata: { durationMillis: "61000", width: 1080, height: 1920 },
  };
  const l = paraIndice(f, "0ABC");
  assert.equal(l.tipo, "video");
  assert.equal(l.tamanho, 123456789);
  assert.equal(l.duracao_ms, 61000);
  assert.equal(l.pasta_id, "1Pasta000000");
  assert.equal(l.removido, false);
  assert.equal("tags" in l, false, "a sincronização não sobrescreve as tags do QS");
  const t = paraTela(f);
  assert.equal(t.previewLink, "https://drive.google.com/file/d/1AbCdEfGhIjK/preview");
  assert.equal(t.duracaoMs, 61000);
  assert.equal(tipoDe("application/vnd.google-apps.folder"), "pasta");
  assert.equal(tipoDe("application/zip"), "outro");
});

test("miniatura no tamanho e id válido", () => {
  assert.equal(miniaturaNoTamanho("https://lh3.googleusercontent.com/drive-storage/abc=s220", 800), "https://lh3.googleusercontent.com/drive-storage/abc=s800");
  assert.equal(miniaturaNoTamanho("https://lh3.googleusercontent.com/abc=s220", 99999), "https://lh3.googleusercontent.com/abc=s1600");
  assert.equal(idValido("1AbCdEfGhIjK_-"), true);
  assert.equal(idValido("../etc"), false);
});

test("plano B do envio: só repassa pra sessão resumable do Drive (sem SSRF)", async () => {
  const { URL_SESSAO } = await import("../../api/mkt-drive.js");
  assert.equal(URL_SESSAO.test("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&upload_id=ADPycdu-abc_1"), true);
  assert.equal(URL_SESSAO.test("https://evil.com/upload/drive/v3/files?upload_id=x"), false);
  assert.equal(URL_SESSAO.test("https://www.googleapis.com.evil.com/upload/drive/v3/files?upload_id=x"), false);
  assert.equal(URL_SESSAO.test("https://www.googleapis.com/drive/v3/files?upload_id=x"), false);
  assert.equal(URL_SESSAO.test("http://www.googleapis.com/upload/drive/v3/files?upload_id=x"), false);
});
