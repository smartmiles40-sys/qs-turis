// src/clientes/cadastro/api.ts
// -----------------------------------------------------------------------------
// CADASTRO ÚNICO DA PESSOA — o mesmo de todos os setores (0213, Bruno 28/10/2026:
// "a mesma informação que um tem o outro também tem que ter; tudo tem que estar no
// cadastro do cliente").
//
// A pessoa é UMA ficha `rel_clientes`. SDR, Closer, Relacionamento e Operações leem
// e gravam AQUI (via RPCs da 0213, que checam quem pode). O banco leva CPF, passaporte,
// validade, nascimento, e-mail, telefone e ENDEREÇO pros passageiros das expedições
// (e volta), e cada mudança fica em rel_auditoria (quem/quando/antes/depois).
//
// ── Interface pra outras telas (ex.: "subir venda") ─────────────────────────────
//   buscarOuCriarPessoa({ cpf, telefone, email, nome }, { criar = true, soCriar = false })
//       → { id, nome, criado, motivo } | null
//       Procura CPF → telefone → e-mail (telefone/e-mail só se for UMA ficha, com o
//       mesmo primeiro nome e sem CPF diferente). Não achou e criar=true → cria.
//       soCriar=true ("não é a mesma pessoa"): só confere o CPF e cria outra ficha.
//   salvarPessoa(id, campos)            → Pessoa
//       Grava só as chaves presentes em `campos` ("" ou null apaga). Valida no banco.
//   lerPessoa(id)                        → Pessoa | null   (com acompanhantes)
//   pessoaDoLead(leadId, { criar })      → { clienteId, sugestao, lead }
//       criar=true garante um clienteId (liga a sugestão ou cria a ficha do lead).
//   ligarLeadAPessoa(leadId, clienteId | null)
//   ligarAcompanhante(clienteId, acompanhanteId, vinculo) / desligarAcompanhante(...)
//   buscarCep(cep)                       → { rua, bairro, cidade, estado } | null (ViaCEP)
//   oQueFalta(pessoa) / avisoPassaporte(validade, dataViagem)
// Erro de "0213 ainda não aplicada" vira CadastroInativo (a tela mostra um aviso).
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

export type Vinculo = "conjuge" | "filho" | "pai_mae" | "irmao" | "amigo" | "outro";
/** Do ponto de vista de quem está aberto: "Maria é Cônjuge de João". */
export const VINCULOS: Record<Vinculo, string> = {
  conjuge: "Cônjuge", filho: "Filho(a)", pai_mae: "Pai / Mãe", irmao: "Irmão(ã)", amigo: "Amigo(a)", outro: "Outro",
};

export interface Acompanhante {
  id: string;
  nome: string;
  vinculo: Vinculo;
  cpf: string | null;
  nascimento: string | null;
  passaporte: string | null;
  passaporte_validade: string | null;
  email: string | null;
  telefone: string | null;
}

export const CAMPOS_ENDERECO = [
  "endereco_cep", "endereco_rua", "endereco_numero", "endereco_complemento", "endereco_bairro", "endereco_cidade", "endereco_estado",
] as const;
export type CampoEndereco = (typeof CAMPOS_ENDERECO)[number];

export interface Pessoa {
  id: string;
  nome: string;
  cpf: string | null;
  nascimento: string | null;
  passaporte: string | null;
  passaporte_validade: string | null;
  email: string | null;
  telefone: string | null;
  endereco_cep: string | null;
  endereco_rua: string | null;
  endereco_numero: string | null;
  endereco_complemento: string | null;
  endereco_bairro: string | null;
  endereco_cidade: string | null;
  endereco_estado: string | null;
  /** 'comercial' = nasceu no SDR/Closer (pode ainda não ter comprado). */
  origem: string | null;
  atualizado_em: string | null;
  atualizado_por: string | null;
  /** Abriu uma ficha que foi juntada a esta: o id antigo. */
  mesclado_de: string | null;
  pode_editar: boolean;
  acompanhantes: Acompanhante[];
}

export type CampoPessoa = "nome" | "cpf" | "nascimento" | "passaporte" | "passaporte_validade" | "email" | "telefone" | CampoEndereco;
export type CamposPessoa = Partial<Record<CampoPessoa, string | null>>;

export interface PessoaAchada { id: string; nome: string; criado: boolean; motivo: string | null }
export interface PessoaDoLead {
  clienteId: string | null;
  /** Ficha que parece ser a do lead (mesmo telefone/e-mail) — a tela pergunta antes de ligar. */
  sugestao: PessoaAchada | null;
  lead: { nome: string | null; telefone: string | null; email: string | null };
}

/** A 0213 ainda não está no banco (as RPCs não existem). */
export class CadastroInativo extends Error {
  constructor() { super("O cadastro único (0213) ainda não foi ativado no banco."); this.name = "CadastroInativo"; }
}

type ErroBanco = { message?: string; code?: string } | null;
function erro(e: ErroBanco): Error {
  const msg = e?.message ?? "";
  if (e?.code === "PGRST202" || e?.code === "42883" || /could not find the function/i.test(msg)) return new CadastroInativo();
  if (e?.code === "42501") return new Error(msg || "Sem permissão pra mexer neste cadastro.");
  if (e?.code === "22007" || e?.code === "22008") return new Error("Data inválida — confira o dia, mês e ano.");
  return new Error(msg || "Não consegui salvar. Tente de novo.");
}

const limparCampos = (campos: CamposPessoa): CamposPessoa =>
  Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v == null || String(v).trim() === "" ? "" : String(v).trim()]));

export async function lerPessoa(id: string): Promise<Pessoa | null> {
  const { data, error } = await supabase.rpc("cad_ler_pessoa", { p: id });
  if (error) throw erro(error);
  return (data as Pessoa | null) ?? null;
}

export async function salvarPessoa(id: string, campos: CamposPessoa): Promise<Pessoa> {
  const { data, error } = await supabase.rpc("cad_salvar_pessoa", { p: id, p_campos: limparCampos(campos) });
  if (error) throw erro(error);
  return data as Pessoa;
}

export async function buscarOuCriarPessoa(
  dados: { cpf?: string | null; telefone?: string | null; email?: string | null; nome?: string | null },
  opcoes: { criar?: boolean; soCriar?: boolean } = {},
): Promise<PessoaAchada | null> {
  const { data, error } = await supabase.rpc("cad_buscar_ou_criar", {
    p_cpf: dados.cpf || null, p_telefone: dados.telefone || null, p_email: dados.email || null,
    p_nome: dados.nome || null, p_criar: opcoes.criar ?? true, p_so_criar: opcoes.soCriar ?? false,
  });
  if (error) throw erro(error);
  return (data as PessoaAchada | null) ?? null;
}

export async function pessoaDoLead(leadId: string, opcoes: { criar?: boolean } = {}): Promise<PessoaDoLead> {
  const { data, error } = await supabase.rpc("cad_pessoa_do_lead", { p_lead: leadId, p_criar: opcoes.criar ?? false });
  if (error) throw erro(error);
  const r = data as { cliente_id: string | null; sugestao: PessoaAchada | null; lead: PessoaDoLead["lead"] };
  return { clienteId: r.cliente_id, sugestao: r.sugestao, lead: r.lead };
}

export async function ligarLeadAPessoa(leadId: string, clienteId: string | null): Promise<void> {
  const { error } = await supabase.rpc("cad_ligar_lead", { p_lead: leadId, p_cliente: clienteId });
  if (error) throw erro(error);
}

export async function ligarAcompanhante(clienteId: string, acompanhanteId: string, vinculo: Vinculo): Promise<Pessoa> {
  const { data, error } = await supabase.rpc("cad_ligar_acompanhante", { p_cliente: clienteId, p_acompanhante: acompanhanteId, p_vinculo: vinculo });
  if (error) throw erro(error);
  return data as Pessoa;
}

export async function desligarAcompanhante(clienteId: string, acompanhanteId: string): Promise<Pessoa> {
  const { data, error } = await supabase.rpc("cad_desligar_acompanhante", { p_cliente: clienteId, p_acompanhante: acompanhanteId });
  if (error) throw erro(error);
  return data as Pessoa;
}

// ── Endereço pelo CEP (ViaCEP, público, chamado do navegador) ────────────────
export async function buscarCep(cep: string): Promise<{ rua: string; bairro: string; cidade: string; estado: string } | null> {
  const d = cep.replace(/\D/g, "");
  if (d.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    if (!r.ok) return null;
    const j = (await r.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (j.erro) return null;
    return { rua: j.logradouro ?? "", bairro: j.bairro ?? "", cidade: j.localidade ?? "", estado: j.uf ?? "" };
  } catch {
    return null; // sem internet / ViaCEP fora: a pessoa digita à mão
  }
}

// ── Máscaras e checagens (as mesmas regras do banco) ─────────────────────────
export const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

export function mascaraCpf(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export function mascaraCep(v: string): string {
  const d = soDigitos(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Telefone pra mostrar: guarda com 55 na frente; mostra (11) 98888-7777. */
export function mascaraTelefone(v: string): string {
  let d = soDigitos(v);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Dígitos verificadores do CPF (pega digitação errada antes de gravar). */
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

const ROTULO_FALTA: [keyof Pessoa, string][] = [
  ["nascimento", "nascimento"], ["cpf", "CPF"], ["passaporte", "passaporte"], ["passaporte_validade", "validade do passaporte"],
  ["email", "e-mail"], ["telefone", "telefone"], ["endereco_cep", "endereço"],
];
/** O que a viagem pede e ainda não está na ficha (nomes curtos, pra mostrar "Falta: …"). */
export function oQueFalta(p: Partial<Pessoa> | null | undefined, opcoes: { endereco?: boolean } = {}): string[] {
  if (!p) return [];
  return ROTULO_FALTA
    .filter(([k]) => opcoes.endereco !== false || k !== "endereco_cep")
    .filter(([k]) => k === "endereco_cep" ? !(p.endereco_cep || p.endereco_rua || p.endereco_cidade) : !p[k])
    .map(([, r]) => r);
}

/**
 * Aviso do passaporte. Com data da viagem: vence < 6 meses DEPOIS dela (regra de
 * entrada da maioria dos países). Sem data: vence < 6 meses a partir de hoje.
 */
export function avisoPassaporte(validade: string | null | undefined, dataViagem?: string | null): { tom: "erro" | "aviso"; texto: string } | null {
  if (!validade || !/^\d{4}-\d{2}-\d{2}/.test(validade)) return null;
  const v = new Date(`${validade.slice(0, 10)}T12:00:00`);
  const hoje = new Date();
  if (v < hoje) return { tom: "erro", texto: "Passaporte vencido" };
  const base = dataViagem && /^\d{4}-\d{2}-\d{2}/.test(dataViagem) ? new Date(`${dataViagem.slice(0, 10)}T12:00:00`) : hoje;
  const limite = new Date(base); limite.setMonth(limite.getMonth() + 6);
  if (v < limite) {
    return { tom: "aviso", texto: dataViagem ? "Vence menos de 6 meses depois da viagem — muitos países barram" : "Vence em menos de 6 meses" };
  }
  return null;
}
