// src/lib/qs/cadenceTeto.ts
// -----------------------------------------------------------------------------
// TETO DE ENTRADA: no máximo N leads NOVOS por dia, por SDR, em cada cadência.
//
// Por quê (revisão 27/10): em 24/10, 459 leads foram vinculados de uma vez ao
// "Resgate — Base Fria" na fila de uma SDR — 2.295 atividades caindo no mesmo
// dia. Ninguém dá conta disso, e a fila vira uma parede vermelha no dia seguinte.
//
// Como funciona: o 1º dia do plano de um lead cai, como sempre, no próximo dia
// de execução. Se aquele SDR já tem `teto` leads começando a cadência nesse dia,
// o lead começa no PRÓXIMO dia de execução — e o resto do plano anda junto.
// Os leads entram todos na hora (ficam com o SDR, aparecem na carteira); o que
// se espalha são as atividades.
//
// Quem conta: as tarefas do 1º dia do plano (tag "dia:N") já gravadas para o
// SDR nessa cadência, por data. Uma leitura por SDR; depois o alocador conta em
// memória — por isso a importação de CSV (que grava 5 em paralelo) não estoura.
//
// O lead que chega pelo SITE (api/_leads.js) não passa por aqui de propósito:
// lead quente não espera fila.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import { nextExecutionDay } from "@/lib/workHours";

/** Lê o teto da linha da cadência (a coluna pode nem existir sem a 0216). */
export function tetoDaCadencia(row: unknown): number | null {
  const v = (row as { teto_entrada_dia?: unknown } | null)?.teto_entrada_dia;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

/** Chave do dia no fuso do navegador (o time está em São Paulo). */
export function chaveDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface AlocadorEntrada {
  /**
   * Devolve a data em que o 1º dia do plano deste lead deve cair. `previsto` é
   * a data que ele teria sem teto. Mesma data = cabe hoje; data maior = foi
   * espalhado. ownerId nulo = sem teto (o dono ainda vai ser escolhido).
   */
  alocar(ownerId: string | null, previsto: Date): Promise<Date>;
  /** Quantos leads foram empurrados pra frente por este alocador. */
  espalhados(): number;
}

export function criarAlocadorEntrada(opts: {
  cadenceId: string;
  teto: number | null;
  primeiroDia: number;
  allowedWeekdays: number[];
}): AlocadorEntrada {
  const { cadenceId, teto, primeiroDia, allowedWeekdays } = opts;
  // ownerId → (dia → leads começando)
  const cargas = new Map<string, Promise<Map<string, number>>>();
  let empurrados = 0;

  async function carregar(ownerId: string, desde: Date): Promise<Map<string, number>> {
    const inicio = new Date(desde); inicio.setHours(0, 0, 0, 0);
    const porDia = new Map<string, Set<string>>();
    try {
      // Paginado: um SDR com uma base grande passa fácil de 1.000 linhas.
      for (let from = 0; from < 20000; from += 1000) {
        const { data, error } = await supabase
          .from("qs_tasks")
          .select("lead_id, scheduled_at")
          .eq("cadence_id", cadenceId)
          .eq("owner_id", ownerId)
          .eq("is_extra", false)
          .neq("status", "ignorada")
          .contains("tags", [`dia:${primeiroDia}`])
          .gte("scheduled_at", inicio.toISOString())
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        const rows = (data ?? []) as { lead_id: string; scheduled_at: string }[];
        for (const r of rows) {
          const k = chaveDia(new Date(r.scheduled_at));
          const s = porDia.get(k) ?? new Set<string>();
          s.add(r.lead_id);
          porDia.set(k, s);
        }
        if (rows.length < 1000) break;
      }
    } catch (err) {
      // Sem a contagem, melhor não segurar ninguém do que travar a entrada.
      console.warn("[QS] teto de entrada: não consegui contar a carga do SDR:", err);
    }
    const out = new Map<string, number>();
    porDia.forEach((s, k) => out.set(k, s.size));
    return out;
  }

  return {
    async alocar(ownerId, previsto) {
      if (!teto || !ownerId) return previsto;
      let p = cargas.get(ownerId);
      if (!p) { p = carregar(ownerId, previsto); cargas.set(ownerId, p); }
      const carga = await p;
      // Daqui pra baixo é síncrono: duas chamadas em paralelo não pegam a mesma vaga.
      let dia = new Date(previsto);
      for (let i = 0; i < 365; i++) {
        const k = chaveDia(dia);
        const n = carga.get(k) ?? 0;
        if (n < teto) {
          carga.set(k, n + 1);
          if (i > 0) empurrados++;
          return dia;
        }
        const prox = new Date(dia);
        prox.setDate(prox.getDate() + 1);
        dia = nextExecutionDay(prox, allowedWeekdays);
      }
      return dia;
    },
    espalhados: () => empurrados,
  };
}
