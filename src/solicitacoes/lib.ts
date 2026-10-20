// src/solicitacoes/lib.ts
// -----------------------------------------------------------------------------
// CENTRAL DE SOLICITAÇÕES (0149, Bruno 20/10/2026): pedido de setor pra setor
// (Comercial, Relacionamento, Financeiro, Operações) com dono, prazo e
// histórico — "tem solicitações que o relacionamento pede para o operações e
// se perde".
//
//   nova → em andamento ⇄ aguardando → concluída → quem pediu confirma/reabre
//                                     ↘ recusada (com motivo)
//
// Ninguém aceitou em 2 horas úteis → acende pro gestor (sem_dono_atrasada).
// Prazo vem do TIPO (horas úteis). Tudo que muda passa por RPC.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { NOME_SETOR, SETORES, type Setor } from "@/components/sdr/types";

export { NOME_SETOR, SETORES, type Setor };

export type StatusSol = "nova" | "em_andamento" | "aguardando" | "concluida" | "recusada" | "cancelada";
export type AguardandoQuem = "cliente" | "fornecedor" | "solicitante" | "outro_setor";
export type PrioridadeSol = "normal" | "alta" | "urgente";
export type AcaoSol = "comentar" | "aceitar" | "passar" | "aguardar" | "retomar" | "concluir" | "recusar" | "confirmar" | "reabrir" | "cancelar" | "prazo";

export const STATUS_SOL: Record<StatusSol, string> = {
  nova: "Nova — ninguém pegou",
  em_andamento: "Em andamento",
  aguardando: "Aguardando",
  concluida: "Concluída",
  recusada: "Recusada",
  cancelada: "Cancelada",
};
export const STATUS_CURTO: Record<StatusSol, string> = {
  nova: "Nova", em_andamento: "Em andamento", aguardando: "Aguardando", concluida: "Concluída", recusada: "Recusada", cancelada: "Cancelada",
};
export const TOM_SOL: Record<StatusSol, "neutro" | "rel" | "aviso" | "erro"> = {
  nova: "aviso", em_andamento: "rel", aguardando: "neutro", concluida: "rel", recusada: "erro", cancelada: "neutro",
};
export const AGUARDANDO: Record<AguardandoQuem, string> = {
  cliente: "o cliente",
  fornecedor: "o fornecedor",
  solicitante: "quem pediu",
  outro_setor: "outro setor",
};
export const PRIORIDADE_SOL: Record<PrioridadeSol, string> = { normal: "Normal", alta: "Alta", urgente: "Urgente" };
export const ABERTAS: StatusSol[] = ["nova", "em_andamento", "aguardando"];

/** Sigla curta do setor pros cartões. */
export const SIGLA: Record<Setor, string> = { comercial: "COM", relacionamento: "REL", financeiro: "FIN", operacional: "OPS" };
/** Cor de cada setor (a mesma da porta do login). */
export const COR_SETOR: Record<Setor, string> = { comercial: "#0147FF", relacionamento: "#0E7C6A", financeiro: "#3730A3", operacional: "#B45309" };

export interface TipoSol {
  id: string;
  setor: Setor;
  rotulo: string;
  prazo_horas: number;
  ordem: number;
  ativo: boolean;
}

export interface Solicitacao {
  id: string;
  numero: number;
  de_setor: Setor;
  para_setor: Setor;
  tipo_id: string | null;
  tipo_rotulo: string | null;
  titulo: string;
  descricao: string;
  prioridade: PrioridadeSol;
  status: StatusSol;
  aguardando_quem: AguardandoQuem | null;
  prazo: string | null;
  cliente_id: string | null;
  viagem_id: string | null;
  lead_id: string | null;
  conversa_id: string | null;
  sobre_nome: string | null;
  criado_por: string | null;
  criado_por_nome: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  criado_em: string;
  aceito_em: string | null;
  concluido_em: string | null;
  confirmado_em: string | null;
  atualizado_em: string;
  resolucao: string | null;
  reaberturas: number;
  aberta: boolean;
  vencida: boolean;
  sem_dono_atrasada: boolean;
  novidade: boolean;
}

export interface EventoSol {
  id: number;
  solicitacao_id: string;
  tipo: "criada" | "aceita" | "passada" | "status" | "comentario" | "prazo" | "concluida" | "confirmada" | "reaberta" | "recusada" | "cancelada" | "vinculada";
  de: string | null;
  para: string | null;
  texto: string | null;
  autor_id: string | null;
  autor_nome: string | null;
  criado_em: string;
}

export interface Pessoa { id: string; name: string; role: string; setores: string[] | null }

/** Do que se trata o pedido (pelo menos um, ou nenhum = pedido interno). */
export interface AlvoSol {
  clienteId?: string | null;
  viagemId?: string | null;
  leadId?: string | null;
  conversaId?: string | null;
  /** Nome pra mostrar ("Maria Souza · Islândia G1"); o banco completa se faltar. */
  sobre?: string | null;
}

// ── Leitura ─────────────────────────────────────────────────────────────────

export async function listarTipos(): Promise<TipoSol[]> {
  const { data, error } = await supabase.from("qs_solicitacao_tipos").select("*").order("ordem").order("rotulo");
  if (error) throw new Error(error.message);
  return (data ?? []) as TipoSol[];
}

/** Abertas de um setor (recebidas ou enviadas) + fechadas dos últimos `dias`. */
export async function listarDoSetor(setor: Setor, lado: "para" | "de", dias = 14): Promise<Solicitacao[]> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const col = lado === "para" ? "para_setor" : "de_setor";
  const { data, error } = await supabase.from("qs_solicitacoes_v").select("*").eq(col, setor)
    .or(`aberta.eq.true,concluido_em.gte."${desde}",and(status.eq.concluida,confirmado_em.is.null)`)
    .order("criado_em", { ascending: true }).limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as Solicitacao[];
}

/** As que eu pedi (de qualquer setor). */
export async function listarMinhas(userId: string, dias = 30): Promise<Solicitacao[]> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  const { data, error } = await supabase.from("qs_solicitacoes_v").select("*").eq("criado_por", userId)
    .or(`aberta.eq.true,concluido_em.gte."${desde}",and(status.eq.concluida,confirmado_em.is.null)`)
    .order("criado_em", { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as Solicitacao[];
}

/** Busca no histórico (número, título, cliente). */
export async function buscar(setor: Setor, termo: string): Promise<Solicitacao[]> {
  const t = termo.trim();
  let q = supabase.from("qs_solicitacoes_v").select("*").or(`para_setor.eq.${setor},de_setor.eq.${setor}`);
  if (/^#?\d+$/.test(t)) q = q.eq("numero", Number(t.replace("#", "")));
  else if (t) {
    const s = t.replace(/[%,()"\\]/g, " ");
    q = q.or(`titulo.ilike.%${s}%,sobre_nome.ilike.%${s}%,descricao.ilike.%${s}%`);
  }
  const { data, error } = await q.order("criado_em", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as Solicitacao[];
}

/** As solicitações sobre um cliente / viagem / lead (pra mostrar na ficha). */
export async function solicitacoesDe(alvo: AlvoSol, limite = 30): Promise<Solicitacao[]> {
  const f: string[] = [];
  if (alvo.viagemId) f.push(`viagem_id.eq.${alvo.viagemId}`);
  if (alvo.clienteId) f.push(`cliente_id.eq.${alvo.clienteId}`);
  if (alvo.leadId) f.push(`lead_id.eq.${alvo.leadId}`);
  if (alvo.conversaId) f.push(`conversa_id.eq.${alvo.conversaId}`);
  if (!f.length) return [];
  const { data, error } = await supabase.from("qs_solicitacoes_v").select("*").or(f.join(","))
    .order("criado_em", { ascending: false }).limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as Solicitacao[];
}

export async function carregarSolicitacao(id: string): Promise<{ s: Solicitacao | null; eventos: EventoSol[] }> {
  const [a, b] = await Promise.all([
    supabase.from("qs_solicitacoes_v").select("*").eq("id", id).maybeSingle(),
    supabase.from("qs_solicitacao_eventos").select("*").eq("solicitacao_id", id).order("criado_em"),
  ]);
  if (a.error) throw new Error(a.error.message);
  return { s: (a.data as Solicitacao) ?? null, eventos: (b.data ?? []) as EventoSol[] };
}

/** Pessoas ativas de um setor (pra "passar pra…"). */
export async function pessoasDoSetor(setor: Setor): Promise<Pessoa[]> {
  const { data, error } = await supabase.from("qs_users").select("id, name, role, setores").eq("is_active", true).order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Pessoa[]).filter((p) => p.role === "admin" || (p.setores ?? []).includes(setor));
}

export interface Contagem { novas: number; atrasadas: number; comigo: number; novidades: number }
export async function contarSolicitacoes(setor: Setor): Promise<Contagem> {
  const { data, error } = await supabase.rpc("qs_sol_contagem", { p_setor: setor });
  if (error) throw new Error(error.message);
  const c = (data ?? {}) as Partial<Contagem>;
  return { novas: c.novas ?? 0, atrasadas: c.atrasadas ?? 0, comigo: c.comigo ?? 0, novidades: c.novidades ?? 0 };
}

// ── Escrita (RPC) ───────────────────────────────────────────────────────────

export async function criarSolicitacao(p: {
  de: Setor; para: Setor; tipo: string; titulo: string; descricao: string; prioridade: PrioridadeSol; prazo?: string | null;
} & AlvoSol): Promise<string> {
  const { data, error } = await supabase.rpc("qs_sol_criar", {
    p_de: p.de, p_para: p.para, p_tipo: p.tipo, p_titulo: p.titulo, p_descricao: p.descricao, p_prioridade: p.prioridade,
    p_prazo: p.prazo ?? null, p_cliente: p.clienteId ?? null, p_viagem: p.viagemId ?? null, p_lead: p.leadId ?? null,
    p_conversa: p.conversaId ?? null, p_sobre: p.sobre ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function agir(id: string, acao: AcaoSol, texto?: string | null, extra?: string | null) {
  const { error } = await supabase.rpc("qs_sol_acao", { p_id: id, p_acao: acao, p_texto: texto ?? null, p_extra: extra ?? null });
  if (error) throw new Error(error.message);
}

export async function marcarVisto(id: string) {
  await supabase.rpc("qs_sol_visto", { p_id: id });
}

export async function salvarTipo(t: Partial<TipoSol> & { id: string; setor: Setor }) {
  const { error } = await supabase.from("qs_solicitacao_tipos").upsert({ ...t, atualizado_em: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

// ── Textos ──────────────────────────────────────────────────────────────────

export function haQuanto(iso: string | null | undefined): string {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

/** "vence hoje 16:00", "venceu há 3h", "vence qui 10:00". */
export function textoPrazo(s: Pick<Solicitacao, "prazo" | "aberta">): { texto: string; tom: "neutro" | "aviso" | "erro" } {
  if (!s.prazo) return { texto: "sem prazo", tom: "neutro" };
  const p = new Date(s.prazo);
  const diff = p.getTime() - Date.now();
  const hora = p.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const dia = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const hoje = dia(new Date());
  const amanha = dia(new Date(Date.now() + 86_400_000));
  const quando = dia(p) === hoje ? `hoje ${hora}` : dia(p) === amanha ? `amanhã ${hora}`
    : `${p.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).replace(".", "")} ${hora}`;
  if (!s.aberta) return { texto: `prazo ${quando}`, tom: "neutro" };
  if (diff < 0) return { texto: `venceu ${haQuanto(s.prazo)}`, tom: "erro" };
  if (diff < 2 * 3_600_000) return { texto: `vence ${quando}`, tom: "aviso" };
  return { texto: `vence ${quando}`, tom: "neutro" };
}

export function primeiroNome(n: string | null | undefined) { return (n ?? "").trim().split(/\s+/)[0] || ""; }

/** Pra input datetime-local (hora de São Paulo). */
export function paraInputLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return f.format(d).replace(" ", "T");
}
export function deInputLocal(v: string): string | null {
  if (!v) return null;
  return new Date(`${v}:00-03:00`).toISOString();
}

// ── Cliente e venda do pedido (0150) ────────────────────────────────────────
// Qualquer setor acha o cliente (Operações e Comercial não leem as fichas: a
// busca devolve só nome, final do telefone e e-mail mascarado).

export interface ClienteAchado { id: string; nome: string; telefone_fim: string | null; email_mascarado: string | null; vendas: number }
export interface VendaDoCliente {
  id: string; titulo: string; destino: string | null; data_embarque: string | null; servico: string | null;
  fase: string; status: string; bitrix_deal_id: string | null; comprador: boolean;
}

export async function acharClientes(termo: string): Promise<ClienteAchado[]> {
  const { data, error } = await supabase.rpc("qs_sol_buscar_clientes", { p_termo: termo });
  if (error) throw new Error(error.message);
  return (data ?? []) as ClienteAchado[];
}

export async function vendasDoCliente(clienteId: string): Promise<VendaDoCliente[]> {
  const { data, error } = await supabase.rpc("qs_sol_vendas_do_cliente", { p_cliente: clienteId });
  if (error) throw new Error(error.message);
  return (data ?? []) as VendaDoCliente[];
}

export async function vincular(id: string, clienteId: string, viagemId: string | null) {
  const { error } = await supabase.rpc("qs_sol_vincular", { p_id: id, p_cliente: clienteId, p_viagem: viagemId });
  if (error) throw new Error(error.message);
}

/** "Japão · embarca 19/09/2026 · Pacote" */
export function textoVenda(v: VendaDoCliente): string {
  const data = v.data_embarque ? `embarca ${v.data_embarque.split("-").reverse().join("/")}` : "sem data";
  const passou = v.fase === "concluida" ? " (já foi)" : v.status !== "ativa" ? " (cancelada)" : "";
  return `${v.titulo}${v.destino && v.destino !== v.titulo ? ` — ${v.destino}` : ""} · ${data}${passou}${v.bitrix_deal_id ? ` · #${v.bitrix_deal_id}` : ""}`;
}
