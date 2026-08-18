// api/_transcrever.js
// -----------------------------------------------------------------------------
// ÁUDIO VIRA TEXTO — nos dois sentidos que o Bruno pediu (18/08):
//   • o áudio que o CLIENTE mandou, pro SDR ler em vez de ouvir (áudio é de
//     longe o anexo mais comum: 342 de 400 numa amostra);
//   • o áudio que o SDR acabou de gravar, pra ele mandar o texto junto ou no
//     lugar do áudio.
//
// Usa a API de transcrição no padrão OpenAI (`/audio/transcriptions`), que é o
// mesmo formato do Whisper na OpenAI e na Groq — trocar de fornecedor é trocar
// duas variáveis, sem mexer no código.
//
// DESLIGADO POR PADRÃO: sem `TRANSCRICAO_API_KEY` a função devolve
// `nao-configurado` e a tela some com o botão. Ninguém vê algo que só daria erro.
//
// Envs:
//   TRANSCRICAO_API_KEY   obrigatória pra ligar
//   TRANSCRICAO_URL       opcional (padrão: OpenAI)
//   TRANSCRICAO_MODELO    opcional (padrão: whisper-1)
// -----------------------------------------------------------------------------

const PADRAO_URL = 'https://api.openai.com/v1/audio/transcriptions';
const PADRAO_MODELO = 'whisper-1';
/** Teto de segurança: 20 MB é o limite prático do serviço e da nossa função. */
const MAX_BYTES = 20 * 1024 * 1024;

export function transcricaoLigada() {
  return !!String(process.env.TRANSCRICAO_API_KEY || '').trim();
}

/**
 * Baixa o áudio e devolve o texto falado.
 * Sempre resolve — nunca lança: transcrição é conforto, não pode derrubar tela.
 */
export async function transcreverDeUrl(url, { idioma = 'pt' } = {}) {
  const chave = String(process.env.TRANSCRICAO_API_KEY || '').trim();
  if (!chave) return { erro: 'nao-configurado' };
  if (!url) return { erro: 'sem-audio' };

  try {
    // 1) Traz o arquivo (o áudio mora no Chatwoot, atrás de uma URL assinada).
    const resposta = await fetch(url, { redirect: 'follow' });
    if (!resposta.ok) return { erro: 'audio-inacessivel' };
    const arquivo = await resposta.arrayBuffer();
    if (arquivo.byteLength > MAX_BYTES) return { erro: 'audio-muito-grande' };

    const tipo = resposta.headers.get('content-type') || 'audio/ogg';
    // Extensão coerente com o tipo: o serviço recusa nome sem extensão conhecida.
    const ext = tipo.includes('mpeg') ? 'mp3'
      : tipo.includes('mp4') || tipo.includes('m4a') ? 'm4a'
      : tipo.includes('wav') ? 'wav'
      : tipo.includes('webm') ? 'webm'
      : 'ogg';

    // 2) Manda pro serviço de transcrição.
    const form = new FormData();
    form.append('file', new Blob([arquivo], { type: tipo }), `audio.${ext}`);
    form.append('model', String(process.env.TRANSCRICAO_MODELO || PADRAO_MODELO));
    if (idioma) form.append('language', idioma);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45_000);
    try {
      const r = await fetch(String(process.env.TRANSCRICAO_URL || PADRAO_URL), {
        method: 'POST',
        headers: { Authorization: `Bearer ${chave}` },
        body: form,
        signal: ctrl.signal,
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        console.warn('[transcrever] serviço recusou:', r.status, JSON.stringify(j).slice(0, 160));
        return { erro: 'servico-recusou', detalhe: j?.error?.message };
      }
      const texto = String(j?.text || '').trim();
      return texto ? { texto } : { erro: 'sem-fala' };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.warn('[transcrever]', e?.name === 'AbortError' ? 'demorou demais' : e?.message);
    return { erro: e?.name === 'AbortError' ? 'demorou' : 'falhou' };
  }
}

/** Mensagem pro usuário — o SDR não deve ver código de erro. */
export function motivoDaFalha(erro) {
  return {
    'nao-configurado': 'A transcrição ainda não está ligada. Configure a chave em TRANSCRICAO_API_KEY.',
    'sem-audio': 'Esta mensagem não tem áudio.',
    'audio-inacessivel': 'Não consegui baixar o áudio.',
    'audio-muito-grande': 'Áudio grande demais para transcrever.',
    'sem-fala': 'Não identifiquei fala neste áudio.',
    'demorou': 'A transcrição demorou demais. Tente de novo.',
    'servico-recusou': 'O serviço de transcrição recusou o áudio.',
  }[erro] || 'Não consegui transcrever agora.';
}
