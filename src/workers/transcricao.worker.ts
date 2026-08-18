// src/workers/transcricao.worker.ts
// -----------------------------------------------------------------------------
// TRANSCRIÇÃO DENTRO DO NAVEGADOR — sem API, sem servidor, sem custo por minuto.
//
// Decisão do Bruno (18/08): "não queria usar nenhuma API pra fazer transcrição".
// Então o Whisper roda AQUI, na máquina do SDR, via WebAssembly. O áudio não sai
// do computador dele em momento nenhum — o que também resolve a parte chata de
// mandar conversa de cliente pra um terceiro.
//
// POR QUE NUM WORKER: transcrever prende o processador por alguns segundos. Na
// thread da tela isso congela a conversa inteira — o SDR não conseguiria nem
// rolar a lista enquanto espera. Aqui, a tela continua viva.
//
// O MODELO é baixado uma vez (~80 MB, versão quantizada) e fica no cache do
// navegador; da segunda vez em diante começa na hora.
// -----------------------------------------------------------------------------

import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

/** Whisper "base": o equilíbrio entre caber no navegador e entender português.
 *  O "tiny" baixa mais rápido mas erra demais em PT; o "small" passa de 400 MB. */
const MODELO = 'onnx-community/whisper-base';

let transcritor: AutomaticSpeechRecognitionPipeline | null = null;

type Entrada =
  | { tipo: 'preparar' }
  | { tipo: 'transcrever'; id: string; audio: Float32Array };

async function carregar(avisar: (pct: number) => void) {
  if (transcritor) return transcritor;
  transcritor = await pipeline('automatic-speech-recognition', MODELO, {
    // q8 corta o tamanho do download pela metade sem estragar o resultado.
    dtype: 'q8',
    progress_callback: (p: { status?: string; progress?: number }) => {
      if (p?.status === 'progress' && typeof p.progress === 'number') avisar(Math.round(p.progress));
    },
  }) as AutomaticSpeechRecognitionPipeline;
  return transcritor;
}

self.addEventListener('message', async (ev: MessageEvent<Entrada>) => {
  const msg = ev.data;
  try {
    if (msg.tipo === 'preparar') {
      await carregar((pct) => self.postMessage({ tipo: 'baixando', pct }));
      self.postMessage({ tipo: 'pronto' });
      return;
    }
    if (msg.tipo === 'transcrever') {
      const t = await carregar((pct) => self.postMessage({ tipo: 'baixando', pct }));
      const saida = await t(msg.audio, {
        language: 'portuguese',
        task: 'transcribe',
        // Áudio de WhatsApp costuma passar de 30s — sem isto o Whisper corta.
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const texto = String((Array.isArray(saida) ? saida[0]?.text : saida?.text) || '').trim();
      self.postMessage({ tipo: 'texto', id: msg.id, texto });
    }
  } catch (e) {
    self.postMessage({ tipo: 'erro', id: (msg as { id?: string }).id, erro: String((e as Error)?.message || e) });
  }
});
