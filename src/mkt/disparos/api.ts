// src/mkt/disparos/api.ts
// -----------------------------------------------------------------------------
// O lado da tela do Marketing (0242).
//   • Base de contatos (mkt_*): lê e escreve DIRETO no banco — a RLS da 0242
//     deixa o Marketing mexer só nas tabelas mkt_*.
//   • Disparo, agendamento, recorrência e sequência: pela rota /api/disparos
//     (service_role), o mesmo motor do Comercial e do Rel, setor "marketing".
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { ContatoImportado } from "./regras";
import type { MapaVariaveis, Publico } from "@/lib/qs/disparos";

// ── Tipos da base ───────────────────────────────────────────────────────────

export interface Contato {
  id: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  origem: string | null;
  tags: string[];
  campos: Record<string, string>;
  score: number;
  optout_whatsapp_em: string | null;
  optout_email_em: string | null;
  lead_ref: string | null;
  rel_cliente_id: string | null;
  criado_em: string;
  atualizado_em: string;
}
export interface Lista { id: string; nome: string; descricao: string | null; criado_em: string; total?: number }
export interface EventoContato { id: number; contato_id: string; tipo: string; dados: Record<string, unknown>; criado_em: string }

/** Público do Marketing: base de contatos (padrão), leads ou clientes do QS. */
export type FontePublico = "contatos" | "leads" | "clientes";
export type PublicoMkt = Publico & {
  fonte?: FontePublico;
  listas?: string[];
  tags_modo?: "qualquer" | "todas";
  sem_tags?: string[];
  origens?: string[];
  criado_de?: string;
  criado_ate?: string;
  score_min?: number;
};

const erro = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

// ── Contatos ────────────────────────────────────────────────────────────────

export interface FiltroContatos { busca?: string; lista?: string; tag?: string; optout?: "" | "sim" | "nao"; pagina?: number }
export const POR_PAGINA = 50;

export async function listarContatos(f: FiltroContatos): Promise<{ linhas: Contato[]; total: number }> {
  const de = (f.pagina ?? 0) * POR_PAGINA;
  let q = f.lista
    ? supabase.from("mkt_contatos").select("*, mkt_lista_contatos!inner(lista_id)", { count: "exact" }).eq("mkt_lista_contatos.lista_id", f.lista)
    : supabase.from("mkt_contatos").select("*", { count: "exact" });
  const b = (f.busca ?? "").trim();
  if (b) {
    const dig = b.replace(/\D/g, "");
    const seguro = b.replace(/[,()*%]/g, " ");
    q = q.or([`nome.ilike.*${seguro}*`, `email.ilike.*${seguro.toLowerCase()}*`, ...(dig.length >= 4 ? [`telefone.like.*${dig}*`] : [])].join(","));
  }
  if (f.tag) q = q.contains("tags", [f.tag]);
  if (f.optout === "sim") q = q.not("optout_whatsapp_em", "is", null);
  if (f.optout === "nao") q = q.is("optout_whatsapp_em", null);
  const { data, count, error } = await q.order("criado_em", { ascending: false }).range(de, de + POR_PAGINA - 1);
  erro(error);
  return { linhas: ((data ?? []) as (Contato & { mkt_lista_contatos?: unknown })[]).map(({ mkt_lista_contatos: _x, ...c }) => c as Contato), total: count ?? 0 };
}

export async function lerContato(id: string) {
  const [c, ev, ls] = await Promise.all([
    supabase.from("mkt_contatos").select("*").eq("id", id).single(),
    supabase.from("mkt_contato_eventos").select("*").eq("contato_id", id).order("criado_em", { ascending: false }).limit(200),
    supabase.from("mkt_lista_contatos").select("lista_id").eq("contato_id", id),
  ]);
  erro(c.error); erro(ev.error); erro(ls.error);
  return { contato: c.data as Contato, eventos: (ev.data ?? []) as EventoContato[], listas: ((ls.data ?? []) as { lista_id: string }[]).map((x) => x.lista_id) };
}

export async function salvarContato(id: string | null, c: Partial<Pick<Contato, "nome" | "telefone" | "email" | "tags" | "campos" | "origem">>) {
  const r = id
    ? await supabase.from("mkt_contatos").update(c).eq("id", id).select().single()
    : await supabase.from("mkt_contatos").insert({ origem: "manual", ...c }).select().single();
  if (r.error?.code === "23505") throw new Error("Já existe um contato com esse telefone ou e-mail.");
  erro(r.error);
  return r.data as Contato;
}

/** Opt-out manual (o "PARAR" pelo WhatsApp o servidor marca sozinho). */
export async function mudarOptout(id: string, canal: "whatsapp" | "email", sair: boolean) {
  const col = canal === "whatsapp" ? "optout_whatsapp_em" : "optout_email_em";
  const { error } = await supabase.from("mkt_contatos").update({ [col]: sair ? new Date().toISOString() : null }).eq("id", id);
  erro(error);
}

export async function apagarContatos(ids: string[]) {
  const { error } = await supabase.from("mkt_contatos").delete().in("id", ids);
  erro(error);
}

export async function anotar(contatoId: string, texto: string) {
  const { error } = await supabase.from("mkt_contato_eventos").insert({ contato_id: contatoId, tipo: "nota", dados: { texto } });
  erro(error);
}

/** Acrescenta (ou tira) tags de vários contatos de uma vez. */
export async function mudarTags(ids: string[], acrescentar: string[], tirar: string[] = []) {
  const { data, error } = await supabase.from("mkt_contatos").select("id, tags").in("id", ids);
  erro(error);
  for (const c of (data ?? []) as { id: string; tags: string[] }[]) {
    const novas = [...new Set([...(c.tags ?? []).filter((t) => !tirar.includes(t)), ...acrescentar])];
    const r = await supabase.from("mkt_contatos").update({ tags: novas }).eq("id", c.id);
    erro(r.error);
  }
}

export async function tagsEmUso(): Promise<{ tag: string; n: number }[]> {
  const { data, error } = await supabase.rpc("mkt_tags_em_uso");
  erro(error);
  return (data ?? []) as { tag: string; n: number }[];
}

export interface ResultadoImportacao { novos: number; atualizados: number; ignorados: number; conflitos: number; exemplos_conflito: { telefone: string | null; email: string | null }[] }

/** Importa em lotes de 500 (a função do banco aceita até 2000). */
export async function importarContatos(contatos: ContatoImportado[], opcoes: { lista?: string | null; tags?: string[]; origem?: string }, aoAndar?: (feitos: number) => void): Promise<ResultadoImportacao> {
  const total: ResultadoImportacao = { novos: 0, atualizados: 0, ignorados: 0, conflitos: 0, exemplos_conflito: [] };
  for (let i = 0; i < contatos.length; i += 500) {
    const { data, error } = await supabase.rpc("mkt_importar_contatos", {
      p_linhas: contatos.slice(i, i + 500), p_lista: opcoes.lista || null, p_tags: opcoes.tags ?? [], p_origem: opcoes.origem || "csv",
    });
    erro(error);
    const r = data as ResultadoImportacao;
    total.novos += r.novos; total.atualizados += r.atualizados; total.ignorados += r.ignorados; total.conflitos += r.conflitos;
    total.exemplos_conflito.push(...(r.exemplos_conflito ?? []));
    aoAndar?.(Math.min(contatos.length, i + 500));
  }
  return total;
}

// ── Listas ──────────────────────────────────────────────────────────────────

export async function listarListas(): Promise<Lista[]> {
  const { data, error } = await supabase.from("mkt_listas").select("*, mkt_lista_contatos(count)").order("nome");
  erro(error);
  return ((data ?? []) as (Lista & { mkt_lista_contatos?: { count: number }[] })[]).map(({ mkt_lista_contatos: c, ...l }) => ({ ...l, total: c?.[0]?.count ?? 0 }));
}
export async function salvarLista(id: string | null, nome: string, descricao: string | null) {
  const r = id ? await supabase.from("mkt_listas").update({ nome, descricao }).eq("id", id).select().single()
    : await supabase.from("mkt_listas").insert({ nome, descricao }).select().single();
  erro(r.error);
  return r.data as Lista;
}
export async function apagarLista(id: string) { const { error } = await supabase.from("mkt_listas").delete().eq("id", id); erro(error); }
export async function porNaLista(lista: string, ids: string[]) {
  const { error } = await supabase.from("mkt_lista_contatos").upsert(ids.map((contato_id) => ({ lista_id: lista, contato_id })), { onConflict: "lista_id,contato_id", ignoreDuplicates: true });
  erro(error);
}
export async function tirarDaLista(lista: string, ids: string[]) {
  const { error } = await supabase.from("mkt_lista_contatos").delete().eq("lista_id", lista).in("contato_id", ids);
  erro(error);
}

// ── Rota do disparo (setor marketing) ───────────────────────────────────────

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/disparos", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ setor: "marketing", ...corpo }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as T;
}

export const agendar = (campanhaId: string, quando: string) => chamar<{ ok: true }>({ acao: "agendar", campanhaId, agendada_para: quando });
export const desagendar = (campanhaId: string) => chamar<{ ok: true }>({ acao: "desagendar", campanhaId });
export const salvarNumero = (phone_number_id: string, numero: string) => chamar<{ ok: true }>({ acao: "mkt_salvar_numero", phone_number_id, numero });
export const conferirNumero = () => chamar<{ ok: boolean; motivo?: string; numero?: Record<string, unknown> }>({ acao: "mkt_conferir_numero" });

export interface Recorrencia {
  id: string; nome: string; modelo_nome: string; modelo_idioma: string; params: MapaVariaveis; publico: PublicoMkt;
  dias_semana: number[]; hora: string; ativa: boolean; proxima_em: string | null; ultima_em: string | null; ultima_campanha_id: string | null;
}
export async function listarRecorrencias(): Promise<Recorrencia[]> {
  const { data, error } = await supabase.from("mkt_disparo_recorrencias").select("*").order("criado_em", { ascending: false });
  erro(error);
  return (data ?? []) as Recorrencia[];
}
export const salvarRecorrencia = (r: Partial<Recorrencia>) => chamar<{ ok: true }>({ acao: "mkt_recorrencia_salvar", recorrencia: r });
export const apagarRecorrencia = (id: string) => chamar<{ ok: true }>({ acao: "mkt_recorrencia_apagar", id });

export interface Passo { ordem?: number; dia_offset: number; hora: string; modelo_nome: string; modelo_idioma: string; params: MapaVariaveis }
export interface Sequencia {
  id: string; nome: string; descricao: string | null; ativa: boolean; parar_se_responder: boolean; lista_gatilho_id: string | null;
  passos: Passo[]; contagem?: Record<string, number>;
}
export async function listarSequencias(): Promise<Sequencia[]> {
  const [s, p, i] = await Promise.all([
    supabase.from("mkt_disparo_sequencias").select("*").order("criado_em", { ascending: false }),
    supabase.from("mkt_disparo_sequencia_passos").select("*").order("ordem"),
    supabase.from("mkt_disparo_sequencia_inscricoes").select("sequencia_id, status").limit(20000),
  ]);
  erro(s.error); erro(p.error); erro(i.error);
  const passos = (p.data ?? []) as (Passo & { sequencia_id: string })[];
  const cont = new Map<string, Record<string, number>>();
  for (const x of (i.data ?? []) as { sequencia_id: string; status: string }[]) {
    const c = cont.get(x.sequencia_id) ?? {}; c[x.status] = (c[x.status] ?? 0) + 1; cont.set(x.sequencia_id, c);
  }
  return ((s.data ?? []) as Sequencia[]).map((x) => ({ ...x, passos: passos.filter((q) => q.sequencia_id === x.id), contagem: cont.get(x.id) ?? {} }));
}
export interface Inscricao { id: string; nome: string | null; telefone: string; status: string; motivo: string | null; proximo_passo: number; proximo_em: string | null; inicio_em: string }
export async function listarInscricoes(sequenciaId: string): Promise<Inscricao[]> {
  const { data, error } = await supabase.from("mkt_disparo_sequencia_inscricoes").select("id, nome, telefone, status, motivo, proximo_passo, proximo_em, inicio_em")
    .eq("sequencia_id", sequenciaId).order("inicio_em", { ascending: false }).limit(300);
  erro(error);
  return (data ?? []) as Inscricao[];
}
export const salvarSequencia = (s: Partial<Sequencia>) => chamar<{ ok: true; id: string }>({ acao: "mkt_sequencia_salvar", sequencia: s });
export const ativarSequencia = (id: string, ativa: boolean) => chamar<{ ok: true }>({ acao: "mkt_sequencia_ativar", id, ativa });
export const apagarSequencia = (id: string) => chamar<{ ok: true }>({ acao: "mkt_sequencia_apagar", id });
export const inscreverNaSequencia = (id: string, publico: PublicoMkt, soPrevia = false) =>
  chamar<{ ok?: true; inscritos?: number; total: number; excluidos?: { motivo: string; n: number }[] }>({ acao: "mkt_sequencia_inscrever", id, publico, soPrevia });
export const tirarInscricao = (id: string) => chamar<{ ok: true }>({ acao: "mkt_inscricao_tirar", id });

// ── Rótulos da linha do tempo ───────────────────────────────────────────────

export const ROTULO_EVENTO: Record<string, string> = {
  criado: "Entrou na base", importado: "Atualizado por importação", nota: "Nota",
  optout_whatsapp: "Pediu pra não receber WhatsApp", optin_whatsapp: "Voltou a receber WhatsApp",
  optout_email: "Pediu pra não receber e-mail", optin_email: "Voltou a receber e-mail",
  entrou_lista: "Entrou na lista", saiu_lista: "Saiu da lista",
  disparo_enviado: "Recebeu disparo", disparo_entregue: "Disparo entregue", disparo_lido: "Leu o disparo", disparo_erro: "Disparo não entregue",
  respondeu: "Respondeu no WhatsApp", sequencia_entrou: "Entrou numa sequência", sequencia_saiu: "Saiu de uma sequência",
};
