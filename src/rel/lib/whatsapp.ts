// src/rel/lib/whatsapp.ts
// -----------------------------------------------------------------------------
// WhatsApp do Relacionamento (Fase 2 — migrations 0101/0102).
//
// Ler (fila, mensagens, relatório) vai direto no banco, protegido pela RLS.
// ENVIAR passa sempre pelo servidor (/api/rel-wa): é ele que tem o token da
// Meta, confere a janela de 24h e assina com o nome de quem está logado.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { arquivoParaBase64 } from "@/lib/qs/modeloCampos";

export type EstadoConversa = "aberta" | "aguardando_cliente" | "resolvida";

export interface Conversa {
  id: string;
  phone_number_id: string;
  telefone: string;
  nome_contato: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  atendente_id: string | null;
  atendente_nome: string | null;
  estado: EstadoConversa;
  aguardando_desde: string | null;
  ultima_entrada_em: string | null;
  ultima_saida_em: string | null;
  ultima_mensagem: string | null;
  nao_lidas: number;
  atualizado_em: string;
  minutos_esperando: number;
  meta_min: number;
  janela_aberta: boolean;
  /** "Não conta no prazo" (0113): grupo, fornecedor, equipe… — fora do SLA. */
  sem_sla?: boolean;
  sem_sla_motivo?: string | null;
  // Da pessoa logada (0121) — cada um organiza a sua lista.
  fixada_em?: string | null;
  favorita?: boolean;
  arquivada?: boolean;
  silenciada?: boolean;
  marcada_nao_lida?: boolean;
  // Do time (0121).
  etiquetas?: string[];
  listas?: string[];
  /** Com quem está a conversa (0127): o Financeiro fala pelo mesmo número. */
  setor?: "relacionamento" | "financeiro";
  setor_desde?: string | null;
}

export interface Anexo { type: "image" | "video" | "audio" | "file"; url: string; nome?: string }

export interface Mensagem {
  id: string;
  conversa_id: string;
  wamid: string;
  direcao: "in" | "out";
  origem: "cliente" | "qs" | "celular" | "automatica" | "historico";
  texto: string;
  anexos: Anexo[];
  autor_id: string | null;
  autor_nome: string | null;
  status: "sent" | "delivered" | "read" | "failed" | null;
  respondendo_a: string | null;
  enviada_em: string;
  /** de = 'cliente' | 'celular' | id de quem reagiu no QS. */
  reacoes?: { de: string; nome: string | null; emoji: string; em?: string }[];
  fixada_em?: string | null;
}

export interface Modelo {
  nome: string;
  idioma: string;
  corpo: string;
  variaveis: string[];
  precisaMidia?: boolean;
  /** IMAGE | VIDEO | DOCUMENT | TEXT — o que vai no topo. */
  headerFormato?: string;
  /** Exemplo de cada variável, na ordem (o que foi pra Meta aprovar). */
  exemplos?: string[];
  categoria?: string;
}

export interface Resposta { id: string; titulo: string; texto: string; atalho?: string | null; categoria?: string | null }

export interface ConfigRel {
  horario: { dias: number[]; inicio: string; fim: string; feriados?: string[] };
  sla: { resposta_min: number };
  fora_horario: { ativo: boolean; texto: string };
  assinatura: { ativo: boolean };
}

export interface NumeroRel { conectado: boolean; numero: string | null; nome: string | null; status: string | null }

// ── Leitura ─────────────────────────────────────────────────────────────────

export type Filtro = "esperando" | "minhas" | "abertas" | "resolvidas" | "todas";

export async function listarConversas(filtro: Filtro, meuId: string, busca = "", setor?: "relacionamento" | "financeiro"): Promise<Conversa[]> {
  let q = supabase.from("rel_wa_fila").select("*").limit(500);
  if (setor) q = q.eq("setor", setor);
  if (filtro === "esperando") q = q.not("aguardando_desde", "is", null).order("aguardando_desde", { ascending: true });
  else if (filtro === "minhas") q = q.eq("atendente_id", meuId).neq("estado", "resolvida").order("atualizado_em", { ascending: false });
  else if (filtro === "abertas") q = q.neq("estado", "resolvida").order("atualizado_em", { ascending: false });
  else if (filtro === "resolvidas") q = q.eq("estado", "resolvida").order("atualizado_em", { ascending: false });
  else q = q.order("atualizado_em", { ascending: false });
  const t = busca.replace(/[,()*%\\:"']/g, " ").trim();
  if (t) {
    const d = t.replace(/\D/g, "");
    q = d.length >= 4 && d.length === t.replace(/[\s.\-()+]/g, "").length
      ? q.ilike("telefone", `*${d}*`)
      : q.or(`nome_contato.ilike.*${t}*,cliente_nome.ilike.*${t}*,ultima_mensagem.ilike.*${t}*`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Conversa[];
}

export async function carregarConversa(id: string): Promise<Conversa | null> {
  const { data, error } = await supabase.from("rel_wa_fila").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Conversa | null;
}

export async function conversasDoCliente(clienteId: string): Promise<Conversa[]> {
  const { data } = await supabase.from("rel_wa_fila").select("*").eq("cliente_id", clienteId).order("atualizado_em", { ascending: false });
  return (data ?? []) as Conversa[];
}

export async function carregarMensagens(conversaId: string): Promise<Mensagem[]> {
  // As 300 mais recentes, em ordem de leitura.
  const { data, error } = await supabase
    .from("rel_wa_mensagens").select("*")
    .eq("conversa_id", conversaId).order("enviada_em", { ascending: false }).limit(300);
  if (error) throw error;
  return ((data ?? []) as Mensagem[]).reverse();
}

export async function contarEsperando(): Promise<{ esperando: number; foraDoPrazo: number }> {
  const { data } = await supabase.from("rel_wa_fila").select("minutos_esperando, meta_min").not("aguardando_desde", "is", null).eq("sem_sla", false).eq("setor", "relacionamento");
  const l = (data ?? []) as { minutos_esperando: number; meta_min: number }[];
  return { esperando: l.length, foraDoPrazo: l.filter((x) => x.minutos_esperando > x.meta_min).length };
}

// ── Mudanças de atendimento (direto no banco; a RLS libera só estas colunas) ──

async function mudar(id: string, campos: Record<string, unknown>) {
  const { error } = await supabase.from("rel_wa_conversas").update(campos).eq("id", id);
  if (error) throw new Error(error.message);
}

export const assumirConversa = (id: string, userId: string) => mudar(id, { atendente_id: userId });
export const passarConversa = (id: string, userId: string | null) => mudar(id, { atendente_id: userId });
/** Resolver encerra a espera SEM contar como resposta (ex.: o cliente só agradeceu). */
export const resolverConversa = (id: string) => mudar(id, { estado: "resolvida", aguardando_desde: null, nao_lidas: 0 });
export const reabrirConversa = (id: string) => mudar(id, { estado: "aguardando_cliente" });
export const ligarAoCliente = (id: string, clienteId: string | null) => mudar(id, { cliente_id: clienteId });

// ── "Não conta no prazo" (0113) ─────────────────────────────────────────────
// Grupos, fornecedores, equipe interna… não entram no prazo de resposta. Marcar
// também apaga as medições antigas da conversa (o banco faz) — os KPIs ficam
// limpos. Grupo de WhatsApp já nasce marcado.

export const MOTIVOS_SEM_SLA: Record<string, string> = {
  grupo: "Grupo",
  fornecedor: "Fornecedor",
  equipe: "Equipe interna",
  teste: "Teste",
  pessoal: "Pessoal",
  outro: "Outro",
};

export async function marcarSemSla(id: string, sem: boolean, motivo?: string) {
  const { error } = await supabase.rpc("rel_conversa_sem_sla", { p_conversa: id, p_sem: sem, p_motivo: motivo ?? null });
  if (error) throw new Error(error.message);
}

// ── Envio (servidor) ────────────────────────────────────────────────────────

async function api<T = Record<string, unknown>>(metodo: "GET" | "POST", corpoOuQuery: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const url = metodo === "GET"
    ? `/api/rel-wa?${new URLSearchParams(Object.entries(corpoOuQuery).map(([k, v]) => [k, String(v)]))}`
    : "/api/rel-wa";
  const r = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${session.access_token}`, ...(metodo === "POST" ? { "Content-Type": "application/json" } : {}) },
    body: metodo === "POST" ? JSON.stringify(corpoOuQuery) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as T;
}

export const statusDoNumero = () => api<NumeroRel>("GET", { numero: 1 });
export const listarModelos = () => api<{ modelos: Modelo[] }>("GET", { modelos: 1 }).then((r) => r.modelos || []);
export const enviarTexto = (conversaId: string, texto: string, respondendoA?: string | null) =>
  api("POST", { acao: "texto", conversaId, texto, respondendoA: respondendoA || null });
/** Arquivo do topo do modelo (imagem/vídeo/PDF) → o formato que o rel-wa espera. */
async function anexoDoTopo(arquivo?: File | null) {
  if (!arquivo) return {};
  if (arquivo.size > 3 * 1024 * 1024) throw new Error("O arquivo do topo passa de 3 MB.");
  return { arquivo: { fileName: arquivo.name, mimeType: arquivo.type, dataBase64: await arquivoParaBase64(arquivo) } };
}
export const enviarModelo = async (alvo: { conversaId?: string; clienteId?: string }, modelo: { nome: string; idioma: string; params: Record<string, string> }, arquivo?: File | null) =>
  api<{ conversaId?: string }>("POST", { acao: "modelo", ...alvo, modelo, ...(await anexoDoTopo(arquivo)) });
export const marcarLida = (conversaId: string) => api("POST", { acao: "lida", conversaId }).catch(() => undefined);
/** Começa conversa com um número que ainda não escreveu (só modelo aprovado). */
export const enviarModeloParaTelefone = async (telefone: string, modelo: { nome: string; idioma: string; params: Record<string, string> }, arquivo?: File | null) =>
  api<{ conversaId?: string }>("POST", { acao: "modelo", telefone, modelo, ...(await anexoDoTopo(arquivo)) });
export const reagir = (conversaId: string, mensagemId: string, emoji: string) => api("POST", { acao: "reacao", conversaId, mensagemId, emoji });
export const encaminhar = (mensagemId: string, conversaIds: string[]) =>
  api<{ ok: boolean; resultado: { conversaId: string; ok: boolean; erro?: string }[] }>("POST", { acao: "encaminhar", mensagemId, conversaIds });
export const enviarFigurinha = (conversaId: string, f: { figurinhaId?: string; url?: string }) => api("POST", { acao: "figurinha", conversaId, ...f });

// ── Figurinhas do time (0121) ───────────────────────────────────────────────

export interface Figurinha { id: string; url: string; animada: boolean; criado_por: string | null; criado_em: string }

export async function listarFigurinhas(): Promise<Figurinha[]> {
  const { data, error } = await supabase.from("rel_wa_figurinhas").select("*").order("criado_em", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as Figurinha[];
}
/** Guarda na biblioteca: um WEBP novo (base64) ou uma figurinha que chegou (url do QS). */
export const salvarFigurinha = (f: { dataBase64?: string; url?: string; animada?: boolean }) =>
  api<{ figurinha: Figurinha | null }>("POST", { acao: "figurinha-salvar", ...f });
export async function apagarFigurinha(id: string) {
  const { error } = await supabase.from("rel_wa_figurinhas").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Organização da lista (0121) ─────────────────────────────────────────────
// Fixar/favoritar/arquivar/silenciar/não lida: cada pessoa tem a sua.

export type PrefConversa = Partial<Pick<Conversa, "fixada_em" | "favorita" | "arquivada" | "silenciada" | "marcada_nao_lida">>;

export async function mudarPreferencia(conversaId: string, userId: string, campos: PrefConversa) {
  const { error } = await supabase.from("rel_wa_conversa_usuario")
    .upsert({ conversa_id: conversaId, user_id: userId, ...campos, atualizado_em: new Date().toISOString() }, { onConflict: "conversa_id,user_id" });
  if (error) throw new Error(error.message);
}

/** Quantas conversas EU fixei (direto no banco — a lista da tela pode estar filtrada). */
export async function contarFixadas(userId: string): Promise<number> {
  const { count } = await supabase.from("rel_wa_conversa_usuario").select("conversa_id", { count: "exact", head: true })
    .eq("user_id", userId).not("fixada_em", "is", null).eq("arquivada", false);
  return count ?? 0;
}

export interface Etiqueta { id: string; nome: string; cor: string }
export interface Lista { id: string; nome: string }

export const CORES_ETIQUETA = ["#00A884", "#53BDEB", "#FFBC38", "#FF5C8A", "#A78BFA", "#F97316", "#64748B", "#EF4444"];

export async function listarEtiquetas(): Promise<Etiqueta[]> {
  const { data } = await supabase.from("rel_wa_etiquetas").select("id, nome, cor").order("nome");
  return (data ?? []) as Etiqueta[];
}
export async function criarEtiqueta(nome: string, cor: string): Promise<Etiqueta> {
  const { data, error } = await supabase.from("rel_wa_etiquetas").insert({ nome: nome.trim(), cor }).select("id, nome, cor").single();
  if (error) throw new Error(error.code === "23505" ? "Já existe uma etiqueta com esse nome." : error.message);
  return data as Etiqueta;
}
export async function apagarEtiqueta(id: string) {
  const { error } = await supabase.from("rel_wa_etiquetas").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
export async function etiquetarConversa(conversaId: string, etiquetaId: string, por: boolean) {
  const r = por
    ? await supabase.from("rel_wa_conversa_etiquetas").upsert({ conversa_id: conversaId, etiqueta_id: etiquetaId }, { onConflict: "conversa_id,etiqueta_id" })
    : await supabase.from("rel_wa_conversa_etiquetas").delete().eq("conversa_id", conversaId).eq("etiqueta_id", etiquetaId);
  if (r.error) throw new Error(r.error.message);
}

export async function listarListas(): Promise<Lista[]> {
  const { data } = await supabase.from("rel_wa_listas").select("id, nome").order("nome");
  return (data ?? []) as Lista[];
}
export async function criarLista(nome: string): Promise<Lista> {
  const { data, error } = await supabase.from("rel_wa_listas").insert({ nome: nome.trim() }).select("id, nome").single();
  if (error) throw new Error(error.code === "23505" ? "Já existe uma lista com esse nome." : error.message);
  return data as Lista;
}
export async function apagarLista(id: string) {
  const { error } = await supabase.from("rel_wa_listas").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
export async function porNaLista(conversaId: string, listaId: string, por: boolean) {
  const r = por
    ? await supabase.from("rel_wa_lista_conversas").upsert({ conversa_id: conversaId, lista_id: listaId }, { onConflict: "lista_id,conversa_id" })
    : await supabase.from("rel_wa_lista_conversas").delete().eq("conversa_id", conversaId).eq("lista_id", listaId);
  if (r.error) throw new Error(r.error.message);
}

// ── Mensagem: fixar (time) e favoritar (cada um) ────────────────────────────

export async function fixarMensagem(mensagemId: string, fixar: boolean) {
  const { error } = await supabase.rpc("rel_wa_fixar_mensagem", { p_msg: mensagemId, p_fixar: fixar });
  if (error) throw new Error(error.message);
}
/** Ids das mensagens que EU marquei com estrela (a RLS só devolve as minhas). */
export async function minhasFavoritas(): Promise<Set<string>> {
  const { data } = await supabase.from("rel_wa_mensagem_favoritas").select("mensagem_id").limit(2000);
  return new Set(((data ?? []) as { mensagem_id: string }[]).map((r) => r.mensagem_id));
}
/** As mensagens com estrela, com a conversa — pro painel "Favoritas". */
export async function mensagensFavoritas(): Promise<(Mensagem & { favoritada_em: string })[]> {
  const { data, error } = await supabase.from("rel_wa_mensagem_favoritas")
    .select("criado_em, rel_wa_mensagens(*)").order("criado_em", { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as { criado_em: string; rel_wa_mensagens: Mensagem | null }[])
    .filter((r) => r.rel_wa_mensagens)
    .map((r) => ({ ...(r.rel_wa_mensagens as Mensagem), favoritada_em: r.criado_em }));
}
export async function favoritarMensagem(mensagemId: string, por: boolean) {
  const r = por
    ? await supabase.from("rel_wa_mensagem_favoritas").upsert({ mensagem_id: mensagemId }, { onConflict: "mensagem_id,user_id" })
    : await supabase.from("rel_wa_mensagem_favoritas").delete().eq("mensagem_id", mensagemId);
  if (r.error) throw new Error(r.error.message);
}

export async function enviarArquivo(conversaId: string, arquivo: File, legenda?: string) {
  if (arquivo.size > 3 * 1024 * 1024) throw new Error("Arquivo maior que 3 MB.");
  const base64 = await new Promise<string>((ok, falha) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1] || "");
    fr.onerror = () => falha(new Error("Não consegui ler o arquivo."));
    fr.readAsDataURL(arquivo);
  });
  return api("POST", { acao: "arquivo", conversaId, fileName: arquivo.name, mimeType: arquivo.type, dataBase64: base64, legenda: legenda || "" });
}

// ── Respostas prontas ───────────────────────────────────────────────────────

export async function listarRespostas(): Promise<Resposta[]> {
  const { data } = await supabase.from("rel_wa_respostas").select("id, titulo, texto, atalho, categoria").order("titulo");
  return (data ?? []) as Resposta[];
}
export async function salvarResposta(r: { id?: string; titulo: string; texto: string; atalho?: string | null; categoria?: string | null }) {
  const campos = {
    titulo: r.titulo, texto: r.texto,
    atalho: r.atalho?.trim().replace(/^\//, "").toLowerCase() || null,
    categoria: r.categoria?.trim() || null,
  };
  const res = r.id
    ? await supabase.from("rel_wa_respostas").update(campos).eq("id", r.id).select("id")
    : await supabase.from("rel_wa_respostas").insert(campos);
  // UPDATE barrado pela RLS não dá erro: só não muda nenhuma linha.
  if (r.id && !res.error && !(res.data as unknown[] | null)?.length) throw new Error("Sem permissão pra mudar isso.");
  if (res.error) {
    if (res.error.code === "23505") throw new Error("Já existe uma resposta com esse atalho.");
    if (res.error.message.includes("row-level")) throw new Error("Só a gestora ou o admin do Relacionamento cria e muda as respostas prontas.");
    throw new Error(res.error.message);
  }
}
export async function apagarResposta(id: string) {
  const { error } = await supabase.from("rel_wa_respostas").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Variáveis da resposta pronta: {nome} = primeiro nome do cliente,
 * {nome_completo}, {atendente} = primeiro nome de quem está logado,
 * {saudacao} = Bom dia/Boa tarde/Boa noite.
 */
export function preencherResposta(texto: string, nome: string | null, atendente?: string | null) {
  const h = new Date().getHours();
  const saudacao = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  return texto
    .replace(/\{nome_completo\}/gi, (nome || "").trim())
    .replace(/\{nome\}/gi, (nome || "").trim().split(/\s+/)[0] || "")
    .replace(/\{atendente\}/gi, (atendente || "").trim().split(/\s+/)[0] || "")
    .replace(/\{saudacao\}/gi, saudacao);
}

// ── Bloco de notas particular (0121) — só o dono lê ─────────────────────────

export interface Nota {
  id: string;
  titulo: string;
  texto: string;
  cor: string | null;
  fixada: boolean;
  conversa_id: string | null;
  cliente_id: string | null;
  mensagem_id: string | null;
  /** Cópia da mensagem guardada. */
  mensagem: { texto: string; de: string; quando: string; anexos?: Anexo[] } | null;
  criado_em: string;
  atualizado_em: string;
}

export async function listarNotas(): Promise<Nota[]> {
  const { data, error } = await supabase.from("rel_notas").select("*")
    .order("fixada", { ascending: false }).order("atualizado_em", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as Nota[];
}
export async function salvarNota(n: Partial<Nota>): Promise<Nota> {
  const { id, criado_em, atualizado_em, ...campos } = n;
  void criado_em; void atualizado_em;
  const r = id
    ? await supabase.from("rel_notas").update(campos).eq("id", id).select("*").single()
    : await supabase.from("rel_notas").insert(campos).select("*").single();
  if (r.error) throw new Error(r.error.message);
  return r.data as Nota;
}
export async function apagarNota(id: string) {
  const { error } = await supabase.from("rel_notas").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
/** "Guardar no bloco de notas" a partir de uma mensagem da conversa. */
export function guardarMensagemNasNotas(m: Mensagem, conversa: { id: string; cliente_id: string | null }, de: string) {
  return salvarNota({
    titulo: `Mensagem de ${de}`,
    texto: "",
    conversa_id: conversa.id,
    cliente_id: conversa.cliente_id,
    mensagem_id: m.id,
    mensagem: { texto: m.texto || "", de, quando: m.enviada_em, anexos: m.anexos || [] },
  });
}

// ── Configuração ────────────────────────────────────────────────────────────

export async function carregarConfig(): Promise<ConfigRel> {
  const { data } = await supabase.from("rel_config").select("chave, valor");
  const m = Object.fromEntries(((data ?? []) as { chave: string; valor: unknown }[]).map((r) => [r.chave, r.valor]));
  return {
    horario: { dias: [1, 2, 3, 4, 5], inicio: "09:00", fim: "18:00", feriados: [], ...(m.horario as object) },
    sla: { resposta_min: 30, ...(m.sla as object) },
    fora_horario: { ativo: false, texto: "", ...(m.fora_horario as object) },
    assinatura: { ativo: true, ...(m.assinatura as object) },
  };
}

export async function salvarConfig(chave: keyof ConfigRel, valor: unknown) {
  const { error } = await supabase.from("rel_config").update({ valor, atualizado_em: new Date().toISOString() }).eq("chave", chave);
  if (error) throw new Error(error.message.includes("row-level") ? "Só admin ou gestor do Relacionamento muda a configuração." : error.message);
}

// ── Relatório de prazo ──────────────────────────────────────────────────────

export interface LinhaSla { atendente_id: string | null; minutos_uteis: number; meta_min: number; dentro_do_prazo: boolean; respondido_em: string }

export async function carregarSla(desdeDias: number): Promise<LinhaSla[]> {
  const desde = new Date(Date.now() - desdeDias * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("rel_wa_sla").select("atendente_id, minutos_uteis, meta_min, dentro_do_prazo, respondido_em")
    .gte("respondido_em", desde).order("respondido_em", { ascending: false }).limit(1000);
  if (error) throw error;
  return (data ?? []) as LinhaSla[];
}

// ── Formatação ──────────────────────────────────────────────────────────────

export function duracao(min: number): string {
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function horaCurta(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const ontem = new Date(hoje.getTime() - 86_400_000);
  if (d.toDateString() === ontem.toDateString()) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
