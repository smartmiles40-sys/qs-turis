// src/lib/gravacaoLigacao.ts
// -----------------------------------------------------------------------------
// GRAVAÇÃO DAS LIGAÇÕES DO WEBFONE (0233).
//
// A ligação acontece dentro do navegador (JsSIP), então o áudio dos dois lados
// já passa por aqui: o microfone do SDR sai pelos "senders" da conexão e a voz
// do cliente chega pelos "receivers". Misturamos os dois num AudioContext e o
// MediaRecorder grava em Opus (~24 kbps ≈ 180 KB por minuto).
//
// Começa quando a ligação é ATENDIDA e para quando ela termina. Aí o arquivo
// sobe pro bucket privado `ligacoes` e ganha uma linha em qs_ligacao_gravacoes,
// que é o que a aba "Ligações" da ficha do lead lista.
//
// REGRA: gravar nunca pode atrapalhar a ligação. Qualquer erro aqui é engolido
// (com console.warn) e a chamada segue igual a antes.
//
// Limite conhecido: se o SDR fechar a aba no meio da ligação, o áudio daquela
// ligação se perde (o upload só acontece ao desligar).
// -----------------------------------------------------------------------------

import { supabase } from "./supabase";

export interface ContextoGravacao {
  leadId?: string | null;
  telefone: string;
  origem: "webfone" | "discador";
}

export interface Gravacao {
  /** Para de gravar e arquiva. Idempotente. */
  finalizar(): void;
}

const BUCKET = "ligacoes";
const BITRATE = 24_000;

function escolherMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

function faixas(pc: RTCPeerConnection, lado: "senders" | "receivers"): MediaStreamTrack[] {
  const lista = lado === "senders" ? pc.getSenders() : pc.getReceivers();
  return lista
    .map((x) => x.track)
    .filter((t): t is MediaStreamTrack => !!t && t.kind === "audio" && t.readyState === "live");
}

/**
 * Começa a gravar a conexão de uma ligação já atendida. Devolve null quando o
 * navegador não consegue (sem MediaRecorder, sem faixas de áudio) — e a ligação
 * segue sem gravação.
 */
export function iniciarGravacao(pc: RTCPeerConnection | undefined | null, ctx: ContextoGravacao): Gravacao | null {
  try {
    if (!pc) return null;
    const mime = escolherMime();
    if (!mime) return null;
    const locais = faixas(pc, "senders");
    const remotas = faixas(pc, "receivers");
    if (!locais.length && !remotas.length) return null;

    const audioCtx = new AudioContext();
    // Sem gesto recente o navegador pode criar o contexto suspenso (mudo).
    if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => { /* segue */ });
    const destino = audioCtx.createMediaStreamDestination();
    for (const t of [...locais, ...remotas]) {
      // A faixa original, sem clonar: com o SDR no mudo (enabled=false), a
      // gravação também fica muda, igual ao que o cliente ouviu.
      audioCtx.createMediaStreamSource(new MediaStream([t])).connect(destino);
    }

    const recorder = new MediaRecorder(destino.stream, { mimeType: mime, audioBitsPerSecond: BITRATE });
    const pedacos: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) pedacos.push(e.data); };
    const inicio = new Date();
    let encerrada = false;

    recorder.onstop = () => {
      void audioCtx.close().catch(() => { /* já fechado */ });
      const duracaoSeg = Math.max(0, Math.round((Date.now() - inicio.getTime()) / 1000));
      const blob = new Blob(pedacos, { type: mime.split(";")[0] });
      if (!blob.size || duracaoSeg < 1) return;
      void arquivar(blob, inicio, duracaoSeg, ctx);
    };

    // Pedaços de 10 s: se o navegador engasgar no fim, perde no máximo isso.
    recorder.start(10_000);

    return {
      finalizar() {
        if (encerrada) return;
        encerrada = true;
        try { if (recorder.state !== "inactive") recorder.stop(); }
        catch (e) { console.warn("[gravacao] stop:", e); }
      },
    };
  } catch (e) {
    console.warn("[gravacao] não deu pra gravar esta ligação:", e);
    return null;
  }
}

async function arquivar(blob: Blob, inicio: Date, duracaoSeg: number, ctx: ContextoGravacao): Promise<void> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user?.id;
    if (!uid) return;
    const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
    const caminho = `${uid}/${ctx.leadId || "sem-lead"}/${inicio.toISOString().replace(/[:.]/g, "-")}.${ext}`;

    // Uma nova tentativa cobre o soluço de rede logo depois de desligar.
    let erro: unknown = null;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const { error } = await supabase.storage.from(BUCKET).upload(caminho, blob, {
        contentType: blob.type,
        upsert: false,
      });
      erro = error;
      if (!error) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (erro) { console.warn("[gravacao] upload falhou:", erro); return; }

    const { error } = await supabase.from("qs_ligacao_gravacoes").insert({
      lead_id: ctx.leadId || null,
      sdr_id: uid,
      telefone: ctx.telefone,
      inicio: inicio.toISOString(),
      duracao_seg: duracaoSeg,
      storage_path: caminho,
      tamanho_bytes: blob.size,
      mime: blob.type,
      origem: ctx.origem,
    });
    if (error) console.warn("[gravacao] registro falhou:", error);
  } catch (e) {
    console.warn("[gravacao] arquivar:", e);
  }
}

// ── Leitura (aba "Ligações" da ficha) ───────────────────────────────────────

export interface GravacaoLigacao {
  id: string;
  lead_id: string | null;
  sdr_id: string;
  telefone: string | null;
  inicio: string;
  duracao_seg: number;
  storage_path: string;
  origem: string;
  sdr?: { name: string | null } | null;
}

export async function listarGravacoesDoLead(leadId: string): Promise<GravacaoLigacao[]> {
  const { data, error } = await supabase
    .from("qs_ligacao_gravacoes")
    .select("id,lead_id,sdr_id,telefone,inicio,duracao_seg,storage_path,origem,sdr:qs_users!qs_ligacao_gravacoes_sdr_id_fkey(name)")
    .eq("lead_id", leadId)
    .order("inicio", { ascending: false })
    .limit(200);
  if (error) { console.warn("[gravacao] listar:", error); return []; }
  return (data ?? []) as unknown as GravacaoLigacao[];
}

/** Nome do arquivo baixado: "ligacao-2026-11-05-14h32-5531991133653.webm". */
export function nomeDoArquivo(g: Pick<GravacaoLigacao, "storage_path" | "inicio" | "telefone">): string {
  const ext = (g.storage_path.match(/\.([a-z0-9]+)$/i)?.[1] || "webm").toLowerCase();
  const d = new Date(g.inicio);
  const p = (n: number) => String(n).padStart(2, "0");
  const data = Number.isNaN(d.getTime()) ? "sem-data"
    : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}h${p(d.getMinutes())}`;
  const fone = String(g.telefone || "").replace(/\D/g, "");
  return `ligacao-${data}${fone ? `-${fone}` : ""}.${ext}`;
}

/**
 * Baixar o áudio (05/11, Bruno: "os SDRs poderem baixar os áudios das gravações
 * deles"). A RLS do bucket já limita: SDR só as próprias, gestão todas.
 */
export async function baixarGravacao(g: Pick<GravacaoLigacao, "storage_path" | "inicio" | "telefone">): Promise<boolean> {
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(g.storage_path, 600, { download: nomeDoArquivo(g) });
  if (error || !data?.signedUrl) { console.warn("[gravacao] baixar:", error); return false; }
  const a = document.createElement("a");
  a.href = data.signedUrl;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}

/** Link temporário (1 h) pro player — o bucket é privado. */
export async function linkDaGravacao(caminho: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 3600);
  if (error) { console.warn("[gravacao] link:", error); return null; }
  return data?.signedUrl ?? null;
}
