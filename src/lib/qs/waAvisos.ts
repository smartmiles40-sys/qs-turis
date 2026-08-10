// src/lib/qs/waAvisos.ts
// -----------------------------------------------------------------------------
// Aviso de mensagem nova (contador + bipe + notificação do navegador).
//
// Vive aqui, e não dentro do dock, porque agora existem DOIS lugares que atendem
// WhatsApp: o dock lateral e a aba em tela cheia. Só um dos dois fica montado por
// vez — quem está na aba não tem dock, e vice-versa. Se a lógica morasse no dock,
// abrir a aba desligaria o aviso sonoro sem ninguém entender por quê.
//
// Regra que não pode se perder: só avisa quando o número de não lidas SOBE.
// Zerar (o atendente leu) nunca toca nada — senão o app apita ao ler mensagem.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { countUnread, subscribeToThreads } from "@/lib/qs/waInbox";

const AVISO_KEY = "qs_wa_avisos";

/**
 * Bipe gerado na hora. Um .mp3 hospedado é uma requisição que pode falhar
 * justamente na hora do aviso — e aí o som some sem ninguém perceber.
 */
export function tocarBipe() {
  try {
    const Ctx = window.AudioContext
      || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.14, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => ctx.close();
  } catch { /* navegador bloqueou áudio sem gesto do usuário */ }
}

export interface WaAvisos {
  /** Total de conversas com mensagem não lida (o que vai no badge). */
  naoLidas: number;
  /** Som e notificação estão ligados? Preferência por navegador. */
  avisos: boolean;
  alternarAvisos: () => Promise<void>;
}

export function useWaAvisos(): WaAvisos {
  const [naoLidas, setNaoLidas] = useState(0);
  const naoLidasRef = useRef(0);

  const [avisos, setAvisos] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(AVISO_KEY) !== "off";
  });

  useEffect(() => {
    let vivo = true;
    const atualizar = () => {
      countUnread().then((n) => {
        if (!vivo) return;
        if (n > naoLidasRef.current && avisos) {
          tocarBipe();
          try {
            if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
              new Notification("Nova mensagem no WhatsApp", {
                body: `${n} conversa${n > 1 ? "s" : ""} esperando você`,
                tag: "qs-wa",
              });
            }
          } catch { /* navegador sem suporte a Notification */ }
        }
        naoLidasRef.current = n;
        setNaoLidas(n);
      });
    };
    atualizar();
    const off = subscribeToThreads(atualizar);
    return () => { vivo = false; off(); };
  }, [avisos]);

  const alternarAvisos = useCallback(async () => {
    const novo = !avisos;
    setAvisos(novo);
    try { window.localStorage.setItem(AVISO_KEY, novo ? "on" : "off"); } catch { /* janela anônima */ }
    // Pedir permissão só funciona dentro do gesto de clique.
    if (novo && "Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch { /* usuário recusou */ }
    }
  }, [avisos]);

  return { naoLidas, avisos, alternarAvisos };
}
