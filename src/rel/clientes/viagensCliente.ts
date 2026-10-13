// src/rel/clientes/viagensCliente.ts
// -----------------------------------------------------------------------------
// Dados do "passaporte do cliente" (Viagens com a gente, na ficha).
//
// 1. todasDoCliente: TODAS as viagens do cliente — como titular (rel_viagens.
//    cliente_id) e como acompanhante (rel_viagem_passageiros). Mesma lógica de
//    antes, só mudou de arquivo.
// 2. extrasDasViagens: o que enfeita cada carimbo — trechos (voos e check-in),
//    documentos por tipo, quem mais foi junto e o selo da revisão da IA.
//    Cada leitura é independente: se uma falhar (ex.: coluna da 0115 ainda não
//    aplicada), as outras continuam e o carimbo só não mostra aquele pedaço.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { TipoDocumento, TipoTrecho, Viagem } from "../lib/viagens";

export async function todasDoCliente(clienteId: string): Promise<Viagem[]> {
  const { data: ps, error: e1 } = await supabase.from("rel_viagem_passageiros").select("viagem_id").eq("cliente_id", clienteId);
  if (e1) throw e1;
  const ids = (ps ?? []).map((p: { viagem_id: string }) => p.viagem_id);
  let q = supabase.from("rel_viagens_v").select("*");
  q = ids.length ? q.or(`cliente_id.eq.${clienteId},id.in.(${[...new Set(ids)].join(",")})`) : q.eq("cliente_id", clienteId);
  const { data, error } = await q.order("data_embarque", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Viagem[];
}

export type IaRevisao = "ok" | "divergente" | "incompleta" | "erro";

export interface ProximoVoo {
  origem: string | null;
  destino: string | null;
  partida_em: string;
  companhia: string | null;
  numero: string | null;
  checkin_em: string | null;
  checkin_feito: boolean;
}

export interface ExtraViagem {
  voos: number;
  trechos: number;
  proximoVoo: ProximoVoo | null;
  docs: Partial<Record<TipoDocumento, number>>;
  /** Primeiro nome de quem mais estava na viagem (sem o próprio cliente). */
  companhia: string[];
  ia: IaRevisao | null;
}

export interface Extras {
  porViagem: Map<string, ExtraViagem>;
  /** true quando alguma leitura falhou (o carimbo mostra o que deu). */
  parcial: boolean;
}

const vazio = (): ExtraViagem => ({ voos: 0, trechos: 0, proximoVoo: null, docs: {}, companhia: [], ia: null });

function lotes<T>(xs: T[], n = 150): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < xs.length; i += n) r.push(xs.slice(i, i + n));
  return r;
}

async function lerEmLotes<T>(ids: string[], ler: (lote: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (const lote of lotes(ids)) {
    const { data, error } = await ler(lote);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

export async function extrasDasViagens(clienteId: string, ids: string[]): Promise<Extras> {
  const porViagem = new Map<string, ExtraViagem>(ids.map((id) => [id, vazio()]));
  if (!ids.length) return { porViagem, parcial: false };
  const de = (id: string) => porViagem.get(id) ?? vazio();
  const agora = Date.now() - 6 * 3600_000; // voo de hoje cedo ainda conta como "próximo"

  const [trechos, docs, pax, ia] = await Promise.allSettled([
    lerEmLotes<{ viagem_id: string; tipo: TipoTrecho; origem: string | null; destino: string | null; partida_em: string; companhia: string | null; numero: string | null; checkin_em: string | null; checkin_feito_em: string | null }>(
      ids, (l) => supabase.from("rel_trechos_v")
        .select("viagem_id, tipo, origem, destino, partida_em, companhia, numero, checkin_em, checkin_feito_em")
        .in("viagem_id", l).order("partida_em")),
    lerEmLotes<{ viagem_id: string; tipo: TipoDocumento; status: string }>(
      ids, (l) => supabase.from("rel_documentos").select("viagem_id, tipo, status").in("viagem_id", l)),
    lerEmLotes<{ viagem_id: string; cliente_id: string; cliente: { nome: string } | null }>(
      ids, (l) => supabase.from("rel_viagem_passageiros").select("viagem_id, cliente_id, cliente:rel_clientes(nome)").in("viagem_id", l)),
    // ia_revisao_status chegou na 0115 — se a coluna ainda não existir, só fica sem selo.
    lerEmLotes<{ id: string; ia_revisao_status: IaRevisao | null }>(
      ids, (l) => supabase.from("rel_viagens").select("id, ia_revisao_status").in("id", l)),
  ]);

  if (trechos.status === "fulfilled") {
    for (const t of trechos.value) {
      const e = de(t.viagem_id);
      e.trechos++;
      if (t.tipo !== "voo_internacional" && t.tipo !== "voo_interno") continue;
      e.voos++;
      if (!e.proximoVoo && new Date(t.partida_em).getTime() >= agora) {
        e.proximoVoo = {
          origem: t.origem, destino: t.destino, partida_em: t.partida_em, companhia: t.companhia, numero: t.numero,
          checkin_em: t.checkin_em, checkin_feito: !!t.checkin_feito_em,
        };
      }
      porViagem.set(t.viagem_id, e);
    }
  }
  if (docs.status === "fulfilled") {
    for (const d of docs.value) {
      if (d.status === "recusado") continue;
      const e = de(d.viagem_id);
      e.docs[d.tipo] = (e.docs[d.tipo] ?? 0) + 1;
      porViagem.set(d.viagem_id, e);
    }
  }
  if (pax.status === "fulfilled") {
    for (const p of pax.value) {
      if (p.cliente_id === clienteId || !p.cliente?.nome) continue;
      const e = de(p.viagem_id);
      e.companhia.push(p.cliente.nome.trim().split(/\s+/)[0]);
      porViagem.set(p.viagem_id, e);
    }
  }
  if (ia.status === "fulfilled") {
    for (const r of ia.value) {
      if (!r.ia_revisao_status) continue;
      const e = de(r.id);
      e.ia = r.ia_revisao_status;
      porViagem.set(r.id, e);
    }
  }

  // a IA é opcional (migration nova): falhar ali não conta como "parcial"
  const parcial = [trechos, docs, pax].some((r) => r.status === "rejected");
  return { porViagem, parcial };
}
