// src/rel/lib/disparos.ts
// -----------------------------------------------------------------------------
// Disparos do Relacionamento (Fase 4 — 0103/0105).
//
// Criar/editar campanha e automação vai direto no banco (RLS). ENVIAR, montar
// público e testar passam pelo servidor (/api/rel-disparos): é ele que tem o
// token da Meta, confere quem pediu pra parar e grava cada envio uma vez só.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

export type Fonte = "nome" | "destino" | "data_embarque" | "link_documentos" | "link_pesquisa" | "texto";
export type MapaVariaveis = Record<string, { fonte: Fonte; valor?: string }>;

export const FONTES: { id: Fonte; rotulo: string; dica: string }[] = [
  { id: "nome", rotulo: "Primeiro nome do cliente", dica: "Maria" },
  { id: "destino", rotulo: "Destino da viagem", dica: "Japão" },
  { id: "data_embarque", rotulo: "Data de embarque", dica: "15/03/2027" },
  { id: "link_documentos", rotulo: "Link de documentos", dica: "…/documentos/abc" },
  { id: "link_pesquisa", rotulo: "Link da pesquisa", dica: "…/pesquisa/abc" },
  { id: "texto", rotulo: "Texto fixo", dica: "o que você escrever" },
];

/** Exemplo de cada fonte na prévia. */
export function exemploDaFonte(cfg: { fonte: Fonte; valor?: string } | undefined): string {
  if (!cfg) return "";
  if (cfg.fonte === "texto") return cfg.valor || "";
  return FONTES.find((f) => f.id === cfg.fonte)?.dica ?? "";
}

/** As variáveis {{n}} de um corpo de modelo, em ordem. */
export const variaveisDoCorpo = (corpo: string) =>
  [...new Set([...corpo.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]))];

export const preverTexto = (corpo: string, mapa: MapaVariaveis) =>
  corpo.replace(/{{\s*([^}]+?)\s*}}/g, (_, k) => exemploDaFonte(mapa[k]) || `[${k}]`);

// ── Público ─────────────────────────────────────────────────────────────────

export type TipoPublico = "todos" | "viagem" | "aniversariantes_mes" | "clientes";
export interface Publico {
  tipo: TipoPublico;
  expedicao?: string;
  destino?: string;
  embarque_de?: string;
  embarque_ate?: string;
  fase?: "" | "antes" | "em_viagem" | "concluida";
  mes?: number;
  clientes?: string[];
}

export function descreverPublico(p: Publico): string {
  if (p.tipo === "todos") return "Todos os clientes";
  if (p.tipo === "aniversariantes_mes") return `Aniversariantes de ${MESES[(p.mes || new Date().getMonth() + 1) - 1]}`;
  if (p.tipo === "clientes") return `${p.clientes?.length ?? 0} clientes escolhidos`;
  const partes = ["Passageiros"];
  if (p.expedicao) partes.push(`da expedição "${p.expedicao}"`);
  if (p.destino) partes.push(`com destino "${p.destino}"`);
  if (p.fase === "antes") partes.push("que ainda vão viajar");
  if (p.fase === "em_viagem") partes.push("que estão viajando");
  if (p.fase === "concluida") partes.push("que já voltaram");
  if (p.embarque_de || p.embarque_ate) partes.push(`embarque ${p.embarque_de ? `de ${p.embarque_de.split("-").reverse().join("/")}` : ""} ${p.embarque_ate ? `até ${p.embarque_ate.split("-").reverse().join("/")}` : ""}`.trim());
  return partes.join(" ");
}

export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// ── Campanhas ───────────────────────────────────────────────────────────────

export type StatusCampanha = "rascunho" | "enviando" | "pausada" | "concluida";

export interface Campanha {
  id: string;
  nome: string;
  modelo_nome: string;
  modelo_idioma: string;
  params: MapaVariaveis;
  publico: Publico;
  status: StatusCampanha;
  total: number;
  enviados: number;
  falhas: number;
  pulados: number;
  criado_em: string;
  iniciada_em: string | null;
  concluida_em: string | null;
}

export interface Envio {
  id: string;
  cliente_id: string | null;
  telefone: string | null;
  /** 0218: 'simulado' = modo simulação (registrado, NÃO enviado); 'tarefa' = a atendente manda à mão */
  status: "pendente" | "enviado" | "falhou" | "pulado" | "simulado" | "tarefa";
  motivo: string | null;
  /** 0218: o texto montado pra este cliente */
  texto?: string | null;
  automacao_id?: string | null;
  responsavel_id?: string | null;
  enviado_em: string | null;
  criado_em: string;
  cliente?: { nome: string } | null;
}

export async function listarCampanhas(): Promise<Campanha[]> {
  const { data, error } = await supabase.from("rel_campanhas").select("*").order("criado_em", { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as Campanha[];
}

export async function criarCampanha(c: Pick<Campanha, "nome" | "modelo_nome" | "modelo_idioma" | "params" | "publico">): Promise<Campanha> {
  const { data, error } = await supabase.from("rel_campanhas").insert(c).select("*").single();
  if (error) throw new Error(error.message);
  return data as Campanha;
}

export async function apagarCampanha(id: string) {
  const { error } = await supabase.from("rel_campanhas").delete().eq("id", id).eq("status", "rascunho");
  if (error) throw new Error(error.message);
}

export async function envios(filtro: { campanhaId?: string; automacaoId?: string }, limite = 300): Promise<Envio[]> {
  let q = supabase.from("rel_envios").select("id, cliente_id, telefone, status, motivo, enviado_em, criado_em, cliente:rel_clientes(nome)")
    .order("criado_em", { ascending: false }).limit(limite);
  if (filtro.campanhaId) q = q.eq("campanha_id", filtro.campanhaId);
  if (filtro.automacaoId) q = q.eq("automacao_id", filtro.automacaoId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Envio[];
}

// ── Automações ──────────────────────────────────────────────────────────────

export type Gatilho = "aniversario" | "antes_embarque" | "apos_retorno" | "pos_venda" | "aniversario_viagem";

export const GATILHOS: { id: Gatilho; rotulo: string; usaDias: boolean; frase: (d: number) => string }[] = [
  { id: "aniversario", rotulo: "Aniversário do cliente", usaDias: false, frase: () => "no dia do aniversário do cliente" },
  { id: "antes_embarque", rotulo: "Antes do embarque", usaDias: true, frase: (d) => (d === 0 ? "no dia do embarque" : `${d} dia${d > 1 ? "s" : ""} antes do embarque`) },
  { id: "apos_retorno", rotulo: "Depois da volta", usaDias: true, frase: (d) => (d === 0 ? "no dia da volta" : `${d} dia${d > 1 ? "s" : ""} depois da volta`) },
  { id: "pos_venda", rotulo: "Depois da venda", usaDias: true, frase: (d) => (d === 0 ? "no dia da venda" : `${d} dia${d > 1 ? "s" : ""} depois da venda`) },
  { id: "aniversario_viagem", rotulo: "1 ano da viagem", usaDias: false, frase: () => "1 ano depois do embarque" },
];

/** 0218: WhatsApp oficial (modelo aprovado) ou tarefa pro atendente mandar à mão. */
export type CanalAutomacao = "whatsapp" | "tarefa";

/** Variáveis do texto da TAREFA (livre, não passa pela Meta). */
export const VARIAVEIS_TAREFA: { chave: string; rotulo: string }[] = [
  { chave: "nome", rotulo: "primeiro nome" },
  { chave: "destino", rotulo: "destino" },
  { chave: "data_embarque", rotulo: "data de embarque" },
  { chave: "link_pesquisa", rotulo: "link da pesquisa" },
  { chave: "link_documentos", rotulo: "link de documentos" },
];

export interface Automacao {
  id: string;
  nome: string;
  gatilho: Gatilho;
  dias: number;
  modelo_nome: string;
  modelo_idioma: string;
  params: MapaVariaveis;
  canal: CanalAutomacao;
  /** texto da tarefa, com {nome}, {destino}… */
  texto: string | null;
  /** corpo do modelo guardado ao salvar (a simulação monta a prévia sem ir à Meta) */
  modelo_corpo: string | null;
  /** quem recebe a tarefa quando a viagem não tem responsável */
  tarefa_para: string | null;
  ativo: boolean;
  ultima_execucao: string | null;
  criado_em: string;
}

export async function listarAutomacoes(): Promise<Automacao[]> {
  const { data, error } = await supabase.from("rel_automacoes").select("*").order("criado_em");
  if (error) throw error;
  return (data ?? []) as Automacao[];
}

export async function salvarAutomacao(a: Partial<Automacao> & Pick<Automacao, "nome" | "gatilho" | "dias" | "modelo_nome" | "modelo_idioma" | "params" | "canal">) {
  const tarefa = a.canal === "tarefa";
  const corpo = {
    nome: a.nome, gatilho: a.gatilho, dias: a.dias, canal: a.canal,
    modelo_nome: tarefa ? "" : a.modelo_nome, modelo_idioma: tarefa ? "pt_BR" : a.modelo_idioma, params: tarefa ? {} : a.params,
    modelo_corpo: tarefa ? null : a.modelo_corpo ?? null,
    texto: tarefa ? (a.texto ?? "").trim() || null : null,
    tarefa_para: tarefa ? a.tarefa_para || null : null,
  };
  const res = a.id
    ? await supabase.from("rel_automacoes").update(corpo).eq("id", a.id)
    : await supabase.from("rel_automacoes").insert({ ...corpo, ativo: false });
  if (res.error) throw new Error(res.error.message);
}

export async function ligarAutomacao(id: string, ativo: boolean) {
  const { error } = await supabase.from("rel_automacoes").update({ ativo }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function apagarAutomacao(id: string) {
  const { error } = await supabase.from("rel_automacoes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Fila das automações e modo de envio (0218) ─────────────────────────────

/** O que as automações registraram (simulado / tarefa / enviado / pulado) desde `desdeDias` dias. */
export async function filaDasAutomacoes(desdeDias = 1, limite = 300): Promise<Envio[]> {
  const desde = new Date(Date.now() - desdeDias * 86_400_000).toISOString();
  const { data, error } = await supabase.from("rel_envios")
    .select("id, cliente_id, telefone, status, motivo, enviado_em, criado_em, texto, automacao_id, responsavel_id, cliente:rel_clientes(nome)")
    .not("automacao_id", "is", null).gte("criado_em", desde)
    .order("criado_em", { ascending: false }).limit(limite);
  if (error) throw error;
  return (data ?? []) as unknown as Envio[];
}

export async function marcarTarefaFeita(envioId: string) {
  const { error } = await supabase.rpc("rel_envio_tarefa_feita", { p_id: envioId });
  if (error) throw new Error(error.message);
}

/** false = modo simulação (padrão). Mesmo true, o servidor só envia com REL_AUTOMACOES_ENVIO_REAL=1. */
export async function lerEnvioReal(): Promise<boolean> {
  const { data } = await supabase.from("rel_rotinas_config").select("automacoes_envio_real").eq("id", true).maybeSingle();
  return Boolean((data as { automacoes_envio_real?: boolean } | null)?.automacoes_envio_real);
}

export async function mudarEnvioReal(ligado: boolean, userId: string) {
  const { data, error } = await supabase.from("rel_rotinas_config")
    .update({ automacoes_envio_real: ligado, atualizado_em: new Date().toISOString(), atualizado_por: userId }).eq("id", true).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Só a supervisão do Relacionamento muda isso.");
}

// ── Servidor ────────────────────────────────────────────────────────────────

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/rel-disparos", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as T;
}

export interface PreviaPublico { total: number; semTelefone: number; optout: number; amostra: { nome: string; telefone: string }[] }
export const previaPublico = (publico: Publico) => chamar<PreviaPublico>({ acao: "publico", publico });

export interface Progresso { total: number; enviados: number; falhas: number; pulados: number; pendentes: number; acabou?: boolean }
export const prepararCampanha = (campanhaId: string) => chamar<Progresso>({ acao: "preparar", campanhaId });
export const enviarLote = (campanhaId: string) => chamar<Progresso>({ acao: "enviar_lote", campanhaId });
export const pausarCampanha = (campanhaId: string) => chamar<{ ok: true }>({ acao: "pausar", campanhaId });
export const retomarCampanha = (campanhaId: string) => chamar<{ ok: true }>({ acao: "retomar", campanhaId });

export const testarAutomacao = (automacaoId: string) =>
  chamar<{ alvos: { nome: string; telefone: string | null; motivo: string | null }[] }>({ acao: "testar_automacao", automacaoId });

export interface ResumoAutomacoes {
  automacoes: { id: string; nome: string; novos: number; enviados: number; pulados: number; falhas: number; simulados?: number; tarefas?: number; cortado?: boolean }[];
  /** 0218: true só com as duas chaves do envio real ligadas */
  real?: boolean;
  erroEnvio?: string;
}
export const rodarAutomacoesAgora = () => chamar<ResumoAutomacoes>({ acao: "rodar_automacoes" });
