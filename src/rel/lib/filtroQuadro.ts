// src/rel/lib/filtroQuadro.ts
// -----------------------------------------------------------------------------
// FILTRO POR COLUNA do quadro "Partidas · Pacotes e serviços" do Painel de
// Viagens (Bruno, 19/11: "coloque embaixo de Partidas · Pacotes e serviços,
// onde fica RESPONSÁVEL DA COMPRA, SERVIÇO, DE, PARA, PRÓXIMO VOO… um filtro
// em cada tópico, assim fica fácil ver as viagens que vão acontecer").
//
// Cada coluna tem o seu filtro, logo abaixo do título dela; todos somam.
// O PRÓXIMO VOO filtra por data (hoje, amanhã, 7/30 dias, este mês, próximo
// mês ou de/até) — sem voo, vale a data de embarque, que é a que o quadro mostra.
// Lógica pura (sem tela), com teste: tests/viagens/filtroQuadro.test.ts.
// -----------------------------------------------------------------------------

export type PeriodoVoo = "tudo" | "hoje" | "amanha" | "7d" | "30d" | "este_mes" | "prox_mes" | "livre";
export type Sim3 = "" | "com" | "sem";

export interface FiltroQuadro {
  responsavel: string;
  servico: string; // "" = todos
  de: string;
  para: string;
  voo: PeriodoVoo;
  vooDe: string; // só com voo = "livre" (aaaa-mm-dd)
  vooAte: string;
  localizador: Sim3;
  interno: "" | "sim" | "nao" | "sem_voo";
  pax: "" | "1" | "2" | "3+";
  alertas: "" | "urgente" | "algum" | "nenhum";
  situacao: string; // "" = todas
}

export const FILTRO_QUADRO_VAZIO: FiltroQuadro = {
  responsavel: "", servico: "", de: "", para: "", voo: "tudo", vooDe: "", vooAte: "", localizador: "", interno: "", pax: "", alertas: "", situacao: "",
};

export const PERIODOS_VOO: { id: PeriodoVoo; rotulo: string }[] = [
  { id: "tudo", rotulo: "Todas as datas" },
  { id: "hoje", rotulo: "Hoje" },
  { id: "amanha", rotulo: "Amanhã" },
  { id: "7d", rotulo: "Próximos 7 dias" },
  { id: "30d", rotulo: "Próximos 30 dias" },
  { id: "este_mes", rotulo: "Este mês" },
  { id: "prox_mes", rotulo: "Próximo mês" },
  { id: "livre", rotulo: "Escolher datas" },
];

/** O que o filtro precisa de cada linha do quadro (o Painel monta). */
export interface LinhaFiltravel {
  cliente: string;
  servico: string | null;
  de: string;
  para: string;
  /** dia (aaaa-mm-dd) mostrado em PRÓXIMO VOO: o voo, senão o embarque */
  dia: string | null;
  temLocalizador: boolean;
  /** null = sem voos; 0 = não; n = quantos */
  interno: number | null;
  pax: number;
  alertas: { alta: number; media: number };
  situacao: string;
}

export function somaDias(d: string, n: number): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
const fimDoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0, 12)).toISOString().slice(0, 10);

/** O intervalo (inclusive) do período do PRÓXIMO VOO. null = sem limite. */
export function intervaloVoo(f: Pick<FiltroQuadro, "voo" | "vooDe" | "vooAte">, hoje: string): { de: string | null; ate: string | null } {
  const [a, m] = hoje.split("-").map(Number);
  switch (f.voo) {
    case "hoje": return { de: hoje, ate: hoje };
    case "amanha": { const d = somaDias(hoje, 1); return { de: d, ate: d }; }
    case "7d": return { de: hoje, ate: somaDias(hoje, 6) };
    case "30d": return { de: hoje, ate: somaDias(hoje, 29) };
    case "este_mes": return { de: `${hoje.slice(0, 7)}-01`, ate: fimDoMes(a, m) };
    case "prox_mes": { const am = m === 12 ? a + 1 : a, mm = m === 12 ? 1 : m + 1; return { de: `${am}-${String(mm).padStart(2, "0")}-01`, ate: fimDoMes(am, mm) }; }
    case "livre": return { de: f.vooDe || null, ate: f.vooAte || null };
    default: return { de: null, ate: null };
  }
}

/** minúsculas e sem acento ("São Paulo" acha "sao paulo"). */
export const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const contem = (texto: string, busca: string) => !busca.trim() || normalizar(texto).includes(normalizar(busca));

export function passaNoQuadro(l: LinhaFiltravel, f: FiltroQuadro, hoje: string): boolean {
  if (!contem(l.cliente, f.responsavel)) return false;
  if (f.servico && (l.servico ?? "") !== f.servico) return false;
  if (!contem(l.de, f.de) || !contem(l.para, f.para)) return false;
  const { de, ate } = intervaloVoo(f, hoje);
  if ((de || ate) && (!l.dia || (de && l.dia < de) || (ate && l.dia > ate))) return false;
  if (f.localizador === "com" && !l.temLocalizador) return false;
  if (f.localizador === "sem" && l.temLocalizador) return false;
  if (f.interno === "sim" && !(l.interno && l.interno > 0)) return false;
  if (f.interno === "nao" && l.interno !== 0) return false;
  if (f.interno === "sem_voo" && l.interno !== null) return false;
  if (f.pax === "1" && l.pax !== 1) return false;
  if (f.pax === "2" && l.pax !== 2) return false;
  if (f.pax === "3+" && l.pax < 3) return false;
  if (f.alertas === "urgente" && l.alertas.alta === 0) return false;
  if (f.alertas === "algum" && l.alertas.alta + l.alertas.media === 0) return false;
  if (f.alertas === "nenhum" && l.alertas.alta + l.alertas.media > 0) return false;
  if (f.situacao && l.situacao !== f.situacao) return false;
  return true;
}

export function quantosAtivosQuadro(f: FiltroQuadro): number {
  return (Object.keys(FILTRO_QUADRO_VAZIO) as (keyof FiltroQuadro)[])
    .filter((k) => k !== "vooDe" && k !== "vooAte" && String(f[k]).trim() !== String(FILTRO_QUADRO_VAZIO[k])).length;
}

/** Lê o filtro guardado no navegador; o que não reconhecer volta pro vazio. */
export function lerFiltroQuadro(json: string | null | undefined): FiltroQuadro {
  let o: Record<string, unknown> = {};
  try { o = json ? JSON.parse(json) : {}; } catch { o = {}; }
  if (!o || typeof o !== "object") o = {};
  const txt = (k: keyof FiltroQuadro) => (typeof o[k] === "string" ? (o[k] as string) : FILTRO_QUADRO_VAZIO[k] as string);
  const um = <T extends string>(k: keyof FiltroQuadro, ok: readonly T[]): T => (ok.includes(o[k] as T) ? (o[k] as T) : (FILTRO_QUADRO_VAZIO[k] as T));
  const dia = (k: keyof FiltroQuadro) => (typeof o[k] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o[k] as string) ? (o[k] as string) : "");
  return {
    responsavel: txt("responsavel"), servico: txt("servico"), de: txt("de"), para: txt("para"),
    voo: um("voo", PERIODOS_VOO.map((p) => p.id)), vooDe: dia("vooDe"), vooAte: dia("vooAte"),
    localizador: um("localizador", ["", "com", "sem"] as const),
    interno: um("interno", ["", "sim", "nao", "sem_voo"] as const),
    pax: um("pax", ["", "1", "2", "3+"] as const),
    alertas: um("alertas", ["", "urgente", "algum", "nenhum"] as const),
    situacao: txt("situacao"),
  };
}
