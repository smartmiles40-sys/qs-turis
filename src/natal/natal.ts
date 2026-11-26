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
    trocarFavicon(ligado);
    window.dispatchEvent(new Event(EVENTO));
  }
}

/** Ícone da aba com toquinha durante o Clima de Natal. */
function trocarFavicon(natal: boolean): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = natal ? "/favicon-natal.svg" : "/favicon.svg";
}

// ── Frases de tela vazia (fila zerada, nada pendente) ────────────────────────
const FRASES = [
  "Fila zerada! Pode ir atacar a rabanada.",
  "Tudo em dia. O Papai Noel aprova esse ritmo.",
  "Nada pendente: sobrou tempo pra pensar no amigo secreto.",
  "Fila limpinha como neve fresca.",
  "Até as renas ficaram impressionadas com essa organização.",
  "Trabalho em dia, panetone liberado.",
  "Missão cumprida. Pode acender o pisca-pisca.",
];

/** Uma frase natalina por dia (todo mundo vê a mesma no dia). null fora do clima. */
export function fraseNatalDoDia(): string | null {
  if (!natalLigado()) return null;
  const dia = Math.floor(Date.now() / 86_400_000);
  return FRASES[dia % FRASES.length];
}

// ── Chuva de estrelinhas (venda subida, meta do dia batida) ──────────────────
const CORES_FESTA = ["#CCED60", "#FFC93C", "#F8F6F7", "#FF4D5E", "#DDF29A"];
/** Faz chover estrelinhas por ~3 s. Só no Clima de Natal e pra quem não pediu menos movimento. */
export function celebrarNatal(): void {
  if (!natalLigado()) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const festa = document.createElement("div");
  festa.className = "qs-festa";
  festa.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 56; i++) {
    const s = document.createElement("span");
    s.textContent = i % 3 === 0 ? "★" : "✦"; // ★ ✦
    s.style.left = `${Math.random() * 100}%`;
    s.style.color = CORES_FESTA[i % CORES_FESTA.length];
    s.style.fontSize = `${16 + Math.random() * 18}px`;
    s.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
    s.style.animationDelay = `${Math.random() * 0.5}s`;
    s.style.setProperty("--deriva", `${(Math.random() - 0.5) * 120}px`);
    festa.appendChild(s);
  }
  document.body.appendChild(festa);
  window.setTimeout(() => festa.remove(), 3600);
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
