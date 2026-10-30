// src/mkt/grupos/rotasAntigas.ts — até 30/10 os Grupos eram 5 entradas no menu
// (#mkt/grupos-campanhas, -cadencias, -celular, -chip). Viraram UMA página com abas;
// os links antigos (favoritos, mensagens no WhatsApp do time) continuam abrindo o lugar certo.
// Puro (sem React/DOM) pra dar pra testar.

const ANTIGAS: Record<string, Record<string, string>> = {
  "grupos-campanhas": {},
  "grupos-cadencias": { aba: "cadencias" },
  "grupos-celular": { aba: "celular" },
  "grupos-chip": { chip: "1" },
};

/** O hash novo pra um hash de rota antiga, ou null se não for rota antiga. */
export function hashNovoDaRotaAntiga(hash: string): string | null {
  const m = /^#\/?mkt\/(grupos-[a-z]+)(?:\/[^?]*)?(?:\?(.*))?$/.exec(hash);
  if (!m || !ANTIGAS[m[1]]) return null;
  const q = new URLSearchParams(m[2] || "");
  for (const [k, v] of Object.entries(ANTIGAS[m[1]])) q.set(k, v);
  const s = q.toString();
  return `#mkt/grupos${s ? `?${s}` : ""}`;
}
