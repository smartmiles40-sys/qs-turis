// src/mkt/conteudo/idsAntigos.ts
// -----------------------------------------------------------------------------
// Links antigos do Marketing continuam abrindo (30/10/2026). O menu encolheu:
// "Equipe e papéis" + "Colunas do quadro" viraram UMA tela (Ajustes, com abas) e
// as 6 telas de e-mail viraram UMA (E-mail, com abas). Quem tinha o link velho
// salvo (#mkt/colunas, #mkt/email-modelos…) cai na tela nova, na aba certa.
//
// A tradução é PURA (testada em tests/mkt/ids-antigos.test.ts). instalar() troca
// o endereço com replaceState ANTES de a área ler a rota (roda quando o módulo
// das rotas carrega) e de novo a cada "hashchange".
// -----------------------------------------------------------------------------

export interface Destino { tela: string; params?: Record<string, string> }
export type MapaIdsAntigos = Record<string, Destino>;

/** As telas antigas do conteúdo → Ajustes. */
export const IDS_ANTIGOS_CONTEUDO: MapaIdsAntigos = {
  equipe: { tela: "ajustes" },
  colunas: { tela: "ajustes", params: { aba: "colunas" } },
};

/**
 * "#mkt/colunas" → "#mkt/ajustes?aba=colunas". Devolve null quando o hash não é
 * de uma tela antiga (aí não mexe em nada). Mantém os outros parâmetros da query.
 */
export function traduzirHash(hash: string, prefixo: string, mapa: MapaIdsAntigos): string | null {
  const limpo = hash.replace(/^#\/?/, "");
  const [rota, query = ""] = limpo.split("?");
  const [area, tela] = rota.split("/");
  if (area !== prefixo || !tela || !Object.prototype.hasOwnProperty.call(mapa, tela)) return null;
  const d = mapa[tela];
  const p = new URLSearchParams(query);
  for (const [k, v] of Object.entries(d.params ?? {})) p.set(k, v);
  const q = p.toString();
  return `#${prefixo}/${d.tela}${q ? `?${q}` : ""}`;
}

export function instalarIdsAntigos(prefixo: string, mapa: MapaIdsAntigos) {
  if (typeof window === "undefined") return;
  const corrigir = () => {
    const novo = traduzirHash(window.location.hash, prefixo, mapa);
    if (!novo) return;
    history.replaceState(history.state, "", window.location.pathname + window.location.search + novo);
    // Avisa quem já está ouvindo a rota (replaceState sozinho não dispara o evento).
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  corrigir();
  window.addEventListener("hashchange", corrigir);
}
