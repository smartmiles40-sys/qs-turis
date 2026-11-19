// src/rel/lib/filtroViagensDados.ts
// -----------------------------------------------------------------------------
// A consulta da aba "Filtrar" das Viagens. A lógica (datas, serviço, busca,
// situação) é pura e testada em filtroViagens.ts; aqui só monta no supabase.
//
// "Tem hotel/transfer/passeio/trem" sai dos trechos (rel_viagem_trechos): são
// poucos (dezenas), então busca os ids das viagens e entra como `id in (...)`.
// Voo interno / algum voo / nenhum voo saem das colunas da view (0152).
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { Viagem } from "./viagens";
import {
  TEM_POR_TRECHO, colunaDeOrdem, condicoesDaSituacao, condicoesDeData, grupoDaBusca, grupoDosServicos, intervaloDoPeriodo, juntarGrupos,
  type FiltroAvancado, type TemNoRoteiro,
} from "./filtroViagens";

export const LIMITE_FILTRO = 500;
const NINGUEM = "00000000-0000-0000-0000-000000000000";

async function viagensComTrecho(tipo: TemNoRoteiro): Promise<Set<string>> {
  const ids = new Set<string>();
  // paginado: o PostgREST corta em 1000 calado
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from("rel_viagem_trechos").select("viagem_id").eq("tipo", tipo).order("id").range(de, de + 999);
    if (error) throw error;
    for (const r of (data ?? []) as { viagem_id: string }[]) ids.add(r.viagem_id);
    if (!data || data.length < 1000) break;
  }
  return ids;
}

export interface ResultadoFiltro { lista: Viagem[]; total: number; cortado: boolean }

export async function filtrarViagens(f: FiltroAvancado, hoje: string, userId: string): Promise<ResultadoFiltro> {
  // 1) trechos: a viagem precisa ter TODOS os marcados
  const porTrecho = f.tem.filter((t) => TEM_POR_TRECHO.includes(t));
  let soIds: string[] | null = null;
  if (porTrecho.length) {
    const conjuntos = await Promise.all(porTrecho.map(viagensComTrecho));
    const comum = conjuntos.reduce((a, c) => new Set([...a].filter((id) => c.has(id))));
    soIds = [...comum];
    if (!soIds.length) return { lista: [], total: 0, cortado: false };
  }

  let q = supabase.from("rel_viagens_v").select("*", { count: "exact" });

  // 2) situação
  const sit = condicoesDaSituacao(f.situacao);
  if (sit.status) q = q.eq("status", sit.status);
  if (sit.fases) q = q.in("fase", sit.fases);

  // 3) data
  const { de, ate } = intervaloDoPeriodo(f, hoje);
  const datas = condicoesDeData(f.campo, de, ate);
  for (const c of datas.simples) q = c.op === "gte" ? q.gte(c.coluna, c.valor) : c.op === "lte" ? q.lte(c.coluna, c.valor) : q.lt(c.coluna, c.valor);

  // 4) roteiro (colunas da view + ids dos trechos)
  if (f.tem.includes("voo_interno")) q = q.gt("voos_internos", 0);
  if (f.tem.includes("voo")) q = q.gt("voos_total", 0);
  if (soIds) q = q.in("id", soIds);

  // 5) dono
  if (f.dono === "minhas") q = q.eq("responsavel_id", userId || NINGUEM);
  else if (f.dono === "sem_dono") q = q.is("responsavel_id", null);
  else if (f.dono && f.dono !== "todos") q = q.eq("responsavel_id", f.dono);

  // 6) os or() num parâmetro só (o PostgREST aceita UM or= por consulta)
  const junto = juntarGrupos([
    datas.grupo,
    grupoDosServicos(f.servicos),
    grupoDaBusca(f.busca),
    f.tem.includes("sem_voo") ? "or(voos_total.is.null,voos_total.eq.0)" : null,
  ]);
  if (junto) q = q.or(junto);

  const ordem = colunaDeOrdem(f.campo);
  q = q.order(ordem.coluna, { ascending: ordem.asc, nullsFirst: false }).order("id").limit(LIMITE_FILTRO);
  const { data, error, count } = await q;
  if (error) throw error;
  const lista = (data ?? []) as Viagem[];
  return { lista, total: count ?? lista.length, cortado: (count ?? 0) > lista.length };
}
