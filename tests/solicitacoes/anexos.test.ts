// Central de Solicitações — ANEXOS (0316, 05/11/2026): regras puras de
// src/solicitacoes/anexos.ts (validação, nome/tamanho, caminho no bucket, prévia).
// Rodar: npx tsx --test tests/solicitacoes/anexos.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITE_ANEXO, MAX_ANEXOS_POR_VEZ, anexosPorEvento, extensaoDe, montarPath, nomeCurto, nomeDoPrint, pathDaMiniatura, podeApagarAnexo,
  progressoTotal, rotuloDoFormato, separarArquivos, tamanhoLegivel, textoAutomatico, tipoDePrevia, validarArquivo, type AnexoSol,
} from "../../src/solicitacoes/anexos.ts";

const SOL = "0b6f1c1e-2a3b-4c5d-8e9f-001122334455";

test("extensão", () => {
  assert.equal(extensaoDe("Foto.JPG"), "jpg");
  assert.equal(extensaoDe("relatorio.final.pdf"), "pdf");
  assert.equal(extensaoDe("sem-extensao"), "");
  assert.equal(extensaoDe("ponto.no.fim."), "");
});

test("validação: bloqueia executável, vazio e > 25 MB", () => {
  assert.equal(validarArquivo({ name: "orcamento.pdf", size: 1000 }), null);
  assert.equal(validarArquivo({ name: "print.png", size: LIMITE_ANEXO }), null, "exatamente 25 MB passa");
  assert.match(validarArquivo({ name: "grande.mp4", size: LIMITE_ANEXO + 1 })!, /25 MB/);
  for (const n of ["setup.exe", "rodar.BAT", "script.js", "x.ps1", "a.msi", "atalho.lnk", "x.vbs", "app.apk"]) {
    assert.match(validarArquivo({ name: n, size: 10 })!, /bloqueados/, n);
  }
  assert.match(validarArquivo({ name: "vazio.txt", size: 0 })!, /vazio/);
  // planilha, doc, zip e HEIC podem
  for (const n of ["a.xlsx", "b.docx", "c.zip", "d.csv", "e.heic"]) assert.equal(validarArquivo({ name: n, size: 10 }), null, n);
});

test("separar: recusa com motivo e respeita o teto por mensagem", () => {
  const r = separarArquivos([{ name: "a.pdf", size: 1 }, { name: "b.exe", size: 1 }, { name: "c.png", size: 1 }]);
  assert.deepEqual(r.ok.map((a) => a.name), ["a.pdf", "c.png"]);
  assert.equal(r.erros.length, 1);
  const cheio = separarArquivos([{ name: "x.pdf", size: 1 }, { name: "y.pdf", size: 1 }], MAX_ANEXOS_POR_VEZ - 1);
  assert.deepEqual(cheio.ok.map((a) => a.name), ["x.pdf"]);
  assert.match(cheio.erros[0], /No máximo/);
});

test("tamanho legível", () => {
  assert.equal(tamanhoLegivel(532), "532 B");
  assert.equal(tamanhoLegivel(14 * 1024), "14 KB");
  assert.equal(tamanhoLegivel(1.25 * 1024 * 1024), "1,3 MB");
  assert.equal(tamanhoLegivel(25 * 1024 * 1024), "25 MB");
  assert.equal(tamanhoLegivel(-1), "—");
});

test("nome curto mantém a extensão", () => {
  assert.equal(nomeCurto("curto.pdf"), "curto.pdf");
  const c = nomeCurto("relatorio-de-vendas-do-mes-de-outubro-final-v2.pdf", 24);
  assert.ok(c.endsWith("….pdf") && c.length <= 24, c);
});

test("caminho no bucket: começa pelo id do pedido, ASCII, sem o nome original", () => {
  const p = montarPath(SOL, "Orçamento Ação #1.PDF", { agora: 1762354800000, aleatorio: "ab12cd34" });
  assert.equal(p, `${SOL}/1762354800000-ab12cd34.pdf`);
  assert.equal(p.split("/")[0], SOL);
  assert.equal(montarPath(SOL, "sem-ext", { agora: 1, aleatorio: "x", mime: "image/png" }), `${SOL}/1-x.png`);
  assert.equal(montarPath(SOL, "sem-ext", { agora: 1, aleatorio: "x" }), `${SOL}/1-x.bin`);
  assert.equal(montarPath(SOL, "a.pdf", { agora: 1, aleatorio: "../" }), `${SOL}/1-x.pdf`, "nada de ../ no caminho");
  assert.equal(pathDaMiniatura(`${SOL}/1-x.jpg`), `${SOL}/1-x.mini.webp`);
});

test("print colado ganha nome com data", () => {
  const n = nomeDoPrint("image/png", new Date(2026, 10, 5, 9, 7, 3).getTime());
  assert.equal(n, "print-2026-11-05-090703.png");
});

test("tipo de prévia", () => {
  assert.equal(tipoDePrevia({ nome: "a.png", mime: "image/png" }), "imagem");
  assert.equal(tipoDePrevia({ nome: "a.JPG", mime: null }), "imagem");
  assert.equal(tipoDePrevia({ nome: "boleto.pdf", mime: "application/pdf" }), "pdf");
  assert.equal(tipoDePrevia({ nome: "foto.heic", mime: "image/heic" }), "outro", "HEIC o navegador não mostra");
  assert.equal(tipoDePrevia({ nome: "planilha.xlsx", mime: "application/vnd.ms-excel" }), "outro");
  assert.equal(rotuloDoFormato("planilha.xlsx"), "XLSX");
  assert.equal(rotuloDoFormato("sem"), "ARQ");
});

test("texto automático (igual ao do banco)", () => {
  assert.equal(textoAutomatico(["a.pdf"]), "anexou a.pdf");
  assert.equal(textoAutomatico(["a.pdf", "b.png"]), "anexou 2 arquivos: a.pdf, b.png");
});

test("anexos por mensagem, progresso e quem apaga", () => {
  const a = (id: string, ev: number | null, t: string) => ({ id, evento_id: ev, criado_em: t } as AnexoSol);
  const m = anexosPorEvento([a("2", 7, "2026-11-05T10:01:00Z"), a("1", 7, "2026-11-05T10:00:00Z"), a("3", null, "2026-11-05T10:02:00Z")]);
  assert.deepEqual(m.get(7)!.map((x) => x.id), ["1", "2"]);
  assert.equal(m.size, 1);
  assert.equal(progressoTotal([{ tamanho: 100, estado: "ok" }, { tamanho: 300, estado: "subindo", fracao: 0.5 }]), 63);
  assert.equal(progressoTotal([]), 0);
  assert.equal(podeApagarAnexo({ enviado_por: "eu" }, "eu", false), true);
  assert.equal(podeApagarAnexo({ enviado_por: "outro" }, "eu", false), false);
  assert.equal(podeApagarAnexo({ enviado_por: "outro" }, "eu", true), true);
});
