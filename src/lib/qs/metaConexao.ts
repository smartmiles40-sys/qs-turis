// src/lib/qs/metaConexao.ts
// -----------------------------------------------------------------------------
// O painel de conexão da Cloud API, lado do navegador (Bruno, 23/09/2026).
//
// O botão abre a janela da PRÓPRIA Meta (Cadastro Incorporado, o mesmo do
// ManyChat). Dela voltam duas coisas, por caminhos diferentes:
//   • o CÓDIGO de uso único → no retorno do FB.login;
//   • os ids do número e da conta → numa mensagem (postMessage) da janela.
// Os três vão pro servidor, que troca o código pelo token. O token nunca passa
// por aqui.
// -----------------------------------------------------------------------------

import { authHeaders } from "@/lib/qs/waInbox";

export interface NumeroMeta {
  phoneId: string;
  numero: string | null;
  nome: string | null;
  modo: "env" | "cloud" | "coexistencia";
  status: "conectado" | "desconectado" | "erro";
  origem: "painel" | "vercel" | null;
  dono: string | null;
  donoId: string | null;
  conectadoEm: string | null;
  qualidade: "GREEN" | "YELLOW" | "RED" | string | null;
  limite: string | null;
  statusMeta: string | null;
  metaErro: string | null;
  ultimaEntrada: string | null;
}

export interface PainelMeta {
  numeros: NumeroMeta[];
  cadastro: { appId: string | null; configId: string | null; podeTrocarCodigo: boolean };
  entrada: { ok: boolean | null; motivo: string | null; ultimoValidoEm?: string | null } | null;
  sdrs: { id: string; nome: string }[];
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/wa-config", { method: "POST", headers: await authHeaders(), body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || "O servidor recusou.");
  return d;
}

export async function carregarPainelMeta(): Promise<PainelMeta> {
  const res = await fetch("/api/wa-config?conexoes=1", { headers: await authHeaders() });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || "Não consegui carregar os números.");
  return d as PainelMeta;
}

export const salvarConfigId = (configId: string) => post({ acao: "meta-cadastro-salvar", configId });
export const desconectarNumeroMeta = (phoneId: string) => post({ acao: "meta-desconectar", phoneId });

// ── O SDK da Meta ────────────────────────────────────────────────────────────

interface FbLoginResposta { authResponse?: { code?: string } | null }
interface Fb {
  init(o: Record<string, unknown>): void;
  login(cb: (r: FbLoginResposta) => void, o: Record<string, unknown>): void;
}
declare global {
  interface Window { FB?: Fb; fbAsyncInit?: () => void }
}

let sdk: Promise<Fb> | null = null;

function carregarSdk(appId: string): Promise<Fb> {
  if (sdk) return sdk;
  sdk = new Promise<Fb>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v20.0" });
      resolve(window.FB!);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/pt_BR/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => { sdk = null; reject(new Error("Não consegui carregar a janela da Meta. Confira a internet ou um bloqueador de anúncios.")); };
    document.body.appendChild(s);
  });
  return sdk;
}

export interface OpcoesConexao {
  appId: string;
  configId: string;
  modo: "cloud" | "coexistencia";
  pin?: string;
  userId?: string | null;
}

/**
 * Abre a janela da Meta, espera a pessoa terminar e manda tudo pro servidor.
 * Devolve o número conectado, ou lança com a frase certa (inclusive "cancelou").
 */
export async function conectarPelaMeta(o: OpcoesConexao): Promise<{ numero: string | null; avisos: string[] }> {
  const FB = await carregarSdk(o.appId);

  let sessao: { phone_number_id?: string; waba_id?: string } | null = null;
  let cancelou: string | null = null;
  const ouvir = (ev: MessageEvent) => {
    try {
      if (!/(^|\.)facebook\.com$/.test(new URL(ev.origin).hostname)) return;
      const d = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      if (d?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (String(d.event || "").startsWith("FINISH")) sessao = d.data || {};
      else if (d.event === "CANCEL") cancelou = d.data?.current_step || "cancelado";
    } catch { /* outra mensagem qualquer */ }
  };
  window.addEventListener("message", ouvir);

  try {
    const code = await new Promise<string | null>((resolve) => {
      FB.login((r) => resolve(r?.authResponse?.code || null), {
        config_id: o.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          sessionInfoVersion: "3",
          ...(o.modo === "coexistencia" ? { featureType: "whatsapp_business_app_onboarding" } : {}),
        },
      });
    });
    // A mensagem com os ids às vezes chega logo DEPOIS do retorno do login.
    for (let i = 0; i < 15 && !sessao && !cancelou; i++) await new Promise((r) => setTimeout(r, 200));

    if (!code || cancelou) throw new Error("A conexão foi cancelada na janela da Meta.");
    const s = sessao as { phone_number_id?: string; waba_id?: string } | null;
    if (!s?.phone_number_id || !s?.waba_id) {
      throw new Error("A Meta não informou qual número foi escolhido. Conecte de novo e vá até o fim da janela.");
    }
    const r = await post({
      acao: "meta-conectar", code, wabaId: s.waba_id, phoneId: s.phone_number_id,
      modo: o.modo, pin: o.pin || null, userId: o.userId || null,
    });
    return { numero: (r.numero as string) || null, avisos: (r.avisos as string[]) || [] };
  } finally {
    window.removeEventListener("message", ouvir);
  }
}
