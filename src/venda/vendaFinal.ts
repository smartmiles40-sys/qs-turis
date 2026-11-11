// src/venda/vendaFinal.ts
// -----------------------------------------------------------------------------
// SUBIR VENDA — SPRINT FINAL (11/11/2026, docs/SUBIR-VENDA-FINAL.md): as regras
// PURAS da tela nova (sem banco, sem React), testadas em tests/venda/vendaFinal.test.ts.
//
//   • Pagamento em LINHAS: forma, valor, data, nº de parcelas; soma = total;
//   • Estado da venda: negociação → reservada → consolidada (ou cancelada);
//   • Vagas: quem já é desta venda não conta contra ela mesma;
//   • Faltas pra consolidar (a mesma ideia da venda_consolidar do banco) e em
//     qual passo da tela cada falta se resolve;
//   • Rascunho da tela inteira (localStorage + qs_vendas.rascunho);
//   • "Quem vai" no cartão (venda_familia_salvar) e o pré-preenchimento pelo
//     contrato (venda_do_contrato).
// Nada aqui importa o supabase (os testes rodam no node puro).
// -----------------------------------------------------------------------------
import {
  VINCULOS_VIAJANTE, lerValor, mostrarValor, normNome, viajanteVazio,
  type PagamentoVenda, type PessoaVenda, type Viajante, type VinculoViajante,
} from "./vendaRegras.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;
const txt = (v: unknown): string => (v == null ? "" : String(v));

// ── Pagamento em linhas ─────────────────────────────────────────────────────
export type FormaLinha = "pix" | "cartao" | "boleto" | "transferencia" | "dinheiro" | "link" | "outro";
export const FORMAS_LINHA: Record<FormaLinha, string> = {
  pix: "Pix", cartao: "Cartão", boleto: "Boleto", transferencia: "Transferência", dinheiro: "Dinheiro", link: "Link de pagamento", outro: "Outro",
};
const FORMAS_OK = new Set(Object.keys(FORMAS_LINHA));

export interface LinhaPagamento {
  /** Chave só da tela. */
  chave: string;
  forma: FormaLinha | "";
  /** Texto como digitado ("2.500,00"). */
  valor: string;
  /** yyyy-mm-dd */
  data: string;
  parcelas: string;
  obs: string;
}

let seqLinha = 0;
export const linhaVazia = (chave = `pg${Date.now().toString(36)}${(seqLinha++).toString(36)}`): LinhaPagamento =>
  ({ chave, forma: "", valor: "", data: "", parcelas: "1", obs: "" });

/** Linha que a pessoa nem começou a preencher (não conta e não vai pro banco). */
export const linhaEmBranco = (l: LinhaPagamento) => !l.forma && !l.valor.trim() && !l.data && !l.obs.trim();

export const somaLinhas = (ls: LinhaPagamento[]) => r2(ls.reduce((s, l) => s + (lerValor(l.valor) ?? 0), 0));

export interface ConferenciaPagamento { soma: number; total: number; diferenca: number; bate: boolean }
/** Soma das linhas × total da venda (diferença positiva = falta lançar; negativa = passou). */
export function conferirPagamento(ls: LinhaPagamento[], total: number): ConferenciaPagamento {
  const soma = somaLinhas(ls);
  const t = r2(Number(total) || 0);
  const diferenca = r2(t - soma);
  return { soma, total: t, diferenca, bate: Math.abs(diferenca) < 0.01 && t > 0 };
}

/** Problema de uma linha (null = ok). `n` começa em 1. Linha em branco não tem problema (é ignorada). */
export function problemaDaLinha(l: LinhaPagamento, n: number): string | null {
  if (linhaEmBranco(l)) return null;
  if (!l.forma) return `Pagamento ${n}: escolha a forma (Pix, cartão, boleto…).`;
  const v = lerValor(l.valor);
  if (v == null || v <= 0) return `Pagamento ${n}: coloque o valor (só números, ex.: 2.500,00).`;
  const p = Number(l.parcelas || "1");
  if (!Number.isInteger(p) || p < 1 || p > 48) return `Pagamento ${n}: nº de parcelas de 1 a 48.`;
  return null;
}

/** Linhas → `pagamentos` da venda_subir (só as preenchidas, na ordem). */
export function linhasParaPayload(ls: LinhaPagamento[]) {
  return ls.filter((l) => !linhaEmBranco(l)).map((l, i) => ({
    ordem: i + 1, forma: l.forma || "outro", valor: lerValor(l.valor) ?? 0, data: l.data || null,
    parcelas: Math.max(1, Number(l.parcelas || "1") || 1), obs: l.obs.trim() || null,
  }));
}

/** Linhas gravadas (qs_venda_pagamentos) → tela. */
export function linhasDoBanco(rows: unknown[]): LinhaPagamento[] {
  return (rows ?? [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0))
    .map((r) => ({
      ...linhaVazia(),
      forma: (FORMAS_OK.has(txt(r.forma)) ? txt(r.forma) : "outro") as FormaLinha,
      valor: mostrarValor(r.valor == null ? null : Number(r.valor)),
      data: txt(r.data).slice(0, 10),
      parcelas: String(Math.max(1, Number(r.parcelas) || 1)),
      obs: txt(r.obs),
    }));
}

/** Venda antiga (só o `pagamento` jsonb da 0214) → linhas. Entrada vira 1 linha; o resto, outra. */
export function linhasDoLegado(p: PagamentoVenda, total: number): LinhaPagamento[] {
  if (!p.forma && !p.entrada) return [linhaVazia()];
  const forma = (FORMAS_OK.has(p.forma) ? p.forma : p.forma ? "outro" : "") as FormaLinha | "";
  const t = r2(Number(total) || 0);
  if (p.condicao === "entrada") {
    const ent = lerValor(p.entrada) ?? 0;
    return [
      { ...linhaVazia(), forma, valor: mostrarValor(ent || null), data: p.entrada_data, parcelas: "1", obs: "Entrada" },
      { ...linhaVazia(), forma, valor: t > ent ? mostrarValor(r2(t - ent)) : "", data: p.primeira_parcela, parcelas: p.parcelas || "1", obs: "" },
    ];
  }
  return [{ ...linhaVazia(), forma, valor: t > 0 ? mostrarValor(t) : "", data: p.primeira_parcela,
    parcelas: p.condicao === "parcelado" ? p.parcelas || "1" : "1", obs: "" }];
}

/** O `pagamento` jsonb antigo, derivado das linhas (a venda_subir de hoje ainda lê ele). */
export function pagamentoLegadoDasLinhas(ls: LinhaPagamento[], obs = ""): PagamentoVenda {
  const v = ls.filter((l) => !linhaEmBranco(l));
  const forma = v[0]?.forma || "";
  if (v.length >= 2) {
    const resto = v.slice(1);
    return { forma, condicao: "entrada", entrada: v[0].valor, entrada_data: v[0].data,
      parcelas: String(resto.reduce((s, l) => s + Math.max(1, Number(l.parcelas) || 1), 0)), primeira_parcela: resto[0].data, obs };
  }
  const p = Math.max(1, Number(v[0]?.parcelas) || 1);
  return { forma, condicao: p > 1 ? "parcelado" : "avista", entrada: "", entrada_data: "",
    parcelas: p > 1 ? String(p) : "", primeira_parcela: v[0]?.data ?? "", obs };
}

// ── Estado da venda ─────────────────────────────────────────────────────────
export type EstadoVenda = "negociacao" | "reservada" | "consolidada" | "cancelada";
export const ESTADOS_VENDA: Record<EstadoVenda, { rotulo: string; tom: "neutro" | "aviso" | "rel" | "erro" }> = {
  negociacao: { rotulo: "Em negociação", tom: "neutro" },
  reservada: { rotulo: "Vaga reservada", tom: "aviso" },
  consolidada: { rotulo: "Venda consolidada", tom: "rel" },
  cancelada: { rotulo: "Cancelada", tom: "erro" },
};

/** Estado gravado (qs_vendas.estado) ou, em banco antigo, deduzido do cartão. */
export function estadoDaVenda(gravado: unknown, cartao?: { consolidada?: boolean; preVenda?: boolean }): EstadoVenda {
  const g = txt(gravado);
  if (g === "negociacao" || g === "reservada" || g === "consolidada" || g === "cancelada") return g;
  if (cartao?.consolidada) return "consolidada";
  if (cartao?.preVenda) return "reservada";
  return "negociacao";
}

// ── Vagas ───────────────────────────────────────────────────────────────────
/** Quantos desta venda JÁ ocupam vaga na expedição (têm linha em `passageiros`). */
export const jaOcupamVaga = (vs: Pick<Viajante, "passageiro_id">[]) => vs.filter((v) => !!v.passageiro_id).length;

/** Vagas livres PRA ESTA VENDA = vagas da expedição + quem já é desta venda (reabrir não trava). */
export function vagasParaEstaVenda(vagasDaExpedicao: number, vs: Pick<Viajante, "passageiro_id">[]): number {
  return Math.max(0, Number(vagasDaExpedicao) || 0) + jaOcupamVaga(vs);
}

// ── Faltas pra consolidar ───────────────────────────────────────────────────
export const PASSO = { quem: 0, oque: 1, detalhes: 2, pagamento: 3, analise: 4 } as const;

/** Em qual passo da tela a falta (texto em PT-BR, nosso ou da venda_consolidar) se resolve. */
export function passoDaFalta(f: string): number {
  const t = normNome(f);
  if (/pagamento|soma|parcela|forma de pag|financeiro|total|valor da venda/.test(t)) return PASSO.pagamento;
  if (/o que (o cliente )?(comprou|vendeu)|nenhum item|tipo de venda/.test(t)) return PASSO.oque;
  if (/expedic|item|voo|aereo|hotel|hosped|data|quarto|seguro|pacote/.test(t)) return PASSO.detalhes;
  return PASSO.quem; // pessoa, vínculo, CPF, nascimento, nome…
}

/** O passo mais cedo entre as faltas (é pra lá que a tela leva). */
export const primeiroPassoDasFaltas = (fs: string[]) => (fs.length ? Math.min(...fs.map(passoDaFalta)) : PASSO.analise);

export interface EntradaFaltas {
  comprador: Pick<PessoaVenda, "nome">;
  /** Todos que vão junto (sem o comprador). */
  acompanhantes: Pick<Viajante, "nome" | "vinculo">[];
  itens: { tipo: string; rotulo: string; expedicaoEscolhida?: boolean }[];
  total: number;
  linhas: LinhaPagamento[];
}

/** O que falta pra consolidar (a venda_consolidar confere de novo no banco). Vazio = pode. */
export function faltasParaConsolidar(e: EntradaFaltas): string[] {
  const f: string[] = [];
  if (e.comprador.nome.trim().length < 3) f.push("Quem comprou: falta o nome completo.");
  e.acompanhantes.forEach((a, i) => {
    const nome = a.nome.trim() || `Acompanhante ${i + 1}`;
    if (a.nome.trim().length < 3) f.push(`${nome}: falta o nome completo.`);
    if (!a.vinculo) f.push(`${nome}: falta o vínculo (cônjuge, filho, amigo…).`);
  });
  if (!e.itens.length) f.push("O que vendeu: nenhum item marcado.");
  for (const i of e.itens) if (i.tipo === "expedicao" && i.expedicaoEscolhida === false) f.push(`${i.rotulo}: escolha qual expedição foi vendida.`);
  const c = conferirPagamento(e.linhas, e.total);
  if (c.total <= 0) f.push("Pagamento: o total da venda está zerado.");
  e.linhas.forEach((l, i) => { const p = problemaDaLinha(l, i + 1); if (p) f.push(p); });
  if (!e.linhas.some((l) => !linhaEmBranco(l))) f.push("Pagamento: lance pelo menos uma linha (forma, valor e data).");
  else if (c.total > 0 && !c.bate) f.push(`Pagamento: soma ${brl(c.soma)} ≠ total ${brl(c.total)}.`);
  return f;
}

export const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ── Juntar a família com a lista da expedição ───────────────────────────────
// `responsavel` fica de fora: aponta pra uma chave da lista de origem, que pode não existir na outra.
const CAMPOS_PESSOAIS = ["nome", "telefone", "cpf", "email", "nascimento", "vinculo", "cliente_id"] as const;

function acharMesma(v: Viajante, lista: Viajante[]): number {
  let i = lista.findIndex((x) => !x.comprador && x.chave === v.chave);
  if (i < 0 && v.cliente_id) i = lista.findIndex((x) => !x.comprador && x.cliente_id === v.cliente_id);
  if (i < 0 && v.cpf.replace(/\D/g, "").length === 11) i = lista.findIndex((x) => !x.comprador && x.cpf.replace(/\D/g, "") === v.cpf.replace(/\D/g, ""));
  if (i < 0 && normNome(v.nome)) i = lista.findIndex((x) => !x.comprador && normNome(x.nome) === normNome(v.nome));
  return i;
}

/**
 * Leva os dados pessoais de `de` pra `para` (mesma pessoa = mesma chave, ficha,
 * CPF ou nome). Quem está só em `de` entra em `para` se `adicionar`. Nunca tira
 * ninguém de `para` e nunca apaga um campo preenchido com vazio.
 */
export function juntarPessoas(de: Viajante[], para: Viajante[], adicionar: boolean): Viajante[] {
  const out = para.map((v) => ({ ...v }));
  for (const v of de.filter((x) => !x.comprador)) {
    const i = acharMesma(v, out);
    if (i >= 0) {
      const alvo = out[i];
      for (const k of CAMPOS_PESSOAIS) {
        const novo = v[k];
        if (novo != null && String(novo).trim() !== "") (alvo as unknown as Record<string, unknown>)[k] = novo;
      }
    } else if (adicionar && v.nome.trim()) {
      out.push({ ...viajanteVazio(false, v.nome, v.chave), ...Object.fromEntries(CAMPOS_PESSOAIS.map((k) => [k, v[k] ?? ""])), cliente_id: v.cliente_id ?? null } as Viajante);
    }
  }
  return out;
}

/** Tira de `lista` (nunca o comprador) quem bate com algum de `removidos` — quem sai do passo 1 sai da expedição e vice-versa. */
export function tirarPessoas(lista: Viajante[], removidos: Viajante[]): Viajante[] {
  if (!removidos.length) return lista;
  const restante = [...lista];
  const tiradas = new Set<string>();
  for (const r of removidos.filter((x) => !x.comprador)) {
    const i = acharMesma(r, restante);
    if (i >= 0) { tiradas.add(restante[i].chave); restante.splice(i, 1); }
  }
  if (!tiradas.size) return lista;
  return restante.map((x) => ({
    ...x, responsavel: x.responsavel && tiradas.has(x.responsavel) ? "" : x.responsavel,
    divide: x.divide.startsWith("v:") && tiradas.has(x.divide.slice(2)) ? "" : x.divide,
  }));
}

/** Quem estava em `antes` e não está em `depois` (mesma chave). */
export const quemSaiu = (antes: Viajante[], depois: Viajante[]) => {
  const ficam = new Set(depois.map((v) => v.chave));
  return antes.filter((v) => !v.comprador && !ficam.has(v.chave));
};

// ── "Quem vai" no cartão (venda_familia_salvar) ─────────────────────────────
export interface PessoaQuemVai {
  chave: string;
  pessoa_id?: string | null;
  cliente_id?: string | null;
  nome: string;
  vinculo: VinculoViajante;
  cpf: string;
  nascimento: string;
  email: string;
  telefone: string;
  valor?: number | null;
  removida?: boolean;
}

export function problemaQuemVai(ps: PessoaQuemVai[]): string | null {
  for (const [i, p] of ps.filter((x) => !x.removida).entries()) {
    const quem = p.nome.trim() || `Pessoa ${i + 1}`;
    if (p.nome.trim().length < 3) return `${quem}: escreva o nome completo.`;
    if (!p.vinculo) return `${quem}: escolha o vínculo (cônjuge, filho, amigo…).`;
    if (p.cpf.trim() && p.cpf.replace(/\D/g, "").length !== 11) return `${quem}: o CPF tem 11 números (ou deixe em branco).`;
    if (p.email.trim() && !/^\S+@\S+\.\S+$/.test(p.email.trim())) return `${quem}: e-mail que não entendi.`;
  }
  return null;
}

/** Corpo da venda_familia_salvar (só quem vai JUNTO: o titular a RPC sempre põe). */
export function familiaParaPayload(negocioId: string, ps: PessoaQuemVai[]) {
  const v = (s: string) => (s.trim() ? s.trim() : null);
  return {
    negocio_id: negocioId,
    pessoas: ps.filter((p) => p.removida ? !!(p.pessoa_id || p.cliente_id) : p.nome.trim()).map((p) => ({
      chave: p.chave, pessoa_id: p.pessoa_id ?? null, cliente_id: p.cliente_id ?? null,
      nome: p.nome.trim(), vinculo: p.vinculo || null,
      cpf: p.cpf.replace(/\D/g, "") || null, nascimento: v(p.nascimento), email: v(p.email), telefone: v(p.telefone),
      valor: p.valor ?? null, removida: !!p.removida,
    })),
  };
}

// ── Pré-preencher pelo contrato (venda_do_contrato) ─────────────────────────
export interface PessoaDoContrato { nome: string; cpf: string; nascimento: string; email: string; telefone: string; vinculo: VinculoViajante; comprador: boolean }
export interface VendaDoContrato { pessoas: PessoaDoContrato[]; tipo: "expedicao" | "aereo" | null; expedicao_id: string | null; valor: number | null }

const VINCULOS_OK = new Set(Object.keys(VINCULOS_VIAJANTE));

/** Lê o jsonb da venda_do_contrato sem confiar no formato (null = nada útil). */
export function lerVendaDoContrato(j: unknown): VendaDoContrato | null {
  if (!j || typeof j !== "object") return null;
  const o = (Array.isArray(j) ? j[0] : j) as Record<string, unknown> | undefined;
  if (!o || typeof o !== "object") return null;
  const pessoas = (Array.isArray(o.pessoas) ? o.pessoas : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && !!txt((p as Record<string, unknown>).nome).trim())
    .map((p, i) => ({
      nome: txt(p.nome).trim(), cpf: txt(p.cpf), nascimento: txt(p.nascimento).slice(0, 10), email: txt(p.email), telefone: txt(p.telefone),
      vinculo: (VINCULOS_OK.has(txt(p.vinculo)) ? txt(p.vinculo) : "") as VinculoViajante,
      comprador: p.comprador === true || p.titular === true || (i === 0 && !("comprador" in p) && !("titular" in p) && !txt(p.vinculo)),
    }));
  const tb = txt(o.tipo).toLowerCase();
  const tipo = tb.startsWith("exped") ? "expedicao" : tb.startsWith("aer") || tb.startsWith("aér") ? "aereo" : null;
  const valor = o.valor == null || o.valor === "" ? null : Number(o.valor);
  const r: VendaDoContrato = { pessoas, tipo, expedicao_id: txt(o.expedicao_id) || null, valor: Number.isFinite(valor) && (valor as number) > 0 ? valor : null };
  return r.pessoas.length || r.tipo ? r : null;
}

// ── Rascunho da tela inteira ────────────────────────────────────────────────
export const VERSAO_RASCUNHO = 1;
export interface RascunhoTela {
  v: number;
  /** ISO — quando a tela guardou. */
  salvo_em: string;
  passo: number;
  pessoa: PessoaVenda;
  itens: unknown[];
  valores: Record<string, string>;
  viajantes: Record<string, Viajante[]>;
  outros: Viajante[];
  linhas: LinhaPagamento[];
  especial: boolean;
  especialObs: string;
  obs: string;
  obsFin: string;
}

/** Chave do localStorage: um rascunho por cartão (closer) ou por cliente/viagem (Rel/Ops). */
export function chaveRascunho(p: { origem: string; negocioId?: string | null; clienteId?: string | null; viagemId?: string | null }): string {
  if (p.negocioId) return `qs:subir-venda:neg:${p.negocioId}`;
  return `qs:subir-venda:${p.origem}:${p.clienteId || "novo"}:${p.viagemId || "-"}`;
}

/** Texto (localStorage) ou jsonb (qs_vendas.rascunho) → rascunho válido, ou null. */
export function lerRascunho(bruto: unknown): RascunhoTela | null {
  let o: unknown = bruto;
  if (typeof bruto === "string") { try { o = JSON.parse(bruto); } catch { return null; } }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Partial<RascunhoTela>;
  if (r.v !== VERSAO_RASCUNHO || !r.salvo_em || !r.pessoa || !Array.isArray(r.itens) || !Array.isArray(r.linhas)) return null;
  return {
    v: VERSAO_RASCUNHO, salvo_em: String(r.salvo_em), passo: Math.min(Math.max(Number(r.passo) || 0, 0), PASSO.pagamento),
    pessoa: r.pessoa, itens: r.itens, valores: r.valores ?? {}, viajantes: r.viajantes ?? {}, outros: Array.isArray(r.outros) ? r.outros : [],
    linhas: r.linhas, especial: !!r.especial, especialObs: txt(r.especialObs), obs: txt(r.obs), obsFin: txt(r.obsFin),
  };
}

/**
 * Qual rascunho restaurar ao reabrir:
 *  • o do aparelho (localStorage) é trabalho NÃO gravado: vale se for mais novo que a venda gravada;
 *  • o do banco (qs_vendas.rascunho, gravado junto com a venda) vale se ninguém mexeu
 *    na venda depois (tolerância de 5 min pro relógio do aparelho).
 */
export function escolherRascunho(local: RascunhoTela | null, banco: RascunhoTela | null, vendaAtualizadaEm?: string | null): { r: RascunhoTela; de: "aparelho" | "banco" } | null {
  const t = (s?: string | null) => (s ? Date.parse(s) || 0 : 0);
  const gravada = t(vendaAtualizadaEm);
  if (local && t(local.salvo_em) > gravada) return { r: local, de: "aparelho" };
  if (banco && (!gravada || gravada - t(banco.salvo_em) <= 5 * 60 * 1000)) return { r: banco, de: "banco" };
  return null;
}
