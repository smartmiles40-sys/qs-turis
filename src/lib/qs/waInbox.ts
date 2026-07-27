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
  owner_id: string | null;
}

export interface WaThread {
  lead_id: string;
  cw_conversation_id: number | null;
  cw_inbox_id: number | null;
  last_message: string | null;
  last_direction: "in" | "out" | null;
  last_at: string | null;
  last_in_at: string | null;
  last_out_at: string | null;
  unread: number;
  can_reply: boolean | null;
  synced_at: string | null;
  history_synced: boolean | null;
  lead: WaThreadLead | null;
}

const THREAD_COLS =
  "lead_id,cw_conversation_id,cw_inbox_id,last_message,last_direction,last_at," +
  "last_in_at,last_out_at,unread,can_reply,synced_at,history_synced," +
  "lead:qs_leads(id,full_name,first_name,phone,status,owner_id)";

// ── Quem é quem (pra mostrar o dono da conversa e filtrar por SDR) ──────────
// Tabela pequena e quase estática: uma busca por sessão basta. Sem isto, a lista
// teria que fazer um embed aninhado no PostgREST só pra pegar um nome.

export interface UserLite { id: string; name: string; role: string; is_active: boolean }

let usuariosCache: UserLite[] | null = null;

export async function listUsersLite(force = false): Promise<UserLite[]> {
  if (usuariosCache && !force) return usuariosCache;
  const { data, error } = await supabase
    .from("qs_users")
    .select("id,name,role,is_active")
    .order("name");
  if (error) {
    console.warn("[wa] listUsersLite:", error.message);
    return usuariosCache ?? [];
  }
  usuariosCache = (data ?? []) as UserLite[];
  return usuariosCache;
}

/** "Com Closers" = o lead está na mão de alguém com papel de closer. */
export function isCloser(users: UserLite[], ownerId: string | null | undefined): boolean {
  if (!ownerId) return false;
  return users.some((u) => u.id === ownerId && u.role === "closer");
}

export function userName(users: UserLite[], id: string | null | undefined): string | null {
  if (!id) return null;
  return users.find((u) => u.id === id)?.name ?? null;
}

// ── Conversas fixadas ───────────────────────────────────────────────────────

export async function listPinnedLeadIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from("qs_wa_pins").select("lead_id");
  if (error) {
    console.warn("[wa] listPinnedLeadIds:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => (r as { lead_id: string }).lead_id));
}

/** Devolve o novo estado (true = fixada). */
export async function togglePin(leadId: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("qs_wa_toggle_pin", { p_lead: leadId });
  if (error) {
    console.warn("[wa] togglePin:", error.message);
    return null;
  }
  return Boolean(data);
}

// ── Rótulo de cada número (normal x API oficial) ────────────────────────────
// Vive em qs_settings pra o Bruno trocar sem deploy — e porque hoje os dois
// números são Baileys; a distinção "API oficial" só existe quando ele migrar um.

export interface InboxLabel { nome: string; tipo: "normal" | "api" }
export type InboxLabels = Record<string, InboxLabel>;

export const WA_INBOX_LABELS_KEY = "wa_inbox_labels";

export async function getInboxLabels(): Promise<InboxLabels> {
  try {
    const { getSetting } = await import("@/lib/qsSettings");
    const v = await getSetting<InboxLabels>(WA_INBOX_LABELS_KEY);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Um número disponível pra enviar, já com o rótulo que o SDR entende. */
export interface WaNumero {
  id: number;
  nome: string;
  tipo: "normal" | "api";
  canal: string;
  /** É por este que sai quando o SDR não escolhe nada. */
  padrao: boolean;
}

interface WaConfigBruta {
  respostas: CannedResponse[];
  inboxes: { id: number; nome: string; canal: string }[];
  padrao: number | null;
}

// Uma promessa só, compartilhada: o painel pede atalhos e números ao mesmo
// tempo, e sem isso seriam duas chamadas concorrentes pro mesmo endpoint.
let configPromise: Promise<WaConfigBruta> | null = null;

function buscarConfig(force = false): Promise<WaConfigBruta> {
  if (configPromise && !force) return configPromise;
  configPromise = (async () => {
    const vazio: WaConfigBruta = { respostas: [], inboxes: [], padrao: null };
    try {
      const res = await fetch("/api/wa-config", { headers: await authHeaders() });
      if (!res.ok) return vazio;
      const d = await res.json();
      return {
        respostas: Array.isArray(d?.respostas) ? d.respostas : [],
        inboxes: Array.isArray(d?.inboxes) ? d.inboxes : [],
        padrao: d?.padrao ?? null,
      };
    } catch {
      configPromise = null;   // deixa tentar de novo na próxima
      return vazio;
    }
  })();
  return configPromise;
}

/**
 * Quais números estão REALMENTE disponíveis pra enviar. Vem do Chatwoot (só
 * existe caixa se o número estiver conectado) e é enfeitado com os rótulos de
 * Config → Atendimento. Por isso o número da API oficial aparece sozinho no
 * seletor no dia em que você conectar — e some se for removido.
 */
export async function listWaNumeros(force = false): Promise<WaNumero[]> {
  const [cfg, labels] = await Promise.all([buscarConfig(force), getInboxLabels()]);
  const padraoId = Number(cfg.padrao);
  return cfg.inboxes.map((i) => {
    const l = labels[String(i.id)];
    return {
      id: i.id,
      nome: l?.nome || i.nome,
      tipo: l?.tipo === "api" ? "api" : "normal",
      canal: i.canal,
      padrao: i.id === padraoId,
    };
  });
}

export function inboxTag(labels: InboxLabels, inboxId: number | null | undefined) {
  if (inboxId == null) return null;
  const l = labels[String(inboxId)];
  if (!l) return null;
  return { nome: l.nome, tipo: l.tipo, ehApi: l.tipo === "api" };
}

// ── "Esperando resposta" ────────────────────────────────────────────────────

/** Há quanto tempo o cliente falou e ninguém respondeu (null = está em dia). */
export function esperandoDesde(t: WaThread): string | null {
  if (!t.last_in_at) return null;
  if (t.last_out_at && new Date(t.last_out_at) >= new Date(t.last_in_at)) return null;
  return t.last_in_at;
}

export function humanizarEspera(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min}min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

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

export async function sendWaMessage(
  leadId: string,
  text: string,
  inboxId?: number | null
): Promise<WaSendResult> {
  try {
    const res = await fetch("/api/wa-send", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ leadId, text, inboxId: inboxId ?? null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Não consegui enviar." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Sem conexão. Tente de novo." };
  }
}

// ── Mídia (áudio gravado, imagem, arquivo) ──────────────────────────────────

/** Teto do servidor: 3 MB. Imagem grande é comprimida antes de chegar aqui. */
export const MAX_MEDIA_BYTES = 3 * 1024 * 1024;

function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Falha ao ler o arquivo"));
    fr.onload = () => {
      const s = String(fr.result || "");
      resolve(s.slice(s.indexOf(",") + 1));   // tira o "data:...;base64,"
    };
    fr.readAsDataURL(blob);
  });
}

/**
 * Reduz a imagem antes de mandar. Foto de celular tem 4–8 MB e estouraria o
 * limite do servidor — e mandar 8 MB pra chegar num WhatsApp que recomprime
 * tudo é desperdício puro.
 */
export async function comprimirImagem(file: File, maxLado = 1600, qualidade = 0.82): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    if (escala === 1 && file.size <= MAX_MEDIA_BYTES) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", qualidade));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;   // navegador sem createImageBitmap: manda como veio
  }
}

export async function sendWaMedia(
  leadId: string,
  blob: Blob,
  fileName: string,
  caption = "",
  isVoiceMessage = false,
  inboxId?: number | null
): Promise<WaSendResult> {
  if (blob.size > MAX_MEDIA_BYTES) {
    return { ok: false, error: "Arquivo grande demais (máx. 3 MB)." };
  }
  try {
    const dataBase64 = await blobParaBase64(blob);
    const res = await fetch("/api/wa-send-media", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        leadId, fileName, mimeType: blob.type, dataBase64, caption, isVoiceMessage,
        inboxId: inboxId ?? null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Não consegui enviar." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Sem conexão. Tente de novo." };
  }
}

// ── Respostas prontas ───────────────────────────────────────────────────────

export interface CannedResponse { atalho: string; texto: string }

export async function listCanned(): Promise<CannedResponse[]> {
  const cfg = await buscarConfig();
  return cfg.respostas;
}

/** Troca as variáveis do Chatwoot pelo dado real do lead. */
export function preencherCanned(texto: string, lead: { nome?: string | null }): string {
  const primeiro = (lead.nome || "").trim().split(/\s+/)[0] || "";
  return texto
    .replace(/\{\{\s*contact\.first_name\s*\}\}/gi, primeiro)
    .replace(/\{\{\s*contact\.name\s*\}\}/gi, (lead.nome || "").trim());
}

// ── Histórico completo ──────────────────────────────────────────────────────

export interface WaHistoryResult { importadas: number; lidas?: number; completo?: boolean; error?: string }

export async function downloadHistory(leadId: string): Promise<WaHistoryResult> {
  try {
    const res = await fetch("/api/wa-history", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ leadId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { importadas: 0, error: data?.error || "Falha ao baixar." };
    return data as WaHistoryResult;
  } catch {
    return { importadas: 0, error: "Sem conexão." };
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
