// src/lib/qs/waInbox.ts
// -----------------------------------------------------------------------------
// Cliente do ATENDIMENTO NATIVO de WhatsApp (o "inbox do SDR" dentro do QS).
//
// A leitura vem DIRETO do Supabase, de propósito: as tabelas qs_wa_threads e
// qs_wa_messages têm RLS pelo dono do lead (migration 0024), então o próprio
// banco já entrega só as conversas daquele SDR — não existe filtro de tela pra
// alguém burlar, e o realtime do Supabase respeita a mesma regra.
//
// A escrita (enviar mensagem) NÃO passa por aqui direto: vai pelo /api/wa-send,
// que revalida a posse do lead no servidor antes de falar com o Chatwoot.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";

export interface WaMessage {
  id: string;
  lead_id: string;
  cw_message_id: number | null;
  direction: "in" | "out";
  content: string | null;
  attachments: { type: string; url: string }[];
  sender_name: string | null;
  sent_at: string;
}

export interface WaThreadLead {
  id: string;
  full_name: string | null;
  first_name: string | null;
  phone: string | null;
  status: string | null;
}

export interface WaThread {
  lead_id: string;
  cw_conversation_id: number | null;
  last_message: string | null;
  last_direction: "in" | "out" | null;
  last_at: string | null;
  unread: number;
  can_reply: boolean | null;
  synced_at: string | null;
  lead: WaThreadLead | null;
}

const THREAD_COLS =
  "lead_id,cw_conversation_id,last_message,last_direction,last_at,unread,can_reply,synced_at," +
  "lead:qs_leads(id,full_name,first_name,phone,status)";

/** Conversas visíveis pra quem está logado (a RLS já corta as dos outros). */
export async function listMyThreads(limit = 100): Promise<WaThread[]> {
  const { data, error } = await supabase
    .from("qs_wa_threads")
    .select(THREAD_COLS)
    .order("last_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    console.warn("[wa] listMyThreads:", error.message);
    return [];
  }
  // O PostgREST devolve o embed como objeto ou array de 1 conforme a relação.
  return (data ?? []).map((r) => {
    const raw = r as unknown as Record<string, unknown>;
    const lead = Array.isArray(raw.lead) ? (raw.lead[0] ?? null) : (raw.lead ?? null);
    return { ...(raw as unknown as WaThread), lead: lead as WaThreadLead | null };
  });
}

/** Total de não lidas do usuário logado (badge do botão flutuante). */
export async function countUnread(): Promise<number> {
  const { data, error } = await supabase
    .from("qs_wa_threads")
    .select("unread")
    .gt("unread", 0);
  if (error) return 0;
  return (data ?? []).reduce((s, r) => s + ((r as { unread: number }).unread || 0), 0);
}

export async function listMessages(leadId: string, limit = 200): Promise<WaMessage[]> {
  const { data, error } = await supabase
    .from("qs_wa_messages")
    .select("id,lead_id,cw_message_id,direction,content,attachments,sender_name,sent_at")
    .eq("lead_id", leadId)
    .order("sent_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.warn("[wa] listMessages:", error.message);
    return [];
  }
  return (data ?? []) as WaMessage[];
}

/** Zera o contador de não lidas (única escrita do navegador — e via função). */
export async function markThreadRead(leadId: string): Promise<void> {
  const { error } = await supabase.rpc("qs_wa_mark_read", { p_lead: leadId });
  if (error) console.warn("[wa] markThreadRead:", error.message);
}

// ── Chamadas ao servidor ────────────────────────────────────────────────────

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  } catch { /* sem sessão — o servidor nega */ }
  return headers;
}

export interface WaSyncResult {
  conversationId: number | null;
  importadas: number;
  motivo?: string;
  configured?: boolean;
}

/**
 * Traz do Chatwoot o histórico que o webhook não viu (tudo que é anterior a ele).
 * Idempotente — pode chamar toda vez que abrir a conversa.
 */
export async function syncThread(leadId: string): Promise<WaSyncResult> {
  const vazio: WaSyncResult = { conversationId: null, importadas: 0 };
  try {
    const res = await fetch(`/api/wa-sync?leadId=${encodeURIComponent(leadId)}`, {
      headers: await authHeaders(),
    });
    if (!res.ok) return vazio;
    return (await res.json()) as WaSyncResult;
  } catch (e) {
    console.warn("[wa] syncThread:", e);
    return vazio;
  }
}

export interface WaSendResult {
  ok: boolean;
  error?: string;
}

export async function sendWaMessage(leadId: string, text: string): Promise<WaSendResult> {
  try {
    const res = await fetch("/api/wa-send", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ leadId, text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Não consegui enviar." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Sem conexão. Tente de novo." };
  }
}

// ── Realtime ────────────────────────────────────────────────────────────────
// ⚠️ Canal do Supabase é identificado pelo NOME. Dois componentes pedindo o
// mesmo nome não viram dois ouvintes: o segundo tenta registrar num canal que já
// foi assinado e o supabase-js estoura "cannot add postgres_changes callbacks
// after subscribe()". Como o dock (badge) e a lista querem o mesmo evento, eles
// DIVIDEM uma assinatura só, e o nome leva um número de série pra nunca colidir
// com um canal antigo que ainda esteja sendo desmontado.

let canalSeq = 0;

const ouvintesThreads = new Set<() => void>();
let canalThreads: ReturnType<typeof supabase.channel> | null = null;

/** Mensagens novas de UM lead. Devolve a função de desinscrever. */
export function subscribeToMessages(leadId: string, onInsert: (m: WaMessage) => void): () => void {
  const ch = supabase
    .channel(`qs_wa_msgs_${leadId}_${++canalSeq}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "qs_wa_messages", filter: `lead_id=eq.${leadId}` },
      (payload) => onInsert(payload.new as WaMessage)
    )
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/**
 * Qualquer mexida na lista de conversas (mensagem nova, não lidas, etc.).
 * Vários componentes podem chamar à vontade — só existe um canal por baixo, e
 * ele é derrubado quando o último ouvinte sai.
 */
export function subscribeToThreads(onChange: () => void): () => void {
  ouvintesThreads.add(onChange);

  if (!canalThreads) {
    canalThreads = supabase
      .channel(`qs_wa_threads_${++canalSeq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "qs_wa_threads" }, () => {
        // Cópia antes de percorrer: um ouvinte pode se remover durante o aviso.
        [...ouvintesThreads].forEach((f) => {
          try { f(); } catch (e) { console.warn("[wa] ouvinte de threads falhou:", e); }
        });
      })
      .subscribe();
  }

  return () => {
    ouvintesThreads.delete(onChange);
    if (ouvintesThreads.size === 0 && canalThreads) {
      supabase.removeChannel(canalThreads);
      canalThreads = null;
    }
  };
}

// ── Formatação ──────────────────────────────────────────────────────────────

export function threadTitle(t: WaThread): string {
  return t.lead?.full_name || t.lead?.first_name || t.lead?.phone || "Lead";
}

/** "14:32" hoje, "ontem", "23/07" mais atrás — como todo app de mensagem faz. */
export function shortWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  if (mesmoDia) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
