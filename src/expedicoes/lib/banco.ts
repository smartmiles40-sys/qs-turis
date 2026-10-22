// src/expedicoes/lib/banco.ts
// -----------------------------------------------------------------------------
// Acesso às tabelas das Expedições (migradas do sistema antigo na 0160).
// As tabelas têm os MESMOS nomes do app antigo; o RLS (exp_tem_acesso /
// is_readonly) decide quem vê e quem edita. Aqui só a leitura comum:
// `lerTudo` pagina de 1000 em 1000 com desempate por id (o app antigo cortava
// em 1000 linhas sem avisar em várias telas).
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { ExpedicaoRow, PassageiroRow, PassageiroRequisitoRow, UsuarioRow } from "./database";
import { lembrar } from "./cache";

export { supabase };

type Filtro = (q: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Lê a tabela inteira (ou o recorte do filtro) em páginas de 1000. */
export async function lerTudo<T>(tabela: string, filtro?: Filtro, colunas = "*", ordem = "id"): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    let q = supabase.from(tabela).select(colunas).order(ordem, { ascending: true }).range(de, de + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * Mesma ideia, pra listas grandes de ids em `in (...)` (fatias de 200 pra URL não estourar).
 * 22/10: as fatias vão JUNTAS (antes uma esperava a outra terminar). Cada fatia
 * continua paginando de 1000 em 1000 com ordem por id, e o resultado sai na ordem
 * das fatias — o mesmo de antes.
 */
export async function lerPorIds<T>(tabela: string, coluna: string, ids: string[], colunas = "*"): Promise<T[]> {
  const fatias: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) fatias.push(ids.slice(i, i + 200));
  const partes = await Promise.all(fatias.map((fatia) => lerTudo<T>(tabela, (q) => q.in(coluna, fatia), colunas)));
  return partes.flat();
}

export function erroOuDados<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(traduzirErro(r.error.message));
  return r.data as T;
}

/** Mensagens do Postgres que o time entende. */
export function traduzirErro(msg: string): string {
  if (/row-level security|permission denied/i.test(msg)) return "Seu perfil é só de leitura nas Expedições — essa ação não é permitida.";
  if (/expedicoes_codigo_key/.test(msg)) return "Já existe uma expedição com esse código (mesmo destino e mês). Ajuste o nome ou o destino.";
  if (/expedicoes_check/.test(msg)) return "A data de retorno não pode ser antes do embarque.";
  if (/duplicate key/.test(msg)) return "Esse registro já existe.";
  return msg;
}

/**
 * Expedições (tabela pequena, mas lida por quase toda tela). 22/10: UMA leitura,
 * guardada 60 s (lib/cache.ts); o tipo é filtrado aqui, mantendo a ordem
 * (ordem, data_embarque) que o banco devolvia com o filtro. Devolve CÓPIA da lista.
 */
export async function listarExpedicoes(tipo?: "expedicao" | "pacote"): Promise<ExpedicaoRow[]> {
  const todas = await lembrar("expedicoes", ["expedicoes"], async () =>
    erroOuDados(await supabase.from("expedicoes").select("*")
      .order("ordem", { ascending: true, nullsFirst: false }).order("data_embarque", { ascending: true })) as ExpedicaoRow[]);
  return tipo ? todas.filter((e) => e.tipo === tipo) : [...todas];
}

export async function lerExpedicao(id: string): Promise<ExpedicaoRow | null> {
  return erroOuDados(await supabase.from("expedicoes").select("*").eq("id", id).maybeSingle()) as ExpedicaoRow | null;
}

/** Usuários do sistema (responsáveis). Guardado 60 s — o ExpProvider e os agregados usam a MESMA leitura. */
export async function listarUsuarios(): Promise<UsuarioRow[]> {
  const lista = await lembrar("usuarios", ["usuarios"], async () =>
    erroOuDados(await supabase.from("usuarios").select("*").order("nome")) as UsuarioRow[]);
  return [...lista];
}

/** Passageiros das expedições — linha inteira (as abas editam a linha toda). Pra só contar, use as colunas leves abaixo. */
export async function listarPassageirosDe(expedicaoIds: string[]): Promise<PassageiroRow[]> {
  return lerPorIds<PassageiroRow>("passageiros", "expedicao_id", expedicaoIds);
}

export async function listarRequisitosDe(passageiroIds: string[]): Promise<PassageiroRequisitoRow[]> {
  return lerPorIds<PassageiroRequisitoRow>("passageiro_requisitos", "passageiro_id", passageiroIds);
}

// -----------------------------------------------------------------------------
// LEITURA LEVE PRA PRONTIDÃO (22/10). `passageiros` tem 55 colunas; a conta de
// prontidão/ocupação/avisos usa 12. Quem só CONTA (selo do menu, Início, Avisos,
// lista e cabeçalho da expedição) lê só estas — conferido campo a campo contra
// lib/prontidao/regras.ts (avaliarProntidao) e os consumidores. Se a regra passar
// a ler outro campo, ACRESCENTE aqui e no Pick (o TypeScript acusa).
// -----------------------------------------------------------------------------
export const COLUNAS_PAX_PRONTIDAO =
  "id, expedicao_id, nome_completo, tipo, status_reserva, cpf, data_nascimento, passaporte, validade_passaporte, passaporte_arquivo_id, contrato_assinado, created_at";
export type PaxProntidao = Pick<PassageiroRow,
  "id" | "expedicao_id" | "nome_completo" | "tipo" | "status_reserva" | "cpf" | "data_nascimento"
  | "passaporte" | "validade_passaporte" | "passaporte_arquivo_id" | "contrato_assinado" | "created_at">;

export const COLUNAS_REQ_PRONTIDAO = "id, passageiro_id, tipo, descricao, status, obrigatoriedade, bloqueia_embarque, validade, arquivo_id";
export type ReqProntidao = Pick<PassageiroRequisitoRow,
  "id" | "passageiro_id" | "tipo" | "descricao" | "status" | "obrigatoriedade" | "bloqueia_embarque" | "validade" | "arquivo_id">;

export function lerPaxProntidao(expedicaoIds: string[]): Promise<PaxProntidao[]> {
  return lerPorIds<PaxProntidao>("passageiros", "expedicao_id", expedicaoIds, COLUNAS_PAX_PRONTIDAO);
}

export function lerReqProntidao(passageiroIds: string[]): Promise<ReqProntidao[]> {
  return lerPorIds<ReqProntidao>("passageiro_requisitos", "passageiro_id", passageiroIds, COLUNAS_REQ_PRONTIDAO);
}

/** Link assinado (5 min) pra abrir/baixar um arquivo do bucket das Expedições. */
export async function linkDoArquivo(storagePath: string, baixarComo?: string, segundos = 300): Promise<string> {
  const { data, error } = await supabase.storage.from("arquivos-expedicoes")
    .createSignedUrl(storagePath, segundos, baixarComo ? { download: baixarComo } : undefined);
  if (error || !data) throw new Error(error?.message ?? "Não foi possível abrir o arquivo.");
  return data.signedUrl;
}
