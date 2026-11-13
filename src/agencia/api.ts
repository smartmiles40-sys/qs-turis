// src/agencia/api.ts — o portal da agência fala SÓ com /api/mkt-agencia (0395).
// Nada de Supabase aqui: a agência não é usuário do QS.
import type { ItemPlano, Periodicidade } from "@/mkt/planejamento/regras";

const CHAVE = "qs_agencia_sessao";

export function lerToken(): string | null {
  try { return localStorage.getItem(CHAVE); } catch { return null; }
}
export function guardarToken(t: string | null) {
  try { if (t) localStorage.setItem(CHAVE, t); else localStorage.removeItem(CHAVE); } catch { /* aba anônima: só não lembra */ }
}

export class SessaoExpirada extends Error {}

async function chamar<T>(acao: string, opts: { metodo?: "GET" | "POST"; corpo?: unknown; params?: Record<string, string> } = {}): Promise<T> {
  const q = new URLSearchParams({ acao, ...(opts.params ?? {}) });
  const token = lerToken();
  const r = await fetch(`/api/mkt-agencia?${q}`, {
    method: opts.metodo ?? (opts.corpo !== undefined ? "POST" : "GET"),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.corpo !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: opts.corpo !== undefined ? JSON.stringify(opts.corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && acao !== "login") { guardarToken(null); throw new SessaoExpirada(j.erro || "Sessão expirada."); }
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
  return j as T;
}

export interface PerfilAg { id: string; nome: string; rede: string; dono: string }
export interface PlanoResumo { id: string; titulo: string; periodicidade: Periodicidade; periodo_inicio: string; periodo_fim: string; status: string; rodada: number; enviado_em: string | null; decidido_em: string | null; criado_em: string }
export interface ObsAg { id: string; item_id: string | null; texto: string; time: string | null; rodada: number; resolvida: boolean; criado_em: string; autor_agencia: string | null; autor: string }
export interface PlanoAg extends PlanoResumo {
  documento_nome: string | null;
  ia_revisao: { etapa?: string; avisos?: (string | { conteudo: number | null; aviso: string })[]; pendencias?: string[]; resumo?: string } | null;
  itens: (ItemPlano & { id: string; card_id: string | null })[];
  obs: ObsAg[];
}
export interface CardAg {
  id: string; titulo: string; descricao: string | null; tipo: string; data_publicacao: string | null; horario: string | null;
  perfil_ids: string[]; link_producao: string | null; status_aprovacao: string; rodada: number;
  coluna: { tipo: string; nome: string } | null; comentarios: { texto: string; criado_em: string }[];
}

export const api = {
  login: (email: string, senha: string) => chamar<{ token: string; nome: string; agencia: string }>("login", { corpo: { email, senha } }),
  sair: () => chamar<{ ok: true }>("sair", { corpo: {} }),
  eu: () => chamar<{ nome: string; agencia: string; email: string }>("eu"),
  perfis: () => chamar<{ perfis: PerfilAg[] }>("perfis"),
  planejamentos: () => chamar<{ planejamentos: PlanoResumo[] }>("planejamentos"),
  planejamento: (id: string) => chamar<{ planejamento: PlanoAg }>("planejamento", { params: { id } }),
  criar: (d: { periodicidade: "semanal" | "mensal"; titulo: string; periodo_inicio: string; periodo_fim: string; pdf_base64?: string; nome_arquivo?: string; link?: string }) =>
    chamar<{ id: string }>("criar", { corpo: d }),
  salvar: (id: string, itens: ItemPlano[], titulo?: string) => chamar<{ ok: true }>("salvar", { corpo: { id, itens, titulo } }),
  enviar: (id: string) => chamar<{ ok: boolean; faltas?: string[] }>("enviar", { corpo: { id } }),
  responder: (id: string, texto: string, item_id?: string | null) => chamar<{ ok: true }>("responder", { corpo: { id, texto, item_id } }),
  producao: () => chamar<{ cards: CardAg[] }>("producao"),
  producaoEnviar: (card_id: string, link: string, comentario?: string) => chamar<{ ok: true }>("producao_enviar", { corpo: { card_id, link, comentario } }),
};
