// src/solicitacoes/anexosApi.ts
// -----------------------------------------------------------------------------
// ANEXOS (0316) — banco + Storage. Mesmo padrão do pagamento.ts (sobe no bucket
// privado, registra por RPC, apaga o arquivo órfão se o registro falhar, abre
// por link assinado curto), com duas coisas a mais:
//   • progresso de verdade: o upload vai por XHR direto na API do Storage
//     (o supabase-js não dá progresso);
//   • miniatura da foto feita no navegador (webp ~360 px) pra o quadro e a
//     conversa não baixarem a foto inteira.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { montarPath, nomeDoPrint, pathDaMiniatura, tipoDePrevia, type AnexoSol } from "./anexos";

export const BUCKET_SOL = "solicitacoes";
const URL_SUPA = import.meta.env.VITE_SUPABASE_URL as string;
const CHAVE = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** A 0316 ainda não foi aplicada (tabela/RPC/bucket não existem)? */
export function semAnexosNoBanco(msg: string | undefined | null): boolean {
  return !!msg && /qs_solicitacao_anexos|qs_sol_anexar|qs_sol_anexos_resumo|Bucket not found|schema cache|does not exist/i.test(msg);
}
const AINDA_NAO = "Os anexos ainda não foram ligados no banco (falta aplicar a 0316). Fale com o Bruno.";

export async function listarAnexos(solId: string): Promise<AnexoSol[]> {
  const { data, error } = await supabase.from("qs_solicitacao_anexos").select("*").eq("solicitacao_id", solId).order("criado_em");
  if (error) { if (semAnexosNoBanco(error.message)) return []; throw new Error(error.message); }
  return (data ?? []) as AnexoSol[];
}

export interface ResumoAnexos { n: number; capa: string | null }
/** Nº de anexos + miniatura da 1ª foto de cada pedido (cartões do quadro). Falha → vazio. */
export async function resumoDosAnexos(ids: string[]): Promise<Record<string, ResumoAnexos>> {
  if (!ids.length) return {};
  const { data, error } = await supabase.rpc("qs_sol_anexos_resumo", { p_ids: ids });
  if (error) return {};
  const out: Record<string, ResumoAnexos> = {};
  for (const r of (data ?? []) as { solicitacao_id: string; n: number; capa: string | null }[]) out[r.solicitacao_id] = { n: r.n, capa: r.capa };
  return out;
}

// ── Links assinados (bucket privado), com cache curto ───────────────────────
const cache = new Map<string, { url: string; ate: number }>();
const VALIDADE = 300; // 5 min, como o pagamento.ts

export async function linksAssinados(paths: string[]): Promise<Record<string, string>> {
  const agora = Date.now();
  const out: Record<string, string> = {};
  const faltam: string[] = [];
  for (const p of new Set(paths)) {
    const c = cache.get(p);
    if (c && c.ate > agora + 30_000) out[p] = c.url; else faltam.push(p);
  }
  if (faltam.length) {
    const { data } = await supabase.storage.from(BUCKET_SOL).createSignedUrls(faltam, VALIDADE);
    for (const d of data ?? []) {
      if (d.path && d.signedUrl) { out[d.path] = d.signedUrl; cache.set(d.path, { url: d.signedUrl, ate: agora + VALIDADE * 1000 }); }
    }
  }
  return out;
}

/** Link de 5 minutos pra abrir/baixar (download = força salvar com o nome original). */
export async function linkDoAnexo(path: string, baixarComo?: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_SOL).createSignedUrl(path, VALIDADE, baixarComo ? { download: baixarComo } : undefined);
  if (error || !data?.signedUrl) throw new Error("Não consegui abrir o arquivo.");
  return data.signedUrl;
}

// ── Upload ──────────────────────────────────────────────────────────────────
/** Sobe um arquivo pro Storage com progresso (0–1). */
async function subir(path: string, corpo: Blob, tipo: string, onProgresso?: (f: number) => void): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sua sessão expirou. Entre de novo.");
  await new Promise<void>((ok, falha) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${URL_SUPA}/storage/v1/object/${BUCKET_SOL}/${path.split("/").map(encodeURIComponent).join("/")}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", CHAVE);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", tipo || "application/octet-stream");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgresso?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgresso?.(1); ok(); return; }
      let msg = xhr.statusText || `erro ${xhr.status}`;
      try { const j = JSON.parse(xhr.responseText) as { message?: string; error?: string }; msg = j.message || j.error || msg; } catch { /* resposta sem JSON */ }
      falha(new Error(semAnexosNoBanco(msg) ? AINDA_NAO : /row-level security|Unauthorized|403/i.test(msg) ? "Sem permissão pra anexar nesse pedido." : msg));
    };
    xhr.onerror = () => falha(new Error("A internet caiu no meio do envio."));
    xhr.send(corpo);
  });
}

async function apagarDoStorage(paths: string[]) {
  if (paths.length) await supabase.storage.from(BUCKET_SOL).remove(paths).catch(() => {});
}

/** Miniatura webp (lado maior 360 px) de uma foto. null = não deu (HEIC, foto corrompida…). */
async function fazerMiniatura(arq: File): Promise<Blob | null> {
  if (tipoDePrevia({ nome: arq.name, mime: arq.type }) !== "imagem" || typeof createImageBitmap !== "function") return null;
  try {
    const bmp = await createImageBitmap(arq);
    const k = Math.min(1, 360 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d")?.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return await new Promise<Blob | null>((ok) => cv.toBlob((b) => ok(b), "image/webp", 0.78));
  } catch { return null; }
}

export type EstadoEnvio = "fila" | "subindo" | "ok" | "erro";
export interface ItemEnvio { chave: string; nome: string; tamanho: number; estado: EstadoEnvio; fracao: number; erro?: string }

/** Print colado (Ctrl+V) chega como "image.png": dá um nome com data/hora. */
export function arquivoComNome(f: File): File {
  if (f.name && f.name !== "image.png" && f.name !== "image.jpeg") return f;
  return new File([f], nomeDoPrint(f.type), { type: f.type, lastModified: f.lastModified });
}

/**
 * Sobe os arquivos e grava UMA mensagem com eles (qs_sol_anexar). Se o registro
 * falhar, apaga o que subiu (sem órfão). Devolve o id do evento.
 * `onItem` recebe o estado de cada arquivo (pra barra de progresso).
 */
export async function anexarNaSolicitacao(solId: string, texto: string | null, arquivos: File[], onItem?: (i: number, it: Partial<ItemEnvio>) => void): Promise<number> {
  const subidos: string[] = [];
  const registros: { path: string; miniatura: string | null; nome: string; mime: string | null; tamanho: number }[] = [];
  try {
    for (let i = 0; i < arquivos.length; i++) {
      const a = arquivos[i];
      onItem?.(i, { estado: "subindo", fracao: 0 });
      const path = montarPath(solId, a.name, { mime: a.type });
      try {
        await subir(path, a, a.type, (f) => onItem?.(i, { fracao: f }));
      } catch (e) {
        onItem?.(i, { estado: "erro", erro: e instanceof Error ? e.message : "não subiu" });
        throw new Error(`"${a.name}" não subiu: ${e instanceof Error ? e.message : "erro"}`);
      }
      subidos.push(path);
      let mini: string | null = null;
      const blob = await fazerMiniatura(a);
      if (blob) {
        const mp = pathDaMiniatura(path);
        try { await subir(mp, blob, "image/webp"); subidos.push(mp); mini = mp; } catch { /* sem miniatura, tudo bem */ }
      }
      registros.push({ path, miniatura: mini, nome: a.name, mime: a.type || null, tamanho: a.size });
      onItem?.(i, { estado: "ok", fracao: 1 });
    }
    const { data, error } = await supabase.rpc("qs_sol_anexar", { p_id: solId, p_texto: texto?.trim() || null, p_arquivos: registros });
    if (error) throw new Error(semAnexosNoBanco(error.message) ? AINDA_NAO : error.message);
    return Number(data);
  } catch (e) {
    await apagarDoStorage(subidos); // não deixa arquivo órfão
    throw e;
  }
}

/** Apaga o anexo (quem enviou ou gestor) e os arquivos dele. */
export async function apagarAnexo(id: string): Promise<void> {
  const { data, error } = await supabase.rpc("qs_sol_anexo_apagar", { p_anexo: id });
  if (error) throw new Error(error.message);
  await apagarDoStorage(((data ?? []) as string[]).filter(Boolean));
}
