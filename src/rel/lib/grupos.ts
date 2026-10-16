// src/rel/lib/grupos.ts
// -----------------------------------------------------------------------------
// Grupos do WhatsApp do Relacionamento (0137, 15/10/2026).
//
// Os grupos chegam por uma ligação separada (Evolution, QR) que SÓ trata grupo.
// Ler vai direto no banco (RLS: rel_tem_acesso). Enviar passa pelo servidor
// (/api/rel-grupos), que só aceita endereço de grupo já conhecido.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

export interface Grupo {
  jid: string;
  nome: string | null;
  descricao: string | null;
  participantes: number | null;
  ultima_msg_em: string | null;
  ultima_msg: string | null;
  saiu_em: string | null;
  /** 0142: mensagens dos outros desde a última vez que alguém do time abriu/respondeu */
  nao_lidas?: number;
  /** 0142: alguém marcou o número com @ */
  mencionado_em?: string | null;
}

export interface MensagemGrupo {
  id: string;
  grupo_jid: string;
  msg_id: string;
  de_mim: boolean;
  autor_jid: string | null;
  autor_nome: string | null;
  tipo: string;
  texto: string;
  anexo_url: string | null;
  anexo_nome: string | null;
  enviado_por: string | null;
  criado_em: string;
  transcricao?: string | null;
}

export async function listarGrupos(): Promise<Grupo[]> {
  const { data, error } = await supabase
    .from("rel_wa_grupos")
    .select("jid,nome,descricao,participantes,ultima_msg_em,ultima_msg,saiu_em,nao_lidas,mencionado_em")
    .is("saiu_em", null)
    .order("ultima_msg_em", { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw error;
  return (data || []) as Grupo[];
}

export async function mensagensDoGrupo(jid: string, limite = 200): Promise<MensagemGrupo[]> {
  const { data, error } = await supabase
    .from("rel_wa_grupo_mensagens")
    .select("*")
    .eq("grupo_jid", jid)
    .order("criado_em", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return ((data || []) as MensagemGrupo[]).reverse();
}

async function api<T = Record<string, unknown>>(metodo: "GET" | "POST", corpoOuQuery: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const url = metodo === "GET"
    ? `/api/rel-grupos?${new URLSearchParams(Object.entries(corpoOuQuery).map(([k, v]) => [k, String(v)]))}`
    : "/api/rel-grupos";
  const r = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${session.access_token}`, ...(metodo === "POST" ? { "Content-Type": "application/json" } : {}) },
    body: metodo === "POST" ? JSON.stringify(corpoOuQuery) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `Falhou (${r.status}).`);
  return j as T;
}

/** Abriu o grupo: zera não lidas e o @ (0142). */
export async function marcarGrupoLido(jid: string) {
  await supabase.rpc("rel_wa_grupo_lido", { p_jid: jid });
}

/** Pro menu da esquerda: quantos grupos têm mensagem nova e se alguém marcou o número. */
export async function contarGruposNovos(): Promise<{ grupos: number; mencoes: number }> {
  const { data } = await supabase.from("rel_wa_grupos").select("nao_lidas,mencionado_em").gt("nao_lidas", 0).is("saiu_em", null).limit(1000);
  const l = (data ?? []) as { nao_lidas: number; mencionado_em: string | null }[];
  return { grupos: l.length, mencoes: l.filter((x) => x.mencionado_em).length };
}

export const estadoDosGrupos = () => api<{ conectado: boolean; estado: string; erro?: string }>("GET", { estado: 1 });
export const sincronizarGrupos = () => api<{ grupos: number }>("POST", { acao: "sincronizar" });
export const enviarNoGrupo = (jid: string, texto: string) => api("POST", { acao: "texto", jid, texto });
