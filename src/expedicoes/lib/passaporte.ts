// src/expedicoes/lib/passaporte.ts
// -----------------------------------------------------------------------------
// VALIDADE DO PASSAPORTE — regra ÚNICA (redesign 29/10, spec §3.4).
// Antes havia duas contas: a prontidão (regras.ts) usava "volta + 6 meses" e a
// planilha de Passageiros / a aba Documentos usavam "embarque + 180 dias". A spec
// manda "vermelho se vencer menos de 6 meses após a volta" — vale esta, em todo lugar:
//
//   sem número ou sem validade          → "sem"
//   vence antes da volta                → "vence_na_viagem"  (bloqueia)
//   vence em menos de 6 meses da volta  → "vence_cedo"       (vermelho na matriz)
//   senão                               → "ok"
//
// Sem data de volta usa o embarque; sem nenhuma das duas não dá pra julgar (ok).
// Lógica PURA (sem alias "@/") pra rodar no node:test.
// -----------------------------------------------------------------------------

/** Meses de folga exigidos depois da VOLTA. Único lugar com esse número. */
export const MESES_VALIDADE_APOS_VOLTA = 6;

export type EstadoPassaporte = "sem" | "vence_na_viagem" | "vence_cedo" | "ok";

export interface ValidadePassaporte {
  estado: EstadoPassaporte;
  /** "YYYY-MM-DD" até quando o passaporte precisa valer (volta + 6 meses), ou null. */
  limite: string | null;
  /** "MM/AAAA" da validade, pra chip curto ("Válido · 02/2030"). */
  mesAno: string | null;
}

const iso = (d: string | null | undefined) => (d ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d)?.[0] ?? null : null);

/** Soma meses numa data "YYYY-MM-DD" sem fuso; o dia é ajustado ao fim do mês (31/08 + 6 = 28/02). */
export function somarMeses(dataIso: string, meses: number): string {
  const [y, m, d] = dataIso.slice(0, 10).split("-").map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

export function avaliarValidadePassaporte(p: { passaporte?: string | null; validade_passaporte?: string | null },
  exp: { data_embarque?: string | null; data_retorno?: string | null }): ValidadePassaporte {
  const validade = iso(p.validade_passaporte);
  const mesAno = validade ? `${validade.slice(5, 7)}/${validade.slice(0, 4)}` : null;
  if (!(p.passaporte ?? "").trim() || !validade) return { estado: "sem", limite: null, mesAno };
  const volta = iso(exp.data_retorno) ?? iso(exp.data_embarque);
  if (!volta) return { estado: "ok", limite: null, mesAno };
  const limite = somarMeses(volta, MESES_VALIDADE_APOS_VOLTA);
  if (validade < volta) return { estado: "vence_na_viagem", limite, mesAno };
  if (validade < limite) return { estado: "vence_cedo", limite, mesAno };
  return { estado: "ok", limite, mesAno };
}

/** Frase curta pro aviso da célula de validade. */
export function avisoPassaporte(v: ValidadePassaporte): string | null {
  if (v.estado === "vence_na_viagem") return "vence antes da volta";
  if (v.estado === "vence_cedo") return `< ${MESES_VALIDADE_APOS_VOLTA}m após a volta`;
  return null;
}
