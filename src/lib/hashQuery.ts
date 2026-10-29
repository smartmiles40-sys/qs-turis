// src/lib/hashQuery.ts
// -----------------------------------------------------------------------------
// Parâmetros DENTRO do hash (o QS roteia por hash: "#rel/cliente/<id>"). Pra dar
// pra compartilhar link de uma aba, filtro ou item aberto, o estado vai como
// query no fim do hash:  #rel/cliente/<id>?aba=documentos
//
// As áreas leem a rota com hashSemQuery() (ignora o "?…"). Trocar um parâmetro
// usa history.replaceState: não dispara "hashchange" (a tela não remonta) e não
// enche o "voltar" do navegador com cada clique em aba.
// -----------------------------------------------------------------------------

/** O hash sem o "#" do começo e sem a query ("rel/cliente/123"). */
export function hashSemQuery(hash: string = window.location.hash): string {
  return hash.replace(/^#\/?/, "").split("?")[0];
}

/** Os parâmetros da query do hash. */
export function paramsDoHash(hash: string = window.location.hash): URLSearchParams {
  const i = hash.indexOf("?");
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : "");
}

export function lerParamDoHash(nome: string): string | null {
  return paramsDoHash().get(nome);
}

/** Grava (ou apaga, com null/"") um parâmetro na query do hash, sem navegar. */
export function gravarParamNoHash(nome: string, valor: string | null | undefined) {
  const h = window.location.hash;
  const base = h.split("?")[0] || "#";
  const p = paramsDoHash(h);
  if (valor == null || valor === "") p.delete(nome); else p.set(nome, valor);
  const q = p.toString();
  const novo = window.location.pathname + window.location.search + base + (q ? `?${q}` : "");
  if (novo !== window.location.pathname + window.location.search + h) history.replaceState(history.state, "", novo);
}
