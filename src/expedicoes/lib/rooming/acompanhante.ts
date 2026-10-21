/**
 * Comparação entre o acompanhante INDICADO na inscrição (texto livre) e os
 * companheiros REAIS de quarto (alocação do Rooming). Mesma lógica de parsing/
 * normalização usada no RoomingBoard, extraída pra reuso.
 */

/** Minúsculas, sem acento, espaços colapsados. */
export function normalizarNome(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Quebra o texto de acompanhante em nomes individuais (vírgula, ";", "e", "&", "/"). */
export function nomesAcompanhante(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s*,\s*|\s*;\s*|\s+e\s+|\s*&\s*|\s*\/\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

export type ConfereAcompanhante = "sem_indicacao" | "bate" | "nao_bate";

/** Conectivos que não valem como "sobrenome" na comparação. */
const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "e", "di", "del", "la", "van", "von"]);

/** Tokens significativos de um nome (sem acento, sem conectivos, >= 2 letras). */
function tokensNome(s: string | null | undefined): string[] {
  return normalizarNome(s).split(" ").filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * O acompanhante indicado está entre os companheiros reais de quarto?
 * Casa por SOBREPOSIÇÃO DE TOKENS (nome/sobrenome), tolerando grafias diferentes
 * ("Renzo Godoy" ≈ "Renzo Gonçalves de Godoy"): nomes com ≥2 tokens exigem ≥2 em
 * comum; nome com 1 token só exige esse token presente.
 * - "sem_indicacao": não indicou ninguém.
 * - "bate": ao menos um nome indicado casa com um companheiro.
 * - "nao_bate": indicou, mas nenhum indicado está no quarto.
 */
export function conferirAcompanhante(
  indicadoRaw: string | null | undefined,
  companheiros: string[],
): ConfereAcompanhante {
  const nomes = nomesAcompanhante(indicadoRaw);
  if (nomes.length === 0) return "sem_indicacao";
  const compTokens = companheiros.map((c) => new Set(tokensNome(c)));
  const bate = nomes.some((n) => {
    const nt = tokensNome(n);
    if (nt.length === 0) return false;
    const necessario = Math.min(2, nt.length);
    return compTokens.some((cs) => nt.filter((t) => cs.has(t)).length >= necessario);
  });
  return bate ? "bate" : "nao_bate";
}
