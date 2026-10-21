import { format, formatDistanceToNow, parseISO, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";


export function formatBRL(value: number | null | undefined, fractionDigits = 2): string {
  if (value == null || isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatMoney(value: number | null | undefined, moeda: string = "BRL"): string {
  if (value == null || isNaN(value)) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: moeda,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${moeda} ${value.toFixed(2)}`;
  }
}

export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value == null || isNaN(value)) return "—";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatDate(date: string | Date | null | undefined, fmt = "dd/MM/yyyy"): string {
  if (!date) return "—";
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, fmt, { locale: ptBR });
}

export function formatDateTime(date: string | Date | null | undefined): string {
  return formatDate(date, "dd/MM/yyyy HH:mm");
}

/** Máscara PROGRESSIVA de telefone BR: (XX) XXXXX-XXXX (celular) ou (XX) XXXX-XXXX (fixo). */
export function mascaraTelefone(valor: string): string {
  const d = (valor ?? "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  if (resto.length <= 4) return `(${ddd}) ${resto}`;
  const corte = d.length > 10 ? 5 : 4; // 11 díg = celular (5-4); 10 díg = fixo (4-4)
  return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
}

export function relativeDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? parseISO(date) : date;
  return formatDistanceToNow(d, { addSuffix: true, locale: ptBR });
}

export function daysUntil(date: string | Date | null | undefined): number | null {
  if (!date) return null;
  const d = typeof date === "string" ? parseISO(date) : date;
  return differenceInDays(d, new Date());
}

/**
 * Se o passageiro faz aniversário DURANTE a viagem, retorna a data (ISO YYYY-MM-DD)
 * do aniversário dentro do período e a idade que fará; senão null. Campo "inteligente":
 * calculado a partir do nascimento + datas da expedição.
 */
export function aniversarioNaViagem(
  nascimento: string | null | undefined,
  embarque: string | null | undefined,
  retorno: string | null | undefined,
): { data: string; idade: number | null } | null {
  if (!nascimento || !embarque || !retorno) return null;
  const nasc = nascimento.slice(0, 10); // YYYY-MM-DD
  const emb = embarque.slice(0, 10);
  const ret = retorno.slice(0, 10);
  if (nasc.length < 10 || emb.length < 10 || ret.length < 10 || ret < emb) return null;
  const monthDay = nasc.slice(5); // MM-DD
  const anoNasc = Number(nasc.slice(0, 4));
  for (let y = Number(emb.slice(0, 4)); y <= Number(ret.slice(0, 4)); y++) {
    const cand = `${y}-${monthDay}`;
    if (cand >= emb && cand <= ret) {
      return { data: cand, idade: anoNasc > 0 ? y - anoNasc : null };
    }
  }
  return null;
}

/** Meses (número 1-12) que a expedição atravessa, do embarque ao retorno (inclusive). */
export function mesesDaExpedicao(
  embarque: string | null | undefined,
  retorno: string | null | undefined,
): number[] {
  const emb = (embarque ?? "").slice(0, 10);
  const ret = (retorno ?? "").slice(0, 10);
  if (emb.length < 10 || ret.length < 10 || ret < emb) return [];
  const out: number[] = [];
  let y = Number(emb.slice(0, 4)), m = Number(emb.slice(5, 7));
  const yEnd = Number(ret.slice(0, 4)), mEnd = Number(ret.slice(5, 7));
  for (let i = 0; i < 24 && (y < yEnd || (y === yEnd && m <= mEnd)); i++) {
    if (!out.includes(m)) out.push(m);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Se o passageiro faz aniversário em ALGUM mês que a expedição atravessa (mesmo
 * fora das datas exatas da viagem), retorna a data do aniversário no ano da
 * expedição, o dia, o mês, a idade e se cai DURANTE a viagem. Senão null.
 * Quando a expedição pega dois meses, aniversariantes dos dois entram.
 */
export function aniversarioNoMesDaExpedicao(
  nascimento: string | null | undefined,
  embarque: string | null | undefined,
  retorno: string | null | undefined,
): { data: string; dia: number; mes: number; idade: number | null; naViagem: boolean } | null {
  if (!nascimento || !embarque || !retorno) return null;
  const nasc = nascimento.slice(0, 10);
  const emb = embarque.slice(0, 10), ret = retorno.slice(0, 10);
  if (nasc.length < 10 || emb.length < 10 || ret.length < 10 || ret < emb) return null;
  const mesNasc = Number(nasc.slice(5, 7));
  // Acha o ano em que esse mês ocorre dentro do intervalo da expedição.
  let y = Number(emb.slice(0, 4)), m = Number(emb.slice(5, 7));
  const yEnd = Number(ret.slice(0, 4)), mEnd = Number(ret.slice(5, 7));
  let ano: number | null = null;
  for (let i = 0; i < 24 && (y < yEnd || (y === yEnd && m <= mEnd)); i++) {
    if (m === mesNasc) { ano = y; break; }
    m++; if (m > 12) { m = 1; y++; }
  }
  if (ano == null) return null;
  const data = `${ano}-${nasc.slice(5)}`;
  const anoNasc = Number(nasc.slice(0, 4));
  return {
    data, dia: Number(nasc.slice(8, 10)), mes: mesNasc,
    idade: anoNasc > 0 ? ano - anoNasc : null,
    naViagem: data >= emb && data <= ret,
  };
}

export function generateExpedicaoCodigo(destino: string, dataEmbarque: string | Date): string {
  const meses = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
  const d = typeof dataEmbarque === "string" ? parseISO(dataEmbarque) : dataEmbarque;
  const mes = meses[d.getMonth()];
  const ano = d.getFullYear();
  const slug = destino.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
  return `${slug}-${mes}${ano}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
