// src/mkt/grupos/linkLib.ts — dados do LINK INTELIGENTE de grupo (0342).
// Configuração (link e a lista de grupos) a tela grava direto no banco (RLS +
// gatilho que protege os contadores). Cliques e membros só o servidor grava.
// Tudo que fala com o WhatsApp passa por /api/mkt-grupos (api() de ./lib).
import { supabase } from "@/lib/supabase";
import { api, type Grupo } from "./lib";

export interface LinkGrupos {
  id: string;
  slug: string;
  nome: string;
  ativo: boolean;
  capacidade: number;
  ao_lotar: "pagina" | "criar_grupo";
  mensagem_lotado: string | null;
  titulo_publico: string | null;
  descricao_publica: string | null;
  modelo_nome: string | null;
  modelo_descricao: string | null;
  modelo_foto_url: string | null;
  modelo_admins: string[];
  modelo_so_admins_enviam: boolean;
  modelo_so_admins_editam: boolean;
  criar_ao_pct: number;
  limite_auto: number;
  criados_auto: number;
  criando_em: string | null;
  ultimo_erro: string | null;
  cliques: number;
  ultimo_clique_em: string | null;
  criado_em: string;
}

export interface LinkGrupo {
  link_id: string;
  grupo_jid: string;
  ordem: number;
  capacidade: number | null;
  ativo: boolean;
  criado_auto: boolean;
  cliques: number;
  pendentes: number;
  lotou_em: string | null;
}

/** Grupo do link já com os dados do grupo (membros = participantes contados). */
export interface LinkGrupoCompleto extends LinkGrupo {
  nome: string | null;
  foto_url: string | null;
  membros: number | null;
  link_convite: string | null;
  saiu_em: string | null;
  contado_em: string | null;
  eu_admin: boolean | null;
}

export interface CliqueDia { link_id: string; dia: string; grupo_jid: string; cliques: number; unicos: number }
export interface MembrosDia { grupo_jid: string; dia: string; entradas: number; saidas: number; membros: number | null }

export const LINK_NOVO: Omit<LinkGrupos, "id" | "criados_auto" | "criando_em" | "ultimo_erro" | "cliques" | "ultimo_clique_em" | "criado_em"> = {
  slug: "", nome: "", ativo: true, capacidade: 1000, ao_lotar: "pagina", mensagem_lotado: null,
  titulo_publico: null, descricao_publica: null, modelo_nome: null, modelo_descricao: null, modelo_foto_url: null,
  modelo_admins: [], modelo_so_admins_enviam: true, modelo_so_admins_editam: true, criar_ao_pct: 90, limite_auto: 10,
};

const ok = <T,>(r: { data: T | null; error: { message: string; code?: string } | null }): T => {
  if (r.error) {
    if (r.error.code === "23505") throw new Error("Esse endereço já existe. Escolha outro.");
    if (r.error.code === "42P01") throw new Error("O banco ainda não tem o link inteligente (falta aplicar a 0342).");
    throw new Error(r.error.message);
  }
  return (r.data ?? ([] as unknown)) as T;
};

/** Endereço público do link (no domínio em que o QS está aberto). */
export const urlDoLink = (slug: string) => `${window.location.origin}/g/${slug}`;

export async function lerLinks(): Promise<LinkGrupos[]> {
  return ok(await supabase.from("mkt_grupos_links").select("*").order("criado_em", { ascending: false }).limit(500)) as LinkGrupos[];
}
export async function lerItensDosLinks(): Promise<LinkGrupo[]> {
  return ok(await supabase.from("mkt_grupos_link_grupos").select("*").order("ordem").limit(5000)) as LinkGrupo[];
}

/** Junta a linha do link com os dados do grupo. */
export function completar(itens: LinkGrupo[], grupos: Grupo[]): LinkGrupoCompleto[] {
  const porJid = new Map(grupos.map((g) => [g.jid, g]));
  return itens.map((i) => {
    const g = porJid.get(i.grupo_jid) as (Grupo & { contado_em?: string | null }) | undefined;
    return {
      ...i, nome: g?.nome ?? null, foto_url: g?.foto_url ?? null, membros: g?.participantes ?? null,
      link_convite: g?.link_convite ?? null, saiu_em: g?.saiu_em ?? null, contado_em: g?.contado_em ?? null, eu_admin: g?.eu_admin ?? null,
    };
  }).sort((a, b) => a.ordem - b.ordem);
}

type CamposLink = Partial<Omit<LinkGrupos, "id" | "criados_auto" | "criando_em" | "ultimo_erro" | "cliques" | "ultimo_clique_em" | "criado_em">>;
export async function salvarLink(campos: CamposLink, id?: string): Promise<LinkGrupos> {
  const r = id
    ? await supabase.from("mkt_grupos_links").update(campos).eq("id", id).select("*").single()
    : await supabase.from("mkt_grupos_links").insert(campos).select("*").single();
  return ok(r) as LinkGrupos;
}
export async function apagarLink(id: string) { ok(await supabase.from("mkt_grupos_links").delete().eq("id", id)); }

export async function porGrupoNoLink(linkId: string, grupoJid: string, ordem: number) {
  ok(await supabase.from("mkt_grupos_link_grupos").upsert({ link_id: linkId, grupo_jid: grupoJid, ordem }, { onConflict: "link_id,grupo_jid", ignoreDuplicates: true }));
}
export async function mudarGrupoNoLink(linkId: string, grupoJid: string, campos: Partial<Pick<LinkGrupo, "ordem" | "capacidade" | "ativo">>) {
  ok(await supabase.from("mkt_grupos_link_grupos").update(campos).eq("link_id", linkId).eq("grupo_jid", grupoJid));
}
export async function tirarGrupoDoLink(linkId: string, grupoJid: string) {
  ok(await supabase.from("mkt_grupos_link_grupos").delete().eq("link_id", linkId).eq("grupo_jid", grupoJid));
}

/** Últimos N dias (cliques do link e entradas/saídas dos grupos dele). */
export async function lerRelatorio(linkId: string, jids: string[], dias = 30): Promise<{ cliques: CliqueDia[]; membros: MembrosDia[] }> {
  const desde = new Date(Date.now() - dias * 86400_000).toISOString().slice(0, 10);
  const [c, m] = await Promise.all([
    supabase.from("mkt_grupos_link_dia").select("*").eq("link_id", linkId).gte("dia", desde).order("dia").limit(1000),
    jids.length
      ? supabase.from("mkt_grupos_membros_dia").select("*").in("grupo_jid", jids).gte("dia", desde).order("dia").limit(1000)
      : Promise.resolve({ data: [] as MembrosDia[], error: null }),
  ]);
  return { cliques: ok(c) as CliqueDia[], membros: ok(m) as MembrosDia[] };
}

/** Os dias de [hoje-n+1 .. hoje] em São Paulo, AAAA-MM-DD. */
export function ultimosDias(n: number, hoje = new Date()): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(fmt.format(new Date(hoje.getTime() - i * 86400_000)));
  return [...new Set(out)];
}

// ── Servidor ──
export const contarAgora = (linkId: string) => api<{ contados?: number; parado?: string; falhas?: number }>("link_contar", { link_id: linkId });
export const criarProximoAgora = (linkId: string) => api<{ grupo: { jid: string; nome: string; convite: string | null; avisos: string[] } }>("link_criar_grupo", { link_id: linkId });
export const buscarConvite = (jid: string) => api<{ link: string | null }>("convite", { jid });
