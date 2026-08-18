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

/**
 * Whisper "small". O "base" foi medido em 18/08 num áudio real de cliente e
 * devolveu texto inutilizável — "Hoje eu vou ser feliz a disponibilidade para já
 * conseguir te repassar para nossa espécie à lista" — enquanto o "small", no
 * MESMO áudio, devolveu a frase certa: "Hoje você terá disponibilidade para já
 * conseguir te repassar para o nosso especialista para ele conseguir te passar
 * os valores e condições de pagamento". Transcrição errada é pior que nenhuma:
 * o SDR lê, acredita e responde fora do assunto.
 */
const MODELO = 'onnx-community/whisper-small';

/**
 * A PRECISÃO DE CADA METADE — e por que não é uma coisa só.
 *
 * Com `dtype: 'q8'` (como estava até 18/08) o modelo BAIXAVA INTEIRO e só então
 * explodia, sempre, em qualquer navegador:
 *
 *   Can't create a session. ERROR_CODE: 1 — qdq_actions.cc:137
 *   TransposeDQWeightsForMatMulNBits Missing required scale:
 *   model.decoder.embed_tokens.weight_merged_0_scale
 *
 * É o otimizador do onnxruntime-web tropeçando no DECODIFICADOR quantizado em 8
 * bits. Reproduzido no Chrome com os dois repositórios (onnx-community e
 * Xenova), o que descarta "modelo ruim" — e some com o decodificador em q4.
 * Em Node o mesmo q8 funciona, porque lá o runtime é outro; por isso o defeito
 * só aparecia na máquina do SDR. Foi a razão de 208 áudios e ZERO transcrições.
 *
 * O codificador segue em q8 (92 MB em vez de 352 MB) — ele não passa pelo
 * caminho que quebra, e a qualidade medida no áudio real ficou igual.
 */
const PRECISAO = { encoder_model: 'q8', decoder_model_merged: 'q4' } as const;

let transcritor: AutomaticSpeechRecognitionPipeline | null = null;

type Entrada =
  | { tipo: 'preparar' }
  | { tipo: 'transcrever'; id: string; audio: Float32Array };

/** Uma carga só por aba, mesmo com dois cliques ao mesmo tempo. */
let carregando: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

async function carregar(avisar: (pct: number) => void) {
  if (transcritor) return transcritor;
  if (carregando) return carregando;

  // PROGRESSO SOMADO, e não por arquivo. O modelo vem em vários arquivos que
  // baixam ao mesmo tempo, e cada um conta o SEU progresso de 0 a 100. Repassar
  // isso cru fazia a tela mostrar "37%… 100%… 0%… 2%…" — quem está esperando lê
  // como travado e desiste. Aqui guardamos quanto já veio de cada arquivo e
  // mostramos a fração do TOTAL, que só anda pra frente.
  const baixado = new Map<string, number>();
  const tamanho = new Map<string, number>();
  // E o número nunca volta atrás. Mesmo somando, o total só é conhecido aos
  // poucos: quando um arquivo novo entra na conta, o denominador cresce e a
  // fração cai. Um "68%… 41%" faz quem espera achar que algo deu errado e
  // recarregar a página — o que joga fora o download já feito.
  let maior = 0;

  carregando = pipeline('automatic-speech-recognition', MODELO, {
    dtype: PRECISAO,
    progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (p?.status !== 'progress' || !p.file || !p.total) return;
      baixado.set(p.file, p.loaded ?? 0);
      tamanho.set(p.file, p.total);
      let feito = 0, tudo = 0;
      for (const [f, t] of tamanho) { tudo += t; feito += baixado.get(f) ?? 0; }
      if (tudo <= 0) return;
      const pct = Math.min(99, Math.round((feito / tudo) * 100));
      if (pct > maior) { maior = pct; avisar(pct); }
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;

  try {
    transcritor = await carregando;
    avisar(100);
    return transcritor;
  } finally {
    carregando = null;
  }
}

/**
 * FILA DE VERDADE — um áudio por vez.
 *
 * O ouvinte de mensagens é `async`, então dois pedidos que chegam juntos
 * começariam a rodar ao mesmo tempo no MESMO pipeline. O Whisper aqui não é
 * reentrante (o estado de geração é compartilhado), e o resultado seria texto
 * embaralhado entre dois áudios — o pior tipo de defeito, porque o texto sai
 * plausível e ninguém desconfia. Encadear as promessas custa uma linha e tira
 * essa possibilidade do mapa.
 */
let fila: Promise<unknown> = Promise.resolve();

self.addEventListener('message', (ev: MessageEvent<Entrada>) => {
  const msg = ev.data;
  fila = fila.then(async () => {
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
});
