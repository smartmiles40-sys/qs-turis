// src/lib/qs/produtoGanhoDados.ts
// -----------------------------------------------------------------------------
// Produto no desfecho + Cotações (0321) — a parte que fala com o banco.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import {
  ROTA_PADRAO, ehProdutoTipo, numeroBr,
  type CotacaoCanal, type CotacaoMotivoPerda, type CotacaoStatus, type DadosCotacao,
  type ExpedicaoAVenda, type ProdutoTipo, type Rota,
} from "./produtoGanho";

let cacheExpedicoes: { em: number; lista: ExpedicaoAVenda[] } | null = null;
let cacheRotas: { em: number; mapa: Record<ProdutoTipo, Rota> } | null = null;

/** Expedições à venda no Operacional (cache de 5 min — a lista muda pouco). */
export async function fetchExpedicoesAVenda(): Promise<ExpedicaoAVenda[]> {
  if (cacheExpedicoes && Date.now() - cacheExpedicoes.em < 5 * 60_000) return cacheExpedicoes.lista;
  const { data, error } = await supabase.rpc("qs_expedicoes_a_venda");
  if (error) {
    console.warn("[QS] expedições à venda:", error.message);
    return [];
  }
  const lista = (data ?? []) as ExpedicaoAVenda[];
  cacheExpedicoes = { em: Date.now(), lista };
  return lista;
}

/** Regra produto → rota (tabela produto_rota). Falhou → a de fábrica. */
export async function fetchRotas(): Promise<Record<ProdutoTipo, Rota>> {
  if (cacheRotas && Date.now() - cacheRotas.em < 5 * 60_000) return cacheRotas.mapa;
  const { data, error } = await supabase.from("produto_rota").select("produto, rota");
  if (error) {
    console.warn("[QS] produto_rota:", error.message);
    return ROTA_PADRAO;
  }
  const mapa = { ...ROTA_PADRAO };
  for (const r of (data ?? []) as { produto: string; rota: Rota }[]) {
    if (ehProdutoTipo(r.produto) && (r.rota === "reuniao" || r.rota === "cotacao")) mapa[r.produto] = r.rota;
  }
  cacheRotas = { em: Date.now(), mapa };
  return mapa;
}

export interface Cotacao {
  id: string;
  lead_id: string;
  negocio_bitrix_id: string | null;
  produto: ProdutoTipo;
  sdr_id: string;
  responsavel_id: string;
  repassada_closer: boolean;
  status: CotacaoStatus;
  origem: string | null;
  destino: string | null;
  data_ida: string | null;
  data_volta: string | null;
  adultos: number | null;
  criancas: number | null;
  bebes: number | null;
  bagagem: string | null;
  flexibilidade_datas: string | null;
  orcamento_cliente: number | null;
  observacoes: string | null;
  valor_cotado: number | null;
  valor_emitido: number | null;
  canal_entrega: CotacaoCanal | null;
  motivo_perda: CotacaoMotivoPerda | null;
  solicitada_em: string;
  iniciada_em: string | null;
  entregue_em: string | null;
  validade_ate: string | null;
  decidida_em: string | null;
  lead?: { full_name: string | null; phone: string | null } | null;
}

/** Cria a cotação do desfecho do SDR. Devolve o id ou a mensagem de erro. */
export async function criarCotacao(input: {
  leadId: string;
  bitrixId: string | null;
  produto: ProdutoTipo;
  sdrId: string;
  dados: DadosCotacao;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const d = input.dados;
  const orc = numeroBr(d.orcamento);
  const { data, error } = await supabase
    .from("cotacoes")
    .insert({
      lead_id: input.leadId,
      negocio_bitrix_id: input.bitrixId,
      produto: input.produto,
      sdr_id: input.sdrId,
      responsavel_id: d.responsavelId ?? input.sdrId,
      origem: d.origem.trim(),
      destino: d.destino.trim(),
      data_ida: d.dataIda || null,
      data_volta: d.dataVolta || null,
      adultos: d.adultos,
      criancas: d.criancas,
      bebes: d.bebes,
      bagagem: d.bagagem.trim() || null,
      flexibilidade_datas: d.flexibilidade.trim() || null,
      orcamento_cliente: Number.isFinite(orc) ? orc : null,
      observacoes: d.observacoes.trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "sem permissão para criar a cotação" };
  return { ok: true, id: (data as { id: string }).id };
}

export async function listarCotacoes(filtro: { desde?: Date | null; responsavelId?: string | null; sdrId?: string | null; soRepassadas?: boolean }): Promise<Cotacao[]> {
  let q = supabase
    .from("cotacoes")
    .select("*, lead:qs_leads(full_name, phone)")
    .order("solicitada_em", { ascending: false })
    .limit(1000);
  if (filtro.desde) q = q.gte("solicitada_em", filtro.desde.toISOString());
  if (filtro.responsavelId) q = q.eq("responsavel_id", filtro.responsavelId);
  if (filtro.sdrId) q = q.eq("sdr_id", filtro.sdrId);
  if (filtro.soRepassadas) q = q.eq("repassada_closer", true);
  const { data, error } = await q;
  if (error) {
    console.warn("[QS] cotações:", error.message);
    return [];
  }
  return (data ?? []) as Cotacao[];
}

/** Move a cotação de etapa (o gatilho da 0321 confere os campos obrigatórios). */
export async function moverCotacao(
  id: string,
  status: CotacaoStatus,
  campos: Partial<Pick<Cotacao, "valor_cotado" | "valor_emitido" | "canal_entrega" | "motivo_perda" | "validade_ate">> = {},
): Promise<{ ok: true; cotacao: Cotacao } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("cotacoes")
    .update({ status, ...campos })
    .eq("id", id)
    .select("*, lead:qs_leads(full_name, phone)")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "sem permissão para mover esta cotação" };
  return { ok: true, cotacao: data as Cotacao };
}
