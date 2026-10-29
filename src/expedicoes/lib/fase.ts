// src/expedicoes/lib/fase.ts
// -----------------------------------------------------------------------------
// FASE DA EXPEDIÇÃO (redesign 29/10, docs/ref-expedicoes/qs-redesign-expedicoes.md §1).
// Toda a tela de Expedições muda conforme a fase, que é CALCULADA pelas datas —
// o status manual (Planejamento / Vendas Abertas / Em andamento / Concluída)
// continua existindo, mas quem dirige o visual é a fase.
//
//   concluida   → hoje > fim
//   em_viagem   → inicio <= hoje <= fim
//   embarque    → faltam 1 a 30 dias para o início
//   preparacao  → faltam 31 a 120 dias
//   vendendo    → faltam mais de 120 dias
//
// Datas comparadas em America/Sao_Paulo, só a parte de data. Lógica PURA (sem
// React, sem banco, sem alias "@/") pra rodar no node:test — ver docs/MAPA-EXPEDICOES.md.
// -----------------------------------------------------------------------------

export type Fase = "vendendo" | "preparacao" | "embarque" | "em_viagem" | "concluida";

/** Limites das fases (dias até o embarque). ÚNICO lugar com esses números. */
export const LIMITES_FASE = {
  /** Até quantos dias antes do embarque é "Embarque em até 30 dias". */
  embarque: 30,
  /** Até quantos dias antes do embarque é "Preparação" (acima disso: vendendo). */
  preparacao: 120,
} as const;

export const FUSO_OPERACAO = "America/Sao_Paulo";

/** Ordem das seções na Central (e da barra de fases). */
export const ORDEM_FASES: readonly Fase[] = ["em_viagem", "embarque", "preparacao", "vendendo", "concluida"];

export interface MetaFase {
  rotulo: string;
  /** Rótulo curto (chips da tabela, legenda). */
  curto: string;
  /** Dica no cabeçalho da seção da Central. */
  dica: string;
  /** Título da 5ª coluna da Central (muda por seção). */
  metrica: string;
  /** Tokens (tokens.css): ponto/barra, fundo e texto do chip. */
  cor: string;
  bg: string;
  fg: string;
}

export const META_FASE: Record<Fase, MetaFase> = {
  em_viagem: { rotulo: "Em viagem", curto: "Em viagem", dica: "grupos fora do Brasil agora", metrica: "Andamento",
    cor: "var(--fase-viagem)", bg: "var(--fase-viagem-bg)", fg: "var(--fase-viagem-fg)" },
  embarque: { rotulo: `Embarque em até ${LIMITES_FASE.embarque} dias`, curto: "Embarque", dica: "foco total em documentos e prontidão", metrica: "Prontidão",
    cor: "var(--fase-embarque)", bg: "var(--fase-embarque-bg)", fg: "var(--fase-embarque-fg)" },
  preparacao: { rotulo: "Preparação", curto: "Preparação", dica: `até ${LIMITES_FASE.preparacao} dias para embarcar`, metrica: "Prontidão",
    cor: "var(--fase-preparacao)", bg: "var(--fase-preparacao-bg)", fg: "var(--fase-preparacao-fg)" },
  vendendo: { rotulo: "Vendas abertas", curto: "Vendendo", dica: `mais de ${LIMITES_FASE.preparacao} dias, foco em vender vagas`, metrica: "Vagas",
    cor: "var(--fase-vendendo)", bg: "var(--fase-vendendo-bg)", fg: "var(--fase-vendendo-fg)" },
  concluida: { rotulo: "Concluídas", curto: "Concluída", dica: "últimos 12 meses", metrica: "Resultado",
    cor: "var(--fase-concluida)", bg: "var(--fase-concluida-bg)", fg: "var(--fase-concluida-fg)" },
};

type DataEntrada = Date | string;

const FMT_SP = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_OPERACAO, year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * "YYYY-MM-DD" da data em São Paulo. String "YYYY-MM-DD…" (coluna date do banco)
 * é usada como está — não passa por fuso (o banco já guarda a data do calendário).
 */
export function dataSP(d: DataEntrada): string {
  if (typeof d === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    d = new Date(d);
  }
  return FMT_SP.format(d);
}

/** Dia absoluto (nº de dias desde 1970) de uma "YYYY-MM-DD" — sem fuso, sem horário de verão. */
function diaAbs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Quantos dias de `de` até `ate` (datas de calendário em SP). Positivo = `ate` no futuro. */
export function diasEntre(de: DataEntrada, ate: DataEntrada): number {
  return diaAbs(dataSP(ate)) - diaAbs(dataSP(de));
}

export function getFase(inicio: DataEntrada, fim: DataEntrada, hoje: DataEntrada): Fase {
  const ate = diasEntre(hoje, inicio);
  const ateFim = diasEntre(hoje, fim);
  if (ateFim < 0) return "concluida";
  if (ate <= 0) return "em_viagem";
  if (ate <= LIMITES_FASE.embarque) return "embarque";
  if (ate <= LIMITES_FASE.preparacao) return "preparacao";
  return "vendendo";
}

export interface InfoFase {
  fase: Fase;
  /** Dias até o embarque (negativo se já embarcou). */
  diasParaInicio: number;
  /** Dias até a volta (negativo se já voltou). */
  diasParaFim: number;
  /** Duração em dias, contando o primeiro e o último (D1..Dn). */
  totalDias: number;
  /** Dia da viagem hoje (1..totalDias) — só faz sentido em viagem. */
  diaDaViagem: number;
  /** 0..1 do andamento da viagem (0 antes, 1 depois). */
  progresso: number;
}

/** Fase + números derivados. Sem data de embarque, a expedição fica em "vendendo". */
export function infoFase(inicio: DataEntrada | null | undefined, fim: DataEntrada | null | undefined, hoje: DataEntrada): InfoFase {
  if (!inicio) return { fase: "vendendo", diasParaInicio: Infinity, diasParaFim: Infinity, totalDias: 0, diaDaViagem: 0, progresso: 0 };
  const fimOk = fim ?? inicio;
  const diasParaInicio = diasEntre(hoje, inicio);
  const diasParaFim = diasEntre(hoje, fimOk);
  const totalDias = Math.max(1, diasEntre(inicio, fimOk) + 1);
  const diaDaViagem = 1 - diasParaInicio;
  const progresso = Math.max(0, Math.min(1, diaDaViagem / totalDias));
  return { fase: getFase(inicio, fimOk, hoje), diasParaInicio, diasParaFim, totalDias, diaDaViagem, progresso };
}

/**
 * Aviso discreto do cockpit (spec §1): o status manual (Planejamento / Vendas
 * Abertas / Em andamento / Concluída) contradiz a fase calculada pelas datas.
 * Null = coerentes (ou cancelada, que não tem fase).
 */
export function divergenciaStatus(status: string | null | undefined, fase: Fase): string | null {
  if (!status || status === "Cancelada") return null;
  const em = (f: Fase) => META_FASE[f].curto.toLowerCase();
  if (status === "Concluída" && fase !== "concluida") return `O status é "Concluída", mas pelas datas a expedição está em ${em(fase)}.`;
  if (fase === "concluida" && status !== "Concluída") return `Pelas datas a viagem já acabou, mas o status ainda é "${status}".`;
  if (fase === "em_viagem" && status !== "Em andamento") return `Pelas datas o grupo está em viagem, mas o status é "${status}".`;
  if (status === "Em andamento" && fase !== "em_viagem") return `O status é "Em andamento", mas pelas datas a expedição está em ${em(fase)}.`;
  return null;
}
