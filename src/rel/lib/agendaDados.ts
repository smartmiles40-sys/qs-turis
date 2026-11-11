// src/rel/lib/agendaDados.ts
// -----------------------------------------------------------------------------
// Leituras das abas CHECK-INS e SERVIÇOS das Viagens (11/11). A regra fica em
// agendaServicos.ts (pura, com teste); aqui só o banco.
//
// RLS de sempre: rel_trechos_v / rel_viagens_v são security_invoker. Marcar o
// check-in passa pela RPC rel_trecho_checkin (0227, com histórico).
//
// Sem a 0359 aplicada as colunas aereo_vendido / conta_como_voo não existem:
// a leitura tenta com elas e, se o banco disser "coluna não existe", lê sem —
// a regra pura cai no serviço da venda.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { lotes } from "@/lib/lotes";
import type { TrechoAgenda, ViagemAgenda } from "./agendaServicos";

const COLS_VIAGEM = "id,titulo,cliente_id,cliente_nome,data_embarque,data_retorno,servico,status,responsavel_nome";
const PAGINA = 1000;
const MAX_LINHAS = 6000;

type Erro = { code?: string; message?: string } | null;
const colunaFalta = (e: Erro) => !!e && (e.code === "42703" || /column .* does not exist|não existe/i.test(e.message ?? ""));

/** Lê em páginas de 1000 (o PostgREST corta em 1000 em silêncio), desempate por id. */
async function paginado<T>(montar: (de: number, ate: number) => PromiseLike<{ data: unknown; error: Erro }>): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; de < MAX_LINHAS; de += PAGINA) {
    const { data, error } = await montar(de, de + PAGINA - 1);
    if (error) throw error;
    const l = (data ?? []) as T[];
    out.push(...l);
    if (l.length < PAGINA) break;
  }
  return out;
}

/** As viagens (cliente, embarque, serviço) dos trechos. */
export async function viagensDaAgenda(ids: string[]): Promise<Map<string, ViagemAgenda>> {
  const m = new Map<string, ViagemAgenda>();
  const unicos = [...new Set(ids)];
  if (!unicos.length) return m;
  const ler = (cols: string) => Promise.all(lotes(unicos, 150).map((l) => supabase.from("rel_viagens_v").select(cols).in("id", l)));
  let rs = await ler(`${COLS_VIAGEM},aereo_vendido`);
  if (rs.some((r) => colunaFalta(r.error))) rs = await ler(COLS_VIAGEM);
  for (const { data, error } of rs) {
    if (error) throw error;
    for (const v of (data ?? []) as unknown as ViagemAgenda[]) m.set(v.id, v);
  }
  return m;
}

const TIPOS_VOO = ["voo_internacional", "voo_interno"];

/**
 * Voos de viagens ativas que ainda vão sair (com folga de 30h pro voo sem
 * horário, que vale até o fim do dia). A fila final sai de filaDeCheckins().
 */
export async function carregarVoosFuturos(): Promise<{ trechos: TrechoAgenda[]; viagens: Map<string, ViagemAgenda> }> {
  const desde = new Date(Date.now() - 30 * 3600_000).toISOString();
  const trechos = await paginado<TrechoAgenda>((de, ate) => supabase.from("rel_trechos_v").select("*")
    .eq("viagem_status", "ativa").in("tipo", TIPOS_VOO).gte("partida_em", desde)
    .order("partida_em").order("id").range(de, ate));
  const viagens = await viagensDaAgenda(trechos.map((t) => t.viagem_id));
  // viagem arquivada/cancelada (a view de trechos só filtra viagem_status = ativa) — garante
  return { trechos: trechos.filter((t) => viagens.has(t.viagem_id)), viagens };
}

const SERVICOS_DA_VENDA = ["hospedagem", "passeio", "seguro"];

async function trechosDe(ids: string[]): Promise<TrechoAgenda[]> {
  const out: TrechoAgenda[] = [];
  const rs = await Promise.all(lotes([...new Set(ids)], 150).map((l) => supabase.from("rel_trechos_v").select("*").in("viagem_id", l).order("partida_em")));
  for (const { data, error } of rs) {
    if (error) throw error;
    out.push(...((data ?? []) as TrechoAgenda[]));
  }
  return out;
}

/**
 * Por DATA DA AÇÃO: trechos com partida, chegada (check-out) ou check-in no
 * período [de, ate) + vendas de hotel/passeio/seguro com ida ou volta nele
 * (entram pelas datas da venda quando não têm trecho).
 */
export async function carregarAcoesDoPeriodo(deIso: string, ateIso: string): Promise<{ trechos: TrechoAgenda[]; viagens: Map<string, ViagemAgenda> }> {
  const [noPeriodo, vendas] = await Promise.all([
    paginado<TrechoAgenda>((de, ate) => supabase.from("rel_trechos_v").select("*").eq("viagem_status", "ativa")
      .or(`and(partida_em.gte.${deIso},partida_em.lt.${ateIso}),and(chegada_em.gte.${deIso},chegada_em.lt.${ateIso}),and(checkin_em.gte.${deIso},checkin_em.lt.${ateIso})`)
      .order("partida_em").order("id").range(de, ate)),
    (async () => {
      const d = deIso.slice(0, 10), a = ateIso.slice(0, 10);
      const { data, error } = await supabase.from("rel_viagens_v").select("id").eq("status", "ativa").in("servico", SERVICOS_DA_VENDA)
        .or(`and(data_embarque.gte.${d},data_embarque.lte.${a}),and(data_retorno.gte.${d},data_retorno.lte.${a})`).limit(1000);
      if (error) throw error;
      return ((data ?? []) as { id: string }[]).map((x) => x.id);
    })(),
  ]);
  // das vendas sem trecho no período, os trechos delas (pra saber se já têm o hotel cadastrado)
  const comTrecho = new Set(noPeriodo.map((t) => t.viagem_id));
  const extras = await trechosDe(vendas.filter((id) => !comTrecho.has(id)));
  const vistos = new Set(noPeriodo.map((t) => t.id));
  const trechos = [...noPeriodo, ...extras.filter((t) => !vistos.has(t.id))];
  const viagens = await viagensDaAgenda([...trechos.map((t) => t.viagem_id), ...vendas]);
  for (const [id, v] of viagens) if (v.status && v.status !== "ativa") viagens.delete(id);
  return { trechos: trechos.filter((t) => viagens.has(t.viagem_id)), viagens };
}

/** Por DATA DE EMBARQUE: as viagens ativas que embarcam no período [de, ate] (AAAA-MM-DD) e tudo delas. */
export async function carregarAcoesPorEmbarque(de: string, ate: string): Promise<{ trechos: TrechoAgenda[]; viagens: Map<string, ViagemAgenda>; cortado: boolean }> {
  const { data, error } = await supabase.from("rel_viagens_v").select("id").eq("status", "ativa")
    .gte("data_embarque", de).lte("data_embarque", ate).order("data_embarque").limit(1000);
  if (error) throw error;
  const ids = ((data ?? []) as { id: string }[]).map((x) => x.id);
  const [trechos, viagens] = await Promise.all([trechosDe(ids), viagensDaAgenda(ids)]);
  return { trechos, viagens, cortado: ids.length >= 1000 };
}
