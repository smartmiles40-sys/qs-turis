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

import { getSetting, setSetting } from "./qsSettings";
import { normalizePhoneBR } from "./whatsapp";

export const SIP_ENABLED_KEY = "sip_enabled";
export const SIP_HOST_KEY = "sip_host";
export const SIP_USER_KEY = "sip_user";
export const SIP_PASSWORD_KEY = "sip_password";
// Prefixo de rota que a operadora (BravoTech) pede na frente do número para
// completar a ligação — ex.: "1*" ou "01*". Vazio = disca o número puro.
export const SIP_PREFIX_KEY = "sip_prefix";

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

/** Monta o URI sip: para o softphone. Número em E.164 sem "+". Sem host = URI
 *  "pelada" (sip:NUMERO), que o softphone disca pela própria conta registrada. */
export function buildSipUri(phone?: string | null, host?: string): string {
  const to = normalizePhoneBR(phone);
  return host ? `sip:${to}@${host}` : `sip:${to}`;
}

export type SipDialResult = { ok: true; uri: string } | { ok: false; error: string };

/**
 * "Liga" pelo SIP: abre o URI sip: para o softphone do SO discar. Usa um <a>
 * temporário para não navegar/abrir aba em branco. Retorna o URI usado.
 */
export async function dialViaSip(phone?: string | null): Promise<SipDialResult> {
  const to = normalizePhoneBR(phone);
  if (!to || to.length < 11) return { ok: false, error: "Telefone inválido para ligar." };
  // BravoTech: o softphone disca pela PRÓPRIA conta (ramal) registrada, então a
  // URI vai "pelada" — sip:NUMERO. Só anexa @host se o admin configurou um
  // domínio SIP próprio (diferente do default herdado da Wavoip).
  const raw = (await getSetting<string>(SIP_HOST_KEY))?.trim() ?? "";
  const host = raw && raw !== DEFAULT_SIP_HOST ? raw : "";
  // Prefixo de rota que a BravoTech pede na frente do número (ex.: "1*"/"01*").
  const prefix = ((await getSetting<string>(SIP_PREFIX_KEY)) ?? "").trim();
  const uri = host ? `sip:${prefix}${to}@${host}` : `sip:${prefix}${to}`;
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

// ── Provisionamento (onboarding guiado do SDR) ───────────────────────────────
// A configuração é por MÁQUINA (o softphone é instalado no PC de cada SDR). O QS
// guarda: o LINK do instalador (botão "Baixar") e o MAPA usuário→ramal (o admin
// define em Configurações). O onboarding mostra ao SDR o ramal dele já pronto.

export const SIP_INSTALLER_URL_KEY = "sip_installer_url";
export const SIP_RAMAIS_KEY = "sip_ramais";

// Instalador do BravoTech embarcado em /public — servido pelo próprio domínio do
// QS (ex.: https://qs-turis.vercel.app/BravoTech-setup.exe). Vale de fallback
// quando o admin não colou um link próprio em Configurações → Telefone SIP.
export const DEFAULT_INSTALLER_PATH = "/BravoTech-setup.exe";

export interface SipRamalInfo {
  ramal: string;   // ex.: "2001"
  login?: string;  // ex.: "atendimento01@setufor"
}
export type SipRamaisMap = Record<string, SipRamalInfo>;

/** Link do instalador do softphone BravoTech. Usa o que o admin colou em
 *  Configurações; se estiver vazio, cai no instalador embarcado em /public. */
export async function getSipInstallerUrl(): Promise<string> {
  return ((await getSetting<string>(SIP_INSTALLER_URL_KEY)) ?? "").trim() || DEFAULT_INSTALLER_PATH;
}

/** Mapa completo usuário→ramal (definido pelo admin). */
export async function getSipRamais(): Promise<SipRamaisMap> {
  return (await getSetting<SipRamaisMap>(SIP_RAMAIS_KEY)) ?? {};
}

/** Ramal de um SDR específico — null se o admin ainda não mapeou. */
export async function getSipRamalForUser(userId: string): Promise<SipRamalInfo | null> {
  const info = (await getSipRamais())[userId];
  return info && info.ramal ? info : null;
}

/** Salva o mapa usuário→ramal. */
export async function setSipRamais(map: SipRamaisMap): Promise<boolean> {
  return setSetting(SIP_RAMAIS_KEY, map);
}

/** Salva o link do instalador. */
export async function setSipInstallerUrl(url: string): Promise<boolean> {
  return setSetting(SIP_INSTALLER_URL_KEY, url.trim());
}
