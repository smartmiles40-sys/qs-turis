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

// ── Leituras da ficha pro lado do Operações (BlocoFichaCliente) ──────────────
// Todas toleram erro: antes da 0172 não existe passageiros.cliente_id; antes da
// 0173 o Operações não lê as tabelas rel_* (RLS) — aí a parte nova só some.

/** Em que ficha estão estes passageiros. ativo=false: a coluna cliente_id ainda não existe (0172 não aplicada). */
export async function fichasDosPassageiros(passageiroIds: string[]): Promise<{ ativo: boolean; porPassageiro: Record<string, string | null> }> {
  if (!passageiroIds.length) return { ativo: true, porPassageiro: {} };
  const { data, error } = await supabase.from("passageiros").select("id, cliente_id").in("id", passageiroIds.slice(0, 200));
  if (error) return { ativo: false, porPassageiro: {} };
  return { ativo: true, porPassageiro: Object.fromEntries(((data ?? []) as { id: string; cliente_id: string | null }[]).map((r) => [r.id, r.cliente_id])) };
}

export interface MetricaFicha {
  categoria: string; viagens_compradas: number; viagens_realizadas: number; valor_total: number;
  ultima_viagem: string | null; proximo_embarque: string | null; dias_sem_contato: number | null;
}
/** Categoria e números da ficha (view rel_cliente_metricas). null se não der pra ler. */
export async function metricaDaFicha(clienteId: string): Promise<MetricaFicha | null> {
  const { data, error } = await supabase.from("rel_cliente_metricas")
    .select("categoria, viagens_compradas, viagens_realizadas, valor_total, ultima_viagem, proximo_embarque, dias_sem_contato")
    .eq("id", clienteId).maybeSingle();
  if (error || !data) return null;
  const m = data as MetricaFicha;
  return { ...m, valor_total: Number(m.valor_total) || 0 };
}

export interface TrechoFicha { id: string; viagem_id: string; tipo: string; origem: string | null; destino: string | null; partida_em: string; companhia: string | null; numero: string | null }
export interface ViagemFicha {
  id: string; titulo: string; destino: string | null; tipo: string; data_embarque: string | null; data_retorno: string | null;
  status: string; valor: number | null; titular: boolean; trechos: TrechoFicha[];
}
/** Viagens do Relacionamento da pessoa (titular ou acompanhante), com os trechos. */
export async function viagensDaFicha(clienteId: string): Promise<ViagemFicha[]> {
  const { data: ps, error: e1 } = await supabase.from("rel_viagem_passageiros").select("viagem_id").eq("cliente_id", clienteId);
  if (e1) throw e1;
  const ids = [...new Set(((ps ?? []) as { viagem_id: string }[]).map((p) => p.viagem_id))];
  let q = supabase.from("rel_viagens").select("id, titulo, destino, tipo, data_embarque, data_retorno, status, valor, cliente_id");
  q = ids.length ? q.or(`cliente_id.eq.${clienteId},id.in.(${ids.slice(0, 150).join(",")})`) : q.eq("cliente_id", clienteId);
  const { data, error } = await q.order("data_embarque", { ascending: false, nullsFirst: false }).limit(100);
  if (error) throw error;
  const viagens = ((data ?? []) as (Omit<ViagemFicha, "titular" | "trechos"> & { cliente_id: string | null })[])
    .map(({ cliente_id, ...v }) => ({ ...v, titular: cliente_id === clienteId, trechos: [] as TrechoFicha[] }));
  if (!viagens.length) return viagens;
  const { data: ts } = await supabase.from("rel_viagem_trechos")
    .select("id, viagem_id, tipo, origem, destino, partida_em, companhia, numero")
    .in("viagem_id", viagens.map((v) => v.id)).order("partida_em");
  const porViagem = new Map(viagens.map((v) => [v.id, v]));
  for (const t of (ts ?? []) as TrechoFicha[]) porViagem.get(t.viagem_id)?.trechos.push(t);
  return viagens;
}

export interface DocumentoFicha {
  id: string; tipo: string; descricao: string | null; arquivo_path: string; arquivo_nome: string | null;
  validade: string | null; status: string; enviado_em: string; viagem_id: string | null;
}
/** Documentos da ficha (sem as cópias de arquivo — copia_de). */
export async function documentosDaFicha(clienteId: string): Promise<DocumentoFicha[]> {
  const { data, error } = await supabase.from("rel_documentos")
    .select("id, tipo, descricao, arquivo_path, arquivo_nome, validade, status, enviado_em, viagem_id")
    .eq("cliente_id", clienteId).is("copia_de", null).order("enviado_em", { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as DocumentoFicha[];
}

/** Link de um documento da ficha (bucket rel-documentos), gerado na hora (1 min). */
export async function linkDocumentoFicha(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("rel-documentos").createSignedUrl(path, 60);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Não consegui abrir o arquivo.");
  return data.signedUrl;
}

export interface ContatoFicha { id: string; canal: string; resumo: string | null; feito_em: string }
export async function contatosDaFicha(clienteId: string, limite = 8): Promise<ContatoFicha[]> {
  const { data, error } = await supabase.from("rel_contatos").select("id, canal, resumo, feito_em")
    .eq("cliente_id", clienteId).order("feito_em", { ascending: false }).limit(limite);
  if (error) throw error;
  return (data ?? []) as ContatoFicha[];
}

export interface NotaFicha { id: string; titulo: string; texto: string; atualizado_em: string }
export async function notasDaFicha(clienteId: string, limite = 8): Promise<NotaFicha[]> {
  const { data, error } = await supabase.from("rel_notas").select("id, titulo, texto, atualizado_em")
    .eq("cliente_id", clienteId).order("atualizado_em", { ascending: false }).limit(limite);
  if (error) throw error;
  return (data ?? []) as NotaFicha[];
}
