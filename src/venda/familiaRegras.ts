// src/venda/familiaRegras.ts
// -----------------------------------------------------------------------------
// A FAMÍLIA DA VENDA (0351, Bruno 09/11/2026) — regras PURAS (sem banco, sem
// React), testadas em tests/venda/familiaRegras.test.ts.
//   "Quando sobe uma venda e a pessoa tem família, não tem lugar fácil de ver
//    que é uma família" → o cartão vira uma PASTA com todos que vão.
// O que mora aqui: rótulos (vínculo, Bitrix, contrato), o que falta de cada
// pessoa, o valor do titular (= o card PAI no Bitrix: total − filhos) e o
// resumo "Família · N pessoas". Os dados vêm de venda_familia (0351).
// Menor de idade e vínculos: os mesmos códigos de vendaRegras.ts (não duplica).
// -----------------------------------------------------------------------------
import { VINCULOS_VIAJANTE } from "./vendaRegras.ts";

export interface PessoaFamilia {
  id: string;
  cliente_id: string;
  comprador: boolean;
  vinculo: string | null;
  nome: string | null;
  cpf: string | null;
  nascimento: string | null;
  telefone: string | null;
  email: string | null;
  idade: number | null;
  menor: boolean | null;
  responsavel_cliente_id?: string | null;
  responsavel_nome: string | null;
  valor: number | null;
  aereo_incluso: boolean | null;
  itens?: number[];
  passageiro_id?: string | null;
  bitrix_deal_id: string | null;
  bitrix_status: string;
  bitrix_erro?: string | null;
  bitrix_em?: string | null;
  contrato_status: string | null;
  contrato_id?: string | null;
  removida_em: string | null;
}

export interface FamiliaDaVenda {
  negocio_id: string;
  venda_id: string;
  valor_total: number | null;
  data_ref: string | null;
  pessoas: PessoaFamilia[];
}

/** Os tons do <Etiqueta> (src/rel/ui.tsx). */
export type Tom = "aviso" | "erro" | "neutro" | "rel";

/** "Filho(a)", "Cônjuge"… ("Titular" pro comprador). */
export function rotuloVinculo(p: Pick<PessoaFamilia, "comprador" | "vinculo">): string {
  if (p.comprador) return "Titular";
  return (VINCULOS_VIAJANTE as Record<string, string>)[p.vinculo ?? ""] ?? "Acompanhante";
}

export const ativas = (ps: PessoaFamilia[] | null | undefined) => (ps ?? []).filter((p) => !p.removida_em);

/** É família quando tem mais de uma pessoa na venda (quem saiu não conta). */
export const ehFamilia = (f: Pick<FamiliaDaVenda, "pessoas"> | null | undefined) => ativas(f?.pessoas).length > 1;

/** O que falta na ficha da pessoa pro Operacional e pro contrato. */
export function faltasDaPessoa(p: Pick<PessoaFamilia, "comprador" | "cpf" | "nascimento" | "vinculo" | "telefone" | "email">): string[] {
  const f: string[] = [];
  if (!String(p.cpf ?? "").replace(/\D/g, "")) f.push("CPF");
  if (!p.nascimento) f.push("nascimento");
  if (!p.comprador && !p.vinculo) f.push("vínculo");
  if (p.comprador && !p.telefone && !p.email) f.push("contato");
  return f;
}

/** Valor do titular = card PAI no Bitrix: total − filhos com valor (null = não separado: o total fica no titular). */
export function valorDoTitular(f: Pick<FamiliaDaVenda, "valor_total" | "pessoas">): number | null {
  const filhos = ativas(f.pessoas).filter((p) => !p.comprador).reduce((s, p) => s + (Number(p.valor) > 0 ? Number(p.valor) : 0), 0);
  if (!(filhos > 0)) return null;
  return Math.max(Math.round((Number(f.valor_total ?? 0) - filhos) * 100) / 100, 0);
}

/** Situação do card da pessoa no Bitrix (o titular é o card do lead). */
export function situacaoBitrix(p: Pick<PessoaFamilia, "comprador" | "bitrix_status" | "bitrix_deal_id" | "removida_em">): { t: string; tom: Tom } {
  if (p.comprador) return { t: "Card do cliente (pai)", tom: "neutro" };
  switch (p.bitrix_status) {
    case "ok": return { t: p.bitrix_deal_id ? `Card ${p.bitrix_deal_id} criado` : "Card criado", tom: "rel" };
    case "erro": return { t: "Bitrix: erro", tom: "erro" };
    case "removida": return { t: "Saiu — avisar no Bitrix", tom: "aviso" };
    case "removida_avisada": return { t: `Saiu — card ${p.bitrix_deal_id ?? ""} ficou (avisado)`, tom: "aviso" };
    case "pendente": return { t: p.bitrix_deal_id ? "Bitrix: atualizando" : "Bitrix: card a criar", tom: "aviso" };
    default: return { t: p.removida_em ? "Saiu da venda" : "Bitrix: —", tom: "neutro" };
  }
}

/** Contrato da pessoa (0352: um contrato por pessoa; qs_venda_pessoas.contrato_status). */
export function situacaoContrato(p: Pick<PessoaFamilia, "contrato_status" | "menor" | "responsavel_nome">): string {
  const st: Record<string, string> = {
    pendente: "a enviar", gerando: "gerando", enviado: "enviado", visualizado: "visto", assinado: "assinado", recusado: "recusado", cancelado: "cancelado", erro: "erro",
  };
  const base = p.contrato_status ? st[p.contrato_status] ?? p.contrato_status : "ainda não enviado";
  return p.menor ? `${base} · assina: ${p.responsavel_nome ?? "o titular"}` : base;
}

/**
 * "contratos 2/4 assinados" no quadro (0352) — a mesma regra do servidor
 * (api/_contratoFamilia.js resumoDosContratos) e do banco (contrato_resumo_cartao):
 * conta quem já recebeu contrato (enviado/visto/assinado/recusado). Vazio = nenhum saiu.
 */
export function resumoContratosFamilia(f: Pick<FamiliaDaVenda, "pessoas"> | null | undefined): { total: number; assinados: number; texto: string } {
  const st = ativas(f?.pessoas).map((p) => p.contrato_status);
  const assinados = st.filter((s) => s === "assinado").length;
  const total = st.filter((s) => s === "enviado" || s === "visualizado" || s === "assinado" || s === "recusado").length;
  return { total, assinados, texto: total ? `contratos ${assinados}/${total} assinado${total === 1 ? "" : "s"}` : "" };
}

/** "Família · 4 pessoas" + quantos menores e quantas fichas incompletas. */
export function resumoFamilia(f: Pick<FamiliaDaVenda, "pessoas"> | null | undefined): { n: number; menores: number; incompletas: number; texto: string } {
  const ps = ativas(f?.pessoas);
  const menores = ps.filter((p) => p.menor).length;
  const incompletas = ps.filter((p) => faltasDaPessoa(p).length > 0).length;
  return { n: ps.length, menores, incompletas, texto: `Família · ${ps.length} pessoa${ps.length === 1 ? "" : "s"}` };
}

/** "Maria (filho(a), 12 anos)" — a linha curta da pasta no quadro. */
export function linhaCurta(p: PessoaFamilia): string {
  const extra = [rotuloVinculo(p).toLowerCase(), p.idade != null ? `${p.idade} ano${p.idade === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
  return `${(p.nome ?? "Sem nome").trim()}${extra ? ` (${extra})` : ""}`;
}
