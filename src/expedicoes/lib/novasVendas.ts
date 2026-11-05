// src/expedicoes/lib/novasVendas.ts
// Fila "Novas vendas" (app antigo: app/(app)/novas-vendas/actions.ts, 685d5f8).
// Quem a sync do Bitrix trouxe NOVO pra uma expedição (passageiros.nova_venda,
// 0317) e o time ainda não conferiu. "Conferir" só tira da fila (nova_venda=false);
// o passageiro continua na expedição. Degrada: sem a 0317 a fila fica vazia e a
// tela avisa; sem a 0318 (nova_venda_em) usa a data de criação.
// Também lê a última rodada da sync automática (exp_bitrix_sync_rodadas, 0318).
import { supabase } from "./banco";

export type NovaVenda = {
  passageiro_id: string;
  nome: string;
  cpf: string | null;
  telefone: string | null;
  email: string | null;
  status_reserva: string;
  bitrix_deal_id: string | null;
  expedicao_id: string;
  expedicao_codigo: string;
  expedicao_nome: string;
  expedicao_tipo: "expedicao" | "pacote";
  destino: string;
  data_embarque: string | null;
  /** Quando entrou na fila (nova_venda_em, 0318) — senão a criação da linha. */
  entrou_em: string | null;
};

type Linha = {
  id: string; nome_completo: string; cpf: string | null; telefone: string | null; email: string | null;
  status_reserva: string; bitrix_deal_id: string | null; expedicao_id: string; created_at: string; nova_venda_em?: string | null;
  expedicoes: { codigo: string; nome: string; destino: string; data_embarque: string | null; status: string; tipo?: string | null } | null;
};

const BASE = "id,nome_completo,cpf,telefone,email,status_reserva,bitrix_deal_id,expedicao_id,created_at";
const EXP = "expedicoes!inner(codigo,nome,destino,data_embarque,status,tipo)";

/** A fila existe no banco? (false = falta a 0317.) */
export class FilaIndisponivel extends Error {}

async function lerLinhas(comCarimbo: boolean): Promise<Linha[]> {
  const { data, error } = await supabase.from("passageiros")
    .select(`${BASE}${comCarimbo ? ",nova_venda_em" : ""},${EXP}`)
    .eq("nova_venda", true).neq("expedicoes.status", "Cancelada").limit(1000);
  if (error) throw error;
  return (data ?? []) as unknown as Linha[];
}

export async function listarNovasVendas(): Promise<NovaVenda[]> {
  let linhas: Linha[];
  try { linhas = await lerLinhas(true); }
  catch {
    try { linhas = await lerLinhas(false); }
    catch (e) {
      const msg = (e as { message?: string })?.message ?? "";
      if (/nova_venda/.test(msg)) throw new FilaIndisponivel("A fila ainda não foi ligada no banco (falta a migration 0317).");
      throw new Error(msg || "Erro ao carregar");
    }
  }
  return linhas.filter((p) => p.expedicoes).map((p) => ({
    passageiro_id: p.id, nome: p.nome_completo, cpf: p.cpf, telefone: p.telefone, email: p.email,
    status_reserva: p.status_reserva, bitrix_deal_id: p.bitrix_deal_id, expedicao_id: p.expedicao_id,
    expedicao_codigo: p.expedicoes!.codigo, expedicao_nome: p.expedicoes!.nome,
    expedicao_tipo: p.expedicoes!.tipo === "pacote" ? ("pacote" as const) : ("expedicao" as const),
    destino: p.expedicoes!.destino, data_embarque: p.expedicoes!.data_embarque,
    entrou_em: p.nova_venda_em ?? p.created_at ?? null,
  })).sort((a, b) => (b.entrou_em ?? "").localeCompare(a.entrou_em ?? ""));
}

/** Número do selo do menu (0 se a fila não existe ou sem acesso). */
export async function contarNovasVendas(): Promise<number> {
  const { count, error } = await supabase.from("passageiros")
    .select("id,expedicoes!inner(status)", { count: "exact", head: true })
    .eq("nova_venda", true).neq("expedicoes.status", "Cancelada");
  return error ? 0 : count ?? 0;
}

/** Conferida: sai da fila (o passageiro continua na expedição). */
export async function marcarConferidas(ids: string[]): Promise<void> {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from("passageiros").update({ nova_venda: false }).in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
}

/** Volta pra fila (desfazer do "Conferir"). */
export async function devolverParaFila(id: string): Promise<void> {
  const { error } = await supabase.from("passageiros").update({ nova_venda: true }).eq("id", id);
  if (error) throw new Error(error.message);
}

export type ItemPrevia = { acao: "criar" | "anexar" | "atualizar"; deal: string; nome: string; campos?: string[] };
export type ResumoExpedicao = {
  ok: boolean; codigo: string; coluna?: string; negocios?: number; criados?: number; anexados?: number; atualizados?: number;
  conferidos?: number; sem_grupo?: { deal: string; nome: string }[]; pulados?: { deal: string; nome: string; motivo: string }[];
  erros?: { deal: string; erro: string }[]; previa?: ItemPrevia[]; error?: string;
};
export type RodadaSync = {
  dia: string; modo: "seco" | "gravando"; iniciado_em: string; atualizado_em: string; terminado_em: string | null;
  resumo: Record<string, ResumoExpedicao>;
};

/** Última rodada da sync automática (null se não houve ou sem a 0318). */
export async function ultimaRodadaSync(): Promise<RodadaSync | null> {
  const { data, error } = await supabase.from("exp_bitrix_sync_rodadas")
    .select("dia,modo,iniciado_em,atualizado_em,terminado_em,resumo")
    .order("atualizado_em", { ascending: false }).limit(1);
  if (error || !data?.length) return null;
  return data[0] as RodadaSync;
}
