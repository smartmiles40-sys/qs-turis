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
