// src/mkt/conteudo/dados.ts
// -----------------------------------------------------------------------------
// Leitura e escrita das tabelas mkt_* (0240). A RLS decide quem lê e escreve;
// a aprovação passa pelas RPCs (mkt_aprovar / mkt_devolver) e pelo gatilho
// mkt_cards_antes — mover pra "Em aprovação" é um update comum da coluna.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { Anexo, Aprovacao, CardMkt, Coluna, Comentario, DestinoExp, Historico, ItemChecklist, TipoColuna } from "./tipos";

function falhou(error: { message: string } | null): void {
  if (error) throw new Error(traduzirErro(error.message));
}

/** Erros do banco em frase de gente (a RLS responde em inglês). */
export function traduzirErro(msg: string): string {
  if (/row-level security|permission denied/i.test(msg)) return "Sem permissão para isso no Marketing.";
  if (/violates foreign key.*mkt_cards_coluna_id/i.test(msg) || /mkt_cards_coluna_id_fkey/i.test(msg)) return "A coluna ainda tem cards: mova-os antes de apagar.";
  if (/mkt_colunas_tipo_unico/i.test(msg)) return "Já existe uma coluna com esse papel no fluxo.";
  if (/function .*mkt_.* does not exist|relation "mkt_/i.test(msg)) return "O banco do Marketing ainda não foi criado (falta aplicar a migration 0240).";
  return msg;
}

export const erroDe = (e: unknown) => (e instanceof Error ? traduzirErro(e.message) : "Algo deu errado");

// ── Colunas ────────────────────────────────────────────────────────────────
export async function listarColunas(): Promise<Coluna[]> {
  const { data, error } = await supabase.from("mkt_colunas").select("id, nome, ordem, cor, tipo").order("ordem");
  falhou(error);
  return (data ?? []) as Coluna[];
}
export async function salvarColuna(c: Partial<Coluna> & { nome: string }): Promise<void> {
  const linha = { nome: c.nome.trim(), ordem: c.ordem ?? 0, cor: c.cor ?? null, ...(c.tipo ? { tipo: c.tipo } : {}) };
  const { error } = c.id
    ? await supabase.from("mkt_colunas").update(linha).eq("id", c.id)
    : await supabase.from("mkt_colunas").insert({ ...linha, tipo: c.tipo ?? ("livre" as TipoColuna) });
  falhou(error);
}
export async function apagarColuna(id: string): Promise<void> {
  const { error } = await supabase.from("mkt_colunas").delete().eq("id", id);
  falhou(error);
}
export async function reordenarColunas(ids: string[]): Promise<void> {
  // Poucas colunas: um update por coluna é o mais simples e não pede RPC.
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase.from("mkt_colunas").update({ ordem: (i + 1) * 10 }).eq("id", ids[i]);
    falhou(error);
  }
}

// ── Cards ──────────────────────────────────────────────────────────────────
const CAMPOS_CARD = "*, anexos:mkt_anexos(thumb), comentarios:mkt_comentarios(count)";

type LinhaCard = CardMkt & { anexos?: { thumb: string | null }[]; comentarios?: { count: number }[] };
function montar(l: LinhaCard): CardMkt {
  const { anexos, comentarios, ...c } = l;
  return {
    ...c,
    tags: c.tags ?? [],
    checklist: Array.isArray(c.checklist) ? c.checklist : [],
    n_anexos: anexos?.length ?? 0,
    thumb: anexos?.find((a) => a.thumb)?.thumb ?? null,
    n_comentarios: comentarios?.[0]?.count ?? 0,
  };
}

/**
 * Cards do quadro. PostgREST corta em 1000 calado (memória "teto de 1000"):
 * pagina com desempate pela chave.
 */
export async function listarCards(opts: { arquivados?: boolean; soAprovados?: boolean } = {}): Promise<CardMkt[]> {
  const out: CardMkt[] = [];
  const PAGINA = 500;
  for (let de = 0; ; de += PAGINA) {
    let q = supabase.from("mkt_cards").select(CAMPOS_CARD).order("criado_em", { ascending: false }).order("id").range(de, de + PAGINA - 1);
    if (!opts.arquivados) q = q.eq("arquivado", false);
    if (opts.soAprovados) q = q.eq("status_aprovacao", "aprovado");
    const { data, error } = await q;
    falhou(error);
    const l = (data ?? []) as LinhaCard[];
    out.push(...l.map(montar));
    if (l.length < PAGINA) break;
  }
  return out;
}

export async function lerCard(id: string): Promise<CardMkt | null> {
  const { data, error } = await supabase.from("mkt_cards").select(CAMPOS_CARD).eq("id", id).maybeSingle();
  falhou(error);
  return data ? montar(data as LinhaCard) : null;
}

export type NovoCard = Pick<CardMkt, "titulo" | "tipo" | "origem" | "coluna_id"> &
  Partial<Pick<CardMkt, "descricao" | "eh_pedido" | "responsavel_id" | "solicitante_id" | "prazo" | "data_publicacao" | "expedicao_id" | "destino" | "tags" | "ordem" | "checklist">>;

export async function criarCard(c: NovoCard): Promise<string> {
  const { data, error } = await supabase.from("mkt_cards").insert(c).select("id").single();
  falhou(error);
  return (data as { id: string }).id;
}

/** Campos que a tela edita (os da aprovação o banco recalcula — não adianta mandar). */
export type EdicaoCard = Partial<Pick<CardMkt,
  "titulo" | "descricao" | "tipo" | "origem" | "eh_pedido" | "responsavel_id" | "prazo" | "data_publicacao" | "expedicao_id" |
  "destino" | "tags" | "checklist" | "link_publicacao" | "arquivado" | "coluna_id" | "ordem">>;

export async function editarCard(id: string, mudanca: EdicaoCard): Promise<void> {
  const { error } = await supabase.from("mkt_cards").update(mudanca).eq("id", id);
  falhou(error);
}
export async function salvarChecklist(id: string, itens: ItemChecklist[]): Promise<void> {
  return editarCard(id, { checklist: itens });
}
export async function moverCard(id: string, colunaId: string, ordem: number): Promise<void> {
  return editarCard(id, { coluna_id: colunaId, ordem });
}
export async function apagarCard(id: string): Promise<void> {
  const { error } = await supabase.from("mkt_cards").delete().eq("id", id);
  falhou(error);
}

// ── Aprovação ──────────────────────────────────────────────────────────────
export async function aprovar(cardId: string, comentario?: string): Promise<void> {
  const { error } = await supabase.rpc("mkt_aprovar", { p_card: cardId, p_comentario: comentario?.trim() || null });
  falhou(error);
}
export async function devolver(cardId: string, comentario: string): Promise<void> {
  const { error } = await supabase.rpc("mkt_devolver", { p_card: cardId, p_comentario: comentario });
  falhou(error);
}
export async function reaproveitar(cardId: string, tipo: string, titulo?: string): Promise<string> {
  const { data, error } = await supabase.rpc("mkt_reaproveitar", { p_card: cardId, p_tipo: tipo, p_titulo: titulo?.trim() || null });
  falhou(error);
  return data as string;
}
export async function listarAprovacoes(cardId: string): Promise<Aprovacao[]> {
  const { data, error } = await supabase.from("mkt_aprovacoes").select("*").eq("card_id", cardId).order("rodada");
  falhou(error);
  return (data ?? []) as Aprovacao[];
}

// ── Comentários, anexos, histórico ─────────────────────────────────────────
export async function listarComentarios(cardId: string): Promise<Comentario[]> {
  const { data, error } = await supabase.from("mkt_comentarios").select("*").eq("card_id", cardId).order("criado_em");
  falhou(error);
  return (data ?? []) as Comentario[];
}
export async function comentar(cardId: string, autorId: string, texto: string): Promise<void> {
  const { error } = await supabase.from("mkt_comentarios").insert({ card_id: cardId, autor_id: autorId, texto: texto.trim() });
  falhou(error);
}
export async function apagarComentario(id: string): Promise<void> {
  const { error } = await supabase.from("mkt_comentarios").delete().eq("id", id);
  falhou(error);
}

export async function listarAnexos(cardId: string): Promise<Anexo[]> {
  const { data, error } = await supabase.from("mkt_anexos").select("*").eq("card_id", cardId).order("criado_em");
  falhou(error);
  return (data ?? []) as Anexo[];
}
/** Um anexo novo: link colado OU arquivo do Drive (drive_file_id + mime + thumb). */
export interface NovoAnexo { nome: string; url?: string | null; drive_file_id?: string | null; mime?: string | null; thumb?: string | null }
export async function anexar(cardId: string, autorId: string, anexos: NovoAnexo[]): Promise<void> {
  if (!anexos.length) return;
  const { error } = await supabase.from("mkt_anexos").insert(anexos.map((a) => ({
    card_id: cardId, criado_por: autorId, nome: a.nome.trim(), url: a.url ?? null, drive_file_id: a.drive_file_id ?? null, mime: a.mime ?? null, thumb: a.thumb ?? null,
  })));
  falhou(error);
}
export async function tirarAnexo(id: string): Promise<void> {
  const { error } = await supabase.from("mkt_anexos").delete().eq("id", id);
  falhou(error);
}

export async function listarHistorico(cardId: string): Promise<Historico[]> {
  const { data, error } = await supabase.from("mkt_historico").select("*").eq("card_id", cardId).order("criado_em", { ascending: false }).limit(200);
  falhou(error);
  return (data ?? []) as Historico[];
}

// ── Equipe e destinos ──────────────────────────────────────────────────────
export async function definirPapeis(userId: string, papeis: string[]): Promise<void> {
  const { error } = await supabase.rpc("mkt_definir_papeis", { p_user: userId, p_papeis: papeis });
  falhou(error);
}

let cacheDestinos: Promise<DestinoExp[]> | null = null;
/** Expedições e pacotes (não cancelados) pra ligar ao card. */
export function listarDestinos(): Promise<DestinoExp[]> {
  if (!cacheDestinos) {
    cacheDestinos = (async () => {
      const { data, error } = await supabase.rpc("mkt_destinos");
      if (error) { cacheDestinos = null; throw new Error(traduzirErro(error.message)); }
      return (data ?? []) as DestinoExp[];
    })();
  }
  return cacheDestinos;
}

/** Quantos estão esperando aprovação (bolinha do menu). */
export async function contarEmAprovacao(): Promise<number> {
  const { count, error } = await supabase.from("mkt_cards").select("id", { count: "exact", head: true })
    .eq("status_aprovacao", "pendente").eq("arquivado", false);
  if (error) return 0;
  return count ?? 0;
}
