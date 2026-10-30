// src/mkt/menu.ts — regras PURAS do menu do Marketing (testadas em tests/mkt).
// Sem React e sem Supabase aqui, pra rodar no node:test.

export type PapelMkt = "organico" | "trafego" | "gestor";

export const NOME_PAPEL_MKT: Record<PapelMkt, string> = {
  organico: "Orgânico",
  trafego: "Tráfego",
  gestor: "Gestor de Marketing (aprova)",
};
export const PAPEIS_MKT: PapelMkt[] = ["organico", "trafego", "gestor"];

/**
 * A rota aparece no menu? Gestor (aprovador, inclui admin) vê tudo; quem ainda
 * não tem papel definido também vê tudo (o gestor não configurou → ninguém some).
 * Senão, a rota sem `papeis` é de todos e a com `papeis` precisa de um em comum.
 */
export function rotaVisivel(rotaPapeis: string[] | undefined, meusPapeis: string[], aprovador: boolean): boolean {
  if (aprovador || !rotaPapeis || rotaPapeis.length === 0 || meusPapeis.length === 0) return true;
  return rotaPapeis.some((p) => meusPapeis.includes(p));
}

/** Agrupa as rotas na ordem dos grupos; grupo vazio some. */
export function agruparRotas<R extends { grupo: string; papeis?: string[] }>(
  rotas: R[], grupos: { id: string; rotulo: string }[], meusPapeis: string[], aprovador: boolean,
): { id: string; rotulo: string; rotas: R[] }[] {
  return grupos
    .map((g) => ({ ...g, rotas: rotas.filter((r) => r.grupo === g.id && rotaVisivel(r.papeis, meusPapeis, aprovador)) }))
    .filter((g) => g.rotas.length > 0);
}
