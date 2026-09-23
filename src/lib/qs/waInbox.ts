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
// que revalida a posse do lead no servidor antes de falar com a Meta.
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

/** Template aprovado na Meta (número oficial) — vem pronto do /api/wa-config. */
export interface WaModelo {
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
  modelos: WaModelo[];
}

// Uma promessa só, compartilhada: o painel pede atalhos e modelos ao mesmo
// tempo, e sem isso seriam duas chamadas concorrentes pro mesmo endpoint.
let configPromise: Promise<WaConfigBruta> | null = null;

function buscarConfig(force = false): Promise<WaConfigBruta> {
  if (configPromise && !force) return configPromise;
  configPromise = (async () => {
    const vazio: WaConfigBruta = { respostas: [], modelos: [] };
    try {
      const res = await fetch("/api/wa-config", { headers: await authHeaders() });
      if (!res.ok) return vazio;
      const d = await res.json();
      return {
        respostas: Array.isArray(d?.respostas) ? d.respostas : [],
        modelos: Array.isArray(d?.modelos) ? d.modelos : [],
      };
    } catch {
      configPromise = null;   // deixa tentar de novo na próxima
      return vazio;
    }
  })();
  return configPromise;
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
/** O PostgREST devolve o embed como objeto ou array de 1 conforme a relação. */
function mapearThreads(rows: unknown[]): WaThread[] {
  return rows.map((r) => {
    const raw = r as Record<string, unknown>;
    const lead = Array.isArray(raw.lead) ? (raw.lead[0] ?? null) : (raw.lead ?? null);
    return { ...(raw as unknown as WaThread), lead: lead as WaThreadLead | null };
  });
}

export async function listMyThreads(limit = 20000): Promise<WaThread[]> {
  // PAGINADO — o `.limit(2000)` de antes mentia. O PostgREST corta TODA
  // resposta em 1000 linhas (max-rows do Supabase) e não avisa: voltava
  // 200 OK com "Content-Range: 0-999" e o resto da lista simplesmente não
  // existia na tela. Com 2.593 conversas ordenadas por last_at, sumia tudo
  // que parou de falar há mais de ~5 dias — 1.593 delas — e a busca da
  // lista, que filtra em MEMÓRIA, não achava nem por nome nem por telefone
  // (Bruno, 01/09: um lead com comprovante pago estava invisível assim).
  // Mesmo teto que já tinha mordido o LeadsPage e as views da 0043 em 13/08.
  //
  // O desempate por lead_id (a PK) é obrigatório: sem ele, duas conversas
  // com o mesmo last_at podem trocar de lugar entre uma página e outra, e aí
  // a paginação repete uma e PULA a outra.
  const linhas: unknown[] = [];
  for (let page = 0; linhas.length < limit; page++) {
    const de = page * 1000;
    const { data, error } = await supabase
      .from("qs_wa_threads")
      .select(THREAD_COLS)
      .order("last_at", { ascending: false, nullsFirst: false })
      .order("lead_id")
      .range(de, Math.min(de + 999, limit - 1));
    if (error) {
      console.warn("[wa] listMyThreads:", error.message);
      // Meia lista é melhor que lista nenhuma: quem já veio, fica.
      return mapearThreads(linhas);
    }
    const rows = data ?? [];
    linhas.push(...rows);
    if (rows.length < 1000) break;
  }
  return mapearThreads(linhas);
}

/**
 * Total de não lidas do usuário logado (badge do botão flutuante).
 *
 * Escopado nos leads DELE de propósito. Desde a 0050 o closer enxerga as
 * conversas da empresa toda: sem este recorte o badge diria "437 esperando
 * você" e o app apitaria a cada mensagem que qualquer SDR recebesse, o dia
 * inteiro — o aviso viraria ruído e ele desligaria os avisos. A LISTA continua
 * ampla; o que se estreita é só a cobrança de atenção.
 */
export async function countUnread(): Promise<number> {
  const { data: sessao } = await supabase.auth.getUser();
  const eu = sessao?.user?.id ?? null;
  if (!eu) return 0;

  const { data: perfil } = await supabase.from("qs_users").select("role").eq("id", eu).maybeSingle();
  const papel = (perfil as { role?: string } | null)?.role ?? "sdr";

  // Gestão continua vendo o total da operação — é o número que ela usa pra
  // saber se o time está dando conta. Só quem executa é que precisa de um
  // badge sobre O SEU trabalho.
  if (papel === "admin" || papel === "gestor") {
    const { data, error } = await supabase.from("qs_wa_threads").select("unread").gt("unread", 0);
    if (error) return 0;
    return (data ?? []).reduce((s, r) => s + ((r as { unread: number }).unread || 0), 0);
  }

  // O closer não tem carteira: o que é "dele" são as conversas dos clientes
  // com quem ele TEM REUNIÃO, mais as que lhe foram transferidas.
  let meusLeads: string[] = [];
  if (papel === "closer") {
    const { data: reunioes } = await supabase
      .from("qs_meetings")
      .select("lead_id")
      .eq("closer_id", eu)
      .in("status", ["agendada", "confirmada"]);
    meusLeads = [...new Set((reunioes ?? []).map((r) => (r as { lead_id: string }).lead_id))];
  }

  const q = supabase.from("qs_wa_threads").select("unread, lead:qs_leads!inner(owner_id)").gt("unread", 0);
  const { data, error } = meusLeads.length
    ? await q.or(`lead_id.in.(${meusLeads.join(",")}),lead.owner_id.eq.${eu}`)
    : await q.eq("lead.owner_id", eu);
  if (error) return 0;
  return (data ?? []).reduce((s, r) => s + ((r as { unread: number }).unread || 0), 0);
}

/** Foto do cliente guardada na conversa (só as antigas têm: a Meta não manda foto). */
export async function getThreadAvatar(leadId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("qs_wa_threads")
    .select("*")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { avatar_url?: string | null }).avatar_url ?? null;
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

export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  } catch { /* sem sessão — o servidor nega */ }
  return headers;
}

export interface WaSendResult {
  ok: boolean;
  error?: string;
}

export async function sendWaMessage(
  leadId: string,
  text: string,
  /** Id (no QS) da mensagem que esta está respondendo — a citação do WhatsApp. */
  respondendoA?: string | null
): Promise<WaSendResult> {
  try {
    const res = await fetch("/api/wa-send", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ leadId, text, respondendoA: respondendoA ?? null }),
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
 * 24h ou de abrir conversa). O corpo real é resolvido no servidor a partir do
 * modelo da Meta — daqui vão só o nome e os valores.
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
  // mataria a transparência e a chance de ela chegar como figurinha.
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
  caption = ""
): Promise<WaSendResult> {
  if (blob.size > MAX_MEDIA_BYTES) {
    return { ok: false, error: "Arquivo grande demais (máx. 3 MB)." };
  }
  try {
    const dataBase64 = await blobParaBase64(blob);
    const res = await fetch("/api/wa-send-media", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ leadId, fileName, mimeType: blob.type, dataBase64, caption }),
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
 * Guarda o texto do áudio na mensagem. A transcrição em si acontece na máquina
 * do SDR (ver transcricaoLocal.ts) — aqui só persistimos o resultado, pra quem
 * abrir a conversa depois já ler sem processar de novo.
 */
export async function salvarTranscricao(messageId: string, texto: string): Promise<void> {
  // Via RPC, não update direto: qs_wa_messages não tem policy de UPDATE (a 0024
  // fechou de propósito), então o update saía com 0 linhas e SEM erro — falha
  // silenciosa que fazia o Whisper reprocessar o mesmo áudio a cada abertura.
  // A função da 0052 só encosta nesta coluna e só de quem pode ver a conversa.
  const { error } = await supabase.rpc("qs_wa_salvar_transcricao", { p_msg: messageId, p_texto: texto });
  // Enquanto a 0052 não estiver aplicada, o texto continua na tela desta sessão
  // — só não fica salvo. Não vale incomodar quem está atendendo com isso.
  if (error) console.warn("[wa] transcrição não pôde ser salva:", error.message);
}

/**
 * Esconde a mensagem NOSSA da tela do QS (marca `deleted_at`). A Meta não tem
 * "apagar para todos": o cliente continua vendo — `aviso` diz isso.
 */
export async function apagarMensagem(
  leadId: string,
  messageId: string
): Promise<{ ok: boolean; error?: string; aviso?: string }> {
  try {
    const res = await fetch("/api/wa-react", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ leadId, messageId, acao: "apagar" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Não consegui esconder." };
    return { ok: true, aviso: data?.aviso };
  } catch {
    return { ok: false, error: "Sem conexão. Tente de novo." };
  }
}

// ── Figurinhas (a galeria pessoal do SDR) ───────────────────────────────────
// `dado` é um data-url (figurinha que o SDR subiu, convertida no navegador) ou
// a URL do nosso bucket (figurinha salva de uma conversa). A tabela tem RLS por
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
    return sendWaMedia(leadId, blob, "figurinha.webp");
  }
  // Salva de uma conversa: só temos a URL — quem busca o arquivo é o servidor
  // (e ele só aceita o nosso bucket wa-midia; URL antiga do Chatwoot é recusada).
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

export async function listCanned(force = false): Promise<CannedResponse[]> {
  const cfg = await buscarConfig(force);
  return cfg.respostas;
}

/** Salva a lista inteira (só admin/gestor). Devolve a lista já limpa pelo servidor. */
export async function salvarRespostasProntas(
  respostas: CannedResponse[]
): Promise<{ ok: boolean; respostas?: CannedResponse[]; error?: string }> {
  try {
    const res = await fetch("/api/wa-config", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ acao: "respostas-salvar", respostas }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: d?.error || "Não consegui salvar." };
    configPromise = null;   // o chat relê na próxima abertura
    return { ok: true, respostas: Array.isArray(d?.respostas) ? d.respostas : respostas };
  } catch {
    return { ok: false, error: "Sem conexão." };
  }
}

/** Troca as variáveis {{contact.name}} / {{contact.first_name}} pelo dado real do lead. */
export function preencherCanned(texto: string, lead: { nome?: string | null }): string {
  const primeiro = (lead.nome || "").trim().split(/\s+/)[0] || "";
  return texto
    .replace(/\{\{\s*contact\.first_name\s*\}\}/gi, primeiro)
    .replace(/\{\{\s*contact\.name\s*\}\}/gi, (lead.nome || "").trim());
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
  // DEBOUNCE de 1,5s: cada mensagem de QUALQUER conversa mexe em qs_wa_threads,
  // e desde a 0050 o closer enxerga a empresa inteira — sem agrupar, cada
  // mensagem do time disparava um recarregamento de 2.000 linhas com embed.
  let timer: number | null = null;
  const agrupado = () => {
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => { timer = null; onChange(); }, 1_500);
  };

  ouvintesThreads.add(agrupado);

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
    ouvintesThreads.delete(agrupado);
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

// ── Ligação pelo WhatsApp (Cloud API Calling) ───────────────────────────────
// Trilho separado do de mensagem: template não pede permissão de ligação, e
// ativar o webhook `calls` não faz template aparecer.

export interface ConfigChamadas {
  status?: string;
  call_icon_visibility?: string;
  callback_permission_status?: string;
  call_hours?: unknown;
  sip?: unknown;
}

export async function lerChamadas(): Promise<{ calling: ConfigChamadas | null; phoneId?: string; error?: string }> {
  try {
    const res = await fetch("/api/wa-config?calling=1", { headers: await authHeaders() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { calling: null, error: d?.error || "Não consegui ler as configurações de chamada." };
    return { calling: d?.calling ?? null, phoneId: d?.phoneId };
  } catch {
    return { calling: null, error: "Sem conexão." };
  }
}

export async function ativarChamadasNaMeta(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/wa-config", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ acao: "calling-ativar" }),
    });
    const d = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: d?.error || "A Meta recusou." };
  } catch {
    return { ok: false, error: "Sem conexão." };
  }
}

export async function pedirPermissaoLigacao(telefone: string, texto?: string): Promise<{ ok: boolean; wamid?: string; error?: string }> {
  try {
    const res = await fetch("/api/wa-config", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ acao: "calling-permissao", telefone, texto }),
    });
    const d = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, wamid: d?.wamid } : { ok: false, error: d?.error || "A Meta recusou." };
  } catch {
    return { ok: false, error: "Sem conexão." };
  }
}

/** O que a Meta responde sobre a ligação, junto num lugar só (ver `diagnosticoChamadas`). */
export interface DiagnosticoChamadas {
  phoneId?: string | null;
  waba?: string | null;
  calling?: ConfigChamadas | null;
  callingErro?: string;
  numeros?: { id: string; numero?: string; nome?: string }[];
  numerosErro?: string;
  apps?: { id: string | null; nome: string | null }[];
  appsErro?: string;
  campos?: string[];
  assinaCalls?: boolean;
  callbackUrl?: string | null;
  camposErro?: string;
  eventos?: { recebido_em: string; evento?: string | null; direcao?: string | null; de?: string | null; para?: string | null }[];
}

export async function lerDiagnosticoChamadas(): Promise<{ diag: DiagnosticoChamadas | null; error?: string }> {
  try {
    const res = await fetch("/api/wa-config?calling=diag", { headers: await authHeaders() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { diag: null, error: d?.error || "Não consegui ler o diagnóstico." };
    return { diag: d as DiagnosticoChamadas };
  } catch {
    return { diag: null, error: "Sem conexão." };
  }
}

/** "Posso ligar pra essa pessoa agora?" — antes de tentar e tomar 138006. */
export async function lerPermissaoDeLigacao(telefone: string): Promise<{ status?: string | null; error?: string }> {
  try {
    const res = await fetch("/api/wa-config", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ acao: "calling-permissao-status", telefone }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { error: d?.error || "Não consegui conferir." };
    return { status: d?.status ?? null };
  } catch {
    return { error: "Sem conexão." };
  }
}
