// src/expedicoes/drive/arquivos.ts
// Subir / apagar / abrir arquivos das Expedições (tabela `arquivos` + bucket
// `arquivos-expedicoes`). No app antigo eram as rotas /api/arquivos/upload,
// /api/arquivos/[id] (DELETE) e /api/arquivos/[id]/download, todas com service
// role. Aqui vai direto pro Storage com a sessão do usuário — as policies da
// 0161 (storage) e da 0160 (tabela) decidem: só quem não é "só leitura" escreve.
// Mesmo caminho de pasta e mesmas regras (15 MB, tipos permitidos) do antigo,
// porque o /amigo e o /lider (que ficam no app antigo) leem esses arquivos.
import { supabase, linkDoArquivo, traduzirErro } from "../lib/banco";
import { comprimirImagem } from "../lib/comprimir-imagem";
import { CATEGORIA_ARQUIVO, MARCADOR_DOC_LIDER, MAX_UPLOAD_BYTES, MIME_ARQUIVO_PERMITIDOS, type CategoriaArquivo } from "../lib/constants";
import type { ArquivoRow } from "../lib/database";

export const BUCKET = "arquivos-expedicoes";

/** Igual ao safeName do antigo: sem acento, só [a-zA-Z0-9._-], até 120 caracteres. */
export function nomeSeguro(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/**
 * Arquivos que o /amigo e o /lider leem pela `descricao` e que NÃO podem ser
 * apagados pelo Drive: documento do líder e ingressos de Machu Picchu.
 * (O documento do líder sai pela aba Roteiro do Líder.)
 */
export function arquivoProtegido(a: Pick<ArquivoRow, "descricao">): string | null {
  const d = (a.descricao ?? "").trim();
  if (d === MARCADOR_DOC_LIDER) return "Documento da Área do Líder — remova pela aba Roteiro do Líder.";
  if (d.startsWith("Ingresso Machu Picchu") || d.startsWith("Ingresso Trem Machu Picchu")) return "Ingresso de Machu Picchu — aparece no portal do viajante.";
  return null;
}

/** Marcadores usados pelo portal (ExpedAmigo). Apagar tira o anexo do portal. */
const MARCADORES_PORTAL = ["Foto roteiro", "Foto passeio opcional", "Voucher hospedagem", "Voucher", "Voucher da hospedagem", "PDF 1", "PDF 2"];
export function usadoNoPortal(a: Pick<ArquivoRow, "descricao" | "passageiro_id">): boolean {
  return !a.passageiro_id && MARCADORES_PORTAL.includes((a.descricao ?? "").trim());
}

export function formatarTamanho(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export interface EnvioArquivo {
  expedicaoId: string;
  passageiroId?: string | null;
  categoria?: CategoriaArquivo;
  descricao?: string | null;
  arquivo: File;
}

/** Sobe 1 arquivo (comprime imagem antes) e cria a linha em `arquivos`. Devolve a linha. */
export async function enviarArquivo({ expedicaoId, passageiroId = null, categoria = "Outros", descricao = null, arquivo }: EnvioArquivo): Promise<ArquivoRow> {
  if (!(CATEGORIA_ARQUIVO as readonly string[]).includes(categoria)) throw new Error("Pasta inválida.");
  const f = await comprimirImagem(arquivo);
  if (f.size === 0) throw new Error(`"${arquivo.name}" está vazio.`);
  if (f.size > MAX_UPLOAD_BYTES) throw new Error(`"${arquivo.name}" passa do limite de ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  if (!(MIME_ARQUIVO_PERMITIDOS as readonly string[]).includes(f.type)) {
    throw new Error(`"${arquivo.name}": tipo de arquivo não permitido (${f.type || "desconhecido"}). Use PDF, imagem, Word, Excel ou CSV.`);
  }
  const pasta = nomeSeguro(categoria);
  const caminho = passageiroId
    ? `${expedicaoId}/passageiros/${passageiroId}/${pasta}/${crypto.randomUUID()}-${nomeSeguro(f.name)}`
    : `${expedicaoId}/${pasta}/${crypto.randomUUID()}-${nomeSeguro(f.name)}`;

  const up = await supabase.storage.from(BUCKET).upload(caminho, f, { contentType: f.type || "application/octet-stream", upsert: false });
  if (up.error) throw new Error(traduzirErro(up.error.message));

  const ins = await supabase.from("arquivos").insert({
    expedicao_id: expedicaoId, passageiro_id: passageiroId, categoria, nome: f.name, descricao,
    mime: f.type || null, tamanho_bytes: f.size, storage_path: caminho,
  }).select("*").single();
  if (ins.error || !ins.data) {
    await supabase.storage.from(BUCKET).remove([caminho]); // desfaz o blob
    throw new Error(traduzirErro(ins.error?.message ?? "Não foi possível registrar o arquivo."));
  }
  return ins.data as ArquivoRow;
}

/**
 * Apaga a linha e o blob. Os vínculos (voucher, foto do roteiro…) se limpam
 * sozinhos pelas FKs (set null / cascade).
 */
export async function excluirArquivo(id: string): Promise<void> {
  const { data, error } = await supabase.from("arquivos").select("storage_path").eq("id", id).maybeSingle();
  if (error) throw new Error(traduzirErro(error.message));
  if (!data) return;
  const del = await supabase.from("arquivos").delete().eq("id", id);
  if (del.error) throw new Error(traduzirErro(del.error.message));
  await supabase.storage.from(BUCKET).remove([(data as { storage_path: string }).storage_path]);
}

/** Apaga vários (best-effort) — usado ao excluir um dia do roteiro com fotos. */
export async function excluirArquivosSilencioso(ids: (string | null | undefined)[]): Promise<void> {
  for (const id of ids) {
    if (!id) continue;
    try { await excluirArquivo(id); } catch { /* segue */ }
  }
}

/** Abre num separador novo (PDF/imagem) — a janela abre já no clique pra não ser bloqueada. */
export async function abrirArquivo(storagePath: string): Promise<void> {
  const janela = window.open("about:blank", "_blank");
  try {
    const url = await linkDoArquivo(storagePath);
    if (janela) janela.location.href = url; else window.location.href = url;
  } catch (e) {
    janela?.close();
    throw e;
  }
}

/** Baixa com o nome original. */
export async function baixarArquivo(storagePath: string, nome: string): Promise<void> {
  const url = await linkDoArquivo(storagePath, nome);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Links assinados em lote (miniaturas). Devolve storage_path → url. */
export async function linksEmLote(caminhos: string[], segundos = 3600): Promise<Record<string, string>> {
  const unicos = [...new Set(caminhos.filter(Boolean))];
  const out: Record<string, string> = {};
  for (let i = 0; i < unicos.length; i += 100) {
    const fatia = unicos.slice(i, i + 100);
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(fatia, segundos);
    for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  }
  return out;
}
