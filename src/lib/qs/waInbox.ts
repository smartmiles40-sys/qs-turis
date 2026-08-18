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
import { notifyError } from "@/lib/qs/notify";

/** Uma reação numa mensagem. `autor` é 'lead' ou o uuid do usuário que reagiu. */
export interface WaReacao {
  emoji: string;
  autor: string;
  nome: string | null;
}

export interface WaMessage {
  id: string;
  lead_id: string;
  cw_message_id: number | null;
  direction: "in" | "out";
  content: string | null;
  attachments: { type: string; url: string }[];
  sender_name: string | null;
  sent_at: string;
  /** Só existe depois da migration 0041 — por isso o select pede "*". */
  reactions?: WaReacao[] | null;
  /** Id da mensagem no WhatsApp. Serve pra casar reação e citação. */
  source_id?: string | null;
  // ── Campos da migration 0045 (todos opcionais: sem ela, viram undefined e a
  //    conversa segue funcionando exatamente como antes) ────────────────────
  /** Recibo do WhatsApp: sent | delivered | read | failed. Só em mensagem nossa. */
  status?: "sent" | "delivered" | "read" | "failed" | null;
  /** Carimbo de "não está mais no WhatsApp do cliente". O conteúdo FICA aqui. */
  deleted_at?: string | null;
  /** A mensagem que esta aqui está respondendo (id dela no WhatsApp). */
  reply_to_source_id?: string | null;
  /** Trecho da citada, guardado junto porque ela pode nem estar importada. */
  reply_preview?: string | null;
  /** Texto do áudio (migration 0051). Só existe depois que alguém transcreve. */
  transcricao?: string | null;
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
  /** Foto de perfil do WhatsApp. Só existe depois da migration 0026 — por isso
   *  a busca pede "*" em vez de listar colunas: sem ela, vem undefined e o
   *  avatar cai nas iniciais, em vez de a lista inteira quebrar. */
  avatar_url?: string | null;
  lead: WaThreadLead | null;
}

const THREAD_COLS = "*,lead:qs_leads(id,full_name,first_name,phone,status,owner_id)";

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
//
// O tipo é DERIVADO do canal que o Chatwoot informa, não digitado à mão. Antes
// dependia só de qs_settings.wa_inbox_labels — e como esse registro nunca foi
// preenchido, `inboxTag` devolvia null para TODAS as conversas e o selo nunca
// apareceu pra ninguém, em nenhuma das 566 conversas da base.
//
// O canal é um sinal confiável e automático:
//   Channel::Whatsapp → API oficial da Meta (Cloud API / 360dialog)
//   Channel::Api      → número comum, via Evolution (Baileys/QR)
//
// A configuração manual continua existindo e VENCE quando preenchida: serve pra
// dar um nome humano ("Comercial", "Pós-venda") a cada número. O que ela deixa
// de fazer é ser condição pro selo existir.

export interface InboxLabel { nome: string; tipo: "normal" | "api"; telefone?: string | null }
export type InboxLabels = Record<string, InboxLabel>;

/** "+551148636051" → "11 4863-6051" (o que o SDR reconhece de bater o olho). */
export function numeroCurto(tel: string | null | undefined): string | null {
  const d = String(tel || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  const sem55 = d.startsWith("55") ? d.slice(2) : d;
  const ddd = sem55.slice(0, 2);
  const resto = sem55.slice(2);
  if (resto.length < 8) return null;
  return `${ddd} ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`;
}

export const WA_INBOX_LABELS_KEY = "wa_inbox_labels";

/** Canal do Chatwoot → é número oficial da Meta? */
export function canalEhApiOficial(canal: string | null | undefined): boolean {
  return String(canal || "").toLowerCase().includes("whatsapp");
}

export async function getInboxLabels(): Promise<InboxLabels> {
  // Base automática: uma entrada por caixa que existe de verdade no Chatwoot.
  const auto: InboxLabels = {};
  try {
    const cfg = await buscarConfig();
    for (const i of cfg.inboxes) {
      auto[String(i.id)] = {
        nome: i.nome,
        tipo: canalEhApiOficial(i.canal) ? "api" : "normal",
        telefone: i.telefone ?? null,
      };
    }
  } catch { /* sem config, segue só com o que estiver salvo à mão */ }

  // Ajuste manual por cima (só o que foi realmente preenchido).
  try {
    const { getSetting } = await import("@/lib/qsSettings");
    const v = await getSetting<InboxLabels>(WA_INBOX_LABELS_KEY);
    if (v && typeof v === "object") {
      for (const [id, l] of Object.entries(v)) {
        if (!l) continue;
        auto[id] = {
          nome: l.nome || auto[id]?.nome || `Caixa ${id}`,
          tipo: l.tipo === "api" || l.tipo === "normal" ? l.tipo : (auto[id]?.tipo ?? "normal"),
          // O telefone vem do Chatwoot, não do ajuste manual — o ajuste é só
          // pra dar nome humano à caixa.
          telefone: auto[id]?.telefone ?? null,
        };
      }
    }
  } catch { /* segue com a base automática */ }

  return auto;
}

/** Um número disponível pra enviar, já com o rótulo que o SDR entende. */
export interface WaNumero {
  id: number;
  nome: string;
  tipo: "normal" | "api";
  canal: string;
  /** O telefone da caixa, quando o Chatwoot informa. */
  telefone: string | null;
  /** O mesmo telefone já legível: "11 4863-6051". */
  numero: string | null;
  /** É por este que sai quando o SDR não escolhe nada. */
  padrao: boolean;
}

/** Template aprovado na Meta (número oficial) — vem pronto do /api/wa-config. */
export interface WaModelo {
  inboxId: number;
  nome: string;
  idioma: string;
  categoria: string;
  cabecalho: string | null;
  corpo: string;
  rodape: string | null;
  /** Chaves dos {{buracos}} do corpo, na ordem em que aparecem. */
  variaveis: string[];
}

interface WaConfigBruta {
  respostas: CannedResponse[];
  inboxes: { id: number; nome: string; canal: string; telefone?: string | null }[];
  modelos: WaModelo[];
  padrao: number | null;
}

// Uma promessa só, compartilhada: o painel pede atalhos e números ao mesmo
// tempo, e sem isso seriam duas chamadas concorrentes pro mesmo endpoint.
let configPromise: Promise<WaConfigBruta> | null = null;

function buscarConfig(force = false): Promise<WaConfigBruta> {
  if (configPromise && !force) return configPromise;
  configPromise = (async () => {
    const vazio: WaConfigBruta = { respostas: [], inboxes: [], modelos: [], padrao: null };
    try {
      const res = await fetch("/api/wa-config", { headers: await authHeaders() });
      if (!res.ok) return vazio;
      const d = await res.json();
      return {
        respostas: Array.isArray(d?.respostas) ? d.respostas : [],
        inboxes: Array.isArray(d?.inboxes) ? d.inboxes : [],
        modelos: Array.isArray(d?.modelos) ? d.modelos : [],
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
      // Sem ajuste manual, o tipo vem do canal do Chatwoot — não do padrão
      // "normal", que marcaria o número oficial como comum.
      tipo: l?.tipo ?? (canalEhApiOficial(i.canal) ? "api" : "normal"),
      canal: i.canal,
      telefone: i.telefone ?? null,
      numero: numeroCurto(i.telefone),
      padrao: i.id === padraoId,
    };
  });
}

/** Templates aprovados da Meta (vazio se o número oficial não está ligado). */
export async function listWaModelos(): Promise<WaModelo[]> {
  const cfg = await buscarConfig();
  return cfg.modelos;
}

// ── Portal de modelos (admin) ───────────────────────────────────────────────
// Aqui é a visão de QUEM ADMINISTRA: todos os modelos, inclusive em análise e
// reprovados — ao contrário de listWaModelos, que só entrega o que dá pra enviar.

export interface WaModeloAdmin extends WaModelo {
  id: string;
  /** APPROVED | PENDING | REJECTED | PAUSED — como a Meta chama. */
  status: string;
  /** Por que a Meta recusou, quando recusou. */
  motivo: string | null;
  /** Modelo com cabeçalho de mídia (IMAGE/VIDEO) — não dá pra enviar pelo QS. */
  cabecalhoMidia?: string | null;
}

export async function listarModelosAdmin(): Promise<{ modelos: WaModeloAdmin[]; error?: string }> {
  try {
    const res = await fetch("/api/wa-config?modelos=todos", { headers: await authHeaders() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { modelos: [], error: d?.error || "Não consegui carregar os modelos." };
    return { modelos: Array.isArray(d?.modelos) ? d.modelos : [] };
  } catch {
    return { modelos: [], error: "Sem conexão." };
  }
}

export interface NovoModelo {
  nome: string;
  categoria: "MARKETING" | "UTILITY";
  idioma: string;
  corpo: string;
  cabecalho?: string;
  rodape?: string;
}

export async function criarModeloNaMeta(m: NovoModelo): Promise<{ ok: boolean; status?: string; error?: string }> {
  try {
    const res = await fetch("/api/wa-config", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ acao: "criar", ...m }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: d?.error || "Não consegui enviar o modelo." };
    return { ok: true, status: d?.status };
  } catch {
    return { ok: false, error: "Sem conexão." };
  }
}

export async function excluirModeloNaMeta(nome: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/wa-config", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ acao: "excluir", nome }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: d?.error || "Não consegui excluir." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Sem conexão." };
  }
}

/** O corpo do modelo com as variáveis preenchidas (pré-visualização do envio). */
export function previewModelo(m: WaModelo, valores: Record<string, string>): string {
  return m.corpo.replace(/{{\s*([^}]+?)\s*}}/g, (todo, chave) => {
    const v = valores[chave]?.trim();
    return v ? v : todo;
  });
}

// ── Janela de 24h da API oficial ────────────────────────────────────────────
// A Meta só aceita texto livre até 24h depois da ÚLTIMA mensagem do cliente.
// Depois disso (ou numa conversa que ele nunca respondeu), só template.

export const JANELA_24H_MS = 24 * 3600_000;

/** Quando a janela fecha (null = o cliente nunca escreveu → já precisa de modelo). */
export function janelaFechaEm(lastInAt: string | null | undefined): Date | null {
  if (!lastInAt) return null;
  const t = new Date(lastInAt).getTime();
  return Number.isFinite(t) ? new Date(t + JANELA_24H_MS) : null;
}

/** "21h 32min" / "47min" — o que falta pra janela fechar. */
export function humanizarJanela(msRestante: number): string {
  const min = Math.max(0, Math.floor(msRestante / 60_000));
  if (min < 60) return `${min}min`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}min`;
}

export function inboxTag(labels: InboxLabels, inboxId: number | null | undefined) {
  if (inboxId == null) return null;
  const l = labels[String(inboxId)];
  if (!l) return null;
  return {
    nome: l.nome,
    tipo: l.tipo,
    ehApi: l.tipo === "api",
    telefone: l.telefone ?? null,
    numero: numeroCurto(l.telefone),
  };
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

/**
 * Conversas visíveis pra quem está logado (a RLS já corta as dos outros).
 *
 * O teto era 100 e cortava calado: com mais de mil conversas, "Equipe" e
 * "Todos" mostravam só as cem mais recentes e o resto simplesmente não existia
 * na tela (Bruno, 18/08: "tire o limitador de 100"). Agora vem tudo, e quem
 * enxuga a lista é o filtro de quem está esperando resposta — que a tela liga
 * sozinha nessas duas abas.
 */
export async function listMyThreads(limit = 2000): Promise<WaThread[]> {
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

/**
 * Por qual dos nossos números esta conversa acontece. O SDR precisa ver isso
 * ANTES de escrever — cada conversa do Chatwoot pertence a um número só, e o
 * cliente vê a mensagem chegando daquele contato.
 */
export async function getThreadInbox(leadId: string): Promise<{ inbox: number | null; avatar: string | null }> {
  const { data, error } = await supabase
    .from("qs_wa_threads")
    .select("*")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error || !data) return { inbox: null, avatar: null };
  const d = data as { cw_inbox_id?: number | null; avatar_url?: string | null };
  return { inbox: d.cw_inbox_id ?? null, avatar: d.avatar_url ?? null };
}

export async function listMessages(leadId: string, limit = 200): Promise<WaMessage[]> {
  // "*" de propósito (mesma lição do avatar_url): a coluna `reactions` só existe
  // depois da 0041 — listar colunas quebraria a conversa inteira num banco que
  // ainda não recebeu a migration.
  //
  // DESCENDENTE + reverse: o corte de 200 tem que ficar com as mais RECENTES.
  // Ascendente com limit devolvia as 200 mais antigas — conversa longa abria
  // sem as últimas mensagens (elas só apareciam quando chegava algo novo pelo
  // realtime).
  const { data, error } = await supabase
    .from("qs_wa_messages")
    .select("*")
    .eq("lead_id", leadId)
    .order("sent_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[wa] listMessages:", error.message);
    return [];
  }
  return ((data ?? []) as WaMessage[]).reverse();
}

/** Zera o contador de não lidas (única escrita do navegador — e via função). */
// ── Exportar a conversa (.txt) ───────────────────────────────────────────────

/**
 * Baixa a conversa INTEIRA como .txt, no formato do "Exportar conversa" do
 * próprio WhatsApp (pedido do time, 14/08) — serve pra anexar em proposta,
 * encaminhar por e-mail ou guardar fora do QS.
 *
 * Paginado de propósito: o listMessages da tela corta em 200 (é uma TELA);
 * exportar é outro trabalho — precisa de TUDO, e conversa longa já passa de
 * mil mensagens. A RLS decide o que o usuário pode ler, como sempre.
 */
export async function exportarConversaTxt(leadId: string, titulo: string, phone?: string | null): Promise<boolean> {
  try {
    const todas: WaMessage[] = [];
    for (let page = 0; ; page++) {
      const de = page * 1000;
      const { data, error } = await supabase
        .from("qs_wa_messages")
        .select("*")
        .eq("lead_id", leadId)
        .order("sent_at", { ascending: true })
        .order("id")
        .range(de, de + 999);
      if (error) throw error;
      const rows = (data ?? []) as WaMessage[];
      todas.push(...rows);
      if (rows.length < 1000) break;
    }
    if (!todas.length) {
      notifyError("Esta conversa ainda não tem mensagens para exportar.");
      return false;
    }

    const dt = (iso: string) => {
      const d = new Date(iso);
      const dd = (n: number) => String(n).padStart(2, "0");
      return `${dd(d.getDate())}/${dd(d.getMonth() + 1)}/${d.getFullYear()} ${dd(d.getHours())}:${dd(d.getMinutes())}`;
    };

    const linhas: string[] = [
      `Conversa de WhatsApp — ${titulo}${phone ? ` (${phone})` : ""}`,
      `Exportada do QS em ${dt(new Date().toISOString())} — ${todas.length} mensagens`,
      "",
    ];
    for (const m of todas) {
      const autor = m.direction === "in" ? titulo : (m.sender_name || "Equipe");
      const partes: string[] = [];
      if (m.content) partes.push(m.content);
      for (const a of m.attachments ?? []) partes.push(`[${a.type || "anexo"}] ${a.url}`);
      if (!partes.length) partes.push("[mensagem sem texto]");
      const marca = m.deleted_at ? " [apagada no WhatsApp — texto preservado no QS]" : "";
      // Mensagem com quebra de linha vira linhas indentadas, como no export do WhatsApp.
      const texto = partes.join("\n").split("\n").join("\n    ");
      linhas.push(`${dt(m.sent_at)} - ${autor}: ${texto}${marca}`);
    }

    const blob = new Blob(["﻿" + linhas.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `WhatsApp - ${titulo.replace(/[\\/:*?"<>|]+/g, "_").trim() || "conversa"}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revogar já quebraria o download no Safari; um minuto depois é seguro.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch (e) {
    console.warn("[wa] exportar conversa:", e);
    notifyError("Não foi possível exportar a conversa — tente de novo.");
    return false;
  }
}

export async function markThreadRead(leadId: string): Promise<void> {
  const { error } = await supabase.rpc("qs_wa_mark_read", { p_lead: leadId });
  if (error) console.warn("[wa] markThreadRead:", error.message);
}

/**
 * Marca a conversa como NÃO LIDA — o "deixo pra depois e não quero esquecer".
 * Devolve false quando o banco ainda não tem a função (migration 0045), pra
 * tela avisar em vez de fingir que marcou.
 */
export async function markThreadUnread(leadId: string): Promise<boolean> {
  const { error } = await supabase.rpc("qs_wa_mark_unread", { p_lead: leadId });
  if (error) {
    console.warn("[wa] markThreadUnread:", error.message);
    return false;
  }
  return true;
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
  inboxId?: number | null,
  /** Id (no QS) da mensagem que esta está respondendo — a citação do WhatsApp. */
  respondendoA?: string | null
): Promise<WaSendResult> {
  try {
    const res = await fetch("/api/wa-send", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ leadId, text, inboxId: inboxId ?? null, respondendoA: respondendoA ?? null }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Não consegui enviar." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Sem conexão. Tente de novo." };
  }
}

/**
 * Envia um TEMPLATE aprovado da Meta (o único jeito de falar fora da janela de
 * 24h ou de abrir conversa pelo número oficial). O corpo real é resolvido no
 * servidor a partir do template do Chatwoot — daqui vão só o nome e os valores.
 */
export async function sendWaTemplate(
  leadId: string,
  modelo: WaModelo,
  valores: Record<string, string>
): Promise<WaSendResult> {
  try {
    const res = await fetch("/api/wa-send", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        leadId,
        modelo: { nome: modelo.nome, idioma: modelo.idioma, params: valores },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Não consegui enviar o modelo." };
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
  // WebP passa intacto: figurinha de WhatsApp É um .webp, e reencodar pra JPEG
  // mataria a transparência e a chance de a Evolution tratá-la como figurinha.
  if (file.type === "image/webp") return file;
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

// ── Reações ─────────────────────────────────────────────────────────────────

export interface WaReactResult {
  ok: boolean;
  /** A lista nova de reações da mensagem (já com a troca aplicada). */
  reactions?: WaReacao[];
  /** true = a reação chegou no WhatsApp do cliente; false = ficou só no QS. */
  entregue?: boolean;
  motivo?: string | null;
  error?: string;
}

/** Reage a uma mensagem (emoji "" remove). Uma reação por pessoa, como no WhatsApp. */
export async function reagirMensagem(
  leadId: string,
  messageId: string,
  emoji: string
): Promise<WaReactResult> {
  try {
    const res = await fetch("/api/wa-react", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ leadId, messageId, emoji }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Não consegui reagir." };
    return { ok: true, reactions: data?.reactions ?? [], entregue: data?.entregue === true, motivo: data?.motivo ?? null };
  } catch {
    return { ok: false, error: "Sem conexão. Tente de novo." };
  }
}

/**
 * Apaga a mensagem no WhatsApp do CLIENTE. Aqui ela continua: o QS é o arquivo
 * da conversa, e some dele seria perder a auditoria do que foi combinado — a
 * mensagem só ganha a marca `deleted_at` (migration 0046).
 *
 * O servidor recusa mensagem do cliente e mensagem velha demais, e devolve o
 * motivo em português pra tela repassar como está.
 */
/**
 * Transcreve o áudio de uma mensagem. O texto fica guardado na própria mensagem,
 * então o segundo clique (de qualquer pessoa) volta instantâneo.
 */
export async function transcreverAudio(leadId: string, messageId: string): Promise<{ texto?: string; error?: string }> {
  try {
    const res = await fetch("/api/wa-react", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ leadId, messageId, acao: "transcrever" }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { error: d?.error || "Não consegui transcrever." };
    return { texto: String(d?.texto || "") };
  } catch {
    return { error: "Sem conexão." };
  }
}

export async function apagarMensagem(
  leadId: string,
  messageId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/wa-react", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ leadId, messageId, acao: "apagar" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Não consegui apagar." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Sem conexão. Tente de novo." };
  }
}

/**
 * Preenche as fotos de perfil que faltam, em lote (só gestor/admin).
 * Roda de N em N de propósito: do outro lado é um WhatsApp de verdade, e
 * rajada de consulta é o padrão que derruba número por abuso.
 */
export async function preencherFotos(
  quantidade = 25
): Promise<{ ok: boolean; preenchidas: number; tentadas: number; error?: string }> {
  try {
    const res = await fetch(`/api/wa-sync?fotos=${quantidade}`, { headers: await authHeaders() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false, preenchidas: 0, tentadas: 0,
        error: d?.error || (d?.motivo === "evolution-nao-configurada"
          ? "A Evolution não está configurada na Vercel (faltam EVOLUTION_URL e EVOLUTION_APIKEY)."
          : "Não consegui buscar as fotos."),
      };
    }
    return { ok: true, preenchidas: d?.preenchidas ?? 0, tentadas: d?.tentadas ?? 0 };
  } catch {
    return { ok: false, preenchidas: 0, tentadas: 0, error: "Sem conexão. Tente de novo." };
  }
}

// ── Figurinhas (a galeria pessoal do SDR) ───────────────────────────────────
// `dado` é um data-url (figurinha que o SDR subiu, convertida no navegador) ou
// a URL do Chatwoot (figurinha salva de uma conversa). A tabela tem RLS por
// dono — cada um enxerga só a própria galeria.

export interface Figurinha { id: string; dado: string }

export async function listFigurinhas(): Promise<Figurinha[]> {
  const { data, error } = await supabase
    .from("qs_wa_figurinhas")
    .select("id,dado")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[wa] listFigurinhas:", error.message);
    return [];
  }
  return (data ?? []) as Figurinha[];
}

/** Guarda na galeria. Salvar a mesma figurinha duas vezes não duplica. */
export async function salvarFigurinha(dado: string): Promise<{ ok: boolean; error?: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return { ok: false, error: "Sessão expirada." };
  const { error } = await supabase.from("qs_wa_figurinhas").insert({ user_id: uid, dado });
  if (error) {
    if (error.code === "23505") return { ok: true };   // já estava salva
    if (/qs_wa_figurinhas/.test(error.message) && /not exist|não existe/i.test(error.message)) {
      return { ok: false, error: "Galeria ainda não ativada no banco (falta a migration 0041)." };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function removerFigurinha(id: string): Promise<boolean> {
  const { error } = await supabase.from("qs_wa_figurinhas").delete().eq("id", id);
  if (error) console.warn("[wa] removerFigurinha:", error.message);
  return !error;
}

/** Manda uma figurinha da galeria pra conversa. */
export async function enviarFigurinha(leadId: string, fig: Figurinha): Promise<WaSendResult> {
  // Subida pelo SDR: o arquivo está no próprio dado (data-url) — vira Blob e
  // segue o caminho normal de mídia.
  if (fig.dado.startsWith("data:")) {
    const blob = await (await fetch(fig.dado)).blob();
    return sendWaMedia(leadId, blob, "figurinha.webp", "", false);
  }
  // Salva de uma conversa: só temos a URL do Chatwoot, e o CORS impede o
  // navegador de baixá-la — quem busca o arquivo é o servidor.
  try {
    const res = await fetch("/api/wa-send-media", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ leadId, stickerUrl: fig.dado, fileName: "figurinha.webp" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Não consegui enviar." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Sem conexão. Tente de novo." };
  }
}

/**
 * Converte uma imagem qualquer (png/jpg/webp) em figurinha: quadrado de 512px
 * com fundo transparente, webp — o formato que o WhatsApp trata como sticker.
 * Devolve o data-url pronto pra galeria.
 */
export async function converterParaFigurinha(file: File): Promise<{ dado?: string; error?: string }> {
  if (!file.type.startsWith("image/")) return { error: "Escolha uma imagem." };
  try {
    const bitmap = await createImageBitmap(file);
    const LADO = 512;
    const canvas = document.createElement("canvas");
    canvas.width = LADO;
    canvas.height = LADO;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { error: "Navegador sem suporte." };
    // "contain": a imagem inteira aparece, centrada, sobra transparente.
    const escala = Math.min(LADO / bitmap.width, LADO / bitmap.height);
    const w = Math.round(bitmap.width * escala);
    const h = Math.round(bitmap.height * escala);
    ctx.drawImage(bitmap, (LADO - w) / 2, (LADO - h) / 2, w, h);

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.9));
    if (!blob || blob.type !== "image/webp") {
      // Safari não exporta webp; sem webp não existe figurinha de verdade.
      return { error: "Este navegador não gera figurinha (use o Chrome ou Edge)." };
    }
    if (blob.size > 300 * 1024) return { error: "Imagem complexa demais pra virar figurinha." };

    const dado = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("falha ao ler"));
      fr.onload = () => resolve(String(fr.result || ""));
      fr.readAsDataURL(blob);
    });
    return { dado };
  } catch {
    return { error: "Não consegui converter a imagem." };
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

/**
 * Mensagens novas de UM lead — e, com `onUpdate`, também as MUDANÇAS nas que já
 * estão na tela (hoje isso significa: chegou/saiu uma reação). Devolve a função
 * de desinscrever.
 */
export function subscribeToMessages(
  leadId: string,
  onInsert: (m: WaMessage) => void,
  onUpdate?: (m: WaMessage) => void
): () => void {
  let ch = supabase
    .channel(`qs_wa_msgs_${leadId}_${++canalSeq}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "qs_wa_messages", filter: `lead_id=eq.${leadId}` },
      (payload) => onInsert(payload.new as WaMessage)
    );
  if (onUpdate) {
    ch = ch.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "qs_wa_messages", filter: `lead_id=eq.${leadId}` },
      (payload) => onUpdate(payload.new as WaMessage)
    );
  }
  ch.subscribe();
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
