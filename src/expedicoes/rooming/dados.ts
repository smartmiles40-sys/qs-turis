// src/expedicoes/rooming/dados.ts
// Leitura e escrita do Rooming (app antigo: rooming/page.tsx + as server actions
// de quarto/alocação/conexão de expedicoes/actions.ts). Toda escrita de várias
// linhas vai por função SQL da migração 0168 (uma transação cada, com checagem de
// capacidade/extensão no banco e numeração estável dos quartos).
import { supabase, lerTudo, lerPorIds, traduzirErro } from "../lib/banco";
import type { AlocacaoQuartoRow, PassageiroRow, QuartoRow } from "../lib/database";

export interface DadosRooming {
  passageiros: PassageiroRow[];
  quartos: QuartoRow[];
  alocacoes: AlocacaoQuartoRow[];
  grupos: { id: string; nome: string }[];
  extensoes: { id: string; nome: string }[];
  contratacoes: { passageiro_id: string; extensao_id: string }[];
}

export async function carregarRooming(expId: string): Promise<DadosRooming> {
  const [passageiros, quartos, grupos, extensoes] = await Promise.all([
    lerTudo<PassageiroRow>("passageiros", (q) => q.eq("expedicao_id", expId)),
    lerTudo<QuartoRow>("quartos", (q) => q.eq("expedicao_id", expId)),
    lerTudo<{ id: string; nome: string; ordem: number }>("grupos_expedicao", (q) => q.eq("expedicao_id", expId), "id, nome, ordem"),
    lerTudo<{ id: string; nome: string; ordem: number; created_at: string }>("extensoes", (q) => q.eq("expedicao_id", expId), "id, nome, ordem, created_at"),
  ]);
  const [alocacoes, contratacoes] = await Promise.all([
    quartos.length ? lerPorIds<AlocacaoQuartoRow>("passageiro_quarto", "quarto_id", quartos.map((q) => q.id)) : Promise.resolve([]),
    extensoes.length
      ? lerPorIds<{ passageiro_id: string; extensao_id: string }>("passageiro_extensao", "extensao_id", extensoes.map((e) => e.id), "id, passageiro_id, extensao_id")
      : Promise.resolve([]),
  ]);
  // ocupantes em ordem de chegada (o antigo dependia da ordem que o banco devolvia)
  alocacoes.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id));
  extensoes.sort((a, b) => a.ordem - b.ordem || a.created_at.localeCompare(b.created_at));
  return {
    passageiros,
    quartos,
    alocacoes,
    grupos: grupos.map((g) => ({ id: g.id, nome: g.nome })),
    extensoes: extensoes.map((e) => ({ id: e.id, nome: e.nome })),
    contratacoes,
  };
}

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(traduzirErro(error.message));
  return data as T;
}

const dataOuNull = (s: string | null | undefined) => (s && s.trim() ? s.slice(0, 10) : null);
const textoOuNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export function criarQuartos(p: {
  expId: string; hotel: string | null; checkIn: string | null; checkOut: string | null; tipo: string; quantidade: number;
  extensaoId: string | null; observacoes?: string | null;
}) {
  return rpc<number>("exp_rooming_criar_quartos", {
    p_exp: p.expId, p_hotel: textoOuNull(p.hotel), p_ci: dataOuNull(p.checkIn), p_co: dataOuNull(p.checkOut),
    p_tipo: p.tipo, p_qtd: p.quantidade, p_ext: p.extensaoId || null, p_obs: textoOuNull(p.observacoes),
  });
}

export function atualizarQuarto(p: {
  quartoId: string; tipo: string; hotel: string | null; checkIn: string | null; checkOut: string | null;
  extensaoId: string | null; status: string; observacoes: string | null;
}) {
  return rpc("exp_rooming_atualizar_quarto", {
    p_quarto: p.quartoId, p_tipo: p.tipo, p_hotel: textoOuNull(p.hotel), p_ci: dataOuNull(p.checkIn), p_co: dataOuNull(p.checkOut),
    p_ext: p.extensaoId || null, p_status: p.status, p_obs: textoOuNull(p.observacoes),
  });
}

export const excluirQuartos = (expId: string, ids: string[]) => rpc<number>("exp_rooming_excluir_quartos", { p_exp: expId, p_ids: ids });
export const renomearHotel = (expId: string, ids: string[], nome: string) => rpc("exp_rooming_renomear_hotel", { p_exp: expId, p_ids: ids, p_nome: nome });
export const redatarHotel = (expId: string, ids: string[], ci: string, co: string) =>
  rpc("exp_rooming_redatar_hotel", { p_exp: expId, p_ids: ids, p_ci: dataOuNull(ci), p_co: dataOuNull(co) });
export const renumerarHotel = (expId: string, ids: string[]) => rpc<number>("exp_rooming_renumerar_hotel", { p_exp: expId, p_ids: ids });
export const duplicarQuartos = (expId: string, ids: string[], hotel: string, ci: string, co: string) =>
  rpc<number>("exp_rooming_duplicar", { p_exp: expId, p_ids: ids, p_hotel: hotel.trim(), p_ci: dataOuNull(ci), p_co: dataOuNull(co) });
export const alocar = (paxIds: string[], quartoId: string) => rpc("exp_rooming_alocar", { p_pax: paxIds, p_quarto: quartoId });
export const desalocar = (paxIds: string[], quartoIds: string[]) => rpc("exp_rooming_desalocar", { p_pax: paxIds, p_quartos: quartoIds });
/** Tira `remover` das conexões (dissolve se sobrar 1) e junta `conectar` (≥2) numa conexão só. */
export const salvarConexao = (expId: string, remover: string[], conectar: string[]) =>
  rpc("exp_rooming_conexao", { p_exp: expId, p_remover: remover, p_conectar: conectar });
export const desfazerConexao = (expId: string, conexaoId: string) => rpc("exp_rooming_desfazer_conexao", { p_exp: expId, p_conexao: conexaoId });
