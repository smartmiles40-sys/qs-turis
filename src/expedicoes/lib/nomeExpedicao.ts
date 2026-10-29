// src/expedicoes/lib/nomeExpedicao.ts
// -----------------------------------------------------------------------------
// NOME BASE + GRUPO (redesign 29/10, spec §4.3). Expedições irmãs (G1, G2, G3…)
// vêm com o grupo grudado no nome, em vários formatos:
//   "Japão & China - 2026 (Out/Nov) — G1"  → base "Japão & China - 2026 (Out/Nov)" + G1
//   "Tailândia - G2" · "Tailândia — G2" · "Tailândia G2" · "Tailândia (G2)"
//   "Islândia G1 - 2027"                   → base "Islândia - 2027" + G1
//   "Exp. Japão e China G2 - Out e Nov/26" → base "Exp. Japão e China - Out e Nov/26" + G2
//   "Turquia Grupo 3"                      → base "Turquia" + G3
// Na tela: nome base no título e o grupo num chip. O banco não muda.
// Lógica PURA (sem alias "@/") pra rodar no node:test.
// -----------------------------------------------------------------------------

export interface NomeExpedicao {
  /** Nome sem o sufixo/marca de grupo. */
  base: string;
  /** "G1", "G2"… ou null quando não é expedição dividida em grupos. */
  grupo: string | null;
}

// "G1", "G 1", "g2", "Grupo 3" como palavra solta, grupo de 1 a 9 (não pega "4G", "BG1", "G20").
const MARCA_GRUPO = /(^|[\s\-–—([/·|,])(?:g\s?|grupo\s+)(\d)(?=$|[\s\-–—)\]/·|,.:])/i;
const SEP = "[\\s\\-–—·|,:/]";

/** Normaliza o rótulo de grupo vindo do banco (grupo_rotulo): "1", "g1", "Grupo 1" → "G1". */
export function normalizarGrupo(rotulo: string | null | undefined): string | null {
  const m = /(\d{1,2})/.exec(rotulo ?? "");
  return m ? `G${Number(m[1])}` : null;
}

export function parseExpedicaoNome(raw: string | null | undefined): NomeExpedicao {
  const original = (raw ?? "").trim();
  const m = MARCA_GRUPO.exec(original);
  if (!m) return { base: original, grupo: null };
  const grupo = `G${Number(m[2])}`;
  const ini = m.index + m[1].length;
  const fim = ini + m[0].length - m[1].length;
  let antes = original.slice(0, ini);
  let depois = original.slice(fim);

  // "(G1)" / "[G1]": some com os parênteses.
  if (/[([]\s*$/.test(antes) && /^\s*[)\]]/.test(depois)) {
    antes = antes.replace(/[([]\s*$/, "");
    depois = depois.replace(/^\s*[)\]]/, "");
  }
  // Separadores grudados na marca: "X - G1" / "X — G1 - 2027" / "X G1 - 2027".
  const antesLimpo = antes.replace(new RegExp(`${SEP}+$`), "");
  const depoisLimpo = depois.replace(new RegExp(`^${SEP}+`), "");
  let base: string;
  if (!antesLimpo) base = depoisLimpo;
  else if (!depoisLimpo) base = antesLimpo;
  else {
    // Mantém UM separador entre as partes: o que vinha depois da marca, senão o de antes, senão espaço.
    const sepDepois = /^\s*([-–—·|,:/])/.exec(depois)?.[1];
    const sepAntes = /([-–—·|,:/])\s*$/.exec(antes)?.[1];
    const s = sepDepois ?? sepAntes;
    base = s ? `${antesLimpo} ${s} ${depoisLimpo}` : `${antesLimpo} ${depoisLimpo}`;
  }
  base = base.replace(/\s{2,}/g, " ").trim();
  return { base: base || original, grupo };
}

/**
 * Nome base + grupo de uma linha de `expedicoes`: o grupo_rotulo do banco (0029),
 * quando existe, vale mais que o que dá pra tirar do nome.
 */
export function nomeDaExpedicao(e: { nome: string; grupo_rotulo?: string | null }): NomeExpedicao {
  const p = parseExpedicaoNome(e.nome);
  return { base: p.base, grupo: normalizarGrupo(e.grupo_rotulo) ?? p.grupo };
}

/** "Tailândia G1 e G2", "Tailândia G1, G2 e G3", ou só "Peru". */
export function juntarGrupos(base: string, grupos: (string | null)[]): string {
  const gs = [...new Set(grupos.filter((g): g is string => !!g))]
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  if (!gs.length) return base;
  const lista = gs.length === 1 ? gs[0] : `${gs.slice(0, -1).join(", ")} e ${gs[gs.length - 1]}`;
  return `${base} ${lista}`;
}
