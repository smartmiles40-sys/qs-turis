// src/lib/whatsapp.ts
// -----------------------------------------------------------------------------
// Camada de WhatsApp do front. Junta:
//   - normalização de telefone (BR)
//   - envio de mensagem via rota serverless /api/chatapp-send (ChatApp)
//   - REGISTRO (log) de cada envio na tabela qs_whatsapp_messages
//   - links de "clique-para-conversar" e "clique-para-ligar" (wa.me), que abrem
//     o app/WhatsApp Web do próprio atendente (fallback que sempre funciona).
//
// A chamada de voz "dentro do sistema" (WebRTC) depende da WhatsApp Business
// Calling API + BSP — ver docs/WHATSAPP.md. Até lá, `startWhatsAppCall` abre o
// chat do lead no WhatsApp, de onde o atendente inicia a ligação em 1 toque.
// -----------------------------------------------------------------------------

import { supabase } from "./supabase";
import { sendLeadMessage } from "./chatapp";

/** Só dígitos. "(11) 99999-8888" -> "11999998888". */
export function onlyDigits(phone?: string | null): string {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * Normaliza um telefone para o formato E.164 sem "+" (ex.: 5511999998888),
 * assumindo Brasil quando não vier DDI. Retorna "" se claramente inválido.
 */
export function normalizePhoneBR(raw?: string | null): string {
  let d = onlyDigits(raw);
  if (!d) return "";
  // já veio com DDI 55
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  // número nacional (10 = fixo, 11 = celular com 9) -> prefixa 55
  if (d.length === 10 || d.length === 11) return "55" + d;
  // outros DDIs / já internacional: devolve como está
  return d;
}

/** Telefone bonito pra exibir: +55 (11) 99999-8888 quando dá. */
export function formatPhoneDisplay(raw?: string | null): string {
  const d = normalizePhoneBR(raw);
  if (!d) return "";
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    const meio = rest.length === 9 ? `${rest.slice(0, 5)}-${rest.slice(5)}` : `${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `+55 (${ddd}) ${meio}`;
  }
  return "+" + d;
}

/** true se o telefone parece discável. */
export function isDialablePhone(raw?: string | null): boolean {
  return normalizePhoneBR(raw).length >= 11;
}

/** Link wa.me pra abrir a conversa (opcionalmente com texto pré-preenchido). */
export function waChatLink(phone?: string | null, text?: string): string {
  const num = normalizePhoneBR(phone);
  const base = `https://wa.me/${num}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * "Ligar" pelo WhatsApp. Hoje não existe deep-link público que dispare a chamada
 * direto (a Calling API oficial exige WABA + BSP). O caminho universal é abrir a
 * conversa do lead — o botão de ligar do WhatsApp fica a 1 toque. Abrimos em nova
 * aba pra não perder o CRM. Retorna a URL aberta (útil pra testes/log).
 */
export function startWhatsAppCall(phone?: string | null): string {
  const url = waChatLink(phone);
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
  return url;
}

/** URL do cabinet do ChatApp (configurável por VITE_CHATAPP_URL). */
export function getChatAppUrl(): string {
  return (
    (import.meta.env.VITE_CHATAPP_URL as string) ||
    "https://cabinet.chatapp.online/businesses/v2/products/dialogs#/?api[company_id]=56587&businessId=108329&lang=en&hostAppName=billingCabinet"
  );
}

/** Abre o ChatApp em nova aba (o atendente conversa por lá). Retorna a URL aberta. */
export function openChatApp(): string {
  const url = getChatAppUrl();
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
  return url;
}

export type WaSendResult =
  | { ok: true; chatId: string }
  | { ok: false; error: string; code?: string };

/**
 * Envia mensagem ao lead via ChatApp (rota serverless) e registra o resultado
 * em qs_whatsapp_messages. O log é best-effort: se a tabela ainda não existir,
 * o envio não é bloqueado.
 */
export async function sendWhatsAppMessage(input: {
  leadId?: string | null;
  ownerId?: string | null;
  phone?: string | null;
  chatId?: string;
  text: string;
}): Promise<WaSendResult> {
  const phone = normalizePhoneBR(input.phone);
  const r = await sendLeadMessage({ phone: phone || undefined, chatId: input.chatId, text: input.text });

  const ok = r.success === true;
  await logWhatsApp({
    leadId: input.leadId ?? null,
    ownerId: input.ownerId ?? null,
    phone,
    chatId: ok ? (r as { data: { chatId: string } }).data.chatId : input.chatId ?? null,
    body: input.text,
    status: ok ? "sent" : "failed",
    error: ok ? null : (r as { error?: string }).error ?? "Falha ao enviar",
  });

  if (ok) return { ok: true, chatId: (r as { data: { chatId: string } }).data.chatId };
  return { ok: false, error: (r as { error?: string; code?: string }).error ?? "Falha ao enviar", code: (r as { code?: string }).code };
}

/** Grava uma linha em qs_whatsapp_messages. Silencioso se a tabela não existir. */
export async function logWhatsApp(row: {
  leadId?: string | null;
  ownerId?: string | null;
  phone?: string | null;
  chatId?: string | null;
  body?: string | null;
  status: "sent" | "failed" | "pending";
  direction?: "out" | "in";
  kind?: "message" | "call";
  error?: string | null;
}): Promise<void> {
  try {
    await supabase.from("qs_whatsapp_messages").insert({
      lead_id: row.leadId ?? null,
      owner_id: row.ownerId ?? null,
      phone: row.phone ?? null,
      chat_id: row.chatId ?? null,
      body: row.body ?? null,
      status: row.status,
      direction: row.direction ?? "out",
      kind: row.kind ?? "message",
      error: row.error ?? null,
    });
  } catch (e) {
    console.warn("[whatsapp] não foi possível registrar o log:", e);
  }
}

/** Preenche {nome}/{primeiro_nome} num template. */
export function fillTemplate(tpl: string, lead: { name?: string | null }): string {
  const nome = (lead.name || "").trim();
  const primeiro = nome.split(/\s+/)[0] || "";
  return tpl.replaceAll("{nome}", nome).replaceAll("{primeiro_nome}", primeiro);
}

/** Templates padrão (turismo). Use {nome} / {primeiro_nome}. */
export const WA_TEMPLATES: { label: string; text: string }[] = [
  { label: "Primeiro contato", text: "Olá {primeiro_nome}! Tudo bem? Aqui é da equipe de viagens. Vi seu interesse e queria te ajudar a montar o roteiro ideal. Posso te enviar algumas opções?" },
  { label: "Follow-up", text: "Oi {primeiro_nome}, passando pra saber se você conseguiu ver o material que enviei. Ficou com alguma dúvida sobre a viagem?" },
  { label: "Retomada", text: "Olá {primeiro_nome}! Faz um tempinho que não conversamos. Ainda tem interesse em fechar sua próxima viagem? Consigo condições especiais essa semana." },
  { label: "Agendar conversa", text: "Oi {primeiro_nome}! Que tal marcarmos uma conversa rápida pra eu entender melhor o que você procura? Qual o melhor horário pra você?" },
];
