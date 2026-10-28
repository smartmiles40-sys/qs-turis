// src/closer/vendaItens.ts
// -----------------------------------------------------------------------------
// A VENDA POR ITENS (0207, Bruno 27/10/2026): o closer registra o que vendeu,
// item por item (aéreo, pacote, seguro, expedição…), com os campos do catálogo
// único (TIPOS em src/propostas/lib.ts). Os mesmos itens viram componentes da
// viagem no Relacionamento e aparecem pro cliente no app
// (docs/CONTRATO-VENDA-ITENS.md).
//
// Escrita por RPC (closer_venda_itens_salvar / closer_pre_venda), que confere
// se é o closer dono ou a gestão. O Bitrix é do servidor (api/closer.js).
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import {
  TIPOS, carregarProposta, novaChave, tipoVendaBitrix, totaisDaOpcao, type ItemProposta, type TipoItem, type Trecho,
} from "@/propostas/lib";
import { erroAmigavel, preVendaNoBitrix } from "./lib";

export type StatusItem = "vendido" | "emitido" | "cancelado";
export interface ItemVenda {
  id?: string;
  /** Chave só da tela. */
  k: string;
  tipo: TipoItem;
  nome: string;
  data_inicio: string;
  data_fim: string;
  dados: Record<string, string>;
  passageiros: { cliente_id?: string | null; nome: string }[];
  valor: number | null;
  custo: number | null;
  fornecedor: string;
  status?: StatusItem;
}

export function itemVendaVazio(tipo: TipoItem): ItemVenda {
  return { k: novaChave(), tipo, nome: "", data_inicio: "", data_fim: "", dados: {}, passageiros: [], valor: null, custo: null, fornecedor: "", status: "vendido" };
}

/** Nome que vai pro item quando o closer deixa em branco. */
export function nomeSugerido(i: Pick<ItemVenda, "tipo" | "dados">): string {
  const d = i.dados;
  switch (i.tipo) {
    case "aereo": return d.companhia ? `Aéreo ${d.companhia}` : "Passagem aérea";
    case "pacote": return d.destino ? `Pacote ${d.destino}` : "Pacote de viagem";
    case "expedicao": return ["Expedição", d.expedicao, d.edicao].filter(Boolean).join(" ") || "Expedição";
    case "seguro": return d.seguradora ? `Seguro ${d.seguradora}` : "Seguro viagem";
    default: return TIPOS[i.tipo].rotulo;
  }
}

const numOuNulo = (v: unknown) => (v == null || v === "" ? null : Number(v));

export async function listarItensDaVenda(negocioId: string): Promise<ItemVenda[]> {
  const { data, error } = await supabase.from("qs_venda_itens").select("*").eq("negocio_id", negocioId).order("ordem");
  if (error) {
    // Banco ainda sem a 0207: a tela funciona vazia.
    if (/qs_venda_itens/.test(error.message)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string, k: r.id as string, tipo: r.tipo as TipoItem, nome: (r.nome as string) ?? "",
    data_inicio: (r.data_inicio as string) ?? "", data_fim: (r.data_fim as string) ?? "",
    dados: Object.fromEntries(Object.entries((r.dados as Record<string, unknown>) ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : v == null ? "" : String(v)])),
    passageiros: Array.isArray(r.passageiros) ? (r.passageiros as ItemVenda["passageiros"]) : [],
    valor: numOuNulo(r.valor), custo: numOuNulo(r.custo), fornecedor: (r.fornecedor as string) ?? "",
    status: (r.status as StatusItem) ?? "vendido",
  }));
}

export async function salvarItensDaVenda(negocioId: string, itens: ItemVenda[]): Promise<void> {
  const corpo = itens.map((i) => ({
    id: i.id ?? null, tipo: i.tipo, nome: i.nome.trim() || nomeSugerido(i),
    data_inicio: i.data_inicio || null, data_fim: i.data_fim || null,
    // Só o que tem valor (o servidor junta com o que o Rel já gravou).
    dados: Object.fromEntries(Object.entries(i.dados).filter(([, v]) => String(v ?? "").trim() !== "")),
    passageiros: i.passageiros.filter((p) => p.nome.trim()),
    valor: i.valor, custo: i.custo, fornecedor: i.fornecedor,
  }));
  const { error } = await supabase.rpc("closer_venda_itens_salvar", { p_negocio: negocioId, p_itens: corpo });
  if (error) throw new Error(erroAmigavel(error));
}

export const somaDosItens = (itens: Pick<ItemVenda, "valor">[]) =>
  Math.round(itens.reduce((s, i) => s + (Number(i.valor) || 0), 0) * 100) / 100;

/** O item que dá o "Tipo de venda" no Bitrix: o de maior valor (empate: o primeiro). */
export function itemPrincipal<T extends Pick<ItemVenda, "tipo" | "valor">>(itens: T[]): T | null {
  let melhor: T | null = null;
  for (const i of itens) if (!melhor || (Number(i.valor) || 0) > (Number(melhor.valor) || 0)) melhor = i;
  return melhor;
}

// ── Pré-venda ──────────────────────────────────────────────────────────────
export interface ResultadoPreVenda { mensagem: string; tom: "ok" | "aviso" }

/**
 * "Marcar como venda": grava no banco (RPC) e já manda o Bitrix pra coluna de
 * venda (é o que o Dashboard conta). Bitrix fora do ar? A pré-venda fica
 * gravada e o cron reenvia — a tela avisa.
 */
export async function marcarPreVenda(negocioId: string, principal?: { tipo: TipoItem; valor?: number | null } | null): Promise<ResultadoPreVenda> {
  const tb = principal ? tipoVendaBitrix(principal.tipo) : null;
  const { data, error } = await supabase.rpc("closer_pre_venda", {
    p_negocio: negocioId, p_acao: "marcar",
    p_tipo: principal?.tipo ?? null, p_tipo_bitrix: tb?.id ?? null, p_valor: principal?.valor ?? null,
  });
  if (error) throw new Error(erroAmigavel(error));
  const r = data as { bitrix?: boolean; ja_estava?: boolean } | null;
  return depoisDoBanco(negocioId, r, r?.ja_estava ? "Venda atualizada! Já sobe pro Dashboard." : "Venda registrada! Já sobe pro Dashboard.");
}

export async function desfazerPreVenda(negocioId: string): Promise<ResultadoPreVenda> {
  const { data, error } = await supabase.rpc("closer_pre_venda", { p_negocio: negocioId, p_acao: "desfazer" });
  if (error) throw new Error(erroAmigavel(error));
  return depoisDoBanco(negocioId, data as { bitrix?: boolean } | null, "Pré-venda desfeita.");
}

async function depoisDoBanco(negocioId: string, r: { bitrix?: boolean } | null, ok: string): Promise<ResultadoPreVenda> {
  if (r && r.bitrix === false) return { tom: "aviso", mensagem: `${ok.replace(" Já sobe pro Dashboard.", "")} Este cliente não tem card no Bitrix, então ficou só no QS (o Dashboard não vê).` };
  try {
    const b = await preVendaNoBitrix(negocioId);
    if (b.ok) return { tom: "ok", mensagem: `${ok} Bitrix atualizado.` };
    return { tom: "aviso", mensagem: `${ok.replace(" Já sobe pro Dashboard.", "")} Gravado no QS, mas o Bitrix recusou: ${b.mensagem ?? "sem motivo"}. O QS tenta de novo sozinho a cada 10 min (ou use "Reenviar").` };
  } catch (e) {
    return { tom: "aviso", mensagem: `Gravado no QS. O Bitrix não respondeu (${(e as Error).message}) — o QS tenta de novo sozinho a cada 10 min.` };
  }
}

// ── Pré-preencher pela proposta aprovada ───────────────────────────────────
/** Texto dos trechos estruturados da proposta ("GRU → NRT 12/03 JL 45"). */
function textoDosTrechos(t: Trecho[]): string {
  return t.filter((x) => x.origem || x.destino).map((x) => {
    const data = x.data ? x.data.slice(8, 10) + "/" + x.data.slice(5, 7) : "";
    return [`${x.origem || "?"} → ${x.destino || "?"}`, data, [x.cia, x.voo].filter(Boolean).join(" "), x.saida ? `sai ${x.saida}` : ""].filter(Boolean).join(" · ");
  }).join("\n");
}

function deItemDaProposta(i: ItemProposta): ItemVenda {
  const dados: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.detalhes ?? {})) if (typeof v === "string" || typeof v === "number") dados[k] = String(v);
  if (i.tipo === "aereo" && Array.isArray(i.detalhes?.trechos)) {
    const t = i.detalhes.trechos as Trecho[];
    if (!dados.voos) dados.voos = textoDosTrechos(t);
    if (!dados.companhia) dados.companhia = [...new Set(t.map((x) => x.cia).filter(Boolean))].join(" / ");
    if (!dados.classe) dados.classe = t.find((x) => x.classe)?.classe ?? "";
  }
  let ini = i.data_inicio, fim = i.data_fim;
  if (i.tipo === "aereo" && Array.isArray(i.detalhes?.trechos)) {
    const t = i.detalhes.trechos as Trecho[];
    ini = ini || t.find((x) => x.sentido === "ida")?.data || t[0]?.data || "";
    fim = fim || t.filter((x) => x.sentido === "volta").pop()?.data || "";
  }
  return {
    k: novaChave(), tipo: i.tipo, nome: i.nome, data_inicio: ini || "", data_fim: fim || "", dados, passageiros: [],
    valor: i.incluso ? 0 : Number(i.valor_total) || 0, custo: i.custo, fornecedor: i.fornecedor ?? "", status: "vendido",
  };
}

/** Proposta aprovada mais recente do cliente (direto no lead ou pela solicitação dele) → itens da venda. */
export async function itensDaPropostaAprovada(leadId: string): Promise<{ itens: ItemVenda[]; origem: string; passageiros: number } | null> {
  const { data: sols } = await supabase.from("qs_solicitacoes").select("id").eq("lead_id", leadId);
  const solIds = (sols ?? []).map((s) => s.id as string);
  let q = supabase.from("qs_propostas").select("id").eq("status", "aprovada").order("aprovada_em", { ascending: false }).limit(1);
  q = solIds.length ? q.or(`lead_id.eq.${leadId},solicitacao_id.in.(${solIds.join(",")})`) : q.eq("lead_id", leadId);
  const { data: ap } = await q;
  const pid = ap?.[0]?.id as string | undefined;
  if (!pid) return null;
  const p = await carregarProposta(pid);
  const op = p.opcoes.find((o) => o.id === p.aprovada_opcao_id) ?? p.opcoes[0];
  if (!op?.itens.length) return null;
  const itens = op.itens.map(deItemDaProposta);
  // Desconto da opção: tira do maior item, pra soma bater com o que o cliente aprovou.
  const tot = totaisDaOpcao(op);
  if (tot.desconto > 0) {
    const m = itemPrincipal(itens);
    if (m) m.valor = Math.max(0, Math.round(((Number(m.valor) || 0) - tot.desconto) * 100) / 100);
  }
  if (p.destino) for (const i of itens) if (i.tipo === "pacote" && !i.dados.destino) i.dados.destino = p.destino;
  return {
    itens,
    origem: `proposta nº ${p.numero ?? ""} — opção "${op.titulo || "aprovada"}"${p.aprovada_nome ? `, aprovada por ${p.aprovada_nome}` : ""}`,
    passageiros: (p.adultos || 0) + (p.criancas || 0) + (p.bebes || 0),
  };
}
