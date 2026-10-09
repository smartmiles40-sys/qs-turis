// src/rel/lib/pos.ts
// -----------------------------------------------------------------------------
// Pós-viagem (pesquisa), recompra e chamados — Fase 5 (0103).
//
// Ler e criar o CONVITE da pesquisa / o chamado: direto no banco (RLS).
// A RESPOSTA da pesquisa chega só pelo servidor (link público, api/rel-pesquisa)
// e a RECOMPRA também (api/rel-recompra), porque ela cria o lead no Comercial.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

// ── Pesquisas ───────────────────────────────────────────────────────────────

export interface Pesquisa {
  id: string;
  token: string;
  viagem_id: string | null;
  cliente_id: string;
  nota: number | null;
  comentario: string | null;
  melhor_parte: string | null;
  proximo_destino: string | null;
  criado_em: string;
  respondida_em: string | null;
  cliente?: { nome: string; telefone: string | null } | null;
  viagem?: { titulo: string; destino: string | null } | null;
}

export const linkDaPesquisa = (token: string) => `${window.location.origin}/pesquisa/${token}`;

/** Promotor 9–10, neutro 7–8, detrator 0–6 (a régua do NPS). */
export function grupoNps(nota: number | null): "promotor" | "neutro" | "detrator" | null {
  if (nota == null) return null;
  return nota >= 9 ? "promotor" : nota >= 7 ? "neutro" : "detrator";
}

export function calcularNps(notas: number[]) {
  const n = notas.length;
  if (!n) return { nps: null as number | null, media: null as number | null, prom: 0, neut: 0, det: 0, n };
  const prom = notas.filter((x) => x >= 9).length;
  const det = notas.filter((x) => x <= 6).length;
  return {
    nps: Math.round(((prom - det) / n) * 100),
    media: Math.round((notas.reduce((a, b) => a + b, 0) / n) * 10) / 10,
    prom, neut: n - prom - det, det, n,
  };
}

export async function listarPesquisas(desdeDias: number): Promise<Pesquisa[]> {
  const desde = new Date(Date.now() - desdeDias * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("rel_pesquisas")
    .select("*, cliente:rel_clientes(nome, telefone), viagem:rel_viagens(titulo, destino)")
    .gte("criado_em", desde)
    .order("respondida_em", { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as Pesquisa[];
}

/** Cria o convite (token) de um passageiro numa viagem. Já existindo, devolve o existente. */
export async function gerarPesquisa(clienteId: string, viagemId: string | null): Promise<Pesquisa> {
  let q = supabase.from("rel_pesquisas").select("*").eq("cliente_id", clienteId);
  q = viagemId ? q.eq("viagem_id", viagemId) : q.is("viagem_id", null);
  const { data: ja } = await q.maybeSingle();
  if (ja) return ja as Pesquisa;
  const { data, error } = await supabase
    .from("rel_pesquisas").insert({ cliente_id: clienteId, viagem_id: viagemId }).select("*").single();
  if (error) throw new Error(error.message);
  return data as Pesquisa;
}

export interface PassageiroSemPesquisa {
  viagem_id: string;
  viagem_titulo: string;
  data_retorno: string | null;
  cliente_id: string;
  cliente_nome: string;
  telefone: string | null;
  pesquisa: Pesquisa | null;
}

/** Viagens que voltaram nos últimos `dias` dias, passageiro a passageiro, com a pesquisa (se já tem). */
export async function passageirosParaPesquisa(dias = 60): Promise<PassageiroSemPesquisa[]> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
  const { data: viagens, error } = await supabase
    .from("rel_viagens_v").select("id, titulo, data_retorno, data_embarque")
    .eq("fase", "concluida").gte("data_retorno", desde).order("data_retorno", { ascending: false }).limit(200);
  if (error) throw error;
  const ids = (viagens ?? []).map((v: { id: string }) => v.id);
  if (!ids.length) return [];
  const [{ data: pass }, { data: pesq }] = await Promise.all([
    supabase.from("rel_viagem_passageiros").select("viagem_id, cliente:rel_clientes(id, nome, telefone, mesclado_em_id)").in("viagem_id", ids),
    supabase.from("rel_pesquisas").select("*").in("viagem_id", ids),
  ]);
  const porChave = new Map(((pesq ?? []) as Pesquisa[]).map((p) => [`${p.viagem_id}:${p.cliente_id}`, p]));
  const vMap = new Map((viagens ?? []).map((v: { id: string; titulo: string; data_retorno: string | null; data_embarque: string | null }) => [v.id, v]));
  const out: PassageiroSemPesquisa[] = [];
  for (const p of (pass ?? []) as unknown as { viagem_id: string; cliente: { id: string; nome: string; telefone: string | null; mesclado_em_id: string | null } | null }[]) {
    if (!p.cliente || p.cliente.mesclado_em_id) continue;
    const v = vMap.get(p.viagem_id);
    if (!v) continue;
    out.push({
      viagem_id: v.id, viagem_titulo: v.titulo, data_retorno: v.data_retorno || v.data_embarque,
      cliente_id: p.cliente.id, cliente_nome: p.cliente.nome, telefone: p.cliente.telefone,
      pesquisa: porChave.get(`${v.id}:${p.cliente.id}`) ?? null,
    });
  }
  return out;
}

// ── Recompra ────────────────────────────────────────────────────────────────

export interface Recompra {
  id: string;
  cliente_id: string;
  viagem_id: string | null;
  lead_id: string | null;
  interesse: string | null;
  criado_por: string | null;
  criado_em: string;
}

export interface CandidatoRecompra {
  cliente_id: string;
  nome: string;
  telefone: string | null;
  ultima_viagem: { id: string; titulo: string; data_retorno: string | null };
  dias_desde_volta: number;
  nota: number | null;
  proximo_destino: string | null;
  recompras: Recompra[];
  /** 0 = NPS 9–10 com próximo destino · 1 = NPS 9–10 · 2 = sem pesquisa · 3 = neutro · 9 = detrator */
  prioridade: number;
}

const DIA = 86_400_000;

/**
 * Quem está pronto pra próxima viagem: voltou há 30–400 dias e não tem outra
 * viagem ativa marcada pela frente. A ordem é a do bom senso comercial: quem
 * amou e já disse pra onde quer ir primeiro; detrator vai pra seção à parte.
 */
export async function candidatosRecompra(): Promise<CandidatoRecompra[]> {
  const hoje = new Date();
  const de = new Date(hoje.getTime() - 400 * DIA).toISOString().slice(0, 10);
  const ate = new Date(hoje.getTime() - 30 * DIA).toISOString().slice(0, 10);

  const { data: voltaram, error } = await supabase
    .from("rel_viagens").select("id, titulo, data_retorno, data_embarque")
    .eq("status", "ativa").gte("data_retorno", de).lte("data_retorno", ate).limit(1000);
  if (error) throw error;
  const vIds = (voltaram ?? []).map((v: { id: string }) => v.id);
  if (!vIds.length) return [];

  const { data: pass } = await supabase
    .from("rel_viagem_passageiros").select("viagem_id, cliente:rel_clientes(id, nome, telefone, mesclado_em_id, optout_em)")
    .in("viagem_id", vIds);

  // A última viagem de cada cliente (entre as que voltaram na janela).
  const vMap = new Map((voltaram ?? []).map((v: { id: string; titulo: string; data_retorno: string | null; data_embarque: string | null }) => [v.id, v]));
  const porCliente = new Map<string, { nome: string; telefone: string | null; v: { id: string; titulo: string; data_retorno: string | null } }>();
  for (const p of (pass ?? []) as unknown as { viagem_id: string; cliente: { id: string; nome: string; telefone: string | null; mesclado_em_id: string | null; optout_em: string | null } | null }[]) {
    if (!p.cliente || p.cliente.mesclado_em_id) continue;
    const v = vMap.get(p.viagem_id);
    if (!v) continue;
    const atual = porCliente.get(p.cliente.id);
    if (!atual || String(v.data_retorno) > String(atual.v.data_retorno)) {
      porCliente.set(p.cliente.id, { nome: p.cliente.nome, telefone: p.cliente.telefone, v: { id: v.id, titulo: v.titulo, data_retorno: v.data_retorno } });
    }
  }
  const cIds = [...porCliente.keys()];
  if (!cIds.length) return [];

  // Quem já tem viagem futura ativa fica de fora.
  const hojeIso = hoje.toISOString().slice(0, 10);
  const [{ data: futuras }, { data: pesq }, { data: recs }] = await Promise.all([
    supabase.from("rel_viagem_passageiros").select("cliente_id, viagem:rel_viagens!inner(status, data_embarque)")
      .in("cliente_id", cIds).eq("viagem.status", "ativa").gte("viagem.data_embarque", hojeIso),
    supabase.from("rel_pesquisas").select("cliente_id, nota, proximo_destino, respondida_em")
      .in("cliente_id", cIds).not("respondida_em", "is", null).order("respondida_em", { ascending: false }),
    supabase.from("rel_recompras").select("*").in("cliente_id", cIds).order("criado_em", { ascending: false }),
  ]);
  const comFutura = new Set(((futuras ?? []) as { cliente_id: string }[]).map((x) => x.cliente_id));
  const ultimaPesq = new Map<string, { nota: number | null; proximo_destino: string | null }>();
  for (const p of (pesq ?? []) as { cliente_id: string; nota: number | null; proximo_destino: string | null }[]) {
    if (!ultimaPesq.has(p.cliente_id)) ultimaPesq.set(p.cliente_id, p);
  }
  const recsPor = new Map<string, Recompra[]>();
  for (const r of (recs ?? []) as Recompra[]) recsPor.set(r.cliente_id, [...(recsPor.get(r.cliente_id) ?? []), r]);

  const out: CandidatoRecompra[] = [];
  for (const [id, c] of porCliente) {
    if (comFutura.has(id)) continue;
    const p = ultimaPesq.get(id);
    const nota = p?.nota ?? null;
    const prioridade = nota == null ? 2 : nota >= 9 ? (p?.proximo_destino ? 0 : 1) : nota >= 7 ? 3 : 9;
    out.push({
      cliente_id: id, nome: c.nome, telefone: c.telefone, ultima_viagem: c.v,
      dias_desde_volta: c.v.data_retorno ? Math.floor((hoje.getTime() - new Date(c.v.data_retorno + "T12:00:00").getTime()) / DIA) : 0,
      nota, proximo_destino: p?.proximo_destino ?? null, recompras: recsPor.get(id) ?? [], prioridade,
    });
  }
  return out.sort((a, b) => a.prioridade - b.prioridade || a.dias_desde_volta - b.dias_desde_volta);
}

export async function recomprasDoCliente(clienteId: string): Promise<Recompra[]> {
  const { data } = await supabase.from("rel_recompras").select("*").eq("cliente_id", clienteId).order("criado_em", { ascending: false });
  return (data ?? []) as Recompra[];
}

/** Cria a oportunidade no Comercial (servidor). Erro 409 = já existe uma nos últimos 30 dias. */
export async function criarRecompra(clienteId: string, interesse: string, viagemId?: string | null): Promise<{ leadId: string; dono: string | null; jaExistia?: boolean }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/rel-recompra", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ clienteId, viagemId: viagemId || null, interesse }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as { leadId: string; dono: string | null; jaExistia?: boolean };
}

// ── Chamados ────────────────────────────────────────────────────────────────

export type Prioridade = "baixa" | "normal" | "alta" | "urgente";
export type StatusChamado = "aberto" | "em_andamento" | "aguardando" | "resolvido";

export const PRIORIDADES: Record<Prioridade, { rotulo: string; horas: number }> = {
  urgente: { rotulo: "Urgente", horas: 4 },
  alta: { rotulo: "Alta", horas: 24 },
  normal: { rotulo: "Normal", horas: 72 },
  baixa: { rotulo: "Baixa", horas: 168 },
};

export const STATUS_CHAMADO: Record<StatusChamado, string> = {
  aberto: "Aberto",
  em_andamento: "Em andamento",
  aguardando: "Aguardando cliente/fornecedor",
  resolvido: "Resolvido",
};

export interface Chamado {
  id: string;
  numero: number;
  cliente_id: string | null;
  viagem_id: string | null;
  conversa_id: string | null;
  assunto: string;
  descricao: string | null;
  prioridade: Prioridade;
  prazo: string | null;
  status: StatusChamado;
  responsavel_id: string | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
  resolvido_em: string | null;
  resolucao: string | null;
  cliente?: { nome: string } | null;
  viagem?: { titulo: string } | null;
  responsavel?: { name: string } | null;
}

export type ChamadoInput = Partial<Pick<Chamado, "cliente_id" | "viagem_id" | "conversa_id" | "descricao" | "prazo" | "responsavel_id" | "resolucao">> & {
  assunto: string; prioridade: Prioridade; status?: StatusChamado;
};

const SELECT_CHAMADO = "*, cliente:rel_clientes(nome), viagem:rel_viagens(titulo), responsavel:qs_users!rel_chamados_responsavel_id_fkey(name)";

export type FiltroChamado = "abertos" | "meus" | "vencidos" | "resolvidos";

export async function listarChamados(filtro: FiltroChamado, meuId: string): Promise<Chamado[]> {
  let q = supabase.from("rel_chamados").select(SELECT_CHAMADO).limit(300);
  if (filtro === "resolvidos") q = q.eq("status", "resolvido").order("resolvido_em", { ascending: false });
  else {
    q = q.neq("status", "resolvido").order("prazo", { ascending: true, nullsFirst: false });
    if (filtro === "meus") q = q.eq("responsavel_id", meuId);
    if (filtro === "vencidos") q = q.lt("prazo", new Date().toISOString());
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Chamado[];
}

export async function chamadosDoCliente(clienteId: string): Promise<Chamado[]> {
  const { data } = await supabase.from("rel_chamados").select(SELECT_CHAMADO).eq("cliente_id", clienteId).order("criado_em", { ascending: false }).limit(50);
  return (data ?? []) as Chamado[];
}

export async function salvarChamado(c: ChamadoInput, id?: string): Promise<Chamado> {
  const corpo: Record<string, unknown> = {
    assunto: c.assunto.trim(),
    descricao: c.descricao?.trim() || null,
    prioridade: c.prioridade,
    prazo: c.prazo || null,
    cliente_id: c.cliente_id || null,
    viagem_id: c.viagem_id || null,
    conversa_id: c.conversa_id || null,
    responsavel_id: c.responsavel_id || null,
  };
  if (c.status) {
    corpo.status = c.status;
    corpo.resolvido_em = c.status === "resolvido" ? new Date().toISOString() : null;
    if (c.status === "resolvido") corpo.resolucao = c.resolucao?.trim() || null;
  }
  const res = id
    ? await supabase.from("rel_chamados").update(corpo).eq("id", id).select(SELECT_CHAMADO).single()
    : await supabase.from("rel_chamados").insert(corpo).select(SELECT_CHAMADO).single();
  if (res.error) throw new Error(res.error.message);
  return res.data as Chamado;
}

export async function resolverChamado(id: string, resolucao: string) {
  const { error } = await supabase.from("rel_chamados")
    .update({ status: "resolvido", resolvido_em: new Date().toISOString(), resolucao: resolucao.trim() || null }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Quem pode ser responsável: admin, ou quem tem o setor Relacionamento. */
export async function equipeRelacionamento(): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("qs_users").select("id, name, role, setores, is_active").eq("is_active", true).order("name");
  return ((data ?? []) as { id: string; name: string; role: string; setores: string[] | null }[])
    .filter((u) => u.role === "admin" || u.role === "relacionamento" || (u.setores ?? []).includes("relacionamento"))
    .map((u) => ({ id: u.id, name: u.name }));
}

/** O prazo como o time lê: vencido, vence hoje, ou a data. */
export function situacaoDoPrazo(prazo: string | null, status: StatusChamado): { texto: string; tom: "erro" | "aviso" | "neutro" } {
  if (!prazo) return { texto: "sem prazo", tom: "neutro" };
  const d = new Date(prazo);
  const quando = d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  if (status === "resolvido") return { texto: quando, tom: "neutro" };
  if (d.getTime() < Date.now()) return { texto: `venceu ${quando}`, tom: "erro" };
  if (d.toDateString() === new Date().toDateString()) return { texto: `vence hoje ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, tom: "aviso" };
  return { texto: quando, tom: "neutro" };
}

/** datetime-local ↔ ISO (o input não aceita o "Z"). */
export function paraInputLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const deInputLocal = (v: string) => (v ? new Date(v).toISOString() : null);
