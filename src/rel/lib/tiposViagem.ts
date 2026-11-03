// src/rel/lib/tiposViagem.ts
// -----------------------------------------------------------------------------
// FILTRO POR TIPO DA LISTA DE VIAGENS (Bruno, 03/11: "pode juntar Viagens e
// Pacotes numa porta só"). A lista de Viagens ganhou uma 2ª fileira —
// Todos · Expedições · Pacotes · Aéreo · Hotel/Passeio · Seguro e outros —
// que combina com as filas de situação (Próximas, Em viagem, Minhas…).
//
// O filtro vai NA CONSULTA (a lista para em 500 linhas: filtrar no navegador
// esconderia resultado). Cada tipo vira UMA condição de coluna, sem `or=` —
// o `or=` já é da busca:
//   • os quatro primeiros: `servico in (...)`;
//   • "Seguro e outros": `acompanhamento in (nenhum, classificar)` — é a mesma
//     regra do rel_acompanhamento() (seguro/concierge/conta liminar/outro =
//     nenhum; sem serviço = classificar), e pega o serviço vazio, que um
//     `servico in` deixaria de fora (null nunca entra no IN).
//
// Lógica pura (sem supabase) pra ter teste: tests/viagens/tiposViagem.test.ts.
// -----------------------------------------------------------------------------
import type { Servico } from "./viagens";

export type TipoFiltro = "todos" | "expedicao" | "pacote" | "aereo" | "hotel" | "outros";

export const TIPOS_FILTRO: { id: TipoFiltro; rotulo: string; dica: string }[] = [
  { id: "todos", rotulo: "Todos", dica: "Tudo o que foi vendido" },
  { id: "expedicao", rotulo: "Expedições", dica: "Passageiros das expedições em grupo" },
  { id: "pacote", rotulo: "Pacotes", dica: "Pacotes personalizados (e cruzeiros)" },
  { id: "aereo", rotulo: "Aéreo", dica: "Só passagem aérea" },
  { id: "hotel", rotulo: "Hotel/Passeio", dica: "Hotel, passeio e transfer" },
  { id: "outros", rotulo: "Seguro e outros", dica: "Seguro, concierge, conta liminar, outros e o que falta classificar" },
];

/** Que serviços cada tipo junta (o "outros" é o resto, inclusive sem serviço). */
export const SERVICOS_DO_TIPO: Record<Exclude<TipoFiltro, "todos">, (Servico | null)[]> = {
  expedicao: ["expedicao"],
  pacote: ["pacote", "cruzeiro"],
  aereo: ["aereo"],
  hotel: ["hospedagem", "passeio"],
  outros: ["seguro", "concierge", "conta_liminar", "outro", null],
};

/** O tipo de uma venda pelo serviço (null = falta classificar → "outros"). */
export function tipoDoServico(s: Servico | null | undefined): Exclude<TipoFiltro, "todos"> {
  for (const [t, ss] of Object.entries(SERVICOS_DO_TIPO) as [Exclude<TipoFiltro, "todos">, (Servico | null)[]][]) {
    if (ss.includes(s ?? null)) return t;
  }
  return "outros";
}

/** A condição que vai na consulta. null = sem filtro (Todos). */
export function condicaoDoTipo(t: TipoFiltro): { coluna: "servico" | "acompanhamento"; valores: string[] } | null {
  if (t === "todos") return null;
  if (t === "outros") return { coluna: "acompanhamento", valores: ["nenhum", "classificar"] };
  return { coluna: "servico", valores: SERVICOS_DO_TIPO[t].filter((s): s is Servico => s !== null) };
}

/** Lê o `?tipo=` do endereço; valor estranho (ou nenhum) = Todos. */
export function lerTipo(v: string | null | undefined): TipoFiltro {
  return TIPOS_FILTRO.some((t) => t.id === v) ? (v as TipoFiltro) : "todos";
}
