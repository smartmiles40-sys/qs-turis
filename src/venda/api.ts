// src/venda/api.ts
// -----------------------------------------------------------------------------
// SUBIR VENDA (0214, Bruno 28/10/2026) — o banco por trás da tela única de
// venda (Closer, Relacionamento e Operacional usam a mesma, src/venda/SubirVenda.tsx).
//
//   • exp_vagas_para_venda()      — expedições à venda + vagas (pax_planejados − pagantes ativos);
//   • exp_passageiros_para_quarto — quem já está na expedição, pra "divide o quarto com";
//   • exp_vagas_ajustar           — o Ops abre vaga, com motivo registrado;
//   • venda_subir(p)              — grava tudo numa transação: pessoa (rel_clientes),
//     cabeçalho (qs_vendas), itens (qs_venda_itens) e passageiros da expedição.
//
// O Bitrix NÃO é chamado aqui: a venda do closer continua indo pro Bitrix pela
// pré-venda da 0207 (marcarPreVenda em src/closer/vendaItens.ts).
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { erroAmigavel } from "@/closer/lib";
import { novaChave, type TipoItem } from "@/propostas/lib";
import type { ItemVenda } from "@/closer/vendaItens";

export type OrigemVenda = "closer" | "rel" | "ops";

export interface ExpedicaoVaga {
  id: string;
  codigo: string;
  nome: string;
  destino: string | null;
  data_embarque: string | null;
  data_retorno: string | null;
  status: string;
  preco_venda_brl: number | null;
  pax_planejados: number;
  ocupados: number;
  vagas: number;
}

export interface PaxParaQuarto { id: string; nome: string; quarto_desejado: string | null; tem_par: boolean; venda_id: string | null }

/** A pessoa que comprou (ou que viaja junto). */
export interface PessoaVenda {
  id?: string | null;
  nome: string;
  telefone: string;
  email: string;
  cpf: string;
  nascimento: string;
  passaporte: string;
}
export const pessoaVazia = (): PessoaVenda => ({ id: null, nome: "", telefone: "", email: "", cpf: "", nascimento: "", passaporte: "" });

/** Quem viaja numa expedição (o comprador e quem vai junto). */
export interface Viajante {
  chave: string;
  comprador: boolean;
  nome: string;
  telefone: string;
  cpf: string;
  valor_contratado: string;
  valor_pago: string;
  aereo_incluso: boolean;
  quarto_desejado: string;
  /** "" = não divide · "v:<chave>" = outro viajante desta venda · "p:<id>" = quem já comprou · "t" = só o nome */
  divide: string;
  divide_nome: string;
}
export const viajanteNovo = (comprador = false, nome = ""): Viajante => ({
  chave: novaChave(), comprador, nome, telefone: "", cpf: "", valor_contratado: "", valor_pago: "",
  aereo_incluso: true, quarto_desejado: "", divide: "", divide_nome: "",
});

export interface PagamentoVenda {
  forma: string;
  condicao: "avista" | "parcelado" | "entrada";
  entrada: string;
  entrada_data: string;
  parcelas: string;
  primeira_parcela: string;
  obs: string;
}
export const pagamentoVendaVazio = (): PagamentoVenda =>
  ({ forma: "", condicao: "avista", entrada: "", entrada_data: "", parcelas: "", primeira_parcela: "", obs: "" });

/** "1.234,56" / "1234.56" / "1234" → número (ou null se vazio/inválido). */
export function lerValor(t: string | number | null | undefined): number | null {
  const s = String(t ?? "").trim().replace(/^R\$\s*/, "");
  if (!s) return null;
  const n = /^\d+\.\d{1,2}$/.test(s) ? Number(s) : Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export const mostrarValor = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));

// ── Leitura ────────────────────────────────────────────────────────────────
export async function listarExpedicoesParaVenda(): Promise<ExpedicaoVaga[]> {
  const { data, error } = await supabase.rpc("exp_vagas_para_venda");
  if (error) throw new Error(/exp_vagas_para_venda/.test(error.message) ? "A lista de vagas ainda não está ligada no banco (falta aplicar a 0214)." : error.message);
  return ((data ?? []) as ExpedicaoVaga[]).map((e) => ({ ...e, pax_planejados: Number(e.pax_planejados) || 0, ocupados: Number(e.ocupados) || 0, vagas: Number(e.vagas) || 0 }));
}

export async function passageirosParaQuarto(expedicaoId: string): Promise<PaxParaQuarto[]> {
  const { data, error } = await supabase.rpc("exp_passageiros_para_quarto", { p_exp: expedicaoId });
  if (error) return [];
  return (data ?? []) as PaxParaQuarto[];
}

// ── Ops: abrir vaga ────────────────────────────────────────────────────────
export async function ajustarVagas(expedicaoId: string, novo: number, motivo: string): Promise<{ vagas: number }> {
  const { data, error } = await supabase.rpc("exp_vagas_ajustar", { p_exp: expedicaoId, p_novo: novo, p_motivo: motivo });
  if (error) throw new Error(erroDaVenda(error));
  return data as { vagas: number };
}

// ── Gravar ─────────────────────────────────────────────────────────────────
export interface PayloadVenda {
  origem: OrigemVenda;
  negocio_id?: string | null;
  viagem_id?: string | null;
  cliente: PessoaVenda;
  itens: ItemVenda[];
  /** Viajantes por item de expedição (chave = ItemVenda.k). */
  viajantes: Record<string, Viajante[]>;
  pagamento: PagamentoVenda;
  condicao_especial: boolean;
  condicao_obs: string;
  observacoes: string;
}

export interface ResultadoVenda { venda_id: string; cliente_id: string; itens: number; passageiros: number; total: number }

/** Monta o jsonb que a venda_subir espera (ver o cabeçalho da 0214). */
export function montarPayload(p: PayloadVenda, nomeDoItem: (i: ItemVenda) => string) {
  const limpa = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => String(v ?? "").trim() !== ""));
  const itens = p.itens.map((i) => ({
    id: i.id ?? null, tipo: i.tipo, nome: i.nome.trim() || nomeDoItem(i),
    data_inicio: i.data_inicio || null, data_fim: i.data_fim || null,
    dados: limpa(i.dados), passageiros: i.passageiros.filter((x) => x.nome.trim()),
    valor: i.valor, custo: i.custo, fornecedor: i.fornecedor,
  }));
  const viajantes = p.itens.flatMap((i, n) => i.tipo !== "expedicao" ? [] : (p.viajantes[i.k] ?? []).map((v) => ({
    chave: v.chave, item: n + 1, comprador: v.comprador,
    nome: v.comprador ? p.cliente.nome : v.nome, telefone: v.telefone || null, cpf: v.cpf || null,
    valor_contratado: lerValor(v.valor_contratado), valor_pago: lerValor(v.valor_pago) ?? 0,
    aereo_incluso: v.aereo_incluso, quarto_desejado: v.quarto_desejado || null,
    divide_com_chave: v.divide.startsWith("v:") ? v.divide.slice(2) : null,
    divide_com_passageiro_id: v.divide.startsWith("p:") ? v.divide.slice(2) : null,
    divide_com_nome: v.divide === "t" ? v.divide_nome : null,
  })));
  const pg = p.pagamento;
  return {
    origem: p.origem, negocio_id: p.negocio_id ?? null, viagem_id: p.viagem_id ?? null,
    cliente: { ...p.cliente, id: p.cliente.id || null },
    itens, viajantes,
    pagamento: {
      forma: pg.forma, condicao: pg.condicao,
      entrada: pg.condicao === "entrada" ? lerValor(pg.entrada) : null,
      entrada_data: pg.condicao === "entrada" ? pg.entrada_data || null : null,
      parcelas: pg.condicao === "avista" ? 1 : Number(pg.parcelas) || null,
      primeira_parcela: pg.condicao === "avista" ? null : pg.primeira_parcela || null,
      obs: pg.obs.trim() || null,
    },
    condicao_especial: p.condicao_especial,
    condicao_obs: p.condicao_especial ? p.condicao_obs.trim() : null,
    observacoes: p.observacoes.trim() || null,
  };
}

export async function subirVenda(payload: ReturnType<typeof montarPayload>): Promise<ResultadoVenda> {
  const { data, error } = await supabase.rpc("venda_subir", { p: payload });
  if (error) throw new Error(erroDaVenda(error));
  return data as ResultadoVenda;
}

export function erroDaVenda(e: unknown): string {
  const m = String((e as { message?: string })?.message ?? e ?? "");
  const sv = m.match(/sem-vaga:([^:]+):(\d+)/);
  if (sv) return `A expedição ${sv[1]} não tem vaga pra todos (${sv[2]} livre${sv[2] === "1" ? "" : "s"}). Peça pro Operacional abrir vaga.`;
  const ab = m.match(/abaixo-dos-ocupados:(\d+)/);
  if (ab) return `Não dá pra deixar menos que os ${ab[1]} lugares já vendidos.`;
  const mapa: Record<string, string> = {
    "venda_subir": "A tela de venda ainda não está ligada no banco (falta aplicar a 0214).",
    "exp_vagas_ajustar": "Abrir vaga ainda não está ligado no banco (falta aplicar a 0214).",
    "pessoa-sem-nome": "Escreva o nome de quem comprou (e de quem viaja junto).",
    "expedicao-obrigatoria": "Escolha qual expedição foi vendida.",
    "expedicao-nao-encontrada": "Essa expedição não existe mais. Atualize a tela.",
    "par-de-quarto-invalido": "A pessoa escolhida pra dividir o quarto não está mais nessa expedição.",
    "negocio-obrigatorio": "A venda do closer precisa sair do cartão do cliente.",
    "origem-invalida": "Origem da venda inválida.",
    "viajante-sem-chave": "A lista de quem viaja veio quebrada. Feche e abra de novo.",
    "vagas-invalidas": "Número de vagas inválido.",
    "motivo-obrigatorio": "Escreva o motivo (fica registrado).",
  };
  for (const [k, v] of Object.entries(mapa)) if (m.includes(k)) return v;
  return erroAmigavel(e);
}

// ── Voucher (frente ia-voucher: api/venda-voucher.js) ──────────────────────
export interface LeituraVoucher {
  itens: { tipo: TipoItem; nome: string; data_inicio?: string | null; data_fim?: string | null; dados?: Record<string, unknown>; passageiros?: { nome: string }[]; valor?: number | null; custo?: number | null; fornecedor?: string | null }[];
  pessoas: { nome: string; cpf?: string; passaporte?: string; nascimento?: string }[];
  avisos: string[];
}

function emBase64(f: File): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => falha(new Error("Não consegui ler o arquivo."));
    r.readAsDataURL(f);
  });
}

/**
 * Manda o voucher pra IA ler (api/venda-voucher.js, frente ia-voucher). Se a
 * rota não existir/responder, a tela avisa e segue no manual.
 * Contrato do corpo combinado no merge: { arquivo_base64, nome, mime }.
 */
export async function lerVoucher(arquivo: File): Promise<LeituraVoucher> {
  // Envio direto até ~3 MB: a Vercel recusa corpo acima de 4,5 MB depois do base64
  // (limite medido na frente ia-voucher; arquivo maior teria de ir pelo Storage).
  if (arquivo.size > 3 * 1024 * 1024) throw new Error("Arquivo grande demais pra leitura direta (até 3 MB). Mande uma foto ou um PDF menor.");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/venda-voucher", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    // Formato da rota api/venda-voucher.js: lista `arquivos` com { nome, mime, base64 }.
    body: JSON.stringify({ arquivos: [{ base64: await emBase64(arquivo), nome: arquivo.name, mime: arquivo.type || "application/octet-stream" }] }),
  });
  const j = await r.json().catch(() => null) as (Partial<LeituraVoucher> & { error?: string }) | null;
  if (!r.ok || !j) throw new Error(j?.error || (r.status === 404 ? "A leitura de voucher ainda não está no ar." : `A leitura falhou (HTTP ${r.status}).`));
  return { itens: Array.isArray(j.itens) ? j.itens : [], pessoas: Array.isArray(j.pessoas) ? j.pessoas : [], avisos: Array.isArray(j.avisos) ? j.avisos : [] };
}

/** Item do voucher → item da tela (dados viram texto, como o catálogo espera). */
export function itemDoVoucher(i: LeituraVoucher["itens"][number]): ItemVenda {
  const dados: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.dados ?? {})) if (v != null && typeof v !== "object") dados[k] = String(v);
  return {
    k: novaChave(), tipo: i.tipo, nome: i.nome ?? "", data_inicio: i.data_inicio ?? "", data_fim: i.data_fim ?? "",
    dados, passageiros: (i.passageiros ?? []).filter((p) => p?.nome).map((p) => ({ nome: p.nome })),
    valor: i.valor ?? null, custo: i.custo ?? null, fornecedor: i.fornecedor ?? "", status: "vendido",
  };
}
