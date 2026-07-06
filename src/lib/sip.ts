// src/lib/sip.ts
// -----------------------------------------------------------------------------
// Camada de LIGAÇÃO POR SIP — a 2ª forma de contato de voz do QS.
//
// A Wavoip expõe um tronco SIP (host sipv2.wavoip.com) que faz/recebe chamadas
// pelo WhatsApp. O navegador NÃO fala SIP direto (só por WSS/WebRTC, que a Wavoip
// não oferece), então quem discа é um SOFTPHONE instalado no computador do SDR
// (MicroSIP no Windows, Zoiper, etc.), registrado com as credenciais SIP.
//
// O CRM entra como "click-to-dial": monta um URI `sip:<numero>@<host>` e entrega
// ao softphone (handler de protocolo do SO) — igual ao `tel:`. As credenciais
// (usuário/senha) ficam no softphone; aqui guardamos só host + referência.
// Guia de instalação: docs/SIP.md.
// -----------------------------------------------------------------------------

import { getSetting } from "./qsSettings";
import { normalizePhoneBR } from "./whatsapp";

export const SIP_ENABLED_KEY = "sip_enabled";
export const SIP_HOST_KEY = "sip_host";
export const SIP_USER_KEY = "sip_user";
export const SIP_PASSWORD_KEY = "sip_password";

export const DEFAULT_SIP_HOST = "sipv2.wavoip.com";

/** true se o admin ligou a discagem por SIP (Configurações → Telefone SIP). */
export async function isSipEnabled(): Promise<boolean> {
  return (await getSetting<boolean>(SIP_ENABLED_KEY)) === true;
}

/** Host do tronco SIP (default sipv2.wavoip.com). */
export async function getSipHost(): Promise<string> {
  const h = (await getSetting<string>(SIP_HOST_KEY))?.trim();
  return h || DEFAULT_SIP_HOST;
}

/** Monta o URI sip: para o softphone. Número em E.164 sem "+". */
export function buildSipUri(phone?: string | null, host: string = DEFAULT_SIP_HOST): string {
  const to = normalizePhoneBR(phone);
  return `sip:${to}@${host}`;
}

export type SipDialResult = { ok: true; uri: string } | { ok: false; error: string };

/**
 * "Liga" pelo SIP: abre o URI sip: para o softphone do SO discar. Usa um <a>
 * temporário para não navegar/abrir aba em branco. Retorna o URI usado.
 */
export async function dialViaSip(phone?: string | null): Promise<SipDialResult> {
  const to = normalizePhoneBR(phone);
  if (!to || to.length < 11) return { ok: false, error: "Telefone inválido para ligar." };
  const host = await getSipHost();
  const uri = `sip:${to}@${host}`;
  try {
    if (typeof document === "undefined") throw new Error("Sem navegador.");
    const a = document.createElement("a");
    a.href = uri;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { ok: true, uri };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Não foi possível abrir o softphone." };
  }
}
