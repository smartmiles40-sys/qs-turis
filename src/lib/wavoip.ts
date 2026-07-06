// src/lib/wavoip.ts
// -----------------------------------------------------------------------------
// Camada do WEBFONE (Wavoip) — ligações de voz via WhatsApp dentro do QS.
//
// A biblioteca é uma lib React empacotada como Web Component, carregada via CDN
// (build UMD). Depois de `render()`, ela expõe a API pública em `window.wavoip`.
//
// Fluxo:
//   1. carregar o script (uma única vez)                → ensureWavoipLoaded()
//   2. registrar o dispositivo (instância do WhatsApp)  → device.add(token, true)
//   3. discar para um lead                              → dialViaWavoip(phone)
//
// O token do dispositivo é configurável em Configurações → Webfone (tabela
// qs_settings, chave "wavoip_token"); um VITE_WAVOIP_TOKEN, se existir, tem
// prioridade. Sem token, o widget ainda aparece, mas não conecta a nenhum número.
// -----------------------------------------------------------------------------

import { getSetting } from "./qsSettings";
import { normalizePhoneBR } from "./whatsapp";

export const WAVOIP_TOKEN_KEY = "wavoip_token";

// CDN (build UMD). @latest deixa a lib se auto-atualizar; para travar numa versão
// específica troque por, ex.: @1.3.9 e adicione data-auto-update="false" no script.
const WAVOIP_CDN =
  "https://cdn.jsdelivr.net/npm/@wavoip/wavoip-webphone@latest/dist/index.umd.min.js";

// ── Tipos mínimos da API pública que usamos (window.wavoip) ──────────────────

interface WavoipApi {
  call: {
    start: (
      to: string,
      config?: { displayName?: string; fromTokens?: string[] },
    ) => Promise<{ call?: unknown; err?: unknown }>;
    setInput: (n: string) => void;
  };
  device: {
    get: () => unknown[];
    add: (token: string, persist?: boolean) => void;
    remove: (token: string) => void;
  };
  widget: {
    open: () => void;
    close: () => void;
    toggle: () => void;
    buttonPosition: { set: (p: string | { x: number; y: number }) => void };
  };
  theme: { set: (t: "dark" | "light" | "system") => void };
}

declare global {
  interface Window {
    /** Carregador do build UMD (tem .render()). */
    wavoipWebphone?: { render: () => Promise<WavoipApi> };
    /** API pública, disponível só depois do render(). */
    wavoip?: WavoipApi;
  }
}

// ── Token ────────────────────────────────────────────────────────────────────

/** Token do dispositivo Wavoip: VITE_WAVOIP_TOKEN (override) → qs_settings. */
export async function getWavoipToken(): Promise<string> {
  const fromEnv = (import.meta.env.VITE_WAVOIP_TOKEN as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  const stored = await getSetting<string>(WAVOIP_TOKEN_KEY);
  return (stored ?? "").trim();
}

// ── Carregamento do script (singleton) ───────────────────────────────────────

let loadPromise: Promise<WavoipApi> | null = null;

/**
 * Injeta o script do webfone (uma única vez), chama render() e devolve a API
 * pública (window.wavoip). Chamadas repetidas reaproveitam a mesma Promise, então
 * é seguro chamar de vários lugares (e sobrevive ao StrictMode em dev).
 */
export function ensureWavoipLoaded(): Promise<WavoipApi> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<WavoipApi>((resolve, reject) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      reject(new Error("Webfone só carrega no navegador."));
      return;
    }
    // Já carregado por outra rota?
    if (window.wavoip) {
      resolve(window.wavoip);
      return;
    }

    const script = document.createElement("script");
    script.src = WAVOIP_CDN;
    script.async = true;
    script.onload = async () => {
      try {
        if (!window.wavoipWebphone) throw new Error("wavoipWebphone não encontrado após o load.");
        const api = await window.wavoipWebphone.render();
        // render() resolve com a API, que também fica em window.wavoip.
        resolve(api ?? window.wavoip!);
      } catch (e) {
        loadPromise = null; // permite nova tentativa
        reject(e);
      }
    };
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Falha ao baixar o script do webfone (verifique a conexão)."));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

// ── Ações ─────────────────────────────────────────────────────────────────────

/**
 * Garante que o webfone está carregado e com o dispositivo (token) registrado.
 * Idempotente: se o token já estiver na lista de dispositivos, não registra de novo.
 */
export async function ensureWavoipDevice(): Promise<{ ok: boolean; error?: string }> {
  try {
    const api = await ensureWavoipLoaded();
    const token = await getWavoipToken();
    if (!token) return { ok: false, error: "Nenhum token do Webfone configurado (Configurações → Webfone)." };
    const already = api.device.get?.().length > 0;
    if (!already) api.device.add(token, true); // true = persiste no navegador
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao iniciar o webfone." };
  }
}

export type DialResult = { ok: true } | { ok: false; error: string };

/**
 * Liga para um telefone pelo webfone: garante lib+dispositivo, abre o widget e
 * inicia a chamada. `phone` pode vir em qualquer formato BR — é normalizado para
 * E.164 sem "+".
 */
export async function dialViaWavoip(phone?: string | null, displayName?: string): Promise<DialResult> {
  const to = normalizePhoneBR(phone);
  if (!to || to.length < 11) return { ok: false, error: "Telefone inválido para ligar." };

  const dev = await ensureWavoipDevice();
  if (!dev.ok) return { ok: false, error: dev.error ?? "Webfone indisponível." };

  try {
    window.wavoip!.widget.open();
    const { err } = await window.wavoip!.call.start(to, displayName ? { displayName } : undefined);
    if (err) return { ok: false, error: "Não foi possível iniciar a chamada." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao iniciar a chamada." };
  }
}
