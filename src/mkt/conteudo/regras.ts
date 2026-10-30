// src/mkt/conteudo/regras.ts
// -----------------------------------------------------------------------------
// Regras PURAS do quadro de conteúdo (0240). Testadas em tests/mkt/*.test.ts.
// Só `import type` aqui (o teste roda no node sem bundler).
//
// podeMover() é o ESPELHO da regra do banco (mkt_cards_antes): a tela usa pra
// não oferecer o que o banco vai recusar e pra explicar o porquê. Quem manda é
// o banco — se as duas divergirem, vale o banco.
// -----------------------------------------------------------------------------
import type { CardMkt, Coluna, Origem, StatusAprovacao, TipoColuna, TipoConteudo } from "./tipos";

// ── Ordem dentro da coluna ──────────────────────────────────────────────────
/** Número entre dois vizinhos (sem renumerar a coluna inteira). */
export function ordemEntre(antes: number | null | undefined, depois: number | null | undefined): number {
  if (antes == null && depois == null) return 1000;
  if (antes == null) return (depois as number) - 1;
  if (depois == null) return antes + 1;
  return (antes + depois) / 2;
}

/**
 * Ordem pra soltar um card numa coluna: antes do card `alvoId` (ou no fim, sem alvo).
 * `cards` = os da coluna de destino, já em ordem, SEM o card que está sendo movido.
 */
export function ordemAoSoltar(cards: { id: string; ordem: number }[], alvoId: string | null): number {
  if (!alvoId) return ordemEntre(cards.length ? cards[cards.length - 1].ordem : null, null);
  const i = cards.findIndex((c) => c.id === alvoId);
  if (i < 0) return ordemEntre(cards.length ? cards[cards.length - 1].ordem : null, null);
  return ordemEntre(i > 0 ? cards[i - 1].ordem : null, cards[i].ordem);
}

// ── Datas ───────────────────────────────────────────────────────────────────
/** Hoje em São Paulo, "AAAA-MM-DD". */
export function hojeSP(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

/** Soma dias numa data "AAAA-MM-DD" (sem fuso: conta no calendário). */
export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

/** Dia da semana de "AAAA-MM-DD" (0 = domingo). */
export function diaDaSemana(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** "30/10" ou "30/10/2027" (ano só quando não é o de hoje). */
export function dataCurta(iso: string | null | undefined, hoje: string = hojeSP()): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a === hoje.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${a}`;
}

/** Card "pronto": publicado/entregue ou arquivado — não atrasa mais. */
export function estaConcluido(c: Pick<CardMkt, "arquivado">, tipoColuna: TipoColuna | undefined): boolean {
  return c.arquivado || tipoColuna === "publicado";
}

/** Atrasado: tem prazo, o prazo já passou e ainda não foi publicado/entregue. */
export function estaAtrasado(c: Pick<CardMkt, "prazo" | "arquivado">, tipoColuna: TipoColuna | undefined, hoje: string): boolean {
  return !!c.prazo && c.prazo < hoje && !estaConcluido(c, tipoColuna);
}

// ── Filtros ─────────────────────────────────────────────────────────────────
export type FiltroPrazo = "todos" | "hoje" | "semana" | "mes" | "sem_prazo";

export interface Filtros {
  origem: Origem | "todas";
  responsavel: string | "todos" | "ninguem";
  tipo: TipoConteudo | "todos";
  prazo: FiltroPrazo;
  soAtrasados: boolean;
  busca: string;
}

export const FILTROS_PADRAO: Filtros = { origem: "todas", responsavel: "todos", tipo: "todos", prazo: "todos", soAtrasados: false, busca: "" };

/** Tira acento e caixa, pra busca. */
export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function passaNoFiltro(c: CardMkt, f: Filtros, tipoColuna: TipoColuna | undefined, hoje: string): boolean {
  if (f.origem !== "todas" && c.origem !== f.origem) return false;
  if (f.responsavel === "ninguem" && c.responsavel_id) return false;
  if (f.responsavel !== "todos" && f.responsavel !== "ninguem" && c.responsavel_id !== f.responsavel) return false;
  if (f.tipo !== "todos" && c.tipo !== f.tipo) return false;
  if (f.soAtrasados && !estaAtrasado(c, tipoColuna, hoje)) return false;
  if (f.prazo === "sem_prazo" && c.prazo) return false;
  if (f.prazo === "hoje" && c.prazo !== hoje) return false;
  if (f.prazo === "semana" && !(c.prazo && c.prazo <= somarDias(hoje, 7))) return false;
  if (f.prazo === "mes" && !(c.prazo && c.prazo <= somarDias(hoje, 31))) return false;
  if (f.busca.trim()) {
    const q = normalizar(f.busca);
    const alvo = normalizar([c.titulo, c.descricao ?? "", c.destino ?? "", ...(c.tags ?? [])].join(" "));
    if (!alvo.includes(q)) return false;
  }
  return true;
}

/** Filtros ativos (pro "Limpar (3)"). */
export function contarFiltros(f: Filtros): number {
  return (f.origem !== "todas" ? 1 : 0) + (f.responsavel !== "todos" ? 1 : 0) + (f.tipo !== "todos" ? 1 : 0)
    + (f.prazo !== "todos" ? 1 : 0) + (f.soAtrasados ? 1 : 0) + (f.busca.trim() ? 1 : 0);
}

// ── Fluxo de aprovação (espelho do banco) ───────────────────────────────────
export type Movimento =
  | { ok: true; acao: "mover" | "pedir_aprovacao" | "aprovar" | "devolver" | "publicar" | "reabrir" }
  | { ok: false; motivo: string };

export function podeMover(de: TipoColuna, para: TipoColuna, aprovador: boolean, status: StatusAprovacao): Movimento {
  if (de === para) return { ok: true, acao: "mover" };
  if (de === "aprovacao") {
    if (!aprovador) return { ok: false, motivo: "Está em aprovação: só o gestor de Marketing aprova ou devolve." };
    if (para === "aprovado") return { ok: true, acao: "aprovar" };
    if (para === "ajustes") return { ok: true, acao: "devolver" };
    return { ok: false, motivo: "Da aprovação o card só sai aprovado ou devolvido pra ajustes." };
  }
  if (para === "aprovacao") return { ok: true, acao: "pedir_aprovacao" };
  if (para === "aprovado") {
    return aprovador ? { ok: true, acao: "aprovar" } : { ok: false, motivo: "Só o gestor de Marketing aprova. Mova pra \"Em aprovação\" que ele recebe o aviso." };
  }
  if (para === "publicado") {
    if (status !== "aprovado" && !aprovador) return { ok: false, motivo: "Só vai pra Publicado / Entregue o que foi aprovado." };
    return { ok: true, acao: "publicar" };
  }
  if ((de === "aprovado" || de === "publicado")) return { ok: true, acao: "reabrir" };
  return { ok: true, acao: "mover" };
}

/** Comentário de devolução: obrigatório, com pelo menos 3 letras (igual ao banco). */
export function comentarioDeDevolucaoOk(texto: string): boolean {
  return texto.trim().length >= 3;
}

/** Card novo nasce numa coluna de trabalho (o banco recusa nas de aprovação). */
export function colunaAceitaCardNovo(tipo: TipoColuna): boolean {
  return tipo === "livre" || tipo === "entrada";
}

export function colunaDeEntrada(colunas: Coluna[]): Coluna | undefined {
  return colunas.find((c) => c.tipo === "entrada") ?? [...colunas].sort((a, b) => a.ordem - b.ordem).find((c) => colunaAceitaCardNovo(c.tipo));
}

// ── Checklist ───────────────────────────────────────────────────────────────
export function progressoChecklist(itens: { feito: boolean }[] | null | undefined): { feitos: number; total: number } {
  const l = itens ?? [];
  return { feitos: l.filter((i) => i.feito).length, total: l.length };
}

// ── Biblioteca ──────────────────────────────────────────────────────────────
/** Entra na Biblioteca: o que foi aprovado (e segue aprovado/publicado). */
export function naBiblioteca(c: Pick<CardMkt, "status_aprovacao">): boolean {
  return c.status_aprovacao === "aprovado";
}

export interface FiltroBiblioteca { busca: string; tipo: TipoConteudo | "todos"; destino: string | "todos"; tag: string | "todas" }

export function filtrarBiblioteca<T extends CardMkt>(cards: T[], f: FiltroBiblioteca): T[] {
  const q = normalizar(f.busca);
  return cards.filter((c) => {
    if (!naBiblioteca(c) || c.arquivado) return false;
    if (f.tipo !== "todos" && c.tipo !== f.tipo) return false;
    if (f.destino !== "todos" && normalizar(c.destino ?? "") !== normalizar(f.destino)) return false;
    if (f.tag !== "todas" && !(c.tags ?? []).some((t) => normalizar(t) === normalizar(f.tag))) return false;
    if (q && !normalizar([c.titulo, c.descricao ?? "", c.destino ?? "", ...(c.tags ?? [])].join(" ")).includes(q)) return false;
    return true;
  });
}

/** Valores distintos (destinos, tags) pra montar os filtros, em ordem alfabética. */
export function distintos(valores: (string | null | undefined)[]): string[] {
  const m = new Map<string, string>();
  for (const v of valores) { const t = (v ?? "").trim(); if (t && !m.has(normalizar(t))) m.set(normalizar(t), t); }
  return [...m.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** "reels, Japão ,  japão" → ["reels", "Japão"] (sem repetir, sem vazio). */
export function lerTags(texto: string): string[] {
  return distintos(texto.split(","));
}

// ── Calendário editorial ────────────────────────────────────────────────────
/**
 * Semanas do mês (domingo a sábado), com os dias de fora do mês incluídos pra
 * completar a grade. mes = 1..12.
 */
export function gradeDoMes(ano: number, mes: number): string[][] {
  const primeiro = `${ano}-${String(mes).padStart(2, "0")}-01`;
  let dia = somarDias(primeiro, -diaDaSemana(primeiro));
  const semanas: string[][] = [];
  do {
    const s: string[] = [];
    for (let i = 0; i < 7; i++) { s.push(dia); dia = somarDias(dia, 1); }
    semanas.push(s);
  } while (Number(dia.slice(5, 7)) === mes);
  return semanas;
}

/** Os 7 dias (domingo a sábado) da semana que contém `iso`. */
export function semanaDe(iso: string): string[] {
  const ini = somarDias(iso, -diaDaSemana(iso));
  return Array.from({ length: 7 }, (_, i) => somarDias(ini, i));
}

/** Cards por dia de publicação. */
export function porDia<T extends { data_publicacao: string | null }>(cards: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const c of cards) {
    if (!c.data_publicacao) continue;
    const k = c.data_publicacao.slice(0, 10);
    m.set(k, [...(m.get(k) ?? []), c]);
  }
  return m;
}

export const NOME_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const DIA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
