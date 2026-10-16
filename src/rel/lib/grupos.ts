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
  // 0144 — igual ao WhatsApp
  reacoes?: { de: string; nome: string | null; emoji: string }[];
  responde_a?: string | null;
  citado_texto?: string | null;
  citado_autor?: string | null;
  mencoes?: string[];
  editada_em?: string | null;
  apagada_em?: string | null;
  autor_participante?: string | null;
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

/** Celular BR com e sem o nono dígito (o WhatsApp às vezes guarda sem). */
function variantes(tel: string): string[] {
  const d = tel.replace(/\D/g, "");
  if (/^55\d{2}9\d{8}$/.test(d)) return [d, d.slice(0, 4) + d.slice(5)];
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return [d, `${d.slice(0, 4)}9${d.slice(4)}`];
  return [d];
}

/** Grupos em que esta pessoa está junto com o número do Relacionamento (0143). */
export async function gruposEmComum(telefone: string): Promise<(Grupo & { admin: string | null })[]> {
  const { data: part, error } = await supabase.from("rel_wa_grupo_participantes").select("grupo_jid, admin").in("telefone", variantes(telefone));
  if (error || !part?.length) return [];
  const admin = new Map((part as { grupo_jid: string; admin: string | null }[]).map((x) => [x.grupo_jid, x.admin]));
  const { data } = await supabase.from("rel_wa_grupos").select("jid,nome,descricao,participantes,ultima_msg_em,ultima_msg,saiu_em,nao_lidas,mencionado_em")
    .in("jid", [...admin.keys()]).is("saiu_em", null).order("ultima_msg_em", { ascending: false, nullsFirst: false });
  return ((data ?? []) as Grupo[]).map((g) => ({ ...g, admin: admin.get(g.jid) ?? null }));
}

/** Foto no grupo (com legenda), assinada com o nome de quem manda. */
export async function enviarFotoNoGrupo(jid: string, arquivo: File, legenda: string) {
  const dataBase64 = await new Promise<string>((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => erro(new Error("Não li a foto."));
    r.readAsDataURL(arquivo);
  });
  return api("POST", { acao: "imagem", jid, dataBase64, mimeType: arquivo.type, fileName: arquivo.name, legenda });
}

export const estadoDosGrupos = () => api<{ conectado: boolean; estado: string; erro?: string }>("GET", { estado: 1 });
export const sincronizarGrupos = () => api<{ grupos: number }>("POST", { acao: "sincronizar" });
export const enviarNoGrupo = (jid: string, texto: string, extra: { respondendoA?: string | null; mencoes?: string[] } = {}) =>
  api("POST", { acao: "texto", jid, texto, respondendoA: extra.respondendoA || null, mencoes: extra.mencoes || [] });

async function base64De(b: Blob): Promise<string> {
  return new Promise<string>((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => erro(new Error("Não li o arquivo."));
    r.readAsDataURL(b);
  });
}
/** Foto, vídeo, documento ou arquivo de áudio no grupo (0144). */
export async function enviarMidiaNoGrupo(jid: string, arquivo: File, legenda: string) {
  return api("POST", { acao: "midia", jid, dataBase64: await base64De(arquivo), mimeType: arquivo.type || "application/octet-stream", fileName: arquivo.name, legenda });
}
/** Áudio gravado (mensagem de voz). */
export async function enviarVozNoGrupo(jid: string, audio: Blob) {
  return api("POST", { acao: "voz", jid, dataBase64: await base64De(audio), mimeType: audio.type });
}
export const enviarFigurinhaNoGrupo = (jid: string, figurinhaId: string) => api("POST", { acao: "figurinha", jid, figurinhaId });
export const reagirNoGrupo = (msgId: string, emoji: string) => api("POST", { acao: "reacao", msgId, emoji });
export const apagarNoGrupo = (msgId: string) => api("POST", { acao: "apagar", msgId });
export const editarNoGrupo = (msgId: string, texto: string) => api("POST", { acao: "editar", msgId, texto });

export interface Participante { telefone: string; nome: string; admin: string | null }
/** Quem está no grupo, com o nome da ficha (ou o que a pessoa usa no WhatsApp). */
export async function participantesDoGrupo(jid: string): Promise<Participante[]> {
  const { data } = await supabase.from("rel_wa_grupo_participantes").select("telefone, admin").eq("grupo_jid", jid).not("telefone", "is", null).limit(1100);
  const lista = (data ?? []) as { telefone: string; admin: string | null }[];
  if (!lista.length) return [];
  const tels = lista.map((x) => x.telefone);
  const nomes = new Map<string, string>();
  for (let i = 0; i < tels.length; i += 200) {
    const { data: fichas } = await supabase.from("rel_clientes").select("nome, telefone").in("telefone", tels.slice(i, i + 200)).is("mesclado_em_id", null);
    for (const f of (fichas ?? []) as { nome: string; telefone: string }[]) nomes.set(f.telefone, f.nome);
  }
  // sem ficha: o nome salvo na conversa do Relacionamento e, por último, o nome que a pessoa usa no WhatsApp (em qualquer grupo)
  const semNome = tels.filter((t) => !nomes.has(t));
  for (let i = 0; i < semNome.length; i += 200) {
    const lote = semNome.slice(i, i + 200);
    const { data: convs } = await supabase.from("rel_wa_conversas").select("telefone, nome_contato").in("telefone", lote).not("nome_contato", "is", null);
    for (const c of (convs ?? []) as { telefone: string; nome_contato: string }[]) if (!nomes.has(c.telefone)) nomes.set(c.telefone, c.nome_contato);
    const jids = lote.filter((t) => !nomes.has(t)).map((t) => `${t}@s.whatsapp.net`);
    if (!jids.length) continue;
    const { data: msgs } = await supabase.from("rel_wa_grupo_mensagens").select("autor_jid, autor_nome").in("autor_jid", jids).not("autor_nome", "is", null).limit(2000);
    for (const m of (msgs ?? []) as { autor_jid: string; autor_nome: string }[]) {
      const t = m.autor_jid.split("@")[0];
      if (!nomes.has(t)) nomes.set(t, m.autor_nome);
    }
  }
  return lista.map((x) => ({ telefone: x.telefone, admin: x.admin, nome: nomes.get(x.telefone) || `+${x.telefone}` }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
