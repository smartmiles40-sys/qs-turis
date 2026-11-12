// src/rel/lib/grupos.ts
// -----------------------------------------------------------------------------
// Grupos do WhatsApp do Relacionamento (0137, 15/10/2026).
//
// Os grupos chegam por uma ligação separada (Evolution, QR) que SÓ trata grupo.
// Ler vai direto no banco (RLS: rel_tem_acesso). Enviar passa pelo servidor
// (/api/rel-grupos), que só aceita endereço de grupo já conhecido.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";
import { limiteArquivoMB, subirParaEnvio } from "./whatsapp";
import { lotes } from "@/lib/lotes";

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
  // 0219 — igual ao WhatsApp normal
  foto_url?: string | null;
  eu_admin?: boolean;
  so_admins_enviam?: boolean | null;
  so_admins_editam?: boolean | null;
  fixado_em?: string | null;
  expedicao_id?: string | null;
  viagem_id?: string | null;
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
  /** 0219: ✓ enviada · ✓✓ entregue · azul lida · ! erro (só nas do número) */
  status?: "enviada" | "entregue" | "lida" | "erro" | null;
  encaminhada?: boolean;
}

const COLS_GRUPO = "jid,nome,descricao,participantes,ultima_msg_em,ultima_msg,saiu_em,nao_lidas,mencionado_em";
// 0219: colunas novas. Enquanto a migration não roda no banco, cai pro jeito antigo (sem quebrar a tela).
const COLS_GRUPO_0219 = `${COLS_GRUPO},foto_url,eu_admin,so_admins_enviam,so_admins_editam,fixado_em,expedicao_id,viagem_id`;
let tem0219: boolean | null = null;
const colunaFaltando = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204" || e?.code === "42P01" || e?.code === "PGRST205";

/** Fixados primeiro (o mais recente fixado em cima), depois pela última mensagem. */
export function ordenarGrupos(l: Grupo[]): Grupo[] {
  return [...l].sort((a, b) => {
    if (!!a.fixado_em !== !!b.fixado_em) return a.fixado_em ? -1 : 1;
    if (a.fixado_em && b.fixado_em) return b.fixado_em.localeCompare(a.fixado_em);
    return (b.ultima_msg_em || "").localeCompare(a.ultima_msg_em || "");
  });
}

export async function listarGrupos(): Promise<Grupo[]> {
  const ler = (cols: string) => supabase.from("rel_wa_grupos").select(cols).is("saiu_em", null)
    .order("ultima_msg_em", { ascending: false, nullsFirst: false }).limit(500);
  let { data, error } = await ler(tem0219 === false ? COLS_GRUPO : COLS_GRUPO_0219);
  if (error && colunaFaltando(error)) { tem0219 = false; ({ data, error } = await ler(COLS_GRUPO)); }
  else if (!error && tem0219 === null) tem0219 = true;
  if (error) throw error;
  return ordenarGrupos((data || []) as unknown as Grupo[]);
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

export const estadoDosGrupos = () => api<{ conectado: boolean; estado: string; erro?: string; agendadas?: boolean }>("GET", { estado: 1 });
export const sincronizarGrupos = () => api<{ grupos: number | null; sairam?: number; lidos?: number; aviso?: string }>("POST", { acao: "sincronizar" });
/** `todos`: @todos — avisa todo mundo do grupo (menção escondida, igual ao WhatsApp). */
export const enviarNoGrupo = (jid: string, texto: string, extra: { respondendoA?: string | null; mencoes?: string[]; todos?: boolean } = {}) =>
  api("POST", { acao: "texto", jid, texto, respondendoA: extra.respondendoA || null, mencoes: extra.mencoes || [], todos: !!extra.todos });

async function base64De(b: Blob): Promise<string> {
  return new Promise<string>((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => erro(new Error("Não li o arquivo."));
    r.readAsDataURL(b);
  });
}
/** Foto, vídeo, documento ou arquivo de áudio no grupo (0144). */
export async function enviarMidiaNoGrupo(jid: string, arquivo: File, legenda: string, respondendoA?: string | null) {
  const limite = limiteArquivoMB(arquivo.type);
  if (arquivo.size > limite * 1024 * 1024) throw new Error(`Arquivo maior que ${limite} MB.`);
  // Acima de 3 MB: sobe no storage e a Evolution baixa pela URL.
  if (arquivo.size > 3 * 1024 * 1024) {
    const url = await subirParaEnvio(arquivo);
    return api("POST", { acao: "midia", jid, url, mimeType: arquivo.type || "application/octet-stream", fileName: arquivo.name, legenda, respondendoA: respondendoA || null });
  }
  return api("POST", { acao: "midia", jid, dataBase64: await base64De(arquivo), mimeType: arquivo.type || "application/octet-stream", fileName: arquivo.name, legenda, respondendoA: respondendoA || null });
}
/** Áudio gravado (mensagem de voz). */
export async function enviarVozNoGrupo(jid: string, audio: Blob) {
  return api("POST", { acao: "voz", jid, dataBase64: await base64De(audio), mimeType: audio.type });
}
export const enviarFigurinhaNoGrupo = (jid: string, figurinhaId: string) => api("POST", { acao: "figurinha", jid, figurinhaId });
export const reagirNoGrupo = (msgId: string, emoji: string) => api("POST", { acao: "reacao", msgId, emoji });
export const apagarNoGrupo = (msgId: string) => api("POST", { acao: "apagar", msgId });
export const editarNoGrupo = (msgId: string, texto: string) => api("POST", { acao: "editar", msgId, texto });

/**
 * Telefone de quem escreveu no grupo ("Conversar no privado", 21/10). O autor já
 * vem como telefone@s.whatsapp.net; se vier só o @lid, a lista de participantes traduz.
 */
export async function telefoneDoAutor(m: Pick<MensagemGrupo, "autor_jid" | "autor_participante">, grupoJid: string): Promise<string | null> {
  const [id, dominio] = String(m.autor_jid || "").split("@");
  if (dominio === "s.whatsapp.net" && /^\d{10,15}$/.test(id)) return id;
  const lid = [m.autor_jid, m.autor_participante].find((j) => String(j || "").endsWith("@lid"));
  if (!lid) return null;
  const { data } = await supabase.from("rel_wa_grupo_participantes").select("telefone").eq("grupo_jid", grupoJid).eq("participante", lid).not("telefone", "is", null).limit(1);
  return (data?.[0] as { telefone: string } | undefined)?.telefone ?? null;
}

export interface Participante { telefone: string; nome: string; admin: string | null }
/** Quem está no grupo, com o nome da ficha (ou o que a pessoa usa no WhatsApp). */
/**
 * "Responder em particular" do WhatsApp (11/11): mensagens do 1:1 do
 * Relacionamento que citam uma mensagem DESTE grupo (rel_wa_mensagens.grupo_citado,
 * 0231). Na tela do grupo aparecem embaixo da mensagem citada, com atalho pra
 * conversa. Sem a 0231 (coluna não existe) devolve lista vazia.
 */
export interface RespostaNoPrivado {
  id: string;
  conversa_id: string;
  direcao: "in" | "out";
  texto: string;
  enviada_em: string;
  msg_id: string | null;
  nome: string | null;
  telefone: string | null;
}
export async function respostasNoPrivado(jid: string): Promise<RespostaNoPrivado[]> {
  const { data, error } = await supabase.from("rel_wa_mensagens")
    .select("id, conversa_id, direcao, texto, enviada_em, grupo_citado, rel_wa_conversas(telefone, nome_contato)")
    .eq("grupo_citado->>jid", jid)
    .order("enviada_em", { ascending: true })
    .limit(300);
  if (error) return [];
  type Linha = { id: string; conversa_id: string; direcao: "in" | "out"; texto: string | null; enviada_em: string;
    grupo_citado: { msg_id?: string | null } | null; rel_wa_conversas: { telefone: string | null; nome_contato: string | null } | { telefone: string | null; nome_contato: string | null }[] | null };
  return ((data ?? []) as unknown as Linha[]).map((l) => {
    const c = Array.isArray(l.rel_wa_conversas) ? l.rel_wa_conversas[0] : l.rel_wa_conversas;
    return {
      id: l.id, conversa_id: l.conversa_id, direcao: l.direcao, texto: l.texto || "", enviada_em: l.enviada_em,
      msg_id: l.grupo_citado?.msg_id || null, nome: c?.nome_contato || null, telefone: c?.telefone || null,
    };
  });
}

export async function participantesDoGrupo(jid: string): Promise<Participante[]> {
  const { data } = await supabase.from("rel_wa_grupo_participantes").select("telefone, admin").eq("grupo_jid", jid).not("telefone", "is", null).limit(1100);
  const lista = (data ?? []) as { telefone: string; admin: string | null }[];
  if (!lista.length) return [];
  const tels = lista.map((x) => x.telefone);
  const nomes = new Map<string, string>();
  const rsFichas = await Promise.all(lotes(tels, 200).map((l) => supabase.from("rel_clientes").select("nome, telefone").in("telefone", l).is("mesclado_em_id", null)));
  for (const { data: fichas } of rsFichas) {
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

// ── 0219: tudo que o WhatsApp normal tem ─────────────────────────────────────

export interface InfoGrupo {
  nome: string | null; descricao: string | null; foto_url: string | null; eu_admin: boolean;
  so_admins_enviam: boolean; so_admins_editam: boolean; criado_em: string | null; participantes: number | null; comunidade: boolean;
}
/** Lê o grupo AGORA na Evolution (e acerta o banco): nome, foto, admins, participantes. */
export const infoDoGrupo = (jid: string) => api<InfoGrupo & { ok: boolean }>("POST", { acao: "info", jid });

export type OperacaoParticipante = "add" | "remove" | "promote" | "demote";
/** Adicionar/remover/promover/rebaixar (o número precisa ser admin). */
export const mudarParticipantes = (jid: string, operacao: OperacaoParticipante, telefones: string[]) =>
  api<{ ok: boolean; resultado: { telefone: string; ok: boolean; msg: string }[] }>("POST", { acao: "participantes", jid, operacao, telefones });

/** Link de convite (novo = revoga o anterior). Só copia — nada é mandado no privado por esta ligação. */
export const linkDeConvite = (jid: string, novo = false) => api<{ url: string }>("POST", { acao: "convite", jid, novo });
export const mudarNomeDoGrupo = (jid: string, nome: string) => api("POST", { acao: "nome", jid, nome });
export const mudarDescricaoDoGrupo = (jid: string, descricao: string) => api("POST", { acao: "descricao", jid, descricao });
export async function mudarFotoDoGrupo(jid: string, foto: File) {
  if (!/^image\/(jpeg|png)$/.test(foto.type)) throw new Error("Use uma foto JPG ou PNG.");
  if (foto.size > 5 * 1024 * 1024) throw new Error("Foto maior que 5 MB.");
  const url = await subirParaEnvio(foto);
  return api("POST", { acao: "foto-grupo", jid, url });
}
export type AjusteGrupo = "announcement" | "not_announcement" | "locked" | "unlocked";
export const ajustarGrupo = (jid: string, ajuste: AjusteGrupo) => api("POST", { acao: "ajuste", jid, ajuste });

/** Encaminha em até 5 grupos (sai como "↪ Encaminhada", assinado). */
export const encaminharNoGrupo = (msgId: string, jids: string[]) =>
  api<{ ok: boolean; resultado: { jid: string; ok: boolean; erro?: string }[] }>("POST", { acao: "encaminhar", msgId, jids });

export const fixarGrupo = (jid: string, fixar: boolean) => api("POST", { acao: "fixar", jid, fixar });
/** Marcar como lida / não lida (só no QS — o WhatsApp do celular não muda). */
export const marcarGrupo = (jid: string, lida: boolean) => api("POST", { acao: "lida", jid, lida });

// ── Vínculo grupo ↔ expedição / viagem ───────────────────────────────────────

export const vincularGrupo = (jid: string, v: { expedicaoId?: string | null; viagemId?: string | null }) =>
  api("POST", { acao: "vincular", jid, expedicaoId: v.expedicaoId || null, viagemId: v.viagemId || null });

export interface ExpedicaoVinculo { id: string; nome: string; destino: string | null; data_embarque: string | null; grupo_rotulo: string | null; status: string | null }
export async function expedicoesParaVinculo(): Promise<ExpedicaoVinculo[]> {
  const { data, error } = await supabase.from("expedicoes").select("id,nome,destino,data_embarque,grupo_rotulo,status")
    .order("data_embarque", { ascending: false, nullsFirst: false }).limit(500);
  if (error) throw error;
  return (data ?? []) as ExpedicaoVinculo[];
}
export interface ViagemVinculo { id: string; titulo: string; destino: string | null; data_embarque: string | null; expedicoes_id: string | null }
export async function buscarViagensParaVinculo(q: string): Promise<ViagemVinculo[]> {
  const t = q.trim().replace(/[%,()]/g, " ");
  if (t.length < 2) return [];
  const { data } = await supabase.from("rel_viagens").select("id,titulo,destino,data_embarque,expedicoes_id")
    .is("mesclada_em_id", null).or(`titulo.ilike.%${t}%,destino.ilike.%${t}%,expedicao.ilike.%${t}%`)
    .order("data_embarque", { ascending: false, nullsFirst: false }).limit(20);
  return (data ?? []) as ViagemVinculo[];
}
export async function viagemPorId(id: string): Promise<ViagemVinculo | null> {
  const { data } = await supabase.from("rel_viagens").select("id,titulo,destino,data_embarque,expedicoes_id").eq("id", id).maybeSingle();
  return (data as ViagemVinculo | null) ?? null;
}

/** Os grupos de uma viagem: ligados a ela ou à expedição dela. */
export async function gruposDaViagem(viagemId: string): Promise<Grupo[]> {
  if (tem0219 === false) return [];
  const { data: v } = await supabase.from("rel_viagens").select("expedicoes_id").eq("id", viagemId).maybeSingle();
  const exp = (v as { expedicoes_id: string | null } | null)?.expedicoes_id;
  const filtro = exp ? `viagem_id.eq.${viagemId},expedicao_id.eq.${exp}` : `viagem_id.eq.${viagemId}`;
  const { data, error } = await supabase.from("rel_wa_grupos").select(COLS_GRUPO_0219).or(filtro).is("saiu_em", null)
    .order("ultima_msg_em", { ascending: false, nullsFirst: false });
  if (error) { if (colunaFaltando(error)) tem0219 = false; return []; }
  return (data ?? []) as unknown as Grupo[];
}

const SEM_ACENTO = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// palavras que todo grupo/expedição tem e não dizem nada sobre QUAL é
const VAZIAS = new Set("expedicao exp grupo grupos viagem viagens avisos aviso comunidade pacote partiu organizacao familia setuforeuvou com para pra dos das del los the and ida volta".split(" "));
const MESES: Record<string, number> = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const MES_PALAVRA = new Set("jan fev mar abr mai jun jul ago set out nov dez janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro".split(" "));
function palavras(s: string): string[] {
  return SEM_ACENTO(s).replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((p) => p.length >= 3 && !VAZIAS.has(p) && !MES_PALAVRA.has(p) && !/\d/.test(p));
}
const turmaDe = (s: string) => SEM_ACENTO(s).match(/\bg\s?(\d)\b/)?.[1] ?? null;
function anoDe(s: string): number | null {
  const t = SEM_ACENTO(s);
  const quatro = t.match(/\b(20\d\d)\b/);
  if (quatro) return Number(quatro[1]);
  const dois = t.match(/(?:[a-z]{3}\s?\/?\s?|\/)(2\d)\b/) || t.match(/\b(2[3-9])$/);
  return dois ? 2000 + Number(dois[1]) : null;
}
function mesesDe(s: string): number[] {
  const t = SEM_ACENTO(s);
  const out = new Set<number>();
  for (const m of t.matchAll(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*/g)) out.add(MESES[m[1]]);
  for (const m of t.matchAll(/\b(0?[1-9]|1[0-2])\s?\/\s?(20)?2\d\b/g)) out.add(Number(m[1]));
  return [...out];
}

export interface Sugestao { expedicao: ExpedicaoVinculo; pontos: number; motivo: string }
/**
 * Sugestão de vínculo pelo NOME do grupo × nome/destino da expedição:
 * palavras em comum (destino, sobrenome da família…), turma (G1/G2), ano e mês.
 * Ex.: "Exp. Japão e China G2 - Out e Nov/26" → "Japão & China - 2026 (Out/Nov) — G2".
 */
export function sugerirExpedicoes(nomeGrupo: string, exps: ExpedicaoVinculo[], max = 3): Sugestao[] {
  const pg = new Set(palavras(nomeGrupo));
  if (!pg.size) return [];
  const gT = turmaDe(nomeGrupo); const gA = anoDe(nomeGrupo); const gM = mesesDe(nomeGrupo);
  const out: Sugestao[] = [];
  for (const e of exps) {
    const texto = `${e.nome} ${e.destino || ""}`;
    const comuns = [...new Set(palavras(texto))].filter((p) => pg.has(p));
    if (!comuns.length) continue;
    let pontos = comuns.length * 3;
    const motivo: string[] = [comuns.join(", ")];
    const eT = e.grupo_rotulo?.match(/\d/)?.[0] ?? turmaDe(e.nome);
    if (gT && eT) { if (gT === eT) { pontos += 3; motivo.push(`G${gT}`); } else pontos -= 6; }
    const ida = e.data_embarque ? new Date(`${e.data_embarque}T12:00:00`) : null;
    const eA = ida ? ida.getFullYear() : anoDe(e.nome);
    if (gA && eA) { if (gA === eA) { pontos += 2; motivo.push(String(eA)); } else pontos -= 5; }
    if (gM.length && ida) {
      const m = ida.getMonth() + 1;
      if (gM.includes(m) || gM.includes(m === 12 ? 1 : m + 1)) { pontos += 1; motivo.push("mês"); } else pontos -= 3;
    }
    if (pontos >= 3) out.push({ expedicao: e, pontos, motivo: motivo.join(" · ") });
  }
  return out.sort((a, b) => b.pontos - a.pontos || (b.expedicao.data_embarque || "").localeCompare(a.expedicao.data_embarque || "")).slice(0, max);
}

// ── Mensagens agendadas ──────────────────────────────────────────────────────

export interface Agendada {
  id: string; grupo_jid: string; texto: string; anexo_url: string | null; anexo_nome: string | null; mencionar_todos: boolean;
  enviar_em: string; status: "pendente" | "enviando" | "enviada" | "erro" | "cancelada"; erro: string | null; criado_por: string | null; assinatura: string | null; enviada_em: string | null;
}
export async function agendadasDoGrupo(jid: string): Promise<Agendada[]> {
  if (tem0219 === false) return [];
  const { data, error } = await supabase.from("rel_wa_grupo_agendadas").select("*").eq("grupo_jid", jid)
    .order("enviar_em", { ascending: false }).limit(50);
  if (error) return [];
  return (data ?? []) as Agendada[];
}
export async function agendarNoGrupo(jid: string, p: { texto: string; enviarEm: Date; arquivo?: File | null; todos?: boolean }) {
  let anexo: Record<string, string> = {};
  if (p.arquivo) {
    const limite = limiteArquivoMB(p.arquivo.type);
    if (p.arquivo.size > limite * 1024 * 1024) throw new Error(`Arquivo maior que ${limite} MB.`);
    anexo = { url: await subirParaEnvio(p.arquivo), mimeType: p.arquivo.type || "application/octet-stream", fileName: p.arquivo.name };
  }
  return api<{ ok: boolean; id: string | null; ligado: boolean }>("POST", { acao: "agendar", jid, texto: p.texto, enviarEm: p.enviarEm.toISOString(), todos: !!p.todos, ...anexo });
}
export const cancelarAgendada = (id: string) => api("POST", { acao: "cancelar-agendada", id });

/** Fotos, vídeos, áudios e documentos que passaram pelo grupo (aba "Mídia"). */
export async function midiasDoGrupo(jid: string, limite = 120): Promise<MensagemGrupo[]> {
  const { data } = await supabase.from("rel_wa_grupo_mensagens").select("id,grupo_jid,msg_id,de_mim,autor_jid,autor_nome,tipo,texto,anexo_url,anexo_nome,enviado_por,criado_em")
    .eq("grupo_jid", jid).not("anexo_url", "is", null).is("apagada_em", null).order("criado_em", { ascending: false }).limit(limite);
  return (data ?? []) as MensagemGrupo[];
}
