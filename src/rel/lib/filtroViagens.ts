// src/rel/lib/filtroViagens.ts
// -----------------------------------------------------------------------------
// FILTRO DO PAINEL DE VIAGENS (Bruno, 19/11: "filtrar todos os serviços, quem
// tem interno e etc… principalmente data" + "deve ficar no filtro do painel
// mesmo, assim filtramos dentro do painel").
//
// O Painel já carrega todas as viagens que vão acontecer ou estão em andamento
// (viagensEmAndamento, até 1000). O filtro roda EM CIMA delas, no navegador —
// mapa, cards e quadros de partidas mudam na hora. Combina:
//   • DATA — qual data (em andamento no período · embarque · volta · próximo
//     voo · venda) + período rápido (hoje, 7/30 dias, este mês, próximo mês,
//     qualquer) ou de/até livre;
//   • SERVIÇO vendido — vários de uma vez;
//   • TEM NO ROTEIRO — voo interno (voos_internos da rel_viagens_v), algum /
//     nenhum voo (voos_total), hotel, transfer, passeio, trem (trechos da
//     viagem). Marcar mais de um = precisa ter TODOS;
//   • SITUAÇÃO (próximas / em viagem), DONO e BUSCA.
//
// Lógica pura (sem supabase), com teste: tests/viagens/filtroViagens.test.ts.
// -----------------------------------------------------------------------------
import type { Servico, Viagem } from "./viagens";

export type CampoData = "durante" | "embarque" | "volta" | "venda" | "proximo_voo";
export type PeriodoRapido = "hoje" | "7d" | "30d" | "este_mes" | "prox_mes" | "tudo" | "livre";
export type Situacao = "ativas" | "proximas" | "em_viagem";
export type TemNoRoteiro = "voo_interno" | "voo" | "sem_voo" | "hospedagem" | "transfer" | "passeio" | "trem";
/** "todos" | "minhas" | "sem_dono" | id de quem cuida */
export type Dono = string;

export interface FiltroPainel {
  campo: CampoData;
  periodo: PeriodoRapido;
  /** só valem com periodo = "livre" (aaaa-mm-dd) */
  de: string;
  ate: string;
  servicos: Servico[];
  tem: TemNoRoteiro[];
  situacao: Situacao;
  dono: Dono;
  busca: string;
}

export const CAMPOS_DATA: { id: CampoData; rotulo: string; dica: string }[] = [
  { id: "durante", rotulo: "Em andamento", dica: "Está viajando ou embarca dentro do período" },
  { id: "embarque", rotulo: "Embarque", dica: "Data de ida" },
  { id: "volta", rotulo: "Volta", dica: "Data de retorno" },
  { id: "proximo_voo", rotulo: "Próximo voo", dica: "O próximo voo que ainda vai acontecer" },
  { id: "venda", rotulo: "Venda", dica: "Quando foi vendida" },
];

export const PERIODOS: { id: PeriodoRapido; rotulo: string }[] = [
  { id: "tudo", rotulo: "Qualquer data" },
  { id: "hoje", rotulo: "Hoje" },
  { id: "7d", rotulo: "7 dias" },
  { id: "30d", rotulo: "30 dias" },
  { id: "este_mes", rotulo: "Este mês" },
  { id: "prox_mes", rotulo: "Próximo mês" },
  { id: "livre", rotulo: "Escolher…" },
];

/** Os serviços que entram no Painel (os que têm acompanhamento — 0148). */
export const SERVICOS_FILTRO: { id: Servico; rotulo: string }[] = [
  { id: "expedicao", rotulo: "Expedição" },
  { id: "pacote", rotulo: "Pacote" },
  { id: "aereo", rotulo: "Aéreo" },
  { id: "hospedagem", rotulo: "Hotel" },
  { id: "passeio", rotulo: "Passeio / transfer" },
  { id: "cruzeiro", rotulo: "Cruzeiro" },
];

export const TEM_NO_ROTEIRO: { id: TemNoRoteiro; rotulo: string; dica: string }[] = [
  { id: "voo_interno", rotulo: "Voo interno", dica: "Tem pelo menos um voo interno cadastrado" },
  { id: "voo", rotulo: "Algum voo", dica: "Tem pelo menos um voo cadastrado" },
  { id: "sem_voo", rotulo: "Nenhum voo", dica: "Nenhum voo cadastrado no roteiro" },
  { id: "hospedagem", rotulo: "Hotel", dica: "Tem hospedagem cadastrada no roteiro" },
  { id: "transfer", rotulo: "Transfer", dica: "Tem transfer cadastrado no roteiro" },
  { id: "passeio", rotulo: "Passeio", dica: "Tem passeio cadastrado no roteiro" },
  { id: "trem", rotulo: "Trem", dica: "Tem trem cadastrado no roteiro" },
];

export const SITUACOES: { id: Situacao; rotulo: string }[] = [
  { id: "ativas", rotulo: "Vão acontecer + em viagem" },
  { id: "proximas", rotulo: "Só as próximas" },
  { id: "em_viagem", rotulo: "Só em viagem" },
];

/** Padrão = o Painel de sempre (nada filtrado). */
export const FILTRO_PADRAO: FiltroPainel = {
  campo: "durante", periodo: "tudo", de: "", ate: "", servicos: [], tem: [], situacao: "ativas", dono: "todos", busca: "",
};

// ── Datas ───────────────────────────────────────────────────────────────────

export function somaDias(d: string, n: number): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

function fimDoMes(ano: number, mes1a12: number): string {
  return new Date(Date.UTC(ano, mes1a12, 0, 12)).toISOString().slice(0, 10); // dia 0 do mês seguinte
}

/** O intervalo (inclusive) de um período, a partir de "hoje" (dia de SP). null = sem limite. */
export function intervaloDoPeriodo(f: Pick<FiltroPainel, "periodo" | "de" | "ate">, hoje: string): { de: string | null; ate: string | null } {
  const [a, m] = hoje.split("-").map(Number);
  switch (f.periodo) {
    case "hoje": return { de: hoje, ate: hoje };
    case "7d": return { de: hoje, ate: somaDias(hoje, 6) };
    case "30d": return { de: hoje, ate: somaDias(hoje, 29) };
    case "este_mes": return { de: `${hoje.slice(0, 7)}-01`, ate: fimDoMes(a, m) };
    case "prox_mes": {
      const am = m === 12 ? a + 1 : a, mm = m === 12 ? 1 : m + 1;
      return { de: `${am}-${String(mm).padStart(2, "0")}-01`, ate: fimDoMes(am, mm) };
    }
    case "livre": return { de: f.de || null, ate: f.ate || null };
    default: return { de: null, ate: null };
  }
}

/** Dia (aaaa-mm-dd) de um instante em São Paulo. */
const diaSP = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
const dentro = (d: string | null | undefined, de: string | null, ate: string | null) => !!d && (!de || d >= de) && (!ate || d <= ate);

export type ViagemFiltravel = Pick<Viagem,
  "id" | "servico" | "data_embarque" | "data_retorno" | "data_venda" | "proximo_voo_em" | "responsavel_id" | "fase" |
  "titulo" | "destino" | "expedicao" | "cliente_nome" | "bitrix_deal_id"> & { voos_internos?: number; voos_total?: number };

/** A viagem cai no período, pela data escolhida? */
export function passaNaData(v: ViagemFiltravel, campo: CampoData, de: string | null, ate: string | null): boolean {
  if (!de && !ate) return true;
  switch (campo) {
    case "embarque": return dentro(v.data_embarque, de, ate);
    case "volta": return dentro(v.data_retorno, de, ate);
    case "venda": return dentro(v.data_venda, de, ate);
    case "proximo_voo": return !!v.proximo_voo_em && dentro(diaSP(v.proximo_voo_em), de, ate);
    default: {
      // em andamento: embarca até o fim do período E volta depois do início (sem volta: vale a ida)
      if (!v.data_embarque) return false;
      const fim = v.data_retorno && v.data_retorno >= v.data_embarque ? v.data_retorno : v.data_embarque;
      return (!ate || v.data_embarque <= ate) && (!de || fim >= de);
    }
  }
}

// ── Busca ───────────────────────────────────────────────────────────────────

/** minúsculas e sem acento ("Japão" acha "japao"). */
export const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function passaNaBusca(v: ViagemFiltravel, busca: string): boolean {
  const q = normalizar(busca);
  if (!q) return true;
  if (/^\d+$/.test(q) && String(v.bitrix_deal_id ?? "") === q) return true;
  return [v.titulo, v.destino, v.expedicao, v.cliente_nome].some((x) => x && normalizar(x).includes(q));
}

// ── Tudo junto ──────────────────────────────────────────────────────────────

export interface ContextoFiltro {
  hoje: string;
  userId: string;
  /** tipos de trecho de cada viagem (rel_viagem_trechos.tipo) — pra hotel/transfer/passeio/trem */
  tiposDoRoteiro: Map<string, Set<string>>;
}

export function passaNoFiltro(v: ViagemFiltravel, f: FiltroPainel, ctx: ContextoFiltro): boolean {
  if (f.situacao === "proximas" && v.fase !== "antes") return false;
  if (f.situacao === "em_viagem" && v.fase !== "em_viagem") return false;
  if (f.servicos.length && !(v.servico && f.servicos.includes(v.servico))) return false;
  const { de, ate } = intervaloDoPeriodo(f, ctx.hoje);
  if (!passaNaData(v, f.campo, de, ate)) return false;
  const internos = v.voos_internos ?? 0, voos = v.voos_total ?? 0;
  const tipos = ctx.tiposDoRoteiro.get(v.id);
  for (const t of f.tem) {
    if (t === "voo_interno" ? internos <= 0 : t === "voo" ? voos <= 0 : t === "sem_voo" ? voos > 0 : !tipos?.has(t)) return false;
  }
  if (f.dono === "minhas" && v.responsavel_id !== ctx.userId) return false;
  if (f.dono === "sem_dono" && v.responsavel_id) return false;
  if (f.dono !== "todos" && f.dono !== "minhas" && f.dono !== "sem_dono" && v.responsavel_id !== f.dono) return false;
  return passaNaBusca(v, f.busca);
}

/** "Nenhum voo" não combina com "voo interno"/"algum voo": marcar um desmarca o outro. */
export function alternarTem(tem: TemNoRoteiro[], t: TemNoRoteiro): TemNoRoteiro[] {
  if (tem.includes(t)) return tem.filter((x) => x !== t);
  const sem = t === "sem_voo" ? tem.filter((x) => x !== "voo" && x !== "voo_interno") : t === "voo" || t === "voo_interno" ? tem.filter((x) => x !== "sem_voo") : tem;
  return [...sem, t];
}

// ── Guardar no navegador ────────────────────────────────────────────────────

const valido = <T extends string>(v: unknown, ok: { id: T }[], padrao: T): T => (ok.some((o) => o.id === v) ? (v as T) : padrao);

/** Lê o filtro guardado; qualquer coisa estranha volta pro padrão. A busca não fica. */
export function lerFiltro(json: string | null | undefined): FiltroPainel {
  let o: Record<string, unknown> = {};
  try { o = json ? JSON.parse(json) : {}; } catch { o = {}; }
  if (!o || typeof o !== "object") o = {};
  const lista = <T extends string>(v: unknown, ok: { id: T }[]): T[] => (Array.isArray(v) ? v.filter((x) => ok.some((k) => k.id === x)) as T[] : []);
  const dia = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  return {
    campo: valido(o.campo, CAMPOS_DATA, FILTRO_PADRAO.campo),
    periodo: valido(o.periodo, PERIODOS, FILTRO_PADRAO.periodo),
    de: dia(o.de), ate: dia(o.ate),
    servicos: lista(o.servicos, SERVICOS_FILTRO),
    tem: lista(o.tem, TEM_NO_ROTEIRO),
    situacao: valido(o.situacao, SITUACOES, FILTRO_PADRAO.situacao),
    dono: typeof o.dono === "string" && o.dono ? o.dono : "todos",
    busca: "",
  };
}

/** Quantos filtros estão ligados (pro "Limpar" e pro número no botão). */
export function quantosAtivos(f: FiltroPainel): number {
  return [f.periodo !== "tudo", f.servicos.length > 0, f.tem.length > 0, f.situacao !== "ativas", f.dono !== "todos", !!f.busca.trim()].filter(Boolean).length;
}
