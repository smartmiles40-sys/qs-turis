// src/natal/natal.ts
// -----------------------------------------------------------------------------
// Clima de Natal (pedido do Bruno, 26/11): o QS entra no clima SOZINHO em
// 1º de dezembro (meia-noite de Brasília) e sai depois do Dia de Reis (6/1).
//
// Tudo é CSS pendurado na classe `natal` do <html> (src/natal/natal.css):
// toquinha nos avatares, pisca-pisca no menu, fundo com flocos. A neve é o
// único componente (<Neve />, no AppShell).
//
// • Cada pessoa pode desligar no menu ("Clima de Natal") → localStorage.
// • Pra testar fora de época: ?natal=1 na URL (vale pra aba); ?natal=0 tira.
// • Com o QS aberto na virada, um relógio de 1 min troca a classe sozinho.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";

const CHAVE_OFF = "qs_natal_off";      // pessoa desligou (localStorage)
const CHAVE_FORCAR = "qs_natal_forcar"; // teste fora de época (sessionStorage)
const EVENTO = "qs-natal";

/** Dezembro inteiro + 1 a 6 de janeiro, no fuso de Brasília. */
export function ehEpocaDeNatal(agora: Date = new Date()): boolean {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", month: "numeric", day: "numeric" }).formatToParts(agora);
  const mes = Number(partes.find((p) => p.type === "month")?.value);
  const dia = Number(partes.find((p) => p.type === "day")?.value);
  return mes === 12 || (mes === 1 && dia <= 6);
}

/** ?natal=1 / ?natal=0 na URL vira preferência da aba. null = segue a data. */
function forcado(): boolean | null {
  try {
    const q = new URLSearchParams(window.location.search).get("natal");
    if (q === "1" || q === "0") sessionStorage.setItem(CHAVE_FORCAR, q);
    const v = sessionStorage.getItem(CHAVE_FORCAR);
    return v === "1" ? true : v === "0" ? false : null;
  } catch { return null; }
}

/** É época (ou está forçado pra teste)? Decide se o botão aparece no menu. */
export function epocaAtiva(): boolean {
  return forcado() ?? ehEpocaDeNatal();
}

function desligadoPelaPessoa(): boolean {
  try { return localStorage.getItem(CHAVE_OFF) === "1"; } catch { return false; }
}

export function natalLigado(): boolean {
  return epocaAtiva() && !desligadoPelaPessoa();
}

export function aplicarNatal(): void {
  const ligado = natalLigado();
  const root = document.documentElement;
  if (root.classList.contains("natal") !== ligado) {
    root.classList.toggle("natal", ligado);
    window.dispatchEvent(new Event(EVENTO));
  }
}

let relogio: number | undefined;
/** Chamado uma vez no boot (main.tsx). */
export function iniciarNatal(): void {
  aplicarNatal();
  if (relogio === undefined) relogio = window.setInterval(aplicarNatal, 60_000);
}

export function setNatalDesligado(off: boolean): void {
  try { off ? localStorage.setItem(CHAVE_OFF, "1") : localStorage.removeItem(CHAVE_OFF); } catch { /* modo restrito */ }
  aplicarNatal();
}

/** Estado reativo pro menu e pra neve. */
export function useNatal() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    window.addEventListener(EVENTO, f);
    return () => window.removeEventListener(EVENTO, f);
  }, []);
  const ligado = natalLigado();
  return { ligado, epoca: epocaAtiva(), alternar: () => setNatalDesligado(ligado) };
}
