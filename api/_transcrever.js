// api/_transcrever.js
// -----------------------------------------------------------------------------
// ÁUDIO QUE ENTRA VIRA TEXTO, NO SERVIDOR.
//
// O problema, medido em 25/08: 9 áudios entraram em 7 dias e NENHUM tinha
// transcrição. A Glória ignorava todos (`sem_texto`, em api/_gloria.js) e o SDR
// precisava ouvir um por um pra saber o que o cliente queria.
//
// Já existia uma transcrição no QS, mas ela roda no NAVEGADOR do SDR
// (`src/lib/qs/transcricaoLocal.ts`) e nunca funcionou de verdade: o
// decodificador quantizado quebra no browser, e mesmo quando roda é uma vez por
// pessoa que abre a conversa, sem guardar nada. Aqui é o contrário: roda uma vez
// só, no servidor, e o resultado fica gravado pra todo mundo.
//
// DUAS REGRAS QUE MANTÊM ISTO SEGURO NO CAMINHO DO WEBHOOK:
//
// 1. TEM ORÇAMENTO DE TEMPO. O webhook do WhatsApp tem 30s no total e ele NÃO
//    pode estourar: mensagem que não entra no QS é pior que áudio sem
//    transcrição. Por isso o teto agressivo aqui e o corte por tamanho antes de
//    baixar qualquer coisa.
// 2. FALHAR É NORMAL, e o comportamento de quando falha é EXATAMENTE o de
//    antes: sem texto, a Glória não responde e a conversa fica com o humano.
//    Nada aqui pode derrubar a gravação da mensagem.
//
// Env: OPENAI_API_KEY (chave própria, separada da que vive no n8n — assim dá
// pra ver o gasto da transcrição sozinho e uma não derruba a outra).
// -----------------------------------------------------------------------------

import { ehWebm, webmParaOggBytes } from './_opusRemux.js';

const URL_OPENAI = 'https://api.openai.com/v1/audio/transcriptions';

// whisper-1 aceita até 25 MB. Cortamos antes disso: áudio de WhatsApp passa
// longe deste tamanho, e o que passar é coisa que não cabe no orçamento de
// tempo do webhook de qualquer jeito.
const TETO_BYTES = 12 * 1024 * 1024;

// O orçamento inteiro (baixar + transcrever). O webhook tem 30s e ainda precisa
// gravar a mensagem, avisar a Glória e responder ao Chatwoot.
const TETO_MS = 14_000;

export function transcricaoConfigurada() {
  return !!String(process.env.OPENAI_API_KEY || '').trim();
}

/**
 * A URL do áudio desta mensagem, se houver.
 *
 * O Chatwoot manda `file_type: 'audio'`, mas nem sempre: quando o canal não
 * classifica, vem 'file' com a extensão na URL. Por isso o segundo teste.
 */
export function audioDaMensagem(message) {
  const lista = Array.isArray(message?.attachments) ? message.attachments : [];
  for (const a of lista) {
    const url = a?.data_url || a?.url || null;
    if (!url) continue;
    const tipo = String(a.file_type || '').toLowerCase();
    if (tipo === 'audio' || /\.(ogg|opus|mp3|m4a|wav|webm|amr)(\?|$)/i.test(String(url))) {
      return url;
    }
  }
  return null;
}

/**
 * Baixa e transcreve. Devolve `{ texto }` ou `{ erro }`, nunca lança.
 *
 * O `language: 'pt'` não é detalhe: sem ele o Whisper às vezes "detecta"
 * espanhol num áudio curto de português e devolve uma tradução aproximada, que
 * é pior que não transcrever, porque parece certo.
 */
export async function transcrever(url) {
  const chave = String(process.env.OPENAI_API_KEY || '').trim();
  if (!chave) return { erro: 'sem_openai_key' };
  if (!url) return { erro: 'sem_url' };

  const ctrl = new AbortController();
  const prazo = setTimeout(() => ctrl.abort(), TETO_MS);

  try {
    const baixado = await fetch(url, { signal: ctrl.signal });
    if (!baixado.ok) return { erro: `download HTTP ${baixado.status}` };

    const tamanho = Number(baixado.headers.get('content-length') || 0);
    if (tamanho && tamanho > TETO_BYTES) return { erro: `áudio grande demais (${Math.round(tamanho / 1024 / 1024)} MB)` };

    let bytes = new Uint8Array(await baixado.arrayBuffer());
    if (bytes.length > TETO_BYTES) return { erro: 'áudio grande demais' };
    if (!bytes.length) return { erro: 'áudio vazio' };

    // WebM: o mesmo remux que o envio já usa. O Whisper até aceita webm, mas o
    // que o Chatwoot guarda às vezes é um webm sem cabeçalho de duração, e aí a
    // API recusa. Converter é barato e tira essa classe de erro do caminho.
    let nome = 'audio.ogg';
    if (ehWebm(bytes)) {
      const ogg = webmParaOggBytes(bytes);
      if (ogg) bytes = ogg instanceof Uint8Array ? ogg : new Uint8Array(ogg);
      else nome = 'audio.webm';
    }

    const form = new FormData();
    form.append('file', new Blob([bytes]), nome);
    form.append('model', 'whisper-1');
    form.append('language', 'pt');

    const r = await fetch(URL_OPENAI, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}` },
      body: form,
      signal: ctrl.signal,
    });

    const corpo = await r.text();
    if (!r.ok) {
      // 401 aqui é chave errada ou não redeployada. Dizer isso por extenso
      // economiza a caçada que a credencial do n8n já custou duas vezes.
      const dica = r.status === 401
        ? ' (OPENAI_API_KEY errada, ou o deploy ainda está com a env antiga)'
        : '';
      return { erro: `OpenAI HTTP ${r.status}${dica}: ${corpo.slice(0, 160)}` };
    }

    let texto = '';
    try { texto = String(JSON.parse(corpo)?.text || '').trim(); } catch { texto = corpo.trim(); }
    if (!texto) return { erro: 'transcrição vazia' };
    return { texto };
  } catch (e) {
    return { erro: e?.name === 'AbortError' ? `não coube em ${TETO_MS}ms` : (e?.message || 'falha') };
  } finally {
    clearTimeout(prazo);
  }
}
