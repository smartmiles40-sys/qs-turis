/**
 * Fidelidade do passageiro: em que posição cronológica esta expedição entra na
 * história da pessoa com a agência (1ª, 2ª, 3ª...) e quais posições são "marco"
 * (3ª, 5ª, 10ª) — ganham destaque comemorativo na UI.
 *
 * Funções puras (sem acesso a banco) — testáveis isoladamente.
 */
import type { PessoaAgregada } from "@/expedicoes/lib/pessoas";

/** Posições que recebem destaque comemorativo. */
export const MARCOS_FIDELIDADE = [3, 5, 10] as const;

export function ehMarco(posicao: number | null | undefined): boolean {
  return posicao != null && (MARCOS_FIDELIDADE as readonly number[]).includes(posicao);
}

export type NivelFidelidade = {
  /** Nome do nível ("Estreante" → "Lenda"). */
  tier: string;
  /** Marcos já conquistados (subconjunto de [3,5,10]). */
  conquistados: number[];
  /** Próximo marco a alcançar, ou null se já passou de todos. */
  proximo: number | null;
  /** Quantas viagens faltam para o próximo marco. */
  faltam: number;
  /** Progresso 0..1 dentro da faixa atual (do marco anterior ao próximo). */
  progresso: number;
};

/** Nível de fidelidade de uma pessoa pelo total de expedições (estilo clube). */
export function nivelFidelidade(totalExpedicoes: number): NivelFidelidade {
  const marcos = MARCOS_FIDELIDADE as readonly number[];
  const n = Math.max(0, totalExpedicoes);
  const conquistados = marcos.filter((m) => n >= m);
  const proximo = marcos.find((m) => n < m) ?? null;
  const anterior = [0, ...marcos].filter((m) => m <= n).pop() ?? 0;
  const faltam = proximo != null ? proximo - n : 0;
  const progresso = proximo != null ? (n - anterior) / (proximo - anterior) : 1;
  const tier =
    n >= 10 ? "Lenda" : n >= 5 ? "Aventureiro" : n >= 3 ? "Explorador" : n >= 1 ? "Viajante" : "Estreante";
  return { tier, conquistados, proximo, faltam, progresso };
}

/** Ordinal feminino pt-BR (combina com "expedição"): 1 → "1ª". */
export function ordinalFem(n: number): string {
  return `${n}ª`;
}

/**
 * Mapa `passageiro_id` → posição cronológica desta expedição entre as
 * participações **não canceladas** da pessoa (1ª = a mais antiga por
 * `data_embarque`; empate desempata por `expedicao_id` pra ser estável).
 *
 * A chave é o `passageiro_id` da linha desta expedição, então a tabela de
 * passageiros pode olhar direto por `p.id`. Participação cancelada nesta
 * expedição fica de fora (não recebe posição).
 */
export function construirPosicoesFidelidade(
  pessoas: PessoaAgregada[],
  expedicaoId: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pessoa of pessoas) {
    const ativas = pessoa.expedicoes
      .filter((e) => e.status_reserva !== "Cancelado")
      .slice()
      .sort(
        (a, b) =>
          a.data_embarque.localeCompare(b.data_embarque) ||
          a.expedicao_id.localeCompare(b.expedicao_id),
      );
    const idx = ativas.findIndex((e) => e.expedicao_id === expedicaoId);
    if (idx >= 0) out[ativas[idx].passageiro_id] = idx + 1;
  }
  return out;
}
