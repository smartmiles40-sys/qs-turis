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
  let q = supabase.from("rel_clientes").select("*").is("mesclado_em_id", null).order("nome").limit(limite);
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
  const vivos = () => supabase.from("rel_clientes").select("id", { count: "exact", head: true }).is("mesclado_em_id", null);
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
