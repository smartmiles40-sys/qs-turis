// src/lib/qs/waCall.ts
// -----------------------------------------------------------------------------
// A VOLTA: LIGAR PRO CLIENTE PELO WHATSAPP OFICIAL (Cloud API Calling).
//
// O QS já RECEBE ligação desde 31/08 (o evento cai em `qs_wa_calls` pelo
// /api/wa-calls). Este arquivo faz o contrário: o SDR clica "Ligar" e o
// navegador dele vira o telefone.
//
// POR QUE O SERVIDOR NÃO CONSEGUE LIGAR SOZINHO: a Meta exige um SDP offer no
// corpo do pedido, e SDP é a descrição de um ponto de áudio REAL — microfone,
// codecs, candidatos de rede. Uma função serverless não tem nada disso. Então o
// navegador gera o offer e o servidor só carrega o envelope.
//
// O FLUXO, e por que ele é assíncrono no meio:
//
//   1. getUserMedia + RTCPeerConnection      -> offer
//   2. POST /api/wa-config calling-ligar     -> a Meta devolve o `wacid` NA HORA
//   3. ...e o SDP ANSWER vem depois, POR WEBHOOK (evento `connect`), caindo em
//      `qs_wa_calls`. Não vem na resposta do passo 2 — é isso que obriga esta
//      página a ficar de vigia no banco.
//   4. setRemoteDescription(answer)          -> o áudio começa a fluir
//   5. desligar -> action=terminate (a Meta exige, mesmo com RTCP BYE na mídia)
//
// POR QUE VIGIA POR CONSULTA, E NÃO POR REALTIME: são ~40 segundos de espera,
// uma vez por ligação. Uma consulta por segundo nesse intervalo é barata e não
// depende de a tabela estar na publicação do Realtime nem de o websocket
// sobreviver — e ligação que falha porque "o socket caiu" é o pior tipo de bug
// pra explicar pra uma SDR no meio do turno. Se um dia virar Realtime, o resto
// deste arquivo não muda.
//
// LIMITE CONHECIDO: a RLS de `qs_wa_calls` segue a do lead (`qs_owns_lead`).
// Gestor e closer veem tudo; um SDR ligando pro lead de OUTRO SDR não enxergaria
// o próprio answer e a ligação morreria em "discando". Hoje isso não acontece
// porque o SDR liga da fila dele — mas é a primeira coisa a olhar se aparecer.
// -----------------------------------------------------------------------------

import { supabase } from "../supabase";
import { authHeaders } from "./waInbox";

export type EstadoLigacao =
  | "pedindo-microfone"
  | "discando"
  | "tocando"
  | "falando"
  | "encerrada"
  | "recusada"
  | "erro";

export interface PassoLigacao {
  estado: EstadoLigacao;
  callId?: string | null;
  detalhe?: string;
}

export interface Ligacao {
  /** Desliga: avisa a Meta e derruba o áudio local. Pode ser chamado duas vezes. */
  desligar: () => Promise<void>;
  /** Cala/abre o microfone sem derrubar a chamada. */
  mudo: (calar: boolean) => void;
  callId: () => string | null;
}

/** A Meta quer o SDP COMPLETO (sem trickle), então esperamos os candidatos. */
function esperarIce(pc: RTCPeerConnection, tetoMs = 4000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const pronto = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", pronto);
        clearTimeout(timer);
        resolve();
      }
    };
    // Teto de 4s: rede com STUN bloqueado nunca chega a "complete", e é melhor
    // mandar o que já temos (candidato local resolve em muita rede) do que
    // deixar o SDR olhando "discando..." pra sempre.
    const timer = setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", pronto);
      resolve();
    }, tetoMs);
    pc.addEventListener("icegatheringstatechange", pronto);
  });
}

async function pedir(acao: string, corpo: Record<string, unknown>) {
  const res = await fetch("/api/wa-config", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ acao, ...corpo }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || "A Meta recusou.");
  return d;
}

/**
 * Liga pro cliente. Devolve o controle da chamada; o andamento chega pelo
 * `onPasso` — é ele que a tela usa pra mostrar "tocando", "falando", etc.
 */
export async function ligarPeloWhatsApp(
  telefone: string,
  onPasso: (p: PassoLigacao) => void,
): Promise<Ligacao> {
  const para = String(telefone || "").replace(/\D/g, "");
  if (para.length < 12) throw new Error("Telefone com DDI e DDD, ex.: 5511999999999.");

  onPasso({ estado: "pedindo-microfone" });
  let microfone: MediaStream;
  try {
    microfone = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error("Sem acesso ao microfone. Libere no cadeado da barra de endereço.");
  }

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
  });

  // O áudio do cliente precisa de um elemento pra tocar. Ele vive fora da árvore
  // do React de propósito: se a tela re-renderizar no meio da ligação, o som não
  // pode piscar.
  const alto = document.createElement("audio");
  alto.autoplay = true;
  document.body.appendChild(alto);

  microfone.getTracks().forEach((t) => pc.addTrack(t, microfone));
  pc.ontrack = (e) => { alto.srcObject = e.streams[0]; };

  let callId: string | null = null;
  let vivo = true;
  let vigia: number | undefined;

  const limpar = () => {
    vivo = false;
    if (vigia) window.clearInterval(vigia);
    try { microfone.getTracks().forEach((t) => t.stop()); } catch { /* já parou */ }
    try { pc.close(); } catch { /* já fechou */ }
    try { alto.remove(); } catch { /* já saiu */ }
  };

  const desligar = async () => {
    const id = callId;
    limpar();
    // Avisar a Meta é obrigatório: sem o `terminate` a chamada fica aberta do
    // lado dela mesmo com o áudio já morto aqui.
    if (id) { try { await pedir("calling-desligar", { callId: id }); } catch { /* já caiu */ } }
  };

  try {
    const oferta = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(oferta);
    await esperarIce(pc);

    onPasso({ estado: "discando" });
    const r = await pedir("calling-ligar", { telefone: para, sdp: pc.localDescription?.sdp });
    callId = r?.callId || null;
    if (!callId) throw new Error("A Meta aceitou o pedido mas não devolveu o id da chamada.");
    onPasso({ estado: "discando", callId });
  } catch (e) {
    limpar();
    throw e;
  }

  // ── A VIGIA: o answer e o desfecho chegam pelo webhook, não por resposta ────
  let ultimoId = 0;
  const olhar = async () => {
    if (!vivo) return;
    const { data } = await supabase
      .from("qs_wa_calls")
      .select("id,evento,sdp,sdp_tipo")
      .eq("call_id", callId)
      .gt("id", ultimoId)
      .order("id", { ascending: true });

    for (const linha of (data ?? []) as { id: number; evento: string | null; sdp: string | null; sdp_tipo: string | null }[]) {
      ultimoId = linha.id;
      const evento = String(linha.evento || "").toUpperCase();

      if (linha.sdp_tipo === "answer" && linha.sdp && pc.signalingState !== "stable") {
        try {
          await pc.setRemoteDescription({ type: "answer", sdp: String(linha.sdp) });
          onPasso({ estado: "falando", callId });
        } catch (err) {
          onPasso({ estado: "erro", callId, detalhe: (err as Error)?.message });
          limpar();
          return;
        }
        continue;
      }
      if (evento === "RINGING") onPasso({ estado: "tocando", callId });
      if (evento === "ACCEPTED") onPasso({ estado: "falando", callId });
      if (evento === "REJECTED") { onPasso({ estado: "recusada", callId }); limpar(); return; }
      if (evento === "TERMINATE") { onPasso({ estado: "encerrada", callId }); limpar(); return; }
    }
  };
  vigia = window.setInterval(() => { void olhar(); }, 1000);

  // Fechar a aba no meio da ligação deixaria a chamada aberta na Meta.
  window.addEventListener("beforeunload", () => { void desligar(); }, { once: true });

  return {
    desligar,
    mudo: (calar: boolean) => microfone.getAudioTracks().forEach((t) => { t.enabled = !calar; }),
    callId: () => callId,
  };
}


// ─── A PONTE PRO RESTO DO QS ────────────────────────────────────────────────
//
// O Painel e o modal do WhatsApp não devem saber o que é SDP. Eles chamam
// `dialViaOficial(telefone, contexto)` — o MESMO formato do antigo
// `dialViaWavoip` — e escutam o fim da chamada pelo `setOnCallEndedOficial`,
// que emite o MESMO `CallEndedInfo` do Wavoip e do webfone VoxFree. É isso que
// deixa o desfecho automático (o "Não atendeu" com contagem de 10s) funcionar
// igual, sem tocar em nada da tela de tarefas.
//
// UMA ligação por vez, de propósito: duas chamadas simultâneas no mesmo
// navegador dividem o microfone e o SDR fala com o cliente errado.

export interface ContextoLigacao {
  leadName?: string | null;
  leadId?: string | null;
  ownerId?: string | null;
  displayName?: string | null;
}

export type ResultadoDiscagem = { ok: true } | { ok: false; error: string };

/** Mesmo formato que wavoip.ts e webphone.ts emitem — o Painel já sabe reagir. */
export interface CallEndedInfo {
  leadId: string | null;
  phone: string | null;
  answered: boolean;
  durationSec: number;
}

/** O que o widget precisa desenhar. */
export interface EstadoNaTela {
  ativa: boolean;
  estado: EstadoLigacao | null;
  leadName: string | null;
  phone: string | null;
  atendidaEm: number | null;
  calado: boolean;
  detalhe?: string;
}

const VAZIO: EstadoNaTela = {
  ativa: false, estado: null, leadName: null, phone: null, atendidaEm: null, calado: false,
};

let naTela: EstadoNaTela = VAZIO;
let atual: Ligacao | null = null;
let contexto: ContextoLigacao = {};
let desfechoEmitido = false;
let aoEncerrar: ((info: CallEndedInfo) => void) | null = null;
const ouvintes = new Set<(e: EstadoNaTela) => void>();

function avisar() { ouvintes.forEach((cb) => cb(naTela)); }

/** O widget se inscreve aqui. Devolve a função de cancelar. */
export function assinarLigacaoAtual(cb: (e: EstadoNaTela) => void): () => void {
  ouvintes.add(cb);
  cb(naTela);
  return () => { ouvintes.delete(cb); };
}

/** Quem reage ao fim da chamada (o Painel abre o desfecho). */
export function setOnCallEndedOficial(cb: ((info: CallEndedInfo) => void) | null): void {
  aoEncerrar = cb;
}

function encerrarDeVez(estado: EstadoLigacao, detalhe?: string) {
  const atendida = naTela.atendidaEm;
  const info: CallEndedInfo = {
    leadId: contexto.leadId ?? null,
    phone: naTela.phone,
    answered: !!atendida,
    durationSec: atendida ? Math.round((Date.now() - atendida) / 1000) : 0,
  };
  naTela = { ...naTela, ativa: false, estado, detalhe };
  avisar();
  atual = null;
  // Só um desfecho por chamada: o `terminate` da Meta e o clique em "Desligar"
  // chegam os dois, e abrir a tela de desfecho duas vezes é pior que não abrir.
  if (!desfechoEmitido) {
    desfechoEmitido = true;
    try { aoEncerrar?.(info); } catch (e) { console.warn("[ligacao] desfecho:", e); }
  }
  // Some com o widget depois de um instante, pra pessoa ler o que aconteceu.
  window.setTimeout(() => { if (!atual) { naTela = VAZIO; avisar(); } }, 4000);
}

/**
 * Liga pro cliente pelo NÚMERO OFICIAL. Substitui o `dialViaWavoip` nos pontos
 * onde a ligação é "pelo WhatsApp".
 */
export async function dialViaOficial(
  phone?: string | null,
  ctx?: ContextoLigacao,
): Promise<ResultadoDiscagem> {
  if (atual) return { ok: false, error: "Já existe uma ligação em andamento — desligue a atual primeiro." };

  const para = String(phone || "").replace(/\D/g, "");
  if (para.length < 12) return { ok: false, error: "Telefone inválido para ligar (precisa de DDI e DDD)." };

  contexto = ctx ?? {};
  desfechoEmitido = false;
  naTela = {
    ativa: true, estado: "pedindo-microfone", leadName: ctx?.leadName ?? ctx?.displayName ?? null,
    phone: para, atendidaEm: null, calado: false,
  };
  avisar();

  try {
    atual = await ligarPeloWhatsApp(para, (p) => {
      if (p.estado === "falando" && !naTela.atendidaEm) {
        naTela = { ...naTela, estado: p.estado, atendidaEm: Date.now() };
        avisar();
        return;
      }
      if (p.estado === "encerrada" || p.estado === "recusada" || p.estado === "erro") {
        encerrarDeVez(p.estado, p.detalhe);
        return;
      }
      naTela = { ...naTela, estado: p.estado };
      avisar();
    });
    return { ok: true };
  } catch (e) {
    atual = null;
    naTela = VAZIO;
    avisar();
    return { ok: false, error: (e as Error)?.message ?? "Não consegui ligar." };
  }
}

/** Desliga a chamada em andamento (botão do widget). */
export async function desligarAtual(): Promise<void> {
  const l = atual;
  if (!l) return;
  await l.desligar();
  encerrarDeVez("encerrada");
}

/** Cala/abre o microfone da chamada em andamento. */
export function alternarMudoAtual(): void {
  if (!atual) return;
  const calado = !naTela.calado;
  atual.mudo(calado);
  naTela = { ...naTela, calado };
  avisar();
}
