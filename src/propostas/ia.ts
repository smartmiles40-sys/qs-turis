// src/propostas/ia.ts
// -----------------------------------------------------------------------------
// "MONTAR COM IA" — o lado da rede (0290): subir/listar/apagar os insumos da
// proposta (bucket privado `propostas-insumos` + qs_proposta_insumos) e chamar
// api/proposta-ia.js. A mescla no rascunho é pura e mora em iaMescla.ts.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import type { ModeloProposta } from "./modelos";
import { camposParaIa, type ExtracaoIa, type ItemConferir } from "./iaMescla";

const BUCKET = "propostas-insumos";
export const MAX_BYTES = 10 * 1024 * 1024;
const LADO_MAX = 2200;     // print maior que isso é reduzido antes de subir (texto continua legível)
const COMPRIMIR_ACIMA = 1.5 * 1024 * 1024;

export interface Insumo {
  id: string; tipo: "arquivo" | "texto"; arquivo_path: string | null; arquivo_nome: string | null; mime: string | null;
  tamanho: number | null; texto: string | null; lido_em: string | null; criado_em: string;
}

export async function listarInsumos(propostaId: string): Promise<Insumo[]> {
  const { data, error } = await supabase.from("qs_proposta_insumos").select("*").eq("proposta_id", propostaId).order("criado_em");
  if (error) throw new Error(/relation|does not exist|schema cache/i.test(error.message) ? "O banco ainda não tem a migration 0290 (insumos da IA)." : error.message);
  return (data ?? []) as Insumo[];
}

/** Print grande vira JPEG de até 2200 px no lado maior (mesma leitura, bem menos MB). */
async function reduzir(f: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < COMPRIMIR_ACIMA) return f;
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d")!.drawImage(bmp, 0, 0, cv.width, cv.height);
    const b = await new Promise<Blob | null>((ok) => cv.toBlob(ok, "image/jpeg", 0.88));
    return b && b.size < f.size ? b : f;
  } catch { return f; }
}

const limparNome = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "-").slice(-80) || "arquivo";

export async function subirArquivo(propostaId: string, f: File): Promise<Insumo> {
  if (/heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)) throw new Error(`"${f.name}" está em HEIC (iPhone). Tire um print da tela ou mande em JPG.`);
  if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type) && f.type !== "application/pdf") throw new Error(`"${f.name}": a IA lê imagem (print/foto) ou PDF.`);
  const corpo = await reduzir(f);
  if (corpo.size > MAX_BYTES) throw new Error(`"${f.name}" passa de 10 MB.`);
  const mime = corpo.type || f.type;
  const nome = mime === "image/jpeg" && corpo !== f ? f.name.replace(/\.\w+$/, ".jpg") : f.name;
  const path = `${propostaId}/${Date.now().toString(36)}-${limparNome(nome)}`;
  const { error: e1 } = await supabase.storage.from(BUCKET).upload(path, corpo, { contentType: mime, upsert: false });
  if (e1) throw new Error(/bucket/i.test(e1.message) ? "O banco ainda não tem o bucket da migration 0290." : `Não subiu "${f.name}": ${e1.message}`);
  const { data, error } = await supabase.from("qs_proposta_insumos")
    .insert({ proposta_id: propostaId, tipo: "arquivo", arquivo_path: path, arquivo_nome: nome, mime, tamanho: corpo.size }).select("*").single();
  if (error) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(error.message); }
  return data as Insumo;
}

export async function colarTexto(propostaId: string, texto: string): Promise<Insumo> {
  const t = texto.trim().slice(0, 20000);
  if (!t) throw new Error("Cole algum texto.");
  const { data, error } = await supabase.from("qs_proposta_insumos").insert({ proposta_id: propostaId, tipo: "texto", texto: t }).select("*").single();
  if (error) throw new Error(error.message);
  return data as Insumo;
}

export async function apagarInsumo(i: Insumo) {
  const { error } = await supabase.from("qs_proposta_insumos").delete().eq("id", i.id);
  if (error) throw new Error(error.message);
  if (i.arquivo_path) await supabase.storage.from(BUCKET).remove([i.arquivo_path]);
}

export async function linkDoInsumo(i: Insumo): Promise<string | null> {
  if (!i.arquivo_path) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(i.arquivo_path, 300);
  return data?.signedUrl ?? null;
}

export interface RespostaIa {
  extracao: ExtracaoIa; conferir: ItemConferir[]; descartados: { campo: string; valor: string; motivo: string }[];
  avisos: string[]; uso: { entrada: number | null; saida: number | null; modelo: string }; lidos: string[];
}

/** Chama a IA. Pode levar uns 20–40 s com vários prints. */
export async function lerComIa(propostaId: string, modelo: ModeloProposta, pedido: string): Promise<RespostaIa> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/proposta-ia", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ proposta_id: propostaId, modelo, campos: camposParaIa(modelo), pedido }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || (r.status === 504 ? "A leitura demorou demais. Tente com menos prints." : `Falhou (HTTP ${r.status}).`));
  return j as RespostaIa;
}
