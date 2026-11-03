// src/rel/lib/conferencia.ts
// -----------------------------------------------------------------------------
// REVISÃO MANUAL DOS VOOS + O QUE JÁ ACONTECEU (03/11/2026, Bruno: "é um sistema
// e eles têm que fazer a revisão manual, e o que já aconteceu eles têm que tirar
// também").
//   • conferidosDoHistorico — "Conferi ✓" de cada trecho, tirado do histórico de
//     correções (0310: acao 'trecho_conferido'). A última conferência valendo
//     manda; corrigir o trecho DEPOIS de conferido anula (tem que conferir de novo).
//   • jaAconteceu — trecho que já passou (voado, chegada/check-out no passado):
//     sai da lista principal do roteiro e não conta como pendência.
//   • contarConferidos — o "X de Y voos conferidos".
// Função PURA, sem import de runtime (testada em tests/viagens/conferencia.test.ts).
// -----------------------------------------------------------------------------

export interface LinhaHistorico {
  id: string;
  trecho_id: string | null;
  acao: string;
  depois: Record<string, unknown>;
  feito_em: string;
  feito_por_nome?: string | null;
  desfeita_em: string | null;
}

export interface Conferencia { id: string; por: string | null; em: string }

/** trecho → quem conferiu e quando (só os que estão conferidos AGORA). */
export function conferidosDoHistorico(hist: LinhaHistorico[]): Map<string, Conferencia> {
  const ord = hist.filter((c) => c.trecho_id && !c.desfeita_em).sort((a, b) => a.feito_em.localeCompare(b.feito_em));
  const m = new Map<string, Conferencia>();
  for (const c of ord) {
    const id = c.trecho_id!;
    if (c.acao === "trecho_conferido") {
      if (c.depois?.conferido === false) m.delete(id);
      else m.set(id, { id: c.id, por: c.feito_por_nome ?? null, em: c.feito_em });
    } else if (c.acao === "trecho_editado") {
      // mudou data/rota/nº depois de conferido: a conferência não vale mais
      m.delete(id);
    }
  }
  return m;
}

export interface TrechoTempo {
  tipo: string;
  partida_em: string;
  chegada_em?: string | null;
  fonte?: string | null;
  status_manual?: string | null;
}

/**
 * O trecho já aconteceu? Voo voado (à mão ou pelo horário) ou com a chegada no
 * passado; hotel com o check-out no passado; o resto, pelo fim (chegada ou
 * partida). Do Pós-Venda do Bitrix só vale o DIA (a hora é de mentira): conta
 * até o fim daquele dia. Cancelado não "aconteceu" — é tirado (outro bloco).
 */
export function jaAconteceu(t: TrechoTempo, agora: number, estado?: string | null): boolean {
  if (t.status_manual === "cancelado" || estado === "cancelado") return false;
  if (t.status_manual === "voado" || estado === "voado") return true;
  const fim = Date.parse(t.chegada_em || t.partida_em);
  if (!Number.isFinite(fim)) return false;
  const folga = t.fonte === "bitrix" ? 24 * 3600_000 : 0;
  return fim + folga < agora;
}

/** "X de Y voos conferidos" — só os que ainda valem: válidos, não cancelados, não acontecidos. */
export function contarConferidos(voos: { id: string; valido: boolean; cancelado?: boolean; passou?: boolean; conferido?: boolean }[]):
  { conferidos: number; total: number } {
  const vivos = voos.filter((v) => v.valido && !v.cancelado && !v.passou);
  return { conferidos: vivos.filter((v) => v.conferido).length, total: vivos.length };
}
