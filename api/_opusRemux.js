// api/_opusRemux.js
// -----------------------------------------------------------------------------
// WEBM → OGG no SERVIDOR, sem recodificar o áudio.
//
// POR QUE ISSO EXISTE AQUI, se já existe igual no navegador (src/lib/qs/opusRemux.ts)
//
// A Cloud API da Meta não aceita `audio/webm` — a lista dela é aac, amr, mp3,
// m4a e ogg. O Chrome, que é o navegador do time, só grava webm pelo
// MediaRecorder. Em 18/08 a conversão foi feita no navegador e funcionava; ainda
// assim, entre 13h e 14h daquele dia, 7 de 9 áudios saíram `.weba` (webm) e a
// Meta recusou todos — as SDRs viram a bolha na tela e acharam que tinha ido.
//
// O motivo é banal e vai se repetir: a aba do QS fica aberta o dia inteiro, e
// uma aba velha continua rodando o código velho. Qualquer conserto que more só
// no navegador depende de todo mundo recarregar a página — o que ninguém faz no
// meio de um atendimento.
//
// Aqui não tem aba velha: o servidor é sempre a versão de agora. Este módulo é a
// GARANTIA; a conversão do navegador continua existindo só porque economiza
// upload (o ogg sai menor). Se ela funcionar, isto vê um ogg e não faz nada.
//
// Nenhuma amostra é tocada: os dois contêineres carregam o MESMO Opus, então é
// só trocar a embalagem. Validado contra um áudio real de 12,4 s que a Meta
// tinha recusado — o resultado decodifica inteiro e bate amostra por amostra
// com o original (diferença média 0,00).
// -----------------------------------------------------------------------------

/** Lê um inteiro de tamanho variável do EBML. Devolve valor e quantos bytes leu. */
function lerVint(b, pos, tirarMarcador) {
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
function amostrasDoPacote(pacote) {
  if (!pacote.length) return 960;
  const config = pacote[0] >> 3;
  const code = pacote[0] & 0b11;
  // Tabela do RFC 6716: a duração depende da configuração.
  let ms;
  if (config < 12) ms = [10, 20, 40, 60][config % 4];
  else if (config < 16) ms = [10, 20][config % 2];
  else ms = [2.5, 5, 10, 20][config % 4];
  let quadros = 1;
  if (code === 1 || code === 2) quadros = 2;
  else if (code === 3) quadros = pacote.length > 1 ? (pacote[1] & 0b00111111) || 1 : 1;
  return Math.round(ms * 48 * quadros);
}

/** Percorre o WebM e devolve os pacotes Opus, na ordem, além do OpusHead. */
function extrairOpus(b) {
  const pacotes = [];
  let cabecalho = null;

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
      if (dados.length >= 19 && Buffer.from(dados.subarray(0, 8)).toString('latin1') === 'OpusHead') {
        cabecalho = Uint8Array.prototype.slice.call(dados);
      }
    } else if (id.valor === SIMPLE_BLOCK || id.valor === BLOCK) {
      const trilha = lerVint(b, inicioDados, true);
      if (trilha) {
        // trilha + timecode (2 bytes) + flags (1 byte) → depois vem o frame.
        const dados = inicioDados + trilha.tam + 3;
        if (dados < fimDados) pacotes.push(Uint8Array.prototype.slice.call(b.subarray(dados, fimDados)));
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

function crcOgg(dados) {
  let crc = 0;
  for (let i = 0; i < dados.length; i++) crc = ((crc << 8) ^ TABELA_CRC[((crc >>> 24) & 0xff) ^ dados[i]]) >>> 0;
  return crc >>> 0;
}

function montarPagina(carga, tipo, granulo, serial, sequencia) {
  const tabela = [];
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

function opusHeadPadrao(canais = 1) {
  const h = new Uint8Array(19);
  h.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0);  // "OpusHead"
  h[8] = 1;                     // versão
  h[9] = canais;
  const dv = new DataView(h.buffer);
  dv.setUint16(10, 3840, true);             // pre-skip
  dv.setUint32(12, 48000, true);            // taxa original
  dv.setUint16(16, 0, true);                // ganho
  h[18] = 0;                                // mapping family
  return h;
}

function opusTags() {
  const fornecedor = Buffer.from('QS Turis', 'utf8');
  const t = new Uint8Array(8 + 4 + fornecedor.length + 4);
  t.set(Buffer.from('OpusTags', 'utf8'), 0);
  const dv = new DataView(t.buffer);
  dv.setUint32(8, fornecedor.length, true);
  t.set(fornecedor, 12);
  dv.setUint32(12 + fornecedor.length, 0, true);   // zero comentários
  return t;
}

/** Estes bytes são um contêiner WebM/Matroska? (assinatura EBML) */
export function ehWebm(bytes) {
  return bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

/**
 * Converte bytes WebM/Opus em OGG/Opus. Devolve `null` quando não dá — e aí quem
 * chama decide: pelo número comum dá pra seguir com o webm (a Evolution
 * converte com ffmpeg no meio do caminho), pelo oficial não dá.
 */
export function webmParaOggBytes(entrada) {
  try {
    const b = entrada instanceof Uint8Array ? entrada : new Uint8Array(entrada);
    const extraido = extrairOpus(b);
    if (!extraido) return null;

    // Serial fixo por arquivo, derivado do tamanho: não precisa ser aleatório
    // (é um fluxo só dentro do arquivo) e assim a saída é reproduzível, o que
    // torna qualquer investigação futura repetível.
    const serial = (0x51530000 ^ b.length) >>> 0;
    const paginas = [];
    let seq = 0;
    paginas.push(montarPagina([extraido.cabecalho ?? opusHeadPadrao()], 2, 0, serial, seq++));
    paginas.push(montarPagina([opusTags()], 0, 0, serial, seq++));

    // A página fecha pelo TAMANHO DA TABELA de segmentos (máx. 255 entradas),
    // não por contagem de pacotes: um pacote de N bytes ocupa ceil((N+1)/255)
    // entradas, então 50 pacotes grandes estourariam o byte de contagem e o
    // arquivo sairia corrompido.
    let granulo = 0;
    let lote = [];
    let entradas = 0;
    const fechar = (ultimo) => {
      if (!lote.length) return;
      paginas.push(montarPagina(lote, ultimo ? 4 : 0, granulo, serial, seq++));
      lote = []; entradas = 0;
    };
    for (let i = 0; i < extraido.pacotes.length; i++) {
      const p = extraido.pacotes[i];
      const precisa = Math.floor(p.length / 255) + 1;
      if (entradas + precisa > 255) fechar(false);
      lote.push(p);
      entradas += precisa;
      granulo += amostrasDoPacote(p);
      if (i === extraido.pacotes.length - 1) fechar(true);
    }
    return Buffer.concat(paginas.map((p) => Buffer.from(p.buffer, p.byteOffset, p.length)));
  } catch (e) {
    console.warn('[wa] remux webm→ogg falhou:', e?.message || e);
    return null;
  }
}
