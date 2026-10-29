// src/components/ui/nomeCliente.ts
// -----------------------------------------------------------------------------
// Nome de cliente LIMPO (spec 29/10): muita ficha veio do Bitrix com prefixo de
// campanha no nome — "[V4] (STFV) Roselene Pereira". Na tela isso vira:
//   nome  = "Roselene Pereira"   (iniciais "RP", não "[(")
//   tags  = ["V4", "STFV"]       (chips cinzas ao lado do nome)
// Só o COMEÇO do nome é olhado: parênteses no meio ("Maria (mãe)") ficam.
// O banco não muda — é só leitura bonita.
// -----------------------------------------------------------------------------

export interface NomeCliente { name: string; tags: string[] }

const PREFIXO = /^\s*(?:\[([^\]]*)\]|\(([^)]*)\))\s*[-–—:|·]?\s*/;

export function parseClientName(raw: string | null | undefined): NomeCliente {
  let resto = (raw ?? "").trim();
  const tags: string[] = [];
  for (let i = 0; i < 6; i++) {
    const m = PREFIXO.exec(resto);
    if (!m) break;
    const dentro = (m[1] ?? m[2] ?? "").trim();
    for (const t of dentro.split(/\s*[,/;]\s*/)) if (t) tags.push(t);
    resto = resto.slice(m[0].length);
  }
  const name = resto.trim();
  // Nome que era SÓ prefixo ("[V4]"): mostra o que veio, sem inventar.
  if (!name) return { name: (raw ?? "").trim(), tags: [] };
  return { name, tags };
}

/** Atalho: só o nome limpo. */
export const nomeLimpo = (raw: string | null | undefined) => parseClientName(raw).name;

/** Iniciais pelo nome limpo ("[V4] (STFV) Roselene Pereira" → "RP"). */
export function iniciaisDe(raw: string | null | undefined): string {
  return parseClientName(raw).name.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)).slice(0, 2)
    .map((p) => (p.match(/[\p{L}\p{N}]/u)?.[0] ?? "")).join("").toUpperCase() || "?";
}
