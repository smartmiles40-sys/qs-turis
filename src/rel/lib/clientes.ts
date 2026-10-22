// src/rel/lib/clientes.ts
// -----------------------------------------------------------------------------
// Ficha única do cliente (Relacionamento, Fase 1 — migration 0100).
//
// Regra de ouro: uma pessoa = uma ficha. CPF e passaporte o banco recusa
// repetir; telefone e e-mail podem repetir (família divide celular), então a
// tela AVISA antes de criar. Quem normaliza de verdade é o banco (gatilho) —
// as funções daqui só deixam bonito na tela e validam antes de enviar.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

export type Parentesco = "conjuge" | "filho" | "pai_mae" | "irmao" | "neto" | "amigo" | "outro";

export const PARENTESCOS: Record<Parentesco, string> = {
  conjuge: "Cônjuge",
  filho: "Filho(a)",
  pai_mae: "Pai / Mãe",
  irmao: "Irmão(ã)",
  neto: "Neto(a)",
  amigo: "Amigo(a)",
  outro: "Outro",
};

export interface Cliente {
  id: string;
  nome: string;
  cpf: string | null;
  passaporte: string | null;
  passaporte_validade: string | null;
  nascimento: string | null;
  telefone: string | null;
  email: string | null;
  titular_id: string | null;
  parentesco: Parentesco | null;
  bitrix_contato_id: string | null;
  observacoes: string | null;
  lgpd_consentimento_em: string | null;
  mesclado_em_id: string | null;
  /** 0119: não é cliente (fica fora das listas e dos KPIs; dá pra desarquivar). */
  arquivado_em?: string | null;
  arquivado_motivo?: string | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_por: string | null;
  atualizado_em: string;
}

export type ClienteInput = Partial<Omit<Cliente, "id" | "criado_em" | "atualizado_em" | "criado_por" | "atualizado_por" | "mesclado_em_id">> & { nome: string };

export interface Parecido {
  id: string;
  nome: string;
  motivo: string;
  /** true = CPF/passaporte iguais: o banco NÃO deixa criar outra ficha. */
  bloqueia: boolean;
}

export interface DuplicadoSugerido {
  a_id: string;
  a_nome: string;
  b_id: string;
  b_nome: string;
  motivos: string[];
}

export interface Auditoria {
  id: number;
  acao: string;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  por: string | null;
  em: string;
}

// ── Formatação ──────────────────────────────────────────────────────────────

export const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

export function formatarCpf(v: string | null | undefined): string {
  const d = soDigitos(v);
  if (d.length !== 11) return v ?? "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatarTelefone(v: string | null | undefined): string {
  let d = soDigitos(v);
  if (!d) return "";
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  else return `+${d}`; // número de fora: mostra como veio
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

export function formatarData(v: string | null | undefined): string {
  if (!v) return "";
  const [a, m, d] = v.slice(0, 10).split("-");
  return d && m && a ? `${d}/${m}/${a}` : v;
}

export function idade(nascimento: string | null | undefined): number | null {
  if (!nascimento) return null;
  const n = new Date(nascimento + "T12:00:00");
  if (isNaN(n.getTime())) return null;
  const h = new Date();
  let i = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) i--;
  return i;
}

/** Meses até o passaporte vencer (negativo = vencido). */
export function mesesParaVencer(validade: string | null | undefined): number | null {
  if (!validade) return null;
  const v = new Date(validade + "T12:00:00");
  if (isNaN(v.getTime())) return null;
  const h = new Date();
  return (v.getFullYear() - h.getFullYear()) * 12 + (v.getMonth() - h.getMonth()) - (v.getDate() < h.getDate() ? 1 : 0);
}

export const iniciais = (nome: string) =>
  nome.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

// ── Validação ───────────────────────────────────────────────────────────────

/** Dígitos verificadores do CPF. Pega digitação errada antes de virar ficha. */
export function cpfValido(v: string): boolean {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function validarCliente(c: ClienteInput): string | null {
  if (!c.nome || c.nome.trim().length < 2) return "Informe o nome completo.";
  if (c.cpf && !cpfValido(c.cpf)) return "CPF inválido — confira os números.";
  if (c.passaporte && !/^[A-Za-z0-9]{5,12}$/.test(c.passaporte.replace(/[^A-Za-z0-9]/g, ""))) return "Passaporte inválido (5 a 12 letras e números).";
  if (c.telefone) {
    const d = soDigitos(c.telefone);
    if (d.length < 10 || d.length > 15) return "Telefone inválido — use DDD + número.";
  }
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) return "E-mail inválido.";
  if (!c.cpf && !c.passaporte && !c.telefone && !c.email) return "Informe ao menos um contato ou documento (CPF, passaporte, telefone ou e-mail).";
  return null;
}

/** Traduz o erro do banco pra uma frase que o time entende. */
export function mensagemDeErro(e: { message?: string; code?: string } | null | undefined): string {
  const msg = e?.message ?? "";
  if (e?.code === "23505" || /duplicate key/i.test(msg)) {
    if (/cpf/i.test(msg)) return "Já existe uma ficha com este CPF.";
    if (/passaporte/i.test(msg)) return "Já existe uma ficha com este passaporte.";
    if (/bitrix/i.test(msg)) return "Este contato do Bitrix já está ligado a outra ficha.";
    return "Já existe uma ficha com estes dados.";
  }
  return msg || "Não foi possível salvar. Tente de novo.";
}

// ── Banco ───────────────────────────────────────────────────────────────────

/** Tira do termo o que quebraria o filtro `or=(...)` do PostgREST. */
const limparBusca = (t: string) => t.replace(/[,()*%\\:"']/g, " ").trim();

export async function buscarClientes(termo: string, limite = 100): Promise<Cliente[]> {
  // arquivado (0119: não é cliente — empresa, teste, funcionário) não aparece na lista
  let q = supabase.from("rel_clientes").select("*").is("mesclado_em_id", null).is("arquivado_em", null).order("nome").limit(limite);
  const t = limparBusca(termo);
  if (t) {
    const d = soDigitos(t);
    q = d.length >= 3 && d.length === t.replace(/[\s.\-/()+]/g, "").length
      ? q.or(`cpf.ilike.*${d}*,telefone.ilike.*${d}*`)
      : q.or(`nome.ilike.*${t}*,email.ilike.*${t}*,passaporte.ilike.*${t.toUpperCase()}*`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Cliente[];
}

export async function carregarCliente(id: string): Promise<Cliente | null> {
  const { data, error } = await supabase.from("rel_clientes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Cliente | null;
}

export async function carregarFamilia(titularId: string): Promise<Cliente[]> {
  const { data, error } = await supabase
    .from("rel_clientes").select("*")
    .eq("titular_id", titularId).is("mesclado_em_id", null).order("nome");
  if (error) throw error;
  return (data ?? []) as Cliente[];
}

export async function salvarCliente(c: ClienteInput, id?: string): Promise<Cliente> {
  const corpo = {
    nome: c.nome,
    cpf: c.cpf || null,
    passaporte: c.passaporte || null,
    passaporte_validade: c.passaporte_validade || null,
    nascimento: c.nascimento || null,
    telefone: c.telefone || null,
    email: c.email || null,
    titular_id: c.titular_id || null,
    parentesco: c.titular_id ? c.parentesco || "outro" : null,
    bitrix_contato_id: c.bitrix_contato_id || null,
    observacoes: c.observacoes || null,
    lgpd_consentimento_em: c.lgpd_consentimento_em || null,
  };
  const res = id
    ? await supabase.from("rel_clientes").update(corpo).eq("id", id).select("*").single()
    : await supabase.from("rel_clientes").insert(corpo).select("*").single();
  if (res.error) throw new Error(mensagemDeErro(res.error));
  return res.data as Cliente;
}

export async function buscarParecidos(c: Partial<ClienteInput>, ignorar?: string): Promise<Parecido[]> {
  const { data, error } = await supabase.rpc("rel_buscar_parecidos", {
    p_cpf: c.cpf || null,
    p_passaporte: c.passaporte || null,
    p_telefone: c.telefone || null,
    p_email: c.email || null,
    p_nome: c.nome || null,
    p_ignorar: ignorar ?? null,
  });
  if (error) return [];
  return (data ?? []) as Parecido[];
}

export async function listarDuplicados(): Promise<DuplicadoSugerido[]> {
  const { data, error } = await supabase.from("rel_duplicados_sugeridos").select("*").limit(200);
  if (error) throw error;
  return (data ?? []) as DuplicadoSugerido[];
}

export async function naoEhDuplicado(x: string, y: string) {
  const [a, b] = x < y ? [x, y] : [y, x];
  const { error } = await supabase.from("rel_nao_duplicados").insert({ a, b });
  if (error && error.code !== "23505") throw new Error(mensagemDeErro(error));
}

export async function juntarClientes(manter: string, remover: string) {
  const { error } = await supabase.rpc("rel_juntar_clientes", { p_manter: manter, p_remover: remover });
  if (error) throw new Error(error.message);
}

export async function carregarHistorico(id: string): Promise<Auditoria[]> {
  const { data, error } = await supabase
    .from("rel_auditoria").select("id, acao, antes, depois, por, em")
    .eq("registro_id", id).order("em", { ascending: false }).limit(50);
  if (error) return [];
  return (data ?? []) as Auditoria[];
}

export interface Resumo {
  clientes: number;
  /** Pessoas ligadas a um titular (cônjuge, filhos...). */
  emFamilia: number;
  duplicados: number;
  passaportesVencendo: number;
  semConsentimento: number;
}

export async function carregarResumo(): Promise<Resumo> {
  const vivos = () => supabase.from("rel_clientes").select("id", { count: "exact", head: true }).is("mesclado_em_id", null).is("arquivado_em", null);
  const daqui6 = new Date();
  daqui6.setMonth(daqui6.getMonth() + 6);
  const [c, f, d, p, l] = await Promise.all([
    vivos(),
    vivos().not("titular_id", "is", null),
    supabase.from("rel_duplicados_sugeridos").select("a_id", { count: "exact", head: true }),
    vivos().not("passaporte_validade", "is", null).lte("passaporte_validade", daqui6.toISOString().slice(0, 10)),
    vivos().is("lgpd_consentimento_em", null),
  ]);
  return {
    clientes: c.count ?? 0,
    emFamilia: f.count ?? 0,
    duplicados: d.count ?? 0,
    passaportesVencendo: p.count ?? 0,
    semConsentimento: l.count ?? 0,
  };
}

/** Só o que o menu e o Início do Rel mostram (22/10, desempenho). */
export type ResumoDoMenu = Pick<Resumo, "clientes" | "duplicados">;

/**
 * As 2 contagens que o menu do Rel usa — carregarResumo fazia 5 a cada 30 s e a
 * tela só mostrava 2. Duplicados pela função rel_duplicados_contagem (0201:
 * mesmo número da view, ~35 ms em vez de ~400 ms); antes da 0201 aplicada,
 * conta pela view como sempre.
 */
export async function carregarResumoDoMenu(): Promise<ResumoDoMenu> {
  const [c, d] = await Promise.all([
    supabase.from("rel_clientes").select("id", { count: "exact", head: true }).is("mesclado_em_id", null).is("arquivado_em", null),
    supabase.rpc("rel_duplicados_contagem").then(async (r) => {
      if (!r.error && typeof r.data === "number") return r.data;
      const v = await supabase.from("rel_duplicados_sugeridos").select("a_id", { count: "exact", head: true });
      return v.count ?? 0;
    }),
  ]);
  return { clientes: c.count ?? 0, duplicados: d };
}

// ── KPIs da carteira (migration 0106) ───────────────────────────────────────
// A view rel_cliente_metricas calcula tudo por cliente no banco: quantas
// viagens, quanto gastou, categoria, dias sem contato e o que falta no
// cadastro. A tela só soma.

export type CategoriaId = "bronze" | "silver" | "black" | "green" | "sem_categoria";

export interface Metrica {
  id: string;
  nome: string;
  titular_id: string | null;
  criado_em: string;
  viagens_compradas: number;
  viagens_realizadas: number;
  expedicoes: number;
  pacotes: number;
  valor_total: number;
  primeira_viagem: string | null;
  ultima_viagem: string | null;
  ultimo_retorno: string | null;
  proximo_embarque: string | null;
  ultimo_contato_em: string | null;
  dias_sem_contato: number | null;
  categoria: CategoriaId;
  meta_contato_dias: number;
  faltando: string[];
  cadastro_completo: boolean;
  /** 0117: aéreo/hotel/seguro avulsos (somam no LTV, não contam como viagem). */
  compras_avulsas?: number;
  /** 0120: já voltou (realizadas) por tipo — vazio se a migration ainda não foi aplicada. */
  expedicoes_realizadas?: number;
  pacotes_realizados?: number;
}

export interface Nivel { id: Exclude<CategoriaId, "sem_categoria">; nome: string; min_viagens: number; min_valor: number; cor: string }
export interface RegrasCategorias {
  criterio: "viagens" | "valor" | "viagens_ou_valor";
  contar: "compradas" | "realizadas";
  niveis: Nivel[];
}
export type MetasContato = Record<CategoriaId, number>;

export const SEM_CATEGORIA = { id: "sem_categoria" as const, nome: "Sem categoria", cor: "#C9CED6" };

export const REGRAS_PADRAO: RegrasCategorias = {
  criterio: "viagens",
  contar: "compradas",
  niveis: [
    { id: "bronze", nome: "Bronze", min_viagens: 1, min_valor: 0, cor: "#B0743C" },
    { id: "silver", nome: "Silver", min_viagens: 2, min_valor: 30000, cor: "#9AA3AE" },
    { id: "black", nome: "Black", min_viagens: 3, min_valor: 60000, cor: "#1F2328" },
    { id: "green", nome: "Green", min_viagens: 5, min_valor: 100000, cor: "#0E7C6A" },
  ],
};
export const METAS_PADRAO: MetasContato = { sem_categoria: 120, bronze: 90, silver: 60, black: 45, green: 30 };

/** Nome legível do que falta no cadastro. */
export const CAMPOS_CADASTRO: Record<string, string> = {
  cpf: "CPF", nascimento: "Nascimento", telefone: "Telefone", email: "E-mail",
  passaporte: "Nº do passaporte", passaporte_validade: "Validade do passaporte", doc_passaporte: "Foto do passaporte",
};

export function moeda(v: number | null | undefined): string {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

/** Explica a regra de um nível em uma frase ("Green = 5+ viagens"). */
export function regraDoNivel(n: Nivel, r: RegrasCategorias): string {
  const v = `${n.min_viagens}+ viage${n.min_viagens === 1 ? "m" : "ns"}${r.contar === "realizadas" ? " já feitas" : ""}`;
  const d = `${moeda(n.min_valor)}+ gastos`;
  if (r.criterio === "valor") return d;
  if (r.criterio === "viagens_ou_valor" && n.min_valor > 0) return `${v} ou ${d}`;
  return v;
}

/** Todas as métricas (pagina de 1000 em 1000 — o PostgREST corta em silêncio). */
export async function carregarMetricas(): Promise<Metrica[]> {
  const todas: Metrica[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from("rel_cliente_metricas").select("*").order("id").range(de, de + 999);
    if (error) throw error;
    todas.push(...((data ?? []) as Metrica[]));
    if (!data || data.length < 1000) break;
  }
  return todas.map((m) => ({ ...m, valor_total: Number(m.valor_total) || 0, faltando: m.faltando ?? [] }));
}

export async function metricaDoCliente(id: string): Promise<Metrica | null> {
  const { data, error } = await supabase.from("rel_cliente_metricas").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const m = data as Metrica;
  return { ...m, valor_total: Number(m.valor_total) || 0, faltando: m.faltando ?? [] };
}

export async function carregarRegras(): Promise<{ regras: RegrasCategorias; metas: MetasContato }> {
  // Sem engolir erro: se a leitura falhar, quem chama NÃO pode salvar o padrão por cima da config real.
  const { data, error } = await supabase.from("rel_config").select("chave, valor").in("chave", ["categorias", "contato_meta_dias"]);
  if (error) throw new Error(error.message);
  const m = Object.fromEntries((data ?? []).map((x: { chave: string; valor: unknown }) => [x.chave, x.valor]));
  const r = (m.categorias ?? {}) as Partial<RegrasCategorias>;
  return {
    regras: { ...REGRAS_PADRAO, ...r, niveis: r.niveis?.length ? r.niveis : REGRAS_PADRAO.niveis },
    metas: { ...METAS_PADRAO, ...((m.contato_meta_dias ?? {}) as Partial<MetasContato>) },
  };
}

async function gravarConfig(chave: string, valor: unknown) {
  const { data, error } = await supabase.from("rel_config")
    .update({ valor, atualizado_em: new Date().toISOString() }).eq("chave", chave).select("chave");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("Sem permissão para mudar esta configuração.");
}

export async function salvarRegras(regras: RegrasCategorias, metas: MetasContato) {
  await gravarConfig("categorias", regras);
  await gravarConfig("contato_meta_dias", metas);
}

// ── Contatos registrados à mão ──────────────────────────────────────────────

export type CanalContato = "ligacao" | "whatsapp" | "email" | "presencial" | "instagram" | "outro";
export const CANAIS_CONTATO: Record<CanalContato, string> = {
  ligacao: "Ligação", whatsapp: "WhatsApp (outro número)", email: "E-mail", presencial: "Presencial", instagram: "Instagram", outro: "Outro",
};
export interface Contato { id: string; cliente_id: string; canal: CanalContato; resumo: string | null; feito_em: string; autor_id: string | null }

export async function listarContatos(clienteId: string): Promise<Contato[]> {
  const { data } = await supabase.from("rel_contatos").select("*").eq("cliente_id", clienteId).order("feito_em", { ascending: false }).limit(30);
  return (data ?? []) as Contato[];
}

export async function registrarContato(clienteId: string, canal: CanalContato, resumo: string, feitoEm?: string) {
  const { error } = await supabase.from("rel_contatos").insert({
    cliente_id: clienteId, canal, resumo: resumo.trim() || null, feito_em: feitoEm || new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

// ── Arquivos e imagens da ficha ─────────────────────────────────────────────
// Mesmo bucket privado dos documentos (rel-documentos). Imagem = tipo 'foto';
// qualquer outro arquivo solto = 'outro'. Passaporte, visto etc. continuam na
// seção Documentos.

export interface Arquivo {
  id: string; cliente_id: string; tipo: "foto" | "outro"; descricao: string | null;
  arquivo_path: string; arquivo_nome: string | null; mime: string | null; tamanho: number | null; enviado_em: string;
}

export async function listarArquivos(clienteId: string): Promise<Arquivo[]> {
  const { data, error } = await supabase.from("rel_documentos")
    .select("id, cliente_id, tipo, descricao, arquivo_path, arquivo_nome, mime, tamanho, enviado_em")
    .eq("cliente_id", clienteId).in("tipo", ["foto", "outro"])
    // só o que o time subiu solto na ficha; o que veio por pedido/viagem é "Documento"
    .eq("enviado_por", "time").is("pedido_id", null).is("viagem_id", null)
    .order("enviado_em", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Arquivo[];
}

export async function subirArquivo(clienteId: string, arquivo: File, descricao?: string) {
  if (arquivo.size > 20 * 1024 * 1024) throw new Error(`${arquivo.name}: maior que 20 MB.`);
  const tipo = arquivo.type.startsWith("image/") ? "foto" : "outro";
  const ext = (arquivo.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
  const path = `${clienteId}/${Date.now()}-${tipo}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await supabase.storage.from("rel-documentos").upload(path, arquivo, { contentType: arquivo.type || undefined, upsert: false });
  if (up.error) throw new Error(`${arquivo.name}: não subiu (${up.error.message}).`);
  const { error } = await supabase.from("rel_documentos").insert({
    cliente_id: clienteId, tipo, arquivo_path: path, arquivo_nome: arquivo.name.slice(0, 160),
    mime: arquivo.type || null, tamanho: arquivo.size, descricao: descricao?.trim() || null, enviado_por: "time", status: "aprovado",
  });
  if (error) {
    await supabase.storage.from("rel-documentos").remove([path]); // não deixa arquivo órfão
    throw new Error(error.message);
  }
}

/** Link novo, gerado na hora do clique (1 min). Com `baixarComo`, o navegador baixa em vez de abrir. */
export async function linkNaHora(path: string, baixarComo?: string): Promise<string> {
  const { data, error } = await supabase.storage.from("rel-documentos")
    .createSignedUrl(path, 60, baixarComo ? { download: baixarComo } : undefined);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Não consegui gerar o link do arquivo.");
  return data.signedUrl;
}

/** Links assinados (10 min) de vários arquivos de uma vez — pras miniaturas. */
export async function linksAssinados(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await supabase.storage.from("rel-documentos").createSignedUrls(paths, 600);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string]));
}

export async function apagarArquivo(a: Arquivo) {
  const { error } = await supabase.from("rel_documentos").delete().eq("id", a.id);
  if (error) throw new Error(error.message);
  const rm = await supabase.storage.from("rel-documentos").remove([a.arquivo_path]);
  if (rm.error) throw new Error(`O registro saiu, mas o arquivo ficou no armazenamento (${rm.error.message}).`);
}

// ── Cruzar a base + Arrumar cadastros (migration 0151) ──────────────────────
// O banco cruza sozinho só o que é seguro (rel_cruzar_base): completa campo
// vazio e liga conversa/venda/atendimento quando UM cliente só bate. O resto
// vira fila pro time (rel_fila_cadastros). Tudo fica em rel_cruzamentos.

export interface ClienteMini { id: string; nome: string }

export interface FilaCadastros {
  parecidos: DuplicadoSugerido[];
  cpf_divergente: { id: string; nome: string; cpf: string; cpf_venda: string; viagem_id: string; titulo: string | null }[];
  viagens: { id: string; titulo: string | null; destino: string | null; data_embarque: string | null; data_venda: string | null; valor: number | null; bitrix_deal_id: string | null; status: string; sugestoes: ClienteMini[] }[];
  conversas: { id: string; telefone: string; nome_contato: string | null; setor: string | null; atualizado_em: string; ultima_mensagem: string | null; sugestoes: ClienteMini[] }[];
  financeiro: { id: string; numero: number; nome: string | null; telefone: string | null; motivo: string | null; status: string; criado_em: string }[];
  incompletos_total: number;
  incompletos_viajando: number;
  incompletos: { id: string; nome: string; proximo_embarque: string | null; faltando: string[] }[];
  ultima_rodada: { rodada: string; em: string; mudancas: number } | null;
}

export async function carregarFila(): Promise<FilaCadastros> {
  const { data, error } = await supabase.rpc("rel_fila_cadastros");
  if (error) throw new Error(error.message);
  return data as FilaCadastros;
}

export interface ResultadoCruzamento {
  rodada: string;
  aplicado: boolean;
  campos: Record<string, number>;
  ligacoes: Record<string, number>;
}

export async function cruzarBase(aplicar = true): Promise<ResultadoCruzamento> {
  const { data, error } = await supabase.rpc("rel_cruzar_base", { p_aplicar: aplicar });
  if (error) throw new Error(error.message);
  return data as ResultadoCruzamento;
}

export async function desfazerCruzamento(rodada: string): Promise<number> {
  const { data, error } = await supabase.rpc("rel_desfazer_cruzamento", { p_rodada: rodada });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

export type TipoVinculo = "conversa" | "viagem" | "financeiro" | "chamado";

export async function vincularCadastro(tipo: TipoVinculo, id: string, clienteId: string) {
  const { error } = await supabase.rpc("rel_vincular_cadastro", { p_tipo: tipo, p_id: id, p_cliente: clienteId });
  if (error) throw new Error(error.message);
}

export interface LigacoesCliente {
  leads: { id: string; nome: string; status: string | null; fonte: string | null; criado_em: string; fechado_em: string | null; dono: string | null; por: "venda" | "telefone" | "e-mail" }[];
  grupos: { jid: string; nome: string | null; ultima_msg_em: string | null }[];
  financeiro: { id: string; numero: number; motivo: string | null; status: string; criado_em: string }[];
  passageiro_em: number;
  comprador_em: number;
  conversas: number;
  cruzamentos: { campo: string; fonte: string; em: string }[];
}

export async function carregarLigacoes(clienteId: string): Promise<LigacoesCliente | null> {
  const { data, error } = await supabase.rpc("rel_ligacoes_do_cliente", { p_cliente: clienteId });
  if (error) throw new Error(error.message);
  return (data ?? null) as LigacoesCliente | null;
}

/** Quanto do cadastro está preenchido (o que a viagem pede). */
export const CAMPOS_COMPLETUDE: [keyof Cliente, string][] = [
  ["telefone", "Telefone"], ["email", "E-mail"], ["cpf", "CPF"], ["nascimento", "Nascimento"],
  ["passaporte", "Nº do passaporte"], ["passaporte_validade", "Validade do passaporte"],
];

export function completude(c: Cliente): { pct: number; faltando: string[] } {
  const faltando = CAMPOS_COMPLETUDE.filter(([k]) => !c[k]).map(([, r]) => r);
  return { pct: Math.round(((CAMPOS_COMPLETUDE.length - faltando.length) / CAMPOS_COMPLETUDE.length) * 100), faltando };
}
