// src/mkt/automacoes/qr.ts
// QR Code gerado NO NAVEGADOR (qrcode-generator, MIT, sem dependências). O QR
// aponta pro link curto do QS (/e/<código>?q=1), que conta o clique e manda
// pro wa.me / ig.me — dá pra trocar o fluxo sem reimprimir o QR.
import qrcode from "qrcode-generator";

/** A matriz do QR (true = quadradinho preto). Correção M: aguenta ~15% de sujeira/dobra. */
export function matrizQr(texto: string): boolean[][] {
  const q = qrcode(0, "M");
  q.addData(texto, "Byte");
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

/** Um caminho SVG só (leve): "M x y h1 v1 h-1 z" por módulo escuro. */
export function caminhoQr(m: boolean[][], margem = 4): { d: string; lado: number } {
  const partes: string[] = [];
  m.forEach((linha, y) => linha.forEach((preto, x) => { if (preto) partes.push(`M${x + margem} ${y + margem}h1v1h-1z`); }));
  return { d: partes.join(""), lado: m.length + margem * 2 };
}

export function svgDoQr(texto: string): string {
  const { d, lado } = caminhoQr(matrizQr(texto));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges"><rect width="${lado}" height="${lado}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

function baixar(url: string, nome: string) {
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
}

export function baixarSvg(texto: string, nome: string) {
  const url = URL.createObjectURL(new Blob([svgDoQr(texto)], { type: "image/svg+xml" }));
  baixar(url, `${nome}.svg`);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** PNG de 1024 px (bom pra impressão pequena e pra post). */
export function baixarPng(texto: string, nome: string, px = 1024) {
  const m = matrizQr(texto);
  const margem = 4;
  const lado = m.length + margem * 2;
  const escala = Math.max(1, Math.floor(px / lado));
  const cv = document.createElement("canvas");
  cv.width = cv.height = lado * escala;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#000";
  m.forEach((linha, y) => linha.forEach((preto, x) => { if (preto) ctx.fillRect((x + margem) * escala, (y + margem) * escala, escala, escala); }));
  baixar(cv.toDataURL("image/png"), `${nome}.png`);
}
