// src/expedicoes/lib/cache.ts
// -----------------------------------------------------------------------------
// MEMÓRIA CURTA DAS LEITURAS GRANDES (22/10/2026). O banco responde em 1–6 ms;
// o que deixava as Expedições pesadas era o navegador baixar as MESMAS tabelas
// várias vezes por tela (Início puxava os passageiros 2x, a aba Passageiros e a
// Visão Geral baixavam a base inteira só pra "Nª viagem", o menu recalculava os
// avisos a cada edição de qualquer pessoa…).
//
// Aqui: uma promessa por chave (quem pedir enquanto carrega pega a mesma) e
// validade de 60 s. Cada entrada diz de quais TABELAS depende; quando o realtime
// avisa mudança numa delas (useAoVivo / ExpProvider) ou a própria tela acabou de
// salvar (`esquecer`), a entrada cai e a próxima leitura vai ao banco.
// Quem recebe o valor NÃO deve mexer nele (é compartilhado) — copie antes de ordenar.
// -----------------------------------------------------------------------------

const VALIDADE_MS = 60_000;

type Entrada = { promessa: Promise<unknown>; em: number; tabelas: readonly string[] };
const guardados = new Map<string, Entrada>();

/** Lê pela memória (se ainda vale) ou chama `carregar` uma vez só, mesmo com vários pedidos juntos. */
export function lembrar<T>(chave: string, tabelas: readonly string[], carregar: () => Promise<T>, validadeMs = VALIDADE_MS): Promise<T> {
  const e = guardados.get(chave);
  if (e && Date.now() - e.em < validadeMs) return e.promessa as Promise<T>;
  const promessa = carregar();
  const entrada: Entrada = { promessa, em: Date.now(), tabelas };
  guardados.set(chave, entrada);
  // Erro não fica guardado: o próximo pedido tenta de novo.
  promessa.catch(() => { if (guardados.get(chave) === entrada) guardados.delete(chave); });
  return promessa;
}

/** Derruba o que depende destas tabelas (sem argumento: tudo). */
export function esquecer(...tabelas: string[]): void {
  for (const [chave, e] of guardados) {
    if (tabelas.length === 0 || e.tabelas.some((t) => tabelas.includes(t))) guardados.delete(chave);
  }
}
