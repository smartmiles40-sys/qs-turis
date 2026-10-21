// src/expedicoes/links/dados.ts
// Links da expedição (app antigo: links/page.tsx + actions.ts criarLink /
// atualizarLink / excluirLink). O portal /amigo lê essa tabela — não muda colunas.
import { supabase, traduzirErro } from "../lib/banco";
import type { LinkExpedicaoRow } from "../lib/database";

export const SUGESTOES_LINK = ["Apresentação", "Landing page", "Planilha financeira", "Roteiro / Day-by-day", "Pasta no Drive", "Grupo do WhatsApp", "Vídeo de divulgação"];

function falhou(error: { message: string } | null) { if (error) throw new Error(traduzirErro(error.message)); }

export async function listarLinks(expedicaoId: string): Promise<LinkExpedicaoRow[]> {
  const { data, error } = await supabase.from("links_expedicao").select("*").eq("expedicao_id", expedicaoId)
    .order("ordem", { ascending: true }).order("created_at", { ascending: true });
  falhou(error);
  return (data ?? []) as LinkExpedicaoRow[];
}

/** Mesma validação do antigo: nome 1–80, URL válida (http/https). Devolve o erro por campo. */
export function validarLink(label: string, url: string): { label?: string; url?: string } {
  const e: { label?: string; url?: string } = {};
  const l = label.trim();
  if (!l) e.label = "Nome obrigatório";
  else if (l.length > 80) e.label = "Máximo 80 caracteres";
  try {
    const u = new URL(url.trim());
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch { e.url = "URL inválida (use https://...)"; }
  return e;
}

export async function criarLink(expedicaoId: string, label: string, url: string, total: number): Promise<void> {
  const { error } = await supabase.from("links_expedicao").insert({ expedicao_id: expedicaoId, label: label.trim(), url: url.trim(), ordem: total });
  falhou(error);
}

export async function atualizarLink(id: string, campos: { label?: string; url?: string }): Promise<void> {
  const { error } = await supabase.from("links_expedicao").update(campos).eq("id", id);
  falhou(error);
}

export async function excluirLink(id: string): Promise<void> {
  const { error } = await supabase.from("links_expedicao").delete().eq("id", id);
  falhou(error);
}

export async function reordenarLinks(ids: string[]): Promise<void> {
  const { error } = await supabase.rpc("exp_reordenar_links", { p_ids: ids });
  falhou(error);
}

export type TipoIcone = "planilha" | "apresentacao" | "pasta" | "video" | "chat" | "globo" | "link";

/** Ícone por palavra-chave em "label url" (mesma ordem do antigo, LinksGrid.tsx:33-42). */
export function iconeDoLink(label: string, url: string): TipoIcone {
  const s = `${label} ${url}`.toLowerCase();
  if (/docs\.google\.com\/spreadsheets|sheet|planilha|excel|airtable/.test(s)) return "planilha";
  if (/docs\.google\.com\/presentation|slides|presentation|apresenta|canva|figma/.test(s)) return "apresentacao";
  if (/drive\.google|dropbox|onedrive|pasta|folder/.test(s)) return "pasta";
  if (/youtube|vimeo|video/.test(s)) return "video";
  if (/whatsapp|wa\.me|chat\.whatsapp|telegram|t\.me/.test(s)) return "chat";
  if (/landing|^lp|setuforeu|site|domain/.test(s)) return "globo";
  return "link";
}

/** host + caminho + busca, sem "https://" e sem "/" no fim. */
export function urlBonita(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.search}`.replace(/\/$/, "");
  } catch { return url; }
}
