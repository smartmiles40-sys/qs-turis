// src/rel/clientes/passaporte.ts
// -----------------------------------------------------------------------------
// Contas e formatos do "passaporte do cliente" (Viagens com a gente).
// Só funções puras — nada de banco aqui.
// -----------------------------------------------------------------------------
import { lugaresDe, type Lugar } from "../viagens/destinos";
import type { Viagem } from "../lib/viagens";

export const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "12 out" */
export const diaMes = (d: string) => `${Number(d.slice(8, 10))} ${MESES[Number(d.slice(5, 7)) - 1]}`;
/** "mar/2023" */
export const mesAno = (d: string) => `${MESES[Number(d.slice(5, 7)) - 1]}/${d.slice(0, 4)}`;
/** "12 out 2026" */
export const diaMesAno = (d: string) => `${diaMes(d)} ${d.slice(0, 4)}`;

/** "12/10, 14:30" no fuso do time. */
export const horaCurta = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const diaUTC = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** Dias entre duas datas AAAA-MM-DD (b - a). */
export const diasEntre = (a: string, b: string) => Math.round((diaUTC(b) - diaUTC(a)) / 86_400_000);

/** Duração contando ida e volta (12 → 26 = 15 dias). */
export function duracaoDias(v: Pick<Viagem, "data_embarque" | "data_retorno">): number | null {
  if (!v.data_embarque || !v.data_retorno) return null;
  const n = diasEntre(v.data_embarque, v.data_retorno) + 1;
  return n > 0 ? n : null;
}

export type Situacao = "proxima" | "em_viagem" | "realizada" | "cancelada" | "sem_data";

export function situacao(v: Pick<Viagem, "status" | "fase">): Situacao {
  if (v.status === "cancelada" || v.fase === "cancelada") return "cancelada";
  if (v.fase === "em_viagem") return "em_viagem";
  if (v.fase === "concluida") return "realizada";
  if (v.fase === "antes") return "proxima";
  return "sem_data";
}

/** O destino "de capa": os lugares reconhecidos (até 3) ou o texto limpo. */
export function nomeDestino(v: Pick<Viagem, "destino" | "titulo">): { principal: string; lugares: Lugar[] } {
  let lugares = lugaresDe(v.destino);
  if (!lugares.length) lugares = lugaresDe(v.titulo);
  if (lugares.length) {
    const nomes = lugares.slice(0, 3).map((l) => l.nome);
    return { principal: nomes.join(" · ") + (lugares.length > 3 ? ` +${lugares.length - 3}` : ""), lugares };
  }
  const bruto = (v.destino || v.titulo || "Viagem").split(/[:.]/)[0].trim();
  return { principal: bruto || "Viagem", lugares };
}

/** Duas linhas de "zona de leitura" de passaporte (decorativo, aria-hidden). */
export function zonaDeLeitura(nome: string, realizadas: number, futuras: number, destinos: number): [string, string] {
  const partes = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").trim().split(/\s+/).filter(Boolean);
  const primeiro = partes[0] ?? "VIAJANTE";
  const sobrenome = partes.length > 1 ? partes.slice(1).join("<") : primeiro;
  const l1 = `P<BRA${sobrenome}<<${partes.length > 1 ? primeiro : ""}`.padEnd(44, "<").slice(0, 44);
  const n = (x: number) => String(Math.min(x, 99)).padStart(2, "0");
  const l2 = `STFV${n(realizadas)}<<${n(futuras)}<<${n(destinos)}<<SETUFOREUVOU`.padEnd(44, "<").slice(0, 44);
  return [l1, l2];
}
