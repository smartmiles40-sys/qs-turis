// src/rel/lib/vendas.ts
// -----------------------------------------------------------------------------
// PIPELINE DE VENDAS DO RELACIONAMENTO (0218, 28/10/2026).
//
// O cliente da casa fica 100% com o Relacionamento (Bruno: a recompra não volta
// pro Comercial). Os "hunters" vendem pra base num quadro:
//   Oportunidade → Contato feito → Proposta enviada → Negociação → Ganho / Perdido
//
// Tudo direto no banco (RLS: quem é do Rel lê, cria e mexe; apagar só a
// supervisão). O histórico do cartão o banco escreve sozinho (gatilho); a
// pessoa escreve só as notas.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { ORDEM_TIPOS_VENDA, TIPOS, propostaVazia, salvarProposta, type TipoItem } from "@/propostas/lib";
import { lotes } from "@/lib/lotes";

export type Etapa = "oportunidade" | "contato" | "proposta" | "negociacao" | "ganho" | "perdido";

export const ETAPAS: { id: Etapa; rotulo: string; dica: string }[] = [
  { id: "oportunidade", rotulo: "Oportunidade", dica: "ainda ninguém falou com o cliente" },
  { id: "contato", rotulo: "Contato feito", dica: "conversou, entendeu o que ele quer" },
  { id: "proposta", rotulo: "Proposta enviada", dica: "mandou a proposta" },
  { id: "negociacao", rotulo: "Negociação", dica: "ajustando valor, datas, forma de pagamento" },
  { id: "ganho", rotulo: "Ganho", dica: "vendeu" },
  { id: "perdido", rotulo: "Perdido", dica: "não rolou (com motivo)" },
];
export const ETAPAS_ABERTAS: Etapa[] = ["oportunidade", "contato", "proposta", "negociacao"];
export const rotuloEtapa = (e: Etapa) => ETAPAS.find((x) => x.id === e)?.rotulo ?? e;

export type Origem = "manual" | "recompra" | "volta_viagem" | "sem_seguro" | "aniversario" | "pesquisa";
export const ORIGENS: Record<Origem, string> = {
  manual: "Criada à mão",
  recompra: "Lista de recompra",
  volta_viagem: "Voltou de viagem",
  sem_seguro: "Embarca sem seguro",
  aniversario: "Aniversário",
  pesquisa: "Pesquisa pós-viagem",
};

export const MOTIVOS_PERDA = [
  "Preço", "Comprou com outra agência", "Desistiu de viajar agora", "Data não bate", "Sem resposta", "Já tinha comprado", "Outro",
];

/** Produtos: o mesmo catálogo das propostas/vendas. */
export const PRODUTOS: { id: TipoItem; rotulo: string; emoji: string }[] =
  ORDEM_TIPOS_VENDA.map((t) => ({ id: t, rotulo: TIPOS[t].rotulo, emoji: TIPOS[t].emoji }));

export interface Oportunidade {
  id: string;
  cliente_id: string;
  viagem_id: string | null;
  titulo: string;
  etapa: Etapa;
  dono_id: string | null;
  produto: TipoItem | null;
  valor_estimado: number | null;
  valor_ganho: number | null;
  origem: Origem;
  proxima_acao: string | null;
  proxima_acao_em: string | null;
  motivo_perda: string | null;
  proposta_id: string | null;
  etapa_em: string;
  ganho_em: string | null;
  perdido_em: string | null;
  criado_em: string;
  atualizado_em: string;
  cliente?: { nome: string; telefone: string | null } | null;
  viagem?: { titulo: string; data_embarque: string | null } | null;
  dono?: { name: string } | null;
}

export interface Evento {
  id: number;
  tipo: "criada" | "etapa" | "dono" | "acao" | "nota" | "proposta" | "valor";
  texto: string | null;
  autor_id: string | null;
  criado_em: string;
  autor?: { name: string } | null;
}

const SELECT = "*, cliente:rel_clientes(nome, telefone), viagem:rel_viagens(titulo, data_embarque), dono:qs_users!rel_oportunidades_dono_id_fkey(name)";

export const nomeCurto = (n: string | null | undefined) => (n ?? "").replace(/\s*\|.*$/, "");

/**
 * Abertas: todas. Fechadas (ganho/perdido): só as dos últimos `diasFechadas`
 * dias — o quadro não vira um arquivo morto.
 */
export async function listarOportunidades(diasFechadas = 30): Promise<Oportunidade[]> {
  const desde = new Date(Date.now() - diasFechadas * 86_400_000).toISOString();
  const [abertas, fechadas] = await Promise.all([
    supabase.from("rel_oportunidades").select(SELECT).in("etapa", ETAPAS_ABERTAS).order("proxima_acao_em", { ascending: true, nullsFirst: false }).limit(1000),
    supabase.from("rel_oportunidades").select(SELECT).in("etapa", ["ganho", "perdido"]).gte("etapa_em", desde).order("etapa_em", { ascending: false }).limit(500),
  ]);
  if (abertas.error) throw new Error(abertas.error.message);
  if (fechadas.error) throw new Error(fechadas.error.message);
  return [...(abertas.data ?? []), ...(fechadas.data ?? [])] as Oportunidade[];
}

export async function carregarOportunidade(id: string): Promise<Oportunidade | null> {
  const { data, error } = await supabase.from("rel_oportunidades").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Oportunidade | null;
}

export async function oportunidadesDoCliente(clienteId: string): Promise<Oportunidade[]> {
  const { data } = await supabase.from("rel_oportunidades").select(SELECT).eq("cliente_id", clienteId).order("criado_em", { ascending: false }).limit(50);
  return (data ?? []) as Oportunidade[];
}

/** Clientes com oportunidade ABERTA (pra lista de recompra marcar quem já está no pipeline). */
export async function abertasPorCliente(ids: string[]): Promise<Map<string, Oportunidade>> {
  const out = new Map<string, Oportunidade>();
  const rs = await Promise.all(lotes(ids, 200).map((l) => supabase.from("rel_oportunidades").select(SELECT).in("cliente_id", l).in("etapa", ETAPAS_ABERTAS)));
  for (const { data } of rs) {
    for (const o of (data ?? []) as Oportunidade[]) if (!out.has(o.cliente_id)) out.set(o.cliente_id, o);
  }
  return out;
}

export interface NovaOportunidade {
  cliente_id: string;
  viagem_id?: string | null;
  titulo: string;
  produto?: TipoItem | null;
  valor_estimado?: number | null;
  dono_id?: string | null;
  origem?: Origem;
  proxima_acao?: string | null;
  proxima_acao_em?: string | null;
}

export async function criarOportunidade(o: NovaOportunidade): Promise<Oportunidade> {
  const { data, error } = await supabase.from("rel_oportunidades").insert({
    cliente_id: o.cliente_id, viagem_id: o.viagem_id || null, titulo: o.titulo.trim(), produto: o.produto || null,
    valor_estimado: o.valor_estimado ?? null, dono_id: o.dono_id || null, origem: o.origem ?? "manual",
    proxima_acao: o.proxima_acao?.trim() || null, proxima_acao_em: o.proxima_acao_em || null,
  }).select(SELECT).single();
  if (error) throw new Error(error.message);
  return data as Oportunidade;
}

export type MudancaOportunidade = Partial<Pick<Oportunidade,
  "titulo" | "etapa" | "dono_id" | "produto" | "valor_estimado" | "valor_ganho" | "proxima_acao" | "proxima_acao_em" | "motivo_perda" | "viagem_id" | "proposta_id">>;

export async function mudarOportunidade(id: string, m: MudancaOportunidade): Promise<Oportunidade> {
  const { data, error } = await supabase.from("rel_oportunidades").update(m).eq("id", id).select(SELECT).single();
  if (error) {
    if (error.message.includes("perdido_tem_motivo")) throw new Error("Diga o motivo da perda.");
    throw new Error(error.message);
  }
  return data as Oportunidade;
}

export async function apagarOportunidade(id: string) {
  const { data, error } = await supabase.from("rel_oportunidades").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Só a supervisão apaga oportunidade. Marque como Perdido.");
}

export async function eventos(id: string): Promise<Evento[]> {
  const { data, error } = await supabase.from("rel_oportunidade_eventos")
    .select("*, autor:qs_users!rel_oportunidade_eventos_autor_id_fkey(name)").eq("oportunidade_id", id).order("criado_em", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as Evento[];
}

export async function anotar(id: string, texto: string, autorId: string) {
  const { error } = await supabase.from("rel_oportunidade_eventos").insert({ oportunidade_id: id, tipo: "nota", texto: texto.trim(), autor_id: autorId });
  if (error) throw new Error(error.message);
}

/**
 * Proposta saindo do cartão: cria a proposta (setor Relacionamento) já com o
 * cliente, a viagem e o destino, liga no cartão e devolve o id pra abrir o
 * editor de propostas. O cartão anda pra "Proposta enviada" quando a proposta
 * for enviada — aqui só liga.
 */
export async function criarPropostaDoCartao(o: Oportunidade): Promise<string> {
  const p = propostaVazia("relacionamento");
  p.cliente_id = o.cliente_id;
  p.viagem_id = o.viagem_id;
  p.cliente_nome = o.cliente?.nome ?? "";
  p.titulo = o.titulo;
  const id = await salvarProposta(p);
  await mudarOportunidade(o.id, { proposta_id: id });
  return id;
}

// ── Números (futuro KPI — metas virão depois, baseadas nisso) ──────────────
export interface NumerosPessoa {
  dono_id: string | null;
  dono_nome: string;
  criadas: number;
  abertas: number;
  ganhas: number;
  perdidas: number;
  valor_ganho: number;
  valor_aberto: number;
  /** ganhas / (ganhas + perdidas) decididas no período; null sem decisão */
  conversao: number | null;
}

export async function numerosDoPipeline(de: string, ate: string): Promise<NumerosPessoa[]> {
  const { data, error } = await supabase.rpc("rel_vendas_numeros", { p_de: de, p_ate: ate });
  if (error) throw new Error(error.message);
  return ((data ?? []) as NumerosPessoa[]).map((x) => ({
    ...x, criadas: Number(x.criadas), abertas: Number(x.abertas), ganhas: Number(x.ganhas), perdidas: Number(x.perdidas),
    valor_ganho: Number(x.valor_ganho) || 0, valor_aberto: Number(x.valor_aberto) || 0, conversao: x.conversao == null ? null : Number(x.conversao),
  }));
}

// ── Origens automáticas (config) ───────────────────────────────────────────
export type ChaveOrigemAuto = "volta_viagem" | "sem_seguro" | "aniversario";
export type OrigensConfig = Record<ChaveOrigemAuto, { ligado: boolean; dias: number }>;
export const ORIGENS_AUTO: { id: ChaveOrigemAuto; rotulo: string; frase: (d: number) => string }[] = [
  { id: "volta_viagem", rotulo: "Voltou de viagem e não tem a próxima", frase: (d) => `voltou há pelo menos ${d} dias (até ~13 meses) e não tem outra viagem marcada` },
  { id: "sem_seguro", rotulo: "Embarca sem seguro", frase: (d) => `embarca em até ${d} dias e não tem seguro registrado` },
  { id: "aniversario", rotulo: "Aniversário chegando", frase: (d) => `faz aniversário nos próximos ${d} dias` },
];

export interface RotinasConfig { origens: OrigensConfig; limite_por_dia: number }

export async function lerConfig(): Promise<RotinasConfig> {
  const { data, error } = await supabase.from("rel_rotinas_config").select("origens, limite_por_dia").eq("id", true).maybeSingle();
  if (error) throw new Error(error.message);
  const padrao: OrigensConfig = { volta_viagem: { ligado: false, dias: 30 }, sem_seguro: { ligado: false, dias: 60 }, aniversario: { ligado: false, dias: 15 } };
  const o = (data?.origens ?? {}) as Partial<OrigensConfig>;
  return {
    origens: { volta_viagem: { ...padrao.volta_viagem, ...o.volta_viagem }, sem_seguro: { ...padrao.sem_seguro, ...o.sem_seguro }, aniversario: { ...padrao.aniversario, ...o.aniversario } },
    limite_por_dia: Number(data?.limite_por_dia) || 30,
  };
}

export async function salvarConfig(c: RotinasConfig, userId: string) {
  const { data, error } = await supabase.from("rel_rotinas_config")
    .update({ origens: c.origens, limite_por_dia: c.limite_por_dia, atualizado_em: new Date().toISOString(), atualizado_por: userId })
    .eq("id", true).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Só a supervisão do Relacionamento muda isso.");
}

/** Prévia (simular=true) ou "gerar agora" (supervisão). */
export async function gerarOportunidades(simular: boolean): Promise<{ volta_viagem: number; sem_seguro: number; aniversario: number; hunters: number }> {
  const { data, error } = await supabase.rpc("rel_oportunidades_gerar", { p_simular: simular });
  if (error) throw new Error(error.message.includes("sem-acesso") ? "Só a supervisão do Relacionamento." : error.message);
  return data as { volta_viagem: number; sem_seguro: number; aniversario: number; hunters: number };
}

export async function listarHunters(): Promise<{ id: string; nome: string }[]> {
  const { data } = await supabase.rpc("rel_hunters");
  return (data ?? []) as { id: string; nome: string }[];
}

// ── Formatos ───────────────────────────────────────────────────────────────
export const reais = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** A próxima ação como o time lê: atrasada, hoje, ou a data. */
export function situacaoAcao(iso: string | null): { texto: string; tom: "erro" | "aviso" | "neutro" } | null {
  if (!iso) return null;
  const d = new Date(iso);
  const quando = d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  if (d.getTime() < Date.now()) return { texto: `atrasada · ${quando}`, tom: "erro" };
  if (d.toDateString() === new Date().toDateString()) return { texto: `hoje ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, tom: "aviso" };
  return { texto: quando, tom: "neutro" };
}
