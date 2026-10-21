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

/** Mesma ideia, pra listas grandes de ids em `in (...)` (fatias de 200 pra URL não estourar). */
export async function lerPorIds<T>(tabela: string, coluna: string, ids: string[], colunas = "*"): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const fatia = ids.slice(i, i + 200);
    out.push(...(await lerTudo<T>(tabela, (q) => q.in(coluna, fatia), colunas)));
  }
  return out;
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

export async function listarExpedicoes(tipo?: "expedicao" | "pacote"): Promise<ExpedicaoRow[]> {
  let q = supabase.from("expedicoes").select("*").order("ordem", { ascending: true, nullsFirst: false }).order("data_embarque", { ascending: true });
  if (tipo) q = q.eq("tipo", tipo);
  return erroOuDados(await q) as ExpedicaoRow[];
}

export async function lerExpedicao(id: string): Promise<ExpedicaoRow | null> {
  return erroOuDados(await supabase.from("expedicoes").select("*").eq("id", id).maybeSingle()) as ExpedicaoRow | null;
}

export async function listarUsuarios(): Promise<UsuarioRow[]> {
  return erroOuDados(await supabase.from("usuarios").select("*").order("nome")) as UsuarioRow[];
}

export async function listarPassageirosDe(expedicaoIds: string[]): Promise<PassageiroRow[]> {
  return lerPorIds<PassageiroRow>("passageiros", "expedicao_id", expedicaoIds);
}

export async function listarRequisitosDe(passageiroIds: string[]): Promise<PassageiroRequisitoRow[]> {
  return lerPorIds<PassageiroRequisitoRow>("passageiro_requisitos", "passageiro_id", passageiroIds);
}

/** Link assinado (5 min) pra abrir/baixar um arquivo do bucket das Expedições. */
export async function linkDoArquivo(storagePath: string, baixarComo?: string, segundos = 300): Promise<string> {
  const { data, error } = await supabase.storage.from("arquivos-expedicoes")
    .createSignedUrl(storagePath, segundos, baixarComo ? { download: baixarComo } : undefined);
  if (error || !data) throw new Error(error?.message ?? "Não foi possível abrir o arquivo.");
  return data.signedUrl;
}
