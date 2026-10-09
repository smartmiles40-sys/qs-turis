// src/rel/lib/whatsapp.ts
// -----------------------------------------------------------------------------
// WhatsApp do Relacionamento (Fase 2 — migrations 0101/0102).
//
// Ler (fila, mensagens, relatório) vai direto no banco, protegido pela RLS.
// ENVIAR passa sempre pelo servidor (/api/rel-wa): é ele que tem o token da
// Meta, confere a janela de 24h e assina com o nome de quem está logado.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

export type EstadoConversa = "aberta" | "aguardando_cliente" | "resolvida";

export interface Conversa {
  id: string;
  phone_number_id: string;
  telefone: string;
  nome_contato: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  atendente_id: string | null;
  atendente_nome: string | null;
  estado: EstadoConversa;
  aguardando_desde: string | null;
  ultima_entrada_em: string | null;
  ultima_saida_em: string | null;
  ultima_mensagem: string | null;
  nao_lidas: number;
  atualizado_em: string;
  minutos_esperando: number;
  meta_min: number;
  janela_aberta: boolean;
}

export interface Anexo { type: "image" | "video" | "audio" | "file"; url: string; nome?: string }

export interface Mensagem {
  id: string;
  conversa_id: string;
  wamid: string;
  direcao: "in" | "out";
  origem: "cliente" | "qs" | "celular" | "automatica" | "historico";
  texto: string;
  anexos: Anexo[];
  autor_id: string | null;
  autor_nome: string | null;
  status: "sent" | "delivered" | "read" | "failed" | null;
  respondendo_a: string | null;
  enviada_em: string;
}

export interface Modelo {
  nome: string;
  idioma: string;
  corpo: string;
  variaveis: string[];
  precisaMidia?: boolean;
  categoria?: string;
}

export interface Resposta { id: string; titulo: string; texto: string }

export interface ConfigRel {
  horario: { dias: number[]; inicio: string; fim: string; feriados?: string[] };
  sla: { resposta_min: number };
  fora_horario: { ativo: boolean; texto: string };
  assinatura: { ativo: boolean };
}

export interface NumeroRel { conectado: boolean; numero: string | null; nome: string | null; status: string | null }

// ── Leitura ─────────────────────────────────────────────────────────────────

export type Filtro = "esperando" | "minhas" | "abertas" | "resolvidas" | "todas";

export async function listarConversas(filtro: Filtro, meuId: string, busca = ""): Promise<Conversa[]> {
  let q = supabase.from("rel_wa_fila").select("*").limit(200);
  if (filtro === "esperando") q = q.not("aguardando_desde", "is", null).order("aguardando_desde", { ascending: true });
  else if (filtro === "minhas") q = q.eq("atendente_id", meuId).neq("estado", "resolvida").order("atualizado_em", { ascending: false });
  else if (filtro === "abertas") q = q.neq("estado", "resolvida").order("atualizado_em", { ascending: false });
  else if (filtro === "resolvidas") q = q.eq("estado", "resolvida").order("atualizado_em", { ascending: false });
  else q = q.order("atualizado_em", { ascending: false });
  const t = busca.replace(/[,()*%\\:"']/g, " ").trim();
  if (t) {
    const d = t.replace(/\D/g, "");
    q = d.length >= 4 && d.length === t.replace(/[\s.\-()+]/g, "").length
      ? q.ilike("telefone", `*${d}*`)
      : q.or(`nome_contato.ilike.*${t}*,cliente_nome.ilike.*${t}*,ultima_mensagem.ilike.*${t}*`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Conversa[];
}

export async function carregarConversa(id: string): Promise<Conversa | null> {
  const { data, error } = await supabase.from("rel_wa_fila").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Conversa | null;
}

export async function conversasDoCliente(clienteId: string): Promise<Conversa[]> {
  const { data } = await supabase.from("rel_wa_fila").select("*").eq("cliente_id", clienteId).order("atualizado_em", { ascending: false });
  return (data ?? []) as Conversa[];
}

export async function carregarMensagens(conversaId: string): Promise<Mensagem[]> {
  // As 300 mais recentes, em ordem de leitura.
  const { data, error } = await supabase
    .from("rel_wa_mensagens").select("*")
    .eq("conversa_id", conversaId).order("enviada_em", { ascending: false }).limit(300);
  if (error) throw error;
  return ((data ?? []) as Mensagem[]).reverse();
}

export async function contarEsperando(): Promise<{ esperando: number; foraDoPrazo: number }> {
  const { data } = await supabase.from("rel_wa_fila").select("minutos_esperando, meta_min").not("aguardando_desde", "is", null);
  const l = (data ?? []) as { minutos_esperando: number; meta_min: number }[];
  return { esperando: l.length, foraDoPrazo: l.filter((x) => x.minutos_esperando > x.meta_min).length };
}

// ── Mudanças de atendimento (direto no banco; a RLS libera só estas colunas) ──

async function mudar(id: string, campos: Record<string, unknown>) {
  const { error } = await supabase.from("rel_wa_conversas").update(campos).eq("id", id);
  if (error) throw new Error(error.message);
}

export const assumirConversa = (id: string, userId: string) => mudar(id, { atendente_id: userId });
export const passarConversa = (id: string, userId: string | null) => mudar(id, { atendente_id: userId });
/** Resolver encerra a espera SEM contar como resposta (ex.: o cliente só agradeceu). */
export const resolverConversa = (id: string) => mudar(id, { estado: "resolvida", aguardando_desde: null, nao_lidas: 0 });
export const reabrirConversa = (id: string) => mudar(id, { estado: "aguardando_cliente" });
export const ligarAoCliente = (id: string, clienteId: string | null) => mudar(id, { cliente_id: clienteId });

// ── Envio (servidor) ────────────────────────────────────────────────────────

async function api<T = Record<string, unknown>>(metodo: "GET" | "POST", corpoOuQuery: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const url = metodo === "GET"
    ? `/api/rel-wa?${new URLSearchParams(Object.entries(corpoOuQuery).map(([k, v]) => [k, String(v)]))}`
    : "/api/rel-wa";
  const r = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${session.access_token}`, ...(metodo === "POST" ? { "Content-Type": "application/json" } : {}) },
    body: metodo === "POST" ? JSON.stringify(corpoOuQuery) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as T;
}

export const statusDoNumero = () => api<NumeroRel>("GET", { numero: 1 });
export const listarModelos = () => api<{ modelos: Modelo[] }>("GET", { modelos: 1 }).then((r) => r.modelos || []);
export const enviarTexto = (conversaId: string, texto: string, respondendoA?: string | null) =>
  api("POST", { acao: "texto", conversaId, texto, respondendoA: respondendoA || null });
export const enviarModelo = (alvo: { conversaId?: string; clienteId?: string }, modelo: { nome: string; idioma: string; params: Record<string, string> }) =>
  api<{ conversaId?: string }>("POST", { acao: "modelo", ...alvo, modelo });
export const marcarLida = (conversaId: string) => api("POST", { acao: "lida", conversaId }).catch(() => undefined);

export async function enviarArquivo(conversaId: string, arquivo: File, legenda?: string) {
  if (arquivo.size > 3 * 1024 * 1024) throw new Error("Arquivo maior que 3 MB.");
  const base64 = await new Promise<string>((ok, falha) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1] || "");
    fr.onerror = () => falha(new Error("Não consegui ler o arquivo."));
    fr.readAsDataURL(arquivo);
  });
  return api("POST", { acao: "arquivo", conversaId, fileName: arquivo.name, mimeType: arquivo.type, dataBase64: base64, legenda: legenda || "" });
}

// ── Respostas prontas ───────────────────────────────────────────────────────

export async function listarRespostas(): Promise<Resposta[]> {
  const { data } = await supabase.from("rel_wa_respostas").select("id, titulo, texto").order("titulo");
  return (data ?? []) as Resposta[];
}
export async function salvarResposta(r: { id?: string; titulo: string; texto: string }) {
  const res = r.id
    ? await supabase.from("rel_wa_respostas").update({ titulo: r.titulo, texto: r.texto }).eq("id", r.id)
    : await supabase.from("rel_wa_respostas").insert({ titulo: r.titulo, texto: r.texto });
  if (res.error) throw new Error(res.error.message);
}
export async function apagarResposta(id: string) {
  const { error } = await supabase.from("rel_wa_respostas").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** {nome} na resposta pronta vira o primeiro nome do cliente. */
export const preencherResposta = (texto: string, nome: string | null) =>
  texto.replace(/\{nome\}/gi, (nome || "").trim().split(/\s+/)[0] || "");

// ── Configuração ────────────────────────────────────────────────────────────

export async function carregarConfig(): Promise<ConfigRel> {
  const { data } = await supabase.from("rel_config").select("chave, valor");
  const m = Object.fromEntries(((data ?? []) as { chave: string; valor: unknown }[]).map((r) => [r.chave, r.valor]));
  return {
    horario: { dias: [1, 2, 3, 4, 5], inicio: "09:00", fim: "18:00", feriados: [], ...(m.horario as object) },
    sla: { resposta_min: 30, ...(m.sla as object) },
    fora_horario: { ativo: false, texto: "", ...(m.fora_horario as object) },
    assinatura: { ativo: true, ...(m.assinatura as object) },
  };
}

export async function salvarConfig(chave: keyof ConfigRel, valor: unknown) {
  const { error } = await supabase.from("rel_config").update({ valor, atualizado_em: new Date().toISOString() }).eq("chave", chave);
  if (error) throw new Error(error.message.includes("row-level") ? "Só admin ou gestor do Relacionamento muda a configuração." : error.message);
}

// ── Relatório de prazo ──────────────────────────────────────────────────────

export interface LinhaSla { atendente_id: string | null; minutos_uteis: number; meta_min: number; dentro_do_prazo: boolean; respondido_em: string }

export async function carregarSla(desdeDias: number): Promise<LinhaSla[]> {
  const desde = new Date(Date.now() - desdeDias * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("rel_wa_sla").select("atendente_id, minutos_uteis, meta_min, dentro_do_prazo, respondido_em")
    .gte("respondido_em", desde).order("respondido_em", { ascending: false }).limit(1000);
  if (error) throw error;
  return (data ?? []) as LinhaSla[];
}

// ── Formatação ──────────────────────────────────────────────────────────────

export function duracao(min: number): string {
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function horaCurta(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const ontem = new Date(hoje.getTime() - 86_400_000);
  if (d.toDateString() === ontem.toDateString()) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
