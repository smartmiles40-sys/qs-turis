// src/lib/qs/chatProvider.ts
// -----------------------------------------------------------------------------
// Qual "cockpit" de atendimento o QS usa: o ChatApp (legado, janela externa) ou
// o Chatwoot self-hosted embedado (novo). Controlado por uma FEATURE FLAG em
// qs_settings (`chat_provider`), pra virar a chave sem deploy e com rollback
// instantâneo. Um override por build (VITE_CHAT_PROVIDER) serve de default.
//
// Por que o Chatwoot pode ser embedado (e o ChatApp não): ele é self-hosted, e
// nós liberamos o frame (middleware Traefik `cw-embed` = CSP frame-ancestors) e
// servimos o QS no MESMO domínio-pai (qs.* e chat.* → same-site), então o cookie
// de sessão gruda dentro do iframe. Ver docs/PLANO-INTEGRACAO-QS.md.
// -----------------------------------------------------------------------------

import { getSetting, setSetting } from "@/lib/qsSettings";

export type ChatProvider = "chatapp" | "chatwoot";

export const CHAT_PROVIDER_KEY = "chat_provider";

/** Default por build (Vercel env). Sem env, cai no ChatApp (comportamento atual). */
export function defaultChatProvider(): ChatProvider {
  const v = (import.meta.env.VITE_CHAT_PROVIDER as string | undefined)?.toLowerCase();
  return v === "chatwoot" ? "chatwoot" : "chatapp";
}

/**
 * Provider EFETIVO: a flag de qs_settings manda; se não houver linha (ou erro de
 * leitura), cai no default de build. Fail-safe pro ChatApp — nunca deixa o SDR
 * sem cockpit por causa de config.
 */
export async function getChatProvider(): Promise<ChatProvider> {
  const flag = await getSetting<string>(CHAT_PROVIDER_KEY);
  if (flag === "chatwoot" || flag === "chatapp") return flag;
  return defaultChatProvider();
}

export async function setChatProvider(p: ChatProvider): Promise<boolean> {
  return setSetting(CHAT_PROVIDER_KEY, p);
}

// ── Chatwoot: URLs ──────────────────────────────────────────────────────────

/** Base do Chatwoot self-hosted (configurável por VITE_CHATWOOT_URL). */
export function getChatwootUrl(): string {
  return (
    (import.meta.env.VITE_CHATWOOT_URL as string) ||
    "https://chat.setuforeuvouviagens.com.br"
  ).replace(/\/+$/, "");
}

/** ID da conta no Chatwoot (workspace). Configurável por VITE_CHATWOOT_ACCOUNT_ID. */
export function getChatwootAccountId(): string {
  return (import.meta.env.VITE_CHATWOOT_ACCOUNT_ID as string) || "1";
}

/** URL do painel do agente (inbox geral) — o que o iframe carrega por padrão. */
export function chatwootInboxUrl(): string {
  return `${getChatwootUrl()}/app/accounts/${getChatwootAccountId()}/dashboard`;
}

/** URL de uma conversa específica (deep-link do lead). */
export function chatwootConversationUrl(conversationId: number | string): string {
  return `${getChatwootUrl()}/app/accounts/${getChatwootAccountId()}/conversations/${conversationId}`;
}

// ── Deep-link: acha a conversa do lead pelo telefone (via serverless) ────────
// O serverless /api/chatwoot-lookup usa o token do Chatwoot (server-side) pra
// buscar o contato por telefone → conversa. Aqui a chamada é resiliente: se o
// endpoint não existir ainda, ou não achar conversa, devolve null e o dock só
// abre o inbox (o telefone já vai copiado como plano B).

export interface ChatwootLookupResult {
  conversationId: number | null;
  conversationUrl: string | null;
  contactId: number | null;
}

export async function lookupChatwootConversation(phone: string | null | undefined): Promise<ChatwootLookupResult> {
  const empty: ChatwootLookupResult = { conversationId: null, conversationUrl: null, contactId: null };
  if (!phone) return empty;
  try {
    // Manda o token da sessão pro serverless validar que é um usuário do QS
    // (a rota consulta contatos do Chatwoot — não pode ser pública).
    const headers: Record<string, string> = { Accept: "application/json" };
    try {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
    } catch { /* sem sessão — a rota decide */ }
    const res = await fetch(`/api/chatwoot-lookup?phone=${encodeURIComponent(phone)}`, { headers });
    if (!res.ok) return empty;
    const data = (await res.json()) as { conversationId?: number | null; contactId?: number | null };
    const conversationId = data.conversationId ?? null;
    return {
      conversationId,
      contactId: data.contactId ?? null,
      conversationUrl: conversationId != null ? chatwootConversationUrl(conversationId) : null,
    };
  } catch (e) {
    console.warn("[chatwoot] lookup falhou (segue pro inbox):", e);
    return empty;
  }
}
