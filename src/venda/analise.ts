// src/venda/analise.ts
// -----------------------------------------------------------------------------
// ANÁLISE PÓS-VENDA (0230, Bruno 30/10/2026) — o lado da tela.
//
//   • analisarRascunho  — na etapa "Análise pós-venda" do Subir venda, ANTES de
//     gravar: proposta aprovada × o que já está emitido × o que está sendo vendido.
//   • analisarVendaGravada — depois do venda_subir: o servidor guarda a análise
//     (qs_venda_analises), põe o STATUS na venda e, se falta emitir, abre a
//     solicitação "Emissões pendentes" pro Relacionamento.
//   • Painel "Vendas com pendência": qs_vendas_analise_v + histórico + corrigir
//     (marcar item emitido) + reanalisar.
//
// Sem a 0230 no banco: a análise da tela funciona igual (não grava nada) e, ao
// concluir com pendência, a tela abre a solicitação pelo caminho que já existe
// (qs_sol_criar, tipo "Outro" do Rel) — o painel avisa que falta a migration.
// Quem calcula é o servidor: api/venda-analise.js + api/_vendaConferencia.js.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { TipoItem } from "@/propostas/lib";

export type StatusAnalise = "em_analise" | "tudo_emitido" | "faltam_emissoes" | "divergencia" | "risco_alto";
export type Situacao = "ok" | "falta" | "divergente" | "extra";
export type NivelRisco = "baixo" | "medio" | "alto";

export const STATUS_ANALISE: Record<StatusAnalise, { rotulo: string; tom: "neutro" | "rel" | "aviso" | "erro" }> = {
  em_analise: { rotulo: "Em análise", tom: "neutro" },
  tudo_emitido: { rotulo: "Tudo emitido ✓", tom: "rel" },
  faltam_emissoes: { rotulo: "Faltam emissões", tom: "aviso" },
  divergencia: { rotulo: "Divergência", tom: "erro" },
  risco_alto: { rotulo: "Risco alto", tom: "erro" },
};
export const SITUACAO: Record<Situacao, { rotulo: string; cor: string; icone: string }> = {
  ok: { rotulo: "OK", cor: "var(--rel-ink)", icone: "✓" },
  falta: { rotulo: "Falta emitir", cor: "#B45309", icone: "•" },
  divergente: { rotulo: "Divergente", cor: "#B91C1C", icone: "≠" },
  extra: { rotulo: "Fora do apresentado", cor: "#B91C1C", icone: "+" },
};
export const NIVEL: Record<NivelRisco, { rotulo: string; cor: string }> = {
  alto: { rotulo: "Alto", cor: "#B91C1C" },
  medio: { rotulo: "Médio", cor: "#B45309" },
  baixo: { rotulo: "Baixo", cor: "var(--ink3)" },
};

export interface LinhaExtrato {
  chave: string;
  tipo: TipoItem | string;
  nome: string;
  situacao: Situacao;
  apresentado: { nome: string; data_inicio?: string; data_fim?: string; quantidade?: number | null; voo_interno?: boolean } | null;
  emitido: { nome: string; fonte: string; localizador: string; data_inicio: string; data_fim: string; doc_tipo: string } | null;
  motivos: string[];
  nota?: string;
  voo_interno?: boolean;
}
export interface Risco { nivel: NivelRisco; categoria: string; motivo: string; fonte: "regra" | "ia" }
export interface Analise {
  status: StatusAnalise;
  base: "proposta" | "venda";
  contagens: { ok: number; falta: number; divergente: number; extra: number; total: number };
  linhas: LinhaExtrato[];
  riscos: Risco[];
  risco_nivel: NivelRisco;
  faltam: string[];
  divergencias: string[];
  resumo: string;
  inicio: string;
  fim: string;
  texto_extrato: string;
  proposta_id: string | null;
  proposta: { numero?: number; opcao?: string; total?: number } | null;
  ia: { usada: boolean; modelo: string | null; aviso: string; texto: string; riscos: unknown[] };
  // Só na venda gravada:
  venda_id?: string;
  gravado?: boolean;
  aviso?: string;
  falta0230?: boolean;
  solicitacao?: { id: string; numero: number; nova: boolean } | null;
}

export interface RascunhoAnalise {
  origem: "closer" | "rel" | "ops";
  negocio_id?: string | null;
  cliente_id?: string | null;
  viagem_id?: string | null;
  cliente: { nome: string };
  itens: { tipo: string; nome: string; data_inicio?: string | null; data_fim?: string | null; dados?: Record<string, unknown>; passageiros?: { nome: string }[]; valor?: number | null; custo?: number | null; status?: string }[];
  viajantes: { nome: string; valor_contratado: number | null; valor_pago: number | null }[];
  pagamento: Record<string, unknown> | null;
  total: number;
}

async function postar(corpo: unknown): Promise<Analise> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/venda-analise", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = (await r.json().catch(() => null)) as (Analise & { error?: string }) | null;
  if (!r.ok || !j) throw new Error(j?.error || (r.status === 404 ? "A análise pós-venda ainda não está no ar." : `A análise falhou (HTTP ${r.status}).`));
  return j;
}

export const analisarRascunho = (r: RascunhoAnalise) => postar({ rascunho: r });

/** Depois de gravar: guarda a análise e abre a solicitação pro Rel. Reaproveita a leitura da IA do rascunho. */
export function analisarVendaGravada(vendaId: string, motivo: "subir_venda" | "reanalise" | "correcao", previa?: Analise | null) {
  const ia_previa = previa?.ia ? { usada: previa.ia.usada, modelo: previa.ia.modelo, aviso: previa.ia.aviso, texto: previa.ia.texto, riscos: previa.ia.riscos ?? [] } : undefined;
  return postar({ venda_id: vendaId, motivo, ia_previa });
}

/**
 * Sem a 0230: abre a solicitação pelo caminho que já existe (qs_sol_criar, tipo
 * "Outro" do Rel). A Central não aceita pedido do Rel pra ele mesmo — aí não abre.
 */
export async function abrirPedidoSem0230(origem: RascunhoAnalise["origem"], a: Analise, alvo: { cliente_id?: string | null; viagem_id?: string | null; nome: string }): Promise<number | null> {
  if (origem === "rel") return null;
  const de = origem === "closer" ? "comercial" : "operacional";
  const dias = a.inicio ? Math.round((Date.parse(`${a.inicio}T12:00:00Z`) - Date.now()) / 86_400_000) : 999;
  const { data, error } = await supabase.rpc("qs_sol_criar", {
    p_de: de, p_para: "relacionamento", p_tipo: "rel_outro",
    p_titulo: `Emissões pendentes — ${alvo.nome || "venda"}${a.contagens.falta ? ` (${a.contagens.falta} por emitir)` : " (divergência)"}`,
    p_descricao: `Aberta pela análise pós-venda.\n\n${a.texto_extrato}`,
    p_prioridade: dias <= 15 ? "urgente" : dias <= 45 ? "alta" : "normal",
    p_prazo: null, p_cliente: alvo.cliente_id ?? null, p_viagem: alvo.viagem_id ?? null, p_lead: null, p_conversa: null, p_sobre: null, p_formulario: null,
  });
  if (error) throw new Error(error.message);
  const { data: s } = await supabase.from("qs_solicitacoes").select("numero").eq("id", data as string).maybeSingle();
  return (s?.numero as number) ?? null;
}

// ── Painel ─────────────────────────────────────────────────────────────────
export interface VendaAnaliseLinha {
  id: string;
  origem: "closer" | "rel" | "ops";
  cliente_id: string | null;
  viagem_id: string | null;
  cliente_nome: string | null;
  valor_total: number | null;
  criado_em: string;
  criado_por_nome: string | null;
  analise_status: StatusAnalise;
  analise_em: string | null;
  analise_resumo: { contagens?: Analise["contagens"]; risco_nivel?: NivelRisco; faltam?: string[]; divergencias?: string[]; riscos_altos?: string[]; resumo?: string; inicio?: string; ia_usada?: boolean } | null;
  solicitacao_numero: number | null;
  solicitacao_status: string | null;
  itens: number;
}

const falta0230 = (m: string) => /qs_vendas_analise_v|qs_venda_analises|venda_item_marcar_emitido|schema cache|does not exist|PGRST20[25]/i.test(m);
export const AVISO_0230 = "O painel de pendências ainda não está ligado no banco (falta aplicar a 0230).";

export async function listarVendasAnalise(): Promise<VendaAnaliseLinha[]> {
  const { data, error } = await supabase.from("qs_vendas_analise_v").select("*").order("criado_em", { ascending: false }).limit(300);
  if (error) throw new Error(falta0230(error.message) ? AVISO_0230 : error.message);
  return (data ?? []) as VendaAnaliseLinha[];
}

export interface AnaliseGuardada {
  id: string; status: StatusAnalise; base: string | null; contagens: Analise["contagens"]; linhas: LinhaExtrato[]; riscos: Risco[];
  risco_nivel: NivelRisco | null; resumo: string | null; texto_ia: string | null; ia_usada: boolean; ia_aviso: string | null; motivo: string; em: string;
  por_nome?: string | null;
}
export async function historicoDaVenda(vendaId: string): Promise<AnaliseGuardada[]> {
  const { data, error } = await supabase.from("qs_venda_analises")
    .select("id,status,base,contagens,linhas,riscos,risco_nivel,resumo,texto_ia,ia_usada,ia_aviso,motivo,em,por").eq("venda_id", vendaId).order("em", { ascending: false }).limit(30);
  if (error) throw new Error(falta0230(error.message) ? AVISO_0230 : error.message);
  return (data ?? []) as AnaliseGuardada[];
}

export interface ItemDaVenda { id: string; tipo: TipoItem; nome: string; data_inicio: string | null; data_fim: string | null; status: string; dados: Record<string, unknown> }
export async function itensDaVendaGravada(vendaId: string): Promise<ItemDaVenda[]> {
  const { data, error } = await supabase.from("qs_venda_itens").select("id,tipo,nome,data_inicio,data_fim,status,dados").eq("venda_id", vendaId).order("ordem");
  if (error) throw new Error(error.message);
  return (data ?? []) as ItemDaVenda[];
}

export async function marcarItemEmitido(itemId: string, localizador: string, obs: string): Promise<void> {
  const { error } = await supabase.rpc("venda_item_marcar_emitido", { p_item: itemId, p_localizador: localizador, p_obs: obs || null });
  if (!error) return;
  const m = error.message;
  if (falta0230(m)) throw new Error(AVISO_0230);
  if (m.includes("localizador-obrigatorio")) throw new Error("Coloque o localizador (ou nº do bilhete/apólice/voucher).");
  if (m.includes("sem-permissao")) throw new Error("Só Relacionamento, Operacional ou gestão marcam emissão.");
  if (m.includes("item-nao-encontrado")) throw new Error("Esse item não existe mais (ou foi cancelado).");
  throw new Error(m);
}

/** "Pendente" = tudo que não está "Tudo emitido ✓". */
export const ehPendente = (s: StatusAnalise) => s !== "tudo_emitido";
