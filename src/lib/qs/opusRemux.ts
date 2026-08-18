// src/lib/qs/opusRemux.ts
// -----------------------------------------------------------------------------
// WEBM → OGG, sem recodificar o áudio.
//
// POR QUE ISSO EXISTE (medido em 18/08): a Cloud API da Meta recusa `audio/webm`
// — a lista dela é aac, amr, mp3, m4a e ogg (este último "OPUS codecs only,
// mono"). O Chrome, que é o navegador do time, só grava `audio/webm;codecs=opus`
// pelo MediaRecorder. Resultado: todo áudio enviado pelo número oficial voltava
// com "131053: Media upload error" e o SDR achava que a API não manda áudio.
// Pelo número comum funcionava porque a Evolution converte com ffmpeg no meio do
// caminho; a Meta não converte nada.
//
// A SAÍDA: os dois contêineres carregam o MESMO áudio Opus. Então não é preciso
// recodificar (nem ffmpeg, nem wasm, nem servidor) — basta tirar os pacotes Opus
// de dentro do WebM e reempacotá-los num OGG. É rápido, roda no navegador e não
// perde qualidade, porque nenhuma amostra é tocada.
//
// Se qualquer coisa aqui falhar, quem chama manda o arquivo original: pior caso
// é continuar como estava, nunca ficar sem enviar.
// -----------------------------------------------------------------------------

/** Lê um inteiro de tamanho variável do EBML. Devolve valor e quantos bytes leu. */
function lerVint(b: Uint8Array, pos: number, tirarMarcador: boolean): { valor: number; tam: number } | null {
  if (pos >= b.length) return null;
  const primeiro = b[pos];
  if (primeiro === 0) return null;
  let tam = 1;
  for (let mascara = 0x80; mascara > 0 && !(primeiro & mascara); mascara >>= 1) tam++;
  if (tam > 8 || pos + tam > b.length) return null;
  let valor = tirarMarcador ? primeiro & ((1 << (8 - tam)) - 1) : primeiro;
  for (let i = 1; i < tam; i++) valor = valor * 256 + b[pos + i];
  return { valor, tam };
}

/** Quantas amostras (a 48 kHz) o pacote Opus carrega — lido do byte TOC. */
function amostrasDoPacote(pacote: Uint8Array): number {
  if (!pacote.length) return 960;
  const config = pacote[0] >> 3;
  const code = pacote[0] & 0b11;
  // Tabela do RFC 6716: a duração depende da configuração.
  let ms: number;
  if (config < 12) ms = [10, 20, 40, 60][config % 4];
  else if (config < 16) ms = [10, 20][config % 2];
  else ms = [2.5, 5, 10, 20][config % 4];
  let quadros = 1;
  if (code === 1 || code === 2) quadros = 2;
  else if (code === 3) quadros = pacote.length > 1 ? (pacote[1] & 0b00111111) || 1 : 1;
  return Math.round(ms * 48 * quadros);
}

/** Percorre o WebM e devolve os pacotes Opus, na ordem, além do OpusHead. */
function extrairOpus(buf: ArrayBuffer): { pacotes: Uint8Array[]; cabecalho: Uint8Array | null } | null {
  const b = new Uint8Array(buf);
  const pacotes: Uint8Array[] = [];
  let cabecalho: Uint8Array | null = null;

  // IDs que precisamos entrar (mestres) e os que carregam dados.
  const MESTRES = new Set([0x18538067, 0x1f43b675, 0x1654ae6b, 0xae, 0xe0]); // Segment, Cluster, Tracks, TrackEntry, Audio
  const CODEC_PRIVATE = 0x63a2;
  const SIMPLE_BLOCK = 0xa3;
  const BLOCK = 0xa1;

  let pos = 0;
  const fim = b.length;
  let guarda = 0;
  while (pos < fim && guarda++ < 2_000_000) {
    const id = lerVint(b, pos, false);
    if (!id) break;
    const tamanho = lerVint(b, pos + id.tam, true);
    if (!tamanho) break;
    const inicioDados = pos + id.tam + tamanho.tam;
    // Tamanho "desconhecido" (todos os bits em 1) acontece em stream: entra assim mesmo.
    const desconhecido = tamanho.valor >= Number.MAX_SAFE_INTEGER / 2;
    const fimDados = desconhecido ? fim : Math.min(inicioDados + tamanho.valor, fim);

    if (MESTRES.has(id.valor)) {
      pos = inicioDados;               // entra no elemento
      continue;
    }
    if (id.valor === CODEC_PRIVATE && !cabecalho) {
      const dados = b.subarray(inicioDados, fimDados);
      // O CodecPrivate do Opus É o OpusHead.
      if (dados.length >= 19 && String.fromCharCode(...dados.subarray(0, 8)) === 'OpusHead') {
        cabecalho = dados.slice();
      }
    } else if (id.valor === SIMPLE_BLOCK || id.valor === BLOCK) {
      const trilha = lerVint(b, inicioDados, true);
      if (trilha) {
        // trilha + timecode (2 bytes) + flags (1 byte) → depois vem o frame.
        const dados = inicioDados + trilha.tam + 3;
        if (dados < fimDados) pacotes.push(b.subarray(dados, fimDados).slice());
      }
    }
    pos = fimDados;
  }
  return pacotes.length ? { pacotes, cabecalho } : null;
}

// ── Escrita do OGG ──────────────────────────────────────────────────────────

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    t[i] = r >>> 0;
  }
  return t;
})();

function crcOgg(dados: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < dados.length; i++) crc = ((crc << 8) ^ TABELA_CRC[((crc >>> 24) & 0xff) ^ dados[i]]) >>> 0;
  return crc >>> 0;
}

function montarPagina(carga: Uint8Array[], tipo: number, granulo: number, serial: number, sequencia: number): Uint8Array {
  const tabela: number[] = [];
  for (const p of carga) {
    let resta = p.length;
    while (resta >= 255) { tabela.push(255); resta -= 255; }
    tabela.push(resta);
  }
  const corpo = carga.reduce((n, p) => n + p.length, 0);
  const pagina = new Uint8Array(27 + tabela.length + corpo);
  const dv = new DataView(pagina.buffer);
  pagina.set([0x4f, 0x67, 0x67, 0x53], 0);            // "OggS"
  pagina[4] = 0;                                       // versão
  pagina[5] = tipo;                                    // 2=BOS, 4=EOS, 0=normal
  // granule position (64 bits little-endian)
  dv.setUint32(6, granulo >>> 0, true);
  dv.setUint32(10, Math.floor(granulo / 4294967296), true);
  dv.setUint32(14, serial, true);
  dv.setUint32(18, sequencia, true);
  dv.setUint32(22, 0, true);                           // CRC entra depois
  pagina[26] = tabela.length;
  pagina.set(tabela, 27);
  let off = 27 + tabela.length;
  for (const p of carga) { pagina.set(p, off); off += p.length; }
  dv.setUint32(22, crcOgg(pagina), true);
  return pagina;
}

function opusHeadPadrao(canais = 1): Uint8Array {
  const h = new Uint8Array(19);
  h.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0);  // "OpusHead"
  h[8] = 1;                     // versão
  h[9] = canais;
  new DataView(h.buffer).setUint16(10, 3840, true);             // pre-skip
  new DataView(h.buffer).setUint32(12, 48000, true);            // taxa original
  new DataView(h.buffer).setUint16(16, 0, true);                // ganho
  h[18] = 0;                                                    // mapping family
  return h;
}

function opusTags(): Uint8Array {
  const fornecedor = new TextEncoder().encode('QS Turis');
  const t = new Uint8Array(8 + 4 + fornecedor.length + 4);
  t.set(new TextEncoder().encode('OpusTags'), 0);
  const dv = new DataView(t.buffer);
  dv.setUint32(8, fornecedor.length, true);
  t.set(fornecedor, 12);
  dv.setUint32(12 + fornecedor.length, 0, true);   // zero comentários
  return t;
}

/**
 * Converte um Blob WebM/Opus em OGG/Opus. Devolve `null` quando não dá — e aí
 * quem chama segue com o arquivo original, que é o comportamento de antes.
 */
export async function webmParaOgg(blob: Blob): Promise<Blob | null> {
  try {
    const extraido = extrairOpus(await blob.arrayBuffer());
    if (!extraido) return null;

    const serial = Math.floor(Math.random() * 0xffffffff) >>> 0;
    const paginas: Uint8Array[] = [];
    let seq = 0;
    paginas.push(montarPagina([extraido.cabecalho ?? opusHeadPadrao()], 2, 0, serial, seq++));
    paginas.push(montarPagina([opusTags()], 0, 0, serial, seq++));

    // Os pacotes vão em páginas de até 50 — o suficiente pra não estourar a
    // tabela de segmentos (255) e manter o arquivo bem formado.
    let granulo = 0;
    for (let i = 0; i < extraido.pacotes.length; i += 50) {
      const lote = extraido.pacotes.slice(i, i + 50);
      for (const p of lote) granulo += amostrasDoPacote(p);
      const ultimo = i + 50 >= extraido.pacotes.length;
      paginas.push(montarPagina(lote, ultimo ? 4 : 0, granulo, serial, seq++));
    }
    return new Blob(paginas as BlobPart[], { type: 'audio/ogg' });
  } catch (e) {
    console.warn('[wa] não consegui converter o áudio para ogg:', e);
    return null;
  }
}
