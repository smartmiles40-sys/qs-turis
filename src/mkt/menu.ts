// src/mkt/menu.ts — regras PURAS do menu do Marketing (testadas em tests/mkt).
// Sem React e sem Supabase aqui, pra rodar no node:test.
//
// 13/11/2026 (Bruno: "dividir Time de Tráfego e Time de Orgânico, cada um com a
// sua visão, até pelos utilitários da esquerda"): o menu agora mostra a VISÃO de
// um time. Antes, quem aprovava via tudo — e com a 0266 todo o time aprova, então
// ninguém tinha menu próprio. Agora:
//   • Orgânico (ou Supervisor do Orgânico) → visão Orgânico;
//   • Tráfego (ou Supervisor do Tráfego) → visão Tráfego;
//   • quem está nos dois times troca de visão no topo da tela;
//   • gestor/admin troca entre Orgânico, Tráfego e Tudo;
//   • quem ainda não tem papel nenhum vê Tudo (ninguém some sem o gestor decidir).
// ESCONDE do menu; não é trava — a trava é a RLS no banco.

export type PapelMkt = "organico" | "trafego" | "gestor" | "sup_organico" | "sup_trafego";
export type TimeMkt = "organico" | "trafego";
export type VisaoMkt = TimeMkt | "tudo";

export const NOME_PAPEL_MKT: Record<PapelMkt, string> = {
  organico: "Orgânico",
  trafego: "Tráfego",
  sup_organico: "Supervisor do Orgânico",
  sup_trafego: "Supervisor do Tráfego",
  gestor: "Gestor de Marketing",
};
export const PAPEIS_MKT: PapelMkt[] = ["organico", "trafego", "sup_organico", "sup_trafego", "gestor"];
/** Papéis que só o gestor dá ou tira (o banco confere: mkt_definir_papeis, 0395). */
export const PAPEIS_ALTOS: PapelMkt[] = ["sup_organico", "sup_trafego", "gestor"];

export const NOME_VISAO: Record<VisaoMkt, string> = { organico: "Orgânico", trafego: "Tráfego", tudo: "Tudo" };

/** Times de quem tem esses papéis (supervisor conta como do time). */
export function timesDe(papeis: string[]): TimeMkt[] {
  const t: TimeMkt[] = [];
  if (papeis.includes("organico") || papeis.includes("sup_organico")) t.push("organico");
  if (papeis.includes("trafego") || papeis.includes("sup_trafego")) t.push("trafego");
  return t;
}

/** As visões que a pessoa pode escolher (a primeira é a padrão). */
export function visoesDe(papeis: string[], gestor: boolean): VisaoMkt[] {
  if (gestor) return ["tudo", "organico", "trafego"];
  const t = timesDe(papeis);
  return t.length ? t : ["tudo"];
}

/** A visão guardada vale? Senão, a padrão. */
export function visaoValida(guardada: string | null | undefined, opcoes: VisaoMkt[]): VisaoMkt {
  return opcoes.includes(guardada as VisaoMkt) ? (guardada as VisaoMkt) : opcoes[0];
}

/**
 * A rota aparece no menu nesta visão?
 *   sem `papeis` → de todos;  ['gestor'] → só gestor;
 *   visão Tudo → tudo (exceto as de gestor pra quem não é);
 *   senão, a rota precisa ser do time da visão.
 */
export function rotaVisivel(rotaPapeis: string[] | undefined, visao: VisaoMkt, gestor: boolean): boolean {
  if (!rotaPapeis || rotaPapeis.length === 0) return true;
  if (rotaPapeis.includes("gestor")) return gestor;
  if (visao === "tudo") return true;
  return rotaPapeis.includes(visao);
}

/** Agrupa as rotas na ordem dos grupos; grupo vazio some. */
export function agruparRotas<R extends { grupo: string; papeis?: string[] }>(
  rotas: R[], grupos: { id: string; rotulo: string }[], visao: VisaoMkt, gestor: boolean,
): { id: string; rotulo: string; rotas: R[] }[] {
  return grupos
    .map((g) => ({ ...g, rotas: rotas.filter((r) => r.grupo === g.id && rotaVisivel(r.papeis, visao, gestor)) }))
    .filter((g) => g.rotas.length > 0);
}
