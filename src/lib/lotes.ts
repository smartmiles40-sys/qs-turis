// src/lib/lotes.ts
// -----------------------------------------------------------------------------
// Corta uma lista em lotes (pro `.in()` do PostgREST não estourar a URL).
//
// 04/11 (sistema pesado): o QS inteiro fazia
//     for (lote...) { await supabase...in(lote) }
// — um lote DEPOIS do outro. Com 6 lotes de 0,3 s eram 1,8 s esperando em fila.
// O padrão agora é disparar os lotes juntos:
//     const rs = await Promise.all(lotes(ids, 200).map((l) => supabase...in(l)));
//     for (const { data, error } of rs) { ...mesmo corpo de antes... }
// -----------------------------------------------------------------------------

export function lotes<T>(itens: T[], tamanho: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push(itens.slice(i, i + tamanho));
  return out;
}
