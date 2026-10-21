// src/clientes/cadastroUnico.ts
// -----------------------------------------------------------------------------
// CADASTRO ÚNICO DO CLIENTE (0172, Bruno 21/10/2026: "ser 1 sistema só — a mesma
// informação que o Relacionamento tem do perfil do cliente, o Operações deve ter
// também, ainda mais passageiros").
//
// A pessoa é UMA: rel_clientes (a ficha). Cada linha de `passageiros` é a ida dela
// numa expedição e aponta pra ficha em `passageiros.cliente_id`. CPF, passaporte,
// validade, nascimento, e-mail e telefone são sincronizados pelo banco (quem edita
// por último ganha); o que já estava diferente fica em `cad_divergencias` até
// alguém escolher. Relacionamento e Operações leem daqui — mesma informação.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { Cliente } from "@/rel/lib/clientes";

/** Uma ida da pessoa numa expedição/pacote, já com os dados da expedição. */
export interface IdaEmExpedicao {
  id: string;                      // passageiros.id
  expedicao_id: string;
  cliente_id: string | null;
  nome_completo: string;
  tipo: string;
  status_reserva: string;
  status_financeiro: string | null;
  valor_contratado_brl: number | null;
  valor_pago_brl: number | null;
  saldo_brl: number | null;
  localizador: string | null;
  liberado_expedamigo: boolean | null;
  restricoes_alimentares: string | null;
  condicoes_medicas: string | null;
  contato_emergencia_nome: string | null;
  contato_emergencia_fone: string | null;
  expedicao: { id: string; codigo: string; nome: string; destino: string; data_embarque: string | null; data_retorno: string | null; status: string; tipo: string } | null;
}

export type CampoDivergente = "pessoa" | "cpf" | "passaporte" | "passaporte_validade" | "nascimento" | "email" | "telefone";
export const NOME_CAMPO: Record<CampoDivergente, string> = {
  pessoa: "Pessoa", cpf: "CPF", passaporte: "Passaporte", passaporte_validade: "Validade do passaporte",
  nascimento: "Nascimento", email: "E-mail", telefone: "Telefone",
};

export interface Divergencia {
  id: string;
  cliente_id: string;
  passageiro_id: string;
  campo: CampoDivergente;
  valor_ficha: string | null;
  valor_expedicao: string | null;
  ficha_sugerida: string | null;
  criado_em: string;
}

const COLUNAS_IDA = "id, expedicao_id, cliente_id, nome_completo, tipo, status_reserva, status_financeiro, valor_contratado_brl, valor_pago_brl, saldo_brl, localizador, liberado_expedamigo, restricoes_alimentares, condicoes_medicas, contato_emergencia_nome, contato_emergencia_fone, expedicao:expedicoes(id, codigo, nome, destino, data_embarque, data_retorno, status, tipo)";

/** Todas as idas da pessoa em expedições/pacotes (mais recente primeiro). */
export async function idasDaFicha(clienteId: string): Promise<IdaEmExpedicao[]> {
  const { data, error } = await supabase.from("passageiros").select(COLUNAS_IDA).eq("cliente_id", clienteId);
  if (error) throw error;
  return ((data ?? []) as unknown as IdaEmExpedicao[])
    .sort((a, b) => (b.expedicao?.data_embarque ?? "").localeCompare(a.expedicao?.data_embarque ?? ""));
}

/** A ficha do cliente (rel_clientes). null quando ainda não tem ou quem lê não pode ver. */
export async function fichaDoCliente(clienteId: string): Promise<Cliente | null> {
  const { data, error } = await supabase.from("rel_clientes").select("*").eq("id", clienteId).maybeSingle();
  if (error) return null;
  return (data as Cliente | null) ?? null;
}

/** Divergências em aberto — de uma ficha, ou todas (fila de "Arrumar cadastros"). */
export async function divergenciasAbertas(clienteId?: string): Promise<Divergencia[]> {
  let q = supabase.from("cad_divergencias").select("id, cliente_id, passageiro_id, campo, valor_ficha, valor_expedicao, ficha_sugerida, criado_em")
    .is("resolvido_em", null).order("criado_em", { ascending: true });
  if (clienteId) q = q.eq("cliente_id", clienteId);
  const { data, error } = await q.limit(1000);
  if (error) throw error;
  return (data ?? []) as Divergencia[];
}

/** Campo: 'ficha' | 'expedicao'. Pessoa: 'mesma' (volta pra ficha sugerida) | 'outra'. */
export async function resolverDivergencia(id: string, escolha: "ficha" | "expedicao" | "mesma" | "outra") {
  const { error } = await supabase.rpc("cad_resolver_divergencia", { p_id: id, p_escolha: escolha });
  if (error) throw error;
}

/** Liga um passageiro a outra ficha (quando a ligação automática errou). */
export async function trocarFicha(passageiroId: string, clienteId: string) {
  const { error } = await supabase.rpc("cad_trocar_ficha", { p_pax: passageiroId, p_cliente: clienteId });
  if (error) throw error;
}

/** Mostra um valor de divergência de forma legível (datas em dd/mm/aaaa). */
export function valorLegivel(campo: CampoDivergente, v: string | null): string {
  if (!v) return "—";
  if ((campo === "nascimento" || campo === "passaporte_validade") && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [a, m, d] = v.split("-"); return `${d}/${m}/${a}`;
  }
  if (campo === "cpf" && /^\d{11}$/.test(v)) return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return v;
}
