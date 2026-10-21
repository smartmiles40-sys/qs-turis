// src/clientes/idasDetalhe.ts
// -----------------------------------------------------------------------------
// CADASTRO ÚNICO (0172) — o detalhe AO VIVO das idas da pessoa em expedições:
// prontidão de embarque (mesmas regras do Operações), quartos, saúde/endereço/
// contato de emergência e os arquivos que o Operações guardou. Usado na ficha
// do Relacionamento; o Operações pode usar igual.
//
// Antes da 0172 (sem passageiros.cliente_id / cad_divergencias) as leituras
// falham com "coluna/tabela não existe": `faltaCadastroUnico(erro)` reconhece
// esse caso pra tela esconder a parte nova em vez de mostrar erro.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { avaliarProntidao, type ResultadoProntidao } from "@/expedicoes/lib/prontidao/regras";
import type { ExpedicaoRow, PassageiroRequisitoRow, PassageiroRow } from "@/expedicoes/lib/database";
import type { IdaEmExpedicao } from "./cadastroUnico";

/** O erro é só "a 0172 ainda não foi aplicada" (coluna, tabela ou função que não existe)? */
export function faltaCadastroUnico(e: unknown): boolean {
  const x = (e ?? {}) as { code?: string; message?: string };
  if (["42703", "42P01", "PGRST200", "PGRST202", "PGRST204", "PGRST205"].includes(x.code ?? "")) return true;
  return /cliente_id|cad_divergencias|cad_resolver|does not exist|schema cache/i.test(x.message ?? "");
}

export interface QuartoDaIda { numero: string | null; tipo: string | null; hotel_cidade: string | null; check_in: string | null; check_out: string | null }

export interface IdaDetalhada {
  ida: IdaEmExpedicao;
  pax: PassageiroRow | null;
  exp: ExpedicaoRow | null;
  /** null = não dá pra avaliar (cancelado, sem data de embarque…). */
  prontidao: ResultadoProntidao | null;
  quartos: QuartoDaIda[];
}

async function emFatias<T>(ids: string[], ler: (fatia: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await ler(ids.slice(i, i + 150));
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

/** Completa as idas com o passageiro inteiro, a expedição, a prontidão e os quartos. Nunca derruba a lista. */
export async function detalharIdas(idas: IdaEmExpedicao[]): Promise<IdaDetalhada[]> {
  if (!idas.length) return [];
  const paxIds = idas.map((i) => i.id);
  const expIds = [...new Set(idas.map((i) => i.expedicao_id).filter(Boolean))];
  const [pax, exps, reqs, quartos] = await Promise.all([
    emFatias<PassageiroRow>(paxIds, (f) => supabase.from("passageiros").select("*").in("id", f)).catch(() => [] as PassageiroRow[]),
    emFatias<ExpedicaoRow>(expIds, (f) => supabase.from("expedicoes").select("*").in("id", f)).catch(() => [] as ExpedicaoRow[]),
    emFatias<PassageiroRequisitoRow>(paxIds, (f) => supabase.from("passageiro_requisitos").select("*").in("passageiro_id", f)).catch(() => null),
    emFatias<{ passageiro_id: string; quarto: QuartoDaIda | null }>(paxIds, (f) => supabase.from("passageiro_quarto")
      .select("passageiro_id, quarto:quartos(numero, tipo, hotel_cidade, check_in, check_out)").in("passageiro_id", f)).catch(() => []),
  ]);
  const paxPorId = new Map(pax.map((p) => [p.id, p]));
  const expPorId = new Map(exps.map((e) => [e.id, e]));
  return idas.map((ida) => {
    const p = paxPorId.get(ida.id) ?? null;
    const e = expPorId.get(ida.expedicao_id) ?? null;
    let prontidao: ResultadoProntidao | null = null;
    if (p && e && reqs && e.data_embarque && e.data_retorno && ida.status_reserva !== "Cancelado" && ida.status_reserva !== "Lead") {
      try {
        prontidao = avaliarProntidao({ passageiro: p, expedicao: e, destino: e.destino, requisitos: reqs.filter((r) => r.passageiro_id === p.id) });
      } catch { prontidao = null; }
    }
    const qs = quartos.filter((q) => q.passageiro_id === ida.id && q.quarto).map((q) => q.quarto as QuartoDaIda)
      .sort((a, b) => (a.check_in ?? "").localeCompare(b.check_in ?? ""));
    return { ida, pax: p, exp: e, prontidao, quartos: qs };
  });
}

// ── Arquivos que o Operações guardou nas idas ──────────────────────────────

export interface ArquivoDaIda {
  id: string;
  expedicao_id: string | null;
  passageiro_id: string | null;
  categoria: string | null;
  nome: string | null;
  descricao: string | null;
  mime: string | null;
  tamanho_bytes: number | null;
  storage_path: string;
  created_at: string;
}

const COLUNAS_ARQ = "id, expedicao_id, passageiro_id, categoria, nome, descricao, mime, tamanho_bytes, storage_path, created_at";

/** Arquivos das idas: os ligados ao passageiro + passaporte/foto/comprovantes dos requisitos (mesmo se ligados a outra ida). */
export async function arquivosDasIdas(paxIds: string[]): Promise<ArquivoDaIda[]> {
  if (!paxIds.length) return [];
  const [doPax, pax, reqs] = await Promise.all([
    emFatias<ArquivoDaIda>(paxIds, (f) => supabase.from("arquivos").select(COLUNAS_ARQ).in("passageiro_id", f)),
    emFatias<{ passaporte_arquivo_id: string | null; foto_arquivo_id: string | null }>(paxIds,
      (f) => supabase.from("passageiros").select("passaporte_arquivo_id, foto_arquivo_id").in("id", f)).catch(() => []),
    emFatias<{ arquivo_id: string | null }>(paxIds,
      (f) => supabase.from("passageiro_requisitos").select("arquivo_id").in("passageiro_id", f).not("arquivo_id", "is", null)).catch(() => []),
  ]);
  const ja = new Set(doPax.map((a) => a.id));
  const extras = [...new Set([
    ...pax.flatMap((p) => [p.passaporte_arquivo_id, p.foto_arquivo_id]),
    ...reqs.map((r) => r.arquivo_id),
  ].filter((x): x is string => !!x && !ja.has(x)))];
  const outros = extras.length
    ? await emFatias<ArquivoDaIda>(extras, (f) => supabase.from("arquivos").select(COLUNAS_ARQ).in("id", f)).catch(() => [])
    : [];
  return [...doPax, ...outros].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** As cópias que a importação de 13/10 fez no rel_documentos (ref_externa 'exp-arq:<id>'): id do arquivo → status da cópia. */
export async function copiasDosArquivos(arquivoIds: string[]): Promise<Map<string, { id: string; status: string }>> {
  const m = new Map<string, { id: string; status: string }>();
  if (!arquivoIds.length) return m;
  const refs = arquivoIds.map((id) => `exp-arq:${id}`);
  const linhas = await emFatias<{ id: string; status: string; ref_externa: string }>(refs,
    (f) => supabase.from("rel_documentos").select("id, status, ref_externa").in("ref_externa", f)).catch(() => []);
  for (const l of linhas) m.set(l.ref_externa.slice("exp-arq:".length), { id: l.id, status: l.status });
  return m;
}

// ── Divergências: nomes pra mostrar ────────────────────────────────────────

export interface ContextoDivergencias {
  clientes: Record<string, string>;
  passageiros: Record<string, { nome: string; expedicao_id: string | null; expedicao: string; tipo: string | null }>;
}

/** Nome das fichas e das idas (com a expedição) que aparecem na fila. */
export async function contextoDivergencias(clienteIds: string[], passageiroIds: string[]): Promise<ContextoDivergencias> {
  const [cs, ps] = await Promise.all([
    emFatias<{ id: string; nome: string }>([...new Set(clienteIds)], (f) => supabase.from("rel_clientes").select("id, nome").in("id", f)).catch(() => []),
    emFatias<{ id: string; nome_completo: string; expedicao_id: string | null; expedicao: { codigo: string; nome: string; tipo: string | null } | null }>(
      [...new Set(passageiroIds)],
      (f) => supabase.from("passageiros").select("id, nome_completo, expedicao_id, expedicao:expedicoes(codigo, nome, tipo)").in("id", f)).catch(() => []),
  ]);
  return {
    clientes: Object.fromEntries(cs.map((c) => [c.id, c.nome])),
    passageiros: Object.fromEntries(ps.map((p) => [p.id, {
      nome: p.nome_completo, expedicao_id: p.expedicao_id,
      expedicao: p.expedicao ? `${p.expedicao.nome} (${p.expedicao.codigo})` : "sem expedição", tipo: p.expedicao?.tipo ?? null,
    }])),
  };
}

/** Quantas divergências estão abertas. null = a 0172 ainda não foi aplicada (ou sem permissão). */
export async function contarDivergencias(): Promise<number | null> {
  const { count, error } = await supabase.from("cad_divergencias").select("id", { count: "exact", head: true }).is("resolvido_em", null);
  if (error) return null;
  return count ?? 0;
}

/** O retrato que a importação de 13/10 guardou na ficha (reserva quando ainda não há ida ligada). */
export async function retratoExpedicoes(clienteId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from("rel_clientes").select("dados_expedicoes").eq("id", clienteId).maybeSingle();
  if (error || !data) return null;
  const d = (data as { dados_expedicoes: Record<string, unknown> | null }).dados_expedicoes;
  return d && typeof d === "object" ? d : null;
}
