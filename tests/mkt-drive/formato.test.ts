// Formatação e montagem da busca da tela do Drive (0241).
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/mkt-drive/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { corpoBusca, formatarDuracao, formatarTamanho, temFiltro, tocaNoNavegador } from "../../src/mkt/drive/formato.ts";
import { FILTROS_VAZIOS, paraArquivoDrive } from "../../src/mkt/drive/tipos.ts";

test("tamanho legível", () => {
  assert.equal(formatarTamanho(undefined), "—");
  assert.equal(formatarTamanho(500), "500 B");
  assert.equal(formatarTamanho(1536), "1,5 KB");
  assert.equal(formatarTamanho(1024 ** 3 * 2.25), "2,3 GB");
});

test("duração m:ss e h:mm:ss", () => {
  assert.equal(formatarDuracao(61_000), "1:01");
  assert.equal(formatarDuracao(3_725_000), "1:02:05");
  assert.equal(formatarDuracao(0), "");
});

test("filtro ligado ou não", () => {
  assert.equal(temFiltro(FILTROS_VAZIOS), false);
  assert.equal(temFiltro({ ...FILTROS_VAZIOS, texto: "  " }), false);
  assert.equal(temFiltro({ ...FILTROS_VAZIOS, tags: ["reels"] }), true);
  assert.equal(temFiltro({ ...FILTROS_VAZIOS, soNestaPasta: true }), false, "só a caixinha não vira busca");
});

test("corpo da busca no índice: só manda o que tem, pasta só com a caixinha, paginação por offset", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(corpoBusca({ ...FILTROS_VAZIOS, texto: " japão " }, "1Pasta000000"))), { acao: "buscar_indice", texto: "japão", offset: 0 });
  const c = corpoBusca({ ...FILTROS_VAZIOS, tipo: "video", tags: ["a"], soNestaPasta: true, desde: "2026-10-01" }, "1Pasta000000", 50);
  assert.equal(c.pastaId, "1Pasta000000");
  assert.equal(c.offset, 50);
  assert.deepEqual(c.tags, ["a"]);
  assert.equal(c.desde, "2026-10-01");
});

test("player: mp4/webm/mov e áudio tocam; mkv/avi vão pra visualização do Drive", () => {
  assert.equal(tocaNoNavegador("video/mp4"), true);
  assert.equal(tocaNoNavegador("video/quicktime"), true);
  assert.equal(tocaNoNavegador("audio/mpeg"), true);
  assert.equal(tocaNoNavegador("video/x-matroska"), false);
});

test("DrivePicker devolve o contrato ArquivoDrive", () => {
  const a = paraArquivoDrive({
    id: "1AbCdEfGhIjK", nome: "x.mp4", mimeType: "video/mp4", tipo: "video", pastaId: null, webViewLink: "https://drive.google.com/file/d/1AbCdEfGhIjK/view",
    previewLink: "", temMiniatura: true, miniaturaUrl: "/api/mkt-drive?acao=miniatura", midiaUrl: null, tamanho: 10, criadoEm: null, modificadoEm: null,
    modificadoPor: null, naLixeira: false, tags: [], destino: null, expedicaoId: null, observacao: null, subidoPor: null,
  });
  assert.deepEqual(a, { id: "1AbCdEfGhIjK", nome: "x.mp4", mimeType: "video/mp4", webViewLink: "https://drive.google.com/file/d/1AbCdEfGhIjK/view", thumbnailLink: "/api/mkt-drive?acao=miniatura", tamanho: 10 });
});
