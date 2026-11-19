// src/rel/lib/filtroViagens.ts
// -----------------------------------------------------------------------------
// ABA "FILTRAR" DAS VIAGENS (Bruno, 19/11: "criar um filtro na parte de viagens,
// pra filtrar todos os serviços, quem tem interno e etc… principalmente data").
//
// Um filtro só, que combina tudo:
//   • DATA — qual data (embarque · volta · em andamento no período · venda ·
//     próximo voo) + período rápido (hoje, 7/30 dias, este mês, próximo mês,
//     tudo) ou de/até livre;
//   • SERVIÇO vendido — vários de uma vez (pacote, aéreo, hotel…), inclusive
//     "sem classificação";
//   • TEM NO ROTEIRO — voo interno (coluna voos_internos da rel_viagens_v),
//     algum voo / nenhum voo (voos_total), hotel, transfer, passeio, trem
//     (trechos em rel_viagem_trechos). Marcar mais de um = precisa ter TODOS;
//   • SITUAÇÃO e DONO.
//
// Tudo vai NA CONSULTA (a lista para em 500: filtrar no navegador esconderia
// resultado). Aqui fica só a lógica pura (sem supabase), pra ter teste:
// tests/viagens/filtroViagens.test.ts. A consulta está em filtroViagensDados.ts.
// -----------------------------------------------------------------------------
import type { Servico } from "./viagens";

export type CampoData = "durante" | "embarque" | "volta" | "venda" | "proximo_voo";
export type PeriodoRapido = "hoje" | "7d" | "30d" | "este_mes" | "prox_mes" | "tudo" | "livre";
export type Situacao = "ativas" | "proximas" | "em_viagem" | "concluidas" | "canceladas" | "todas";
export type ServicoFiltro = Servico | "sem_classificacao";
export type TemNoRoteiro = "voo_interno" | "voo" | "sem_voo" | "hospedagem" | "transfer" | "passeio" | "trem";
/** "todos" | "minhas" | "sem_dono" | id de quem cuida */
export type Dono = string;

export interface FiltroAvancado {
  campo: CampoData;
  periodo: PeriodoRapido;
  /** só valem com periodo = "livre" (aaaa-mm-dd) */
  de: string;
  ate: string;
  servicos: ServicoFiltro[];
  tem: TemNoRoteiro[];
  situacao: Situacao;
  dono: Dono;
  busca: string;
}

export const CAMPOS_DATA: { id: CampoData; rotulo: string; dica: string }[] = [
  { id: "durante", rotulo: "Em andamento", dica: "Está viajando OU embarca dentro do período" },
  { id: "embarque", rotulo: "Embarque", dica: "Data de ida" },
  { id: "volta", rotulo: "Volta", dica: "Data de retorno" },
  { id: "proximo_voo", rotulo: "Próximo voo", dica: "O próximo voo que ainda vai acontecer" },
  { id: "venda", rotulo: "Venda", dica: "Quando foi vendida" },
];

export const PERIODOS: { id: PeriodoRapido; rotulo: string }[] = [
  { id: "hoje", rotulo: "Hoje" },
  { id: "7d", rotulo: "7 dias" },
  { id: "30d", rotulo: "30 dias" },
  { id: "este_mes", rotulo: "Este mês" },
  { id: "prox_mes", rotulo: "Próximo mês" },
  { id: "tudo", rotulo: "Qualquer data" },
  { id: "livre", rotulo: "Escolher…" },
];

export const SERVICOS_FILTRO: { id: ServicoFiltro; rotulo: string }[] = [
  { id: "expedicao", rotulo: "Expedição" },
  { id: "pacote", rotulo: "Pacote" },
  { id: "aereo", rotulo: "Aéreo" },
  { id: "hospedagem", rotulo: "Hotel" },
  { id: "passeio", rotulo: "Passeio / transfer" },
  { id: "cruzeiro", rotulo: "Cruzeiro" },
  { id: "seguro", rotulo: "Seguro" },
  { id: "concierge", rotulo: "Concierge" },
  { id: "conta_liminar", rotulo: "Conta liminar" },
  { id: "outro", rotulo: "Outro" },
  { id: "sem_classificacao", rotulo: "Sem classificação" },
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

/** Os que dependem dos trechos (os outros saem de colunas da view). */
export const TEM_POR_TRECHO: TemNoRoteiro[] = ["hospedagem", "transfer", "passeio", "trem"];

export const SITUACOES: { id: Situacao; rotulo: string }[] = [
  { id: "ativas", rotulo: "Vão acontecer + em viagem" },
  { id: "proximas", rotulo: "Só as próximas" },
  { id: "em_viagem", rotulo: "Só em viagem" },
  { id: "concluidas", rotulo: "Concluídas" },
  { id: "canceladas", rotulo: "Canceladas" },
  { id: "todas", rotulo: "Todas" },
];

export const FILTRO_PADRAO: FiltroAvancado = {
  campo: "durante", periodo: "30d", de: "", ate: "", servicos: [], tem: [], situacao: "ativas", dono: "todos", busca: "",
};

// ── Datas ───────────────────────────────────────────────────────────────────

export function somaDias(d: string, n: number): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

function fimDoMes(ano: number, mes1a12: number): string {
  const x = new Date(Date.UTC(ano, mes1a12, 0, 12)); // dia 0 do mês seguinte = último dia
  return x.toISOString().slice(0, 10);
}

/** O intervalo (inclusive) de um período, a partir de "hoje" (dia de SP). null = sem limite. */
export function intervaloDoPeriodo(f: Pick<FiltroAvancado, "periodo" | "de" | "ate">, hoje: string): { de: string | null; ate: string | null } {
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

/** 00:00 de São Paulo do dia, em ISO (pra comparar com timestamptz). */
export const inicioDoDiaSP = (d: string) => `${d}T00:00:00-03:00`;

export interface CondicaoSimples { coluna: string; op: "gte" | "lte" | "lt"; valor: string }

/**
 * As condições de data. `simples` vão como .gte/.lte; `grupo` (só no
 * "em andamento") é um or() — volta depois do início OU, sem volta, ida
 * depois do início — que entra junto da busca.
 */
export function condicoesDeData(campo: CampoData, de: string | null, ate: string | null): { simples: CondicaoSimples[]; grupo: string | null } {
  const s: CondicaoSimples[] = [];
  if (campo === "durante") {
    if (ate) s.push({ coluna: "data_embarque", op: "lte", valor: ate });
    // viagem sem nenhuma data não entra quando há período (não dá pra saber se acontece)
    const grupo = de ? `or(data_retorno.gte.${de},and(data_retorno.is.null,data_embarque.gte.${de}))` : null;
    return { simples: s, grupo };
  }
  if (campo === "proximo_voo") {
    if (de) s.push({ coluna: "proximo_voo_em", op: "gte", valor: inicioDoDiaSP(de) });
    if (ate) s.push({ coluna: "proximo_voo_em", op: "lt", valor: inicioDoDiaSP(somaDias(ate, 1)) });
    return { simples: s, grupo: null };
  }
  const coluna = campo === "embarque" ? "data_embarque" : campo === "volta" ? "data_retorno" : "data_venda";
  if (de) s.push({ coluna, op: "gte", valor: de });
  if (ate) s.push({ coluna, op: "lte", valor: ate });
  return { simples: s, grupo: null };
}

/** A coluna que ordena a lista (a da data escolhida). */
export function colunaDeOrdem(campo: CampoData): { coluna: string; asc: boolean } {
  switch (campo) {
    case "volta": return { coluna: "data_retorno", asc: true };
    case "venda": return { coluna: "data_venda", asc: false };
    case "proximo_voo": return { coluna: "proximo_voo_em", asc: true };
    default: return { coluna: "data_embarque", asc: true };
  }
}

// ── Serviço ─────────────────────────────────────────────────────────────────

/**
 * O or() do serviço. Sem nada marcado = null (todos). "Sem classificação" é o
 * serviço vazio, que um `in` nunca pega (null não entra no IN).
 */
export function grupoDosServicos(servicos: ServicoFiltro[]): string | null {
  if (!servicos.length) return null;
  const reais = servicos.filter((s): s is Servico => s !== "sem_classificacao");
  const partes: string[] = [];
  if (reais.length) partes.push(`servico.in.(${reais.join(",")})`);
  if (servicos.includes("sem_classificacao")) partes.push("servico.is.null");
  return `or(${partes.join(",")})`;
}

// ── Situação ────────────────────────────────────────────────────────────────

export function condicoesDaSituacao(s: Situacao): { status?: string; fases?: string[] } {
  switch (s) {
    case "ativas": return { status: "ativa", fases: ["antes", "em_viagem"] };
    case "proximas": return { status: "ativa", fases: ["antes"] };
    case "em_viagem": return { status: "ativa", fases: ["em_viagem"] };
    case "concluidas": return { fases: ["concluida"] };
    case "canceladas": return { fases: ["cancelada"] };
    default: return {};
  }
}

// ── Busca ───────────────────────────────────────────────────────────────────

/** Tira o que quebraria o or=(...) do PostgREST. */
export const limparBusca = (t: string) => t.replace(/[,()*%\\:"']/g, " ").trim();

export function grupoDaBusca(busca: string): string | null {
  const t = limparBusca(busca);
  if (!t) return null;
  const num = t.replace(/\D/g, "") || "0";
  return `or(titulo.ilike.*${t}*,destino.ilike.*${t}*,expedicao.ilike.*${t}*,cliente_nome.ilike.*${t}*,bitrix_deal_id.eq.${num})`;
}

/**
 * Junta os or() (data, serviço, busca) num só parâmetro — o PostgREST só aceita
 * UM `or=` por consulta, então vira or=(and(grupo1,grupo2,…)).
 */
export function juntarGrupos(grupos: (string | null)[]): string | null {
  const g = grupos.filter((x): x is string => !!x);
  if (!g.length) return null;
  return g.length === 1 ? g[0].replace(/^or\(/, "").replace(/\)$/, "") : `and(${g.join(",")})`;
}

// ── Guardar no navegador ────────────────────────────────────────────────────

const valido = <T extends string>(v: unknown, ok: { id: T }[], padrao: T): T => (ok.some((o) => o.id === v) ? (v as T) : padrao);

/** Lê o filtro guardado; qualquer coisa estranha volta pro padrão. */
export function lerFiltro(json: string | null | undefined): FiltroAvancado {
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
    busca: "", // a busca não fica guardada
  };
}

/** Quantos filtros estão fora do padrão (pro "Limpar"). */
export function quantosAtivos(f: FiltroAvancado): number {
  let n = 0;
  if (f.campo !== FILTRO_PADRAO.campo || f.periodo !== FILTRO_PADRAO.periodo) n++;
  if (f.servicos.length) n++;
  if (f.tem.length) n++;
  if (f.situacao !== FILTRO_PADRAO.situacao) n++;
  if (f.dono !== "todos") n++;
  if (f.busca.trim()) n++;
  return n;
}
