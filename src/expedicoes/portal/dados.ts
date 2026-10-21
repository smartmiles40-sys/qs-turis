// src/expedicoes/portal/dados.ts
// Leitura e escrita do conteúdo do portal do viajante (ExpedAmigo). No app
// antigo: expedicoes/[id]/portal/actions.ts (CRUD genérico com a tabela vinda do
// cliente, sem validar colunas) + lib/data/expedicoes.ts (listas). Aqui o CRUD é
// tipado por tabela e vai direto com a sessão (RLS da 0160).
//
// CONTRATO com o /amigo (que continua no app antigo lendo este banco):
//  · segmento: extensao_id = id → só quem contratou a extensão; "__base__" no
//    seletor grava extensao_id=null + apenas_sem_extensao=true (só quem NÃO
//    estende); vazio grava extensao_id=null + apenas_sem_extensao=false (todos).
//  · voos: grupo_id null = todos os grupos; passageiro_id preenchido = voo
//    individual (criado no perfil do passageiro, não aqui).
//  · anexos: linha em `arquivos` sem passageiro, com categoria/descricao do
//    quadro da spec (ver ROTULOS_ANEXO) e o id gravado na coluna do item.
import { supabase, erroOuDados, lerTudo, traduzirErro } from "../lib/banco";
import type {
  ArquivoRow, ExpedicaoAvisoRow, ExpedicaoInfoRow, ExpedicaoPasseioRow, ExpedicaoVooRow, ExtensaoRow,
  GrupoExpedicaoRow, PasseioOpcionalRow, RoteiroDiaFotoRow, RoteiroDiaRow,
} from "../lib/database";
import { excluirArquivosSilencioso } from "../drive/arquivos";

export const SEG_BASE = "__base__";

export type TabelaPortal = "roteiro_dias" | "expedicao_voos" | "expedicao_passeios" | "expedicao_info" | "expedicao_avisos" | "passeios_opcionais" | "extensoes";
export type Valores = Record<string, string | number | boolean | null>;

/** Colunas que cada tabela aceita do editor (o antigo deixava o cliente mandar qualquer chave). */
const COLUNAS: Record<TabelaPortal, string[]> = {
  roteiro_dias: ["dia", "data", "titulo", "descricao", "cidade", "refeicoes", "hospedagem", "extensao_id", "apenas_sem_extensao"],
  expedicao_voos: ["trecho", "companhia", "numero_voo", "origem", "destino", "partida", "chegada", "localizador", "observacoes", "arquivo_id", "extensao_id", "apenas_sem_extensao", "grupo_id"],
  expedicao_passeios: ["nome", "data", "horario", "local", "observacoes", "arquivo_id"],
  expedicao_info: ["titulo", "conteudo", "arquivo_id", "arquivo_label", "arquivo_id_2", "arquivo_label_2"],
  expedicao_avisos: ["tipo", "titulo", "conteudo"],
  passeios_opcionais: ["roteiro_dia_id", "titulo", "descricao", "foto_arquivo_id", "whatsapp_url", "tipo"],
  extensoes: ["nome", "descricao", "hospedagem_voucher_arquivo_id"],
};

function filtrar(tabela: TabelaPortal, v: Valores): Valores {
  const ok = COLUNAS[tabela];
  const out: Valores = {};
  for (const [k, x] of Object.entries(v)) if (ok.includes(k)) out[k] = x;
  return out;
}

export interface ConteudoPortal {
  roteiro: RoteiroDiaRow[];
  voos: ExpedicaoVooRow[];
  passeios: ExpedicaoPasseioRow[];
  info: ExpedicaoInfoRow[];
  avisos: ExpedicaoAvisoRow[];
  fotos: RoteiroDiaFotoRow[];
  passeiosOpcionais: PasseioOpcionalRow[];
  extensoes: ExtensaoRow[];
  grupos: GrupoExpedicaoRow[];
  /** arquivos da expedição sem passageiro (pra abrir anexos e mostrar fotos) */
  arquivos: Map<string, ArquivoRow>;
  hospedagemVoucherArquivoId: string | null;
}

const porOrdem = <T extends { ordem: number; created_at: string }>(a: T, b: T) => a.ordem - b.ordem || a.created_at.localeCompare(b.created_at);

export async function carregarPortal(expedicaoId: string): Promise<ConteudoPortal> {
  const daExp = (q: any) => q.eq("expedicao_id", expedicaoId); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [roteiro, voos, passeios, info, avisos, fotos, passeiosOpcionais, extensoes, grupos, arquivos, exp] = await Promise.all([
    lerTudo<RoteiroDiaRow>("roteiro_dias", daExp),
    lerTudo<ExpedicaoVooRow>("expedicao_voos", daExp),
    lerTudo<ExpedicaoPasseioRow>("expedicao_passeios", daExp),
    lerTudo<ExpedicaoInfoRow>("expedicao_info", daExp),
    lerTudo<ExpedicaoAvisoRow>("expedicao_avisos", daExp),
    lerTudo<RoteiroDiaFotoRow>("roteiro_dia_fotos", daExp),
    lerTudo<PasseioOpcionalRow>("passeios_opcionais", daExp),
    lerTudo<ExtensaoRow>("extensoes", daExp),
    lerTudo<GrupoExpedicaoRow>("grupos_expedicao", daExp),
    lerTudo<ArquivoRow>("arquivos", (q) => daExp(q).is("passageiro_id", null)),
    supabase.from("expedicoes").select("hospedagem_voucher_arquivo_id").eq("id", expedicaoId).maybeSingle(),
  ]);
  // Mesma ordem do antigo/amigo: roteiro por data (sem data no fim), dia, ordem.
  roteiro.sort((a, b) => (a.data ?? "9999-12-31").localeCompare(b.data ?? "9999-12-31") || a.dia - b.dia || a.ordem - b.ordem);
  [passeios, info, avisos, passeiosOpcionais, extensoes, fotos].forEach((l) => (l as { ordem: number; created_at: string }[]).sort(porOrdem));
  grupos.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  return {
    roteiro, voos, passeios, info, avisos, fotos, passeiosOpcionais, extensoes, grupos,
    arquivos: new Map(arquivos.map((a) => [a.id, a])),
    hospedagemVoucherArquivoId: (erroOuDados(exp) as { hospedagem_voucher_arquivo_id: string | null } | null)?.hospedagem_voucher_arquivo_id ?? null,
  };
}

/** Cria item com ordem = maior ordem + 1 da expedição (o antigo usava count, que repetia após exclusões). */
export async function criarItem(tabela: TabelaPortal, expedicaoId: string, valores: Valores): Promise<string> {
  const { data: ult } = await supabase.from(tabela).select("ordem").eq("expedicao_id", expedicaoId).order("ordem", { ascending: false }).limit(1);
  const ordem = ((ult?.[0] as { ordem: number } | undefined)?.ordem ?? -1) + 1;
  const { data, error } = await supabase.from(tabela).insert({ expedicao_id: expedicaoId, ordem, ...filtrar(tabela, valores) }).select("id").single();
  if (error || !data) throw new Error(traduzirErro(error?.message ?? "Falha ao criar"));
  return (data as { id: string }).id;
}

export async function atualizarItem(tabela: TabelaPortal, id: string, valores: Valores): Promise<void> {
  const v = filtrar(tabela, valores);
  if (!Object.keys(v).length) return;
  const { error } = await supabase.from(tabela).update(v).eq("id", id);
  if (error) throw new Error(traduzirErro(error.message));
}

/**
 * Exclui o item e os anexos dele (o antigo deixava blobs e linhas de `arquivos`
 * órfãos — ex.: excluir um dia deixava as fotos no Storage).
 */
export async function excluirItem(tabela: TabelaPortal, id: string, anexos: (string | null | undefined)[] = []): Promise<void> {
  const { error } = await supabase.from(tabela).delete().eq("id", id);
  if (error) throw new Error(traduzirErro(error.message));
  await excluirArquivosSilencioso(anexos);
}

/** Excluir um dia: leva junto fotos e fotos dos passeios opcionais do dia. */
export async function excluirDia(dia: RoteiroDiaRow, c: ConteudoPortal): Promise<void> {
  const anexos = [
    ...c.fotos.filter((f) => f.roteiro_dia_id === dia.id).map((f) => f.arquivo_id),
    ...c.passeiosOpcionais.filter((p) => p.roteiro_dia_id === dia.id).map((p) => p.foto_arquivo_id),
  ];
  await excluirItem("roteiro_dias", dia.id, anexos);
}

export async function adicionarFotoRoteiro(expedicaoId: string, roteiroDiaId: string, arquivoId: string): Promise<void> {
  const { data: ult } = await supabase.from("roteiro_dia_fotos").select("ordem").eq("roteiro_dia_id", roteiroDiaId).order("ordem", { ascending: false }).limit(1);
  const ordem = ((ult?.[0] as { ordem: number } | undefined)?.ordem ?? -1) + 1;
  const { error } = await supabase.from("roteiro_dia_fotos").insert({ expedicao_id: expedicaoId, roteiro_dia_id: roteiroDiaId, arquivo_id: arquivoId, legenda: null, ordem });
  if (error) throw new Error(traduzirErro(error.message));
}

export async function definirVoucherHospedagem(expedicaoId: string, arquivoId: string | null): Promise<void> {
  const { error } = await supabase.from("expedicoes").update({ hospedagem_voucher_arquivo_id: arquivoId }).eq("id", expedicaoId);
  if (error) throw new Error(traduzirErro(error.message));
}

export interface ResultadoLiberar { total: number; ja_tinham_senha: number; senhas: { nome: string; cpf: string; senha: string }[] }

/** "Liberar para todos" — função da 0170 (só admin; mexe em acesso_senhas, que não tem policy). */
export async function liberarExpedamigoTodos(expedicaoId: string): Promise<ResultadoLiberar> {
  const { data, error } = await supabase.rpc("exp_liberar_expedamigo_todos", { p_expedicao_id: expedicaoId });
  if (error) throw new Error(traduzirErro(error.message));
  return data as ResultadoLiberar;
}

/** Converte o valor do seletor "Faz parte de" nas duas colunas do contrato. */
export function segmentoParaColunas(valor: string): { extensao_id: string | null; apenas_sem_extensao: boolean } {
  if (valor === SEG_BASE) return { extensao_id: null, apenas_sem_extensao: true };
  return { extensao_id: valor || null, apenas_sem_extensao: false };
}
export function colunasParaSegmento(extensaoId: string | null | undefined, apenasSemExtensao: boolean | null | undefined): string {
  return apenasSemExtensao ? SEG_BASE : (extensaoId ?? "");
}
