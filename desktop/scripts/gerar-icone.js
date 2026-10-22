// Gera o ícone da Bolinha do QS (círculo azul #0147FF com "QS" branco) SEM
// nenhuma dependência: desenha os pixels na mão, codifica PNG com o zlib do
// Node e monta o .ico embutindo PNGs (formato aceito desde o Windows Vista).
// Por quê na mão: evita baixar lib de imagem só pra um ícone simples, e o
// script roda igual em qualquer máquina. Rode com `npm run icone`.
// Saída: assets/icon.png (512), assets/icon.ico (16→256) e assets/tray.png (32).
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const AZUL = [0x01, 0x47, 0xff];
const BRANCO = [0xff, 0xff, 0xff];
const SUPER = 4; // supersampling 4x4 = bordas suaves

// --- formas (coordenadas normalizadas 0..1, y pra baixo) ---------------------
function dentroDoAnel(x, y, cx, cy, rFora, espessura) {
  const d = Math.hypot(x - cx, y - cy);
  return d <= rFora && d >= rFora - espessura;
}
function angulo(x, y, cx, cy) {
  return (Math.atan2(y - cy, x - cx) * 180) / Math.PI; // 0 = direita, 90 = baixo
}
function pertoDoSegmento(x, y, x1, y1, x2, y2, meiaEspessura) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= meiaEspessura;
}

const T = 0.055; // espessura do traço das letras
function letraQ(x, y) {
  const cx = 0.355, cy = 0.5, r = 0.16;
  if (dentroDoAnel(x, y, cx, cy, r, T)) return true;
  return pertoDoSegmento(x, y, cx + 0.05, cy + 0.06, cx + 0.15, cy + 0.17, T / 2);
}
function letraS(x, y) {
  const cx = 0.665, r = 0.068, cyCima = 0.5 - r, cyBaixo = 0.5 + r; // r = raio da linha do meio
  const rf = r + T / 2;
  if (dentroDoAnel(x, y, cx, cyCima, rf, T)) {
    const a = angulo(x, y, cx, cyCima);
    if (!(a > -35 && a < 90)) return true; // arco de cima: tira o lado direito-baixo
  }
  if (dentroDoAnel(x, y, cx, cyBaixo, rf, T)) {
    const a = angulo(x, y, cx, cyBaixo);
    if (a >= -90 && a <= 145) return true; // arco de baixo: espelhado
  }
  return false;
}

function desenhar(tam) {
  const px = Buffer.alloc(tam * tam * 4);
  for (let py = 0; py < tam; py++) {
    for (let pxl = 0; pxl < tam; pxl++) {
      let cobreCirculo = 0, cobreLetra = 0;
      for (let sy = 0; sy < SUPER; sy++) {
        for (let sx = 0; sx < SUPER; sx++) {
          const x = (pxl + (sx + 0.5) / SUPER) / tam;
          const y = (py + (sy + 0.5) / SUPER) / tam;
          if (Math.hypot(x - 0.5, y - 0.5) <= 0.5) {
            cobreCirculo++;
            if (letraQ(x, y) || letraS(x, y)) cobreLetra++;
          }
        }
      }
      const n = SUPER * SUPER;
      const a = cobreCirculo / n;
      const mistura = cobreCirculo ? cobreLetra / cobreCirculo : 0;
      const i = (py * tam + pxl) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(AZUL[c] * (1 - mistura) + BRANCO[c] * mistura);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

// --- PNG ----------------------------------------------------------------------
const TABELA_CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloco(tipo, dados) {
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length);
  const td = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([tam, td, crc]);
}
function png(tam) {
  const rgba = desenhar(tam);
  const linhas = Buffer.alloc(tam * (tam * 4 + 1));
  for (let y = 0; y < tam; y++) {
    linhas[y * (tam * 4 + 1)] = 0; // filtro "nenhum"
    rgba.copy(linhas, y * (tam * 4 + 1) + 1, y * tam * 4, (y + 1) * tam * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0);
  ihdr.writeUInt32BE(tam, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr),
    bloco("IDAT", zlib.deflateSync(linhas, { level: 9 })),
    bloco("IEND", Buffer.alloc(0)),
  ]);
}

// --- ICO (com PNGs dentro) ----------------------------------------------------
function ico(tamanhos) {
  const imagens = tamanhos.map(png);
  const cab = Buffer.alloc(6);
  cab.writeUInt16LE(0, 0);
  cab.writeUInt16LE(1, 2); // tipo: ícone
  cab.writeUInt16LE(tamanhos.length, 4);
  let deslocamento = 6 + 16 * tamanhos.length;
  const entradas = tamanhos.map((t, i) => {
    const e = Buffer.alloc(16);
    e[0] = t >= 256 ? 0 : t; // 0 = 256
    e[1] = t >= 256 ? 0 : t;
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por pixel
    e.writeUInt32LE(imagens[i].length, 8);
    e.writeUInt32LE(deslocamento, 12);
    deslocamento += imagens[i].length;
    return e;
  });
  return Buffer.concat([cab, ...entradas, ...imagens]);
}

const pasta = path.join(__dirname, "..", "assets");
fs.mkdirSync(pasta, { recursive: true });
fs.writeFileSync(path.join(pasta, "icon.png"), png(512));
fs.writeFileSync(path.join(pasta, "tray.png"), png(32));
fs.writeFileSync(path.join(pasta, "icon.ico"), ico([16, 24, 32, 48, 64, 128, 256]));
console.log("Ícones gerados em", pasta);
