// src/expedicoes/paginas/_admin/comum.ts
// Peças comuns das 3 telas administrativas das Expedições (Inscrições, Acessos
// ExpedAmigo, Usuários): quem é admin, chamada à rota /api/admin-user (Auth
// admin / Bitrix), copiar texto e abrir arquivo do bucket por id.
import { useEffect, useState } from "react";
import { supabase, linkDoArquivo, traduzirErro } from "../../lib/banco";

/**
 * Endereço PÚBLICO do app antigo, onde ficaram os portais (/amigo, /a/<codigo>,
 * /inscricao). No app antigo vinha de NEXT_PUBLIC_SITE_URL, com este valor de
 * reserva (lib/site.ts). Se o domínio próprio (ex.: portal.setuforeuvouviagens.com.br)
 * for ligado na Vercel do projeto antigo, troque AQUI.
 */
export const PORTAL_ANTIGO_URL = "https://sistema-expedicoes.vercel.app";

/** Admin das Expedições (admin do app antigo OU admin do QS) — o banco decide; aqui só esconde botões. */
export function useEhAdminExp(): boolean | null {
  const [v, setV] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.rpc("exp_eh_admin").then(({ data, error }) => setV(error ? false : Boolean(data)));
  }, []);
  return v;
}

/** Chama uma função SQL (RPC) e devolve o resultado, com o erro traduzido. */
export async function rpc<T>(nome: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nome, args);
  if (error) throw new Error(traduzirErro(error.message));
  return data as T;
}

/** POST /api/admin-user com o token da sessão (ações exp_*). */
export async function chamarRotaAdmin<T = Record<string, unknown>>(action: string, corpo: Record<string, unknown>): Promise<T & { success: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const res = await fetch("/api/admin-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: session.access_token, action, ...corpo }),
  });
  let json: (T & { success: boolean; error?: string }) | null = null;
  try { json = await res.json(); } catch { /* resposta vazia */ }
  if (!res.ok || !json?.success) throw new Error(json?.error || `Falha (${res.status})`);
  return json;
}

export async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; }
  catch {
    const t = document.createElement("textarea");
    t.value = texto; document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy"); t.remove(); return ok;
  }
}

/** Abre (nova aba) um arquivo da tabela `arquivos` pelo id. */
export async function abrirArquivo(arquivoId: string): Promise<void> {
  const aba = window.open("about:blank", "_blank");
  try {
    const { data, error } = await supabase.from("arquivos").select("storage_path").eq("id", arquivoId).maybeSingle();
    if (error || !data) throw new Error("Arquivo não encontrado.");
    const url = await linkDoArquivo((data as { storage_path: string }).storage_path);
    if (aba) aba.location.href = url; else window.open(url, "_blank");
  } catch (e) {
    aba?.close();
    throw e;
  }
}

/** Nome de arquivo seguro pro Storage. */
export function nomeSeguro(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}
