// src/lib/qs/transcricaoLocal.ts
// -----------------------------------------------------------------------------
// A ponte entre a conversa e o worker que transcreve — e a preparação do áudio.
//
// O Whisper quer um sinal cru: mono, 16 kHz, amostras entre -1 e 1. O que chega
// do WhatsApp é um arquivo comprimido (ogg/opus, mp3, m4a…). Quem faz essa
// conversão é o próprio navegador, com o AudioContext: ele já sabe decodificar
// todos esses formatos, então não precisamos de biblioteca nenhuma pra isso.
// -----------------------------------------------------------------------------

const TAXA_WHISPER = 16000;

let worker: Worker | null = null;
let proximoId = 1;
const pendentes = new Map<string, { ok: (t: string) => void; erro: (e: string) => void }>();
let aoBaixar: ((pct: number) => void) | null = null;

function obterWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../../workers/transcricao.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (ev: MessageEvent) => {
    const d = ev.data || {};
    if (d.tipo === 'baixando') { aoBaixar?.(d.pct ?? 0); return; }
    const p = d.id ? pendentes.get(d.id) : null;
    if (!p) return;
    pendentes.delete(d.id);
    if (d.tipo === 'texto') p.ok(String(d.texto || ''));
    else if (d.tipo === 'erro') p.erro(String(d.erro || 'falhou'));
  });
  return worker;
}

/**
 * Baixa o arquivo e devolve o sinal no formato que o Whisper espera.
 *
 * O áudio NÃO é buscado direto no Chatwoot: ele não manda cabeçalho de CORS, e
 * o navegador bloqueia a leitura dos bytes por script (a tag <audio> toca
 * normalmente, porque mídia não passa por essa regra — foi o que fez a primeira
 * versão falhar com "não consegui transcrever"). Quem busca é o nosso servidor,
 * em /api/wa-sync?audio=, que entrega o arquivo já liberado.
 */
async function prepararAudio(leadId: string, messageId: string): Promise<Float32Array> {
  const { authHeaders } = await import('@/lib/qs/waInbox');
  const resposta = await fetch(
    `/api/wa-sync?leadId=${encodeURIComponent(leadId)}&audio=${encodeURIComponent(messageId)}`,
    { headers: await authHeaders() }
  );
  if (!resposta.ok) throw new Error('não consegui baixar o áudio');
  const bruto = await resposta.arrayBuffer();

  // O AudioContext decodifica ogg/opus, mp3, m4a e wav sem ajuda externa.
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx({ sampleRate: TAXA_WHISPER });
  try {
    const buffer = await ctx.decodeAudioData(bruto);
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
    // Estéreo vira mono pela média — o Whisper só aceita um canal.
    const a = buffer.getChannelData(0);
    const b = buffer.getChannelData(1);
    const mono = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) mono[i] = (a[i] + b[i]) / 2;
    return mono;
  } finally {
    void ctx.close();
  }
}

/**
 * Transcreve o áudio da URL. `onProgresso` recebe o andamento do download do
 * modelo na PRIMEIRA vez (depois disso ele vem do cache e nem é chamado).
 */
export async function transcreverLocalmente(
  leadId: string,
  messageId: string,
  onProgresso?: (pct: number) => void
): Promise<{ texto?: string; error?: string }> {
  try {
    aoBaixar = onProgresso ?? null;
    const audio = await prepararAudio(leadId, messageId);
    if (!audio.length) return { error: 'Este áudio está vazio.' };
    const id = String(proximoId++);
    const w = obterWorker();
    const texto = await new Promise<string>((resolve, reject) => {
      pendentes.set(id, { ok: resolve, erro: (e) => reject(new Error(e)) });
      w.postMessage({ tipo: 'transcrever', id, audio }, [audio.buffer]);
    });
    return { texto: texto.trim() };
  } catch (e) {
    // A mensagem real vai pro console: sem ela, todo problema virava o mesmo
    // "não consegui transcrever" e não dava pra saber o que arrumar.
    const m = String((e as Error)?.message || e);
    console.warn('[transcrição local]', m);
    if (m.includes('baixar')) return { error: 'Não consegui baixar o áudio.' };
    if (/decode|Unable to decode|EncodingError/i.test(m)) return { error: 'Não consegui abrir este formato de áudio.' };
    if (/fetch|network|Failed to fetch/i.test(m)) return { error: 'Falha de rede ao preparar a transcrição.' };
    return { error: `Não consegui transcrever: ${m.slice(0, 80)}` };
  } finally {
    aoBaixar = null;
  }
}

/** Começa a baixar o modelo antes de alguém pedir (chame quando a aba abrir). */
export function prepararTranscricao(onProgresso?: (pct: number) => void): void {
  try {
    aoBaixar = onProgresso ?? null;
    obterWorker().postMessage({ tipo: 'preparar' });
  } catch { /* sem suporte a worker: o botão simplesmente falha na hora do uso */ }
}
