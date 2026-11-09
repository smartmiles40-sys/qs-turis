// src/mkt/grupos/lib.ts
// -----------------------------------------------------------------------------
// Grupos do WhatsApp do Marketing (0243). Ler e gravar tags/campanhas/cadências
// vai direto no banco (RLS 0243). Tudo que fala com o WhatsApp passa pelo
// servidor (/api/mkt-grupos), que aplica a trava de instância.
// -----------------------------------------------------------------------------
import type { CSSProperties } from "react";
import { supabase } from "@/lib/supabase";

export interface Conexao {
  instancia: string;
  numero: string | null;
  estado: string;
  estado_em: string | null;
  conectado_em: string | null;
  envio_ligado: boolean;
  intervalo_min_seg: number;
  intervalo_max_seg: number;
  janela_inicio: string;
  janela_fim: string;
  proximo_envio_em: string | null;
}

export interface Grupo {
  jid: string;
  nome: string | null;
  descricao: string | null;
  foto_url: string | null;
  participantes: number | null;
  eu_admin: boolean | null;
  so_admins_enviam: boolean | null;
  so_admins_editam: boolean | null;
  admins: { id: string; telefone: string | null; admin: string | null }[];
  participantes_lista: { id: string; telefone: string | null; admin: string | null }[] | null;
  link_convite: string | null;
  sincronizado_em: string | null;
  info_em: string | null;
  saiu_em: string | null;
}

export interface Tag { id: string; nome: string; cor: string }
export interface TagLink { tag_id: string; grupo_jid: string }

export type TipoMsg = "texto" | "imagem" | "video" | "documento" | "audio" | "enquete";
export type StatusCampanha = "rascunho" | "agendada" | "enviando" | "pausada" | "concluida" | "cancelada" | "erro";

export interface Conteudo {
  tipo: TipoMsg;
  texto: string;
  midia_url: string | null;
  midia_nome: string | null;
  enquete_opcoes: string[] | null;
  enquete_multipla: boolean;
  mencionar_todos: boolean;
  tag_ids: string[];
  grupo_jids: string[];
  intervalo_min_seg: number | null;
  intervalo_max_seg: number | null;
}

export interface Campanha extends Conteudo {
  id: string;
  nome: string;
  enviar_em: string | null;
  status: StatusCampanha;
  cadencia_id: string | null;
  recorrencia_id: string | null;
  fanout_em: string | null;
  total: number;
  enviados: number;
  falhas: number;
  avisos: string[];
  erro: string | null;
  criado_em: string;
  concluido_em: string | null;
}

export interface Envio {
  id: number;
  grupo_jid: string;
  grupo_nome: string | null;
  status: "pendente" | "enviando" | "enviado" | "chegou" | "falha" | "cancelado" | "pulado";
  tentativas: number;
  erro: string | null;
  enviado_em: string | null;
  chegou_em: string | null;
}

export interface Cadencia { id: string; nome: string; descricao: string | null; tag_ids: string[]; grupo_jids: string[]; ativo: boolean; criado_em: string }

export interface Recorrencia extends Conteudo {
  id: string;
  nome: string;
  cadencia_id: string | null;
  dias_semana: number[];
  hora: string;
  inicio: string | null;
  fim: string | null;
  ativo: boolean;
  gerado_ate: string | null;
}

export const CONTEUDO_VAZIO: Conteudo = {
  tipo: "texto", texto: "", midia_url: null, midia_nome: null, enquete_opcoes: null, enquete_multipla: false,
  mencionar_todos: false, tag_ids: [], grupo_jids: [], intervalo_min_seg: null, intervalo_max_seg: null,
};

export const ROTULO_STATUS: Record<StatusCampanha, string> = {
  rascunho: "Rascunho", agendada: "Agendada", enviando: "Enviando", pausada: "Pausada",
  concluida: "Concluída", cancelada: "Cancelada", erro: "Erro",
};
export const TOM_STATUS: Record<StatusCampanha, "ok" | "warn" | "danger" | "info" | undefined> = {
  rascunho: undefined, agendada: "info", enviando: "warn", pausada: "warn", concluida: "ok", cancelada: undefined, erro: "danger",
};
export const ROTULO_ENVIO: Record<Envio["status"], string> = {
  pendente: "Na fila", enviando: "Enviando", enviado: "Chegou ao grupo", chegou: "Chegou ao grupo ✓",
  falha: "Falhou", cancelado: "Cancelado", pulado: "Pulado",
};
export const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const CORES = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b"];

export const estiloCampo: CSSProperties = { background: "var(--card2)", color: "var(--ink)", border: "1px solid var(--line)" };
export const classeCampo = "w-full px-3 py-2 rounded-lg text-[14px]";

const ok = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? ([] as unknown)) as T;
};

// ── Leitura ────────────────────────────────────────────────────────────────
export async function lerGrupos(): Promise<Grupo[]> {
  return ok(await supabase.from("mkt_grupos").select("*").order("nome", { ascending: true }).limit(5000)) as Grupo[];
}
export async function lerTags(): Promise<Tag[]> {
  return ok(await supabase.from("mkt_grupos_tags").select("id,nome,cor").order("nome")) as Tag[];
}
export async function lerLinks(): Promise<TagLink[]> {
  return ok(await supabase.from("mkt_grupos_tag_links").select("tag_id,grupo_jid").limit(20000)) as TagLink[];
}
export async function lerCampanhas(filtro?: { cadenciaId?: string }): Promise<Campanha[]> {
  // teto do PostgREST é 1000 (corta calado): as mais novas primeiro
  let q = supabase.from("mkt_grupos_campanhas").select("*").order("enviar_em", { ascending: false, nullsFirst: true }).limit(1000);
  if (filtro?.cadenciaId) q = q.eq("cadencia_id", filtro.cadenciaId);
  return ok(await q) as Campanha[];
}
export async function lerCampanha(id: string): Promise<Campanha | null> {
  const r = await supabase.from("mkt_grupos_campanhas").select("*").eq("id", id).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return (r.data as Campanha | null) ?? null;
}
export async function lerEnvios(campanhaId: string): Promise<Envio[]> {
  return ok(await supabase.from("mkt_grupos_envios").select("id,grupo_jid,grupo_nome,status,tentativas,erro,enviado_em,chegou_em").eq("campanha_id", campanhaId).order("id").limit(5000)) as Envio[];
}
export async function lerCadencias(): Promise<Cadencia[]> {
  return ok(await supabase.from("mkt_grupos_cadencias").select("*").order("criado_em", { ascending: false })) as Cadencia[];
}
export async function lerRecorrencias(): Promise<Recorrencia[]> {
  return ok(await supabase.from("mkt_grupos_recorrencias").select("*").order("criado_em", { ascending: false })) as Recorrencia[];
}

// ── Escrita direta (RLS) ───────────────────────────────────────────────────
export async function criarTag(nome: string, cor: string) {
  return ok(await supabase.from("mkt_grupos_tags").insert({ nome: nome.trim(), cor }).select("id,nome,cor").single()) as Tag;
}
export async function mudarTag(id: string, campos: Partial<Tag>) { ok(await supabase.from("mkt_grupos_tags").update(campos).eq("id", id)); }
export async function apagarTag(id: string) { ok(await supabase.from("mkt_grupos_tags").delete().eq("id", id)); }

/** Aplicar (ou tirar) uma tag em vários grupos de uma vez. */
export async function aplicarTag(tagId: string, jids: string[], tirar = false) {
  if (!jids.length) return;
  if (tirar) ok(await supabase.from("mkt_grupos_tag_links").delete().eq("tag_id", tagId).in("grupo_jid", jids));
  else ok(await supabase.from("mkt_grupos_tag_links").upsert(jids.map((j) => ({ tag_id: tagId, grupo_jid: j })), { onConflict: "tag_id,grupo_jid", ignoreDuplicates: true }));
}

export async function salvarCampanha(c: Partial<Campanha> & { nome: string }, id?: string): Promise<Campanha> {
  const campos = { ...c };
  delete (campos as Partial<Campanha>).id;
  const r = id
    ? await supabase.from("mkt_grupos_campanhas").update(campos).eq("id", id).select("*").single()
    : await supabase.from("mkt_grupos_campanhas").insert({ status: "rascunho", ...campos }).select("*").single();
  return ok(r) as Campanha;
}
export async function mudarStatus(id: string, status: "pausada" | "cancelada" | "agendada" | "rascunho") {
  ok(await supabase.from("mkt_grupos_campanhas").update({ status }).eq("id", id));
}
export async function apagarCampanha(id: string) { ok(await supabase.from("mkt_grupos_campanhas").delete().eq("id", id)); }

export async function salvarCadencia(c: Partial<Cadencia> & { nome: string }, id?: string): Promise<Cadencia> {
  const r = id
    ? await supabase.from("mkt_grupos_cadencias").update(c).eq("id", id).select("*").single()
    : await supabase.from("mkt_grupos_cadencias").insert(c).select("*").single();
  return ok(r) as Cadencia;
}
export async function apagarCadencia(id: string) { ok(await supabase.from("mkt_grupos_cadencias").delete().eq("id", id)); }

export async function salvarRecorrencia(r: Partial<Recorrencia> & { nome: string }, id?: string): Promise<Recorrencia> {
  const campos = { ...r };
  delete (campos as Partial<Recorrencia>).id;
  delete (campos as Partial<Recorrencia>).gerado_ate;
  const q = id
    ? await supabase.from("mkt_grupos_recorrencias").update(campos).eq("id", id).select("*").single()
    : await supabase.from("mkt_grupos_recorrencias").insert(campos).select("*").single();
  return ok(q) as Recorrencia;
}
export async function apagarRecorrencia(id: string) { ok(await supabase.from("mkt_grupos_recorrencias").delete().eq("id", id)); }

/** Sobe o arquivo da campanha no bucket público mkt-grupos (0243) e devolve a URL. */
export async function subirArquivo(arquivo: File): Promise<{ url: string; nome: string }> {
  if (arquivo.size > 64 * 1024 * 1024) throw new Error("Arquivo acima de 64 MB.");
  const limpo = arquivo.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-");
  const caminho = `campanhas/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${limpo}`;
  const up = await supabase.storage.from("mkt-grupos").upload(caminho, arquivo, { contentType: arquivo.type || "application/octet-stream", upsert: false });
  if (up.error) throw new Error(up.error.message);
  return { url: supabase.storage.from("mkt-grupos").getPublicUrl(caminho).data.publicUrl, nome: arquivo.name };
}

// ── Servidor ───────────────────────────────────────────────────────────────
export async function api<T = Record<string, unknown>>(acao: string, corpo: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/mkt-grupos", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ acao, ...corpo }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as T;
}

export interface EstadoChip {
  conexao: Conexao | null;
  estado: string | null;
  erro: string | null;
  envioAmbiente: boolean;
  privado: boolean;
  admin: boolean;
}
export const lerEstado = () => api<EstadoChip>("estado");

// ── Datas (o <input type=datetime-local> usa o fuso do navegador) ─────────
export function paraInputLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const deInputLocal = (v: string) => (v ? new Date(v).toISOString() : null);
export function quando(iso: string | null) {
  if (!iso) return "—";
  // 04/11/2026: sempre em Brasília (igual ao quandoSP) — sem isso, quem abre fora do fuso via outra hora.
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Mesmo filtro do servidor (resolverGrupos), pra prévia instantânea na tela. */
export function gruposDoDestino(c: { tag_ids: string[]; grupo_jids: string[] }, grupos: Grupo[], links: TagLink[]): Grupo[] {
  const tags = new Set(c.tag_ids);
  const jids = new Set(c.grupo_jids);
  for (const l of links) if (tags.has(l.tag_id)) jids.add(l.grupo_jid);
  return grupos.filter((g) => jids.has(g.jid) && !g.saiu_em && !(g.so_admins_enviam && g.eu_admin === false));
}

/** Limpa as opções vazias da enquete antes de gravar. */
export function conteudoParaGravar(c: Conteudo): Conteudo {
  return {
    ...c,
    texto: c.texto ?? "",
    enquete_opcoes: c.tipo === "enquete" ? (c.enquete_opcoes ?? []).map((o) => o.trim()).filter(Boolean) : null,
    midia_url: ["imagem", "video", "documento", "audio"].includes(c.tipo) ? c.midia_url : null,
    midia_nome: ["imagem", "video", "documento", "audio"].includes(c.tipo) ? c.midia_nome : null,
  };
}
