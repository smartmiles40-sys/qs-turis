// src/lib/whatsapp.ts
// -----------------------------------------------------------------------------
// Camada de WhatsApp do front. Junta:
//   - normalização de telefone (BR)
//   - envio de mensagem via rota serverless /api/wa-send (canal nativo:
//     Chatwoot → Evolution → WhatsApp — o mesmo do inbox do QS)
//   - REGISTRO (log) de cada envio na tabela qs_whatsapp_messages
//   - links de "clique-para-conversar" e "clique-para-ligar" (wa.me), que abrem
//     o app/WhatsApp Web do próprio atendente (fallback que sempre funciona).
//
// A chamada de voz "dentro do sistema" (WebRTC) depende da WhatsApp Business
// Calling API + BSP — ver docs/WHATSAPP.md. Até lá, `startWhatsAppCall` abre o
// chat do lead no WhatsApp, de onde o atendente inicia a ligação em 1 toque.
// -----------------------------------------------------------------------------

import { supabase } from "./supabase";

/** Só dígitos. "(11) 99999-8888" -> "11999998888". */
export function onlyDigits(phone?: string | null): string {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * Normaliza um telefone para o formato E.164 sem "+" (ex.: 5511999998888),
 * assumindo Brasil quando não vier DDI. Retorna "" se claramente inválido.
 *
 * O Bitrix manda o campo do contato com MAIS DE UM número no mesmo texto —
 * separados por vírgula (" 5519993152056,  551993152056") ou simplesmente
 * colados ("5547999689893554799689893"). Sem tratar isso, o webfone discava a
 * sequência inteira e a central devolvia "Rejected". Aqui ficamos com o
 * PRIMEIRO número da lista, que é o que o Bitrix considera o principal.
 */
export function normalizePhoneBR(raw?: string | null): string {
  // 1) separadores explícitos (vírgula, ponto e vírgula, barra, quebra de linha)
  const partes = String(raw || "").split(/[,;/|\n]+/).map((p) => onlyDigits(p)).filter(Boolean);
  let d = partes[0] || onlyDigits(raw);
  if (!d) return "";
  // 2) números colados sem separador: um E.164 brasileiro tem no máximo 13
  //    dígitos (55 + DDD + 9 + 8). Mais que isso com DDI 55 = lixo grudado.
  if (d.startsWith("55") && d.length > 13) d = d.slice(0, d[4] === "9" ? 13 : 12);
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

export type WaSendResult =
  | { ok: true; conversationId: number | null }
  | { ok: false; error: string };

/**
 * Envia mensagem ao lead pelo canal NATIVO (/api/wa-send: Chatwoot → Evolution),
 * o mesmo do inbox do QS. O servidor valida a posse do lead (SDR só escreve pra
 * lead da carteira dele), assina com o nome do usuário e grava a bolha na
 * conversa — por isso aqui só precisa de leadId + texto.
 * O log em qs_whatsapp_messages é best-effort e não bloqueia o envio.
 */
export async function sendWhatsAppMessage(input: {
  leadId?: string | null;
  ownerId?: string | null;
  phone?: string | null;
  text: string;
}): Promise<WaSendResult> {
  const phone = normalizePhoneBR(input.phone);
  if (!input.leadId) {
    return { ok: false, error: "Lead sem cadastro no QS — use o botão WhatsApp (wa.me)." };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  } catch { /* sem sessão — a rota nega */ }

  let ok = false;
  let error = "Falha ao enviar";
  let conversationId: number | null = null;
  try {
    const res = await fetch("/api/wa-send", {
      method: "POST",
      headers,
      body: JSON.stringify({ leadId: input.leadId, text: input.text }),
    });
    const json = (await res.json()) as { ok?: boolean; conversationId?: number; error?: string };
    ok = res.ok && json.ok === true;
    conversationId = json.conversationId ?? null;
    if (!ok) error = json.error || `Falha ao enviar (HTTP ${res.status})`;
  } catch {
    error = "Falha de rede ao chamar /api/wa-send";
  }

  await logWhatsApp({
    leadId: input.leadId,
    ownerId: input.ownerId ?? null,
    phone,
    body: input.text,
    status: ok ? "sent" : "failed",
    error: ok ? null : error,
  });

  if (ok) return { ok: true, conversationId };
  return { ok: false, error };
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
