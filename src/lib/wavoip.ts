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
//   4. registrar o RESULTADO da ligação (call:ended)    → setupCallLogging()
//
// O token do dispositivo é configurável em Configurações → Webfone (tabela
// qs_settings, chave "wavoip_token"); um VITE_WAVOIP_TOKEN, se existir, tem
// prioridade. Sem token, o widget ainda aparece, mas não conecta a nenhum número.
// -----------------------------------------------------------------------------

import { getSetting } from "./qsSettings";
import { normalizePhoneBR, logWhatsApp } from "./whatsapp";

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
    ) => Promise<{ call?: { id?: string } | null; err?: unknown }>;
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
  /** Assinatura de eventos de ciclo de vida da chamada (versões recentes). */
  on?: (event: string, cb: (payload: unknown) => void) => (() => void);
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

// ── Registro (log) de chamadas via eventos ───────────────────────────────────
// A API pública emite call:started / call:accepted / call:ended / offer:received.
// Guardamos o contexto do lead por callId (setado no dial) e, no call:ended,
// gravamos UMA linha em qs_whatsapp_messages (kind "call") com desfecho+duração.

interface TrackedCall {
  leadId?: string | null;
  ownerId?: string | null;
  phone?: string | null;
  direction: "out" | "in";
  startedAt: number;
  acceptedAt?: number;
}

const trackedCalls = new Map<string, TrackedCall>();
let loggingSetup = false;

function extractCallId(p: unknown): string | undefined {
  if (p && typeof p === "object") {
    const o = p as Record<string, unknown>;
    if (typeof o.id === "string") return o.id;
    const c = o.call as Record<string, unknown> | undefined;
    if (c && typeof c.id === "string") return c.id;
  }
  return undefined;
}

function extractPhone(p: unknown): string | undefined {
  if (p && typeof p === "object") {
    const o = p as Record<string, unknown>;
    const peer = o.peer as Record<string, unknown> | undefined;
    const phone = peer?.phone ?? o.phone ?? o.to;
    if (typeof phone === "string") return phone;
  }
  return undefined;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** Registra os listeners de ciclo de vida da chamada (uma única vez). */
function setupCallLogging(api: WavoipApi): void {
  if (loggingSetup || typeof api.on !== "function") return;
  loggingSetup = true;
  const on = api.on.bind(api);

  on("call:started", (p) => {
    const id = extractCallId(p);
    if (id && !trackedCalls.has(id)) {
      trackedCalls.set(id, { direction: "out", startedAt: Date.now(), phone: extractPhone(p) });
    }
  });

  on("offer:received", (p) => {
    const id = extractCallId(p);
    if (id && !trackedCalls.has(id)) {
      trackedCalls.set(id, { direction: "in", startedAt: Date.now(), phone: extractPhone(p) });
    }
  });

  on("call:accepted", (p) => {
    const id = extractCallId(p);
    if (!id) return;
    const c = trackedCalls.get(id) ?? { direction: "out" as const, startedAt: Date.now() };
    c.acceptedAt = Date.now();
    trackedCalls.set(id, c);
  });

  on("call:ended", (p) => {
    const id = extractCallId(p);
    if (!id) return;
    const c = trackedCalls.get(id);
    trackedCalls.delete(id);
    const answered = !!c?.acceptedAt;
    const durSec = answered ? Math.max(0, Math.round((Date.now() - c!.acceptedAt!) / 1000)) : 0;
    const rawStatus =
      p && typeof p === "object" && typeof (p as Record<string, unknown>).status === "string"
        ? String((p as Record<string, unknown>).status)
        : "";
    const via = c?.direction === "in" ? "recebida" : "webfone";
    const desfecho = answered ? "atendida" : "não atendida";
    const body =
      `📞 Ligação (${via}) — ${desfecho}` +
      (durSec ? ` · ${formatDuration(durSec)}` : "") +
      (rawStatus ? ` [${rawStatus}]` : "");

    void logWhatsApp({
      leadId: c?.leadId ?? null,
      ownerId: c?.ownerId ?? null,
      phone: c?.phone ?? extractPhone(p) ?? null,
      body,
      status: answered ? "sent" : "failed",
      direction: c?.direction ?? "out",
      kind: "call",
    });
  });
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
      setupCallLogging(window.wavoip);
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
        const resolved = api ?? window.wavoip!;
        setupCallLogging(resolved);
        // Ajustes visuais (não críticos): tema claro + botão no canto inferior
        // esquerdo. Ficam aqui pra valer em qualquer rota que carregue a lib.
        try { resolved.theme?.set?.("light"); } catch { /* versão sem theme */ }
        try { resolved.widget?.buttonPosition?.set?.("bottom-left"); } catch { /* sem posição */ }
        resolve(resolved);
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

/** Contexto do lead pra enriquecer o log da ligação (call:ended). */
export interface WavoipDialContext {
  displayName?: string;
  leadId?: string | null;
  ownerId?: string | null;
  leadName?: string | null;
}

/**
 * Liga para um telefone pelo webfone: garante lib+dispositivo, abre o widget e
 * inicia a chamada. `phone` pode vir em qualquer formato BR — é normalizado para
 * E.164 sem "+". A ligação sai SEMPRE do dispositivo configurado (fromTokens), e
 * o desfecho é registrado automaticamente quando a chamada termina (call:ended).
 *
 * `ctx` aceita uma string (legado = displayName) ou um objeto com o contexto do
 * lead/dono pra o log.
 */
export async function dialViaWavoip(
  phone?: string | null,
  ctx?: WavoipDialContext | string,
): Promise<DialResult> {
  const context: WavoipDialContext = typeof ctx === "string" ? { displayName: ctx, leadName: ctx } : ctx ?? {};
  const to = normalizePhoneBR(phone);
  if (!to || to.length < 11) return { ok: false, error: "Telefone inválido para ligar." };

  const dev = await ensureWavoipDevice();
  if (!dev.ok) return { ok: false, error: dev.error ?? "Webfone indisponível." };

  try {
    const token = await getWavoipToken();
    window.wavoip!.widget.open();

    const config: { displayName?: string; fromTokens?: string[] } = {};
    const displayName = context.displayName ?? context.leadName ?? undefined;
    if (displayName) config.displayName = displayName;
    if (token) config.fromTokens = [token]; // determinístico: sai do dispositivo configurado

    const res = await window.wavoip!.call.start(to, Object.keys(config).length ? config : undefined);
    if (res?.err) return { ok: false, error: "Não foi possível iniciar a chamada." };

    // Guarda o contexto do lead pra o log do call:ended (mescla com o que o
    // evento call:started possa já ter setado, sem perder acceptedAt).
    const id = res?.call?.id;
    if (id) {
      const prev = trackedCalls.get(id);
      trackedCalls.set(id, {
        direction: "out",
        startedAt: prev?.startedAt ?? Date.now(),
        acceptedAt: prev?.acceptedAt,
        leadId: context.leadId ?? null,
        ownerId: context.ownerId ?? null,
        phone: to,
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao iniciar a chamada." };
  }
}

/**
 * Abre/fecha o painel do webfone a partir de um gatilho do próprio QS (ex.: o
 * botão "Telefone" no topo). Carrega a lib + registra o dispositivo SOB DEMANDA —
 * assim o widget não aparece sozinho ao abrir o sistema; só quando o SDR chama.
 */
export async function toggleWebphone(): Promise<DialResult> {
  try {
    await ensureWavoipLoaded();
    const dev = await ensureWavoipDevice(); // registra o token; não bloqueia a abertura
    if (!dev.ok) console.warn("[webfone]", dev.error);
    const w = window.wavoip?.widget;
    if (!w) return { ok: false, error: "Webfone indisponível." };
    if (typeof w.toggle === "function") w.toggle();
    else w.open();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao abrir o webfone." };
  }
}
