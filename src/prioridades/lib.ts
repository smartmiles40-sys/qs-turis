// src/prioridades/lib.ts
// -----------------------------------------------------------------------------
// PACOTES PRIORITÁRIOS + ACOMPANHAMENTO DIÁRIO (V2, 30/10/2026 — migration 0226).
//
// Bruno: "Nos pacotes, preciso SELECIONAR os que são PRIORIDADE — quem investiu
// um valor a mais, influenciador viajando, grupos grandes — e ter acompanhamento
// DIÁRIO, igual pro Relacionamento e pra Operações."
//
// Um ACOMPANHAMENTO (rel_prioridades) junta UMA ou VÁRIAS viagens (rel_viagens):
// um grupo vem do Bitrix como vários negócios (ex.: 18 negócios da família, mesma
// ida e volta) e aqui vira um cartão só, com um check do dia só.
//
// Fase/status/voos: só CONSUMIMOS o que já existe (rel_viagens_v.fase,
// dias_para_embarque, proximo_voo_*, rel_trechos_v). Nada de regra nova aqui.
//
// Sem a 0226 no banco: `semMigration` = true → o painel avisa e os selos somem.
// -----------------------------------------------------------------------------
import { useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { hojeSP, trechosDasViagens, type Trecho, type Viagem } from "@/rel/lib/viagens";
import { lotes } from "@/lib/lotes";

export type Motivo = "vip" | "influenciador" | "grupo_grande" | "outro";
export const MOTIVOS: Record<Motivo, string> = {
  vip: "VIP / pagou a mais",
  influenciador: "Influenciador viajando",
  grupo_grande: "Grupo grande",
  outro: "Outro",
};
export const MOTIVO_CURTO: Record<Motivo, string> = { vip: "VIP", influenciador: "Influenciador", grupo_grande: "Grupo", outro: "Outro" };

export interface Prioridade {
  id: string;
  nome: string;
  motivos: Motivo[];
  motivo_outro: string | null;
  observacoes: string | null;
  resp_rel_id: string | null;
  resp_ops_id: string | null;
  ativo: boolean;
  marcado_por: string | null;
  marcado_em: string;
  desmarcado_por: string | null;
  desmarcado_em: string | null;
}
export interface Vinculo { prioridade_id: string; viagem_id: string }
export interface Check {
  id: string;
  prioridade_id: string;
  dia: string;
  situacao: "ok" | "problema";
  nota: string | null;
  setor: "relacionamento" | "operacional" | null;
  feito_por: string | null;
  criado_em: string;
}
export interface Alteracao {
  id: string;
  prioridade_id: string;
  viagem_id: string | null;
  descricao: string;
  responsavel_id: string | null;
  prazo: string | null;
  feita_em: string | null;
  feita_por: string | null;
  criado_por: string | null;
  criado_em: string;
}
export interface Config { grupo_minimo: number; valor_vip: number }
export const CONFIG_PADRAO: Config = { grupo_minimo: 6, valor_vip: 50000 };
export type Setor = "relacionamento" | "operacional";
export interface Pessoa { id: string; name: string; setores: string[]; role: string }

/** A 0226 ainda não foi aplicada (tabela não existe no banco). */
export function ehSemMigration(e: unknown): boolean {
  const o = (e ?? {}) as { code?: string; message?: string };
  return o.code === "PGRST205" || o.code === "42P01" || (/rel_prioridade/.test(o.message ?? "") && /(does not exist|schema cache|not find)/i.test(o.message ?? ""));
}
export class SemMigration extends Error { constructor() { super("Falta aplicar a migration 0226 (prioridades) no banco."); } }
function falhou(e: unknown): never {
  if (ehSemMigration(e)) throw new SemMigration();
  throw e instanceof Error ? e : new Error((e as { message?: string })?.message ?? "Falhou.");
}

// ── Selos (lista e ficha): um cache só pra tela inteira ─────────────────────
export interface Selo { prioridadeId: string; nome: string; motivos: Motivo[]; ativo: boolean; viagens: number }
interface EstadoSelos { mapa: Map<string, Selo>; carregado: boolean; semMigration: boolean }
let estado: EstadoSelos = { mapa: new Map(), carregado: false, semMigration: false };
const ouvintes = new Set<() => void>();
let carregando: Promise<void> | null = null;

async function lerSelos() {
  const [p, v] = await Promise.all([
    supabase.from("rel_prioridades").select("id,nome,motivos,ativo"),
    supabase.from("rel_prioridade_viagens").select("prioridade_id,viagem_id").limit(5000),
  ]);
  const err = p.error ?? v.error;
  if (err) {
    estado = { mapa: new Map(), carregado: true, semMigration: ehSemMigration(err) };
  } else {
    const ps = new Map(((p.data ?? []) as Pick<Prioridade, "id" | "nome" | "motivos" | "ativo">[]).map((x) => [x.id, x]));
    const conta = new Map<string, number>();
    for (const l of (v.data ?? []) as Vinculo[]) conta.set(l.prioridade_id, (conta.get(l.prioridade_id) ?? 0) + 1);
    const mapa = new Map<string, Selo>();
    for (const l of (v.data ?? []) as Vinculo[]) {
      const x = ps.get(l.prioridade_id);
      if (x) mapa.set(l.viagem_id, { prioridadeId: x.id, nome: x.nome, motivos: x.motivos ?? [], ativo: x.ativo, viagens: conta.get(x.id) ?? 1 });
    }
    estado = { mapa, carregado: true, semMigration: false };
  }
  ouvintes.forEach((f) => f());
}
/** Relê os selos (depois de marcar/desmarcar, ou quando o banco avisa). */
export function recarregarSelos(): Promise<void> {
  carregando = lerSelos().finally(() => { carregando = null; });
  return carregando;
}
let canal: ReturnType<typeof supabase.channel> | null = null;
function assinar(f: () => void) {
  ouvintes.add(f);
  if (!estado.carregado && !carregando) void recarregarSelos();
  if (!canal) {
    let t: ReturnType<typeof setTimeout> | undefined;
    const mudou = () => { clearTimeout(t); t = setTimeout(() => void recarregarSelos(), 600); };
    canal = supabase.channel(`prioridades-selos-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes" as never, { event: "*", schema: "public", table: "rel_prioridades" } as never, mudou)
      .on("postgres_changes" as never, { event: "*", schema: "public", table: "rel_prioridade_viagens" } as never, mudou)
      .subscribe();
  }
  return () => {
    ouvintes.delete(f);
    if (!ouvintes.size && canal) { void supabase.removeChannel(canal); canal = null; }
  };
}
/** Selos de prioridade (ativos e desmarcados) por viagem. */
export function useSelos(): EstadoSelos {
  return useSyncExternalStore(assinar, () => estado, () => estado);
}

// ── Equipe Rel + Ops ────────────────────────────────────────────────────────
export async function listarEquipeRelOps(): Promise<Pessoa[]> {
  const { data } = await supabase.from("qs_users").select("id, name, role, setores, is_active").eq("is_active", true).order("name");
  return ((data ?? []) as (Pessoa & { is_active: boolean })[])
    .filter((u) => u.role === "admin" || (u.setores ?? []).some((s) => s === "relacionamento" || s === "operacional"))
    .map((u) => ({ id: u.id, name: u.name.replace(/\s*\|.*$/, ""), setores: u.setores ?? [], role: u.role }));
}
export const doSetor = (ps: Pessoa[], s: Setor) => ps.filter((p) => p.role === "admin" || p.setores.includes(s));
export const primeiroNome = (n: string | null | undefined) => (n ?? "").split(" ")[0] || "—";

// ── Config ──────────────────────────────────────────────────────────────────
export async function lerConfig(): Promise<Config> {
  const { data, error } = await supabase.from("rel_prioridades_config").select("grupo_minimo,valor_vip").eq("id", 1).maybeSingle();
  if (error || !data) return CONFIG_PADRAO;
  return { grupo_minimo: Number(data.grupo_minimo) || CONFIG_PADRAO.grupo_minimo, valor_vip: Number(data.valor_vip) || CONFIG_PADRAO.valor_vip };
}
export async function salvarConfig(c: Config, userId: string) {
  const { error } = await supabase.from("rel_prioridades_config").update({ ...c, atualizado_por: userId, atualizado_em: new Date().toISOString() }).eq("id", 1);
  if (error) falhou(error);
}

// ── Pessoas na viagem / grupo (só estimativa — a decisão é humana) ──────────
type ViagemPax = Pick<Viagem, "cliente_id" | "passageiros" | "qtd_passageiros">;
/** Quantas pessoas viajam: o maior entre clientes diferentes, passageiros cadastrados e o "qtd" do Bitrix. */
export function paxEstimado(vs: ViagemPax[]): number {
  const clientes = new Set(vs.map((v) => v.cliente_id).filter(Boolean)).size;
  const cadastrados = Math.max(0, ...vs.map((v) => v.passageiros || 0));
  const doBitrix = Math.max(0, ...vs.map((v) => v.qtd_passageiros || 0));
  return Math.max(clientes, cadastrados, doBitrix, vs.length ? 1 : 0);
}
export const valorTotal = (vs: Pick<Viagem, "valor">[]) => vs.reduce((s, v) => s + (Number(v.valor) || 0), 0);
export const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Os motivos que o sistema SUGERE (nunca marca sozinho). */
export function motivosSugeridos(vs: (ViagemPax & Pick<Viagem, "valor">)[], c: Config): { motivo: Motivo; porque: string }[] {
  const out: { motivo: Motivo; porque: string }[] = [];
  const pax = paxEstimado(vs);
  if (pax >= c.grupo_minimo) out.push({ motivo: "grupo_grande", porque: `${pax} pessoas (grupo grande a partir de ${c.grupo_minimo})` });
  const total = valorTotal(vs);
  if (c.valor_vip > 0 && total >= c.valor_vip) out.push({ motivo: "vip", porque: `${reais(total)} vendidos (sugestão a partir de ${reais(c.valor_vip)})` });
  return out;
}

const COLS_VIAGEM = "id,titulo,destino,cliente_id,cliente_nome,cliente_telefone,data_embarque,data_retorno,status,fase,dias_para_embarque,passageiros,qtd_passageiros,valor,servico,responsavel_id,responsavel_nome,tarefas_atrasadas,tarefas_pendentes,tarefas_total,voos_total,voos_feitos,proximo_voo_em,proximo_voo_fuso,proximo_voo_trecho,proximo_voo_numero,proximo_voo_sem_hora,ultimo_voo_em,bitrix_deal_id";
export type ViagemP = Pick<Viagem, "id" | "titulo" | "destino" | "cliente_id" | "cliente_nome" | "cliente_telefone" | "data_embarque" | "data_retorno"
  | "status" | "fase" | "dias_para_embarque" | "passageiros" | "qtd_passageiros" | "valor" | "servico" | "responsavel_id" | "responsavel_nome"
  | "tarefas_atrasadas" | "tarefas_pendentes" | "tarefas_total" | "voos_total" | "voos_feitos" | "proximo_voo_em" | "proximo_voo_fuso"
  | "proximo_voo_trecho" | "proximo_voo_numero" | "proximo_voo_sem_hora" | "ultimo_voo_em" | "bitrix_deal_id">;

async function viagensPorIds(ids: string[]): Promise<ViagemP[]> {
  const out: ViagemP[] = [];
  const rs = await Promise.all(lotes(ids, 150).map((l) => supabase.from("rel_viagens_v").select(COLS_VIAGEM).in("id", l)));
  for (const { data, error } of rs) {
    if (error) throw error;
    out.push(...((data ?? []) as ViagemP[]));
  }
  return out;
}

/**
 * As viagens "irmãs": pacotes ativos com a MESMA ida e volta (é como um grupo
 * chega do Bitrix — um negócio por família/pessoa). Sugestão pra juntar; a pessoa confere.
 */
export async function viagensIrmas(v: Pick<Viagem, "id" | "data_embarque" | "data_retorno">): Promise<ViagemP[]> {
  if (!v.data_embarque) return [];
  let q = supabase.from("rel_viagens_v").select(COLS_VIAGEM).eq("status", "ativa").eq("data_embarque", v.data_embarque).neq("id", v.id).limit(200);
  q = v.data_retorno ? q.eq("data_retorno", v.data_retorno) : q.is("data_retorno", null);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as ViagemP[]).filter((x) => x.servico === "pacote" || x.servico == null);
}

/** Busca de pacote pra pôr no acompanhamento (por cliente, destino, título ou nº do Bitrix). */
export async function buscarPacotes(texto: string): Promise<ViagemP[]> {
  const t = texto.replace(/[,()*%\\:"']/g, " ").trim();
  if (t.length < 2) return [];
  const { data, error } = await supabase.from("rel_viagens_v").select(COLS_VIAGEM).eq("status", "ativa").in("fase", ["antes", "em_viagem", "sem_data"])
    .or(`titulo.ilike.*${t}*,destino.ilike.*${t}*,cliente_nome.ilike.*${t}*,bitrix_deal_id.eq.${t.replace(/\D/g, "") || "0"}`)
    .order("data_embarque", { ascending: true, nullsFirst: false }).limit(30);
  if (error) throw error;
  return (data ?? []) as ViagemP[];
}

// ── Marcar / desmarcar ──────────────────────────────────────────────────────
export interface Marcacao {
  nome: string;
  motivos: Motivo[];
  motivo_outro: string | null;
  observacoes: string | null;
  resp_rel_id: string | null;
  resp_ops_id: string | null;
}

/**
 * Marca como prioridade. Se alguma das viagens já foi de um acompanhamento (mesmo
 * desmarcado), ele volta (uma viagem tem um acompanhamento só — fica o histórico).
 */
export async function marcarPrioridade(m: Marcacao, viagemIds: string[], userId: string, existenteId?: string | null): Promise<string> {
  let id = existenteId ?? null;
  if (!id) {
    const { data: ja, error: e0 } = await supabase.from("rel_prioridade_viagens").select("prioridade_id").in("viagem_id", viagemIds).limit(1);
    if (e0) falhou(e0);
    id = (ja?.[0] as { prioridade_id?: string } | undefined)?.prioridade_id ?? null;
  }
  const dados = { ...m, nome: m.nome.trim().slice(0, 200) || "Pacote prioritário", ativo: true, desmarcado_por: null, desmarcado_em: null };
  if (id) {
    const { error } = await supabase.from("rel_prioridades").update({ ...dados, marcado_por: userId, marcado_em: new Date().toISOString() }).eq("id", id);
    if (error) falhou(error);
  } else {
    const { data, error } = await supabase.from("rel_prioridades").insert({ ...dados, marcado_por: userId }).select("id").single();
    if (error) falhou(error);
    id = (data as { id: string }).id;
  }
  await incluirViagens(id, viagemIds, userId);
  await recarregarSelos();
  return id;
}

/** Põe viagens no acompanhamento (a que estava em outro acompanhamento muda pra este). */
export async function incluirViagens(prioridadeId: string, viagemIds: string[], userId: string) {
  if (!viagemIds.length) return;
  const { error: e1 } = await supabase.from("rel_prioridade_viagens").delete().in("viagem_id", viagemIds).neq("prioridade_id", prioridadeId);
  if (e1) falhou(e1);
  const { error } = await supabase.from("rel_prioridade_viagens")
    .upsert(viagemIds.map((v) => ({ prioridade_id: prioridadeId, viagem_id: v, incluido_por: userId })), { onConflict: "prioridade_id,viagem_id", ignoreDuplicates: true });
  if (error) falhou(error);
}

export async function tirarViagem(prioridadeId: string, viagemId: string) {
  const { error } = await supabase.from("rel_prioridade_viagens").delete().eq("prioridade_id", prioridadeId).eq("viagem_id", viagemId);
  if (error) falhou(error);
  await recarregarSelos();
}

/** Desmarca o acompanhamento inteiro (fica no histórico; dá pra marcar de novo). */
export async function desmarcarPrioridade(id: string, userId: string) {
  const { error } = await supabase.from("rel_prioridades").update({ ativo: false, desmarcado_por: userId, desmarcado_em: new Date().toISOString() }).eq("id", id);
  if (error) falhou(error);
  await recarregarSelos();
}

export async function salvarPrioridade(id: string, m: Partial<Marcacao>) {
  const { error } = await supabase.from("rel_prioridades").update(m).eq("id", id);
  if (error) falhou(error);
  await recarregarSelos();
}

export async function lerPrioridade(id: string): Promise<{ p: Prioridade; viagemIds: string[] } | null> {
  const [a, b] = await Promise.all([
    supabase.from("rel_prioridades").select("*").eq("id", id).maybeSingle(),
    supabase.from("rel_prioridade_viagens").select("viagem_id").eq("prioridade_id", id),
  ]);
  if (a.error) falhou(a.error);
  if (b.error) falhou(b.error);
  if (!a.data) return null;
  return { p: a.data as Prioridade, viagemIds: ((b.data ?? []) as { viagem_id: string }[]).map((x) => x.viagem_id) };
}

// ── Check do dia + alterações ───────────────────────────────────────────────
export async function registrarCheck(prioridadeId: string, situacao: "ok" | "problema", nota: string, setor: Setor, userId: string) {
  const { error } = await supabase.from("rel_prioridade_checks")
    .insert({ prioridade_id: prioridadeId, dia: hojeSP(), situacao, nota: nota.trim() || null, setor, feito_por: userId });
  if (error) falhou(error);
}
export async function apagarCheck(id: string) {
  const { error } = await supabase.from("rel_prioridade_checks").delete().eq("id", id);
  if (error) falhou(error);
}
export async function criarAlteracao(a: { prioridade_id: string; descricao: string; responsavel_id: string | null; prazo: string | null; viagem_id?: string | null }, userId: string) {
  const { error } = await supabase.from("rel_prioridade_alteracoes").insert({ ...a, descricao: a.descricao.trim(), criado_por: userId });
  if (error) falhou(error);
}
export async function marcarAlteracao(id: string, feita: boolean, userId: string) {
  const { error } = await supabase.from("rel_prioridade_alteracoes")
    .update(feita ? { feita_em: new Date().toISOString(), feita_por: userId } : { feita_em: null, feita_por: null }).eq("id", id);
  if (error) falhou(error);
}
export async function apagarAlteracao(id: string) {
  const { error } = await supabase.from("rel_prioridade_alteracoes").delete().eq("id", id);
  if (error) falhou(error);
}

// ── O painel ────────────────────────────────────────────────────────────────
export type Situacao =
  | { tipo: "em_viagem"; texto: string; dia: number; de: number }
  | { tipo: "antes"; texto: string; dias: number }
  | { tipo: "voltou"; texto: string; haDias: number }
  | { tipo: "sem_data"; texto: string };

const diaMs = 86_400_000;
const dataSP = (d: string) => new Date(`${d}T12:00:00-03:00`).getTime();

/** Onde o acompanhamento está HOJE — pela fase que a view já calcula (não refaz a regra). */
export function situacaoDe(vs: ViagemP[]): Situacao {
  const hoje = dataSP(hojeSP());
  const ativos = vs.filter((v) => v.status === "ativa");
  const base = ativos.length ? ativos : vs;
  const emViagem = base.filter((v) => v.fase === "em_viagem");
  if (emViagem.length) {
    const ini = Math.min(...emViagem.map((v) => (v.data_embarque ? dataSP(v.data_embarque) : hoje)));
    const fim = Math.max(...emViagem.map((v) => (v.data_retorno ? dataSP(v.data_retorno) : hoje)));
    const dia = Math.round((hoje - ini) / diaMs) + 1;
    const de = Math.max(dia, Math.round((fim - ini) / diaMs) + 1);
    return { tipo: "em_viagem", texto: `em viagem hoje · dia ${dia} de ${de}`, dia, de };
  }
  const antes = base.filter((v) => v.fase === "antes" && v.dias_para_embarque != null);
  if (antes.length) {
    const dias = Math.min(...antes.map((v) => v.dias_para_embarque!));
    return { tipo: "antes", texto: dias <= 0 ? "embarca hoje" : dias === 1 ? "embarca amanhã" : `embarca em ${dias} dias`, dias };
  }
  const voltas = base.filter((v) => v.fase === "concluida" && v.data_retorno).map((v) => v.data_retorno!);
  if (voltas.length) {
    const ult = voltas.sort().at(-1)!;
    const haDias = Math.round((hoje - dataSP(ult)) / diaMs);
    return { tipo: "voltou", texto: `voltou em ${ult.slice(8, 10)}/${ult.slice(5, 7)}`, haDias };
  }
  return { tipo: "sem_data", texto: "sem data de embarque" };
}

/**
 * Pede o check de HOJE? Em viagem, embarcando nos próximos 30 dias ou de volta há
 * até 2 dias. (Pacote de 2027 não precisa de check diário — decisão a confirmar.)
 */
export function pedeCheck(s: Situacao): boolean {
  return s.tipo === "em_viagem" || (s.tipo === "antes" && s.dias <= 30) || (s.tipo === "voltou" && s.haDias <= 2);
}

export interface Cartao {
  p: Prioridade;
  viagens: ViagemP[];
  situacao: Situacao;
  checks: Check[];
  checkHoje: Check[];
  alteracoes: Alteracao[];
  trechosHoje: Trecho[];
  proximoTrecho: Trecho | null;
  pax: number;
  valor: number;
}

export interface Painel {
  cartoes: Cartao[];
  encerrados: Cartao[];
  pessoas: Pessoa[];
  config: Config;
}

const diaDoTrecho = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "");

/** O mesmo voo aparece em cada negócio do grupo: um só por número + partida. */
function semRepetir(ts: Trecho[]): Trecho[] {
  const vistos = new Set<string>();
  return ts.filter((t) => {
    const k = `${t.tipo}|${t.partida_em}|${(t.numero ?? "").replace(/\s/g, "").toUpperCase()}|${t.origem_codigo ?? t.origem ?? ""}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

export async function carregarPainel(): Promise<Painel> {
  const [ps, ls] = await Promise.all([
    supabase.from("rel_prioridades").select("*").order("marcado_em", { ascending: false }),
    supabase.from("rel_prioridade_viagens").select("prioridade_id,viagem_id").limit(5000),
  ]);
  if (ps.error) falhou(ps.error);
  if (ls.error) falhou(ls.error);
  const prioridades = ((ps.data ?? []) as Prioridade[]);
  const ativas = prioridades.filter((p) => p.ativo);
  const ids = new Set(ativas.map((p) => p.id));
  const links = ((ls.data ?? []) as Vinculo[]).filter((l) => ids.has(l.prioridade_id));
  const desde = new Date(dataSP(hojeSP()) - 20 * diaMs).toISOString().slice(0, 10);

  const [viagens, chk, alt, pessoas, config] = await Promise.all([
    viagensPorIds([...new Set(links.map((l) => l.viagem_id))]),
    ids.size ? supabase.from("rel_prioridade_checks").select("*").in("prioridade_id", [...ids]).gte("dia", desde).order("criado_em", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    ids.size ? supabase.from("rel_prioridade_alteracoes").select("*").in("prioridade_id", [...ids]).order("criado_em", { ascending: true }) : Promise.resolve({ data: [], error: null }),
    listarEquipeRelOps(),
    lerConfig(),
  ]);
  if (chk.error) falhou(chk.error);
  if (alt.error) falhou(alt.error);
  const trechos = viagens.length ? await trechosDasViagens(viagens.map((v) => v.id)).catch(() => [] as Trecho[]) : [];

  const vPorId = new Map(viagens.map((v) => [v.id, v]));
  const hoje = hojeSP();
  const agora = Date.now();
  // acompanhamento que ficou sem viagem (todas foram pra outro) não vira cartão
  const todos: Cartao[] = ativas.filter((p) => links.some((l) => l.prioridade_id === p.id)).map((p) => {
    const vs = links.filter((l) => l.prioridade_id === p.id).map((l) => vPorId.get(l.viagem_id)).filter((v): v is ViagemP => !!v);
    const meus = new Set(vs.map((v) => v.id));
    const ts = semRepetir(trechos.filter((t) => meus.has(t.viagem_id)).sort((a, b) => a.partida_em.localeCompare(b.partida_em)));
    const checks = ((chk.data ?? []) as Check[]).filter((c) => c.prioridade_id === p.id);
    return {
      p,
      viagens: vs.sort((a, b) => (a.cliente_nome ?? "").localeCompare(b.cliente_nome ?? "", "pt-BR")),
      situacao: situacaoDe(vs),
      checks,
      checkHoje: checks.filter((c) => c.dia === hoje),
      alteracoes: ((alt.data ?? []) as Alteracao[]).filter((a) => a.prioridade_id === p.id),
      trechosHoje: ts.filter((t) => diaDoTrecho(t.partida_em) === hoje || diaDoTrecho(t.checkin_em) === hoje),
      proximoTrecho: ts.find((t) => new Date(t.partida_em).getTime() > agora && diaDoTrecho(t.partida_em) !== hoje) ?? null,
      pax: paxEstimado(vs),
      valor: valorTotal(vs),
    };
  });
  // ordem: sem check de hoje primeiro (vermelho), depois em viagem, depois quem embarca antes
  const peso = (c: Cartao) => (pedeCheck(c.situacao) && !c.checkHoje.length ? 0 : 1) * 10
    + (c.situacao.tipo === "em_viagem" ? 0 : c.situacao.tipo === "antes" ? 1 : c.situacao.tipo === "sem_data" ? 2 : 3);
  const ordem = (a: Cartao, b: Cartao) => peso(a) - peso(b)
    || (a.situacao.tipo === "antes" && b.situacao.tipo === "antes" ? a.situacao.dias - b.situacao.dias : 0);
  const encerrado = (c: Cartao) => c.situacao.tipo === "voltou" && c.situacao.haDias > 7;
  return {
    cartoes: todos.filter((c) => !encerrado(c)).sort(ordem),
    encerrados: todos.filter(encerrado),
    pessoas,
    config,
  };
}

/**
 * SUGESTÕES (nunca marca sozinho): pacotes ativos que vão viajar ou estão
 * viajando, juntados por ida+volta iguais, que passam do N do grupo grande ou
 * do valor de VIP — e que ainda não estão em nenhum acompanhamento.
 */
export interface Sugestao { chave: string; nome: string; viagens: ViagemP[]; pax: number; valor: number; motivos: { motivo: Motivo; porque: string }[] }
export async function carregarSugestoes(config: Config): Promise<Sugestao[]> {
  const [{ data, error }, ls] = await Promise.all([
    supabase.from("rel_viagens_v").select(COLS_VIAGEM).eq("servico", "pacote").eq("status", "ativa").in("fase", ["antes", "em_viagem"]).limit(1000),
    supabase.from("rel_prioridade_viagens").select("viagem_id").limit(5000),
  ]);
  if (error) throw error;
  if (ls.error) falhou(ls.error);
  const ja = new Set(((ls.data ?? []) as { viagem_id: string }[]).map((x) => x.viagem_id));
  const grupos = new Map<string, ViagemP[]>();
  for (const v of (data ?? []) as ViagemP[]) {
    if (ja.has(v.id) || !v.data_embarque) continue;
    const k = `${v.data_embarque}|${v.data_retorno ?? ""}`;
    grupos.set(k, [...(grupos.get(k) ?? []), v]);
  }
  const out: Sugestao[] = [];
  for (const [chave, vs] of grupos) {
    const motivos = motivosSugeridos(vs, config);
    if (!motivos.length) continue;
    out.push({ chave, nome: nomeSugerido(vs), viagens: vs, pax: paxEstimado(vs), valor: valorTotal(vs), motivos });
  }
  return out.sort((a, b) => (a.viagens[0].data_embarque ?? "").localeCompare(b.viagens[0].data_embarque ?? ""));
}

/** "Sobreira · Madri/Barcelona" (grupo: o sobrenome que mais se repete) ou "Cliente · Destino". */
export function nomeSugerido(vs: Pick<ViagemP, "cliente_nome" | "destino" | "titulo">[]): string {
  if (!vs.length) return "Pacote prioritário";
  const destino = vs[0].destino || vs[0].titulo;
  if (vs.length === 1) return `${vs[0].cliente_nome ?? "Cliente"} · ${destino}`;
  const conta = new Map<string, number>();
  for (const v of vs) {
    const ult = (v.cliente_nome ?? "").trim().split(/\s+/).at(-1) ?? "";
    if (ult.length > 2) conta.set(ult, (conta.get(ult) ?? 0) + 1);
  }
  const [sobrenome, n] = [...conta.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  return n >= 2 ? `Grupo ${sobrenome} · ${destino}` : `Grupo ${destino}`;
}
