// Proposta anexada na venda (0295): as regras puras (src/venda/propostaAnexoRegras.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MSG_SEM_PROPOSTA, faltaProposta, problemaNoArquivo, tamanhoLegivel } from "../../src/venda/propostaAnexoRegras.ts";

test("sem proposta nenhuma, a venda não é registrada", () => {
  assert.equal(faltaProposta(0, 0), MSG_SEM_PROPOSTA);
  assert.equal(faltaProposta(1, 0), null, "já anexada no rascunho conta");
  assert.equal(faltaProposta(0, 2), null);
});

test("aceita PDF e foto até 15 MB; recusa o resto", () => {
  assert.equal(problemaNoArquivo({ name: "p.pdf", size: 1000, type: "application/pdf" }), null);
  assert.equal(problemaNoArquivo({ name: "p.jpg", size: 15 * 1024 * 1024, type: "image/jpeg" }), null);
  assert.match(problemaNoArquivo({ name: "g.pdf", size: 15 * 1024 * 1024 + 1, type: "application/pdf" })!, /15 MB/);
  assert.match(problemaNoArquivo({ name: "p.docx", size: 10, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })!, /PDF ou foto/);
});

test("tamanho legível", () => {
  assert.equal(tamanhoLegivel(2048), "2 KB");
  assert.equal(tamanhoLegivel(3 * 1024 * 1024), "3,0 MB");
  assert.equal(tamanhoLegivel(null), "");
});
