// src/mkt/grupos/linkRegras.ts — as regras do link inteligente que a TELA usa.
// Espelho de api/_mktGruposLinkRegras.js (o servidor não importa TS e a tela não
// importa os módulos da Vercel). tests/mkt-grupos/link.test.ts confere que os
// dois dão a mesma resposta.

export const CONVITE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}$/;
export const conviteValido = (u: string | null | undefined) => CONVITE.test(String(u || ""));

export function slugDe(texto: string): string {
  return String(texto || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60).replace(/-+$/g, "");
}
export const slugValido = (s: string) => s.length >= 3 && s.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);

export interface GrupoNoLink {
  grupo_jid: string;
  ordem: number;
  capacidade: number | null;
  membros: number | null;
  pendentes: number | null;
  link_convite: string | null;
  ativo: boolean;
  saiu_em: string | null;
}
export type Situacao = "recebendo" | "fila" | "lotado" | "sem_convite" | "saiu" | "desligado";

export const capacidadeDe = (g: { capacidade: number | null }, link: { capacidade: number }) =>
  Math.min(5000, Math.max(1, Number(g.capacidade ?? link.capacidade ?? 1000) || 1000));
export const ocupacaoDe = (g: { membros: number | null; pendentes: number | null }) =>
  Math.max(0, Number(g.membros ?? 0) || 0) + Math.max(0, Number(g.pendentes ?? 0) || 0);
const util = (g: GrupoNoLink) => g.ativo !== false && !g.saiu_em && conviteValido(g.link_convite);

/** Quem está recebendo agora (o mesmo critério da RPC do clique). */
export function grupoRecebendo<T extends GrupoNoLink>(link: { capacidade: number }, grupos: T[]): T | null {
  const ordenados = grupos.map((g, i) => ({ g, i })).filter(({ g }) => util(g))
    .sort((a, b) => ((a.g.ordem ?? 0) - (b.g.ordem ?? 0)) || (a.i - b.i));
  for (const { g } of ordenados) if (ocupacaoDe(g) + 1 <= capacidadeDe(g, link)) return g;
  return null;
}

export function situacaoDosGrupos<T extends GrupoNoLink>(link: { capacidade: number }, grupos: T[]) {
  const atual = grupoRecebendo(link, grupos);
  return grupos.map((g) => {
    let situacao: Situacao;
    if (g.ativo === false) situacao = "desligado";
    else if (g.saiu_em) situacao = "saiu";
    else if (!conviteValido(g.link_convite)) situacao = "sem_convite";
    else if (atual && g.grupo_jid === atual.grupo_jid) situacao = "recebendo";
    else if (ocupacaoDe(g) >= capacidadeDe(g, link)) situacao = "lotado";
    else situacao = "fila";
    return { ...g, situacao, capacidadeEfetiva: capacidadeDe(g, link), ocupacao: ocupacaoDe(g) };
  });
}

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  recebendo: "Recebendo agora", fila: "Na fila", lotado: "Lotado", sem_convite: "Sem link de convite", saiu: "O chip saiu", desligado: "Desligado",
};
