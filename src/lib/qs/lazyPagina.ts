// src/lib/qs/lazyPagina.ts
// -----------------------------------------------------------------------------
// PÁGINA PREGUIÇOSA QUE SOBREVIVE A DEPLOY.
//
// O problema real, visto em produção: a SDR deixa o CRM aberto o dia inteiro.
// Sai um deploy. O `index.html` que o navegador dela carregou de manhã aponta
// pra `assets/SettingsPage-BEcnQSJ0.js`; o build novo gerou outro hash e o
// arquivo antigo deixou de existir. Aí ela clica em Configurações e leva um
//
//     Failed to fetch dynamically imported module: .../SettingsPage-….js
//
// A tela morre e não tem nada que ela possa fazer além de adivinhar que precisa
// dar Ctrl+Shift+R.
//
// O conserto é o único possível pelo lado do cliente: quando o import falha,
// RECARREGAR a página uma vez — assim o navegador busca o index.html novo, com
// os hashes novos, e cai exatamente na tela que ela pediu.
//
// A trava contra laço é essencial: se o import falhar por um motivo que o reload
// não resolve (rede caída, servidor fora), sem ela a página entra em loop de
// recarga. Por isso a marca no sessionStorage, com validade curta: um deploy
// resolve na primeira tentativa; o que insiste vira erro de verdade na tela.
// -----------------------------------------------------------------------------

import { lazy, type ComponentType } from "react";

const CHAVE = "qs_reload_chunk";
/** Janela em que um reload já feito conta como "já tentei". */
const VALIDADE_MS = 30_000;

/** Falha de carregamento de chunk (deploy novo), e não erro do módulo em si. */
function ehChunkSumido(erro: unknown): boolean {
  const msg = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(msg);
}

function jaRecarregou(): boolean {
  try {
    const marca = Number(sessionStorage.getItem(CHAVE) ?? 0);
    return marca > 0 && Date.now() - marca < VALIDADE_MS;
  } catch {
    // sessionStorage bloqueado (modo restrito): sem trava confiável, não recarrega.
    return true;
  }
}

function marcarReload(): void {
  try { sessionStorage.setItem(CHAVE, String(Date.now())); } catch { /* ignora */ }
}

export function limparMarcaDeReload(): void {
  try { sessionStorage.removeItem(CHAVE); } catch { /* ignora */ }
}

/**
 * 24/11 (Hugo não abria o QS; na anônima abria): a Vercel manda o 404 de
 * /assets/* com "immutable, 1 ano". O navegador que pediu um arquivo na troca
 * de versão guarda esse 404 e recarregar NÃO resolve — pede de novo e recebe o
 * 404 guardado. `fetch(url, { cache: "reload" })` vai na rede e TROCA a entrada
 * guardada pela resposta nova. Faz isso no arquivo do erro e em todo /assets/
 * que a página viu falhar, antes do reload. Nunca lança; no máximo 4 s.
 */
export async function refrescarAssetsQuebrados(erro?: unknown): Promise<void> {
  try {
    const urls = new Set<string>();
    const msg = erro instanceof Error ? erro.message : String(erro ?? "");
    for (const m of msg.match(/https?:\/\/[^\s'"()]+\/assets\/[^\s'"()]+/g) ?? []) urls.add(m);
    for (const e of performance.getEntriesByType("resource") as (PerformanceResourceTiming & { responseStatus?: number })[]) {
      if (!e.name.includes("/assets/")) continue;
      const st = e.responseStatus;
      // responseStatus (Chrome 109+) diz o código; sem ele, 0 bytes e sem corpo = suspeito.
      if ((typeof st === "number" && st >= 400) || (st === undefined && e.transferSize === 0 && e.decodedBodySize === 0)) urls.add(e.name);
    }
    if (!urls.size) return;
    const tempo = new Promise<void>((r) => setTimeout(r, 4000));
    await Promise.race([
      Promise.all([...urls].map((u) => fetch(u, { cache: "reload" }).catch(() => null))).then(() => undefined),
      tempo,
    ]);
  } catch { /* ignora: o reload segue de qualquer jeito */ }
}

/**
 * Igual ao `lazy()` do React, mas se o chunk sumiu (deploy novo enquanto a aba
 * estava aberta) recarrega a página uma vez em vez de mostrar tela quebrada.
 */
// `ComponentType<any>` é a mesma assinatura do `lazy()` do React: com
// `unknown` no lugar, TODA página passaria a não aceitar prop nenhuma.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPagina<T extends ComponentType<any>>(
  importar: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      const mod = await importar();
      limparMarcaDeReload();
      return mod;
    } catch (erro) {
      if (ehChunkSumido(erro) && !jaRecarregou()) {
        marcarReload();
        await refrescarAssetsQuebrados(erro);
        window.location.reload();
        // A página já está indo embora: esta promise nunca resolve de propósito,
        // pra não piscar um erro no meio do recarregamento.
        return new Promise<{ default: T }>(() => {});
      }
      throw erro;
    }
  });
}
